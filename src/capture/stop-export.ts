import { detachDebugger, flushPendingApiBodyCaptures } from "./debugger-capture.js";
import { getActiveSession, stopSession, updateSessionTabUrl } from "./session-manager.js";
import { captureTabMhtml } from "./page-snapshot.js";
import { broadcastCaptureState } from "../background/broadcast.js";
import { prepareZipExport } from "../export/orchestrator.js";
import { downloadZipFromWorker } from "../export/download.js";

let stopExportPromise: Promise<{ zip: Uint8Array; filename: string } | null> | null = null;

async function doStopAndPrepareZip(): Promise<{ zip: Uint8Array; filename: string } | null> {
  const session = await getActiveSession();
  let pageMhtml: string | undefined;

  if (session?.tabId != null) {
    try {
      const tab = await chrome.tabs.get(session.tabId);
      if (tab.url) await updateSessionTabUrl(tab.url);
      await flushPendingApiBodyCaptures();
      const mhtml = await captureTabMhtml(session.tabId);
      if (mhtml) pageMhtml = mhtml;
    } catch {
      /* tab unavailable — partial export without page snapshot */
    }
  }

  if (session) {
    await flushPendingApiBodyCaptures();
    await stopSession();
    await detachDebugger();
    await broadcastCaptureState(false, null, false);
  }

  return prepareZipExport({ pageMhtml });
}

/** Stop capture (if active), build ZIP. Safe to call concurrently. */
export function stopCaptureAndPrepareZip(): Promise<{ zip: Uint8Array; filename: string } | null> {
  if (!stopExportPromise) {
    stopExportPromise = doStopAndPrepareZip().finally(() => {
      stopExportPromise = null;
    });
  }
  return stopExportPromise;
}

/** Background-initiated stop + download (e.g. Chrome debugger Cancel). */
export async function stopAndExportInBackground(): Promise<void> {
  const bundle = await stopCaptureAndPrepareZip();
  if (!bundle) return;
  await downloadZipFromWorker(bundle.zip, bundle.filename);
}
