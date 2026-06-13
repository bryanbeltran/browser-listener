import { redactDeep } from "../redaction/engine.js";
import {
  buildPopupStateSnapshot,
  emptyPopupStateSnapshot,
  POPUP_STATE_KEY,
} from "./popup-state.js";
import { emptyTruncation } from "./limits.js";
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

const STORAGE_KEY = "browserListenerSessionData";
const ACTIVE_FLAG = "browserListenerActiveSessionId";

interface PersistedSessionMeta {
  session: CaptureSession | null;
}

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
    const truncated = await putNetworkEntries(session.id, persisted.network);
    if (truncated > 0 && session) {
      session = bumpTruncation(session, truncated);
    }
    await writePersistedMeta({ session });
  }

  return { session };
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
    truncated = await putNetworkEntries(session.id, data.network.map((e) => redactDeep(e)));
  }

  let sessionToStore = session;
  if (session && truncated > 0) {
    sessionToStore = bumpTruncation(session, truncated);
  }

  const activeId = sessionToStore?.active ? sessionToStore.id : null;
  await writePersistedMeta({ session: sessionToStore });
  await chrome.storage.local.set({ [ACTIVE_FLAG]: activeId });

  const networkCount = sessionToStore?.id ? await countNetworkEntries(sessionToStore.id) : 0;
  await writePopupSnapshot(sessionToStore, networkCount);

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

  const networkCount = next.session?.id ? await countNetworkEntries(next.session.id) : 0;
  await writePopupSnapshot(next.session, networkCount);

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
  const truncated = await idbUpsertNetworkEntry(meta.session.id, redacted);

  let session = meta.session;
  if (truncated > 0) {
    session = bumpTruncation(session, truncated);
    await writePersistedMeta({ session });
  }

  const networkCount = await countNetworkEntries(session.id);
  const activeId = session.active ? session.id : null;
  await chrome.storage.local.set({ [ACTIVE_FLAG]: activeId });
  await writePopupSnapshot(session, networkCount);
}

export async function recordHealthGap(reason: string): Promise<void> {
  await withSession((data) => {
    if (!data.session) return data;
    return {
      ...data,
      session: bumpHealth(data.session, {
        partialGaps: [...data.session.health.partialGaps, { at: Date.now(), reason }],
      }),
    };
  });
}

export async function clearSessionData(): Promise<void> {
  const meta = await readPersistedMeta();
  if (meta.session?.id) {
    await clearNetworkEntries(meta.session.id);
  }
  await chrome.storage.local.remove([STORAGE_KEY, ACTIVE_FLAG, POPUP_STATE_KEY]);
}

/** Test helper — wipe IndexedDB network store between tests. */
export async function resetNetworkStoreForTests(): Promise<void> {
  await deleteNetworkDatabase();
}
