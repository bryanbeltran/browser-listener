import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildZipExport } from "../src/export/orchestrator.js";
import { emptySessionData, writeSessionData } from "../src/persistence/store.js";
import { sampleSession } from "./helpers/fixtures.js";
import { installChromeStorageMock, uninstallChromeStorageMock } from "./helpers/mock-chrome.js";

describe("download export orchestration", () => {
  beforeEach(() => {
    installChromeStorageMock();
  });

  afterEach(() => {
    uninstallChromeStorageMock();
  });

  it("buildZipExport reads persisted session data", async () => {
    await writeSessionData({
      ...emptySessionData(),
      session: sampleSession(),
      console: [
        {
          id: "1",
          sessionId: "test-session-1",
          timestamp: Date.now(),
          level: "log",
          args: ["ok"],
          url: "https://example.com",
        },
      ],
    });
    const zip = await buildZipExport();
    expect(zip.byteLength).toBeGreaterThan(100);
  });
});
