import { pageCaptureStub } from "../page-capture/index.js";
import type { ExportPayload } from "./types.js";
import { readStorage } from "./storage.js";

export function buildExportPayload(data: Awaited<ReturnType<typeof readStorage>>): ExportPayload {
  return {
    exportedAt: Date.now(),
    session: data.session,
    console: data.consoleEntries,
    network: data.networkEntries,
    pageCapture: pageCaptureStub(),
  };
}

export async function downloadJsonExport(payload: ExportPayload): Promise<void> {
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const filename = `browser-listener-${payload.session?.id ?? "no-session"}-${payload.exportedAt}.json`;

  try {
    await chrome.downloads.download({
      url,
      filename,
      saveAs: true,
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
}
