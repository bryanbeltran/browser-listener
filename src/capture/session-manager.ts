import {
  clearSessionData,
  readSessionData,
  setSession,
  withSession,
} from "../persistence/store.js";
import { recordTimeline } from "./timeline.js";
import type { CaptureOptions, CaptureSession } from "../shared/types.js";
import { DEFAULT_CAPTURE_OPTIONS } from "../shared/types.js";

function newHealth(): CaptureSession["health"] {
  return {
    debuggerAttached: false,
    debuggerDetachCount: 0,
    serviceWorkerRestarts: 0,
    partialGaps: [],
    persistenceErrors: [],
    eventCounts: {},
  };
}

export async function createSession(
  tabId: number,
  tabUrl: string | undefined,
  options: Partial<CaptureOptions> = {},
): Promise<CaptureSession> {
  const session: CaptureSession = {
    id: crypto.randomUUID(),
    active: true,
    consentedAt: Date.now(),
    startedAt: Date.now(),
    tabId,
    tabUrl,
    options: { ...DEFAULT_CAPTURE_OPTIONS, ...options },
    health: newHealth(),
  };
  await clearSessionData();
  await withSession(() => ({
    session,
    timeline: [],
    console: [],
    network: [],
    userActions: [],
    diagnostics: [],
    domSnapshots: [],
  }));
  await recordTimeline(session.id, "system", "session_start", `Capture started on tab ${tabId}`);
  return session;
}

export async function stopSession(): Promise<CaptureSession | null> {
  const data = await readSessionData();
  if (!data.session?.active) return data.session;
  const stopped: CaptureSession = {
    ...data.session,
    active: false,
    stoppedAt: Date.now(),
  };
  await setSession(stopped);
  await recordTimeline(stopped.id, "system", "session_stop", "Capture stopped");
  return stopped;
}

export async function getActiveSession(): Promise<CaptureSession | null> {
  const data = await readSessionData();
  return data.session?.active ? data.session : null;
}
