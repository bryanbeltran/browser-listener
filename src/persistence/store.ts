import { redactDeep } from "../redaction/engine.js";
import type {
  CaptureSession,
  ConsoleEntry,
  DiagnosticsBundle,
  DomSnapshot,
  NetworkEntry,
  SessionData,
  TimelineEvent,
  UserAction,
} from "../shared/types.js";

const STORAGE_KEY = "browserListenerSessionData";
const ACTIVE_FLAG = "browserListenerActiveSessionId";

export function emptySessionData(): SessionData {
  return {
    session: null,
    timeline: [],
    console: [],
    network: [],
    userActions: [],
    diagnostics: [],
    domSnapshots: [],
  };
}

export async function readSessionData(): Promise<SessionData> {
  const raw = await chrome.storage.local.get([STORAGE_KEY, ACTIVE_FLAG]);
  const data = (raw[STORAGE_KEY] as SessionData | undefined) ?? emptySessionData();
  return data;
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

export async function appendTimeline(event: TimelineEvent): Promise<void> {
  await withSession((data) => {
    if (!data.session?.active) return data;
    data.timeline.push(redactDeep(event));
    data.session = bumpHealth(data.session, {
      eventCounts: {
        ...data.session.health.eventCounts,
        [event.category]: (data.session.health.eventCounts[event.category] ?? 0) + 1,
      },
    });
    return data;
  });
}

export async function appendConsole(entry: ConsoleEntry): Promise<void> {
  await withSession((data) => {
    if (!data.session?.active || entry.sessionId !== data.session.id) return data;
    data.console.push(redactDeep(entry));
    return data;
  });
}

export async function upsertNetwork(entry: NetworkEntry): Promise<void> {
  await withSession((data) => {
    if (!data.session?.active) return data;
    const idx = data.network.findIndex((n) => n.requestId === entry.requestId);
    const redacted = redactDeep(entry);
    if (idx >= 0) data.network[idx] = { ...data.network[idx], ...redacted };
    else data.network.push(redacted);
    return data;
  });
}

export async function appendUserAction(action: UserAction): Promise<void> {
  await withSession((data) => {
    if (!data.session?.active) return data;
    data.userActions.push(redactDeep(action));
    return data;
  });
}

export async function appendDiagnostics(bundle: DiagnosticsBundle): Promise<void> {
  await withSession((data) => {
    if (!data.session?.active) return data;
    data.diagnostics.push(redactDeep(bundle));
    if (data.diagnostics.length > 50) data.diagnostics.shift();
    return data;
  });
}

export async function appendDomSnapshot(snapshot: DomSnapshot): Promise<void> {
  await withSession((data) => {
    if (!data.session?.active) return data;
    data.domSnapshots.push(redactDeep(snapshot));
    if (data.domSnapshots.length > 20) data.domSnapshots.shift();
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
