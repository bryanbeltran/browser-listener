import { describe, expect, it } from "vitest";
import {
  decodeCdpBody,
  prepareBodyForStorage,
  shouldCaptureApiBody,
} from "../src/capture/api-body-capture.js";
import { REDACTED } from "../src/redaction/engine.js";
import { DEFAULT_CAPTURE_OPTIONS } from "../src/shared/types.js";

describe("api body capture", () => {
  it("enables GraphQL bodies by default", () => {
    expect(DEFAULT_CAPTURE_OPTIONS.graphqlBodies).toBe(true);
  });

  it("matches Facebook GraphQL and bulk-route URLs only", () => {
    expect(shouldCaptureApiBody("https://www.facebook.com/api/graphql/")).toBe(true);
    expect(shouldCaptureApiBody("https://www.facebook.com/ajax/bulk-route-definitions/")).toBe(
      true,
    );
    expect(shouldCaptureApiBody("https://www.facebook.com/photos")).toBe(false);
    expect(shouldCaptureApiBody("https://example.com/api/graphql/")).toBe(false);
  });

  it("redacts JSON bodies without truncating", () => {
    const raw = JSON.stringify({ message: "ok", access_token: "secret-token-value" });
    const prep = prepareBodyForStorage(raw);
    expect(prep.text).toContain(REDACTED);
    expect(prep.text).not.toContain("secret-token-value");
    expect(prep.truncated).toBe(false);

    const huge = JSON.stringify({ blob: "x".repeat(512 * 1024) });
    const large = prepareBodyForStorage(huge);
    expect(large.truncated).toBe(false);
    expect(large.byteLength).toBeGreaterThan(512 * 1024);
    expect(large.text).toContain('"blob"');
  });

  it("decodes base64 CDP bodies", () => {
    const text = decodeCdpBody(btoa('{"ok":true}'), true);
    expect(text).toBe('{"ok":true}');
    expect(decodeCdpBody("plain", false)).toBe("plain");
  });
});
