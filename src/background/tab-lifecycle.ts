import { patchSession, recordHealthGap } from "../persistence/store.js";
import { detachDebugger } from "../capture/debugger-capture.js";
import { getActiveSession, recordNavigation, stopSession } from "../capture/session-manager.js";

/** Track only explicitly selected capture tabs. No broad host permission is needed. */
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
  if (!session) return;
  const target = session.targets?.find((candidate) => candidate.tabId === tabId);
  if (session.tabId !== tabId && !target) return;

  if (session.tabId !== tabId) {
    const at = Date.now();
    await patchSession((current) => {
      if (!current) return current;
      return {
        ...current,
        health: {
          ...current.health,
          partialGaps: [...current.health.partialGaps, { at, reason: `target_tab_closed:${tabId}` }],
        },
        ...(current.targets
          ? {
              targets: current.targets.map((candidate) =>
                candidate.tabId === tabId
                  ? {
                      ...candidate,
                      tabClosed: true,
                      debuggerAttached: false,
                      partialGaps: [
                        ...(candidate.partialGaps ?? []),
                        { at, reason: "tab_closed" },
                      ],
                    }
                  : candidate,
              ),
            }
          : {}),
      };
    });
    await detachDebugger(tabId);
    return;
  }

  await recordHealthGap("tab_closed");
  await patchSession((current) => {
    if (!current) return current;
    const at = Date.now();
    return {
      ...current,
      ...(current.targets
        ? {
            targets: current.targets.map((candidate) =>
              candidate.tabId === tabId
                ? {
                    ...candidate,
                    tabClosed: true,
                    debuggerAttached: false,
                    partialGaps: [
                      ...(candidate.partialGaps ?? []),
                      { at, reason: "tab_closed" },
                    ],
                  }
                : candidate,
            ),
          }
        : {}),
    };
  });
  await stopSession({ tabClosed: true });
  await detachDebugger();
}
