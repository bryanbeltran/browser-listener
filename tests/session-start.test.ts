import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readPopupStateSnapshot } from "../src/persistence/store.js";
import { installChromeStorageMock, uninstallChromeStorageMock } from "./helpers/mock-chrome.js";

describe("session start", () => {
  beforeEach(() => {
    installChromeStorageMock();
  });

  afterEach(() => {
    uninstallChromeStorageMock();
  });

  it("writes popup snapshot immediately when capture starts", async () => {
    const { createSession } = await import("../src/capture/session-manager.js");
    await createSession(42, "https://www.facebook.com/groups/test", {});

    const snapshot = await readPopupStateSnapshot();
    expect(snapshot.session?.active).toBe(true);
    expect(snapshot.counts.network).toBe(0);
  });
});
