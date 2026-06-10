import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptySessionData, readSessionData, writeSessionData } from "../src/persistence/store.js";
import { sampleSession } from "./helpers/fixtures.js";
import { installChromeStorageMock, uninstallChromeStorageMock } from "./helpers/mock-chrome.js";

describe("session stop timeline", () => {
  beforeEach(() => {
    installChromeStorageMock();
  });

  afterEach(() => {
    uninstallChromeStorageMock();
  });

  it("records session_stop before deactivating session", async () => {
    const session = sampleSession({ active: true });
    await writeSessionData({ ...emptySessionData(), session });
    await chrome.storage.local.set({ browserListenerActiveSessionId: session.id });

    const { stopSession } = await import("../src/capture/session-manager.js");
    await stopSession();

    const data = await readSessionData();
    expect(data.session?.active).toBe(false);
    expect(data.timeline.some((e) => e.type === "session_stop")).toBe(true);
  });
});
