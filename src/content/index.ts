import { installConsoleCapture } from "./console-capture.js";
import type { ConsoleEntry } from "../shared/types.js";

/** Kept in sync with src/shared/messages.ts (content script must not import shared runtime). */
const MessageType = {
  GET_STATE: "GET_STATE",
  CONSOLE_LOG: "CONSOLE_LOG",
  CAPTURE_STATE_CHANGED: "CAPTURE_STATE_CHANGED",
} as const;

let uninstallConsole: (() => void) | null = null;
let activeSessionId: string | null = null;

function sendConsoleEntry(entry: ConsoleEntry): void {
  chrome.runtime.sendMessage({ type: MessageType.CONSOLE_LOG, entry }).catch(() => {
    // Background may be unavailable during reload; ignore.
  });
}

function startCapture(sessionId: string): void {
  if (activeSessionId === sessionId) return;
  stopCapture();
  activeSessionId = sessionId;
  uninstallConsole = installConsoleCapture(sessionId, sendConsoleEntry);
}

function stopCapture(): void {
  uninstallConsole?.();
  uninstallConsole = null;
  activeSessionId = null;
}

async function syncFromBackground(): Promise<void> {
  const response = (await chrome.runtime.sendMessage({ type: MessageType.GET_STATE })) as
    | { session?: { id: string; active: boolean } }
    | undefined;
  if (response?.session?.active) {
    startCapture(response.session.id);
  } else {
    stopCapture();
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === MessageType.CAPTURE_STATE_CHANGED) {
    if (message.active && message.sessionId) {
      startCapture(message.sessionId);
    } else {
      stopCapture();
    }
  }
});

void syncFromBackground();
