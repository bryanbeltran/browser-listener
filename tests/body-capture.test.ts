import { describe, expect, it } from "vitest";
import {
  decodeCdpBody,
  isSafeBodyMimeType,
  prepareBodyForStorage,
  shouldCaptureBody,
} from "../src/capture/body-capture.js";
import { BODY_CAPTURE_LIMITS } from "../src/persistence/limits.js";
import { REDACTED } from "../src/redaction/engine.js";
import { DEFAULT_CAPTURE_OPTIONS } from "../src/shared/types.js";

describe("safe body capture", () => {
  it("keeps body capture opt-in", () => {
    expect(DEFAULT_CAPTURE_OPTIONS.captureBodies).toBe(false);
  });

  it("allows JSON and text MIME types, rejects binary types", () => {
    expect(shouldCaptureBody("application/json; charset=utf-8")).toBe(true);
    expect(isSafeBodyMimeType("text/plain")).toBe(true);
    expect(shouldCaptureBody("application/octet-stream")).toBe(false);
    expect(shouldCaptureBody(undefined)).toBe(false);
  });

  it("redacts JSON and form bodies before applying per-response cap", () => {
    const json = prepareBodyForStorage(JSON.stringify({ message: "ok", access_token: "secret-token-value" }));
    expect(json.text).toContain(REDACTED);
    expect(json.text).not.toContain("secret-token-value");
    expect(json.truncated).toBe(false);

    const form = prepareBodyForStorage("access_token=leak-me&message=hello");
    expect(form.text).not.toContain("leak-me");

    const huge = prepareBodyForStorage(JSON.stringify({ blob: "x".repeat(BODY_CAPTURE_LIMITS.perResponseBytes * 2) }));
    expect(huge.truncated).toBe(true);
    expect(huge.byteLength).toBeLessThanOrEqual(BODY_CAPTURE_LIMITS.perResponseBytes);
  });

  it("preserves body values only when redaction is explicitly disabled", () => {
    const raw = prepareBodyForStorage('{"token":"secret-token-value"}', false);
    expect(raw.text).toContain("secret-token-value");
  });

  it("decodes base64 CDP bodies", () => {
    expect(decodeCdpBody(btoa('{"ok":true}'), true)).toBe('{"ok":true}');
    expect(decodeCdpBody("plain", false)).toBe("plain");
  });
});
