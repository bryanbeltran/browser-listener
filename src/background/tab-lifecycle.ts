import { detachDebugger } from "../capture/debugger-capture.js";
import { getActiveSession, stopSession, updateSessionTabUrl } from "../capture/session-manager.js";
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

  chrome.webNavigation.onCommitted.addListener((details) => {
    if (details.frameId !== 0) return;
    void handleTabNavigated(details.tabId, details.url);
  });
}

async function handleTabNavigated(tabId: number, url: string): Promise<void> {
  const session = await getActiveSession();
  if (!session || session.tabId !== tabId) return;
  if (url.startsWith("chrome://") || url.startsWith("chrome-extension://")) return;
  await updateSessionTabUrl(url);
}

export async function handleTabClosed(tabId: number): Promise<void> {
  const session = await getActiveSession();
  if (!session || session.tabId !== tabId) return;

  await recordHealthGap("tab_closed");
  await stopSession({ tabClosed: true });
  await detachDebugger();
  await broadcastCaptureState(false, null, false);
}
