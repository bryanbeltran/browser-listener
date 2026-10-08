import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptySessionData, readSessionData, writeSessionData } from "../src/persistence/store.js";
import { sampleSession } from "./helpers/fixtures.js";
import { installChromeStorageMock, uninstallChromeStorageMock } from "./helpers/mock-chrome.js";

describe("CDP network capture", () => {
  let onEvent: ((source: chrome.debugger.Debuggee, method: string, params?: object) => void) | undefined;
  let sendCommand: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    installChromeStorageMock();
    await writeSessionData({ ...emptySessionData(), session: sampleSession({ active: true, tabId: 8 }) });
    sendCommand = vi.fn(async (_debuggee: unknown, method: string) => {
      if (method === "Network.getRequestPostData") return { postData: "message=hello" };
      if (method === "Network.getResponseBody") return { body: '{"ok":true}', base64Encoded: false };
      return {};
    });
    vi.stubGlobal("chrome", {
      ...chrome,
      debugger: {
        sendCommand,
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

  it("keeps same request IDs independent across selected tabs", async () => {
    const { writeSessionData } = await import("../src/persistence/store.js");
    const current = await readSessionData();
    await writeSessionData({
      ...current,
      session: {
        ...current.session!,
        targets: [
          { tabId: 8, url: "https://example.test/primary", partialGaps: [] },
          { tabId: 9, url: "https://example.test/secondary", partialGaps: [] },
        ],
      },
    });
    const { registerDebuggerCapture } = await import("../src/capture/debugger-capture.js");
    registerDebuggerCapture();

    for (const tabId of [8, 9]) {
      onEvent?.(
        { tabId },
        "Network.requestWillBeSent",
        {
          requestId: "same-request-id",
          request: { url: `https://example.test/api/${tabId}`, method: "GET" },
        },
      );
      onEvent?.(
        { tabId },
        "Network.responseReceived",
        { requestId: "same-request-id", response: { status: 200 } },
      );
      onEvent?.({ tabId }, "Network.loadingFinished", { requestId: "same-request-id" });
    }
    onEvent?.(
      { tabId: 99 },
      "Network.requestWillBeSent",
      { requestId: "ignored", request: { url: "https://example.test/ignored" } },
    );

    for (let attempt = 0; attempt < 20; attempt++) {
      if ((await readSessionData()).network.length === 2) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const data = await readSessionData();
    expect(data.network).toHaveLength(2);
    expect(data.network.map((entry) => entry.tabId).sort()).toEqual([8, 9]);
    expect(data.network.map((entry) => entry.url).sort()).toEqual([
      "https://example.test/api/8",
      "https://example.test/api/9",
    ]);
  });

  it("filters network entries by URL and response MIME and records the gap", async () => {
    const { writeSessionData } = await import("../src/persistence/store.js");
    const current = await readSessionData();
    await writeSessionData({
      ...current,
      session: {
        ...current.session!,
        options: {
          ...current.session!.options,
          filters: {
            urlIncludes: ["/api"],
            urlExcludes: [],
            mimeTypes: ["application/json"],
          },
        },
      },
    });
    const { registerDebuggerCapture } = await import("../src/capture/debugger-capture.js");
    registerDebuggerCapture();

    onEvent?.(
      { tabId: 8 },
      "Network.requestWillBeSent",
      { requestId: "excluded-url", request: { url: "https://example.test/telemetry", method: "GET" } },
    );
    onEvent?.(
      { tabId: 8 },
      "Network.requestWillBeSent",
      { requestId: "excluded-mime", request: { url: "https://example.test/api/page", method: "GET" } },
    );
    onEvent?.(
      { tabId: 8 },
      "Network.responseReceived",
      { requestId: "excluded-mime", response: { status: 200, mimeType: "text/html" } },
    );

    let data = await readSessionData();
    for (let attempt = 0; attempt < 30 && data.session?.health.filteredNetworkRequests !== 2; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      data = await readSessionData();
    }
    expect(data.network).toHaveLength(0);
    expect(data.session?.health.filteredNetworkRequests).toBe(2);
  });

  it("captures one armed request body when normal body capture is disabled, then consumes the arm", async () => {
    const { armOneRequestCapture } = await import("../src/capture/session-manager.js");
    await armOneRequestCapture();
    const { registerDebuggerCapture } = await import("../src/capture/debugger-capture.js");
    registerDebuggerCapture();

    const emitRequest = (requestId: string): void => {
      onEvent?.(
        { tabId: 8 },
        "Network.requestWillBeSent",
        {
          requestId,
          request: {
            url: `https://example.test/api/${requestId}`,
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
          },
        },
      );
      onEvent?.(
        { tabId: 8 },
        "Network.responseReceived",
        {
          requestId,
          response: { status: 200, mimeType: "application/json", headers: { "content-type": "application/json" } },
        },
      );
      onEvent?.({ tabId: 8 }, "Network.loadingFinished", { requestId });
    };

    emitRequest("one-shot");
    emitRequest("ordinary");

    let data = await readSessionData();
    for (let attempt = 0; attempt < 50 && !data.network.find((entry) => entry.oneRequestCapture)?.bodyCaptured; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      data = await readSessionData();
    }
    const oneShot = data.network.find((entry) => entry.requestId === "one-shot");
    const ordinary = data.network.find((entry) => entry.requestId === "ordinary");
    expect(oneShot).toMatchObject({ oneRequestCapture: true, bodyCaptured: true, responseBody: '{"ok":true}' });
    expect(ordinary).toMatchObject({ responseBodyState: "excluded", responseBodySkipReason: "capture-disabled" });
    expect(ordinary?.responseBody).toBeUndefined();
    expect(sendCommand.mock.calls.filter(([, method]) => method === "Network.getResponseBody")).toHaveLength(1);
  });
});
