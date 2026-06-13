import { readPopupStateSnapshot } from "../persistence/store.js";
import {
  buildPopupStateSnapshot,
  popupStateFromSnapshot,
} from "../persistence/popup-state.js";
import type { PopupStateResponse } from "../shared/messages.js";
import type { SessionData } from "../shared/types.js";

export function popupStateFromSessionData(data: SessionData): PopupStateResponse {
  return popupStateFromSnapshot(
    buildPopupStateSnapshot(data.session, data.network.length),
  );
}

/** Read capture UI state from a lightweight storage key (no GraphQL bodies). */
export async function readPopupState(): Promise<PopupStateResponse> {
  return popupStateFromSnapshot(await readPopupStateSnapshot());
}
