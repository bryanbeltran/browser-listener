import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptySessionData, readSessionData, writeSessionData } from "../src/persistence/store.js";
import { sampleSession } from "./helpers/fixtures.js";
import { installChromeStorageMock, uninstallChromeStorageMock } from "./helpers/mock-chrome.js";

describe("session active flag", () => {
  beforeEach(() => {
    installChromeStorageMock();
  });

  afterEach(() => {
    uninstallChromeStorageMock();
  });

  it("treats session as active when ACTIVE_FLAG matches session id", async () => {
    const session = sampleSession({ active: false, id: "session-a" });
    await writeSessionData({ ...emptySessionData(), session });
    await chrome.storage.local.set({ browserListenerActiveSessionId: "session-a" });

    const data = await readSessionData();
    expect(data.session?.active).toBe(true);
  });

  it("treats session as inactive when ACTIVE_FLAG is cleared", async () => {
    const session = sampleSession({ active: true, id: "session-b" });
    await writeSessionData({ ...emptySessionData(), session });
    await chrome.storage.local.set({ browserListenerActiveSessionId: null });

    const data = await readSessionData();
    expect(data.session?.active).toBe(false);
  });
});
