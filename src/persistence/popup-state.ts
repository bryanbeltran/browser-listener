import { emptyTruncation } from "./limits.js";
import type { PopupStateSnapshot, SessionData } from "../shared/types.js";
import type { PopupStateResponse } from "../shared/messages.js";

export const POPUP_STATE_KEY = "browserListenerPopupState";

export function emptyPopupStateSnapshot(): PopupStateSnapshot {
  return {
    session: null,
    counts: { network: 0 },
    canExport: false,
  };
}

export function buildPopupStateSnapshot(data: SessionData): PopupStateSnapshot {
  const session = data.session;
  const active = Boolean(session?.active);
  return {
    session: session
      ? {
          id: session.id,
          active,
          startedAt: session.startedAt,
          stoppedAt: session.stoppedAt,
          tabClosedDuringCapture: session.tabClosedDuringCapture,
          health: {
            debuggerAttached: session.health.debuggerAttached ?? false,
            partialGaps: session.health.partialGaps ?? [],
            truncation: session.health.truncation ?? emptyTruncation(),
          },
        }
      : null,
    counts: { network: data.network.length },
    canExport: !active && data.network.length > 0,
  };
}

export function popupStateFromSnapshot(snapshot: PopupStateSnapshot): PopupStateResponse {
  return {
    session: snapshot.session,
    counts: snapshot.counts,
    canExport: snapshot.canExport,
  };
}
