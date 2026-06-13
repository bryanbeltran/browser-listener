import { readSessionData } from "../persistence/store.js";
import type { PopupStateResponse } from "../shared/messages.js";
import type { SessionData } from "../shared/types.js";

export function popupStateFromSessionData(data: SessionData): PopupStateResponse {
  return {
    session: data.session,
    counts: { network: data.network.length },
    canExport: !data.session?.active && data.network.length > 0,
  };
}

/** Read capture UI state from storage (no service worker round-trip). */
export async function readPopupState(): Promise<PopupStateResponse> {
  return popupStateFromSessionData(await readSessionData());
}
