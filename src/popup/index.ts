import { MessageType } from "../shared/messages.js";
import type { ExportEntityCounts, ExportZipResponse } from "../shared/messages.js";
import { base64ToUint8 } from "../shared/bytes.js";
import { downloadZipFromPage } from "../export/download.js";
import { hasTruncation } from "../persistence/limits.js";
import { REDACTION_PREFERENCE_KEY } from "../persistence/preferences.js";
import { REDACTION_CONFIG_KEY } from "../persistence/preferences.js";
import type { PopupStateResponse } from "../shared/messages.js";
import {
  DEFAULT_CAPTURE_FIELDS,
  normalizeCaptureFields,
} from "../shared/types.js";
import type { CaptureField, CaptureFieldPolicy, CaptureProfile, RedactionConfig } from "../shared/types.js";
import { isCaptureableUrl } from "../shared/urls.js";
import { readPopupState } from "./popup-state.js";
import { sendMessageWithTimeout } from "./messaging.js";

const EMPTY_STATE: PopupStateResponse = {
  session: null,
  counts: { network: 0, navigation: 0, console: 0, markers: 0 },
  canExport: false,
  redactionEnabled: true,
  history: [],
  retentionPolicy: { schemaVersion: 1, maxAgeMs: 30 * 24 * 60 * 60 * 1000, maxSessions: 10, maxBytes: 512 * 1024 * 1024 },
  deletionReceipts: [],
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
const targetTabsField = el<HTMLFieldSetElement>("target-tabs");
const targetTabsList = el("target-tabs-list");
const captureProfileSelect = el<HTMLSelectElement>("capture-profile");
const sessionNameInput = el<HTMLInputElement>("session-name");
const scopeOriginsInput = el<HTMLInputElement>("scope-origins");
const filterUrlIncludesInput = el<HTMLInputElement>("filter-url-includes");
const filterUrlExcludesInput = el<HTMLInputElement>("filter-url-excludes");
const filterMimeTypesInput = el<HTMLInputElement>("filter-mime-types");
const frameIdsInput = el<HTMLInputElement>("frame-ids");
const captureDurationInput = el<HTMLInputElement>("capture-duration");
const effectivePolicySummary = el("effective-policy-summary");
const activeTargetTabsList = el("active-target-tabs-list");
const activeScopeOriginsInput = el<HTMLInputElement>("active-scope-origins");
const activeFrameIdsInput = el<HTMLInputElement>("active-frame-ids");
const activeCaptureDurationInput = el<HTMLInputElement>("active-capture-duration");
const btnUpdatePolicy = el<HTMLButtonElement>("btn-update-policy");
const policyStatus = el("policy-status");
const redactionCheckbox = el<HTMLInputElement>("redaction-checkbox");
const redactionWarning = el("redaction-warning");
const redactionKeyList = el<HTMLTextAreaElement>("redaction-key-list");
const redactionUrlKeyList = el<HTMLTextAreaElement>("redaction-url-key-list");
const redactionObjectKeyList = el<HTMLTextAreaElement>("redaction-object-key-list");
const redactionRulesJson = el<HTMLTextAreaElement>("redaction-rules-json");
const redactionConfigStatus = el("redaction-config-status");
const btnSaveRedactionConfig = el<HTMLButtonElement>("btn-save-redaction-config");
const btnResetRedactionConfig = el<HTMLButtonElement>("btn-reset-redaction-config");
const btnPreviewRedaction = el<HTMLButtonElement>("btn-preview-redaction");
const redactionPreview = el("redaction-preview");
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
const btnScreenshot = el<HTMLButtonElement>("btn-screenshot");
const btnPause = el<HTMLButtonElement>("btn-pause");
const markerStatus = el("marker-status");
const screenshotStatus = el("screenshot-status");
const btnOneRequest = el<HTMLButtonElement>("btn-one-request");
const oneRequestStatus = el("one-request-status");
const historySummary = el("history-summary");
const historyList = el("history-list");
const btnClearHistory = el<HTMLButtonElement>("btn-clear-history");
const retentionDays = el<HTMLInputElement>("retention-days");
const retentionCount = el<HTMLInputElement>("retention-count");
const retentionMegabytes = el<HTMLInputElement>("retention-megabytes");
const btnSaveRetention = el<HTMLButtonElement>("btn-save-retention");
const retentionStatus = el("retention-status");

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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KiB`;
  return `${Math.round(bytes / (1024 * 1024))} MiB`;
}

function renderHistory(state: PopupStateResponse): void {
  if (!historyList) return;
  const history = state.history ?? [];
  if (retentionDays && document.activeElement !== retentionDays) {
    retentionDays.value = String(Math.max(1, Math.round(state.retentionPolicy.maxAgeMs / (24 * 60 * 60 * 1000))));
  }
  if (retentionCount && document.activeElement !== retentionCount) retentionCount.value = String(state.retentionPolicy.maxSessions);
  if (retentionMegabytes && document.activeElement !== retentionMegabytes) {
    retentionMegabytes.value = String(Math.max(1, Math.round(state.retentionPolicy.maxBytes / (1024 * 1024))));
  }
  setText(historySummary, history.length
    ? `${history.length} completed session(s) · retention up to ${state.retentionPolicy.maxSessions} · ${formatBytes(state.retentionPolicy.maxBytes)}`
    : "No completed sessions retained locally.");
  historyList.replaceChildren();
  if (!history.length) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = "History is empty.";
    historyList.append(empty);
  }
  for (const entry of history) {
    const item = document.createElement("div");
    item.className = "history-item";
    const title = document.createElement("strong");
    title.textContent = entry.name || `Session ${entry.id.slice(0, 8)}…`;
    const meta = document.createElement("span");
    meta.className = "history-meta";
    meta.textContent = `${new Date(entry.startedAt).toLocaleString()} · ${entry.counts.network} network · ${entry.counts.console} console · ${formatBytes(entry.bytes)}${entry.partial ? " · partial" : ""}`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "secondary";
    remove.textContent = "Delete session";
    remove.addEventListener("click", async () => {
      remove.disabled = true;
      setText(retentionStatus, "Deleting session…");
      try {
        const response = await sendMessageWithTimeout<{ ok?: boolean; error?: string }>(
          { type: MessageType.DELETE_SESSION, sessionId: entry.id },
          30_000,
        );
        if (!response?.ok) throw new Error(response?.error ?? "Deletion is incomplete; retry from history");
        setText(retentionStatus, "Session deleted");
        await refresh();
      } catch (err) {
        setText(retentionStatus, err instanceof Error ? err.message : "Could not delete session");
        remove.disabled = false;
      }
    });
    item.append(title, meta, remove);
    historyList.append(item);
  }
  if (btnClearHistory) btnClearHistory.disabled = history.length === 0;
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

function parseFilterList(value: string | undefined): string[] {
  return parseKeyList(value);
}

const CAPTURE_FIELD_KEYS: CaptureField[] = [
  "urls",
  "headers",
  "requestBodies",
  "responseBodies",
  "consoleArguments",
  "navigationTitles",
  "visualEvidence",
];

function fieldControlId(field: CaptureField, active = false): string {
  const prefix = active ? "active-field-" : "field-";
  return `${prefix}${field.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

function readFieldPolicy(active = false): CaptureFieldPolicy {
  return normalizeCaptureFields(Object.fromEntries(CAPTURE_FIELD_KEYS.map((field) => [
    field,
    el<HTMLInputElement>(fieldControlId(field, active))?.checked ?? DEFAULT_CAPTURE_FIELDS[field],
  ])));
}

function writeFieldPolicy(fields: CaptureFieldPolicy | undefined, active = false): void {
  const normalized = normalizeCaptureFields(fields);
  for (const field of CAPTURE_FIELD_KEYS) {
    const input = el<HTMLInputElement>(fieldControlId(field, active));
    if (input) input.checked = normalized[field];
  }
}

function parseFrameIdList(value: string | undefined): string[] {
  return parseKeyList(value);
}

function parseDurationMs(value: string | undefined): number | undefined {
  const minutes = Number(value);
  if (!value?.trim() || !Number.isFinite(minutes) || minutes <= 0) return undefined;
  return Math.floor(minutes * 60_000);
}

function formatDuration(expiresAt: number | undefined): string {
  if (expiresAt == null) return "no deadline";
  const remaining = Math.max(0, expiresAt - Date.now());
  return remaining === 0 ? "deadline reached" : `${Math.ceil(remaining / 60_000)} min remaining`;
}

function updateEffectivePolicySummary(): void {
  const fields = readFieldPolicy();
  const disabled = CAPTURE_FIELD_KEYS.filter((field) => !fields[field]);
  const tabs = selectedTargetTabIds();
  const frames = parseFrameIdList(frameIdsInput?.value);
  const duration = parseDurationMs(captureDurationInput?.value);
  setText(
    effectivePolicySummary,
    `Effective policy: ${tabs.length || 1} tab(s) · ${frames.length ? `${frames.length} frame ID(s)` : "all frames"} · ${duration ? `${Math.round(duration / 60_000)} min` : "no duration limit"} · ${disabled.length ? `excluded: ${disabled.join(", ")}` : "all text fields enabled"}. Visual evidence is ${fields.visualEvidence ? "opt-in enabled" : "disabled by default"}.`,
  );
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

function selectedTargetTabIds(): number[] {
  if (!targetTabsList) return [];
  return Array.from(targetTabsList.querySelectorAll<HTMLInputElement>("input[data-tab-id]"))
    .filter((control) => control.checked)
    .map((control) => Number(control.dataset.tabId))
    .filter((tabId) => Number.isInteger(tabId) && tabId >= 0);
}

function renderTargetTabs(tabs: chrome.tabs.Tab[]): void {
  if (!targetTabsList) return;
  const previous = new Set(selectedTargetTabIds());
  const hasPrevious = previous.size > 0;
  targetTabsList.replaceChildren();
  const usableTabs = tabs.filter((tab) => tab.id != null);
  if (usableTabs.length === 0) {
    setText(targetTabsList, "No browser tabs are available.");
    return;
  }
  for (const tab of usableTabs) {
    const tabId = tab.id as number;
    const captureable = isCaptureableUrl(tab.url);
    const option = document.createElement("label");
    option.className = "target-tab-option";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.dataset.tabId = String(tabId);
    input.checked = hasPrevious ? previous.has(tabId) : Boolean(tab.active && captureable);
    input.disabled = !captureable || Boolean(tab.active);
    input.setAttribute("aria-label", tab.title || tab.url || `Tab ${tabId}`);
    const text = document.createElement("span");
    text.className = "target-tab-label";
    text.textContent = tab.title || tab.url || `Tab ${tabId}`;
    const url = document.createElement("span");
    url.className = "target-tab-url";
    url.textContent = captureable ? tab.url ?? "" : "Not an HTTP(S) page";
    text.append(url);
    option.append(input, text);
    targetTabsList.append(option);
  }
}

function selectedActiveTargetTabIds(): number[] {
  if (!activeTargetTabsList) return [];
  return Array.from(activeTargetTabsList.querySelectorAll<HTMLInputElement>("input[data-tab-id]"))
    .filter((control) => control.checked)
    .map((control) => Number(control.dataset.tabId))
    .filter((tabId) => Number.isInteger(tabId) && tabId >= 0);
}

function renderActiveTargetTabs(tabs: chrome.tabs.Tab[], state: PopupStateResponse["session"]): void {
  if (!activeTargetTabsList) return;
  const current = new Set(state?.targetTabIds ?? []);
  if (state?.targetTabIds == null && state) {
    for (const tab of tabs) {
      if (tab.id != null && tab.active) current.add(tab.id);
    }
  }
  activeTargetTabsList.replaceChildren();
  for (const tab of tabs.filter((candidate) => candidate.id != null)) {
    const tabId = tab.id as number;
    const option = document.createElement("label");
    option.className = "target-tab-option";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.dataset.tabId = String(tabId);
    input.checked = current.has(tabId) || tabId === state?.primaryTabId;
    input.disabled = !isCaptureableUrl(tab.url) || tabId === state?.primaryTabId;
    input.setAttribute("aria-label", tab.title || tab.url || `Tab ${tabId}`);
    const text = document.createElement("span");
    text.className = "target-tab-label";
    text.textContent = tab.title || tab.url || `Tab ${tabId}`;
    const url = document.createElement("span");
    url.className = "target-tab-url";
    url.textContent = isCaptureableUrl(tab.url) ? tab.url ?? "" : "Not an HTTP(S) page";
    text.append(url);
    option.append(input, text);
    activeTargetTabsList.append(option);
  }
}

function policyControlFocused(): boolean {
  const active = document.activeElement;
  return active === activeScopeOriginsInput || active === activeFrameIdsInput || active === activeCaptureDurationInput || Boolean(
    active && active instanceof HTMLInputElement && active.id.startsWith("active-field-"),
  );
}

function renderActivePolicy(session: PopupStateResponse["session"]): void {
  if (!session || policyControlFocused()) return;
  if (activeScopeOriginsInput) activeScopeOriginsInput.value = session.allowedOrigins?.join(", ") ?? "";
  if (activeFrameIdsInput) activeFrameIdsInput.value = session.frameIds?.join(", ") ?? "";
  if (activeCaptureDurationInput) {
    activeCaptureDurationInput.value = session.durationMs == null ? "" : String(Math.max(1, Math.round(session.durationMs / 60_000)));
  }
  writeFieldPolicy(session.fields, true);
}

async function loadTargetTabs(): Promise<void> {
  try {
    renderTargetTabs(await chrome.tabs.query({ currentWindow: true }));
  } catch {
    setText(targetTabsList, "Could not list browser tabs.");
  }
}

async function loadActiveTargetTabs(state: PopupStateResponse["session"]): Promise<void> {
  if (!activeTargetTabsList) return;
  try {
    renderActiveTargetTabs(await chrome.tabs.query({ currentWindow: true }), state);
  } catch {
    setText(activeTargetTabsList, "Could not list browser tabs.");
  }
}

function render(state: Awaited<ReturnType<typeof readPopupState>>, loaded = true): void {
  const active = state.session?.active ?? false;
  const paused = active && state.session?.paused === true;
  const canExport = state.canExport;

  renderHistory(state);

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
  if (state.session && !active) {
    if (frameIdsInput && document.activeElement !== frameIdsInput) frameIdsInput.value = state.session.frameIds?.join(", ") ?? frameIdsInput.value;
    if (captureDurationInput && document.activeElement !== captureDurationInput) {
      captureDurationInput.value = state.session.durationMs == null ? captureDurationInput.value : String(Math.max(1, Math.round(state.session.durationMs / 60_000)));
    }
    writeFieldPolicy(state.session.fields);
  }
  renderActivePolicy(state.session);
  updateEffectivePolicySummary();
  redactionWarning?.classList.toggle("hidden", state.redactionEnabled);
  renderRedactionConfig(state.redactionConfig, active || canExport);

  if (active && state.session) {
    setText(statusEl, paused ? "Capture paused" : `Session ${state.session.id.slice(0, 8)}…`);
    statusEl?.classList.toggle("paused", paused);
    const trunc = truncationHint(state.session);
    setText(
      healthHint,
      paused
        ? "Paused — network, console, and navigation capture are suspended"
        : trunc || `${debuggerHealthHint(state.session)} · epoch ${state.session.policyEpochCount ?? 1} · ${formatDuration(state.session.expiresAt)}`,
    );
  }

  if (!active) statusEl?.classList.remove("paused");
  if (btnPause) {
    btnPause.textContent = paused ? "Resume capture" : "Pause capture";
    btnPause.disabled = !active || stopRequested || pauseRequested;
    btnPause.setAttribute("aria-pressed", String(paused));
  }
  if (btnMarker) btnMarker.disabled = !active || paused || stopRequested;
  if (btnScreenshot) btnScreenshot.disabled = !active || paused || stopRequested;
  if (btnOneRequest) btnOneRequest.disabled = !active || paused || stopRequested;
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
  if (targetTabsField) {
    targetTabsField.disabled = active || canExport;
  }
  for (const control of [captureProfileSelect, sessionNameInput, scopeOriginsInput, filterUrlIncludesInput, filterUrlExcludesInput, filterMimeTypesInput, frameIdsInput, captureDurationInput]) {
    if (control) control.disabled = active || canExport;
  }
  for (const field of CAPTURE_FIELD_KEYS) {
    const input = el<HTMLInputElement>(fieldControlId(field));
    if (input) input.disabled = active || canExport;
  }
  if (btnUpdatePolicy) btnUpdatePolicy.disabled = !active || stopRequested;
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
          profile: (captureProfileSelect?.value || "network-console") as CaptureProfile,
          sessionName: sessionNameInput?.value.trim() || undefined,
          allowedOrigins: parseOriginList(scopeOriginsInput?.value),
          filters: {
            urlIncludes: parseFilterList(filterUrlIncludesInput?.value),
            urlExcludes: parseFilterList(filterUrlExcludesInput?.value),
            mimeTypes: parseFilterList(filterMimeTypesInput?.value),
          },
          fields: readFieldPolicy(),
          frameIds: parseFrameIdList(frameIdsInput?.value),
          ...(parseDurationMs(captureDurationInput?.value) == null ? {} : { durationMs: parseDurationMs(captureDurationInput?.value) }),
          targetTabIds: [...new Set([tab.id, ...selectedTargetTabIds()])],
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
  updateEffectivePolicySummary();
});

for (const field of CAPTURE_FIELD_KEYS) {
  el<HTMLInputElement>(fieldControlId(field))?.addEventListener("change", updateEffectivePolicySummary);
}
for (const input of [frameIdsInput, captureDurationInput]) {
  input?.addEventListener("input", updateEffectivePolicySummary);
}
targetTabsList?.addEventListener("change", updateEffectivePolicySummary);

btnUpdatePolicy?.addEventListener("click", async () => {
  if (btnUpdatePolicy.disabled) return;
  btnUpdatePolicy.disabled = true;
  setText(policyStatus, "Saving a new policy epoch…");
  try {
    const response = await sendMessageWithTimeout<{ ok?: boolean; error?: string }>(
      {
        type: MessageType.UPDATE_CAPTURE_POLICY,
        policy: {
          allowedOrigins: parseOriginList(activeScopeOriginsInput?.value) ?? null,
          fields: readFieldPolicy(true),
          frameIds: parseFrameIdList(activeFrameIdsInput?.value),
          targetTabIds: selectedActiveTargetTabIds(),
          durationMs: parseDurationMs(activeCaptureDurationInput?.value) ?? null,
        },
      },
      30_000,
    );
    if (!response?.ok) throw new Error(response?.error ?? "Could not update capture policy");
    setText(policyStatus, "Policy updated; earlier evidence retains its original epoch.");
    await refresh();
  } catch (err) {
    setText(policyStatus, err instanceof Error ? err.message : "Could not update capture policy");
  } finally {
    if (btnUpdatePolicy) btnUpdatePolicy.disabled = false;
    await refresh();
  }
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

btnScreenshot?.addEventListener("click", async () => {
  if (btnScreenshot.disabled) return;
  btnScreenshot.disabled = true;
  setText(screenshotStatus, "Capturing screenshot…");
  try {
    const response = await sendMessageWithTimeout<{ ok?: boolean; error?: string; state?: string }>(
      { type: MessageType.CAPTURE_SCREENSHOT },
      30_000,
    );
    if (!response?.ok) throw new Error(response?.error ?? "Screenshot capture was unavailable");
    setText(screenshotStatus, "Screenshot saved to the local evidence bundle");
  } catch (err) {
    setText(screenshotStatus, err instanceof Error ? err.message : "Screenshot capture was unavailable");
  } finally {
    await refresh();
  }
});

btnOneRequest?.addEventListener("click", async () => {
  if (btnOneRequest.disabled) return;
  btnOneRequest.disabled = true;
  setText(oneRequestStatus, "Arming one-request body capture…");
  try {
    const response = await sendMessageWithTimeout<{ ok?: boolean; error?: string }>(
      { type: MessageType.ARM_ONE_REQUEST },
      30_000,
    );
    if (!response?.ok) throw new Error(response?.error ?? "Could not arm one-request capture");
    setText(oneRequestStatus, "Armed — the next matching request gets one safe, bounded body capture");
  } catch (err) {
    setText(oneRequestStatus, err instanceof Error ? err.message : "Could not arm one-request capture");
  } finally {
    await refresh();
  }
});

btnNewSession?.addEventListener("click", async () => {
  lastExportCounts = undefined;
  await sendMessageWithTimeout({ type: MessageType.PREPARE_NEW_CAPTURE }, 30_000);
  await refresh();
});

btnClearHistory?.addEventListener("click", async () => {
  if (btnClearHistory.disabled) return;
  btnClearHistory.disabled = true;
  setText(retentionStatus, "Deleting local history…");
  try {
    const response = await sendMessageWithTimeout<{ ok?: boolean; error?: string }>(
      { type: MessageType.CLEAR_HISTORY },
      60_000,
    );
    if (!response?.ok) throw new Error(response?.error ?? "Deletion is incomplete; retry from history");
    setText(retentionStatus, "Local history deleted");
    await refresh();
  } catch (err) {
    setText(retentionStatus, err instanceof Error ? err.message : "Could not delete local history");
    btnClearHistory.disabled = false;
  }
});

btnSaveRetention?.addEventListener("click", async () => {
  const days = Number(retentionDays?.value);
  const count = Number(retentionCount?.value);
  const megabytes = Number(retentionMegabytes?.value);
  if (!Number.isFinite(days) || days < 1 || !Number.isFinite(count) || count < 1 || !Number.isFinite(megabytes) || megabytes < 1) {
    setText(retentionStatus, "Retention values must be positive numbers");
    return;
  }
  btnSaveRetention.disabled = true;
  setText(retentionStatus, "Saving retention policy…");
  try {
    const response = await sendMessageWithTimeout<{ ok?: boolean; error?: string }>(
      {
        type: MessageType.SET_RETENTION,
        policy: {
          maxAgeMs: Math.floor(days * 24 * 60 * 60 * 1000),
          maxSessions: Math.floor(count),
          maxBytes: Math.floor(megabytes * 1024 * 1024),
        },
      },
      30_000,
    );
    if (!response?.ok) throw new Error(response?.error ?? "Could not save retention policy");
    setText(retentionStatus, "Retention policy saved");
    await refresh();
  } catch (err) {
    setText(retentionStatus, err instanceof Error ? err.message : "Could not save retention policy");
  } finally {
    btnSaveRetention.disabled = false;
  }
});

btnPreviewRedaction?.addEventListener("click", async () => {
  if (btnPreviewRedaction) btnPreviewRedaction.disabled = true;
  setText(redactionConfigStatus, "Generating synthetic preview…");
  try {
    const response = await sendMessageWithTimeout<{ ok?: boolean; error?: string; preview?: { note: string; ruleSetVersion: string; examples: unknown[] } }>(
      { type: MessageType.GET_REDACTION_PREVIEW },
      30_000,
    );
    if (!response?.ok || !response.preview) throw new Error(response?.error ?? "Could not generate preview");
    if (redactionPreview) {
      redactionPreview.textContent = JSON.stringify(response.preview, null, 2);
      redactionPreview.classList.remove("hidden");
    }
    setText(redactionConfigStatus, `Preview uses synthetic data · ${response.preview.ruleSetVersion}`);
  } catch (err) {
    setText(redactionConfigStatus, err instanceof Error ? err.message : "Could not generate preview");
  } finally {
    if (btnPreviewRedaction) btnPreviewRedaction.disabled = false;
  }
});

async function refresh(): Promise<void> {
  try {
    const state = await readPopupState();
    captureActive = state.session?.active ?? false;
    if (!captureActive) stopRequested = false;
    render(state, true);
    if (captureActive) await loadActiveTargetTabs(state.session);
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
    changes.browserListenerSessionHistory ||
    changes.browserListenerRetentionPolicy ||
    changes.browserListenerDeletionReceipts ||
    changes[REDACTION_PREFERENCE_KEY]
    || changes[REDACTION_CONFIG_KEY]
  ) {
    void refresh();
  }
});

const versionEl = el("app-version");
if (versionEl) versionEl.textContent = `v${chrome.runtime.getManifest().version}`;

void refresh();
void loadTargetTabs();
setInterval(() => void refresh(), 2000);
