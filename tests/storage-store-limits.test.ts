import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NETWORK_STORE_LIMITS } from "../src/persistence/limits.js";

describe("store truncation tracking", () => {
  const originalCap = NETWORK_STORE_LIMITS.entrySoftCap;

  beforeEach(async () => {
    NETWORK_STORE_LIMITS.entrySoftCap = 5;
    NETWORK_STORE_LIMITS.byteBudget = Number.MAX_SAFE_INTEGER;
    const { installChromeStorageMock } = await import("./helpers/mock-chrome.js");
    installChromeStorageMock();
  });

  afterEach(async () => {
    NETWORK_STORE_LIMITS.entrySoftCap = originalCap;
    NETWORK_STORE_LIMITS.byteBudget = 128 * 1024 * 1024;
    const { uninstallChromeStorageMock } = await import("./helpers/mock-chrome.js");
    uninstallChromeStorageMock();
    vi.resetModules();
  });

  it("increments health.truncation when network cap exceeded", async () => {
    const { emptySessionData, writeSessionData, upsertNetwork, readSessionData } = await import(
      "../src/persistence/store.js"
    );
    const { sampleSession } = await import("./helpers/fixtures.js");
    const session = sampleSession({ active: true });
    await writeSessionData({ ...emptySessionData(), session });

    for (let i = 0; i < 8; i++) {
      await upsertNetwork({
        id: `n-${i}`,
        sessionId: session.id,
        requestId: `req-${i}`,
        timestamp: Date.now() + i,
        url: `https://www.facebook.com/api/graphql/?i=${i}`,
        method: "POST",
        type: "xhr",
      });
    }

    const data = await readSessionData();
    expect(data.network.length).toBe(5);
    expect(data.session?.health.truncation.network).toBe(3);
  });
});
