import { appendScreenshot, recordHealthGap } from "../persistence/store.js";
import { getActiveSession } from "./session-manager.js";
import type { ScreenshotEvidence } from "../shared/types.js";
import { normalizeCaptureFields } from "../shared/types.js";

function decodedBase64Bytes(value: string): number {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((value.length * 3) / 4) - padding);
}

function selectedTarget(session: Awaited<ReturnType<typeof getActiveSession>>, tabId: number): boolean {
  return Boolean(session && (session.tabId === tabId || session.targets?.some((target) => target.tabId === tabId)));
}

/** Capture one explicit PNG screenshot for a selected, active target. */
export async function captureScreenshot(tabId?: number): Promise<ScreenshotEvidence | null> {
  const session = await getActiveSession();
  const targetTabId = tabId ?? session?.tabId;
  if (!session || targetTabId == null || session.paused || !selectedTarget(session, targetTabId)) return null;

  const timestamp = Date.now();
  const policyEpochId = session.policyEpochs?.at(-1)?.id;
  if (!normalizeCaptureFields(session.options.fields).visualEvidence) {
    const evidence: ScreenshotEvidence = {
      id: crypto.randomUUID(),
      sessionId: session.id,
      timestamp,
      tabId: targetTabId,
      format: "png",
      state: "excluded",
      reason: "field-disabled",
      policyEpochId,
    };
    await appendScreenshot(evidence);
    return evidence;
  }
  try {
    const result = await chrome.debugger.sendCommand(
      { tabId: targetTabId },
      "Page.captureScreenshot",
      { format: "png", fromSurface: true, captureBeyondViewport: false },
    ) as { data?: string };
    if (!result?.data) throw new Error("Page.captureScreenshot returned no image data");
    const evidence: ScreenshotEvidence = {
      id: crypto.randomUUID(),
      sessionId: session.id,
      timestamp,
      tabId: targetTabId,
      format: "png",
      state: "observed",
      data: result.data,
      byteLength: decodedBase64Bytes(result.data),
      policyEpochId,
    };
    await appendScreenshot(evidence);
    return evidence;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const evidence: ScreenshotEvidence = {
      id: crypto.randomUUID(),
      sessionId: session.id,
      timestamp,
      tabId: targetTabId,
      format: "png",
      state: "unavailable",
      reason,
      policyEpochId,
    };
    await appendScreenshot(evidence);
    await recordHealthGap(`screenshot_capture_failed: ${reason}`);
    return evidence;
  }
}
