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
      network: [{ id: "n1", sessionId: "popup-session", requestId: "r1", timestamp: 1, url: "https://www.facebook.com/api/graphql/", method: "POST", type: "xhr" }],
    });

    const { readPopupState } = await import("../src/popup/popup-state.js");
    const state = await readPopupState();
    expect(state.session?.active).toBe(true);
    expect(state.counts.network).toBe(1);
    expect(state.canExport).toBe(false);
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
          url: "https://www.facebook.com/api/graphql/",
          method: "POST",
          type: "xhr",
          responseBody: "x".repeat(500_000),
        },
      ],
    });

    const getSpy = chrome.storage.local.get as ReturnType<typeof vi.fn>;
    getSpy.mockClear();

    const { readPopupState } = await import("../src/popup/popup-state.js");
    await readPopupState();

    expect(getSpy).toHaveBeenCalledTimes(2);
    expect(getSpy.mock.calls[0]?.[0]).toBe("browserListenerPopupState");
    expect(getSpy.mock.calls[1]?.[0]).toEqual([
      "browserListenerSessionData",
      "browserListenerActiveSessionId",
    ]);
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
          url: "https://www.facebook.com/api/graphql/",
          method: "POST",
          type: "xhr",
        },
      ],
    });
    expect(state.canExport).toBe(true);
  });
});
