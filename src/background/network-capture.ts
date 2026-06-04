import type { NetworkEntry } from "../shared/types.js";
import { appendNetworkEntry, readStorage } from "../shared/storage.js";

/** Pending requests keyed by chrome requestId. */
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

async function isCaptureActive(): Promise<{ sessionId: string } | null> {
  const { session } = await readStorage();
  if (!session?.active) return null;
  return { sessionId: session.id };
}

async function flush(requestId: string, patch: Partial<NetworkEntry>): Promise<void> {
  const ctx = await isCaptureActive();
  if (!ctx) return;

  const existing = pending.get(requestId) ?? {
    id: crypto.randomUUID(),
    sessionId: ctx.sessionId,
    requestId,
    timestamp: Date.now(),
    url: "",
    method: "GET",
    type: "other" as chrome.webRequest.ResourceType,
  };

  const merged = { ...existing, ...patch } as NetworkEntry;
  pending.set(requestId, merged);

  if (merged.url && merged.method) {
    await appendNetworkEntry(merged as NetworkEntry);
  }
}

function onBeforeRequest(
  details: chrome.webRequest.WebRequestBodyDetails | chrome.webRequest.WebRequestHeadersDetails,
): void {
  void flush(details.requestId, {
    timestamp: details.timeStamp,
    url: details.url,
    method: details.method,
    type: details.type,
    tabId: details.tabId >= 0 ? details.tabId : undefined,
  });
}

function onBeforeSendHeaders(details: chrome.webRequest.WebRequestHeadersDetails): void {
  void flush(details.requestId, {
    requestHeaders: headersToRecord(details.requestHeaders),
  });
}

function onHeadersReceived(details: chrome.webRequest.WebResponseHeadersDetails): void {
  void flush(details.requestId, {
    statusCode: details.statusCode,
    statusLine: details.statusLine,
    responseHeaders: headersToRecord(details.responseHeaders),
  });
}

function onCompleted(details: chrome.webRequest.WebResponseCacheDetails): void {
  void flush(details.requestId, {
    statusCode: details.statusCode,
    ip: details.ip,
    fromCache: details.fromCache,
  });
  pending.delete(details.requestId);
}

function onErrorOccurred(details: chrome.webRequest.WebResponseErrorDetails): void {
  void flush(details.requestId, { error: details.error });
  pending.delete(details.requestId);
}

const filter: chrome.webRequest.RequestFilter = { urls: ["<all_urls>"] };

/**
 * Passive network metadata via webRequest (MV3).
 * Does not capture response bodies. See README for limits and future debugger/DevTools paths.
 */
export function registerNetworkCapture(): void {
  chrome.webRequest.onBeforeRequest.addListener(onBeforeRequest, filter);
  chrome.webRequest.onBeforeSendHeaders.addListener(onBeforeSendHeaders, filter, [
    "requestHeaders",
  ]);
  chrome.webRequest.onHeadersReceived.addListener(onHeadersReceived, filter, [
    "responseHeaders",
  ]);
  chrome.webRequest.onCompleted.addListener(onCompleted, filter);
  chrome.webRequest.onErrorOccurred.addListener(onErrorOccurred, filter);
}
