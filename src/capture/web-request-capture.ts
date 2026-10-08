import { upsertNetwork } from "../persistence/store.js";
import { isDebuggerAttachedToTab } from "./debugger-capture.js";
import { getActiveSession } from "./session-manager.js";
import type { NetworkEntry } from "../shared/types.js";

/** CDP is authoritative when attached; webRequest would duplicate entries. */
export function shouldUseWebRequestForTab(tabId: number | undefined, activeTabId: number): boolean {
  if (tabId != null && tabId >= 0 && tabId !== activeTabId) return false;
  return !isDebuggerAttachedToTab(activeTabId);
}

const pending = new Map<string, Partial<NetworkEntry>>();

function headersToRecord(
  headers: chrome.webRequest.HttpHeader[] | undefined,
): Record<string, string> | undefined {
  if (!headers?.length) return undefined;
  const out: Record<string, string> = {};
  for (const h of headers) {
    if (h.name && h.value != null) out[h.name] = h.value;
  }
  return Object.keys(out).length ? out : undefined;
}

async function flush(requestId: string, patch: Partial<NetworkEntry>): Promise<void> {
  const active = await getActiveSession();
  if (!active) return;
  if (!shouldUseWebRequestForTab(patch.tabId, active.tabId)) return;

  const existing = pending.get(requestId) ?? {
    id: crypto.randomUUID(),
    sessionId: active.id,
    requestId,
    timestamp: Date.now(),
    url: "",
    method: "GET",
    type: "other",
  };
  const merged = { ...existing, ...patch, sessionId: active.id } as NetworkEntry;
  pending.set(requestId, merged);
  if (merged.url) {
    await upsertNetwork(merged);
  }
}

const filter: chrome.webRequest.RequestFilter = {
  urls: ["https://facebook.com/*", "https://*.facebook.com/*"],
};

export function registerWebRequestCapture(): void {
  chrome.webRequest.onBeforeRequest.addListener(
    (d) => {
      void flush(d.requestId, {
        timestamp: d.timeStamp,
        url: d.url,
        method: d.method,
        type: d.type,
        tabId: d.tabId >= 0 ? d.tabId : undefined,
      });
    },
    filter,
  );
  chrome.webRequest.onBeforeSendHeaders.addListener(
    (d) => void flush(d.requestId, { requestHeaders: headersToRecord(d.requestHeaders) }),
    filter,
    ["requestHeaders"],
  );
  chrome.webRequest.onHeadersReceived.addListener(
    (d) =>
      void flush(d.requestId, {
        statusCode: d.statusCode,
        statusLine: d.statusLine,
        responseHeaders: headersToRecord(d.responseHeaders),
      }),
    filter,
    ["responseHeaders"],
  );
  chrome.webRequest.onCompleted.addListener(
    (d) => {
      void flush(d.requestId, {
        statusCode: d.statusCode,
        ip: d.ip,
        fromCache: d.fromCache,
        timing: { start: d.timeStamp, end: Date.now(), durationMs: 0 },
      });
      pending.delete(d.requestId);
    },
    filter,
  );
  chrome.webRequest.onErrorOccurred.addListener(
    (d) => {
      void flush(d.requestId, { error: d.error });
      pending.delete(d.requestId);
    },
    filter,
  );
}
