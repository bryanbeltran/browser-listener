import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptySessionData, readSessionData, writeSessionData } from "../src/persistence/store.js";
import { sampleSession } from "./helpers/fixtures.js";
import { installChromeStorageMock, uninstallChromeStorageMock } from "./helpers/mock-chrome.js";

describe("CDP console capture", () => {
  let onEvent: ((source: chrome.debugger.Debuggee, method: string, params?: object) => void) | undefined;

  beforeEach(async () => {
    installChromeStorageMock();
    await writeSessionData({ ...emptySessionData(), session: sampleSession({ active: true, tabId: 7 }) });
    vi.stubGlobal("chrome", {
      ...chrome,
      debugger: {
        onEvent: {
          addListener: vi.fn((listener) => {
            onEvent = listener as typeof onEvent;
          }),
        },
        onDetach: { addListener: vi.fn() },
      },
    });
  });

  afterEach(async () => {
    const module = await import("../src/capture/debugger-capture.js");
    module.resetDebuggerCaptureForTests();
    onEvent = undefined;
    uninstallChromeStorageMock();
    vi.unstubAllGlobals();
  });

  it("persists console API calls and runtime exceptions", async () => {
    const { registerDebuggerCapture } = await import("../src/capture/debugger-capture.js");
    registerDebuggerCapture();
    onEvent?.(
      { tabId: 7 },
      "Runtime.consoleAPICalled",
      {
        type: "error",
        timestamp: 10,
        args: [{ value: "render failed" }, { value: 42 }],
      },
    );
    onEvent?.(
      { tabId: 7 },
      "Runtime.exceptionThrown",
      {
        exceptionDetails: {
          text: "Unhandled exception",
          timestamp: 11,
          url: "https://example.test/problem",
          lineNumber: 4,
        },
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    const data = await readSessionData();
    expect(data.console).toHaveLength(2);
    expect(data.console.map((entry) => entry.level)).toEqual(["error", "error"]);
    expect(data.console[0]?.text).toContain("render failed");
    expect(data.console[1]?.text).toContain("Unhandled exception");
  });
});
