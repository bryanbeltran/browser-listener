import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

  it("marks session active from storage flag via readPopupState", async () => {
    const session = sampleSession({ active: false, id: "popup-session" });
    await writeSessionData({
      ...emptySessionData(),
      session,
      network: [{ id: "n1", sessionId: "popup-session", requestId: "r1", timestamp: 1, url: "https://example.com", method: "GET", type: "xhr" }],
    });
    await chrome.storage.local.set({ browserListenerActiveSessionId: "popup-session" });

    const { readPopupState } = await import("../src/popup/popup-state.js");
    const state = await readPopupState();
    expect(state.session?.active).toBe(true);
    expect(state.counts.network).toBe(1);
    expect(state.canExport).toBe(false);
  });

  it("popupStateFromSessionData sets canExport when stopped with data", () => {
    const state = popupStateFromSessionData({
      ...emptySessionData(),
      session: sampleSession({ active: false }),
      console: [
        {
          id: "c1",
          sessionId: "test-session-1",
          timestamp: 1,
          level: "log",
          args: ["hi"],
          url: "https://example.com",
        },
      ],
    });
    expect(state.canExport).toBe(true);
  });
});
