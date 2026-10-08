import { MessageType } from "../shared/messages.js";
import type { ExportEntityCounts, ExportZipResponse } from "../shared/messages.js";
import { base64ToUint8 } from "../shared/bytes.js";
import { downloadZipFromPage } from "../export/download.js";
import { hasTruncation } from "../persistence/limits.js";
import { REDACTION_PREFERENCE_KEY } from "../persistence/preferences.js";
import type { PopupStateResponse } from "../shared/messages.js";
import { readPopupState } from "./popup-state.js";
import { sendMessageWithTimeout } from "./messaging.js";

const EMPTY_STATE: PopupStateResponse = {
  session: null,
  counts: { network: 0, navigation: 0, console: 0 },
  canExport: false,
  redactionEnabled: true,
};

function el<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

const loadingPanel = el("loading-panel");
const startPanel = el("start-panel");
const activePanel = el("active-panel");
const exportPanel = el("export-panel");
const btnStart = el<HTMLButtonElement>("btn-start");
const consentCheckbox = el<HTMLInputElement>("consent-checkbox");
const bodyCaptureCheckbox = el<HTMLInputElement>("body-capture-checkbox");
const redactionCheckbox = el<HTMLInputElement>("redaction-checkbox");
const redactionWarning = el("redaction-warning");
const btnStop = el<HTMLButtonElement>("btn-stop");
const btnNewSession = el<HTMLButtonElement>("btn-new-session");
const statusEl = el("status");
const healthHint = el("health-hint");
const exportStatus = el("export-status");
const exportHint = el("export-hint");
const exportEntities = el("export-entities");
const startError = el("start-error");
const cNetwork = el("c-network");
const cNavigation = el("c-navigation");
const cConsole = el("c-console");
const eNetwork = el("e-network");
const eNavigation = el("e-navigation");
const eConsole = el("e-console");

function truncationHint(session: PopupStateResponse["session"]): string {
  const t = session?.health?.truncation;
  if (!t || !hasTruncation(t)) return "";
  const parts = [
    t.network ? `network −${t.network}` : "",
    t.navigation ? `navigation −${t.navigation}` : "",
    t.console ? `console −${t.console}` : "",
  ].filter(Boolean);
  return parts.length ? `Truncated: ${parts.join(", ")}` : "";
}

function debuggerHealthHint(session: PopupStateResponse["session"]): string {
  if (!session) return "";
  const dbg = session.health?.debuggerAttached ?? false;
  const gaps = session.health?.partialGaps ?? [];
  const attachErr = session.health?.lastAttachError;
  const attachGap = gaps.find((g) => g.reason.startsWith("debugger_attach_failed"));
  if (dbg) return "Debugger attached — network and console capture active";
  if (attachErr) return `Attach failed: ${attachErr}`;
  if (attachGap) {
    return attachGap.reason.replace(/^debugger_attach_failed:\s*/, "Attach failed: ");
  }
  if (gaps.length) {
    return `Health: ${gaps.length} gap(s) logged; metadata-only fallback`;
  }
  return "Debugger not attached — metadata-only fallback";
}

function formatEntityCounts(counts: ExportEntityCounts): string {
  return `${counts.network} network · ${counts.navigation} navigation · ${counts.console} console`;
}

function showExportEntities(counts?: ExportEntityCounts): void {
  if (!exportEntities) return;
  if (!counts) {
    exportEntities.classList.add("hidden");
    exportEntities.textContent = "";
    return;
  }
  exportEntities.textContent = formatEntityCounts(counts);
  exportEntities.classList.remove("hidden");
}

let lastExportCounts: ExportEntityCounts | undefined;

function applyExportResult(res: ExportZipResponse): void {
  if (res.counts) lastExportCounts = res.counts;
  showExportEntities(lastExportCounts);
  setText(exportHint, `Saved ${res.filename ?? "export"}`);
}

function showStartError(message: string): void {
  if (!startError) return;
  if (message) {
    startError.textContent = message;
    startError.classList.remove("hidden");
  } else {
    startError.textContent = "";
    startError.classList.add("hidden");
  }
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
  setText(cNavigation, String(state.counts.navigation));
  setText(cConsole, String(state.counts.console));
  setText(eNetwork, String(state.counts.network));
  setText(eNavigation, String(state.counts.navigation));
  setText(eConsole, String(state.counts.console));
  if (redactionCheckbox) {
    redactionCheckbox.checked = state.redactionEnabled;
    redactionCheckbox.disabled = active || canExport;
  }
  redactionWarning?.classList.toggle("hidden", state.redactionEnabled);

  if (active && state.session) {
    setText(statusEl, `Session ${state.session.id.slice(0, 8)}…`);
    const trunc = truncationHint(state.session);
    setText(healthHint, trunc || debuggerHealthHint(state.session));
  }

  if (canExport && state.session) {
    setText(
      exportStatus,
      state.session.tabClosedDuringCapture
        ? "Tab closed — partial capture ready"
        : "Capture ended",
    );
    showExportEntities(lastExportCounts);
    const trunc = truncationHint(state.session);
    const gaps = state.session.health?.partialGaps?.length ?? 0;
    if (!lastExportCounts) {
      setText(exportHint, trunc || (gaps ? `${gaps} capture gap(s) recorded` : "ZIP downloaded locally"));
    }
  } else {
    showExportEntities(undefined);
  }

  if (btnStart) btnStart.disabled = active || !(consentCheckbox?.checked ?? false);
}

async function downloadFromResponse(res: ExportZipResponse): Promise<void> {
  if (!res.ok) throw new Error(res.error ?? "Export failed");
  if (!res.zipBase64 || !res.filename) throw new Error("Export returned no file");
  const zip = base64ToUint8(res.zipBase64);
  await downloadZipFromPage(zip, res.filename);
}

btnStart?.addEventListener("click", async () => {
  btnStart.disabled = true;
  showStartError("");
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id == null) throw new Error("No active tab — open a regular web page first");
    const res = await sendMessageWithTimeout<{ ok?: boolean; error?: string }>(
      {
        type: MessageType.CONSENT_AND_START,
        tabId: tab.id,
        options: {
          captureBodies: bodyCaptureCheckbox?.checked ?? false,
          captureConsole: true,
        },
      },
      30_000,
    );
    if (!res?.ok) throw new Error(res.error ?? "Could not start capture");
    await refresh();
  } catch (err) {
    showStartError(err instanceof Error ? err.message : "Could not start capture");
    await refresh();
  }
});

consentCheckbox?.addEventListener("change", () => {
  if (btnStart) btnStart.disabled = !consentCheckbox.checked;
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
    applyExportResult(res);
    await refresh();
  } catch (err) {
    stopRequested = false;
    if (btnStop) btnStop.disabled = false;
    setText(healthHint, err instanceof Error ? err.message : "Export failed");
  }
}

btnStop?.addEventListener("click", () => void requestStopAndExport());

btnNewSession?.addEventListener("click", async () => {
  lastExportCounts = undefined;
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
    render({ ...EMPTY_STATE, session: null }, true);
    setText(healthHint, "Could not read session storage");
  }
}

redactionCheckbox?.addEventListener("change", async () => {
  const enabled = redactionCheckbox.checked;
  redactionCheckbox.disabled = true;
  showStartError("");
  try {
    const response = await sendMessageWithTimeout<{ ok?: boolean; error?: string }>(
      { type: MessageType.SET_REDACTION, redactionEnabled: enabled },
      30_000,
    );
    if (!response?.ok) throw new Error(response?.error ?? "Could not save redaction preference");
    await refresh();
  } catch (err) {
    redactionCheckbox.checked = !enabled;
    showStartError(err instanceof Error ? err.message : "Could not save redaction preference");
    redactionCheckbox.disabled = false;
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (
    changes.browserListenerPopupState ||
    changes.browserListenerSessionData ||
    changes.browserListenerActiveSessionId ||
    changes[REDACTION_PREFERENCE_KEY]
  ) {
    void refresh();
  }
});

const versionEl = el("app-version");
if (versionEl) versionEl.textContent = `v${chrome.runtime.getManifest().version}`;

void refresh();
setInterval(() => void refresh(), 2000);
