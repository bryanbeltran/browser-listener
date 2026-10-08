import {
  detachDebugger,
  flushPendingApiBodyCaptures,
  snapshotDebuggerHealthForExport,
} from "./debugger-capture.js";
import { runExportReactionHydration } from "./reaction-hydration.js";
import { getActiveSession, stopSession, updateSessionTabUrl } from "./session-manager.js";
import { readSessionMeta } from "../persistence/store.js";
import { prepareZipExport } from "../export/orchestrator.js";
import { downloadZipFromWorker } from "../export/download.js";
import type { TraceSummary } from "../shared/types.js";
import { isFacebookUrl } from "../shared/urls.js";

type ZipExportBundle = {
  zip: Uint8Array;
  filename: string;
  counts: TraceSummary["counts"];
};

let stopExportPromise: Promise<ZipExportBundle | null> | null = null;

async function doStopAndPrepareZip(): Promise<ZipExportBundle | null> {
  const active = await getActiveSession();
  const session = active ?? (await readSessionMeta());

  if (session?.tabId != null && session.active) {
    try {
      const tab = await chrome.tabs.get(session.tabId);
      if (tab.url) await updateSessionTabUrl(tab.url);
      await flushPendingApiBodyCaptures();
      if (isFacebookUrl(tab.url) && session.options.reactionHydration) {
        await runExportReactionHydration(session.tabId);
        await flushPendingApiBodyCaptures();
      }
    } catch {
      /* tab unavailable — partial export */
    }
  }

  if (session) {
    await flushPendingApiBodyCaptures();
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
