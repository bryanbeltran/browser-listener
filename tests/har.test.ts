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
});
