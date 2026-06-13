import { redactDeep } from "../redaction/engine.js";
import {
  buildPopupStateSnapshot,
  emptyPopupStateSnapshot,
  POPUP_STATE_KEY,
} from "./popup-state.js";
import { emptyTruncation, estimateNetworkEntryBytes, totalNetworkBytes } from "./limits.js";
import {
  clearNetworkEntries,
  countNetworkEntries,
  deleteNetworkDatabase,
  listNetworkEntries,
  putNetworkEntries,
  upsertNetworkEntry as idbUpsertNetworkEntry,
} from "./network-store.js";
import type {
  CaptureSession,
  NetworkEntry,
  PopupStateSnapshot,
  SessionData,
} from "../shared/types.js";
import type { PopupStateResponse } from "../shared/messages.js";
import {
  buildPopupStateSnapshot,
  popupStateFromSnapshot,
} from "./popup-state.js";

const STORAGE_KEY = "browserListenerSessionData";
const ACTIVE_FLAG = "browserListenerActiveSessionId";
const POPUP_DEBOUNCE_MS = 1500;

interface PersistedSessionMeta {
  session: CaptureSession | null;
}

interface SessionCaptureStats {
  count: number;
  bytes: number;
}

const captureStats = new Map<string, SessionCaptureStats>();
let popupDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let pendingPopup: { session: CaptureSession; count: number } | null = null;

export function emptySessionData(): SessionData {
  return {
    session: null,
    network: [],
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
    debuggerDetachCount: h.debuggerDetachCount ?? 0,
    serviceWorkerRestarts: h.serviceWorkerRestarts ?? 0,
    partialGaps: h.partialGaps ?? [],
    persistenceErrors: h.persistenceErrors ?? [],
    truncation: h.truncation ?? emptyTruncation(),
    apiBodyBytesStored: h.apiBodyBytesStored,
    apiBodiesSkippedSessionCap: h.apiBodiesSkippedSessionCap,
    apiBodiesPerResponseTruncated: h.apiBodiesPerResponseTruncated,
  };
}

function normalizeSession(session: CaptureSession | null): CaptureSession | null {
  if (!session) return null;
  return { ...session, health: normalizeHealth(session) };
}

function normalizeSessionData(data: SessionData): SessionData {
  if (!data.session) return data;
  return { ...data, session: normalizeSession(data.session)! };
}

async function readPersistedMeta(): Promise<PersistedSessionMeta> {
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
    const migratedBytes = totalNetworkBytes(persisted.network);
    const result = await putNetworkEntries(session.id, persisted.network, migratedBytes);
    if (result.truncated > 0 && session) {
      session = bumpTruncation(session, result.truncated);
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
    [STORAGE_KEY]: { session: session ? redactDeep(session) : null },
  });
}

async function writePopupSnapshot(session: CaptureSession | null, networkCount: number): Promise<void> {
  const snapshot = buildPopupStateSnapshot(session, networkCount);
  await chrome.storage.local.set({ [POPUP_STATE_KEY]: snapshot });
}

export async function flushPopupSnapshot(): Promise<void> {
  if (popupDebounceTimer) {
    clearTimeout(popupDebounceTimer);
    popupDebounceTimer = null;
  }
  if (!pendingPopup) return;
  const { session, count } = pendingPopup;
  pendingPopup = null;
  await writePopupSnapshot(session, count);
}

function cancelPopupDebounce(): void {
  if (popupDebounceTimer) {
    clearTimeout(popupDebounceTimer);
    popupDebounceTimer = null;
  }
  pendingPopup = null;
}

function schedulePopupSnapshot(session: CaptureSession, networkCount: number): void {
  pendingPopup = { session, count: networkCount };
  if (popupDebounceTimer) clearTimeout(popupDebounceTimer);
  popupDebounceTimer = setTimeout(() => {
    popupDebounceTimer = null;
    const pending = pendingPopup;
    pendingPopup = null;
    if (pending) void writePopupSnapshot(pending.session, pending.count);
  }, POPUP_DEBOUNCE_MS);
}

/** Write popup state now on session transitions; debounce only count ticks during capture. */
async function updatePopupSnapshot(
  session: CaptureSession,
  networkCount: number,
  opts: { debounce: boolean },
): Promise<void> {
  if (opts.debounce) {
    schedulePopupSnapshot(session, networkCount);
    return;
  }
  cancelPopupDebounce();
  await writePopupSnapshot(session, networkCount);
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

function bumpTruncation(session: CaptureSession, count: number): CaptureSession {
  const truncation = { ...(session.health.truncation ?? emptyTruncation()) };
  truncation.network += count;
  return {
    ...session,
    health: { ...session.health, truncation },
  };
}

async function loadNetworkForSession(session: CaptureSession | null): Promise<NetworkEntry[]> {
  if (!session?.id) return [];
  return listNetworkEntries(session.id);
}

export async function readSessionData(): Promise<SessionData> {
  const meta = await readPersistedMeta();
  const network = await loadNetworkForSession(meta.session);
  return normalizeSessionData({ session: meta.session, network });
}

export async function writeSessionData(data: SessionData): Promise<SessionData> {
  const session = normalizeSession(data.session);
  let truncated = 0;

  if (session?.id && data.network.length > 0) {
    const stats = await loadCaptureStats(session.id);
    const redactedNetwork = data.network.map((e) => redactDeep(e));
    const result = await putNetworkEntries(session.id, redactedNetwork, stats.bytes);
    truncated = result.truncated;
    applyEvictedEntries(session.id, result.evicted);
    const hydration = await import("../capture/hydration-index.js");
    for (const entry of redactedNetwork) {
      hydration.ingestNetworkEntry(entry, session.tabUrl);
    }
    if (result.evicted.length > 0) {
      await hydration.rebuildHydrationIndex(session.id, session.tabUrl);
    }
  }

  let sessionToStore = session;
  if (session && truncated > 0) {
    sessionToStore = bumpTruncation(session, truncated);
  }

  const activeId = sessionToStore?.active ? sessionToStore.id : null;
  await writePersistedMeta({ session: sessionToStore });
  await chrome.storage.local.set({ [ACTIVE_FLAG]: activeId });

  const networkCount = sessionToStore?.id ? await countNetworkEntries(sessionToStore.id) : 0;
  if (sessionToStore?.id) {
    const entries = networkCount > 0 ? await listNetworkEntries(sessionToStore.id) : [];
    captureStats.set(sessionToStore.id, {
      count: networkCount,
      bytes: totalNetworkBytes(entries),
    });
  }
  await flushPopupSnapshot();
  if (sessionToStore) await writePopupSnapshot(sessionToStore, networkCount);

  const network = sessionToStore?.id ? await listNetworkEntries(sessionToStore.id) : [];
  return normalizeSessionData({ session: sessionToStore, network });
}

/** Rebuild popup snapshot from full session (e.g. after extension update). */
export async function syncPopupStateSnapshot(): Promise<void> {
  const data = await readSessionData();
  await writePopupSnapshot(data.session, data.network.length);
}

export async function readPopupStateSnapshot(): Promise<PopupStateSnapshot> {
  const raw = await chrome.storage.local.get(POPUP_STATE_KEY);
  return (raw[POPUP_STATE_KEY] as PopupStateSnapshot | undefined) ?? emptyPopupStateSnapshot();
}

/** Reconcile popup snapshot with session meta + ACTIVE_FLAG (no IndexedDB). */
export async function readPopupStateForUi(): Promise<PopupStateResponse> {
  const snapshot = await readPopupStateSnapshot();
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

  if (!session) {
    return popupStateFromSnapshot(snapshot);
  }

  const snapshotActive = snapshot.session?.active ?? false;
  const snapshotId = snapshot.session?.id;
  if (session.active !== snapshotActive || session.id !== snapshotId) {
    return popupStateFromSnapshot(
      buildPopupStateSnapshot(session, snapshot.counts.network),
    );
  }

  return popupStateFromSnapshot(snapshot);
}

export async function getActiveSessionId(): Promise<string | null> {
  const raw = await chrome.storage.local.get(ACTIVE_FLAG);
  return (raw[ACTIVE_FLAG] as string | null) ?? null;
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
    const stats = await loadCaptureStats(next.id);
    const debounce = Boolean(meta.session?.active && meta.session.id === next.id);
    await updatePopupSnapshot(next, stats.count, { debounce });
  } else if (next) {
    cancelPopupDebounce();
    const stats = await loadCaptureStats(next.id);
    await writePopupSnapshot(next, stats.count);
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

  const networkCount = next.session?.id
    ? (captureStats.get(next.session.id)?.count ?? (await loadCaptureStats(next.session.id)).count)
    : 0;
  if (next.session?.active) {
    const debounce = Boolean(data.session?.active && data.session.id === next.session.id);
    await updatePopupSnapshot(next.session, networkCount, { debounce });
  } else if (next.session) {
    cancelPopupDebounce();
    await writePopupSnapshot(next.session, networkCount);
  }

  const network = await loadNetworkForSession(next.session);
  return { session: next.session, network };
}

export async function setSession(session: CaptureSession | null): Promise<void> {
  await withSession((data) => ({ ...data, session }));
}

export async function upsertNetwork(entry: NetworkEntry): Promise<void> {
  const meta = await readPersistedMeta();
  if (!meta.session?.active) return;

  const redacted = redactDeep(entry);
  const stats = await loadCaptureStats(meta.session.id);
  const result = await idbUpsertNetworkEntry(meta.session.id, redacted, stats.bytes);
  const nextStats = applyEntryStats(meta.session.id, redacted, result.previous, result.isNew);
  applyEvictedEntries(meta.session.id, result.evicted);

  const hydration = await import("../capture/hydration-index.js");
  if (result.evicted.length > 0) {
    await hydration.rebuildHydrationIndex(meta.session.id, meta.session.tabUrl);
  } else {
    hydration.ingestNetworkEntry(redacted, meta.session.tabUrl);
  }

  let session = meta.session;
  if (result.truncated > 0) {
    session = bumpTruncation(session, result.truncated);
    await writePersistedMeta({ session });
  }

  schedulePopupSnapshot(session, nextStats.count);
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
  const { resetHydrationIndex } = await import("../capture/hydration-index.js");
  resetHydrationIndex();
  await flushPopupSnapshot();
  await chrome.storage.local.remove([STORAGE_KEY, ACTIVE_FLAG, POPUP_STATE_KEY]);
}

/** Test helper — wipe IndexedDB network store between tests. */
export async function resetNetworkStoreForTests(): Promise<void> {
  await deleteNetworkDatabase();
  resetCaptureStats();
}
