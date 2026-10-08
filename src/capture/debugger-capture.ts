import {
  appendConsole,
  patchSession,
  readSessionData,
  upsertNetwork,
} from "../persistence/store.js";
import { updateDebuggerHealth } from "../persistence/session-recovery.js";
import { captureBodiesForRequest } from "./body-capture.js";
import { getActiveSession } from "./session-manager.js";
import type { ConsoleEntry, NetworkEntry } from "../shared/types.js";
import { isOriginAllowed } from "../shared/urls.js";

const CDP_VERSION = "1.3";
const pendingCdp = new Map<string, Partial<NetworkEntry>>();
const pendingBodyCaptures = new Set<Promise<void>>();
let attachedTabId: number | null = null;
let recoverTimer: ReturnType<typeof setTimeout> | null = null;
let onDebuggerCanceledByUser: (() => void) | null = null;

export function setOnDebuggerCanceledByUser(handler: (() => void) | null): void {
  onDebuggerCanceledByUser = handler;
}

async function sessionTab(): Promise<number | null> {
  const session = await getActiveSession();
  return session?.tabId ?? null;
}

async function detachChromeDebugger(tabId: number): Promise<void> {
  try {
    await chrome.debugger.detach({ tabId });
  } catch {
    /* not attached */
  }
}

async function recordAttachFailure(tabId: number, chromeAttached: boolean, message: string): Promise<void> {
  if (chromeAttached) await detachChromeDebugger(tabId);
  attachedTabId = null;
  await patchSession((session) => {
    if (!session) return session;
    return {
      ...session,
      health: {
        ...session.health,
        debuggerAttached: false,
        lastAttachError: message,
        partialGaps: [...session.health.partialGaps, { at: Date.now(), reason: `debugger_attach_failed: ${message}` }],
      },
    };
  });
}

async function syncDebuggerHealthIfAttached(): Promise<void> {
  if (attachedTabId == null) return;
  await patchSession((session) => {
    if (!session?.active || session.health.debuggerAttached) return session;
    return {
      ...session,
      health: {
        ...session.health,
        debuggerAttached: true,
        debuggerEverAttached: true,
        lastAttachError: undefined,
      },
    };
  });
}

export async function attachDebugger(tabId: number): Promise<void> {
  await detachChromeDebugger(tabId);
  if (attachedTabId === tabId) attachedTabId = null;

  let chromeAttached = false;
  try {
    await chrome.debugger.attach({ tabId }, CDP_VERSION);
    chromeAttached = true;
    await chrome.debugger.sendCommand({ tabId }, "Network.enable");
    await chrome.debugger.sendCommand({ tabId }, "Runtime.enable");
    await chrome.debugger.sendCommand({ tabId }, "Log.enable");
    attachedTabId = tabId;
    await updateDebuggerHealth({ attached: true });
  } catch (err) {
    await recordAttachFailure(tabId, chromeAttached, (err as Error).message);
    throw err;
  }
}

export async function detachDebugger(): Promise<void> {
  const tabId = attachedTabId;
  if (tabId == null) return;
  try {
    await chrome.debugger.detach({ tabId });
  } catch {
    /* already detached */
  }
  attachedTabId = null;
  const session = await getActiveSession();
  if (session?.active) await updateDebuggerHealth({ detached: true });
}

async function tryRecover(): Promise<void> {
  const tabId = await sessionTab();
  if (tabId == null) return;
  try {
    await attachDebugger(tabId);
    await updateDebuggerHealth({ recovered: true });
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
  if (!session || source.tabId !== session.tabId) return;
  if (session.paused) return;
  const p = (params ?? {}) as Record<string, unknown>;

  if (session.options.captureConsole && (method.startsWith("Runtime.") || method === "Log.entryAdded")) {
    await captureConsoleEvent(session.id, source.tabId ?? -1, method, p);
    return;
  }

  if (method === "Network.requestWillBeSent") {
    const request = p.request as
      | { url?: string; method?: string; headers?: Record<string, string>; documentURL?: string }
      | undefined;
    if (!isOriginAllowed(request?.url, session.options.allowedOrigins)) {
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
    const previous = pendingCdp.get(requestId) as NetworkEntry | undefined;
    const initiator = p.initiator as
      | { type?: string; url?: string; requestId?: string; lineNumber?: number; columnNumber?: number }
      | undefined;
    const requestTimestamp = typeof p.wallTime === "number" ? eventTimestamp(p.wallTime) : Date.now();
    pendingCdp.set(requestId, {
      id: crypto.randomUUID(),
      sessionId: session.id,
      requestId,
      timestamp: requestTimestamp,
      url: request?.url ?? "",
      method: request?.method ?? "GET",
      type: String(p.type ?? "other"),
      tabId: source.tabId,
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
    const base = pendingCdp.get(requestId) ?? { requestId, sessionId: session.id };
    const responseTimestamp = Date.now();
    const contentType = response?.mimeType ?? Object.entries(response?.headers ?? {}).find(([key]) => key.toLowerCase() === "content-type")?.[1];
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
      tabId: source.tabId,
      fromCache: response?.fromDiskCache,
      fromServiceWorker: response?.fromServiceWorker,
      connectionReused: response?.connectionReused,
    };
    entry.timing = completedTiming(entry, responseTimestamp);
    pendingCdp.set(requestId, entry);
    await upsertNetwork(entry);
  }

  if (method === "Network.loadingFailed") {
    const requestId = String(p.requestId ?? "");
    const pending = pendingCdp.get(requestId);
    if (pending) {
      const failed = {
        ...(pending as NetworkEntry),
        sessionId: session.id,
        error: String(p.errorText ?? "network loading failed"),
      };
      failed.timing = completedTiming(failed, Date.now());
      await upsertNetwork(failed);
    }
  }

  if (method === "Network.loadingFinished") {
    const requestId = String(p.requestId ?? "");
    const pending = pendingCdp.get(requestId);
    if (!pending?.url || source.tabId == null) return;
    const base = pending as NetworkEntry;
    const job = (async () => {
      const completed: NetworkEntry = { ...base, timing: completedTiming(base, Date.now()) };
      pendingCdp.set(requestId, completed);
      await upsertNetwork(completed);
      const bodies = await captureBodiesForRequest(source.tabId as number, requestId, completed);
      if (Object.keys(bodies).length === 0) return;
      const updated: NetworkEntry = { ...completed, ...bodies };
      pendingCdp.set(requestId, updated);
      await upsertNetwork(updated);
    })();
    pendingBodyCaptures.add(job);
    void job.finally(() => pendingBodyCaptures.delete(job));
  }
}

export function registerDebuggerCapture(): void {
  chrome.debugger.onEvent.addListener((source, method, params) => {
    void onDebuggerEvent(source, method, params);
  });

  chrome.debugger.onDetach.addListener((_source, reason) => {
    attachedTabId = null;
    void (async () => {
      const session = await getActiveSession();
      if (session?.active) {
        await updateDebuggerHealth({ detached: true });
        scheduleRecover();
      }
      await patchSession((current) => {
        if (!current) return current;
        return {
          ...current,
          health: {
            ...current.health,
            partialGaps: [...current.health.partialGaps, { at: Date.now(), reason: `debugger_detach: ${reason}` }],
          },
        };
      });
    })();

    if (reason === "canceled_by_user") onDebuggerCanceledByUser?.();
  });
}

export async function ensureDebuggerForSession(): Promise<void> {
  const tabId = await sessionTab();
  if (tabId == null) return;
  if (attachedTabId === tabId) {
    await syncDebuggerHealthIfAttached();
    return;
  }
  await attachDebugger(tabId);
}

/** Test helper — clear in-memory debugger state between isolated runs. */
export function resetDebuggerCaptureForTests(): void {
  attachedTabId = null;
  if (recoverTimer) {
    clearTimeout(recoverTimer);
    recoverTimer = null;
  }
  pendingCdp.clear();
  pendingBodyCaptures.clear();
}

export function getAttachedTabId(): number | null {
  return attachedTabId;
}

export function isDebuggerAttachedToTab(tabId: number): boolean {
  return attachedTabId === tabId;
}

/** Snapshot debugger health for export before detach clears in-memory state. */
export async function snapshotDebuggerHealthForExport(): Promise<void> {
  const tabId = attachedTabId;
  await patchSession((session) => {
    if (!session) return session;
    const attached = session.health.debuggerAttached || tabId != null;
    const everAttached = Boolean(session.health.debuggerEverAttached || attached);
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
      health: {
        ...session.health,
        partialGaps: gaps,
        debuggerAttached: attached,
        debuggerEverAttached: everAttached,
      },
    };
  });
}

/** Await in-flight body fetches before debugger detach. */
export async function flushPendingBodyCaptures(): Promise<void> {
  await Promise.all([...pendingBodyCaptures]);
  const tabId = attachedTabId;
  if (tabId == null) return;
  const session = await getActiveSession();
  if (!session?.options.captureBodies) return;

  const sweep = async (requestId: string, base: NetworkEntry): Promise<void> => {
    if (!base.url || base.bodyCaptured || !base.statusCode) return;
    const bodies = await captureBodiesForRequest(tabId, requestId, base);
    if (Object.keys(bodies).length === 0) return;
    const updated: NetworkEntry = { ...base, ...bodies };
    pendingCdp.set(requestId, updated);
    await upsertNetwork(updated);
  };

  for (const [requestId, pending] of pendingCdp) await sweep(requestId, pending as NetworkEntry);
  const stored = await readSessionData();
  for (const entry of stored.network) {
    if (entry.bodyCaptured || !entry.requestId) continue;
    await sweep(entry.requestId, entry);
  }
}
