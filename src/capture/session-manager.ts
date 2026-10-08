import { emptyTruncation } from "../persistence/limits.js";
import {
  clearSessionData,
  appendNavigation,
  archiveCurrentSession,
  readSessionData,
  readSessionMeta,
  setSession,
  withSession,
} from "../persistence/store.js";
import { getExtensionVersion } from "../shared/extension-version.js";
import { buildCapabilityMatrix } from "./capabilities.js";
import { isCaptureableUrl, isOriginAllowed, normalizeOriginAllowlist } from "../shared/urls.js";
import { loadRedactionConfig, readRedactionPreference } from "../persistence/preferences.js";
import {
  captureProfileDefaults,
  DEFAULT_CAPTURE_OPTIONS,
  normalizeCaptureDuration,
  normalizeCaptureFields,
  normalizeCaptureFilters,
  normalizeFrameIds,
  normalizeTargetTabIds,
  inferCaptureProfile,
  normalizeCaptureBudgets,
  normalizeCaptureProfile,
  policyEpochFromOptions,
} from "../shared/types.js";
import type {
  CaptureFieldPolicy,
  CaptureFilters,
  CaptureOptions,
  CaptureSession,
  CaptureTarget,
} from "../shared/types.js";
import { EXCLUDED_FIELD, fieldsForSession, policyForSession } from "../shared/field-policy.js";

let expirationTimer: ReturnType<typeof setTimeout> | null = null;
let captureExpirationHandler: (() => void | Promise<void>) | null = null;

function clearExpirationTimer(): void {
  if (expirationTimer) clearTimeout(expirationTimer);
  expirationTimer = null;
}

function scheduleExpirationForSession(session: CaptureSession | null): void {
  clearExpirationTimer();
  if (!captureExpirationHandler || !session?.active || session.expiresAt == null) return;
  const delay = Math.max(0, Math.min(session.expiresAt - Date.now(), 2_147_000_000));
  expirationTimer = setTimeout(() => {
    expirationTimer = null;
    void (async () => {
      const current = await getActiveSession();
      if (!current?.expiresAt || current.expiresAt > Date.now()) {
        scheduleExpirationForSession(current);
        return;
      }
      try {
        await captureExpirationHandler?.();
      } catch {
        // Keep the deadline enforceable if export/download fails transiently.
        scheduleExpirationForSession(await getActiveSession());
      }
    })();
  }, delay);
}

export function setCaptureExpirationHandler(handler: (() => void | Promise<void>) | null): void {
  captureExpirationHandler = handler;
  if (!handler) clearExpirationTimer();
  else void rescheduleCaptureExpiration();
}

export async function rescheduleCaptureExpiration(): Promise<void> {
  scheduleExpirationForSession(await readSessionMeta());
}

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
  targetTabs?: CaptureTarget[],
): Promise<CaptureSession> {
  const allowedOrigins = normalizeOriginAllowlist(options.allowedOrigins);
  await loadRedactionConfig();
  const redactionEnabled = await readRedactionPreference();
  const profile = normalizeCaptureProfile(inferCaptureProfile(options));
  const startedAt = Date.now();
  const sessionName = typeof options.sessionName === "string" ? options.sessionName.trim().slice(0, 120) : "";
  const targetMap = new Map<number, CaptureTarget>();
  for (const target of targetTabs ?? []) {
    targetMap.set(target.tabId, { ...target, partialGaps: target.partialGaps ?? [] });
  }
  if (!targetMap.has(tabId)) {
    targetMap.set(tabId, { tabId, url: tabUrl, partialGaps: [] });
  }
  const targets = [
    targetMap.get(tabId)!,
    ...[...targetMap.values()].filter((target) => target.tabId !== tabId),
  ];
  const normalizedOptions = {
    ...DEFAULT_CAPTURE_OPTIONS,
    ...options,
    ...captureProfileDefaults(profile),
    profile,
    ...(allowedOrigins == null ? {} : { allowedOrigins }),
    targetTabIds: targets.map((target) => target.tabId),
    redactionEnabled,
    budgets: normalizeCaptureBudgets(options.budgets),
    filters: normalizeCaptureFilters(options.filters),
    fields: normalizeCaptureFields(options.fields),
    frameIds: normalizeFrameIds(options.frameIds),
    ...(normalizeCaptureDuration(options.durationMs) == null
      ? {}
      : { durationMs: normalizeCaptureDuration(options.durationMs) }),
    ...(sessionName ? { sessionName } : {}),
  };
  const fieldPolicy = normalizedOptions.fields;
  const persistedTargets = targets.map((target) => ({
    ...target,
    ...(fieldPolicy.urls || target.url == null ? {} : { url: undefined }),
    ...(fieldPolicy.navigationTitles || target.title == null ? {} : { title: undefined }),
  }));
  const durationMs = normalizeCaptureDuration(normalizedOptions.durationMs);
  const session: CaptureSession = {
    id: crypto.randomUUID(),
    active: false,
    consentedAt: Date.now(),
    startedAt,
    tabId,
    ...(fieldPolicy.urls ? { tabUrl } : {}),
    ...(sessionName ? { name: sessionName } : {}),
    extensionVersion: getExtensionVersion(),
    options: normalizedOptions,
    paused: false,
    pauseIntervals: [],
    targets: persistedTargets,
    policyEpochs: [policyEpochFromOptions(normalizedOptions, `epoch-${crypto.randomUUID()}`, startedAt)],
    capabilities: buildCapabilityMatrix(),
    ...(durationMs == null ? {} : { expiresAt: startedAt + durationMs }),
    health: newHealth(),
  };
  await clearSessionData({ archive: true, preserveHistory: true });
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
  scheduleExpirationForSession(activated);
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
    policyEpochs: data.session.policyEpochs?.map((epoch, index, epochs) =>
      index === epochs.length - 1 && epoch.endedAt == null
        ? { ...epoch, endedAt: stoppedAt }
        : epoch,
    ),
  };
  await setSession(stopped);
  await archiveCurrentSession();
  clearExpirationTimer();
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
  const resumed = await withSession((data) => {
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
  scheduleExpirationForSession(resumed);
  return resumed;
}

export async function getActiveSession(): Promise<CaptureSession | null> {
  const session = await readSessionMeta();
  return session?.active ? session : null;
}

export interface CapturePolicyUpdate {
  allowedOrigins?: string[] | null;
  filters?: CaptureFilters;
  fields?: CaptureFieldPolicy;
  frameIds?: string[];
  targetTabIds?: number[];
  /** `null` clears the duration limit. */
  durationMs?: number | null;
}

/** Update only scope/field policy while preserving earlier immutable epochs. */
export async function updateCapturePolicy(
  update: CapturePolicyUpdate,
  targetTabs: CaptureTarget[] = [],
): Promise<CaptureSession | null> {
  const hasDurationUpdate = Object.prototype.hasOwnProperty.call(update, "durationMs");
  const hasTargetUpdate = Object.prototype.hasOwnProperty.call(update, "targetTabIds");
  const hasOriginUpdate = Object.prototype.hasOwnProperty.call(update, "allowedOrigins");
  const normalizedOrigins = !hasOriginUpdate || update.allowedOrigins == null
    ? undefined
    : normalizeOriginAllowlist(update.allowedOrigins);
  const data = await withSession((current) => {
    const session = current.session;
    if (!session?.active) return current;
    const now = Date.now();
    const durationMs = hasDurationUpdate
      ? normalizeCaptureDuration(update.durationMs)
      : normalizeCaptureDuration(session.options.durationMs);
    const existingTargetIds = normalizeTargetTabIds(
      session.options.targetTabIds?.length
        ? session.options.targetTabIds
        : session.targets?.map((target) => target.tabId),
    );
    const requestedTargetIds = hasTargetUpdate
      ? normalizeTargetTabIds(update.targetTabIds)
      : existingTargetIds;
    const nextTargetIds = [...new Set([session.tabId, ...requestedTargetIds])];
    const targetMap = new Map((session.targets ?? []).map((target) => [target.tabId, target]));
    for (const target of targetTabs) targetMap.set(target.tabId, { ...target, partialGaps: target.partialGaps ?? [] });
    const nextTargets = nextTargetIds.map((tabId) => targetMap.get(tabId) ?? { tabId, partialGaps: [] });
    const nextOptions: CaptureOptions = {
      ...session.options,
      ...(hasOriginUpdate ? { allowedOrigins: normalizedOrigins } : {}),
      ...(update.filters == null ? {} : { filters: normalizeCaptureFilters(update.filters) }),
      ...(update.fields == null ? {} : { fields: normalizeCaptureFields(update.fields) }),
      ...(update.frameIds == null ? {} : { frameIds: normalizeFrameIds(update.frameIds) }),
      targetTabIds: nextTargetIds,
      ...(durationMs == null ? { durationMs: undefined } : { durationMs }),
    };
    const epochs = [...(session.policyEpochs ?? [])];
    const previous = epochs.at(-1);
    if (previous && previous.endedAt == null) epochs[epochs.length - 1] = { ...previous, endedAt: now };
    epochs.push(policyEpochFromOptions(nextOptions, `epoch-${crypto.randomUUID()}`, now));
    const expiresAt = hasDurationUpdate
      ? durationMs == null ? undefined : now + durationMs
      : session.expiresAt;
    return {
      ...current,
      session: {
        ...session,
        options: nextOptions,
        targets: nextTargets,
        policyEpochs: epochs,
        ...(expiresAt == null ? { expiresAt: undefined } : { expiresAt }),
      },
    };
  });
  const session = data.session?.active ? data.session : null;
  scheduleExpirationForSession(session);
  return session;
}

export async function armOneRequestCapture(urlIncludes?: string): Promise<CaptureSession | null> {
  const pattern = typeof urlIncludes === "string" ? urlIncludes.trim().slice(0, 500) : "";
  const data = await withSession((current) => {
    if (!current.session?.active || current.session.paused) return current;
    return {
      ...current,
      session: {
        ...current.session,
        oneRequestCapture: {
          armedAt: Date.now(),
          ...(pattern ? { urlIncludes: pattern } : {}),
        },
      },
    };
  });
  return data.session?.active ? data.session : null;
}

export async function updateSessionTabUrl(tabUrl: string): Promise<void> {
  await withSession((data) => {
    if (!data.session?.active || data.session.tabUrl === tabUrl) return data;
    if (normalizeCaptureFields(data.session.options.fields).urls === false) return data;
    return { ...data, session: { ...data.session, tabUrl } };
  });
}

export async function recordNavigation(tabId: number, url: string | undefined, title?: string): Promise<void> {
  if (!url || !isCaptureableUrl(url)) return;
  const session = await getActiveSession();
  const target = session?.targets?.find((candidate) => candidate.tabId === tabId);
  if (!session || (session.tabId !== tabId && !target)) return;
  if (session.paused) return;
  const policyEpochId = session.policyEpochs?.at(-1)?.id;
  const policy = policyForSession(session, policyEpochId);
  if (!isOriginAllowed(url, policy?.allowedOrigins.length ? policy.allowedOrigins : undefined)) return;
  if (policy?.frameIds.length && !policy.frameIds.includes("0")) return;
  const fields = fieldsForSession(session, policyEpochId);
  const storedUrl = fields.urls ? url : EXCLUDED_FIELD;
  const storedTitle = fields.navigationTitles ? title : undefined;
  await withSession((data) => ({
    ...data,
    session: data.session
      ? {
          ...data.session,
          ...(data.session.tabId === tabId && fields.urls ? { tabUrl: url } : {}),
          targets: data.session.targets?.map((candidate) =>
            candidate.tabId === tabId
              ? {
                  ...candidate,
                  ...(fields.urls ? { url } : { url: undefined }),
                  ...(fields.navigationTitles ? { title } : { title: undefined }),
                  tabClosed: false,
                }
              : candidate,
          ),
        }
      : data.session,
  }));
  await appendNavigation({
    id: crypto.randomUUID(),
    sessionId: session.id,
    timestamp: Date.now(),
    url: storedUrl,
    ...(storedTitle == null ? {} : { title: storedTitle }),
    tabId,
    frameId: 0,
    policyEpochId,
  });
}
