import { MessageType } from "../shared/messages.js";
import type { ExportEntityCounts, ExportZipResponse } from "../shared/messages.js";
import { base64ToUint8 } from "../shared/bytes.js";
import { downloadZipFromPage } from "../export/download.js";
import { hasTruncation } from "../persistence/limits.js";
import { REDACTION_PREFERENCE_KEY } from "../persistence/preferences.js";
import { REDACTION_CONFIG_KEY } from "../persistence/preferences.js";
import type { PopupStateResponse } from "../shared/messages.js";
import type { RedactionConfig } from "../shared/types.js";
import { readPopupState } from "./popup-state.js";
import { sendMessageWithTimeout } from "./messaging.js";

const EMPTY_STATE: PopupStateResponse = {
  session: null,
  counts: { network: 0, navigation: 0, console: 0, markers: 0 },
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
const scopeOriginsInput = el<HTMLInputElement>("scope-origins");
const redactionCheckbox = el<HTMLInputElement>("redaction-checkbox");
const redactionWarning = el("redaction-warning");
const redactionKeyList = el<HTMLTextAreaElement>("redaction-key-list");
const redactionUrlKeyList = el<HTMLTextAreaElement>("redaction-url-key-list");
const redactionObjectKeyList = el<HTMLTextAreaElement>("redaction-object-key-list");
const redactionRulesJson = el<HTMLTextAreaElement>("redaction-rules-json");
const redactionConfigStatus = el("redaction-config-status");
const btnSaveRedactionConfig = el<HTMLButtonElement>("btn-save-redaction-config");
const btnResetRedactionConfig = el<HTMLButtonElement>("btn-reset-redaction-config");
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
const cMarkers = el("c-markers");
const eNetwork = el("e-network");
const eNavigation = el("e-navigation");
const eConsole = el("e-console");
const eMarkers = el("e-markers");
const markerNote = el<HTMLInputElement>("marker-note");
const btnMarker = el<HTMLButtonElement>("btn-marker");
const btnPause = el<HTMLButtonElement>("btn-pause");
const markerStatus = el("marker-status");

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
  return `${counts.network} network · ${counts.navigation} navigation · ${counts.console} console · ${counts.markers ?? 0} markers`;
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

function listText(values: string[] | undefined): string {
  return (values ?? []).join(", ");
}

function parseKeyList(value: string | undefined): string[] {
  return (value ?? "")
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseOriginList(value: string | undefined): string[] | undefined {
  const origins = parseKeyList(value);
  return origins.length ? origins : undefined;
}

function activeRedactionConfigElement(): boolean {
  const active = document.activeElement;
  return active === redactionKeyList || active === redactionUrlKeyList || active === redactionObjectKeyList || active === redactionRulesJson || active === scopeOriginsInput;
}

function renderRedactionConfig(config: RedactionConfig | undefined, locked: boolean): void {
  if (!config) return;
  if (!activeRedactionConfigElement()) {
    if (redactionKeyList) redactionKeyList.value = listText(config.sensitiveKeys);
    if (redactionUrlKeyList) redactionUrlKeyList.value = listText(config.urlParamKeys);
    if (redactionObjectKeyList) redactionObjectKeyList.value = listText(config.objectSensitiveKeys);
    if (redactionRulesJson) redactionRulesJson.value = JSON.stringify(config.customRules, null, 2);
  }
  for (const control of [redactionKeyList, redactionUrlKeyList, redactionObjectKeyList, redactionRulesJson, btnSaveRedactionConfig, btnResetRedactionConfig]) {
    if (control) control.disabled = locked;
  }
}

function render(state: Awaited<ReturnType<typeof readPopupState>>, loaded = true): void {
  const active = state.session?.active ?? false;
  const paused = active && state.session?.paused === true;
  const canExport = state.canExport;

  loadingPanel?.classList.toggle("hidden", loaded);
  startPanel?.classList.toggle("hidden", !loaded || active || canExport);
  activePanel?.classList.toggle("hidden", !loaded || !active);
  exportPanel?.classList.toggle("hidden", !loaded || active || !canExport);

  setText(cNetwork, String(state.counts.network));
  setText(cNavigation, String(state.counts.navigation));
  setText(cConsole, String(state.counts.console));
  setText(cMarkers, String(state.counts.markers ?? 0));
  setText(eNetwork, String(state.counts.network));
  setText(eNavigation, String(state.counts.navigation));
  setText(eConsole, String(state.counts.console));
  setText(eMarkers, String(state.counts.markers ?? 0));
  if (redactionCheckbox) {
    redactionCheckbox.checked = state.redactionEnabled;
    redactionCheckbox.disabled = active || canExport;
  }
  if (scopeOriginsInput && !activeRedactionConfigElement()) {
    scopeOriginsInput.value = state.session?.allowedOrigins?.join(", ") ?? scopeOriginsInput.value;
  }
  redactionWarning?.classList.toggle("hidden", state.redactionEnabled);
  renderRedactionConfig(state.redactionConfig, active || canExport);

  if (active && state.session) {
    setText(statusEl, paused ? "Capture paused" : `Session ${state.session.id.slice(0, 8)}…`);
    statusEl?.classList.toggle("paused", paused);
    const trunc = truncationHint(state.session);
    setText(
      healthHint,
      paused ? "Paused — network, console, and navigation capture are suspended" : trunc || debuggerHealthHint(state.session),
    );
  }

  if (!active) statusEl?.classList.remove("paused");
  if (btnPause) {
    btnPause.textContent = paused ? "Resume capture" : "Pause capture";
    btnPause.disabled = !active || stopRequested || pauseRequested;
    btnPause.setAttribute("aria-pressed", String(paused));
  }
  if (btnMarker) btnMarker.disabled = !active || paused || stopRequested;
  if (btnStop) btnStop.disabled = !active || stopRequested;

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
          allowedOrigins: parseOriginList(scopeOriginsInput?.value),
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
let pauseRequested = false;

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

async function togglePause(): Promise<void> {
  if (pauseRequested || stopRequested) return;
  try {
    const state = await readPopupState();
    if (!state.session?.active) return;
    const shouldResume = state.session.paused === true;
    pauseRequested = true;
    if (btnPause) btnPause.disabled = true;
    setText(statusEl, shouldResume ? "Resuming…" : "Pausing…");
    const response = await sendMessageWithTimeout<{ ok?: boolean; error?: string }>(
      { type: shouldResume ? MessageType.RESUME_CAPTURE : MessageType.PAUSE_CAPTURE },
      30_000,
    );
    if (!response?.ok) throw new Error(response?.error ?? "Could not change capture state");
  } catch (err) {
    setText(healthHint, err instanceof Error ? err.message : "Could not change capture state");
  } finally {
    pauseRequested = false;
    await refresh();
  }
}

btnPause?.addEventListener("click", () => void togglePause());

btnMarker?.addEventListener("click", async () => {
  if (btnMarker.disabled) return;
  btnMarker.disabled = true;
  setText(markerStatus, "Saving marker…");
  try {
    const response = await sendMessageWithTimeout<{ ok?: boolean; error?: string }>(
      { type: MessageType.ADD_MARKER, note: markerNote?.value ?? "" },
      30_000,
    );
    if (!response?.ok) throw new Error(response?.error ?? "Could not save marker");
    if (markerNote) markerNote.value = "";
    setText(markerStatus, "Marker saved");
    await refresh();
  } catch (err) {
    setText(markerStatus, err instanceof Error ? err.message : "Could not save marker");
  } finally {
    await refresh();
  }
});

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

btnSaveRedactionConfig?.addEventListener("click", async () => {
  if (btnSaveRedactionConfig.disabled) return;
  try {
    const parsedRules = JSON.parse(redactionRulesJson?.value || "[]") as unknown;
    if (!Array.isArray(parsedRules) || parsedRules.some((rule) => !rule || typeof rule !== "object" || typeof (rule as { pattern?: unknown }).pattern !== "string")) {
      throw new Error("Custom rules must be a JSON array with string pattern fields");
    }
    btnSaveRedactionConfig.disabled = true;
    const response = await sendMessageWithTimeout<{ ok?: boolean; error?: string; redactionConfig?: RedactionConfig }>(
      {
        type: MessageType.SET_REDACTION_CONFIG,
        config: {
          sensitiveKeys: parseKeyList(redactionKeyList?.value),
          urlParamKeys: parseKeyList(redactionUrlKeyList?.value),
          objectSensitiveKeys: parseKeyList(redactionObjectKeyList?.value),
          customRules: parsedRules,
        },
      },
      30_000,
    );
    if (!response?.ok) throw new Error(response?.error ?? "Could not save redaction rules");
    setText(redactionConfigStatus, "Rules saved for future sessions");
    await refresh();
  } catch (err) {
    setText(redactionConfigStatus, err instanceof Error ? err.message : "Could not save redaction rules");
    if (btnSaveRedactionConfig) btnSaveRedactionConfig.disabled = false;
  }
});

btnResetRedactionConfig?.addEventListener("click", async () => {
  if (btnResetRedactionConfig.disabled) return;
  btnResetRedactionConfig.disabled = true;
  try {
    const response = await sendMessageWithTimeout<{ ok?: boolean; error?: string }>(
      { type: MessageType.RESET_REDACTION_CONFIG },
      30_000,
    );
    if (!response?.ok) throw new Error(response?.error ?? "Could not reset redaction rules");
    setText(redactionConfigStatus, "Default rules restored");
    await refresh();
  } catch (err) {
    setText(redactionConfigStatus, err instanceof Error ? err.message : "Could not reset redaction rules");
    if (btnResetRedactionConfig) btnResetRedactionConfig.disabled = false;
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (
    changes.browserListenerPopupState ||
    changes.browserListenerSessionData ||
    changes.browserListenerActiveSessionId ||
    changes[REDACTION_PREFERENCE_KEY]
    || changes[REDACTION_CONFIG_KEY]
  ) {
    void refresh();
  }
});

const versionEl = el("app-version");
if (versionEl) versionEl.textContent = `v${chrome.runtime.getManifest().version}`;

void refresh();
setInterval(() => void refresh(), 2000);
