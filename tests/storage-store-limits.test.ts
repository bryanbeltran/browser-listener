import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/persistence/limits.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/persistence/limits.js")>();
  return {
    ...orig,
    STORAGE_LIMITS: { network: 5 },
  };
});

describe("store truncation tracking", () => {
  beforeEach(async () => {
    const { installChromeStorageMock } = await import("./helpers/mock-chrome.js");
    installChromeStorageMock();
  });

  afterEach(async () => {
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
        timestamp: Date.now(),
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
