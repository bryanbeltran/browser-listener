import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/persistence/limits.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/persistence/limits.js")>();
  return {
    ...orig,
    STORAGE_LIMITS: { console: 5, network: 5, timeline: 10, userActions: 5 },
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

  it("increments health.truncation when console cap exceeded", async () => {
    const { emptySessionData, writeSessionData, appendConsole, readSessionData } = await import(
      "../src/persistence/store.js"
    );
    const { sampleSession } = await import("./helpers/fixtures.js");
    const session = sampleSession({ active: true });
    await writeSessionData({ ...emptySessionData(), session });

    for (let i = 0; i < 8; i++) {
      await appendConsole({
        id: `c-${i}`,
        sessionId: session.id,
        timestamp: Date.now(),
        level: "log",
        args: [`m${i}`],
        url: "https://example.com",
      });
    }

    const data = await readSessionData();
    expect(data.console.length).toBe(5);
    expect(data.session?.health.truncation.console).toBe(3);
  });
});
