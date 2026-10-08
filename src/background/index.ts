import { MessageType } from "../shared/messages.js";
import {
  activateCaptureSession,
  armOneRequestCapture,
  createSession,
  getActiveSession,
  pauseCapture,
  recordNavigation,
  resumeCapture,
  stopSession,
  setCaptureExpirationHandler,
  rescheduleCaptureExpiration,
  updateCapturePolicy,
} from "../capture/session-manager.js";
import type { CapturePolicyUpdate } from "../capture/session-manager.js";
import {
  attachDebugger,
  detachDebugger,
  ensureDebuggerForSession,
  isDebuggerAttachedToTab,
  registerDebuggerCapture,
  scheduleDebuggerAttachRetry,
  setOnDebuggerCanceledByUser,
} from "../capture/debugger-capture.js";
import { stopAndExportInBackground, stopCaptureAndPrepareZip } from "../capture/stop-export.js";
import { uint8ToBase64 } from "../shared/bytes.js";
import {
  clearSessionData,
  appendMarker,
  clearSessionHistory,
  deleteSession,
  readDeletionReceiptsSnapshot,
  readSessionHistory,
  readSessionData,
  updateRetentionPolicy,
} from "../persistence/store.js";
import {
  readRedactionConfig,
  readRedactionPreference,
  loadRedactionConfig,
  resetRedactionConfigPreference,
  setRedactionConfigPreference,
  setRedactionPreference,
  readRetentionPolicy,
} from "../persistence/preferences.js";
import { loadRecoverableSession } from "../persistence/session-recovery.js";
import { onServiceWorkerActivate } from "./service-worker-lifecycle.js";
import { registerTabLifecycle } from "./tab-lifecycle.js";
import type { CaptureOptions, CaptureTarget, CaptureSession, MarkerEntry } from "../shared/types.js";
import { normalizeCaptureFields } from "../shared/types.js";
import { isCaptureableUrl } from "../shared/urls.js";
import { buildRedactionPreview } from "../redaction/preview.js";
import { captureBrowserContext, capturePerformanceSignal } from "../capture/context.js";
import { captureScreenshot } from "../capture/visual-evidence.js";

function nearestEventId(
  entries: Array<{ id: string; timestamp: number; tabId?: number }>,
  tabId: number,
  timestamp: number,
): string | undefined {
  return [...entries]
    .filter((entry) => entry.tabId == null || entry.tabId === tabId)
    .sort((left, right) =>
      Math.abs(left.timestamp - timestamp) - Math.abs(right.timestamp - timestamp) ||
      left.id.localeCompare(right.id),
    )[0]?.id;
}

async function startWithConsent(
  tabId: number,
  options: Partial<CaptureOptions> = {},
): Promise<void> {
  const requestedIds = options.targetTabIds ?? [tabId];
  if (!Array.isArray(requestedIds) || requestedIds.some((id) => !Number.isInteger(id) || id < 0)) {
    throw new Error("Selected capture tabs are invalid");
  }
  const selectedIds = [...new Set([tabId, ...requestedIds])];
  const selectedTabs = await Promise.all(
    selectedIds.map(async (selectedId) => {
      try {
        return await chrome.tabs.get(selectedId);
      } catch {
        throw new Error(`Selected tab ${selectedId} is unavailable`);
      }
    }),
  );
  for (const selectedTab of selectedTabs) {
    if (!isCaptureableUrl(selectedTab.url)) {
      throw new Error(`Selected tab ${selectedTab.id ?? "?"} is not a regular HTTP(S) page`);
    }
  }
  const primaryTab = selectedTabs.find((selectedTab) => selectedTab.id === tabId);
  if (!primaryTab || !isCaptureableUrl(primaryTab.url)) {
    throw new Error("Open a regular web page before starting capture");
  }
  const targets: CaptureTarget[] = selectedTabs.map((selectedTab) => ({
    tabId: selectedTab.id as number,
    url: selectedTab.url,
    title: selectedTab.title,
    partialGaps: [],
  }));
  const sessionOptions: Partial<CaptureOptions> = {
    ...options,
    targetTabIds: selectedIds,
  };
  await createSession(tabId, primaryTab.url, sessionOptions, targets);
  try {
    await attachDebugger(tabId);
    if (!isDebuggerAttachedToTab(tabId)) {
      throw new Error("Debugger attach did not complete");
    }
    for (const target of targets) {
      if (target.tabId === tabId) continue;
      try {
        await attachDebugger(target.tabId);
      } catch {
        // Secondary attach failure is retained as a target gap; primary capture continues.
      }
    }
    await activateCaptureSession();
    for (const target of targets) {
      await recordNavigation(target.tabId, target.url, target.title);
      await captureBrowserContext(target.tabId);
      await capturePerformanceSignal(target.tabId);
    }
  } catch (err) {
    await detachDebugger();
    await clearSessionData();
    throw err;
  }
}

async function updateActivePolicy(raw: Record<string, unknown>): Promise<CaptureSession | null> {
  const before = await getActiveSession();
  if (!before) return null;

  const targetTabs: CaptureTarget[] = [];
  let targetTabIds: number[] | undefined;
  if (Object.prototype.hasOwnProperty.call(raw, "targetTabIds")) {
    if (!Array.isArray(raw.targetTabIds) || raw.targetTabIds.some((id) => typeof id !== "number" || !Number.isInteger(id) || id < 0)) {
      throw new Error("Selected capture tabs are invalid");
    }
    targetTabIds = [...new Set([before.tabId, ...(raw.targetTabIds as number[])])];
    const tabs = await Promise.all(targetTabIds.map(async (tabId) => {
      try {
        return await chrome.tabs.get(tabId);
      } catch {
        throw new Error(`Selected tab ${tabId} is unavailable`);
      }
    }));
    for (const tab of tabs) {
      if (tab.id == null || !isCaptureableUrl(tab.url)) {
        throw new Error(`Selected tab ${tab.id ?? "?"} is not a regular HTTP(S) page`);
      }
      targetTabs.push({ tabId: tab.id, url: tab.url, title: tab.title, partialGaps: [] });
    }
  }

  const update: CapturePolicyUpdate = {
    ...(Object.prototype.hasOwnProperty.call(raw, "allowedOrigins")
      ? { allowedOrigins: raw.allowedOrigins == null ? null : raw.allowedOrigins as string[] }
      : {}),
    ...(raw.filters && typeof raw.filters === "object" ? { filters: raw.filters as CapturePolicyUpdate["filters"] } : {}),
    ...(raw.fields && typeof raw.fields === "object" ? { fields: raw.fields as CapturePolicyUpdate["fields"] } : {}),
    ...(Array.isArray(raw.frameIds) ? { frameIds: raw.frameIds } : {}),
    ...(targetTabIds ? { targetTabIds } : {}),
    ...(Object.prototype.hasOwnProperty.call(raw, "durationMs")
      ? { durationMs: raw.durationMs == null ? null : Number(raw.durationMs) }
      : {}),
  };
  const next = await updateCapturePolicy(update, targetTabs);
  if (!next) return null;

  if (targetTabIds) {
    const previousIds = new Set(before.targets?.map((target) => target.tabId) ?? [before.tabId]);
    const nextIds = new Set(targetTabIds);
    for (const tabId of previousIds) {
      if (!nextIds.has(tabId)) await detachDebugger(tabId);
    }
    for (const tabId of targetTabIds) {
      if (previousIds.has(tabId)) continue;
      try {
        await attachDebugger(tabId);
        const target = targetTabs.find((candidate) => candidate.tabId === tabId);
        await recordNavigation(tabId, target?.url, target?.title);
        await captureBrowserContext(tabId);
        await capturePerformanceSignal(tabId);
      } catch {
        // The target remains in the immutable policy with an explicit attach gap.
      }
    }
  }
  return (await getActiveSession()) ?? next;
}

registerDebuggerCapture();
setOnDebuggerCanceledByUser(() => void stopAndExportInBackground());
setCaptureExpirationHandler(() => stopAndExportInBackground());
registerTabLifecycle();

chrome.runtime.onInstalled.addListener(() => {
  void recoverSession();
});

async function recoverSession(): Promise<void> {
  const { shouldRecover, session } = await loadRecoverableSession();
  if (!shouldRecover || !session) return;
  await rescheduleCaptureExpiration();
  try {
    await ensureDebuggerForSession();
    if (!isDebuggerAttachedToTab(session.tabId)) {
      throw new Error("Debugger attach did not complete on recovery");
    }
  } catch {
    if (session.health.debuggerEverAttached) {
      scheduleDebuggerAttachRetry();
      return;
    }
    await stopSession();
  }
}

async function bootstrap(): Promise<void> {
  await onServiceWorkerActivate();
  await recoverSession();
}

void bootstrap();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const run = async (): Promise<unknown> => {
    switch (message?.type) {
      case MessageType.GET_STATE: {
        const data = await readSessionData();
        const redactionEnabled = await readRedactionPreference();
        const redactionConfig = await readRedactionConfig();
        const history = await readSessionHistory();
        const retentionPolicy = await readRetentionPolicy();
        const deletionReceipts = await readDeletionReceiptsSnapshot();
        const hasData =
          data.network.length > 0 ||
          data.navigation.length > 0 ||
          data.console.length > 0 ||
          (data.markers?.length ?? 0) > 0 ||
          (data.screenshots?.length ?? 0) > 0;
        return {
          session: data.session,
          counts: {
            network: data.network.length,
            navigation: data.navigation.length,
            console: data.console.length,
            markers: data.markers?.length ?? 0,
            screenshots: data.screenshots?.length ?? 0,
          },
          canExport: !data.session?.active && hasData,
          redactionEnabled,
          redactionConfig,
          history,
          retentionPolicy,
          deletionReceipts,
        };
      }
      case MessageType.SET_REDACTION: {
        if (await getActiveSession()) {
          return { ok: false, error: "Stop capture before changing redaction" };
        }
        const redactionEnabled = message.redactionEnabled !== false;
        await setRedactionPreference(redactionEnabled);
        return { ok: true, redactionEnabled };
      }
      case MessageType.SET_REDACTION_CONFIG: {
        if (await getActiveSession()) {
          return { ok: false, error: "Stop capture before changing redaction rules" };
        }
        const redactionConfig = await setRedactionConfigPreference(message.config ?? {});
        return { ok: true, redactionConfig };
      }
      case MessageType.RESET_REDACTION_CONFIG: {
        if (await getActiveSession()) {
          return { ok: false, error: "Stop capture before changing redaction rules" };
        }
        const redactionConfig = await resetRedactionConfigPreference();
        return { ok: true, redactionConfig };
      }
      case MessageType.GET_REDACTION_PREVIEW:
        await loadRedactionConfig();
        return { ok: true, preview: buildRedactionPreview() };
      case MessageType.PREPARE_NEW_CAPTURE:
        if (await getActiveSession()) return { ok: false, error: "Stop capture first" };
        await clearSessionData({ archive: true, preserveHistory: true });
        return { ok: true };
      case MessageType.SET_RETENTION: {
        const retentionPolicy = await updateRetentionPolicy(message.policy ?? {});
        return { ok: true, retentionPolicy };
      }
      case MessageType.DELETE_SESSION: {
        const sessionId = typeof message.sessionId === "string" ? message.sessionId : "";
        if (!sessionId) return { ok: false, error: "Session ID is required" };
        const receipt = await deleteSession(sessionId);
        return { ok: receipt.state === "complete", receipt };
      }
      case MessageType.CLEAR_HISTORY: {
        const receipts = await clearSessionHistory();
        return { ok: receipts.every((receipt) => receipt.state === "complete"), receipts };
      }
      case MessageType.ADD_MARKER: {
        const session = await getActiveSession();
        if (!session || session.paused) return { ok: false, error: "Resume capture before adding a marker" };
        await captureBrowserContext(session.tabId);
        await capturePerformanceSignal(session.tabId);
        const evidence = await readSessionData();
        const note = typeof message.note === "string" ? message.note.trim().slice(0, 500) : "";
        let url = session.tabUrl;
        try {
          const tab = await chrome.tabs.get(session.tabId);
          url = tab.url ?? url;
        } catch {
          // The session snapshot remains the source of truth when the tab is unavailable.
        }
        const marker: MarkerEntry = {
          id: crypto.randomUUID(),
          sessionId: session.id,
          timestamp: Date.now(),
          label: "User marker",
          note: note || undefined,
          ...(normalizeCaptureFields(session.options.fields).urls && url ? { url } : {}),
          tabId: session.tabId,
          policyEpochId: session.policyEpochs?.at(-1)?.id,
          nearestNetworkId: nearestEventId(evidence.network, session.tabId, Date.now()),
          nearestConsoleId: nearestEventId(evidence.console, session.tabId, Date.now()),
        };
        await appendMarker(marker);
        return { ok: true, markerId: marker.id };
      }
      case MessageType.CAPTURE_SCREENSHOT: {
        const session = await getActiveSession();
        if (!session || session.paused) return { ok: false, error: "Resume capture before taking a screenshot" };
        const screenshot = await captureScreenshot(session.tabId);
        if (!screenshot) return { ok: false, error: "Screenshot target is unavailable" };
        return {
          ok: screenshot.state === "observed",
          screenshotId: screenshot.id,
          state: screenshot.state,
          error: screenshot.reason,
        };
      }
      case MessageType.ARM_ONE_REQUEST: {
        const session = await armOneRequestCapture(
          typeof message.urlIncludes === "string" ? message.urlIncludes : undefined,
        );
        if (!session) return { ok: false, error: "Resume capture before arming one-request capture" };
        return { ok: true, armedAt: session.oneRequestCapture?.armedAt };
      }
      case MessageType.UPDATE_CAPTURE_POLICY: {
        const update = message.policy && typeof message.policy === "object" ? message.policy : {};
        const session = await updateActivePolicy(update as Record<string, unknown>);
        if (!session) return { ok: false, error: "No active capture session" };
        return { ok: true, session };
      }
      case MessageType.PAUSE_CAPTURE: {
        const session = await pauseCapture();
        if (!session) return { ok: false, error: "No active capture session" };
        return { ok: true, paused: session.paused ?? false };
      }
      case MessageType.RESUME_CAPTURE: {
        const session = await resumeCapture();
        if (!session) return { ok: false, error: "No active capture session" };
        return { ok: true, paused: session.paused ?? false };
      }
      case MessageType.CONSENT_AND_START: {
        const tabId = message.tabId as number | undefined;
        const opts = (message.options as Partial<CaptureOptions>) ?? {};
        const id =
          tabId ??
          (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
        if (id == null) return { ok: false, error: "No active tab" };
        await startWithConsent(id, opts);
        return { ok: true };
      }
      case MessageType.STOP_AND_EXPORT: {
        const bundle = await stopCaptureAndPrepareZip();
        if (!bundle) return { ok: false, error: "Nothing to export" };
        return {
          ok: true,
          zipBase64: uint8ToBase64(bundle.zip),
          filename: bundle.filename,
          counts: bundle.counts,
        };
      }
      case MessageType.DISCARD_CAPTURE:
        if (await getActiveSession()) {
          return { ok: false, error: "Stop capture first" };
        }
        await clearSessionData();
        return { ok: true };
      default:
        return { ok: false };
    }
  };
  run()
    .then(sendResponse)
    .catch((err: Error) => sendResponse({ ok: false, error: err.message }));
  return true;
});
