import { patchSession, recordHealthGap } from "../persistence/store.js";
import { BODY_CAPTURE_LIMITS } from "../persistence/limits.js";
import { redactBodyText } from "../redaction/engine.js";
import { getActiveSession } from "./session-manager.js";
import type { NetworkEntry } from "../shared/types.js";

const SAFE_EXACT_MIME_TYPES = new Set([
  "application/json",
  "application/javascript",
  "application/x-javascript",
  "application/xml",
  "application/x-www-form-urlencoded",
]);

function mimeType(contentType: string | undefined): string {
  return contentType?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

export function isSafeBodyMimeType(contentType: string | undefined): boolean {
  const type = mimeType(contentType);
  return type.startsWith("text/") || SAFE_EXACT_MIME_TYPES.has(type) || type.endsWith("+json");
}

export function shouldCaptureBody(contentType: string | undefined): boolean {
  return isSafeBodyMimeType(contentType);
}

export function decodeCdpBody(body: string, base64Encoded: boolean): string {
  if (!base64Encoded) return body;
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function truncateUtf8(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength <= maxBytes) return { text, truncated: false };
  return {
    text: new TextDecoder().decode(bytes.slice(0, maxBytes)),
    truncated: true,
  };
}

export function prepareBodyForStorage(raw: string): {
  text: string;
  byteLength: number;
  truncated: boolean;
} {
  const redacted = redactBodyText(raw);
  const limited = truncateUtf8(redacted, BODY_CAPTURE_LIMITS.perResponseBytes);
  return {
    text: limited.text,
    byteLength: new TextEncoder().encode(limited.text).byteLength,
    truncated: limited.truncated,
  };
}

/** Reserve bounded body bytes before persisting them. */
export async function tryReserveBodyBytes(byteCount: number): Promise<boolean> {
  if (byteCount <= 0) return true;
  let allowed = false;
  await patchSession((session) => {
    if (!session?.active) return session;
    const stored = session.health.bodyBytesStored ?? 0;
    if (stored + byteCount > BODY_CAPTURE_LIMITS.sessionBytes) {
      return {
        ...session,
        health: {
          ...session.health,
          bodiesSkippedSessionCap: (session.health.bodiesSkippedSessionCap ?? 0) + 1,
        },
      };
    }
    allowed = true;
    return {
      ...session,
      health: {
        ...session.health,
        bodyBytesStored: stored + byteCount,
      },
    };
  });
  return allowed;
}

export async function recordBodyTruncation(): Promise<void> {
  await patchSession((session) => {
    if (!session) return session;
    return {
      ...session,
      health: {
        ...session.health,
        bodiesPerResponseTruncated: (session.health.bodiesPerResponseTruncated ?? 0) + 1,
      },
    };
  });
}

function headerValue(headers: Record<string, string> | undefined): string | undefined {
  if (!headers) return undefined;
  const key = Object.keys(headers).find((name) => name.toLowerCase() === "content-type");
  return key ? headers[key] : undefined;
}

export async function captureBodiesForRequest(
  tabId: number,
  requestId: string,
  entry: NetworkEntry,
): Promise<Partial<NetworkEntry>> {
  const session = await getActiveSession();
  if (!session?.options.captureBodies) return {};

  const patch: Partial<NetworkEntry> = {};
  let totalBytes = 0;
  let truncated = false;

  const requestType = headerValue(entry.requestHeaders);
  if (requestType && isSafeBodyMimeType(requestType)) {
    try {
      const req = (await chrome.debugger.sendCommand({ tabId }, "Network.getRequestPostData", {
        requestId,
      })) as { postData?: string };
      if (req.postData) {
        const prepared = prepareBodyForStorage(req.postData);
        patch.requestBody = prepared.text;
        patch.requestBodyTruncated = prepared.truncated;
        patch.requestBodySize = prepared.byteLength;
        totalBytes += prepared.byteLength;
        truncated ||= prepared.truncated;
      }
    } catch {
      /* GET or no post data */
    }
  }

  const responseType = entry.contentType ?? headerValue(entry.responseHeaders);
  if (shouldCaptureBody(responseType)) {
    try {
      const res = (await chrome.debugger.sendCommand({ tabId }, "Network.getResponseBody", {
        requestId,
      })) as { body: string; base64Encoded: boolean };
      const prepared = prepareBodyForStorage(decodeCdpBody(res.body, res.base64Encoded));
      patch.responseBody = prepared.text;
      patch.responseBodyTruncated = prepared.truncated;
      patch.responseBodySize = prepared.byteLength;
      patch.contentType = responseType;
      totalBytes += prepared.byteLength;
      truncated ||= prepared.truncated;
    } catch (err) {
      void recordHealthGap(`body_capture_failed: ${(err as Error).message}`);
    }
  }

  if (truncated) await recordBodyTruncation();
  if (totalBytes === 0) return {};
  if (!(await tryReserveBodyBytes(totalBytes))) return {};
  return { ...patch, bodyCaptured: true };
}
