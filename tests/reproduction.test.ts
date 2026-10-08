import { beforeEach, describe, expect, it } from "vitest";
import { buildBundleCitation, buildEvidenceCitation } from "../src/export/citations.js";
import { buildReproductionSnippets } from "../src/export/reproduction.js";
import { resetRedactionConfig } from "../src/redaction/engine.js";
import type { NetworkEntry } from "../src/shared/types.js";

function entry(overrides: Partial<NetworkEntry> = {}): NetworkEntry {
  return {
    id: "network-event-1",
    sessionId: "bundle-1",
    requestId: "request-1",
    timestamp: 10,
    url: "https://example.test/api/items?token=secret&page=1",
    method: "POST",
    type: "fetch",
    requestHeaders: {
      Accept: "application/json",
      Authorization: "Bearer secret-token",
      "X-Trace": "trace-1",
    },
    requestBody: '{"query":"hello","token":"secret-token"}',
    timing: { start: 10, durationMs: 25 },
    ...overrides,
  };
}

describe("evidence citations and reproduction snippets", () => {
  beforeEach(() => resetRedactionConfig());

  it("creates stable, secret-free citation addresses", () => {
    expect(buildBundleCitation("bundle/1", 3)).toBe("browser-listener://bundle%2F1?schema=3");
    expect(buildEvidenceCitation("bundle-1", "raw.har", "network-event-1", 3)).toEqual({
      schemaVersion: 1,
      bundleId: "bundle-1",
      artifact: "raw.har",
      eventId: "network-event-1",
      address: "browser-listener://bundle-1/raw.har/network-event-1?schema=3",
    });
  });

  it("omits sensitive headers, URLs, and redacted bodies", () => {
    const snippets = buildReproductionSnippets(entry());

    expect(snippets.curl).toContain("X-Trace: trace-1");
    expect(snippets.curl).not.toContain("Authorization");
    expect(snippets.curl).not.toContain("secret-token");
    expect(snippets.curl).toContain("%5BREDACTED%5D");
    expect(snippets.fetch).toContain("fetch(");
    expect(snippets.httpie).toContain("http 'POST'");
    expect(snippets.context.bodyIncluded).toBe(false);
    expect(snippets.context.omitted).toEqual([
      "request header: Authorization",
      "sensitive URL query values redacted",
      "request body omitted because it contains redacted values",
    ]);
  });

  it("includes a body only when the redacted body has no secret marker", () => {
    const snippets = buildReproductionSnippets(
      entry({
        url: "https://example.test/api/items?page=1",
        requestHeaders: { "Content-Type": "application/json" },
        requestBody: '{"query":"hello"}',
      }),
    );

    expect(snippets.context.bodyIncluded).toBe(true);
    expect(snippets.curl).toContain('{"query":"hello"}');
    expect(snippets.context.omitted).toEqual([]);
  });

  it("never emits a request body from an opt-out capture", () => {
    const snippets = buildReproductionSnippets(entry({ requestBody: '{"query":"hello"}' }), {
      redactionEnabled: false,
    });

    expect(snippets.context.bodyIncluded).toBe(false);
    expect(snippets.curl).not.toContain("hello");
    expect(snippets.context.omitted).toContain("request body omitted because redaction is disabled");
    expect(snippets.context.omitted).toContain("redaction was disabled for the source capture");
  });
});
