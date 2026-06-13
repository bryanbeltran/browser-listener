import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readPopupStateForUi,
  readPopupStateSnapshot,
} from "../src/persistence/store.js";
import { sampleSession } from "./helpers/fixtures.js";
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

  it("reconciles UI when session meta is active but popup snapshot is stale", async () => {
    const session = sampleSession({ active: true, id: "stale-ui-session" });
    await chrome.storage.local.set({
      browserListenerSessionData: { session },
      browserListenerActiveSessionId: session.id,
      browserListenerPopupState: {
        session: null,
        counts: { network: 0 },
        canExport: false,
      },
    });

    const ui = await readPopupStateForUi();
    expect(ui.session?.active).toBe(true);
    expect(ui.session?.id).toBe(session.id);
    expect(ui.canExport).toBe(false);
  });

  it("allows start when a stale active session exists in storage", async () => {
    const session = sampleSession({ active: true, id: "zombie-session" });
    await chrome.storage.local.set({
      browserListenerSessionData: { session },
      browserListenerActiveSessionId: session.id,
    });

    const { createSession } = await import("../src/capture/session-manager.js");
    const next = await createSession(7, "https://www.facebook.com/groups/test", {});

    expect(next.id).not.toBe(session.id);
    const ui = await readPopupStateForUi();
    expect(ui.session?.active).toBe(true);
    expect(ui.session?.id).toBe(next.id);
  });
});
