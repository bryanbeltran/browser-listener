import { describe, expect, it } from "vitest";
import { buildHar } from "../src/export/har.js";
import { REDACTED } from "../src/redaction/engine.js";
import { leakySessionData } from "./helpers/fixtures.js";

describe("HAR export", () => {
  it("produces HAR 1.2 log with redacted entries", () => {
    const har = buildHar(leakySessionData().network, "https://example.com") as {
      log: {
        version: string;
        entries: { request: { headers: { name: string; value: string }[] } }[];
      };
    };
    expect(har.log.version).toBe("1.2");
    expect(har.log.entries.length).toBe(1);
    const auth = har.log.entries[0].request.headers.find((h) => h.name === "Authorization");
    expect(auth?.value).toBe(REDACTED);
  });

  it("includes captured API bodies in HAR postData and response content", () => {
    const har = buildHar(
      [
        {
          id: "n1",
          sessionId: "s1",
          requestId: "r1",
          timestamp: Date.now(),
          url: "https://www.facebook.com/api/graphql/",
          method: "POST",
          type: "xhr",
          statusCode: 200,
          requestBody: '{"doc_id":"123"}',
          responseBody: '{"data":{"node":{"id":"1"}}}',
          bodyCaptured: true,
          contentType: "application/json",
        },
      ],
      "https://www.facebook.com/groups/test",
    ) as {
      log: {
        entries: {
          request: { postData?: { text: string } };
          response: { content: { text: string; mimeType: string } };
        }[];
      };
    };
    const entry = har.log.entries[0];
    expect(entry.request.postData?.text).toContain("doc_id");
    expect(entry.response.content.text).toContain('"node"');
    expect(entry.response.content.mimeType).toBe("application/json");
  });
});
