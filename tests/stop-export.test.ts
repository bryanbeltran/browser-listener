import { beforeEach, describe, expect, it, vi } from "vitest";
import { sampleSession } from "./helpers/fixtures.js";

const { getActiveSession } = vi.hoisted(() => ({
  getActiveSession: vi.fn(),
}));

vi.mock("../src/capture/session-manager.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/capture/session-manager.js")>();
  return {
    ...actual,
    getActiveSession,
    stopSession: vi.fn(async () => sampleSession({ active: false })),
    updateSessionTabUrl: vi.fn(async () => {}),
  };
});

vi.mock("../src/capture/debugger-capture.js", () => ({
  detachDebugger: vi.fn(async () => {}),
  flushPendingApiBodyCaptures: vi.fn(async () => {}),
}));

vi.mock("../src/capture/page-snapshot.js", () => ({
  captureTabMhtml: vi.fn(async () => null),
}));

vi.mock("../src/background/broadcast.js", () => ({
  broadcastCaptureState: vi.fn(async () => {}),
}));

vi.mock("../src/export/orchestrator.js", () => ({
  prepareZipExport: vi.fn(async () => ({
    zip: new Uint8Array([1, 2, 3]),
    filename: "test.zip",
  })),
}));

vi.mock("../src/export/download.js", () => ({
  downloadZipFromWorker: vi.fn(async () => {}),
}));

describe("stopAndExport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("dedupes concurrent stopCaptureAndPrepareZip calls", async () => {
    const { stopCaptureAndPrepareZip } = await import("../src/capture/stop-export.js");
    const { prepareZipExport } = await import("../src/export/orchestrator.js");

    getActiveSession.mockResolvedValue(sampleSession({ active: true }));

    await Promise.all([
      stopCaptureAndPrepareZip(),
      stopCaptureAndPrepareZip(),
      stopCaptureAndPrepareZip(),
    ]);

    expect(prepareZipExport).toHaveBeenCalledTimes(1);
  });

  it("stopAndExportInBackground downloads via worker helper", async () => {
    const { stopAndExportInBackground } = await import("../src/capture/stop-export.js");
    const { downloadZipFromWorker } = await import("../src/export/download.js");

    getActiveSession.mockResolvedValue(sampleSession({ active: true }));

    await stopAndExportInBackground();

    expect(downloadZipFromWorker).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      "test.zip",
    );
  });
});
