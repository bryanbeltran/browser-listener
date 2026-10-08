import { describe, expect, it } from "vitest";
import {
  REDACTED,
  redactDeep,
  redactHeaders,
  redactUrl,
  resetRedactionConfig,
} from "../src/redaction/engine.js";

describe("redaction engine", () => {
  it("redacts sensitive headers", () => {
    resetRedactionConfig();
    const out = redactHeaders({
      Authorization: "Bearer secret",
      Accept: "application/json",
      "X-API-Key": "abc",
    });
    expect(out?.Authorization).toBe(REDACTED);
    expect(out?.["X-API-Key"]).toBe(REDACTED);
    expect(out?.Accept).toBe("application/json");
  });

  it("redacts sensitive query params in URLs", () => {
    const url = redactUrl("https://x.com/path?access_token=leak&page=1");
    expect(decodeURIComponent(url)).toContain(REDACTED);
    expect(url).not.toContain("leak");
    expect(url).toContain("page=1");
  });

  it("redacts password input values in DOM summaries", () => {
    const html = redactDeep({
      htmlSummary: '<input type="password" value="hunter2" />',
    }) as { htmlSummary: string };
    expect(html.htmlSummary).not.toContain("hunter2");
  });

  it("redacts high-confidence secret shapes even without a sensitive field name", () => {
    const out = redactHeaders({
      "X-Debug": "sk_live_12345678901234567890",
      "X-Key": "-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----",
    });
    expect(out?.["X-Debug"]).toBe(REDACTED);
    expect(out?.["X-Key"]).toBe(REDACTED);
  });
});
