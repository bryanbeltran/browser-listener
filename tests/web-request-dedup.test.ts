import { afterEach, describe, expect, it, vi } from "vitest";
import * as debuggerCapture from "../src/capture/debugger-capture.js";
import { shouldUseWebRequestForTab } from "../src/capture/web-request-capture.js";

describe("network dedup — webRequest vs CDP", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("skips webRequest when debugger is attached to the session tab", () => {
    vi.spyOn(debuggerCapture, "isDebuggerAttachedToTab").mockReturnValue(true);
    expect(shouldUseWebRequestForTab(42, 42)).toBe(false);
    expect(shouldUseWebRequestForTab(undefined, 42)).toBe(false);
  });

  it("uses webRequest when debugger is not attached", () => {
    vi.spyOn(debuggerCapture, "isDebuggerAttachedToTab").mockReturnValue(false);
    expect(shouldUseWebRequestForTab(42, 42)).toBe(true);
  });

  it("rejects foreign tab ids", () => {
    vi.spyOn(debuggerCapture, "isDebuggerAttachedToTab").mockReturnValue(false);
    expect(shouldUseWebRequestForTab(99, 42)).toBe(false);
  });
});
