import { MessageType } from "../shared/messages.js";
import { getActiveSession } from "../capture/session-manager.js";

export interface CaptureStatePayload {
  type: typeof MessageType.CAPTURE_STATE_CHANGED;
  active: boolean;
  sessionId: string | null;
  /** When true, console comes from CDP — content script must not wrap console.* */
  debuggerConsole: boolean;
  consoleCapture: boolean;
}

export async function broadcastCaptureState(
  active: boolean,
  sessionId: string | null,
  debuggerConsole?: boolean,
): Promise<void> {
  const session = await getActiveSession();
  const tabId =
    session?.tabId ??
    (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
  if (tabId == null) return;

  const payload: CaptureStatePayload = {
    type: MessageType.CAPTURE_STATE_CHANGED,
    active,
    sessionId,
    debuggerConsole:
      debuggerConsole ?? (active ? (session?.health.debuggerAttached ?? false) : false),
    consoleCapture: active ? (session?.options.consoleCapture ?? false) : false,
  };

  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    if (frames?.length) {
      for (const frame of frames) {
        if (frame.frameId == null) continue;
        chrome.tabs.sendMessage(tabId, payload, { frameId: frame.frameId }).catch(() => {});
      }
      return;
    }
  } catch {
    /* fall through to top-frame send */
  }

  chrome.tabs.sendMessage(tabId, payload).catch(() => {});
}
