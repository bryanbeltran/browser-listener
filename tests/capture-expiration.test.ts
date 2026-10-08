import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installChromeStorageMock, uninstallChromeStorageMock } from "./helpers/mock-chrome.js";

describe("capture duration expiry", () => {
  beforeEach(() => {
    installChromeStorageMock();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  });

  afterEach(async () => {
    const { setCaptureExpirationHandler } = await import("../src/capture/session-manager.js");
    setCaptureExpirationHandler(null);
    vi.useRealTimers();
    uninstallChromeStorageMock();
  });

  it("fires the expiry handler at the persisted deadline", async () => {
    const { createSession, activateCaptureSession, setCaptureExpirationHandler } = await import("../src/capture/session-manager.js");
    const expired = vi.fn(async () => undefined);
    setCaptureExpirationHandler(expired);
    await createSession(1, "https://example.test/problem", { durationMs: 1_000 });
    await activateCaptureSession();

    await vi.advanceTimersByTimeAsync(1_001);
    expect(expired).toHaveBeenCalledTimes(1);
  });
});
