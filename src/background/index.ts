import { MessageType } from "../shared/messages.js";
import { createSession, getActiveSession, stopSession } from "../capture/session-manager.js";
import {
  attachDebugger,
  ensureDebuggerForSession,
  isDebuggerAttachedToTab,
  registerDebuggerCapture,
  scheduleDebuggerAttachRetry,
  setOnDebuggerCanceledByUser,
} from "../capture/debugger-capture.js";
import { registerWebRequestCapture } from "../capture/web-request-capture.js";
import { registerReactionHydrationListeners, resetReactionHydrationScheduler } from "../capture/reaction-hydration.js";
import { stopAndExportInBackground, stopCaptureAndPrepareZip } from "../capture/stop-export.js";
import { uint8ToBase64 } from "../shared/bytes.js";
import {
  clearSessionData,
  readSessionData,
} from "../persistence/store.js";
import { loadRecoverableSession } from "../persistence/session-recovery.js";
import { onServiceWorkerActivate } from "./service-worker-lifecycle.js";
import { registerTabLifecycle } from "./tab-lifecycle.js";
import type { CaptureOptions } from "../shared/types.js";
import { DEFAULT_CAPTURE_OPTIONS } from "../shared/types.js";

async function startWithConsent(
  tabId: number,
  options: Partial<CaptureOptions> = {},
): Promise<void> {
  const tab = await chrome.tabs.get(tabId);
  const merged = { ...DEFAULT_CAPTURE_OPTIONS, ...options };
  await createSession(tabId, tab.url, merged);
  resetReactionHydrationScheduler();
  try {
    await attachDebugger(tabId);
    if (!isDebuggerAttachedToTab(tabId)) {
      throw new Error("Debugger attach did not complete");
    }
  } catch (err) {
    await stopSession();
    throw err;
  }
}

registerDebuggerCapture();
setOnDebuggerCanceledByUser(() => void stopAndExportInBackground());
registerWebRequestCapture();
registerTabLifecycle();
registerReactionHydrationListeners();

chrome.runtime.onInstalled.addListener(() => {
  void recoverSession();
});

async function recoverSession(): Promise<void> {
  const { shouldRecover, session } = await loadRecoverableSession();
  if (!shouldRecover || !session) return;
  try {
    await ensureDebuggerForSession();
  } catch {
    scheduleDebuggerAttachRetry();
  }
}

async function bootstrap(): Promise<void> {
  await onServiceWorkerActivate();
  await recoverSession();
}

void bootstrap();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const run = async (): Promise<unknown> => {
    switch (message?.type) {
      case MessageType.GET_STATE: {
        const data = await readSessionData();
        const hasData =
          data.network.length > 0 ||
          Boolean(data.enrichments?.facebookGroups);
        return {
          session: data.session,
          counts: { network: data.network.length },
          canExport: !data.session?.active && hasData,
        };
      }
      case MessageType.CONSENT_AND_START: {
        const tabId = message.tabId as number | undefined;
        const opts = (message.options as Partial<CaptureOptions>) ?? {};
        const id =
          tabId ??
          (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
        if (id == null) return { ok: false, error: "No active tab" };
        await startWithConsent(id, opts);
        return { ok: true };
      }
      case MessageType.STOP_AND_EXPORT: {
        const bundle = await stopCaptureAndPrepareZip();
        if (!bundle) return { ok: false, error: "Nothing to export" };
        return {
          ok: true,
          zipBase64: uint8ToBase64(bundle.zip),
          filename: bundle.filename,
          counts: bundle.counts,
        };
      }
      case MessageType.DISCARD_CAPTURE:
        if (await getActiveSession()) {
          return { ok: false, error: "Stop capture first" };
        }
        await clearSessionData();
        resetReactionHydrationScheduler();
        return { ok: true };
      default:
        return { ok: false };
    }
  };
  run()
    .then(sendResponse)
    .catch((err: Error) => sendResponse({ ok: false, error: err.message }));
  return true;
});
