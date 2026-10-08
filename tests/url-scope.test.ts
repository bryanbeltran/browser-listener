import { describe, expect, it } from "vitest";
import { isCaptureableUrl } from "../src/shared/urls.js";

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
});
