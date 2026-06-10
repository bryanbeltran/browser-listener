import { MessageType } from "../shared/messages.js";
import type { ExportZipResponse } from "../shared/messages.js";
import { base64ToUint8 } from "../shared/bytes.js";
import { downloadZipFromPage } from "../export/download.js";
import { hasTruncation } from "../persistence/limits.js";
import type { PopupStateResponse } from "../shared/messages.js";
import { readPopupState } from "./popup-state.js";
import { sendMessageWithTimeout } from "./messaging.js";

const EMPTY_STATE: PopupStateResponse = {
  session: null,
  counts: { console: 0, network: 0, timeline: 0 },
  canExport: false,
};

function el<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

const loadingPanel = el("loading-panel");
const startPanel = el("start-panel");
const activePanel = el("active-panel");
const exportPanel = el("export-panel");
const optGraphqlBodies = el<HTMLInputElement>("opt-graphql-bodies");
const optConsole = el<HTMLInputElement>("opt-console");
const btnStart = el<HTMLButtonElement>("btn-start");
const btnStop = el<HTMLButtonElement>("btn-stop");
const btnExport = el<HTMLButtonElement>("btn-export");
const btnNewSession = el<HTMLButtonElement>("btn-new-session");
const statusEl = el("status");
const healthHint = el("health-hint");
const exportStatus = el("export-status");
const exportHint = el("export-hint");
const cNetwork = el("c-network");
const cTimeline = el("c-timeline");
const eNetwork = el("e-network");
const eTimeline = el("e-timeline");

function truncationHint(session: PopupStateResponse["session"]): string {
  const t = session?.health?.truncation;
  if (!t || !hasTruncation(t)) return "";
  return `Truncated: console −${t.console}, network −${t.network}, timeline −${t.timeline}`;
}

function setText(node: HTMLElement | null, text: string): void {
  if (node) node.textContent = text;
}

function render(state: Awaited<ReturnType<typeof readPopupState>>, loaded = true): void {
  const active = state.session?.active ?? false;
  const canExport = state.canExport;

  loadingPanel?.classList.toggle("hidden", loaded);
  startPanel?.classList.toggle("hidden", !loaded || active || canExport);
  activePanel?.classList.toggle("hidden", !loaded || !active);
  exportPanel?.classList.toggle("hidden", !loaded || active || !canExport);

  setText(cNetwork, String(state.counts.network));
  setText(cTimeline, String(state.counts.timeline));
  setText(eNetwork, String(state.counts.network));
  setText(eTimeline, String(state.counts.timeline));

  if (active && state.session) {
    setText(statusEl, `Session ${state.session.id.slice(0, 8)}…`);
    const gaps = state.session.health?.partialGaps?.length ?? 0;
    const dbg = state.session.health?.debuggerAttached ?? false;
    const trunc = truncationHint(state.session);
    setText(
      healthHint,
      trunc ||
        (gaps
          ? `Health: ${gaps} gap(s) logged${dbg ? "" : "; debugger not attached (webRequest fallback)"}`
          : dbg
            ? "Debugger attached"
            : "Using webRequest metadata fallback"),
    );
  }

  if (canExport && state.session) {
    setText(
      exportStatus,
      state.session.tabClosedDuringCapture
        ? "Tab closed — partial capture ready"
        : "Capture ended",
    );
    const trunc = truncationHint(state.session);
    const gaps = state.session.health?.partialGaps?.length ?? 0;
    setText(exportHint, trunc || (gaps ? `${gaps} capture gap(s) recorded` : "ZIP downloaded locally"));
  }

  if (btnStart) btnStart.disabled = active;
}

async function downloadFromResponse(res: ExportZipResponse): Promise<void> {
  if (!res.ok) throw new Error(res.error ?? "Export failed");
  if (!res.zipBase64 || !res.filename) throw new Error("Export returned no file");
  const zip = base64ToUint8(res.zipBase64);
  await downloadZipFromPage(zip, res.filename, true);
}

btnStart?.addEventListener("click", async () => {
  btnStart.disabled = true;
  try {
    await sendMessageWithTimeout(
      {
        type: MessageType.CONSENT_AND_START,
        options: {
          graphqlBodies: optGraphqlBodies?.checked ?? true,
          consoleCapture: optConsole?.checked ?? false,
        },
      },
      30_000,
    );
    await refresh();
  } catch {
    btnStart.disabled = false;
  }
});

let captureActive = false;
let stopRequested = false;

async function requestStopAndExport(): Promise<void> {
  if (stopRequested) return;
  const state = await readPopupState();
  if (!state.session?.active) return;

  stopRequested = true;
  if (btnStop) btnStop.disabled = true;
  setText(healthHint, "Preparing ZIP…");
  try {
    const res = await sendMessageWithTimeout<ExportZipResponse>(
      { type: MessageType.STOP_AND_EXPORT },
      180_000,
    );
    await downloadFromResponse(res);
    captureActive = false;
    setText(exportHint, `Saved ${res.filename ?? "export"}`);
    await refresh();
  } catch (err) {
    stopRequested = false;
    if (btnStop) btnStop.disabled = false;
    setText(healthHint, err instanceof Error ? err.message : "Export failed");
  }
}

btnStop?.addEventListener("click", () => void requestStopAndExport());

btnExport?.addEventListener("click", async () => {
  btnExport.disabled = true;
  setText(exportHint, "Preparing ZIP…");
  try {
    const res = await sendMessageWithTimeout<ExportZipResponse>(
      { type: MessageType.EXPORT_CAPTURE },
      180_000,
    );
    await downloadFromResponse(res);
    setText(exportHint, `Saved ${res.filename ?? "export"}`);
  } catch (err) {
    setText(exportHint, err instanceof Error ? err.message : "Export failed");
  } finally {
    btnExport.disabled = false;
  }
});

btnNewSession?.addEventListener("click", async () => {
  await sendMessageWithTimeout({ type: MessageType.DISCARD_CAPTURE }, 30_000);
  await refresh();
});

async function refresh(): Promise<void> {
  try {
    const state = await readPopupState();
    captureActive = state.session?.active ?? false;
    if (!captureActive) stopRequested = false;
    render(state, true);
  } catch {
    captureActive = false;
    render({ session: null, counts: EMPTY_STATE.counts, canExport: false }, true);
    setText(healthHint, "Could not read session storage");
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.browserListenerSessionData || changes.browserListenerActiveSessionId) {
    void refresh();
  }
});

void refresh();
setInterval(() => void refresh(), 2000);
