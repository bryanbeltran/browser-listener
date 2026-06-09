import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptySessionData, writeSessionData, getActiveSessionId } from "../src/persistence/store.js";
import {
  loadRecoverableSession,
  markServiceWorkerRestart,
} from "../src/persistence/session-recovery.js";
import { sampleSession } from "./helpers/fixtures.js";
import { installChromeStorageMock, uninstallChromeStorageMock } from "./helpers/mock-chrome.js";

describe("session recovery", () => {
  beforeEach(() => {
    installChromeStorageMock();
  });

  afterEach(() => {
    uninstallChromeStorageMock();
  });

  it("persists active session id flag", async () => {
    const session = sampleSession({ active: true });
    await writeSessionData({ ...emptySessionData(), session });
    const id = await getActiveSessionId();
    expect(id).toBe("test-session-1");
  });

  it("detects recoverable active session", async () => {
    const session = sampleSession({ active: true });
    await writeSessionData({ ...emptySessionData(), session });
    const { shouldRecover, session: loaded } = await loadRecoverableSession();
    expect(shouldRecover).toBe(true);
    expect(loaded?.id).toBe(session.id);
  });

  it("records service worker restart gap when markServiceWorkerRestart is called", async () => {
    const session = sampleSession({ active: true });
    await writeSessionData({ ...emptySessionData(), session });
    await markServiceWorkerRestart();
    const data = await loadRecoverableSession();
    expect(data.session?.health.serviceWorkerRestarts).toBe(1);
    expect(
      data.session?.health.partialGaps.some((g) => g.reason === "service_worker_restart"),
    ).toBe(true);
  });
});
