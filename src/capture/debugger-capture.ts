import { broadcastCaptureState } from "../background/broadcast.js";
import { appendConsole, upsertNetwork } from "../persistence/store.js";
import { updateDebuggerHealth } from "../persistence/session-recovery.js";
import { recordHealthGap } from "../persistence/store.js";
import { getActiveSession } from "./session-manager.js";
import { recordTimeline } from "./timeline.js";
import type { ConsoleEntry, NetworkEntry } from "../shared/types.js";

const CDP_VERSION = "1.3";
const pendingCdp = new Map<string, Partial<NetworkEntry>>();
let attachedTabId: number | null = null;
let recoverTimer: ReturnType<typeof setTimeout> | null = null;

async function sessionTab(): Promise<number | null> {
  const s = await getActiveSession();
  return s?.tabId ?? null;
}

export async function attachDebugger(tabId: number): Promise<void> {
  try {
    await chrome.debugger.attach({ tabId }, CDP_VERSION);
    await chrome.debugger.sendCommand({ tabId }, "Network.enable");
    await chrome.debugger.sendCommand({ tabId }, "Runtime.enable");
    await chrome.debugger.sendCommand({ tabId }, "Log.enable");
    attachedTabId = tabId;
    await updateDebuggerHealth({ attached: true });
    const session = await getActiveSession();
    if (session?.active) {
      await broadcastCaptureState(true, session.id, true);
    }
    await recordTimeline(
      (await getActiveSession())?.id ?? "unknown",
      "system",
      "debugger_attach",
      `Debugger attached to tab ${tabId}`,
    );
  } catch (err) {
    await recordHealthGap(`debugger_attach_failed: ${(err as Error).message}`);
    throw err;
  }
}

export async function detachDebugger(): Promise<void> {
  if (attachedTabId == null) return;
  try {
    await chrome.debugger.detach({ tabId: attachedTabId });
  } catch {
    /* already detached */
  }
  attachedTabId = null;
  await updateDebuggerHealth({ detached: true });
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

  if (method === "Runtime.consoleAPICalled") {
    const args = ((p?.args as { value?: unknown; description?: string }[]) ?? []).map((a) =>
      String(a.description ?? a.value ?? ""),
    );
    const entry: ConsoleEntry = {
      id: crypto.randomUUID(),
      sessionId: session.id,
      timestamp: Date.now(),
      level: String(p?.type ?? "log") as ConsoleEntry["level"],
      args,
      url: session.tabUrl ?? "",
      tabId: source.tabId,
      source: "debugger",
    };
    await appendConsole(entry);
    await recordTimeline(session.id, "console", entry.level, args.join(" ").slice(0, 120));
  }

  if (method === "Runtime.exceptionThrown") {
    const details = p?.exceptionDetails as { text?: string; stackTrace?: { description?: string } };
    const entry: ConsoleEntry = {
      id: crypto.randomUUID(),
      sessionId: session.id,
      timestamp: Date.now(),
      level: "error",
      args: [details?.text ?? "exception"],
      url: session.tabUrl ?? "",
      stack: details?.stackTrace?.description,
      tabId: source.tabId,
      source: "debugger",
    };
    await appendConsole(entry);
    await recordTimeline(session.id, "console", "exception", entry.args.join(" ").slice(0, 120));
  }
}

export function registerDebuggerCapture(): void {
  chrome.debugger.onEvent.addListener((source, method, params) => {
    void onDebuggerEvent(source, method, params);
  });

  chrome.debugger.onDetach.addListener((_source, reason) => {
    attachedTabId = null;
    void updateDebuggerHealth({ detached: true });
    void recordHealthGap(`debugger_detach: ${reason}`);
    void getActiveSession().then((s) => {
      if (!s?.active) return;
      void broadcastCaptureState(true, s.id, false);
      scheduleRecover();
    });
  });
}

export async function ensureDebuggerForSession(): Promise<void> {
  const tabId = await sessionTab();
  if (tabId == null) return;
  if (attachedTabId === tabId) return;
  await attachDebugger(tabId);
}

export function getAttachedTabId(): number | null {
  return attachedTabId;
}

export function isDebuggerAttachedToTab(tabId: number): boolean {
  return attachedTabId === tabId;
}
