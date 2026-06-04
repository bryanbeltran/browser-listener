import { MessageType } from "../shared/messages.js";
import type { ConsoleEntry } from "../shared/types.js";
import {
  appendConsoleEntry,
  clearLogs,
  readStorage,
  resetAll,
  writeSession,
} from "../shared/storage.js";
import { buildExportPayload, downloadJsonExport } from "../shared/export.js";
import { registerNetworkCapture } from "./network-capture.js";

function newSession() {
  return {
    id: crypto.randomUUID(),
    active: true,
    startedAt: Date.now(),
  };
}

async function broadcastCaptureState(active: boolean, sessionId: string | null): Promise<void> {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id == null) continue;
    chrome.tabs.sendMessage(tab.id, {
      type: MessageType.CAPTURE_STATE_CHANGED,
      active,
      sessionId,
    }).catch(() => {});
  }
}

async function startCapture(): Promise<void> {
  const { session: existing } = await readStorage();
  if (existing?.active) return;

  const session = newSession();
  await writeSession(session);
  await broadcastCaptureState(true, session.id);
}

async function stopCapture(): Promise<void> {
  const { session } = await readStorage();
  if (!session?.active) return;

  await writeSession({ ...session, active: false, stoppedAt: Date.now() });
  await broadcastCaptureState(false, null);
}

registerNetworkCapture();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const run = async (): Promise<unknown> => {
    switch (message?.type) {
      case MessageType.GET_STATE: {
        const data = await readStorage();
        return {
          session: data.session,
          consoleCount: data.consoleEntries.length,
          networkCount: data.networkEntries.length,
        };
      }
      case MessageType.START_CAPTURE:
        await startCapture();
        return { ok: true };
      case MessageType.STOP_CAPTURE:
        await stopCapture();
        return { ok: true };
      case MessageType.CLEAR_LOGS:
        await clearLogs();
        return { ok: true };
      case MessageType.EXPORT_LOGS: {
        const data = await readStorage();
        const payload = buildExportPayload(data);
        await downloadJsonExport(payload);
        return { ok: true };
      }
      case MessageType.CONSOLE_LOG: {
        const entry = message.entry as ConsoleEntry;
        const { session } = await readStorage();
        if (!session?.active || entry.sessionId !== session.id) {
          return { ok: false, reason: "inactive" };
        }
        const tabId = _sender.tab?.id;
        await appendConsoleEntry(tabId != null ? { ...entry, tabId } : entry);
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

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") void resetAll();
});
