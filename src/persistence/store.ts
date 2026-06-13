import { redactDeep } from "../redaction/engine.js";
import {
  emptyTruncation,
  pushWithCap,
  STORAGE_LIMITS,
} from "./limits.js";
import type {
  CaptureSession,
  NetworkEntry,
  SessionData,
  StorageTruncation,
} from "../shared/types.js";

const STORAGE_KEY = "browserListenerSessionData";
const ACTIVE_FLAG = "browserListenerActiveSessionId";

export function emptySessionData(): SessionData {
  return {
    session: null,
    network: [],
  };
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

function normalizeSessionData(data: SessionData): SessionData {
  if (!data.session) return data;
  return { ...data, session: { ...data.session, health: normalizeHealth(data.session) } };
}

export async function readSessionData(): Promise<SessionData> {
  const raw = await chrome.storage.local.get([STORAGE_KEY, ACTIVE_FLAG]);
  let data = (raw[STORAGE_KEY] as SessionData | undefined) ?? emptySessionData();
  const activeId = (raw[ACTIVE_FLAG] as string | null) ?? null;
  if (data.session) {
    data = {
      ...data,
      session: {
        ...data.session,
        active: Boolean(activeId && data.session.id === activeId),
      },
    };
  }
  return normalizeSessionData(data);
}

export async function writeSessionData(data: SessionData): Promise<void> {
  const payload: SessionData = redactDeep(data);
  await chrome.storage.local.set({
    [STORAGE_KEY]: payload,
    [ACTIVE_FLAG]: payload.session?.active ? payload.session.id : null,
  });
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

function ensureTruncation(session: CaptureSession): StorageTruncation {
  return session.health.truncation ?? emptyTruncation();
}

function applyCap<T>(
  arr: T[],
  item: T,
  bucket: keyof typeof STORAGE_LIMITS,
  session: CaptureSession,
): CaptureSession {
  const truncation = { ...ensureTruncation(session) };
  pushWithCap(arr, item, STORAGE_LIMITS[bucket], truncation, bucket);
  return bumpHealth(session, { truncation });
}

export async function withSession(
  fn: (data: SessionData) => SessionData | Promise<SessionData>,
): Promise<SessionData> {
  const data = await readSessionData();
  const next = await fn(data);
  await writeSessionData(next);
  return next;
}

export async function setSession(session: CaptureSession | null): Promise<void> {
  await withSession((data) => ({ ...data, session }));
}

export async function upsertNetwork(entry: NetworkEntry): Promise<void> {
  await withSession((data) => {
    if (!data.session?.active) return data;
    const idx = data.network.findIndex((n) => n.requestId === entry.requestId);
    const redacted = redactDeep(entry);
    if (idx >= 0) {
      data.network[idx] = { ...data.network[idx], ...redacted };
    } else {
      data.session = applyCap(data.network, redacted, "network", data.session);
    }
    return data;
  });
}

export async function recordHealthGap(reason: string): Promise<void> {
  await withSession((data) => {
    if (!data.session) return data;
    data.session = bumpHealth(data.session, {
      partialGaps: [
        ...data.session.health.partialGaps,
        { at: Date.now(), reason },
      ],
    });
    return data;
  });
}

export async function clearSessionData(): Promise<void> {
  await chrome.storage.local.remove([STORAGE_KEY, ACTIVE_FLAG]);
}
