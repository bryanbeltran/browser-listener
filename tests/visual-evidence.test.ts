import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildZipFromSessionData } from "../src/export/orchestrator.js";
import { emptySessionData, readSessionData, writeSessionData } from "../src/persistence/store.js";
import { captureScreenshot } from "../src/capture/visual-evidence.js";
import { sampleExportSessionData } from "./fixtures/sample-session.js";
import { sampleSession } from "./helpers/fixtures.js";
import { installChromeStorageMock, uninstallChromeStorageMock } from "./helpers/mock-chrome.js";
import { unzipToMap } from "./helpers/unzip.js";

describe("explicit visual evidence", () => {
  let sendCommand: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    installChromeStorageMock();
    sendCommand = vi.fn(async () => ({ data: "AAEC" }));
    const existing = (globalThis as { chrome?: { storage?: unknown } }).chrome;
    vi.stubGlobal("chrome", {
      ...existing,
      storage: existing?.storage,
      debugger: { sendCommand },
    });
    await writeSessionData({
      ...emptySessionData(),
      session: sampleSession({ active: true, tabId: 17 }),
    });
  });

  afterEach(() => {
    uninstallChromeStorageMock();
    vi.unstubAllGlobals();
  });

  it("captures one explicit PNG and preserves its opaque bytes", async () => {
    const screenshot = await captureScreenshot();
    const data = await readSessionData();

    expect(sendCommand).toHaveBeenCalledWith(
      { tabId: 17 },
      "Page.captureScreenshot",
      { format: "png", fromSurface: true, captureBeyondViewport: false },
    );
    expect(screenshot).toMatchObject({ state: "observed", format: "png", byteLength: 3 });
    expect(data.screenshots).toEqual([screenshot]);
  });

  it("records an unavailable screenshot and a health gap on CDP failure", async () => {
    sendCommand.mockRejectedValueOnce(new Error("Page domain unavailable"));

    const screenshot = await captureScreenshot();
    const data = await readSessionData();

    expect(screenshot).toMatchObject({ state: "unavailable", reason: "Page domain unavailable" });
    expect(data.screenshots).toEqual([screenshot]);
    expect(data.session?.health.partialGaps).toEqual(
      expect.arrayContaining([expect.objectContaining({ reason: "screenshot_capture_failed: Page domain unavailable" })]),
    );
  });

  it("exports observed screenshots as optional manifest-listed PNG artifacts", async () => {
    const data = sampleExportSessionData();
    data.screenshots = [{
      id: "shot-1",
      sessionId: data.session!.id,
      timestamp: 1,
      tabId: data.session!.tabId,
      format: "png",
      state: "observed",
      data: "AAEC",
      byteLength: 3,
    }];

    const files = unzipToMap(await buildZipFromSessionData(data, 1_700_000_000_000));
    const manifest = JSON.parse(files["export-manifest.json"]);

    expect(files["screenshots/shot-1.png"]).toBe("\u0000\u0001\u0002");
    expect(manifest.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "screenshots/shot-1.png", optional: true, bytes: 3 }),
    ]));
    expect(manifest.privacy.warnings).toContain(
      "Visual evidence is included; screenshots can contain visible secrets and are not text-redacted.",
    );
    expect(files["report.html"]).toContain("Visual evidence");
    expect(files["report.html"]).toContain("screenshots/shot-1.png");
  });

  it("bounds screenshot count and bytes and records truncation", async () => {
    const session = sampleSession({ active: true, tabId: 17 });
    const screenshots = Array.from({ length: 13 }, (_, index) => ({
      id: `shot-${index}`,
      sessionId: session.id,
      timestamp: index,
      tabId: 17,
      format: "png" as const,
      state: "unavailable" as const,
      reason: "test",
      byteLength: 1,
    }));
    await writeSessionData({ ...emptySessionData(), session, screenshots });

    let data = await readSessionData();
    expect(data.screenshots).toHaveLength(12);
    expect(data.screenshots?.[0]?.id).toBe("shot-1");
    expect(data.session?.health.truncation.screenshots).toBe(1);

    const oversized = [0, 1].map((index) => ({
      id: `large-${index}`,
      sessionId: session.id,
      timestamp: index,
      tabId: 17,
      format: "png" as const,
      state: "unavailable" as const,
      reason: "test",
      byteLength: 5 * 1024 * 1024,
    }));
    await writeSessionData({ ...data, screenshots: oversized });
    data = await readSessionData();
    expect(data.screenshots).toHaveLength(1);
    expect(data.screenshots?.[0]?.id).toBe("large-1");
    expect(data.screenshots?.[0]?.byteLength).toBe(5 * 1024 * 1024);
    expect(data.session?.health.truncation.screenshots).toBe(2);
  });
});
