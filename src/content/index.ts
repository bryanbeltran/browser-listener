import { installConsoleCapture } from "./console-capture.js";
import { captureDomSnapshot, collectDiagnostics } from "./diagnostics.js";
import type { ConsoleEntry } from "../shared/types.js";
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
let activeConsoleCapture = false;
let diagInterval: ReturnType<typeof setInterval> | null = null;

function send(type: string, payload: object): void {
  chrome.runtime.sendMessage({ type, ...payload }).catch(() => {});
}

function sendConsole(entry: ConsoleEntry): void {
  send(Msg.RECORD_EVENT, { eventKind: "console", entry });
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
  activeConsoleCapture = false;
}

function startCapture(sessionId: string, consoleCapture: boolean): void {
  stopCapture();
  activeSessionId = sessionId;
  activeConsoleCapture = consoleCapture;

  if (consoleCapture) {
    uninstalls.push(installConsoleCapture(sessionId, sendConsole));
  }
  sendDiagnostics(collectDiagnostics());
  sendDomSnapshot(captureDomSnapshot(sessionId));
  diagInterval = setInterval(() => {
    sendDiagnostics(collectDiagnostics());
  }, 15_000);
}

function applyCaptureState(
  active: boolean,
  sessionId: string | null,
  consoleCapture: boolean,
): void {
  if (!active || !sessionId) {
    stopCapture();
    return;
  }
  if (activeSessionId === sessionId && activeConsoleCapture === consoleCapture) return;
  startCapture(sessionId, consoleCapture);
}

async function syncFromBackground(): Promise<void> {
  const res = (await chrome.runtime.sendMessage({ type: Msg.GET_STATE })) as
    | {
        session?: {
          id: string;
          active: boolean;
          options?: { consoleCapture?: boolean };
          health?: { debuggerAttached?: boolean };
        };
      }
    | undefined;
  const session = res?.session;
  if (session?.active) {
    const fromCdp = session.health?.debuggerAttached ?? false;
    const enabled = Boolean(session.options?.consoleCapture);
    applyCaptureState(true, session.id, enabled && !fromCdp);
  } else {
    applyCaptureState(false, null, false);
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === Msg.CAPTURE_STATE_CHANGED) {
    const fromCdp = Boolean(message.debuggerConsole);
    const enabled = Boolean(message.consoleCapture);
    applyCaptureState(
      Boolean(message.active),
      (message.sessionId as string | null) ?? null,
      enabled && !fromCdp,
    );
  }
});

void syncFromBackground();
setInterval(() => void syncFromBackground(), SYNC_POLL_MS);
