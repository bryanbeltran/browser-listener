import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptySessionData, readSessionData, writeSessionData } from "../src/persistence/store.js";
import { sampleSession } from "./helpers/fixtures.js";
import { installChromeStorageMock, uninstallChromeStorageMock } from "./helpers/mock-chrome.js";

describe("CDP network capture", () => {
  let onEvent: ((source: chrome.debugger.Debuggee, method: string, params?: object) => void) | undefined;

  beforeEach(async () => {
    installChromeStorageMock();
    await writeSessionData({ ...emptySessionData(), session: sampleSession({ active: true, tabId: 8 }) });
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

  it("persists status and completion timing without body capture", async () => {
    const { registerDebuggerCapture } = await import("../src/capture/debugger-capture.js");
    registerDebuggerCapture();
    onEvent?.(
      { tabId: 8 },
      "Network.requestWillBeSent",
      {
        requestId: "request-1",
        wallTime: 1_700_000_000,
        type: "Fetch",
        documentURL: "https://example.test/page",
        initiator: { type: "script", url: "https://example.test/app.js", lineNumber: 12 },
        request: { url: "https://example.test/api", method: "GET" },
      },
    );
    onEvent?.(
      { tabId: 8 },
      "Network.responseReceived",
      {
        requestId: "request-1",
        response: {
          status: 500,
          statusText: "Server Error",
          mimeType: "application/json",
          headers: { "content-type": "application/json" },
          fromDiskCache: true,
          connectionReused: true,
        },
      },
    );
    onEvent?.({ tabId: 8 }, "Network.loadingFinished", { requestId: "request-1" });
    let data = await readSessionData();
    for (let attempt = 0; attempt < 20 && !data.network[0]?.timing?.end; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      data = await readSessionData();
    }

    const entry = data.network[0];
    expect(entry?.statusCode).toBe(500);
    expect(entry?.timing?.start).toBe(1_700_000_000_000);
    expect(entry?.timing?.end).toBeTypeOf("number");
    expect(entry?.timing?.durationMs).toBeGreaterThanOrEqual(0);
    expect(entry?.documentUrl).toBe("https://example.test/page");
    expect(entry?.initiator?.url).toBe("https://example.test/app.js");
    expect(entry?.fromCache).toBe(true);
    expect(entry?.connectionReused).toBe(true);
  });

  it("records an explicit scope filter instead of persisting out-of-scope requests", async () => {
    const { writeSessionData } = await import("../src/persistence/store.js");
    await writeSessionData({
      ...(await readSessionData()),
      session: {
        ...(await readSessionData()).session!,
        options: {
          ...(await readSessionData()).session!.options,
          allowedOrigins: ["https://example.test"],
        },
      },
    });
    const { registerDebuggerCapture } = await import("../src/capture/debugger-capture.js");
    registerDebuggerCapture();
    onEvent?.(
      { tabId: 8 },
      "Network.requestWillBeSent",
      {
        requestId: "filtered-request",
        request: { url: "https://third-party.test/analytics", method: "GET" },
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    const data = await readSessionData();
    expect(data.network).toHaveLength(0);
    expect(data.session?.health.filteredNetworkRequests).toBe(1);
  });
});
