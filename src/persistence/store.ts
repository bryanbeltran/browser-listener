import { redactDeep, redactSensitiveString } from "../redaction/engine.js";
import {
  buildPopupStateSnapshot,
  emptyPopupStateSnapshot,
  POPUP_STATE_KEY,
  popupStateFromSnapshot,
} from "./popup-state.js";
import {
  AUXILIARY_STORAGE_LIMITS,
  emptyTruncation,
  estimateNetworkEntryBytes,
  totalNetworkBytes,
  pushWithCap,
} from "./limits.js";
import {
  clearNetworkEntries,
  countNetworkEntries,
  deleteNetworkDatabase,
  listNetworkEntries,
  putNetworkEntries,
  upsertNetworkEntry as idbUpsertNetworkEntry,
} from "./network-store.js";
import {
  DEFAULT_REDACTION_ENABLED,
  REDACTION_PREFERENCE_KEY,
  REDACTION_CONFIG_KEY,
  applyRedactionConfig,
  loadRedactionConfig,
} from "./preferences.js";
import type {
  CaptureSession,
  ConsoleEntry,
  MarkerEntry,
  NavigationEntry,
  NetworkEntry,
  PopupCounts,
  PopupStateSnapshot,
  SessionData,
  StorageTruncation,
} from "../shared/types.js";
import {
  captureProfileDefaults,
  inferCaptureProfile,
  normalizeCaptureProfile,
} from "../shared/types.js";
import type { PopupStateResponse } from "../shared/messages.js";
import { normalizeOriginAllowlist } from "../shared/urls.js";

const STORAGE_KEY = "browserListenerSessionData";
const ACTIVE_FLAG = "browserListenerActiveSessionId";
const EVIDENCE_KEY = "browserListenerEvidence";
const POPUP_DEBOUNCE_MS = 1500;

interface PersistedSessionMeta {
  session: CaptureSession | null;
}

interface PersistedEvidence {
  navigation: NavigationEntry[];
  console: ConsoleEntry[];
  markers: MarkerEntry[];
}

type PersistedEvidenceMap = Record<string, PersistedEvidence>;

interface SessionCaptureStats {
  count: number;
  bytes: number;
}

const captureStats = new Map<string, SessionCaptureStats>();
const evidenceQueues = new Map<string, Promise<void>>();
let popupDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let pendingPopup: PopupCounts | null = null;

export function emptySessionData(): SessionData {
  return { session: null, network: [], navigation: [], console: [], markers: [] };
}

function isLegacySessionData(value: unknown): value is SessionData {
  return (
    typeof value === "object" &&
    value !== null &&
    "network" in value &&
    Array.isArray((value as SessionData).network)
  );
}

function normalizeHealth(session: CaptureSession): CaptureSession["health"] {
  const h = session.health ?? ({} as CaptureSession["health"]);
  return {
    debuggerAttached: h.debuggerAttached ?? false,
    debuggerEverAttached: h.debuggerEverAttached ?? false,
    debuggerDetachCount: h.debuggerDetachCount ?? 0,
    lastDetachAt: h.lastDetachAt,
    lastRecoverAt: h.lastRecoverAt,
    serviceWorkerRestarts: h.serviceWorkerRestarts ?? 0,
    partialGaps: h.partialGaps ?? [],
    persistenceErrors: h.persistenceErrors ?? [],
    lastAttachError: h.lastAttachError,
    truncation: { ...emptyTruncation(), ...(h.truncation ?? {}) },
    bodyBytesStored: h.bodyBytesStored,
    bodiesSkippedSessionCap: h.bodiesSkippedSessionCap,
    bodiesPerResponseTruncated: h.bodiesPerResponseTruncated,
    filteredNetworkRequests: h.filteredNetworkRequests,
  };
}

function normalizeSession(session: CaptureSession | null): CaptureSession | null {
  if (!session) return null;
  let allowedOrigins: string[] | undefined;
  try {
    allowedOrigins = normalizeOriginAllowlist(session.options?.allowedOrigins);
  } catch {
    allowedOrigins = [];
  }
  const profile = normalizeCaptureProfile(inferCaptureProfile(session.options));
  const profileDefaults = captureProfileDefaults(profile);
  const hasExplicitProfile = session.options?.profile != null;
  return {
    ...session,
    options: {
      ...profileDefaults,
      ...session.options,
      profile,
      captureBodies: hasExplicitProfile ? profileDefaults.captureBodies : session.options?.captureBodies ?? profileDefaults.captureBodies,
      captureConsole: hasExplicitProfile ? profileDefaults.captureConsole : session.options?.captureConsole ?? profileDefaults.captureConsole,
      redactionEnabled: session.options?.redactionEnabled ?? DEFAULT_REDACTION_ENABLED,
      ...(allowedOrigins == null ? {} : { allowedOrigins }),
    },
    health: normalizeHealth(session),
  };
}

function normalizeEvidence(value: unknown): PersistedEvidence {
  const evidence = value as Partial<PersistedEvidence> | undefined;
  return {
    navigation: Array.isArray(evidence?.navigation) ? evidence.navigation : [],
    console: Array.isArray(evidence?.console) ? evidence.console : [],
    markers: Array.isArray(evidence?.markers) ? evidence.markers : [],
  };
}

function normalizeSessionData(data: Partial<SessionData>): SessionData {
  return {
    session: normalizeSession(data.session ?? null),
    network: Array.isArray(data.network) ? data.network : [],
    navigation: Array.isArray(data.navigation) ? data.navigation : [],
    console: Array.isArray(data.console) ? data.console : [],
    markers: Array.isArray(data.markers) ? data.markers : [],
  };
}

function shouldRedact(session: CaptureSession | null): boolean {
  return session?.options?.redactionEnabled !== false;
}

async function readPersistedMeta(): Promise<PersistedSessionMeta> {
  await loadRedactionConfig();
  const raw = await chrome.storage.local.get([STORAGE_KEY, ACTIVE_FLAG]);
  const persisted = raw[STORAGE_KEY] as PersistedSessionMeta | SessionData | undefined;
  const activeId = (raw[ACTIVE_FLAG] as string | null) ?? null;

  let session = normalizeSession(
    isLegacySessionData(persisted) ? persisted.session : (persisted?.session ?? null),
  );

  if (session) {
    session = {
      ...session,
      active: Boolean(activeId && session.id === activeId),
    };
  }

  if (isLegacySessionData(persisted) && session?.id && persisted.network.length > 0) {
    const network = session.options.redactionEnabled === false
      ? persisted.network
      : persisted.network.map((entry) => redactDeep(entry));
    const result = await putNetworkEntries(session.id, network, totalNetworkBytes(network));
    if (result.truncated > 0 && session) {
      session = bumpTruncation(session, { network: result.truncated });
    }
    await writePersistedMeta({ session });
  }

  return { session };
}

/** Session metadata only — does not load network entries from IndexedDB. */
export async function readSessionMeta(): Promise<CaptureSession | null> {
  const meta = await readPersistedMeta();
  return meta.session;
}

async function writePersistedMeta(meta: PersistedSessionMeta): Promise<void> {
  const session = meta.session ? { ...meta.session, health: normalizeHealth(meta.session) } : null;
  await chrome.storage.local.set({
    [STORAGE_KEY]: {
      session:
        session && session.options?.redactionEnabled !== false
          ? redactDeep(session)
          : session,
    },
  });
}

async function readEvidence(sessionId: string): Promise<PersistedEvidence> {
  const raw = await chrome.storage.local.get(EVIDENCE_KEY);
  const map = (raw[EVIDENCE_KEY] as PersistedEvidenceMap | undefined) ?? {};
  return normalizeEvidence(map[sessionId]);
}

async function writeEvidence(
  sessionId: string,
  evidence: PersistedEvidence,
  redact = true,
): Promise<void> {
  const raw = await chrome.storage.local.get(EVIDENCE_KEY);
  const map = (raw[EVIDENCE_KEY] as PersistedEvidenceMap | undefined) ?? {};
  map[sessionId] = {
    navigation: evidence.navigation.map((entry) => {
      if (!redact) return entry;
      const safe = redactDeep(entry);
      return {
        ...safe,
        title: safe.title ? redactSensitiveString(safe.title) : undefined,
      };
    }),
    console: evidence.console.map((entry) => {
      if (!redact) return entry;
      const safe = redactDeep(entry);
      return {
        ...safe,
        text: redactSensitiveString(safe.text),
        stackTrace: safe.stackTrace ? redactSensitiveString(safe.stackTrace) : undefined,
        args: safe.args?.map((arg) => redactSensitiveString(arg)),
      };
    }),
    markers: evidence.markers.map((entry) => {
      if (!redact) return entry;
      const safe = redactDeep(entry);
      return {
        ...safe,
        note: safe.note ? redactSensitiveString(safe.note) : undefined,
      };
    }),
  };
  await chrome.storage.local.set({ [EVIDENCE_KEY]: map });
}

async function readCounts(session: CaptureSession | null): Promise<PopupCounts> {
  if (!session?.id) return { network: 0, navigation: 0, console: 0, markers: 0 };
  const evidence = await readEvidence(session.id);
  return {
    network: await countNetworkEntries(session.id),
    navigation: evidence.navigation.length,
    console: evidence.console.length,
    markers: evidence.markers.length,
  };
}

async function writePopupSnapshot(session: CaptureSession | null, counts: PopupCounts): Promise<void> {
  const snapshot = buildPopupStateSnapshot(session, counts);
  await chrome.storage.local.set({ [POPUP_STATE_KEY]: snapshot });
}

export async function flushPopupSnapshot(): Promise<void> {
  if (popupDebounceTimer) {
    clearTimeout(popupDebounceTimer);
    popupDebounceTimer = null;
  }
  if (!pendingPopup) return;
  const counts = pendingPopup;
  pendingPopup = null;
  const meta = await readPersistedMeta();
  await writePopupSnapshot(meta.session, counts);
}

function cancelPopupDebounce(): void {
  if (popupDebounceTimer) {
    clearTimeout(popupDebounceTimer);
    popupDebounceTimer = null;
  }
  pendingPopup = null;
}

function schedulePopupSnapshot(counts: PopupCounts): void {
  pendingPopup = counts;
  if (popupDebounceTimer) clearTimeout(popupDebounceTimer);
  popupDebounceTimer = setTimeout(() => {
    popupDebounceTimer = null;
    const pending = pendingPopup;
    pendingPopup = null;
    if (!pending) return;
    void (async () => {
      const meta = await readPersistedMeta();
      await writePopupSnapshot(meta.session, pending);
    })();
  }, POPUP_DEBOUNCE_MS);
}

async function updatePopupSnapshot(
  session: CaptureSession,
  counts: PopupCounts,
  opts: { debounce: boolean },
): Promise<void> {
  if (opts.debounce) {
    schedulePopupSnapshot(counts);
    return;
  }
  cancelPopupDebounce();
  await writePopupSnapshot(session, counts);
}

function resetCaptureStats(sessionId?: string): void {
  if (sessionId) captureStats.delete(sessionId);
  else captureStats.clear();
}

async function loadCaptureStats(sessionId: string): Promise<SessionCaptureStats> {
  const cached = captureStats.get(sessionId);
  if (cached) return cached;

  const count = await countNetworkEntries(sessionId);
  const entries = count > 0 ? await listNetworkEntries(sessionId) : [];
  const stats = { count, bytes: totalNetworkBytes(entries) };
  captureStats.set(sessionId, stats);
  return stats;
}

function applyEntryStats(
  sessionId: string,
  entry: NetworkEntry,
  previous: NetworkEntry | null,
  isNew: boolean,
): SessionCaptureStats {
  const stats = captureStats.get(sessionId) ?? { count: 0, bytes: 0 };
  const nextBytes = estimateNetworkEntryBytes(entry);
  if (isNew) {
    stats.count += 1;
    stats.bytes += nextBytes;
  } else if (previous) {
    stats.bytes += nextBytes - estimateNetworkEntryBytes(previous);
  }
  captureStats.set(sessionId, stats);
  return stats;
}

function applyEvictedEntries(sessionId: string, evicted: NetworkEntry[]): void {
  if (!evicted.length) return;
  const stats = captureStats.get(sessionId) ?? { count: 0, bytes: 0 };
  for (const entry of evicted) {
    stats.count = Math.max(0, stats.count - 1);
    stats.bytes = Math.max(0, stats.bytes - estimateNetworkEntryBytes(entry));
  }
  captureStats.set(sessionId, stats);
}

function bumpTruncation(
  session: CaptureSession,
  increments: Partial<StorageTruncation>,
): CaptureSession {
  const truncation = { ...emptyTruncation(), ...(session.health.truncation ?? {}) };
  for (const key of Object.keys(increments) as (keyof StorageTruncation)[]) {
    truncation[key] = (truncation[key] ?? 0) + (increments[key] ?? 0);
  }
  return { ...session, health: { ...session.health, truncation } };
}

async function loadNetworkForSession(session: CaptureSession | null): Promise<NetworkEntry[]> {
  if (!session?.id) return [];
  return listNetworkEntries(session.id);
}

export async function readSessionData(): Promise<SessionData> {
  const meta = await readPersistedMeta();
  const network = await loadNetworkForSession(meta.session);
  const evidence = meta.session?.id ? await readEvidence(meta.session.id) : normalizeEvidence(null);
  return normalizeSessionData({
    session: meta.session,
    network,
    navigation: evidence.navigation,
    console: evidence.console,
    markers: evidence.markers,
  });
}

export async function writeSessionData(data: SessionData): Promise<SessionData> {
  const normalized = normalizeSessionData(data);
  const session = normalized.session;
  const redact = shouldRedact(session);
  let truncated = 0;
  const navigation = normalized.navigation.slice(-AUXILIARY_STORAGE_LIMITS.navigationEntries);
  const consoleEntries = normalized.console.slice(-AUXILIARY_STORAGE_LIMITS.consoleEntries);
  const markers = (normalized.markers ?? []).slice(-AUXILIARY_STORAGE_LIMITS.markerEntries);
  const navigationTruncated = normalized.navigation.length - navigation.length;
  const consoleTruncated = normalized.console.length - consoleEntries.length;
  const markersTruncated = (normalized.markers?.length ?? 0) - markers.length;

  if (session?.id && normalized.network.length > 0) {
    const stats = await loadCaptureStats(session.id);
    const storedNetwork = redact
      ? normalized.network.map((entry) => redactDeep(entry))
      : normalized.network;
    const result = await putNetworkEntries(session.id, storedNetwork, stats.bytes);
    truncated = result.truncated;
    applyEvictedEntries(session.id, result.evicted);
  }

  if (session?.id) {
    await writeEvidence(session.id, { navigation, console: consoleEntries, markers }, redact);
  }

  const sessionToStore =
    session && (truncated > 0 || navigationTruncated > 0 || consoleTruncated > 0 || markersTruncated > 0)
      ? bumpTruncation(session, {
          network: truncated,
          navigation: navigationTruncated,
          console: consoleTruncated,
          markers: markersTruncated,
        })
      : session;
  const activeId = sessionToStore?.active ? sessionToStore.id : null;
  await writePersistedMeta({ session: sessionToStore });
  await chrome.storage.local.set({ [ACTIVE_FLAG]: activeId });

  if (sessionToStore?.id) {
    const entries = await listNetworkEntries(sessionToStore.id);
    const stats = {
      count: entries.length,
      bytes: totalNetworkBytes(entries),
    };
    const networkCount = stats.count;
    captureStats.set(sessionToStore.id, stats);
    await flushPopupSnapshot();
    await writePopupSnapshot(sessionToStore, {
      network: networkCount,
      navigation: navigation.length,
      console: consoleEntries.length,
      markers: markers.length,
    });
  } else {
    await flushPopupSnapshot();
  }

  const network = sessionToStore?.id ? await listNetworkEntries(sessionToStore.id) : [];
  return normalizeSessionData({
    session: sessionToStore,
    network,
    navigation,
    console: consoleEntries,
    markers,
  });
}

/** Rebuild popup snapshot from full session (e.g. after extension update). */
export async function syncPopupStateSnapshot(): Promise<void> {
  const data = await readSessionData();
  await writePopupSnapshot(data.session, {
    network: data.network.length,
    navigation: data.navigation.length,
    console: data.console.length,
    markers: data.markers?.length ?? 0,
  });
}

export async function readPopupStateSnapshot(): Promise<PopupStateSnapshot> {
  const raw = await chrome.storage.local.get(POPUP_STATE_KEY);
  return (raw[POPUP_STATE_KEY] as PopupStateSnapshot | undefined) ?? emptyPopupStateSnapshot();
}

/** Reconcile popup snapshot with session meta + active flag without loading network bodies. */
export async function readPopupStateForUi(): Promise<PopupStateResponse> {
  const snapshot = await readPopupStateSnapshot();
  const raw = await chrome.storage.local.get([
    STORAGE_KEY,
    ACTIVE_FLAG,
    REDACTION_PREFERENCE_KEY,
    REDACTION_CONFIG_KEY,
  ]);
  const persisted = raw[STORAGE_KEY] as PersistedSessionMeta | SessionData | undefined;
  const activeId = (raw[ACTIVE_FLAG] as string | null) ?? null;
  const storedRedaction = raw[REDACTION_PREFERENCE_KEY];
  const redactionEnabled =
    storedRedaction == null ? DEFAULT_REDACTION_ENABLED : storedRedaction !== false;
  const redactionConfig = applyRedactionConfig(raw[REDACTION_CONFIG_KEY]);

  let session = normalizeSession(
    isLegacySessionData(persisted) ? persisted.session : (persisted?.session ?? null),
  );
  if (session) {
    session = { ...session, active: Boolean(activeId && session.id === activeId) };
  }

  if (!session) return { ...popupStateFromSnapshot(snapshot, redactionEnabled), redactionConfig };

  const snapshotActive = snapshot.session?.active ?? false;
  const snapshotId = snapshot.session?.id;
  if (session.active !== snapshotActive || session.id !== snapshotId) {
    return {
      ...popupStateFromSnapshot(buildPopupStateSnapshot(session, snapshot.counts), redactionEnabled),
      redactionConfig,
    };
  }

  if (popupHealthStale(snapshot, session)) {
    return {
      ...popupStateFromSnapshot(buildPopupStateSnapshot(session, snapshot.counts), redactionEnabled),
      redactionConfig,
    };
  }

  return { ...popupStateFromSnapshot(snapshot, redactionEnabled), redactionConfig };
}

export async function getActiveSessionId(): Promise<string | null> {
  const raw = await chrome.storage.local.get(ACTIVE_FLAG);
  return (raw[ACTIVE_FLAG] as string | null) ?? null;
}

function healthAffectsPopup(prev: CaptureSession | null, next: CaptureSession | null): boolean {
  if (!prev?.health || !next?.health) return true;
  const p = prev.health;
  const n = next.health;
  return (
    p.debuggerAttached !== n.debuggerAttached ||
    p.debuggerEverAttached !== n.debuggerEverAttached ||
    p.lastAttachError !== n.lastAttachError ||
    p.partialGaps.length !== n.partialGaps.length
  );
}

function popupHealthStale(snapshot: PopupStateSnapshot, session: CaptureSession): boolean {
  const sh = snapshot.session?.health;
  if (!snapshot.session || snapshot.session.id !== session.id) return false;
  const mh = session.health;
  return (
    (sh?.debuggerAttached ?? false) !== (mh.debuggerAttached ?? false) ||
    (sh?.debuggerEverAttached ?? false) !== (mh.debuggerEverAttached ?? false) ||
    (sh?.lastAttachError ?? undefined) !== (mh.lastAttachError ?? undefined) ||
    (sh?.partialGaps?.length ?? 0) !== (mh.partialGaps?.length ?? 0)
  );
}

function bumpHealth(
  session: CaptureSession,
  patch: Partial<CaptureSession["health"]>,
): CaptureSession {
  return { ...session, health: { ...session.health, ...patch } };
}

/** Patch session metadata without loading network entries from IndexedDB. */
export async function patchSession(
  fn: (session: CaptureSession | null) => CaptureSession | null,
): Promise<CaptureSession | null> {
  const meta = await readPersistedMeta();
  const next = normalizeSession(fn(meta.session));
  if (next === meta.session && !next) return next;

  await writePersistedMeta({ session: next });
  const activeId = next?.active ? next.id : null;
  await chrome.storage.local.set({ [ACTIVE_FLAG]: activeId });

  if (next?.active) {
    const counts = await readCounts(next);
    const debounce = Boolean(
      meta.session?.active &&
        meta.session.id === next.id &&
        !healthAffectsPopup(meta.session, next),
    );
    await updatePopupSnapshot(next, counts, { debounce });
  } else if (next) {
    cancelPopupDebounce();
    await writePopupSnapshot(next, await readCounts(next));
  } else {
    cancelPopupDebounce();
  }

  return next;
}

export async function withSession(
  fn: (data: SessionData) => SessionData | Promise<SessionData>,
): Promise<SessionData> {
  const data = await readSessionData();
  const next = normalizeSessionData(await fn(data));

  if (next.session !== data.session || next.session) {
    await writePersistedMeta({ session: next.session });
    const activeId = next.session?.active ? next.session.id : null;
    await chrome.storage.local.set({ [ACTIVE_FLAG]: activeId });
  }

  const counts = next.session ? await readCounts(next.session) : { network: 0, navigation: 0, console: 0 };
  if (next.session?.active) {
    const debounce = Boolean(
      data.session?.active &&
        data.session.id === next.session.id &&
        !healthAffectsPopup(data.session, next.session),
    );
    await updatePopupSnapshot(next.session, counts, { debounce });
  } else if (next.session) {
    cancelPopupDebounce();
    await writePopupSnapshot(next.session, counts);
  }

  return { ...next, network: await loadNetworkForSession(next.session) };
}

export async function setSession(session: CaptureSession | null): Promise<void> {
  await withSession((data) => ({ ...data, session }));
}

export async function upsertNetwork(entry: NetworkEntry): Promise<void> {
  const meta = await readPersistedMeta();
  if (!meta.session?.active) return;

  const stored = shouldRedact(meta.session) ? redactDeep(entry) : entry;
  const stats = await loadCaptureStats(meta.session.id);
  const result = await idbUpsertNetworkEntry(meta.session.id, stored, stats.bytes);
  const nextStats = applyEntryStats(meta.session.id, stored, result.previous, result.isNew);
  applyEvictedEntries(meta.session.id, result.evicted);

  let session = meta.session;
  if (result.truncated > 0) {
    session = bumpTruncation(session, { network: result.truncated });
    await writePersistedMeta({ session });
  }

  const evidence = await readEvidence(session.id);
  schedulePopupSnapshot({
    network: nextStats.count,
    navigation: evidence.navigation.length,
    console: evidence.console.length,
    markers: evidence.markers.length,
  });
}

async function appendBoundedEvidenceNow(
  kind: "navigation" | "console" | "markers",
  entry: NavigationEntry | ConsoleEntry | MarkerEntry,
): Promise<void> {
  const meta = await readPersistedMeta();
  if (!meta.session?.active || meta.session.paused || meta.session.id !== entry.sessionId) return;

  const evidence = await readEvidence(entry.sessionId);
  const truncation = emptyTruncation();
  const redact = shouldRedact(meta.session);
  const safeEntry = (redact ? redactDeep(entry) : entry) as NavigationEntry | ConsoleEntry | MarkerEntry;
  if (redact && kind === "console") {
    const consoleEntry = safeEntry as ConsoleEntry;
    consoleEntry.text = redactSensitiveString(consoleEntry.text);
    consoleEntry.stackTrace = consoleEntry.stackTrace
      ? redactSensitiveString(consoleEntry.stackTrace)
      : undefined;
    consoleEntry.args = consoleEntry.args?.map((arg) => redactSensitiveString(arg));
  }
  if (kind === "navigation") {
    pushWithCap(
      evidence.navigation,
      safeEntry as NavigationEntry,
      AUXILIARY_STORAGE_LIMITS.navigationEntries,
      truncation,
      "navigation",
    );
  } else if (kind === "console") {
    pushWithCap(
      evidence.console,
      safeEntry as ConsoleEntry,
      AUXILIARY_STORAGE_LIMITS.consoleEntries,
      truncation,
      "console",
    );
  } else {
    pushWithCap(
      evidence.markers,
      safeEntry as MarkerEntry,
      AUXILIARY_STORAGE_LIMITS.markerEntries,
      truncation,
      "markers",
    );
  }

  await writeEvidence(entry.sessionId, evidence, redact);
  const truncated = truncation[kind] ?? 0;
  if (truncated > 0) {
    await patchSession((session) =>
      session ? bumpTruncation(session, { [kind]: truncated }) : session,
    );
  } else {
    const stats = await loadCaptureStats(entry.sessionId);
    schedulePopupSnapshot({
      network: stats.count,
      navigation: evidence.navigation.length,
      console: evidence.console.length,
      markers: evidence.markers.length,
    });
  }
}

function appendBoundedEvidence(
  kind: "navigation" | "console" | "markers",
  entry: NavigationEntry | ConsoleEntry | MarkerEntry,
): Promise<void> {
  const previous = evidenceQueues.get(entry.sessionId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(() => appendBoundedEvidenceNow(kind, entry));
  evidenceQueues.set(entry.sessionId, next);
  void next.then(
    () => {
      if (evidenceQueues.get(entry.sessionId) === next) evidenceQueues.delete(entry.sessionId);
    },
    () => {
      if (evidenceQueues.get(entry.sessionId) === next) evidenceQueues.delete(entry.sessionId);
    },
  );
  return next;
}

export async function appendNavigation(entry: NavigationEntry): Promise<void> {
  await appendBoundedEvidence("navigation", entry);
}

export async function appendConsole(entry: ConsoleEntry): Promise<void> {
  await appendBoundedEvidence("console", entry);
}

export async function appendMarker(entry: MarkerEntry): Promise<void> {
  await appendBoundedEvidence("markers", entry);
}

export async function recordHealthGap(reason: string): Promise<void> {
  await patchSession((session) => {
    if (!session) return session;
    return bumpHealth(session, {
      partialGaps: [...session.health.partialGaps, { at: Date.now(), reason }],
    });
  });
}

export async function clearSessionData(): Promise<void> {
  const meta = await readPersistedMeta();
  if (meta.session?.id) {
    await clearNetworkEntries(meta.session.id);
    resetCaptureStats(meta.session.id);
  } else {
    resetCaptureStats();
  }
  await flushPopupSnapshot();
  await chrome.storage.local.remove([STORAGE_KEY, ACTIVE_FLAG, EVIDENCE_KEY, POPUP_STATE_KEY]);
}

/** Test helper — wipe IndexedDB network store between tests. */
export async function resetNetworkStoreForTests(): Promise<void> {
  await deleteNetworkDatabase();
  resetCaptureStats();
  evidenceQueues.clear();
}
