import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptySessionData, writeSessionData } from "../src/persistence/store.js";
import { popupStateFromSessionData } from "../src/popup/popup-state.js";
import { sampleSession } from "./helpers/fixtures.js";
import { installChromeStorageMock, uninstallChromeStorageMock } from "./helpers/mock-chrome.js";

describe("popup state", () => {
  beforeEach(() => {
    installChromeStorageMock();
  });

  afterEach(() => {
    uninstallChromeStorageMock();
  });

  it("marks session active via readPopupState from lightweight snapshot", async () => {
    const session = sampleSession({ active: true, id: "popup-session" });
    await writeSessionData({
      ...emptySessionData(),
      session,
      network: [{ id: "n1", sessionId: "popup-session", requestId: "r1", timestamp: 1, url: "https://example.test/api/items", method: "GET", type: "fetch" }],
    });

    const { readPopupState } = await import("../src/popup/popup-state.js");
    const state = await readPopupState();
    expect(state.session?.active).toBe(true);
    expect(state.counts.network).toBe(1);
    expect(state.canExport).toBe(false);
    expect(state.redactionEnabled).toBe(true);
  });

  it("readPopupState avoids loading network bodies from storage", async () => {
    const session = sampleSession({ active: true, id: "popup-session" });
    await writeSessionData({
      ...emptySessionData(),
      session,
      network: [
        {
          id: "n1",
          sessionId: "popup-session",
          requestId: "r1",
          timestamp: 1,
          url: "https://example.test/api/items",
          method: "GET",
          type: "fetch",
          responseBody: "x".repeat(500_000),
        },
      ],
    });

    const getSpy = chrome.storage.local.get as ReturnType<typeof vi.fn>;
    getSpy.mockClear();

    const { readPopupState } = await import("../src/popup/popup-state.js");
    await readPopupState();

    expect(getSpy.mock.calls[0]?.[0]).toBe("browserListenerPopupState");
    expect(getSpy.mock.calls[1]?.[0]).toEqual([
      "browserListenerSessionData",
      "browserListenerActiveSessionId",
      "browserListenerRedactionEnabled",
      "browserListenerRedactionConfig",
    ]);
    expect(getSpy.mock.calls.slice(2).map(([key]) => key)).toEqual([
      "browserListenerSessionHistory",
      "browserListenerRetentionPolicy",
      "browserListenerDeletionReceipts",
    ]);
  });

  it("reads persisted redaction preference for popup state", async () => {
    await chrome.storage.local.set({ browserListenerRedactionEnabled: false });
    const { readPopupState } = await import("../src/popup/popup-state.js");

    const state = await readPopupState();
    expect(state.redactionEnabled).toBe(false);
  });

  it("popupStateFromSessionData sets canExport when stopped with network data", () => {
    const state = popupStateFromSessionData({
      ...emptySessionData(),
      session: sampleSession({ active: false }),
      network: [
        {
          id: "n1",
          sessionId: "test-session-1",
          requestId: "r1",
          timestamp: 1,
          url: "https://example.test/api/items",
          method: "GET",
          type: "fetch",
        },
      ],
    });
    expect(state.canExport).toBe(true);
  });

  it("keeps marker-only captures exportable", () => {
    const state = popupStateFromSessionData({
      ...emptySessionData(),
      session: sampleSession({ active: false }),
      markers: [
        {
          id: "marker-1",
          sessionId: "test-session-1",
          timestamp: 1,
          label: "User marker",
        },
      ],
    });
    expect(state.canExport).toBe(true);
  });
});
