import { emptyTruncation } from "../persistence/limits.js";
import {
  clearSessionData,
  readSessionData,
  readSessionMeta,
  setSession,
  withSession,
} from "../persistence/store.js";
import { getExtensionVersion } from "../shared/extension-version.js";
import { resetHydrationIndex } from "./hydration-index.js";
import type { CaptureOptions, CaptureSession } from "../shared/types.js";
import { DEFAULT_CAPTURE_OPTIONS } from "../shared/types.js";

function newHealth(): CaptureSession["health"] {
  return {
    debuggerAttached: false,
    debuggerEverAttached: false,
    debuggerDetachCount: 0,
    serviceWorkerRestarts: 0,
    partialGaps: [],
    persistenceErrors: [],
    truncation: emptyTruncation(),
  };
}

export async function createSession(
  tabId: number,
  tabUrl: string | undefined,
  options: Partial<CaptureOptions> = {},
): Promise<CaptureSession> {
  const session: CaptureSession = {
    id: crypto.randomUUID(),
    active: false,
    consentedAt: Date.now(),
    startedAt: Date.now(),
    tabId,
    tabUrl,
    extensionVersion: getExtensionVersion(),
    options: { ...DEFAULT_CAPTURE_OPTIONS, ...options },
    health: newHealth(),
  };
  await clearSessionData();
  resetHydrationIndex();
  await withSession(() => ({
    session,
    network: [],
  }));
  return session;
}

/** Mark session active after debugger attach succeeds (not before). */
export async function activateCaptureSession(): Promise<CaptureSession | null> {
  let activated: CaptureSession | null = null;
  await withSession((data) => {
    if (!data.session || data.session.active) {
      activated = data.session;
      return data;
    }
    activated = { ...data.session, active: true };
    return { ...data, session: activated };
  });
  return activated;
}

export async function stopSession(opts?: { tabClosed?: boolean }): Promise<CaptureSession | null> {
  const data = await readSessionData();
  if (!data.session?.active) return data.session;
  const stopped: CaptureSession = {
    ...data.session,
    active: false,
    stoppedAt: Date.now(),
    tabClosedDuringCapture: opts?.tabClosed ?? data.session.tabClosedDuringCapture,
  };
  await setSession(stopped);
  return stopped;
}

export async function getActiveSession(): Promise<CaptureSession | null> {
  const session = await readSessionMeta();
  return session?.active ? session : null;
}

export async function updateSessionTabUrl(tabUrl: string): Promise<void> {
  await withSession((data) => {
    if (!data.session?.active || data.session.tabUrl === tabUrl) return data;
    return { ...data, session: { ...data.session, tabUrl } };
  });
}
