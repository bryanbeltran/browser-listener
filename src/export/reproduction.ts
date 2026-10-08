import { getRedactionConfig, REDACTED, redactBodyText, redactSensitiveString, redactUrl } from "../redaction/engine.js";
import { buildEvidenceCitation } from "./citations.js";
import type { NetworkEntry, ReproductionSnippets } from "../shared/types.js";

export interface ReproductionOptions {
  bundleId?: string;
  schemaVersion?: number;
  redactionEnabled?: boolean;
}

function shellQuote(value: string): string {
  return "'" + value.replaceAll("'", "'\"'\"'") + "'";
}

function headerIsSensitive(name: string): boolean {
  const lower = name.toLowerCase();
  return getRedactionConfig().sensitiveKeys.some((key) => lower.includes(key.toLowerCase()));
}

function safeHeaders(entry: NetworkEntry): { headers: Array<[string, string]>; omitted: string[] } {
  const headers: Array<[string, string]> = [];
  const omitted: string[] = [];
  for (const [name, value] of Object.entries(entry.requestHeaders ?? {})) {
    const safeValue = redactSensitiveString(value);
    if (headerIsSensitive(name) || safeValue === REDACTED || value !== safeValue) {
      omitted.push(`request header: ${name}`);
      continue;
    }
    headers.push([name, safeValue]);
  }
  return { headers, omitted };
}

function safeBody(entry: NetworkEntry, redactionEnabled: boolean): { body?: string; omitted?: string } {
  if (entry.requestBody == null) return {};
  if (!redactionEnabled) return { omitted: "request body omitted because redaction is disabled" };
  const body = redactBodyText(entry.requestBody);
  if (body.includes(REDACTED)) return { omitted: "request body omitted because it contains redacted values" };
  return { body };
}

function buildCurl(method: string, url: string, headers: Array<[string, string]>, body?: string): string {
  const lines = [`curl --request ${shellQuote(method)} ${shellQuote(url)}`];
  for (const [name, value] of headers) lines.push(`  --header ${shellQuote(`${name}: ${value}`)}`);
  if (body != null) lines.push(`  --data-raw ${shellQuote(body)}`);
  return lines.join(" \\\n");
}

function buildFetch(method: string, url: string, headers: Array<[string, string]>, body?: string): string {
  const lines = [`fetch(${JSON.stringify(url)}, {`, `  method: ${JSON.stringify(method)},`];
  if (headers.length) {
    lines.push("  headers: {");
    for (const [name, value] of headers) lines.push(`    ${JSON.stringify(name)}: ${JSON.stringify(value)},`);
    lines.push("  },");
  }
  if (body != null) lines.push(`  body: ${JSON.stringify(body)},`);
  lines.push("});");
  return lines.join("\n");
}

function buildHttpie(method: string, url: string, headers: Array<[string, string]>, body?: string): string {
  const parts = ["http", shellQuote(method), shellQuote(url)];
  parts.push(...headers.map(([name, value]) => shellQuote(`${name}:${value}`)));
  if (body != null) parts.push(`<<< ${shellQuote(body)}`);
  return parts.join(" ");
}

export function buildReproductionSnippets(
  entry: NetworkEntry,
  options: ReproductionOptions = {},
): ReproductionSnippets {
  const redactionEnabled = options.redactionEnabled !== false;
  const url = redactUrl(entry.url);
  const safe = safeHeaders(entry);
  const body = safeBody(entry, redactionEnabled);
  const omitted = [...safe.omitted];
  if (url !== entry.url) omitted.push("sensitive URL query values redacted");
  if (body.omitted) omitted.push(body.omitted);
  if (!redactionEnabled) omitted.push("redaction was disabled for the source capture");
  const method = entry.method || "GET";
  const bundleId = options.bundleId ?? entry.sessionId;
  const schemaVersion = options.schemaVersion ?? 3;
  return {
    citation: buildEvidenceCitation(bundleId, "raw.har", entry.id, schemaVersion),
    curl: buildCurl(method, url, safe.headers, body.body),
    fetch: buildFetch(method, url, safe.headers, body.body),
    httpie: buildHttpie(method, url, safe.headers, body.body),
    context: {
      method,
      url,
      statusCode: entry.statusCode,
      startedAt: entry.timing?.start ?? entry.timestamp,
      durationMs: entry.timing?.durationMs,
      bodyIncluded: body.body != null,
      omitted: [...new Set(omitted)],
    },
  };
}
