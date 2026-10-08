import { patchSession, recordHealthGap } from "../persistence/store.js";
import { BODY_CAPTURE_LIMITS } from "../persistence/limits.js";
import { redactBodyText } from "../redaction/engine.js";
import { getActiveSession } from "./session-manager.js";
import type { BodyEncoding, BodySkipReason, CoverageState, NetworkEntry } from "../shared/types.js";
import { normalizeCaptureFields } from "../shared/types.js";
import { policyForSession } from "../shared/field-policy.js";

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

export function prepareBodyForStorage(raw: string, redact = true): {
  text: string;
  byteLength: number;
  truncated: boolean;
  redacted: boolean;
} {
  const preparedText = redact ? redactBodyText(raw) : raw;
  const limited = truncateUtf8(preparedText, BODY_CAPTURE_LIMITS.perResponseBytes);
  return {
    text: limited.text,
    byteLength: new TextEncoder().encode(limited.text).byteLength,
    truncated: limited.truncated,
    redacted: redact && preparedText !== raw,
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
  force = false,
): Promise<Partial<NetworkEntry>> {
  const session = await getActiveSession();
  const policy = session ? policyForSession(session, entry.policyEpochId) : undefined;
  if (!session || (!policy?.captureBodies && !force)) return {};
  const redact = session.options.redactionEnabled !== false;
  const fields = normalizeCaptureFields(policy?.fields ?? session.options.fields);

  const patch: Partial<NetworkEntry> = {};
  let totalBytes = 0;
  let truncated = false;
  let capturedBody = false;
  const capturedDirections: ("request" | "response")[] = [];

  const setDecision = (
    direction: "request" | "response",
    state: CoverageState,
    reason?: BodySkipReason,
  ): void => {
    if (direction === "request") {
      patch.requestBodyState = state;
      patch.requestBodySkipReason = reason;
    } else {
      patch.responseBodyState = state;
      patch.responseBodySkipReason = reason;
    }
  };

  const stateForBody = (prepared: { redacted: boolean; truncated: boolean }): CoverageState =>
    prepared.truncated ? "truncated" : prepared.redacted ? "redacted" : "observed";

  const requestType = headerValue(entry.requestHeaders);
  if (!fields.requestBodies) {
    setDecision("request", "excluded", "field-disabled");
  } else if (!requestType) {
    setDecision(
      "request",
      entry.method === "GET" || entry.method === "HEAD" ? "unavailable" : "excluded",
      entry.method === "GET" || entry.method === "HEAD" ? "no-body" : "missing-mime-type",
    );
  } else if (!isSafeBodyMimeType(requestType)) {
    setDecision("request", "excluded", "unsafe-mime-type");
  } else {
    try {
      const req = (await chrome.debugger.sendCommand({ tabId }, "Network.getRequestPostData", {
        requestId,
      })) as { postData?: string };
      if (req.postData != null) {
        const prepared = prepareBodyForStorage(req.postData, redact);
        patch.requestBody = prepared.text;
        patch.requestBodyTruncated = prepared.truncated;
        patch.requestBodySize = prepared.byteLength;
        patch.requestBodyEncoding = "utf-8" satisfies BodyEncoding;
        setDecision("request", stateForBody(prepared), prepared.truncated ? "per-response-cap" : undefined);
        totalBytes += prepared.byteLength;
        truncated ||= prepared.truncated;
        capturedBody = true;
        capturedDirections.push("request");
      } else {
        setDecision("request", "unavailable", "no-body");
      }
    } catch {
      setDecision("request", "unavailable", "body-unavailable");
    }
  }

  const responseType = entry.contentType ?? headerValue(entry.responseHeaders);
  if (!fields.responseBodies) {
    setDecision("response", "excluded", "field-disabled");
  } else if (!responseType) {
    setDecision("response", "excluded", "missing-mime-type");
  } else if (!shouldCaptureBody(responseType)) {
    setDecision("response", "excluded", "unsafe-mime-type");
  } else {
    try {
      const res = (await chrome.debugger.sendCommand({ tabId }, "Network.getResponseBody", {
        requestId,
      })) as { body: string; base64Encoded: boolean };
      const prepared = prepareBodyForStorage(decodeCdpBody(res.body, res.base64Encoded), redact);
      patch.responseBody = prepared.text;
      patch.responseBodyTruncated = prepared.truncated;
      patch.responseBodySize = prepared.byteLength;
      patch.responseBodyEncoding = res.base64Encoded ? "base64" : "utf-8";
      setDecision("response", stateForBody(prepared), prepared.truncated ? "per-response-cap" : undefined);
      patch.contentType = responseType;
      totalBytes += prepared.byteLength;
      truncated ||= prepared.truncated;
      capturedBody = true;
      capturedDirections.push("response");
    } catch (err) {
      setDecision("response", "unavailable", "capture-error");
      void recordHealthGap(`body_capture_failed: ${(err as Error).message}`);
    }
  }

  if (truncated) await recordBodyTruncation();
  if (totalBytes > 0 && !(await tryReserveBodyBytes(totalBytes))) {
    for (const direction of capturedDirections) {
      if (direction === "request") {
        patch.requestBody = undefined;
        patch.requestBodySize = undefined;
        patch.requestBodyTruncated = undefined;
      } else {
        patch.responseBody = undefined;
        patch.responseBodySize = undefined;
        patch.responseBodyTruncated = undefined;
      }
      setDecision(direction, "dropped", "session-budget");
    }
    return { ...patch, bodyCaptured: false };
  }
  return capturedBody ? { ...patch, bodyCaptured: true } : patch;
}
