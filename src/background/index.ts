import { MessageType } from "../shared/messages.js";
import {
  createSession,
  getActiveSession,
  stopSession,
} from "../capture/session-manager.js";
import {
  attachDebugger,
  detachDebugger,
  ensureDebuggerForSession,
  getAttachedTabId,
  registerDebuggerCapture,
} from "../capture/debugger-capture.js";
import { registerWebRequestCapture } from "../capture/web-request-capture.js";
import { recordTimeline } from "../capture/timeline.js";
import {
  appendConsole,
  appendDiagnostics,
  appendDomSnapshot,
  appendUserAction,
  clearSessionData,
  readSessionData,
} from "../persistence/store.js";
import { loadRecoverableSession } from "../persistence/session-recovery.js";
import { downloadZipExport } from "../export/orchestrator.js";
import { broadcastCaptureState } from "./broadcast.js";
import { onServiceWorkerActivate } from "./service-worker-lifecycle.js";
import { registerTabLifecycle } from "./tab-lifecycle.js";
import {
  enrichConsoleEntry,
  enrichDiagnosticsBundle,
  enrichDomSnapshot,
  enrichUserAction,
  userActionTimelineSummary,
} from "./sender-context.js";
import type { CaptureOptions, ConsoleEntry, UserAction } from "../shared/types.js";
import { DEFAULT_CAPTURE_OPTIONS } from "../shared/types.js";

async function startWithConsent(
  tabId: number,
  options: Partial<CaptureOptions> = {},
): Promise<void> {
  const tab = await chrome.tabs.get(tabId);
  const session = await createSession(tabId, tab.url, options);
  let debuggerAttached = false;
  try {
    await attachDebugger(tabId);
    debuggerAttached = getAttachedTabId() === tabId;
  } catch {
    /* webRequest fallback remains active */
  }
  await broadcastCaptureState(true, session.id, debuggerAttached);
}

async function stopAndExport(): Promise<void> {
  await detachDebugger();
  await stopSession();
  await broadcastCaptureState(false, null, false);
  await downloadZipExport();
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
          data.userActions.length > 0 ||
          data.timeline.length > 0;
        return {
          session: data.session,
          counts: {
            console: data.console.length,
            network: data.network.length,
            userActions: data.userActions.length,
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
        await startWithConsent(id, { ...DEFAULT_CAPTURE_OPTIONS, ...opts });
        return { ok: true };
      }
      case MessageType.STOP_AND_EXPORT:
        await stopAndExport();
        return { ok: true };
      case MessageType.EXPORT_CAPTURE:
        if (await getActiveSession()) {
          return { ok: false, error: "Stop capture before export" };
        }
        await downloadZipExport();
        return { ok: true };
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
          const entry = enrichConsoleEntry(message.entry as ConsoleEntry, sender);
          if (entry.sessionId !== session.id) return { ok: false };
          if (entry.source === "content" && session.health.debuggerAttached) {
            return { ok: true, skipped: "debugger_console_active" };
          }
          await appendConsole(entry);
        } else if (kind === "user") {
          const action = enrichUserAction(message.action as UserAction, sender);
          await appendUserAction(action);
          await recordTimeline(session.id, "user", action.type, userActionTimelineSummary(action), {
            frameId: action.frameId,
            tabId: action.tabId,
            payloadRef: action.id,
          });
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
