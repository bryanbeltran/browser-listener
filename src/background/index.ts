import { MessageType } from "../shared/messages.js";
import {
  activateCaptureSession,
  createSession,
  getActiveSession,
  pauseCapture,
  recordNavigation,
  resumeCapture,
  stopSession,
} from "../capture/session-manager.js";
import {
  attachDebugger,
  ensureDebuggerForSession,
  isDebuggerAttachedToTab,
  registerDebuggerCapture,
  scheduleDebuggerAttachRetry,
  setOnDebuggerCanceledByUser,
} from "../capture/debugger-capture.js";
import { stopAndExportInBackground, stopCaptureAndPrepareZip } from "../capture/stop-export.js";
import { uint8ToBase64 } from "../shared/bytes.js";
import {
  clearSessionData,
  appendMarker,
  readSessionData,
} from "../persistence/store.js";
import {
  readRedactionConfig,
  readRedactionPreference,
  resetRedactionConfigPreference,
  setRedactionConfigPreference,
  setRedactionPreference,
} from "../persistence/preferences.js";
import { loadRecoverableSession } from "../persistence/session-recovery.js";
import { onServiceWorkerActivate } from "./service-worker-lifecycle.js";
import { registerTabLifecycle } from "./tab-lifecycle.js";
import type { CaptureOptions, MarkerEntry } from "../shared/types.js";
import { isCaptureableUrl } from "../shared/urls.js";

async function startWithConsent(
  tabId: number,
  options: Partial<CaptureOptions> = {},
): Promise<void> {
  const tab = await chrome.tabs.get(tabId);
  if (!isCaptureableUrl(tab.url)) {
    throw new Error("Open a regular web page before starting capture");
  }
  await createSession(tabId, tab.url, options);
  try {
    await attachDebugger(tabId);
    if (!isDebuggerAttachedToTab(tabId)) {
      throw new Error("Debugger attach did not complete");
    }
    await activateCaptureSession();
    await recordNavigation(tabId, tab.url, tab.title);
  } catch (err) {
    await clearSessionData();
    throw err;
  }
}

registerDebuggerCapture();
setOnDebuggerCanceledByUser(() => void stopAndExportInBackground());
registerTabLifecycle();

chrome.runtime.onInstalled.addListener(() => {
  void recoverSession();
});

async function recoverSession(): Promise<void> {
  const { shouldRecover, session } = await loadRecoverableSession();
  if (!shouldRecover || !session) return;
  try {
    await ensureDebuggerForSession();
    if (!isDebuggerAttachedToTab(session.tabId)) {
      throw new Error("Debugger attach did not complete on recovery");
    }
  } catch {
    if (session.health.debuggerEverAttached) {
      scheduleDebuggerAttachRetry();
      return;
    }
    await stopSession();
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
        const redactionEnabled = await readRedactionPreference();
        const redactionConfig = await readRedactionConfig();
        const hasData =
          data.network.length > 0 ||
          data.navigation.length > 0 ||
          data.console.length > 0 ||
          (data.markers?.length ?? 0) > 0;
        return {
          session: data.session,
          counts: {
            network: data.network.length,
            navigation: data.navigation.length,
            console: data.console.length,
            markers: data.markers?.length ?? 0,
          },
          canExport: !data.session?.active && hasData,
          redactionEnabled,
          redactionConfig,
        };
      }
      case MessageType.SET_REDACTION: {
        if (await getActiveSession()) {
          return { ok: false, error: "Stop capture before changing redaction" };
        }
        const redactionEnabled = message.redactionEnabled !== false;
        await setRedactionPreference(redactionEnabled);
        return { ok: true, redactionEnabled };
      }
      case MessageType.SET_REDACTION_CONFIG: {
        if (await getActiveSession()) {
          return { ok: false, error: "Stop capture before changing redaction rules" };
        }
        const redactionConfig = await setRedactionConfigPreference(message.config ?? {});
        return { ok: true, redactionConfig };
      }
      case MessageType.RESET_REDACTION_CONFIG: {
        if (await getActiveSession()) {
          return { ok: false, error: "Stop capture before changing redaction rules" };
        }
        const redactionConfig = await resetRedactionConfigPreference();
        return { ok: true, redactionConfig };
      }
      case MessageType.ADD_MARKER: {
        const session = await getActiveSession();
        if (!session || session.paused) return { ok: false, error: "Resume capture before adding a marker" };
        const note = typeof message.note === "string" ? message.note.trim().slice(0, 500) : "";
        let url = session.tabUrl;
        try {
          const tab = await chrome.tabs.get(session.tabId);
          url = tab.url ?? url;
        } catch {
          // The session snapshot remains the source of truth when the tab is unavailable.
        }
        const marker: MarkerEntry = {
          id: crypto.randomUUID(),
          sessionId: session.id,
          timestamp: Date.now(),
          label: "User marker",
          note: note || undefined,
          url,
          tabId: session.tabId,
        };
        await appendMarker(marker);
        return { ok: true, markerId: marker.id };
      }
      case MessageType.PAUSE_CAPTURE: {
        const session = await pauseCapture();
        if (!session) return { ok: false, error: "No active capture session" };
        return { ok: true, paused: session.paused ?? false };
      }
      case MessageType.RESUME_CAPTURE: {
        const session = await resumeCapture();
        if (!session) return { ok: false, error: "No active capture session" };
        return { ok: true, paused: session.paused ?? false };
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
