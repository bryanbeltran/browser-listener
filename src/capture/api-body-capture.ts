import { patchSession } from "../persistence/store.js";
import { recordHealthGap } from "../persistence/store.js";
import { redactDeep, redactString } from "../redaction/engine.js";
import { getActiveSession } from "./session-manager.js";
import type { NetworkEntry } from "../shared/types.js";

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

export function prepareBodyForStorage(raw: string): {
  text: string;
  byteLength: number;
  truncated: boolean;
} {
  let text: string;
  try {
    text = JSON.stringify(redactDeep(JSON.parse(raw)));
  } catch {
    text = redactString(raw);
  }

  const byteLength = new TextEncoder().encode(text).length;
  return { text, byteLength, truncated: false };
}

/** Track stored body bytes in session health (no cap). */
export async function tryReserveApiBodyBytes(byteCount: number): Promise<boolean> {
  if (byteCount <= 0) return true;
  await patchSession((session) => {
    if (!session?.active) return session;
    const health = session.health;
    health.apiBodyBytesStored = (health.apiBodyBytesStored ?? 0) + byteCount;
    return session;
  });
  return true;
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

  try {
    const req = (await chrome.debugger.sendCommand({ tabId }, "Network.getRequestPostData", {
      requestId,
    })) as { postData?: string };
    if (req.postData) {
      const prep = prepareBodyForStorage(req.postData);
      patch.requestBody = prep.text;
      patch.requestBodyTruncated = false;
      patch.requestBodySize = prep.byteLength;
      totalBytes += prep.byteLength;
    }
  } catch {
    /* GET or no post data */
  }

  try {
    const res = (await chrome.debugger.sendCommand({ tabId }, "Network.getResponseBody", {
      requestId,
    })) as { body: string; base64Encoded: boolean };
    const raw = decodeCdpBody(res.body, res.base64Encoded);
    const prep = prepareBodyForStorage(raw);
    patch.responseBody = prep.text;
    patch.responseBodyTruncated = false;
    patch.responseBodySize = prep.byteLength;
    totalBytes += prep.byteLength;
    const headers = entry.responseHeaders ?? {};
    patch.contentType =
      headers["content-type"] ?? headers["Content-Type"] ?? "application/json";
    patch.bodyCaptured = true;
  } catch (err) {
    void recordHealthGap(`api_body_capture_failed: ${(err as Error).message}`);
    return {};
  }

  if (totalBytes === 0) return {};

  await tryReserveApiBodyBytes(totalBytes);
  return patch;
}
