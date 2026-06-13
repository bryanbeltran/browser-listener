import { withSession } from "../persistence/store.js";
import { recordHealthGap } from "../persistence/store.js";
import { redactDeep, redactString } from "../redaction/engine.js";
import { getActiveSession } from "./session-manager.js";
import type { NetworkEntry } from "../shared/types.js";

export const API_BODY_LIMITS = {
  perResponse: 256 * 1024,
  /** Feed / UFI GraphQL responses are often multi-line and >256KB. */
  perResponseLarge: 1024 * 1024,
  perSession: 50 * 1024 * 1024,
} as const;

const LARGE_BODY_QUERY =
  /CometNewsFeedPagination|CometSinglePostDialog|CometUFI|Comments|StoriesPagination|GroupsCometFeed|CometGroupRoot|Story|permalink/i;

export function apiBodyCapForRequest(postData?: string): number {
  if (!postData) return API_BODY_LIMITS.perResponse;
  const name = new URLSearchParams(postData).get("fb_api_req_friendly_name") ?? "";
  return LARGE_BODY_QUERY.test(name)
    ? API_BODY_LIMITS.perResponseLarge
    : API_BODY_LIMITS.perResponse;
}

const API_BODY_PATHS = [/\/api\/graphql\/?$/i, /\/ajax\/bulk-route-definitions\/?$/i];

export function shouldCaptureApiBody(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    if (!host.endsWith("facebook.com")) return false;
    const path = new URL(url).pathname;
    return API_BODY_PATHS.some((pattern) => pattern.test(path));
  } catch {
    return false;
  }
}

export function decodeCdpBody(body: string, base64Encoded: boolean): string {
  if (!base64Encoded) return body;
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function prepareBodyForStorage(
  raw: string,
  maxBytes: number,
): { text: string; byteLength: number; truncated: boolean } {
  let text: string;
  try {
    text = JSON.stringify(redactDeep(JSON.parse(raw)));
  } catch {
    text = redactString(raw);
  }

  const encoded = new TextEncoder().encode(text);
  if (encoded.length <= maxBytes) {
    return { text, byteLength: encoded.length, truncated: false };
  }

  const slice = encoded.slice(0, maxBytes);
  return {
    text: new TextDecoder().decode(slice),
    byteLength: maxBytes,
    truncated: true,
  };
}

export async function tryReserveApiBodyBytes(byteCount: number): Promise<boolean> {
  if (byteCount <= 0) return true;
  let allowed = false;
  await withSession((data) => {
    if (!data.session?.active) return data;
    const health = data.session.health;
    const stored = health.apiBodyBytesStored ?? 0;
    if (stored + byteCount > API_BODY_LIMITS.perSession) {
      health.apiBodiesSkippedSessionCap = (health.apiBodiesSkippedSessionCap ?? 0) + 1;
      return data;
    }
    health.apiBodyBytesStored = stored + byteCount;
    allowed = true;
    return data;
  });
  return allowed;
}

function markPerResponseTruncated(): void {
  void withSession((data) => {
    if (!data.session) return data;
    const health = data.session.health;
    health.apiBodiesPerResponseTruncated = (health.apiBodiesPerResponseTruncated ?? 0) + 1;
    return data;
  });
}

export async function captureApiBodiesForRequest(
  tabId: number,
  requestId: string,
  entry: NetworkEntry,
): Promise<Partial<NetworkEntry>> {
  if (!shouldCaptureApiBody(entry.url)) return {};

  const session = await getActiveSession();
  if (!session?.options.graphqlBodies) return {};

  const patch: Partial<NetworkEntry> = {};
  let totalBytes = 0;
  let anyTruncated = false;
  let responseCap = API_BODY_LIMITS.perResponse;

  try {
    const req = (await chrome.debugger.sendCommand({ tabId }, "Network.getRequestPostData", {
      requestId,
    })) as { postData?: string };
    responseCap = apiBodyCapForRequest(req.postData);
    if (req.postData) {
      const prep = prepareBodyForStorage(req.postData, responseCap);
      patch.requestBody = prep.text;
      patch.requestBodyTruncated = prep.truncated;
      patch.requestBodySize = prep.byteLength;
      totalBytes += prep.byteLength;
      if (prep.truncated) anyTruncated = true;
    }
  } catch {
    /* GET or no post data */
  }

  try {
    const res = (await chrome.debugger.sendCommand({ tabId }, "Network.getResponseBody", {
      requestId,
    })) as { body: string; base64Encoded: boolean };
    const raw = decodeCdpBody(res.body, res.base64Encoded);
    const prep = prepareBodyForStorage(raw, responseCap);
    patch.responseBody = prep.text;
    patch.responseBodyTruncated = prep.truncated;
    patch.responseBodySize = prep.byteLength;
    totalBytes += prep.byteLength;
    if (prep.truncated) anyTruncated = true;
    const headers = entry.responseHeaders ?? {};
    patch.contentType =
      headers["content-type"] ?? headers["Content-Type"] ?? "application/json";
    patch.bodyCaptured = true;
  } catch (err) {
    void recordHealthGap(`api_body_capture_failed: ${(err as Error).message}`);
    return {};
  }

  if (totalBytes === 0) return {};

  const reserved = await tryReserveApiBodyBytes(totalBytes);
  if (!reserved) return {};

  if (anyTruncated) markPerResponseTruncated();
  return patch;
}
