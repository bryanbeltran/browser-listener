import { readPopupStateForUi } from "../persistence/store.js";
import {
  buildPopupStateSnapshot,
  popupStateFromSnapshot,
} from "../persistence/popup-state.js";
import type { PopupStateResponse } from "../shared/messages.js";
import type { SessionData } from "../shared/types.js";

export function popupStateFromSessionData(data: SessionData): PopupStateResponse {
  return {
    ...popupStateFromSnapshot(
      buildPopupStateSnapshot(data.session, {
        network: data.network.length,
        navigation: data.navigation.length,
        console: data.console.length,
        markers: data.markers?.length ?? 0,
      }),
    ),
    redactionEnabled: data.session?.options?.redactionEnabled !== false,
  };
}

/** Read capture UI state; reconciles popup snapshot with session meta. */
export async function readPopupState(): Promise<PopupStateResponse> {
  return readPopupStateForUi();
}
