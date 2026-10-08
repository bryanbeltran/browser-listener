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
  readRetentionPolicy,
  setRetentionPolicy as persistRetentionPolicy,
} from "./preferences.js";
import type {
  BrowserContextSnapshot,
  CaptureSession,
  ConsoleEntry,
  MarkerEntry,
  NavigationEntry,
  NetworkEntry,
  PerformanceSignal,
  PopupCounts,
  PopupStateSnapshot,
  SessionData,
  SessionHistoryEntry,
  DeletionPhase,
  DeletionReceipt,
  RetentionPolicy,
  StorageTruncation,
} from "../shared/types.js";
import {
  captureProfileDefaults,
  inferCaptureProfile,
  normalizeCaptureBudgets,
  normalizeCaptureProfile,
  policyEpochFromOptions,
} from "../shared/types.js";
import type { PopupStateResponse } from "../shared/messages.js";
import { normalizeOriginAllowlist } from "../shared/urls.js";
import { buildCapabilityMatrix } from "../capture/capabilities.js";

const STORAGE_KEY = "browserListenerSessionData";
const ACTIVE_FLAG = "browserListenerActiveSessionId";
const EVIDENCE_KEY = "browserListenerEvidence";
const HISTORY_KEY = "browserListenerSessionHistory";
const DELETION_RECEIPTS_KEY = "browserListenerDeletionReceipts";
const POPUP_DEBOUNCE_MS = 1500;
const MAX_DELETION_RECEIPTS = 20;

interface PersistedSessionMeta {
  session: CaptureSession | null;
}

interface PersistedEvidence {
  navigation: NavigationEntry[];
  console: ConsoleEntry[];
  markers: MarkerEntry[];
  contextSnapshots: BrowserContextSnapshot[];
  performanceSignals: PerformanceSignal[];
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
  return {
    session: null,
    network: [],
    navigation: [],
    console: [],
    markers: [],
    contextSnapshots: [],
    performanceSignals: [],
  };
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
    fairBudgetEvictions: h.fairBudgetEvictions,
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
  const options = {
    ...profileDefaults,
    ...session.options,
    profile,
    captureBodies: hasExplicitProfile ? profileDefaults.captureBodies : session.options?.captureBodies ?? profileDefaults.captureBodies,
    captureConsole: hasExplicitProfile ? profileDefaults.captureConsole : session.options?.captureConsole ?? profileDefaults.captureConsole,
    redactionEnabled: session.options?.redactionEnabled ?? DEFAULT_REDACTION_ENABLED,
    budgets: normalizeCaptureBudgets(session.options?.budgets),
    ...(allowedOrigins == null ? {} : { allowedOrigins }),
  };
  const policyEpochs = session.policyEpochs?.length
    ? session.policyEpochs.map((epoch) => ({
        ...epoch,
        allowedOrigins: [...(epoch.allowedOrigins ?? [])],
        budgets: normalizeCaptureBudgets(epoch.budgets),
      }))
    : [policyEpochFromOptions(options, `legacy-${session.id}`, session.startedAt, session.stoppedAt)];
  return {
    ...session,
    options,
    health: normalizeHealth(session),
    policyEpochs,
    capabilities: session.capabilities ?? buildCapabilityMatrix(),
  };
}

function normalizeEvidence(value: unknown): PersistedEvidence {
  const evidence = value as Partial<PersistedEvidence> | undefined;
  return {
    navigation: Array.isArray(evidence?.navigation) ? evidence.navigation : [],
    console: Array.isArray(evidence?.console) ? evidence.console : [],
    markers: Array.isArray(evidence?.markers) ? evidence.markers : [],
    contextSnapshots: Array.isArray(evidence?.contextSnapshots) ? evidence.contextSnapshots : [],
    performanceSignals: Array.isArray(evidence?.performanceSignals) ? evidence.performanceSignals : [],
  };
}

function normalizeSessionData(data: Partial<SessionData>): SessionData {
  return {
    session: normalizeSession(data.session ?? null),
    network: Array.isArray(data.network) ? data.network : [],
    navigation: Array.isArray(data.navigation) ? data.navigation : [],
    console: Array.isArray(data.console) ? data.console : [],
    markers: Array.isArray(data.markers) ? data.markers : [],
    contextSnapshots: Array.isArray(data.contextSnapshots) ? data.contextSnapshots : [],
    performanceSignals: Array.isArray(data.performanceSignals) ? data.performanceSignals : [],
  };
}

function nonnegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function normalizeHistoryEntry(value: unknown): SessionHistoryEntry | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<SessionHistoryEntry>;
  if (typeof candidate.id !== "string" || !candidate.id) return null;
  const counts = candidate.counts ?? ({} as SessionHistoryEntry["counts"]);
  return {
    schemaVersion: 1,
    id: candidate.id,
    ...(typeof candidate.name === "string" && candidate.name ? { name: candidate.name.slice(0, 120) } : {}),
    startedAt: nonnegativeInteger(candidate.startedAt),
    ...(typeof candidate.stoppedAt === "number" ? { stoppedAt: candidate.stoppedAt } : {}),
    archivedAt: nonnegativeInteger(candidate.archivedAt),
    bytes: nonnegativeInteger(candidate.bytes),
    counts: {
      network: nonnegativeInteger(counts.network),
      navigation: nonnegativeInteger(counts.navigation),
      console: nonnegativeInteger(counts.console),
      markers: nonnegativeInteger(counts.markers),
      requestBodies: nonnegativeInteger(counts.requestBodies),
      responseBodies: nonnegativeInteger(counts.responseBodies),
    },
    partial: candidate.partial === true,
    redactionEnabled: candidate.redactionEnabled !== false,
    policyEpochCount: Math.max(1, nonnegativeInteger(candidate.policyEpochCount)),
  };
}

async function readHistoryStorage(): Promise<SessionHistoryEntry[]> {
  const raw = await chrome.storage.local.get(HISTORY_KEY);
  const values = Array.isArray(raw[HISTORY_KEY]) ? raw[HISTORY_KEY] as unknown[] : [];
  return values
    .map(normalizeHistoryEntry)
    .filter((entry): entry is SessionHistoryEntry => entry != null)
    .sort((left, right) => right.archivedAt - left.archivedAt || left.id.localeCompare(right.id));
}

async function writeHistoryStorage(entries: SessionHistoryEntry[]): Promise<void> {
  await chrome.storage.local.set({
    [HISTORY_KEY]: entries.map((entry) => entry.redactionEnabled && entry.name
      ? { ...entry, name: redactSensitiveString(entry.name) }
      : entry),
  });
}

async function readDeletionReceipts(): Promise<DeletionReceipt[]> {
  const raw = await chrome.storage.local.get(DELETION_RECEIPTS_KEY);
  const values = Array.isArray(raw[DELETION_RECEIPTS_KEY]) ? raw[DELETION_RECEIPTS_KEY] as unknown[] : [];
  return values.filter((value): value is DeletionReceipt => Boolean(value && typeof value === "object" && typeof (value as DeletionReceipt).id === "string"));
}

async function writeDeletionReceipt(receipt: DeletionReceipt): Promise<void> {
  const receipts = (await readDeletionReceipts()).filter((candidate) => candidate.id !== receipt.id);
  receipts.unshift(receipt);
  await chrome.storage.local.set({
    [DELETION_RECEIPTS_KEY]: receipts.slice(0, MAX_DELETION_RECEIPTS),
  });
}

function evidenceByteEstimate(data: SessionData): number {
  const evidence = {
    navigation: data.navigation,
    console: data.console,
    markers: data.markers ?? [],
    contextSnapshots: data.contextSnapshots ?? [],
    performanceSignals: data.performanceSignals ?? [],
  };
  return new TextEncoder().encode(JSON.stringify(evidence)).byteLength;
}

function historyEntryFromData(data: SessionData, archivedAt = Date.now()): SessionHistoryEntry | null {
  const session = data.session;
  if (!session) return null;
  const truncation = session.health.truncation;
  const partial = Boolean(
    session.tabClosedDuringCapture ||
      session.health.partialGaps.length > 0 ||
      session.health.persistenceErrors.length > 0 ||
      (session.health.fairBudgetEvictions ?? 0) > 0 ||
      truncation.network > 0 ||
      truncation.navigation > 0 ||
      truncation.console > 0 ||
      (truncation.markers ?? 0) > 0,
  );
  return {
    schemaVersion: 1,
    id: session.id,
    ...(session.name || session.options.sessionName ? { name: (session.name ?? session.options.sessionName)?.slice(0, 120) } : {}),
    startedAt: session.startedAt,
    ...(session.stoppedAt == null ? {} : { stoppedAt: session.stoppedAt }),
    archivedAt,
    bytes: totalNetworkBytes(data.network) + evidenceByteEstimate(data),
    counts: {
      network: data.network.length,
      navigation: data.navigation.length,
      console: data.console.length,
      markers: data.markers?.length ?? 0,
      requestBodies: data.network.filter((entry) => entry.requestBody != null).length,
      responseBodies: data.network.filter((entry) => entry.responseBody != null).length,
    },
    partial,
    redactionEnabled: session.options.redactionEnabled !== false,
    policyEpochCount: session.policyEpochs?.length ?? 1,
  };
}

async function deleteEvidenceForSession(sessionId: string): Promise<void> {
  const raw = await chrome.storage.local.get(EVIDENCE_KEY);
  const map = (raw[EVIDENCE_KEY] as PersistedEvidenceMap | undefined) ?? {};
  if (!(sessionId in map)) return;
  delete map[sessionId];
  if (Object.keys(map).length) await chrome.storage.local.set({ [EVIDENCE_KEY]: map });
  else await chrome.storage.local.remove(EVIDENCE_KEY);
}

async function deleteSessionArtifacts(sessionId: string): Promise<void> {
  await clearNetworkEntries(sessionId);
  resetCaptureStats(sessionId);
  await deleteEvidenceForSession(sessionId);
}

async function applyRetentionPolicyInternal(currentSessionId?: string): Promise<SessionHistoryEntry[]> {
  const policy = await readRetentionPolicy();
  const entries = await readHistoryStorage();
  const now = Date.now();
  const eligible = entries.filter((entry) => entry.id !== currentSessionId);
  const expired = new Set(eligible
    .filter((entry) => entry.id !== currentSessionId && now - entry.archivedAt > policy.maxAgeMs)
    .map((entry) => entry.id));
  const orderedCandidates = [...eligible]
    .sort((left, right) => left.archivedAt - right.archivedAt || left.id.localeCompare(right.id));
  const remove = new Set(expired);
  let keptCount = entries.length - remove.size;
  for (const entry of orderedCandidates) {
    if (keptCount <= policy.maxSessions) break;
    if (remove.has(entry.id)) continue;
    remove.add(entry.id);
    keptCount -= 1;
  }
  let bytes = entries.reduce((total, entry) => total + entry.bytes, 0);
  for (const entry of entries) {
    if (remove.has(entry.id)) bytes = Math.max(0, bytes - entry.bytes);
  }
  for (const entry of orderedCandidates) {
    if (bytes <= policy.maxBytes) break;
    if (remove.has(entry.id)) continue;
    remove.add(entry.id);
    bytes = Math.max(0, bytes - entry.bytes);
  }
  for (const id of remove) {
    try {
      await deleteSession(id);
    } catch {
      /* The deletion receipt and history entry remain retryable on the next run. */
    }
  }
  return readHistoryStorage();
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

  if (isLegacySessionData(persisted) && session?.id) {
    const redact = session.options.redactionEnabled !== false;
    if (persisted.network.length > 0) {
      const network = redact
        ? persisted.network.map((entry) => redactDeep(entry))
        : persisted.network;
      const result = await putNetworkEntries(session.id, network, totalNetworkBytes(network));
      if (result.truncated > 0 && session) {
        session = bumpTruncation(session, { network: result.truncated });
      }
    }

    const legacyEvidence = normalizeEvidence(persisted);
    const hasLegacyEvidence = Boolean(
      legacyEvidence.navigation.length ||
        legacyEvidence.console.length ||
        legacyEvidence.markers.length ||
        legacyEvidence.contextSnapshots.length ||
        legacyEvidence.performanceSignals.length,
    );
    if (hasLegacyEvidence) {
      const existingEvidence = await readEvidence(session.id);
      await writeEvidence(session.id, {
        navigation: existingEvidence.navigation.length ? existingEvidence.navigation : legacyEvidence.navigation,
        console: existingEvidence.console.length ? existingEvidence.console : legacyEvidence.console,
        markers: existingEvidence.markers.length ? existingEvidence.markers : legacyEvidence.markers,
        contextSnapshots: existingEvidence.contextSnapshots.length ? existingEvidence.contextSnapshots : legacyEvidence.contextSnapshots,
        performanceSignals: existingEvidence.performanceSignals.length ? existingEvidence.performanceSignals : legacyEvidence.performanceSignals,
      }, redact);
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
    contextSnapshots: evidence.contextSnapshots.map((entry) => redact ? redactDeep(entry) : entry),
    performanceSignals: evidence.performanceSignals.map((entry) => redact ? redactDeep(entry) : entry),
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
    contextSnapshots: evidence.contextSnapshots,
    performanceSignals: evidence.performanceSignals,
  });
}

export async function readSessionHistory(): Promise<SessionHistoryEntry[]> {
  return readHistoryStorage();
}

export async function readDeletionReceiptsSnapshot(): Promise<DeletionReceipt[]> {
  return readDeletionReceipts();
}

export async function archiveCurrentSession(): Promise<SessionHistoryEntry | null> {
  const data = await readSessionData();
  if (!data.session || data.session.active) return null;
  const entry = historyEntryFromData(data);
  if (!entry) return null;
  const existing = await readHistoryStorage();
  await writeHistoryStorage([entry, ...existing.filter((candidate) => candidate.id !== entry.id)]);
  await applyRetentionPolicyInternal(entry.id);
  return entry;
}

export async function updateRetentionPolicy(policy: Partial<RetentionPolicy>): Promise<RetentionPolicy> {
  const normalized = await persistRetentionPolicy(policy);
  const current = await readSessionMeta();
  await applyRetentionPolicyInternal(current?.id);
  return normalized;
}

export async function deleteSession(sessionId: string): Promise<DeletionReceipt> {
  const requestedAt = Date.now();
  const phases: DeletionPhase[] = ["network", "evidence", "metadata", "history", "receipt"];
  const existing = (await readDeletionReceipts()).find((receipt) => receipt.sessionId === sessionId);
  if (existing?.state === "complete") return existing;
  const completed = new Set(existing?.completedPhases ?? []);
  const errors: string[] = [];
  const current = await readSessionMeta();
  if (current?.id === sessionId && current.active) {
    const receipt: DeletionReceipt = {
      schemaVersion: 1,
      id: existing?.id ?? crypto.randomUUID(),
      sessionId,
      requestedAt: existing?.requestedAt ?? requestedAt,
      state: "partial",
      completedPhases: [...completed],
      remainingPhases: phases.filter((phase) => !completed.has(phase) && phase !== "receipt"),
      errors: ["active session must be stopped before deletion"],
    };
    await writeDeletionReceipt(receipt);
    return receipt;
  }
  const receiptId = existing?.id ?? crypto.randomUUID();
  const mark = (phase: DeletionPhase): void => {
    completed.add(phase);
  };
  if (!completed.has("network")) {
    try {
      await clearNetworkEntries(sessionId);
      resetCaptureStats(sessionId);
      mark("network");
    } catch (error) {
      errors.push(`network: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!completed.has("evidence")) {
    try {
      await deleteEvidenceForSession(sessionId);
      mark("evidence");
    } catch (error) {
      errors.push(`evidence: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!completed.has("metadata")) {
    try {
      if (current?.id === sessionId) {
        await chrome.storage.local.remove([STORAGE_KEY, ACTIVE_FLAG, POPUP_STATE_KEY]);
        cancelPopupDebounce();
      }
      mark("metadata");
    } catch (error) {
      errors.push(`metadata: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const artifactsDeleted = ["network", "evidence", "metadata"]
    .every((phase) => completed.has(phase as DeletionPhase));
  if (!completed.has("history") && artifactsDeleted) {
    try {
      const entries = await readHistoryStorage();
      await writeHistoryStorage(entries.filter((entry) => entry.id !== sessionId));
      mark("history");
    } catch (error) {
      errors.push(`history: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const remaining = phases.filter((phase) => phase !== "receipt" && !completed.has(phase));
  const receipt: DeletionReceipt = {
    schemaVersion: 1,
    id: receiptId,
    sessionId,
    requestedAt: existing?.requestedAt ?? requestedAt,
    ...(remaining.length ? {} : { completedAt: Date.now() }),
    state: remaining.length || errors.length ? "partial" : "complete",
    completedPhases: [...completed],
    remainingPhases: remaining,
    errors,
  };
  mark("receipt");
  const finalReceipt = { ...receipt, completedPhases: [...completed] };
  await writeDeletionReceipt(finalReceipt);
  return finalReceipt;
}

export async function clearSessionHistory(): Promise<DeletionReceipt[]> {
  const entries = await readHistoryStorage();
  const receipts: DeletionReceipt[] = [];
  for (const entry of entries) receipts.push(await deleteSession(entry.id));
  return receipts;
}

/** Retry incomplete deletion phases after a service-worker restart. */
export async function resumePendingDeletions(): Promise<void> {
  const receipts = await readDeletionReceipts();
  for (const receipt of receipts.filter((candidate) => candidate.state === "partial")) {
    await deleteSession(receipt.sessionId);
  }
}

export async function writeSessionData(data: SessionData): Promise<SessionData> {
  const normalized = normalizeSessionData(data);
  let session = normalized.session;
  const redact = shouldRedact(session);
  let truncated = 0;
  const navigation = normalized.navigation.slice(-AUXILIARY_STORAGE_LIMITS.navigationEntries);
  const consoleEntries = normalized.console.slice(-AUXILIARY_STORAGE_LIMITS.consoleEntries);
  const markers = (normalized.markers ?? []).slice(-AUXILIARY_STORAGE_LIMITS.markerEntries);
  const contextSnapshots = (normalized.contextSnapshots ?? []).slice(-AUXILIARY_STORAGE_LIMITS.contextSnapshots);
  const performanceSignals = (normalized.performanceSignals ?? []).slice(-AUXILIARY_STORAGE_LIMITS.performanceSignals);
  const navigationTruncated = normalized.navigation.length - navigation.length;
  const consoleTruncated = normalized.console.length - consoleEntries.length;
  const markersTruncated = (normalized.markers?.length ?? 0) - markers.length;
  const contextTruncated = (normalized.contextSnapshots?.length ?? 0) - contextSnapshots.length;
  const performanceTruncated = (normalized.performanceSignals?.length ?? 0) - performanceSignals.length;

  if (session?.id && normalized.network.length > 0) {
    const stats = await loadCaptureStats(session.id);
    const storedNetwork = redact
      ? normalized.network.map((entry) => redactDeep(entry))
      : normalized.network;
    const result = await putNetworkEntries(
      session.id,
      storedNetwork,
      stats.bytes,
      normalizeCaptureBudgets(session.options.budgets),
    );
    truncated = result.truncated;
    applyEvictedEntries(session.id, result.evicted);
    if (result.fairBudgetEvicted > 0) {
      session = {
        ...session,
        health: {
          ...session.health,
          fairBudgetEvictions: (session.health.fairBudgetEvictions ?? 0) + result.fairBudgetEvicted,
        },
      };
    }
  }

  if (session?.id) {
    await writeEvidence(session.id, {
      navigation,
      console: consoleEntries,
      markers,
      contextSnapshots,
      performanceSignals,
    }, redact);
  }

  const sessionToStore =
    session && (truncated > 0 || navigationTruncated > 0 || consoleTruncated > 0 || markersTruncated > 0 || contextTruncated > 0 || performanceTruncated > 0)
      ? bumpTruncation(session, {
          network: truncated,
          navigation: navigationTruncated,
          console: consoleTruncated,
          markers: markersTruncated,
          contextSnapshots: contextTruncated,
          performanceSignals: performanceTruncated,
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
    contextSnapshots,
    performanceSignals,
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
  const [history, retentionPolicy, deletionReceipts] = await Promise.all([
    readHistoryStorage(),
    readRetentionPolicy(),
    readDeletionReceipts(),
  ]);
  const decorate = (state: PopupStateResponse): PopupStateResponse => ({
    ...state,
    history,
    retentionPolicy,
    deletionReceipts,
  });

  let session = normalizeSession(
    isLegacySessionData(persisted) ? persisted.session : (persisted?.session ?? null),
  );
  if (session) {
    session = { ...session, active: Boolean(activeId && session.id === activeId) };
  }

  if (!session) return decorate({ ...popupStateFromSnapshot(snapshot, redactionEnabled), redactionConfig });

  const snapshotActive = snapshot.session?.active ?? false;
  const snapshotId = snapshot.session?.id;
  if (session.active !== snapshotActive || session.id !== snapshotId) {
    return decorate({
      ...popupStateFromSnapshot(buildPopupStateSnapshot(session, snapshot.counts), redactionEnabled),
      redactionConfig,
    });
  }

  if (popupHealthStale(snapshot, session)) {
    return decorate({
      ...popupStateFromSnapshot(buildPopupStateSnapshot(session, snapshot.counts), redactionEnabled),
      redactionConfig,
    });
  }

  return decorate({ ...popupStateFromSnapshot(snapshot, redactionEnabled), redactionConfig });
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
  const result = await idbUpsertNetworkEntry(
    meta.session.id,
    stored,
    stats.bytes,
    normalizeCaptureBudgets(meta.session.options.budgets),
  );
  const nextStats = applyEntryStats(meta.session.id, stored, result.previous, result.isNew);
  applyEvictedEntries(meta.session.id, result.evicted);

  let session = meta.session;
  if (result.truncated > 0) {
    session = bumpTruncation(session, { network: result.truncated });
  }
  if (result.fairBudgetEvicted > 0) {
    session = {
      ...session,
      health: {
        ...session.health,
        fairBudgetEvictions: (session.health.fairBudgetEvictions ?? 0) + result.fairBudgetEvicted,
      },
    };
  }
  if (result.truncated > 0 || result.fairBudgetEvicted > 0) await writePersistedMeta({ session });

  const evidence = await readEvidence(session.id);
  schedulePopupSnapshot({
    network: nextStats.count,
    navigation: evidence.navigation.length,
    console: evidence.console.length,
    markers: evidence.markers.length,
  });
}

async function appendBoundedEvidenceNow(
  kind: "navigation" | "console" | "markers" | "contextSnapshots" | "performanceSignals",
  entry: NavigationEntry | ConsoleEntry | MarkerEntry | BrowserContextSnapshot | PerformanceSignal,
): Promise<void> {
  const meta = await readPersistedMeta();
  if (!meta.session?.active || meta.session.paused || meta.session.id !== entry.sessionId) return;

  const evidence = await readEvidence(entry.sessionId);
  const truncation = emptyTruncation();
  const redact = shouldRedact(meta.session);
  const safeEntry = (redact ? redactDeep(entry) : entry) as NavigationEntry | ConsoleEntry | MarkerEntry | BrowserContextSnapshot | PerformanceSignal;
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
    if (kind === "markers") {
      pushWithCap(evidence.markers, safeEntry as MarkerEntry, AUXILIARY_STORAGE_LIMITS.markerEntries, truncation, kind);
    } else if (kind === "contextSnapshots") {
      pushWithCap(evidence.contextSnapshots, safeEntry as BrowserContextSnapshot, AUXILIARY_STORAGE_LIMITS.contextSnapshots, truncation, kind);
    } else {
      pushWithCap(evidence.performanceSignals, safeEntry as PerformanceSignal, AUXILIARY_STORAGE_LIMITS.performanceSignals, truncation, kind);
    }
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
  kind: "navigation" | "console" | "markers" | "contextSnapshots" | "performanceSignals",
  entry: NavigationEntry | ConsoleEntry | MarkerEntry | BrowserContextSnapshot | PerformanceSignal,
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

export async function appendContextSnapshot(entry: BrowserContextSnapshot): Promise<void> {
  await appendBoundedEvidence("contextSnapshots", entry);
}

export async function appendPerformanceSignal(entry: PerformanceSignal): Promise<void> {
  await appendBoundedEvidence("performanceSignals", entry);
}

export async function recordHealthGap(reason: string): Promise<void> {
  await patchSession((session) => {
    if (!session) return session;
    return bumpHealth(session, {
      partialGaps: [...session.health.partialGaps, { at: Date.now(), reason }],
    });
  });
}

export async function clearSessionData(opts: { archive?: boolean; preserveHistory?: boolean } = {}): Promise<void> {
  const meta = await readPersistedMeta();
  if (meta.session?.id) {
    if (opts.archive && !meta.session.active) await archiveCurrentSession();
    if (!opts.preserveHistory) {
      await deleteSessionArtifacts(meta.session.id);
      const entries = await readHistoryStorage();
      await writeHistoryStorage(entries.filter((entry) => entry.id !== meta.session?.id));
    }
  } else {
    resetCaptureStats();
  }
  await flushPopupSnapshot();
  await chrome.storage.local.remove([STORAGE_KEY, ACTIVE_FLAG, POPUP_STATE_KEY]);
}

/** Test helper — wipe IndexedDB network store between tests. */
export async function resetNetworkStoreForTests(): Promise<void> {
  await deleteNetworkDatabase();
  resetCaptureStats();
  evidenceQueues.clear();
}
