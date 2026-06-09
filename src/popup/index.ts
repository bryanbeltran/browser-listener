import { MessageType } from "../shared/messages.js";
import type { PopupStateResponse } from "../shared/messages.js";

const consentPanel = document.getElementById("consent-panel")!;
const activePanel = document.getElementById("active-panel")!;
const consentCheck = document.getElementById("consent-check") as HTMLInputElement;
const btnStart = document.getElementById("btn-start") as HTMLButtonElement;
const btnStopExport = document.getElementById("btn-stop-export") as HTMLButtonElement;
const statusEl = document.getElementById("status")!;
const healthHint = document.getElementById("health-hint")!;
const cConsole = document.getElementById("c-console")!;
const cNetwork = document.getElementById("c-network")!;
const cActions = document.getElementById("c-actions")!;

async function send<T>(type: string, extra: object = {}): Promise<T> {
  return chrome.runtime.sendMessage({ type, ...extra }) as Promise<T>;
}

function showActive(active: boolean): void {
  consentPanel.classList.toggle("hidden", active);
  activePanel.classList.toggle("hidden", !active);
}

function render(state: PopupStateResponse): void {
  const active = state.session?.active ?? false;
  showActive(active);
  if (active && state.session) {
    statusEl.textContent = `Session ${state.session.id.slice(0, 8)}…`;
    const gaps = state.session.health.partialGaps.length;
    const dbg = state.session.health.debuggerAttached;
    healthHint.textContent = gaps
      ? `Health: ${gaps} gap(s) logged${dbg ? "" : "; debugger not attached (webRequest fallback)"}`
      : dbg
        ? "Debugger attached"
        : "Using webRequest metadata fallback";
  }
  cConsole.textContent = String(state.counts.console);
  cNetwork.textContent = String(state.counts.network);
  cActions.textContent = String(state.counts.userActions);
  btnStart.disabled = !consentCheck.checked || active;
}

consentCheck.addEventListener("change", () => {
  btnStart.disabled = !consentCheck.checked;
});

btnStart.addEventListener("click", async () => {
  if (!consentCheck.checked) return;
  btnStart.disabled = true;
  try {
    await send(MessageType.CONSENT_AND_START, { consented: true });
    await refresh();
  } catch {
    btnStart.disabled = false;
  }
});

btnStopExport.addEventListener("click", async () => {
  btnStopExport.disabled = true;
  try {
    await send(MessageType.STOP_AND_EXPORT);
    consentCheck.checked = false;
    await refresh();
  } finally {
    btnStopExport.disabled = false;
  }
});

async function refresh(): Promise<void> {
  const state = await send<PopupStateResponse>(MessageType.GET_STATE);
  render(state);
}

void refresh();
setInterval(() => void refresh(), 2000);
