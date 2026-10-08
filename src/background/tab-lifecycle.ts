import { recordHealthGap } from "../persistence/store.js";
import { detachDebugger } from "../capture/debugger-capture.js";
import { getActiveSession, recordNavigation, stopSession } from "../capture/session-manager.js";

/** Track only explicitly captured tab. No broad navigation permission needed. */
export function registerTabLifecycle(): void {
  chrome.tabs.onRemoved.addListener((tabId) => {
    void handleTabClosed(tabId);
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (!changeInfo.url) return;
    void recordNavigation(tabId, changeInfo.url, tab.title);
  });
}

export async function handleTabClosed(tabId: number): Promise<void> {
  const session = await getActiveSession();
  if (!session || session.tabId !== tabId) return;

  await recordHealthGap("tab_closed");
  await stopSession({ tabClosed: true });
  await detachDebugger();
}
