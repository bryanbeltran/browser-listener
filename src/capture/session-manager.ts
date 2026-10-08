import { emptyTruncation } from "../persistence/limits.js";
import {
  clearSessionData,
  appendNavigation,
  readSessionData,
  readSessionMeta,
  setSession,
  withSession,
} from "../persistence/store.js";
import { getExtensionVersion } from "../shared/extension-version.js";
import { isCaptureableUrl, isOriginAllowed, normalizeOriginAllowlist } from "../shared/urls.js";
import { loadRedactionConfig, readRedactionPreference } from "../persistence/preferences.js";
import {
  captureProfileDefaults,
  DEFAULT_CAPTURE_OPTIONS,
  inferCaptureProfile,
  normalizeCaptureProfile,
} from "../shared/types.js";
import type { CaptureOptions, CaptureSession } from "../shared/types.js";

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
  const allowedOrigins = normalizeOriginAllowlist(options.allowedOrigins);
  await loadRedactionConfig();
  const redactionEnabled = await readRedactionPreference();
  const profile = normalizeCaptureProfile(inferCaptureProfile(options));
  const session: CaptureSession = {
    id: crypto.randomUUID(),
    active: false,
    consentedAt: Date.now(),
    startedAt: Date.now(),
    tabId,
    tabUrl,
    extensionVersion: getExtensionVersion(),
    options: {
      ...DEFAULT_CAPTURE_OPTIONS,
      ...options,
      ...captureProfileDefaults(profile),
      profile,
      ...(allowedOrigins == null ? {} : { allowedOrigins }),
      redactionEnabled,
    },
    paused: false,
    pauseIntervals: [],
    health: newHealth(),
  };
  await clearSessionData();
  await withSession(() => ({
    session,
    network: [],
    navigation: [],
    console: [],
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
  const stoppedAt = Date.now();
  const pauseIntervals = [...(data.session.pauseIntervals ?? [])];
  const openPause = pauseIntervals[pauseIntervals.length - 1];
  if (openPause && openPause.endedAt == null) {
    pauseIntervals[pauseIntervals.length - 1] = {
      ...openPause,
      endedAt: stoppedAt,
      durationMs: Math.max(0, stoppedAt - openPause.startedAt),
    };
  }
  const stopped: CaptureSession = {
    ...data.session,
    active: false,
    stoppedAt,
    paused: false,
    pauseIntervals,
    tabClosedDuringCapture: opts?.tabClosed ?? data.session.tabClosedDuringCapture,
  };
  await setSession(stopped);
  return stopped;
}

export async function pauseCapture(): Promise<CaptureSession | null> {
  return withSession((data) => {
    const session = data.session;
    if (!session?.active || session.paused) return data;
    return {
      ...data,
      session: {
        ...session,
        paused: true,
        pauseIntervals: [...(session.pauseIntervals ?? []), { startedAt: Date.now() }],
      },
    };
  }).then((data) => (data.session?.active ? data.session : null));
}

export async function resumeCapture(): Promise<CaptureSession | null> {
  return withSession((data) => {
    const session = data.session;
    if (!session?.active || !session.paused) return data;
    const intervals = [...(session.pauseIntervals ?? [])];
    const last = intervals[intervals.length - 1];
    const endedAt = Date.now();
    if (last && last.endedAt == null) {
      intervals[intervals.length - 1] = {
        ...last,
        endedAt,
        durationMs: Math.max(0, endedAt - last.startedAt),
      };
    }
    return { ...data, session: { ...session, paused: false, pauseIntervals: intervals } };
  }).then((data) => (data.session?.active ? data.session : null));
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

export async function recordNavigation(tabId: number, url: string | undefined, title?: string): Promise<void> {
  if (!url || !isCaptureableUrl(url)) return;
  const session = await getActiveSession();
  if (!session || session.tabId !== tabId) return;
  if (session.paused) return;
  if (!isOriginAllowed(url, session.options.allowedOrigins)) return;
  await updateSessionTabUrl(url);
  await appendNavigation({
    id: crypto.randomUUID(),
    sessionId: session.id,
    timestamp: Date.now(),
    url,
    title,
    tabId,
    frameId: 0,
  });
}
