import { MessageType } from "../shared/messages.js";
import type { PopupStateResponse } from "../shared/messages.js";
import { hasTruncation } from "../persistence/limits.js";

const consentPanel = document.getElementById("consent-panel")!;
const activePanel = document.getElementById("active-panel")!;
const exportPanel = document.getElementById("export-panel")!;
const consentCheck = document.getElementById("consent-check") as HTMLInputElement;
const btnStart = document.getElementById("btn-start") as HTMLButtonElement;
const btnStopExport = document.getElementById("btn-stop-export") as HTMLButtonElement;
const btnExport = document.getElementById("btn-export") as HTMLButtonElement;
const btnNewSession = document.getElementById("btn-new-session") as HTMLButtonElement;
const statusEl = document.getElementById("status")!;
const healthHint = document.getElementById("health-hint")!;
const exportStatus = document.getElementById("export-status")!;
const exportHint = document.getElementById("export-hint")!;
const cConsole = document.getElementById("c-console")!;
const cNetwork = document.getElementById("c-network")!;
const cActions = document.getElementById("c-actions")!;
const eConsole = document.getElementById("e-console")!;
const eNetwork = document.getElementById("e-network")!;
const eActions = document.getElementById("e-actions")!;

async function send<T>(type: string, extra: object = {}): Promise<T> {
  return chrome.runtime.sendMessage({ type, ...extra }) as Promise<T>;
}

function truncationHint(session: PopupStateResponse["session"]): string {
  const t = session?.health.truncation;
  if (!t || !hasTruncation(t)) return "";
  return `Truncated: console −${t.console}, network −${t.network}, timeline −${t.timeline}, actions −${t.userActions}`;
}

function render(state: PopupStateResponse): void {
  const active = state.session?.active ?? false;
  const canExport = state.canExport;

  consentPanel.classList.toggle("hidden", active || canExport);
  activePanel.classList.toggle("hidden", !active);
  exportPanel.classList.toggle("hidden", active || !canExport);

  cConsole.textContent = String(state.counts.console);
  cNetwork.textContent = String(state.counts.network);
  cActions.textContent = String(state.counts.userActions);
  eConsole.textContent = String(state.counts.console);
  eNetwork.textContent = String(state.counts.network);
  eActions.textContent = String(state.counts.userActions);

  if (active && state.session) {
    statusEl.textContent = `Session ${state.session.id.slice(0, 8)}…`;
    const gaps = state.session.health.partialGaps.length;
    const dbg = state.session.health.debuggerAttached;
    const trunc = truncationHint(state.session);
    healthHint.textContent =
      trunc ||
      (gaps
        ? `Health: ${gaps} gap(s) logged${dbg ? "" : "; debugger not attached (webRequest fallback)"}`
        : dbg
          ? "Debugger attached"
          : "Using webRequest metadata fallback");
  }

  if (canExport && state.session) {
    exportStatus.textContent = state.session.tabClosedDuringCapture
      ? "Tab closed — partial capture ready"
      : "Capture ended — ready to export";
    const trunc = truncationHint(state.session);
    const gaps = state.session.health.partialGaps.length;
    exportHint.textContent =
      trunc || (gaps ? `${gaps} capture gap(s) recorded in export health` : "Local ZIP only");
  }

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

btnExport.addEventListener("click", async () => {
  btnExport.disabled = true;
  try {
    await send(MessageType.EXPORT_CAPTURE);
  } finally {
    btnExport.disabled = false;
  }
});

btnNewSession.addEventListener("click", async () => {
  await send(MessageType.DISCARD_CAPTURE);
  consentCheck.checked = false;
  await refresh();
});

async function refresh(): Promise<void> {
  const state = await send<PopupStateResponse>(MessageType.GET_STATE);
  render(state);
}

void refresh();
setInterval(() => void refresh(), 2000);
