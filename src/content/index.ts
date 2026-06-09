import { installConsoleCapture } from "./console-capture.js";
import { installUserActionCapture } from "./user-actions.js";
import { installNavigationCapture } from "./navigation.js";
import { captureDomSnapshot, collectDiagnostics } from "./diagnostics.js";
import type { ConsoleEntry, UserAction } from "../shared/types.js";
import type { DiagnosticsBundle, DomSnapshot } from "../shared/types.js";

const Msg = {
  GET_STATE: "GET_STATE",
  CAPTURE_STATE_CHANGED: "CAPTURE_STATE_CHANGED",
  RECORD_EVENT: "RECORD_EVENT",
} as const;

const SYNC_POLL_MS = 2000;

type Uninstall = () => void;
const uninstalls: Uninstall[] = [];
let activeSessionId: string | null = null;
let activeDebuggerConsole = false;
let diagInterval: ReturnType<typeof setInterval> | null = null;

function send(type: string, payload: object): void {
  chrome.runtime.sendMessage({ type, ...payload }).catch(() => {});
}

function sendConsole(entry: ConsoleEntry): void {
  send(Msg.RECORD_EVENT, { eventKind: "console", entry });
}

function sendUserAction(action: UserAction): void {
  send(Msg.RECORD_EVENT, { eventKind: "user", action });
}

function sendDiagnostics(bundle: DiagnosticsBundle): void {
  send(Msg.RECORD_EVENT, { eventKind: "diagnostics", bundle });
}

function sendDomSnapshot(snapshot: DomSnapshot): void {
  send(Msg.RECORD_EVENT, { eventKind: "dom", snapshot });
}

function stopCapture(): void {
  for (const u of uninstalls) u();
  uninstalls.length = 0;
  if (diagInterval) clearInterval(diagInterval);
  diagInterval = null;
  activeSessionId = null;
  activeDebuggerConsole = false;
}

function startCapture(sessionId: string, debuggerConsole: boolean): void {
  stopCapture();
  activeSessionId = sessionId;
  activeDebuggerConsole = debuggerConsole;

  // Console: content script only when CDP debugger is not capturing Runtime.console*
  if (!debuggerConsole) {
    uninstalls.push(installConsoleCapture(sessionId, sendConsole));
  }
  uninstalls.push(installUserActionCapture(sessionId, sendUserAction));
  uninstalls.push(installNavigationCapture(sessionId, sendUserAction));
  sendDiagnostics(collectDiagnostics());
  sendDomSnapshot(captureDomSnapshot(sessionId));
  diagInterval = setInterval(() => {
    sendDiagnostics(collectDiagnostics());
  }, 15_000);
}

function applyCaptureState(
  active: boolean,
  sessionId: string | null,
  debuggerConsole: boolean,
): void {
  if (!active || !sessionId) {
    stopCapture();
    return;
  }
  if (activeSessionId === sessionId && activeDebuggerConsole === debuggerConsole) return;
  startCapture(sessionId, debuggerConsole);
}

async function syncFromBackground(): Promise<void> {
  const res = (await chrome.runtime.sendMessage({ type: Msg.GET_STATE })) as
    | { session?: { id: string; active: boolean; health?: { debuggerAttached?: boolean } } }
    | undefined;
  const session = res?.session;
  if (session?.active) {
    applyCaptureState(true, session.id, session.health?.debuggerAttached ?? false);
  } else {
    applyCaptureState(false, null, false);
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === Msg.CAPTURE_STATE_CHANGED) {
    applyCaptureState(
      Boolean(message.active),
      (message.sessionId as string | null) ?? null,
      Boolean(message.debuggerConsole),
    );
  }
});

void syncFromBackground();
setInterval(() => void syncFromBackground(), SYNC_POLL_MS);
