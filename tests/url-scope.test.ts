import { describe, expect, it } from "vitest";
import { isCaptureableUrl, isOriginAllowed, normalizeOriginAllowlist } from "../src/shared/urls.js";

describe("capture URL scope", () => {
  it("accepts ordinary HTTP(S) pages", () => {
    expect(isCaptureableUrl("https://example.test/problem")).toBe(true);
    expect(isCaptureableUrl("http://localhost:3000/issue")).toBe(true);
  });

  it("rejects browser-internal and malformed URLs", () => {
    expect(isCaptureableUrl("chrome://settings")).toBe(false);
    expect(isCaptureableUrl("chrome-extension://abc/page.html")).toBe(false);
    expect(isCaptureableUrl("file:///tmp/problem.html")).toBe(false);
    expect(isCaptureableUrl("not a URL")).toBe(false);
  });

  it("canonicalizes exact origin allowlists and fails closed for out-of-scope URLs", () => {
    const origins = normalizeOriginAllowlist(["https://example.test/", "https://example.test"]);
    expect(origins).toEqual(["https://example.test"]);
    expect(isOriginAllowed("https://example.test/api", origins)).toBe(true);
    expect(isOriginAllowed("https://third-party.test/api", origins)).toBe(false);
    expect(() => normalizeOriginAllowlist(["https://example.test/path"])).toThrow();
    expect(() => normalizeOriginAllowlist(["chrome://settings/"])).toThrow();
  });
});
