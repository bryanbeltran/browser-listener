import { getActiveSession } from "../capture/session-manager.js";
import { markServiceWorkerRestart } from "../persistence/session-recovery.js";
import { syncPopupStateSnapshot } from "../persistence/store.js";

const SW_BOOT_KEY = "swBooted";

/**
 * Runs once per service-worker activation. Uses chrome.storage.session (cleared on SW
 * restart) to detect a real restart while a capture session is still active.
 */
export async function onServiceWorkerActivate(): Promise<void> {
  const booted = await chrome.storage.session.get(SW_BOOT_KEY);
  const active = await getActiveSession();
  if (!booted[SW_BOOT_KEY] && active?.active) {
    await markServiceWorkerRestart();
  }
  await chrome.storage.session.set({ [SW_BOOT_KEY]: true });
  await syncPopupStateSnapshot();
}
