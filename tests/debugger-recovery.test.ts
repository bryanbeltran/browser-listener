import { describe, expect, it } from "vitest";

/**
 * Debugger detach/recovery is exercised in-browser; this documents expected behavior
 * implemented in src/capture/debugger-capture.ts.
 */
describe("debugger detach recovery behavior", () => {
  it("defines recover scheduling after detach", async () => {
    const mod = await import("../src/capture/debugger-capture.js");
    expect(typeof mod.registerDebuggerCapture).toBe("function");
    expect(typeof mod.ensureDebuggerForSession).toBe("function");
    expect(mod.getAttachedTabId()).toBeNull();
  });
});
