import type { NetworkEntry } from "../shared/types.js";

export interface GraphqlCaptureRecord {
  networkId: string;
  timestamp: number;
  url: string;
  docId?: string;
  friendlyName?: string;
  requestBody?: string;
  responseBody?: string;
  statusCode?: number;
  requestBodyTruncated?: boolean;
  responseBodyTruncated?: boolean;
}

function isFacebookGraphql(entry: NetworkEntry): boolean {
  try {
    const u = new URL(entry.url);
    return u.hostname.endsWith("facebook.com") && /\/api\/graphql\/?$/i.test(u.pathname);
  } catch {
    return false;
  }
}

function parseFormBody(body?: string): Record<string, string> {
  if (!body) return {};
  const params = new URLSearchParams(body);
  const out: Record<string, string> = {};
  params.forEach((v, k) => {
    out[k] = v;
  });
  return out;
}

export function buildGraphqlCaptures(network: NetworkEntry[]): GraphqlCaptureRecord[] {
  const out: GraphqlCaptureRecord[] = [];
  for (const entry of network) {
    if (!isFacebookGraphql(entry)) continue;
    if (!entry.requestBody && !entry.responseBody) continue;
    const form = parseFormBody(entry.requestBody);
    out.push({
      networkId: entry.id,
      timestamp: entry.timestamp,
      url: entry.url,
      docId: form.doc_id,
      friendlyName: form.fb_api_req_friendly_name,
      requestBody: entry.requestBody,
      responseBody: entry.responseBody,
      statusCode: entry.statusCode,
      requestBodyTruncated: entry.requestBodyTruncated,
      responseBodyTruncated: entry.responseBodyTruncated,
    });
  }
  return out;
}
