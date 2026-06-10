import { MessageType } from "../shared/messages.js";
import { createSession, getActiveSession } from "../capture/session-manager.js";
import {
  attachDebugger,
  ensureDebuggerForSession,
  getAttachedTabId,
  registerDebuggerCapture,
} from "../capture/debugger-capture.js";
import { registerWebRequestCapture } from "../capture/web-request-capture.js";
import { stopCaptureAndPrepareZip } from "../capture/stop-export.js";
import { prepareZipExport } from "../export/orchestrator.js";
import { uint8ToBase64 } from "../shared/bytes.js";
import {
  appendConsole,
  appendDiagnostics,
  appendDomSnapshot,
  clearSessionData,
  readSessionData,
} from "../persistence/store.js";
import { loadRecoverableSession } from "../persistence/session-recovery.js";
import { broadcastCaptureState } from "./broadcast.js";
import { onServiceWorkerActivate } from "./service-worker-lifecycle.js";
import { registerTabLifecycle } from "./tab-lifecycle.js";
import {
  enrichConsoleEntry,
  enrichDiagnosticsBundle,
  enrichDomSnapshot,
} from "./sender-context.js";
import type { CaptureOptions, ConsoleEntry } from "../shared/types.js";
import { DEFAULT_CAPTURE_OPTIONS } from "../shared/types.js";

async function startWithConsent(
  tabId: number,
  options: Partial<CaptureOptions> = {},
): Promise<void> {
  const tab = await chrome.tabs.get(tabId);
  const merged = { ...DEFAULT_CAPTURE_OPTIONS, ...options };
  const session = await createSession(tabId, tab.url, merged);
  let debuggerAttached = false;
  try {
    await attachDebugger(tabId);
    debuggerAttached = getAttachedTabId() === tabId;
  } catch {
    /* webRequest fallback remains active */
  }
  await broadcastCaptureState(true, session.id, debuggerAttached);
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
    const debuggerAttached = getAttachedTabId() === session.tabId;
    await broadcastCaptureState(true, session.id, debuggerAttached);
  } catch {
    /* partial recovery noted in health */
  }
}

async function bootstrap(): Promise<void> {
  await onServiceWorkerActivate();
  await recoverSession();
}

void bootstrap();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const run = async (): Promise<unknown> => {
    switch (message?.type) {
      case MessageType.GET_STATE: {
        const data = await readSessionData();
        const hasData =
          data.console.length > 0 ||
          data.network.length > 0 ||
          data.timeline.length > 0 ||
          Boolean(data.enrichments?.facebookGroups);
        return {
          session: data.session,
          counts: {
            console: data.console.length,
            network: data.network.length,
            timeline: data.timeline.length,
          },
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
        };
      }
      case MessageType.DISCARD_CAPTURE:
        if (await getActiveSession()) {
          return { ok: false, error: "Stop capture first" };
        }
        await clearSessionData();
        return { ok: true };
      case MessageType.RECORD_EVENT: {
        const session = await getActiveSession();
        if (!session) return { ok: false, reason: "inactive" };
        const kind = message.eventKind as string;
        if (kind === "console") {
          if (!session.options.consoleCapture) return { ok: true, skipped: "console_disabled" };
          const entry = enrichConsoleEntry(message.entry as ConsoleEntry, sender);
          if (entry.sessionId !== session.id) return { ok: false };
          if (entry.source === "content" && session.health.debuggerAttached) {
            return { ok: true, skipped: "debugger_console_active" };
          }
          await appendConsole(entry);
        } else if (kind === "diagnostics") {
          await appendDiagnostics(enrichDiagnosticsBundle(message.bundle, sender));
        } else if (kind === "dom") {
          await appendDomSnapshot(enrichDomSnapshot(message.snapshot, sender));
        }
        return { ok: true };
      }
      default:
        return { ok: false };
    }
  };
  run()
    .then(sendResponse)
    .catch((err: Error) => sendResponse({ ok: false, error: err.message }));
  return true;
});
