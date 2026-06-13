import { MessageType } from "../shared/messages.js";
import { createSession, getActiveSession } from "../capture/session-manager.js";
import {
  attachDebugger,
  ensureDebuggerForSession,
  registerDebuggerCapture,
} from "../capture/debugger-capture.js";
import { registerWebRequestCapture } from "../capture/web-request-capture.js";
import { stopCaptureAndPrepareZip } from "../capture/stop-export.js";
import { prepareZipExport } from "../export/orchestrator.js";
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
  try {
    await attachDebugger(tabId);
  } catch {
    /* webRequest fallback remains active */
  }
}

registerDebuggerCapture();
registerWebRequestCapture();
registerTabLifecycle();

chrome.runtime.onInstalled.addListener(() => {
  void recoverSession();
});

async function recoverSession(): Promise<void> {
  const { shouldRecover, session } = await loadRecoverableSession();
  if (!shouldRecover || !session) return;
  try {
    await ensureDebuggerForSession();
  } catch {
    /* partial recovery noted in health */
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
        if (await getActiveSession()) return { ok: false, error: "Already capturing" };
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
      case MessageType.EXPORT_CAPTURE: {
        if (await getActiveSession()) {
          return { ok: false, error: "Stop capture before export" };
        }
        const bundle = await prepareZipExport();
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
