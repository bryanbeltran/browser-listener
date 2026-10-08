import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptySessionData, readSessionData, writeSessionData } from "../src/persistence/store.js";
import { sampleSession } from "./helpers/fixtures.js";
import { installChromeStorageMock, uninstallChromeStorageMock } from "./helpers/mock-chrome.js";

describe("session stop", () => {
  beforeEach(() => {
    installChromeStorageMock();
  });

  afterEach(() => {
    uninstallChromeStorageMock();
  });

  it("deactivates session on stop", async () => {
    const session = sampleSession({ active: true });
    await writeSessionData({ ...emptySessionData(), session });
    await chrome.storage.local.set({ browserListenerActiveSessionId: session.id });

    const { stopSession } = await import("../src/capture/session-manager.js");
    await stopSession();

    const data = await readSessionData();
    expect(data.session?.active).toBe(false);
    expect(data.session?.stoppedAt).toBeTypeOf("number");
  });

  it("closes an open pause interval when stopping", async () => {
    const session = sampleSession({
      active: true,
      paused: true,
      pauseIntervals: [{ startedAt: Date.now() - 1000 }],
    });
    await writeSessionData({ ...emptySessionData(), session });
    await chrome.storage.local.set({ browserListenerActiveSessionId: session.id });

    const { stopSession } = await import("../src/capture/session-manager.js");
    await stopSession();

    const data = await readSessionData();
    const interval = data.session?.pauseIntervals?.[0];
    expect(data.session?.paused).toBe(false);
    expect(interval?.endedAt).toBeTypeOf("number");
    expect(interval?.durationMs).toBeGreaterThanOrEqual(0);
  });
});
