import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptySessionData, readSessionData, writeSessionData } from "../src/persistence/store.js";
import { sampleSession } from "./helpers/fixtures.js";
import { installChromeStorageMock, uninstallChromeStorageMock } from "./helpers/mock-chrome.js";

vi.mock("../src/capture/debugger-capture.js", () => ({
  detachDebugger: vi.fn(async () => {}),
}));

describe("tab lifecycle", () => {
  beforeEach(() => {
    installChromeStorageMock();
  });

  afterEach(() => {
    uninstallChromeStorageMock();
    vi.clearAllMocks();
  });

  it("stops session and preserves data when captured tab closes", async () => {
    const session = sampleSession({ active: true, tabId: 42 });
    await writeSessionData({
      ...emptySessionData(),
      session,
      network: [
        {
          id: "n1",
          sessionId: session.id,
          requestId: "r1",
          timestamp: Date.now(),
          url: "https://example.test/api/items",
          method: "GET",
          type: "fetch",
        },
      ],
    });

    const { handleTabClosed } = await import("../src/background/tab-lifecycle.js");
    await handleTabClosed(42);

    const data = await readSessionData();
    expect(data.session?.active).toBe(false);
    expect(data.session?.tabClosedDuringCapture).toBe(true);
    expect(data.network.length).toBe(1);
    expect(data.session?.health.partialGaps.some((g) => g.reason === "tab_closed")).toBe(true);
  });

  it("ignores tab close for non-session tabs", async () => {
    const session = sampleSession({ active: true, tabId: 42 });
    await writeSessionData({ ...emptySessionData(), session });

    const { handleTabClosed } = await import("../src/background/tab-lifecycle.js");
    await handleTabClosed(99);

    const data = await readSessionData();
    expect(data.session?.active).toBe(true);
  });
});
