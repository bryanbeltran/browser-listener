import type { NetworkEntry } from "../shared/types.js";

export function parseGraphqlFormBody(body?: string): Record<string, string> {
  if (!body) return {};
  const params = new URLSearchParams(body);
  const out: Record<string, string> = {};
  params.forEach((v, k) => {
    out[k] = v;
  });
  return out;
}

export function isFacebookGraphqlUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname.endsWith("facebook.com") && /\/api\/graphql\/?$/i.test(u.pathname);
  } catch {
    return false;
  }
}

/** Most recent facebook.com GraphQL POST form fields (session + routing tokens). */
export function findGraphqlRequestTemplate(network: NetworkEntry[]): Record<string, string> | null {
  for (let i = network.length - 1; i >= 0; i--) {
    const entry = network[i];
    if (!isFacebookGraphqlUrl(entry.url)) continue;
    if (entry.method !== "POST") continue;
    const form = parseGraphqlFormBody(entry.requestBody);
    if (!form.fb_dtsg && !form.lsd) continue;
    return { ...form };
  }
  return null;
}

export function findGraphqlDocId(network: NetworkEntry[], friendlyName: string): string | undefined {
  for (let i = network.length - 1; i >= 0; i--) {
    const entry = network[i];
    if (!isFacebookGraphqlUrl(entry.url)) continue;
    const form = parseGraphqlFormBody(entry.requestBody);
    if (form.fb_api_req_friendly_name === friendlyName && form.doc_id) {
      return form.doc_id;
    }
  }
  return undefined;
}

export function buildGraphqlFormBody(
  template: Record<string, string>,
  opts: {
    friendlyName: string;
    docId: string;
    variables: Record<string, unknown>;
  },
): Record<string, string> {
  const fields: Record<string, string> = { ...template };
  fields.fb_api_caller_class = fields.fb_api_caller_class ?? "RelayModern";
  fields.fb_api_req_friendly_name = opts.friendlyName;
  fields.server_timestamps = fields.server_timestamps ?? "true";
  fields.doc_id = opts.docId;
  fields.variables = JSON.stringify(opts.variables);
  return fields;
}

export function tabContentRefetchVariables(
  feedbackId: string,
  reactionId: string,
  cursor: string | null = null,
  count = 10,
): Record<string, unknown> {
  return {
    count,
    cursor,
    feedbackTargetID: feedbackId,
    reactionID: reactionId,
    scale: 2,
    id: feedbackId,
  };
}

export function tooltipReactionVariables(
  feedbackId: string,
  reactionId: string,
): Record<string, unknown> {
  return {
    feedbackTargetID: feedbackId,
    reactionID: reactionId,
  };
}
