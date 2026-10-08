import {
  appendConsole,
  patchSession,
  readSessionData,
  upsertNetwork,
} from "../persistence/store.js";
import { updateDebuggerHealth } from "../persistence/session-recovery.js";
import { captureBodiesForRequest } from "./body-capture.js";
import { getActiveSession } from "./session-manager.js";
import type { CaptureSession, ConsoleEntry, NetworkEntry } from "../shared/types.js";
import { isOriginAllowed } from "../shared/urls.js";
import { matchesCaptureMime, matchesCaptureUrl, matchesOneRequest } from "../shared/capture-filters.js";

const CDP_VERSION = "1.3";
/** CDP request IDs are only unique within one debugger target. */
const pendingCdp = new Map<string, Partial<NetworkEntry>>();
const oneShotRequestKeys = new Set<string>();
const pendingBodyCaptures = new Set<Promise<void>>();
const debuggerEventQueues = new Map<number, Promise<void>>();
const attachedTabIds = new Set<number>();
let recoverTimer: ReturnType<typeof setTimeout> | null = null;
let onDebuggerCanceledByUser: (() => void) | null = null;

export function setOnDebuggerCanceledByUser(handler: (() => void) | null): void {
  onDebuggerCanceledByUser = handler;
}

function pendingKey(tabId: number, requestId: string): string {
  return `${tabId}:${requestId}`;
}

function targetTabIds(session: CaptureSession | null): number[] {
  if (!session) return [];
  return [...new Set([session.tabId, ...(session.targets ?? []).map((target) => target.tabId)])];
}

function recoverableTargetTabIds(session: CaptureSession): number[] {
  return targetTabIds(session).filter((tabId) => !session.targets?.find((target) => target.tabId === tabId)?.tabClosed);
}

async function detachChromeDebugger(tabId: number): Promise<void> {
  try {
    await chrome.debugger.detach({ tabId });
  } catch {
    /* not attached */
  }
}

function clearPendingForTab(tabId: number): void {
  for (const [key, entry] of pendingCdp) {
    if (entry.tabId === tabId || key.startsWith(`${tabId}:`)) {
      pendingCdp.delete(key);
      oneShotRequestKeys.delete(key);
    }
  }
}

async function recordAttachFailure(tabId: number, chromeAttached: boolean, message: string): Promise<void> {
  if (chromeAttached) await detachChromeDebugger(tabId);
  attachedTabIds.delete(tabId);
  clearPendingForTab(tabId);
  const at = Date.now();
  await patchSession((session) => {
    if (!session) return session;
    return {
      ...session,
      health: {
        ...session.health,
        debuggerAttached: attachedTabIds.size > 0,
        lastAttachError: message,
        partialGaps: [...session.health.partialGaps, { at, reason: `debugger_attach_failed: ${message}` }],
      },
      ...(session.targets
        ? {
            targets: session.targets.map((target) =>
              target.tabId === tabId
                ? {
                    ...target,
                    debuggerAttached: false,
                    partialGaps: [
                      ...(target.partialGaps ?? []),
                      { at, reason: "debugger_attach_failed" },
                    ],
                  }
                : target,
            ),
          }
        : {}),
    };
  });
}

async function syncDebuggerHealthIfAttached(): Promise<void> {
  if (attachedTabIds.size === 0) return;
  await patchSession((session) => {
    if (!session?.active) return session;
    return {
      ...session,
      health: {
        ...session.health,
        debuggerAttached: true,
        debuggerEverAttached: true,
        lastAttachError: undefined,
      },
      ...(session.targets
        ? {
            targets: session.targets.map((target) =>
              attachedTabIds.has(target.tabId)
                ? { ...target, debuggerAttached: true, debuggerEverAttached: true }
                : target,
            ),
          }
        : {}),
    };
  });
}

export async function attachDebugger(tabId: number): Promise<void> {
  await detachChromeDebugger(tabId);
  attachedTabIds.delete(tabId);

  let chromeAttached = false;
  try {
    await chrome.debugger.attach({ tabId }, CDP_VERSION);
    chromeAttached = true;
    await chrome.debugger.sendCommand({ tabId }, "Network.enable");
    await chrome.debugger.sendCommand({ tabId }, "Runtime.enable");
    await chrome.debugger.sendCommand({ tabId }, "Log.enable");
    try {
      await chrome.debugger.sendCommand({ tabId }, "Page.enable");
    } catch {
      /* Frame-tree snapshots record unsupported when the Page domain is unavailable. */
    }
    attachedTabIds.add(tabId);
    try {
      await chrome.debugger.sendCommand({ tabId }, "Performance.enable");
    } catch {
      /* Performance.getMetrics will record an explicit unsupported signal. */
    }
    await updateDebuggerHealth({ attached: true, tabId, attachedTabIds: [...attachedTabIds] });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordAttachFailure(tabId, chromeAttached, message);
    throw err;
  }
}

/** Detach one selected tab, or every selected tab when no ID is supplied. */
export async function detachDebugger(tabId?: number): Promise<void> {
  const tabIds = tabId == null ? [...attachedTabIds] : [tabId];
  for (const id of tabIds) {
    const wasAttached = attachedTabIds.has(id);
    await detachChromeDebugger(id);
    attachedTabIds.delete(id);
    clearPendingForTab(id);
    if (wasAttached) {
      await updateDebuggerHealth({
        detached: true,
        tabId: id,
        attachedTabIds: [...attachedTabIds],
      });
    }
  }
}

async function tryRecover(): Promise<void> {
  const session = await getActiveSession();
  if (!session) return;
  try {
    await ensureDebuggerForSession();
    await updateDebuggerHealth({
      recovered: true,
      tabId: session.tabId,
      attachedTabIds: [...attachedTabIds],
    });
    const current = await getActiveSession();
    if (current && recoverableTargetTabIds(current).some((id) => !attachedTabIds.has(id))) {
      recoverTimer = setTimeout(() => void tryRecover(), 2000);
    }
  } catch {
    recoverTimer = setTimeout(() => void tryRecover(), 2000);
  }
}

function scheduleRecover(): void {
  if (recoverTimer) clearTimeout(recoverTimer);
  recoverTimer = setTimeout(() => void tryRecover(), 500);
}

/** Retry CDP attach while a capture session is active, including after SW restart. */
export function scheduleDebuggerAttachRetry(): void {
  scheduleRecover();
}

function eventTimestamp(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return Date.now();
  return value > 1_000_000_000_000 ? value : value * 1000;
}

function completedTiming(entry: NetworkEntry, end: number): NetworkEntry["timing"] {
  const start = entry.timing?.start ?? entry.timestamp;
  return {
    start,
    end,
    durationMs: Math.max(0, end - start),
  };
}

function remoteObjectText(value: unknown): string {
  const object = value as
    | { value?: unknown; unserializableValue?: string; description?: string; type?: string }
    | undefined;
  if (!object) return "";
  if (object.value !== undefined) {
    if (typeof object.value === "string") return object.value;
    try {
      return JSON.stringify(object.value);
    } catch {
      return String(object.value);
    }
  }
  return object.unserializableValue ?? object.description ?? object.type ?? "";
}

function stackFramesText(stackTrace: unknown): string | undefined {
  const trace = stackTrace as { description?: string; callFrames?: Array<Record<string, unknown>> } | undefined;
  if (!trace) return undefined;
  if (trace.description) return trace.description;
  const frames = trace.callFrames ?? [];
  const text = frames
    .map((frame) => `${String(frame.functionName ?? "")} (${String(frame.url ?? "")}:${String(frame.lineNumber ?? "")})`)
    .join("\n");
  return text || undefined;
}

function consoleEntry(
  sessionId: string,
  tabId: number,
  level: string,
  text: string,
  fields: Record<string, unknown> = {},
): ConsoleEntry {
  return {
    id: crypto.randomUUID(),
    sessionId,
    timestamp: eventTimestamp(fields.timestamp),
    method: typeof fields.method === "string" ? fields.method : undefined,
    level,
    text: text || "(empty console entry)",
    tabId: tabId >= 0 ? tabId : undefined,
    source: typeof fields.source === "string" ? fields.source : undefined,
    url: typeof fields.url === "string" ? fields.url : undefined,
    lineNumber: typeof fields.lineNumber === "number" ? fields.lineNumber : undefined,
    columnNumber: typeof fields.columnNumber === "number" ? fields.columnNumber : undefined,
    stackTrace: stackFramesText(fields.stackTrace),
    args: Array.isArray(fields.args)
      ? fields.args.slice(0, 8).map((arg) => remoteObjectText(arg))
      : undefined,
  };
}

async function captureConsoleEvent(
  sessionId: string,
  tabId: number,
  method: string,
  params: Record<string, unknown>,
): Promise<void> {
  if (method === "Runtime.consoleAPICalled") {
    const args = Array.isArray(params.args) ? params.args : [];
    await appendConsole(
      consoleEntry(sessionId, tabId, String(params.type ?? "log"), args.map(remoteObjectText).join(" "), {
        method,
        timestamp: params.timestamp,
        args,
        stackTrace: params.stackTrace,
      }),
    );
  }

  if (method === "Runtime.exceptionThrown") {
    const details = (params.exceptionDetails ?? {}) as Record<string, unknown>;
    const exception = details.exception as Record<string, unknown> | undefined;
    await appendConsole(
      consoleEntry(sessionId, tabId, "error", String(details.text ?? exception?.description ?? "Unhandled exception"), {
        method,
        timestamp: details.timestamp,
        url: details.url,
        lineNumber: details.lineNumber,
        columnNumber: details.columnNumber,
        stackTrace: details.stackTrace ?? exception?.stackTrace,
      }),
    );
  }

  if (method === "Log.entryAdded") {
    const entry = (params.entry ?? {}) as Record<string, unknown>;
    await appendConsole(
      consoleEntry(sessionId, tabId, String(entry.level ?? "info"), String(entry.text ?? ""), {
        method,
        timestamp: entry.timestamp,
        source: entry.source,
        url: entry.url,
        lineNumber: entry.lineNumber,
        stackTrace: entry.stackTrace,
      }),
    );
  }
}

async function onDebuggerEvent(
  source: chrome.debugger.Debuggee,
  method: string,
  params?: object,
): Promise<void> {
  const session = await getActiveSession();
  const tabId = source.tabId;
  if (!session || tabId == null || !targetTabIds(session).includes(tabId)) return;
  // Unit callers can exercise event handling without simulating attach; real CDP
  // events are restricted to the currently attached targets whenever state exists.
  if (attachedTabIds.size > 0 && !attachedTabIds.has(tabId)) return;
  if (session.paused) return;
  const p = (params ?? {}) as Record<string, unknown>;

  if (session.options.captureConsole && (method.startsWith("Runtime.") || method === "Log.entryAdded")) {
    await captureConsoleEvent(session.id, tabId, method, p);
    return;
  }

  if (method === "Network.requestWillBeSent") {
    const request = p.request as
      | { url?: string; method?: string; headers?: Record<string, string>; documentURL?: string }
      | undefined;
    const url = request?.url;
    const inCaptureScope = isOriginAllowed(url, session.options.allowedOrigins) && matchesCaptureUrl(url, session.options.filters);
    const oneShot = Boolean(
      inCaptureScope && session.oneRequestCapture && matchesOneRequest(url, session.oneRequestCapture.urlIncludes),
    );
    if (!inCaptureScope) {
      await patchSession((current) =>
        current
          ? {
              ...current,
              health: {
                ...current.health,
                filteredNetworkRequests: (current.health.filteredNetworkRequests ?? 0) + 1,
              },
            }
          : current,
      );
      return;
    }
    const requestId = String(p.requestId ?? "");
    const key = pendingKey(tabId, requestId);
    if (oneShot) {
      oneShotRequestKeys.add(key);
      await patchSession((current) =>
        current?.oneRequestCapture
          ? { ...current, oneRequestCapture: undefined }
          : current,
      );
    }
    const previousValue = pendingCdp.get(key);
    const previous = previousValue?.sessionId === session.id ? (previousValue as NetworkEntry) : undefined;
    const initiator = p.initiator as
      | { type?: string; url?: string; requestId?: string; lineNumber?: number; columnNumber?: number }
      | undefined;
    const requestTimestamp = typeof p.wallTime === "number" ? eventTimestamp(p.wallTime) : Date.now();
    pendingCdp.set(key, {
      id: crypto.randomUUID(),
      sessionId: session.id,
      requestId,
      timestamp: requestTimestamp,
      url: request?.url ?? "",
      method: request?.method ?? "GET",
      type: String(p.type ?? "other"),
      oneRequestCapture: oneShot || undefined,
      tabId,
      frameId: p.frameId != null ? String(p.frameId) : undefined,
      documentUrl: typeof p.documentURL === "string" ? p.documentURL : request?.documentURL,
      redirectFromId: previous?.id,
      initiator,
      isPreflight: String(p.type ?? "").toLowerCase() === "preflight",
      requestHeaders: request?.headers,
      timing: { start: requestTimestamp },
    });
  }

  if (method === "Network.responseReceived") {
    const requestId = String(p.requestId ?? "");
    const key = pendingKey(tabId, requestId);
    const response = p.response as
      | {
          status?: number;
          statusText?: string;
          headers?: Record<string, string>;
          mimeType?: string;
          fromDiskCache?: boolean;
          fromServiceWorker?: boolean;
          connectionReused?: boolean;
        }
      | undefined;
    const prior = pendingCdp.get(key);
    const base = prior?.sessionId === session.id ? prior : { requestId, sessionId: session.id, tabId };
    const responseTimestamp = Date.now();
    const contentType = response?.mimeType ?? Object.entries(response?.headers ?? {}).find(([header]) => header.toLowerCase() === "content-type")?.[1];
    const oneShot = oneShotRequestKeys.has(key) || prior?.oneRequestCapture === true;
    if (!oneShot && !matchesCaptureMime(contentType, session.options.filters)) {
      pendingCdp.delete(key);
      await patchSession((current) =>
        current
          ? {
              ...current,
              health: {
                ...current.health,
                filteredNetworkRequests: (current.health.filteredNetworkRequests ?? 0) + 1,
              },
            }
          : current,
      );
      return;
    }
    const entry: NetworkEntry = {
      ...(base as NetworkEntry),
      id: base.id ?? crypto.randomUUID(),
      sessionId: session.id,
      requestId,
      timestamp: responseTimestamp,
      url: (base as NetworkEntry).url ?? "",
      method: (base as NetworkEntry).method ?? "GET",
      type: (base as NetworkEntry).type ?? "other",
      statusCode: response?.status,
      statusLine: response?.statusText,
      responseHeaders: response?.headers,
      contentType,
      tabId,
      fromCache: response?.fromDiskCache,
      fromServiceWorker: response?.fromServiceWorker,
      connectionReused: response?.connectionReused,
      ...(!session.options.captureBodies && !oneShot
        ? {
            requestBodyState: "excluded" as const,
            requestBodySkipReason: "capture-disabled" as const,
            responseBodyState: "excluded" as const,
            responseBodySkipReason: "capture-disabled" as const,
          }
        : {}),
    };
    entry.timing = completedTiming(entry, responseTimestamp);
    pendingCdp.set(key, entry);
    await upsertNetwork(entry);
  }

  if (method === "Network.loadingFailed") {
    const requestId = String(p.requestId ?? "");
    const key = pendingKey(tabId, requestId);
    const pending = pendingCdp.get(key);
    if (pending?.sessionId === session.id) {
      const failed: NetworkEntry = {
        ...(pending as NetworkEntry),
        sessionId: session.id,
        error: String(p.errorText ?? "network loading failed"),
      };
      failed.timing = completedTiming(failed, Date.now());
      pendingCdp.set(key, failed);
      await upsertNetwork(failed);
    }
  }

  if (method === "Network.loadingFinished") {
    const requestId = String(p.requestId ?? "");
    const key = pendingKey(tabId, requestId);
    const pending = pendingCdp.get(key);
    if (!pending?.url) return;
    const base = pending as NetworkEntry;
    const job = (async () => {
      const completed: NetworkEntry = {
        ...base,
        ...(typeof p.encodedDataLength === "number" && Number.isFinite(p.encodedDataLength)
          ? { responseTransferSize: p.encodedDataLength }
          : {}),
        timing: completedTiming(base, Date.now()),
      };
      pendingCdp.set(key, completed);
      await upsertNetwork(completed);
      const oneShot = oneShotRequestKeys.delete(key) || completed.oneRequestCapture === true;
      const bodies = await captureBodiesForRequest(tabId, requestId, completed, oneShot);
      if (Object.keys(bodies).length === 0) return;
      const updated: NetworkEntry = { ...completed, ...bodies };
      pendingCdp.set(key, updated);
      await upsertNetwork(updated);
    })();
    pendingBodyCaptures.add(job);
    void job.finally(() => pendingBodyCaptures.delete(job));
  }
}

export function registerDebuggerCapture(): void {
  chrome.debugger.onEvent.addListener((source, method, params) => {
    const tabId = source.tabId;
    if (tabId == null) return;
    const previous = debuggerEventQueues.get(tabId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(() => onDebuggerEvent(source, method, params));
    debuggerEventQueues.set(tabId, next);
    void next.then(
      () => {
        if (debuggerEventQueues.get(tabId) === next) debuggerEventQueues.delete(tabId);
      },
      () => {
        if (debuggerEventQueues.get(tabId) === next) debuggerEventQueues.delete(tabId);
      },
    );
  });

  chrome.debugger.onDetach.addListener((source, reason) => {
    const tabId = source.tabId;
    if (tabId != null) {
      attachedTabIds.delete(tabId);
      clearPendingForTab(tabId);
    }
    void (async () => {
      const session = await getActiveSession();
      await updateDebuggerHealth({
        detached: true,
        ...(tabId == null ? {} : { tabId }),
        attachedTabIds: [...attachedTabIds],
      });
      await patchSession((current) => {
        if (!current) return current;
        const at = Date.now();
        return {
          ...current,
          health: {
            ...current.health,
            partialGaps: [...current.health.partialGaps, { at, reason: `debugger_detach: ${reason}` }],
          },
          ...(tabId != null && current.targets
            ? {
                targets: current.targets.map((target) =>
                  target.tabId === tabId
                    ? {
                        ...target,
                        debuggerAttached: false,
                        partialGaps: [
                          ...(target.partialGaps ?? []),
                          { at, reason: `debugger_detach: ${reason}` },
                        ],
                      }
                    : target,
                ),
              }
            : {}),
        };
      });
      if (session?.active) scheduleRecover();
    })();

    if (reason === "canceled_by_user") onDebuggerCanceledByUser?.();
  });
}

export async function ensureDebuggerForSession(): Promise<void> {
  const session = await getActiveSession();
  if (!session) return;
  const ids = recoverableTargetTabIds(session);
  const ordered = [session.tabId, ...ids.filter((id) => id !== session.tabId)];
  for (const tabId of ordered) {
    if (attachedTabIds.has(tabId)) continue;
    try {
      await attachDebugger(tabId);
    } catch (err) {
      if (tabId === session.tabId) throw err;
      // A secondary tab is an explicit, recoverable target gap. Keep the
      // primary capture alive and retry it on the next recovery cycle.
    }
  }
  if (!attachedTabIds.has(session.tabId)) {
    throw new Error("Primary debugger attach did not complete on recovery");
  }
  await syncDebuggerHealthIfAttached();
}

/** Test helper — clear in-memory debugger state between isolated runs. */
export function resetDebuggerCaptureForTests(): void {
  attachedTabIds.clear();
  if (recoverTimer) {
    clearTimeout(recoverTimer);
    recoverTimer = null;
  }
  pendingCdp.clear();
  oneShotRequestKeys.clear();
  debuggerEventQueues.clear();
  pendingBodyCaptures.clear();
}

/** Backward-compatible primary/first attached tab accessor. */
export function getAttachedTabId(): number | null {
  return [...attachedTabIds][0] ?? null;
}

export function getAttachedTabIds(): number[] {
  return [...attachedTabIds];
}

export function isDebuggerAttachedToTab(tabId: number): boolean {
  return attachedTabIds.has(tabId);
}

/** Snapshot debugger health for export before detach clears in-memory state. */
export async function snapshotDebuggerHealthForExport(): Promise<void> {
  const attached = new Set(attachedTabIds);
  await patchSession((session) => {
    if (!session) return session;
    const targets = session.targets?.map((target) => ({
      ...target,
      debuggerAttached: attached.has(target.tabId),
      debuggerEverAttached: Boolean(target.debuggerEverAttached || attached.has(target.tabId)),
    }));
    const everAttached = Boolean(
      session.health.debuggerEverAttached ||
        attached.size > 0 ||
        targets?.some((target) => target.debuggerEverAttached),
    );
    const gaps = [...session.health.partialGaps];
    if (!everAttached) {
      const detail =
        session.health.lastAttachError ??
        gaps.find((gap) => gap.reason.startsWith("debugger_attach_failed"))?.reason ??
        "CDP attach never completed";
      if (!gaps.some((gap) => gap.reason.startsWith("capture_without_debugger"))) {
        gaps.push({ at: Date.now(), reason: `capture_without_debugger: ${detail}` });
      }
    }
    return {
      ...session,
      ...(targets ? { targets } : {}),
      health: {
        ...session.health,
        partialGaps: gaps,
        debuggerAttached: attached.size > 0,
        debuggerEverAttached: everAttached,
      },
    };
  });
}

/** Await in-flight body fetches before debugger detach. */
export async function flushPendingBodyCaptures(): Promise<void> {
  await Promise.all([...pendingBodyCaptures]);
  const session = await getActiveSession();
  if (!session || attachedTabIds.size === 0) return;

  const sweep = async (key: string, base: NetworkEntry): Promise<void> => {
    const tabId = base.tabId;
    if (tabId == null || !attachedTabIds.has(tabId) || !base.url || base.bodyCaptured || !base.statusCode) return;
    if (!session.options.captureBodies && !base.oneRequestCapture) return;
    const bodies = await captureBodiesForRequest(tabId, base.requestId, base, base.oneRequestCapture === true);
    if (Object.keys(bodies).length === 0) return;
    const updated: NetworkEntry = { ...base, ...bodies };
    pendingCdp.set(key, updated);
    await upsertNetwork(updated);
  };

  for (const [key, pending] of pendingCdp) await sweep(key, pending as NetworkEntry);
  const stored = await readSessionData();
  for (const entry of stored.network) {
    if (entry.bodyCaptured || !entry.requestId || entry.tabId == null) continue;
    await sweep(pendingKey(entry.tabId, entry.requestId), entry);
  }
}
