import { detachDebugger } from "../capture/debugger-capture.js";
import { getActiveSession, stopSession } from "../capture/session-manager.js";
import { recordHealthGap } from "../persistence/store.js";
import { broadcastCaptureState } from "./broadcast.js";

/**
 * When the captured tab closes mid-session: detach debugger, stop capture,
 * keep persisted data so the user can export a partial ZIP from the popup.
 */
export function registerTabLifecycle(): void {
  chrome.tabs.onRemoved.addListener((tabId) => {
    void handleTabClosed(tabId);
  });
}

export async function handleTabClosed(tabId: number): Promise<void> {
  const session = await getActiveSession();
  if (!session || session.tabId !== tabId) return;

  await detachDebugger();
  await recordHealthGap("tab_closed");
  await stopSession({ tabClosed: true });
  await broadcastCaptureState(false, null, false);
}
