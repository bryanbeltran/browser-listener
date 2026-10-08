import {
  detachDebugger,
  flushPendingBodyCaptures,
  snapshotDebuggerHealthForExport,
} from "./debugger-capture.js";
import { getActiveSession, stopSession } from "./session-manager.js";
import { readSessionMeta } from "../persistence/store.js";
import { prepareZipExport } from "../export/orchestrator.js";
import { downloadZipFromWorker } from "../export/download.js";
import type { SessionSummary } from "../shared/types.js";
import { recordNavigation } from "./session-manager.js";

type ZipExportBundle = {
  zip: Uint8Array;
  filename: string;
  counts: SessionSummary["counts"];
};

let stopExportPromise: Promise<ZipExportBundle | null> | null = null;

async function doStopAndPrepareZip(): Promise<ZipExportBundle | null> {
  const active = await getActiveSession();
  const session = active ?? (await readSessionMeta());

  if (session?.tabId != null && session.active) {
    try {
      const tab = await chrome.tabs.get(session.tabId);
      if (tab.url) {
        await recordNavigation(session.tabId, tab.url, tab.title);
      }
      await flushPendingBodyCaptures();
    } catch {
      /* tab unavailable — partial export */
    }
  }

  if (session) {
    await flushPendingBodyCaptures();
    await snapshotDebuggerHealthForExport();
    if (session.active) {
      await stopSession();
      await detachDebugger();
    }
  }

  return prepareZipExport();
}

/** Stop capture (if active), build ZIP. Safe to call concurrently. */
export function stopCaptureAndPrepareZip(): Promise<ZipExportBundle | null> {
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
