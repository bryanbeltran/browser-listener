import { readSessionData } from "../persistence/store.js";
import type { PopupStateResponse } from "../shared/messages.js";
import type { SessionData } from "../shared/types.js";

export function popupStateFromSessionData(data: SessionData): PopupStateResponse {
  const hasData =
    data.console.length > 0 ||
    data.network.length > 0 ||
    data.timeline.length > 0;
  return {
    session: data.session,
    counts: {
      console: data.console.length,
      network: data.network.length,
      timeline: data.timeline.length,
    },
    canExport: !data.session?.active && hasData,
  };
}

/** Read capture UI state from storage (no service worker round-trip). */
export async function readPopupState(): Promise<PopupStateResponse> {
  return popupStateFromSessionData(await readSessionData());
}
