import { redactHeaders, redactUrl } from "../redaction/engine.js";
import type { NetworkEntry } from "../shared/types.js";

export function buildHar(entries: NetworkEntry[], pageUrl: string): object {
  const harEntries = entries.map((n) => {
    const started = n.timestamp;
    const duration = n.timing?.durationMs ?? 0;
    return {
      startedDateTime: new Date(started).toISOString(),
      time: duration,
      request: {
        method: n.method,
        url: redactUrl(n.url),
        httpVersion: "HTTP/1.1",
        headers: headerPairs(redactHeaders(n.requestHeaders)),
        queryString: [],
        cookies: [],
        headersSize: -1,
        bodySize: n.requestBodySize ?? 0,
      },
      response: {
        status: n.statusCode ?? 0,
        statusText: n.statusLine ?? "",
        httpVersion: "HTTP/1.1",
        headers: headerPairs(redactHeaders(n.responseHeaders)),
        cookies: [],
        content: {
          size: n.responseBodySize ?? 0,
          mimeType: n.responseHeaders?.["content-type"] ?? "",
          text: n.bodyCaptured ? "[body redacted or captured per policy]" : "",
        },
        redirectURL: "",
        headersSize: -1,
        bodySize: n.responseBodySize ?? 0,
      },
      cache: {},
      timings: { send: 0, wait: duration, receive: 0 },
    };
  });

  return {
    log: {
      version: "1.2",
      creator: { name: "Browser Listener", version: "0.2.0" },
      pages: [
        {
          startedDateTime: harEntries[0]
            ? new Date(entries[0].timestamp).toISOString()
            : new Date().toISOString(),
          id: "page_1",
          title: pageUrl,
          pageTimings: {},
        },
      ],
      entries: harEntries,
    },
  };
}

function headerPairs(headers: Record<string, string> | undefined): { name: string; value: string }[] {
  if (!headers) return [];
  return Object.entries(headers).map(([name, value]) => ({ name, value }));
}
