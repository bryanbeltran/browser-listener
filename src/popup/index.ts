import { MessageType } from "../shared/messages.js";
import type { GetStateResponse } from "../shared/messages.js";

const statusEl = document.getElementById("status")!;
const consoleCountEl = document.getElementById("console-count")!;
const networkCountEl = document.getElementById("network-count")!;
const btnStart = document.getElementById("btn-start") as HTMLButtonElement;
const btnStop = document.getElementById("btn-stop") as HTMLButtonElement;
const btnExport = document.getElementById("btn-export") as HTMLButtonElement;
const btnClear = document.getElementById("btn-clear") as HTMLButtonElement;

async function send<T>(type: string): Promise<T> {
  return chrome.runtime.sendMessage({ type }) as Promise<T>;
}

function setUi(state: GetStateResponse): void {
  const active = state.session?.active ?? false;
  statusEl.textContent = active
    ? `Capturing (session ${state.session!.id.slice(0, 8)}…)`
    : "Idle";
  statusEl.classList.toggle("active", active);
  consoleCountEl.textContent = String(state.consoleCount);
  networkCountEl.textContent = String(state.networkCount);
  btnStart.disabled = active;
  btnStop.disabled = !active;
}

async function refresh(): Promise<void> {
  const state = await send<GetStateResponse>(MessageType.GET_STATE);
  setUi(state);
}

btnStart.addEventListener("click", async () => {
  await send(MessageType.START_CAPTURE);
  await refresh();
});

btnStop.addEventListener("click", async () => {
  await send(MessageType.STOP_CAPTURE);
  await refresh();
});

btnExport.addEventListener("click", async () => {
  btnExport.disabled = true;
  try {
    await send(MessageType.EXPORT_LOGS);
  } finally {
    btnExport.disabled = false;
  }
});

btnClear.addEventListener("click", async () => {
  if (!confirm("Clear all captured console and network entries?")) return;
  await send(MessageType.CLEAR_LOGS);
  await refresh();
});

void refresh();
