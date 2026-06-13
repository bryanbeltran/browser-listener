import { patchSession, readSessionData, upsertNetwork } from "../persistence/store.js";
import { updateDebuggerHealth } from "../persistence/session-recovery.js";
import { captureApiBodiesForRequest, shouldCaptureApiBody } from "./api-body-capture.js";
import { onCaptureGraphqlActivity } from "./reaction-hydration.js";
import { getActiveSession } from "./session-manager.js";
import type { NetworkEntry } from "../shared/types.js";

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
  const s = await getActiveSession();
  return s?.tabId ?? null;
}

async function detachChromeDebugger(tabId: number): Promise<void> {
  try {
    await chrome.debugger.detach({ tabId });
  } catch {
    /* not attached */
  }
}

async function recordAttachFailure(tabId: number, chromeAttached: boolean, message: string): Promise<void> {
  if (chromeAttached) {
    await detachChromeDebugger(tabId);
  }
  attachedTabId = null;
  await patchSession((session) => {
    if (!session) return session;
    return {
      ...session,
      health: {
        ...session.health,
        debuggerAttached: false,
        partialGaps: [
          ...session.health.partialGaps,
          { at: Date.now(), reason: `debugger_attach_failed: ${message}` },
        ],
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
  if (session?.active) {
    await updateDebuggerHealth({ detached: true });
  }
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

async function onDebuggerEvent(
  source: chrome.debugger.Debuggee,
  method: string,
  params?: object,
): Promise<void> {
  const session = await getActiveSession();
  if (!session || source.tabId !== session.tabId) return;
  const p = params as Record<string, unknown> | undefined;

  if (method === "Network.requestWillBeSent") {
    const request = p?.request as { url?: string; method?: string } | undefined;
    const requestId = String(p?.requestId ?? "");
    pendingCdp.set(requestId, {
      id: crypto.randomUUID(),
      sessionId: session.id,
      requestId,
      timestamp: Date.now(),
      url: request?.url ?? "",
      method: request?.method ?? "GET",
      type: String(p?.type ?? "other"),
      tabId: source.tabId,
      frameId: p?.frameId != null ? String(p.frameId) : undefined,
    });
  }

  if (method === "Network.responseReceived") {
    const requestId = String(p?.requestId ?? "");
    const response = p?.response as
      | { status?: number; statusText?: string; headers?: Record<string, string> }
      | undefined;
    const base = pendingCdp.get(requestId) ?? { requestId, sessionId: session.id };
    const entry: NetworkEntry = {
      ...(base as NetworkEntry),
      id: base.id ?? crypto.randomUUID(),
      sessionId: session.id,
      requestId,
      timestamp: Date.now(),
      url: (base as NetworkEntry).url ?? "",
      method: (base as NetworkEntry).method ?? "GET",
      type: (base as NetworkEntry).type ?? "other",
      statusCode: response?.status,
      statusLine: response?.statusText,
      responseHeaders: response?.headers,
      tabId: source.tabId,
    };
    pendingCdp.set(requestId, entry);
    await upsertNetwork(entry);
  }

  if (method === "Network.loadingFinished") {
    const requestId = String(p?.requestId ?? "");
    const pending = pendingCdp.get(requestId);
    if (!pending?.url || source.tabId == null) return;
    const tabId = source.tabId;
    const base = pending as NetworkEntry;
    const job = (async () => {
      const bodies = await captureApiBodiesForRequest(tabId, requestId, base);
      if (Object.keys(bodies).length === 0) return;
      const updated: NetworkEntry = { ...base, ...bodies };
      pendingCdp.set(requestId, updated);
      await upsertNetwork(updated);
      if (session.options.reactionHydration) {
        onCaptureGraphqlActivity(tabId, updated.requestBody);
      }
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
      await patchSession((s) => {
        if (!s) return s;
        return {
          ...s,
          health: {
            ...s.health,
            partialGaps: [
              ...s.health.partialGaps,
              { at: Date.now(), reason: `debugger_detach: ${reason}` },
            ],
          },
        };
      });
    })();

    if (reason === "canceled_by_user") {
      onDebuggerCanceledByUser?.();
    }
  });
}

export async function ensureDebuggerForSession(): Promise<void> {
  const tabId = await sessionTab();
  if (tabId == null) return;
  if (attachedTabId === tabId) return;
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
    if (!attached && !session.health.debuggerEverAttached) return session;
    return {
      ...session,
      health: {
        ...session.health,
        debuggerAttached: attached,
        debuggerEverAttached: true,
      },
    };
  });
}

/** Await in-flight body fetches and sweep pending CDP entries before debugger detach. */
export async function flushPendingApiBodyCaptures(): Promise<void> {
  await Promise.all([...pendingBodyCaptures]);
  const tabId = attachedTabId;
  if (tabId == null) return;
  const session = await getActiveSession();
  if (!session?.options.graphqlBodies) return;

  const sweep = async (requestId: string, base: NetworkEntry): Promise<void> => {
    if (!base.url || !shouldCaptureApiBody(base.url) || base.bodyCaptured) return;
    if (!base.statusCode) return;
    const bodies = await captureApiBodiesForRequest(tabId, requestId, base);
    if (Object.keys(bodies).length === 0) return;
    const updated: NetworkEntry = { ...base, ...bodies };
    pendingCdp.set(requestId, updated);
    await upsertNetwork(updated);
  };

  for (const [requestId, pending] of pendingCdp) {
    await sweep(requestId, pending as NetworkEntry);
  }

  const stored = await readSessionData();
  for (const entry of stored.network) {
    if (entry.bodyCaptured || !entry.requestId) continue;
    await sweep(entry.requestId, entry);
  }
}
