/**
 * Extract redacted Facebook GraphQL network fixtures from capture ZIPs.
 * Run once when refreshing fixtures: node scripts/build-facebook-fixtures.mjs
 */
/* global URL, URLSearchParams, TextDecoder */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT_DIR = join(ROOT, "tests/fixtures/facebook-captures");

const REDACTED = "[REDACTED]";

/** Source ZIPs → committed fixture names (GraphQL captures only). */
const SOURCES = [
  {
    name: "comments-dialog",
    zip: join(
      process.env.HOME ?? "",
      "Downloads/browser-listener-8cf1a523-c5d6-4b85-8be4-9ba62d966ae1-1781121454058.zip",
    ),
    tabUrl: "https://www.facebook.com/groups/richfieldmncommunity",
    description: "Single-post dialog with comments and tooltip-only reactions",
  },
  {
    name: "reactions-dialog",
    zip: join(
      process.env.HOME ?? "",
      "Downloads/browser-listener-4f9a5725-7a38-43cc-a5aa-1329f643ccb9-1781121046926.zip",
    ),
    tabUrl: "https://www.facebook.com/groups/richfieldmncommunity",
    description: "Feed + post dialog with photo attachment and full reactions dialog",
  },
  {
    name: "permalink",
    zip: join(
      process.env.HOME ?? "",
      "Downloads/browser-listener-525fe264-3b9c-43d0-83e0-fb378e733718-1781120390899.zip",
    ),
    tabUrl:
      "https://www.facebook.com/groups/richfieldmncommunity/permalink/27021670184127456/",
    description: "Permalink session with partial JSON parse warnings",
  },
  {
    name: "feed",
    zip: join(
      process.env.HOME ?? "",
      "Downloads/browser-listener-255ddf3a-049e-4ac6-bf55-2cc774b7ef18-1781111369768.zip",
    ),
    tabUrl: "https://www.facebook.com/groups/richfieldmncommunity",
    description: "Group feed with member hovercards and member count",
  },
];

const SENSITIVE_HEADERS = [
  "authorization",
  "cookie",
  "set-cookie",
  "x-fb-session",
  "x-fb-session-key",
];

const SENSITIVE_FORM_KEYS = new Set([
  "__user",
  "fb_dtsg",
  "lsd",
  "jazoest",
  "__a",
  "av",
  "__hs",
  "__hsi",
  "__s",
  "__rev",
  "__spin_t",
  "__crn",
]);

function redactHeaders(headers) {
  if (!headers?.length) return undefined;
  const out = {};
  for (const h of headers) {
    const name = h.name ?? "";
    if (SENSITIVE_HEADERS.some((k) => name.toLowerCase().includes(k))) {
      out[name] = REDACTED;
    } else {
      out[name] = h.value ?? "";
    }
  }
  return Object.keys(out).length ? out : undefined;
}

function redactFormBody(text) {
  if (!text) return undefined;
  const params = new URLSearchParams(text);
  const out = new URLSearchParams();
  params.forEach((value, key) => {
    out.set(key, SENSITIVE_FORM_KEYS.has(key) ? REDACTED : value);
  });
  return out.toString();
}

function isCaptureEntry(url) {
  try {
    const u = new URL(url);
    if (!u.hostname.endsWith("facebook.com")) return false;
    return /\/api\/graphql\/?$/i.test(u.pathname) || /\/ajax\/bulk-route-definitions/i.test(u.pathname);
  } catch {
    return false;
  }
}

function harToNetwork(har) {
  return har.log.entries
    .filter((e) => isCaptureEntry(e.request.url))
    .map((e, i) => ({
      id: `n-${i}`,
      sessionId: "fixture",
      requestId: `req-${i}`,
      timestamp: Date.parse(e.startedDateTime),
      url: e.request.url,
      method: e.request.method,
      type: "xhr",
      statusCode: e.response?.status,
      requestHeaders: redactHeaders(e.request.headers),
      responseHeaders: redactHeaders(e.response?.headers),
      requestBody: redactFormBody(e.request.postData?.text),
      responseBody: e.response?.content?.text,
      responseBodyTruncated: (e.response?.content?.text?.length ?? 0) >= 262144,
      bodyCaptured: Boolean(e.response?.content?.text),
      contentType: e.response?.content?.mimeType,
      requestBodySize: e.request.postData?.text?.length,
      responseBodySize: e.response?.content?.text?.length,
    }));
}

mkdirSync(OUT_DIR, { recursive: true });

let built = 0;
for (const src of SOURCES) {
  if (!existsSync(src.zip)) {
    console.warn(`skip ${src.name}: missing ${src.zip}`);
    continue;
  }
  const zip = unzipSync(new Uint8Array(readFileSync(src.zip)));
  const har = JSON.parse(new TextDecoder().decode(zip["network.har"]));
  const network = harToNetwork(har);
  const fixture = {
    description: src.description,
    tabUrl: src.tabUrl,
    network,
  };
  const outPath = join(OUT_DIR, `${src.name}.json`);
  writeFileSync(outPath, JSON.stringify(fixture));
  console.log(`wrote ${outPath} (${network.length} entries, ${(readFileSync(outPath).length / 1024).toFixed(0)} KB)`);
  built += 1;
}

if (built === 0) {
  console.error("No fixtures built — place capture ZIPs in ~/Downloads or update SOURCES paths.");
  process.exit(1);
}

console.log(`Built ${built} fixture(s).`);
