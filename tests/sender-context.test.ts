import { describe, expect, it } from "vitest";
import {
  enrichDiagnosticsBundle,
  enrichUserAction,
  frameIdFromSender,
  userActionTimelineSummary,
} from "../src/background/sender-context.js";

describe("sender frame context", () => {
  it("reads Chrome frameId from message sender", () => {
    expect(frameIdFromSender({ frameId: 42 } as chrome.runtime.MessageSender)).toBe("42");
    expect(frameIdFromSender({} as chrome.runtime.MessageSender)).toBeUndefined();
  });

  it("enriches diagnostics with real frameId", () => {
    const bundle = enrichDiagnosticsBundle(
      {
        frames: [{ frameId: "pending", url: "https://x.com", crossOrigin: false, timestamp: 1 }],
        route: { href: "", pathname: "", search: "", hash: "", title: "" },
        visibility: "visible",
        capturedAt: 1,
      },
      { frameId: 7 } as chrome.runtime.MessageSender,
    );
    expect(bundle.frames[0].frameId).toBe("7");
  });

  it("builds user action timeline summary", () => {
    const summary = userActionTimelineSummary({
      id: "1",
      sessionId: "s",
      timestamp: 1,
      type: "click",
      target: "button#save",
      url: "https://x.com",
    });
    expect(summary).toContain("click");
    expect(summary).toContain("button#save");
  });

  it("enriches user action with frame and tab", () => {
    const action = enrichUserAction(
      {
        id: "1",
        sessionId: "s",
        timestamp: 1,
        type: "route",
        url: "https://x.com/a",
      },
      { frameId: 3, tab: { id: 99 } } as chrome.runtime.MessageSender,
    );
    expect(action.frameId).toBe("3");
    expect(action.tabId).toBe(99);
  });
});
