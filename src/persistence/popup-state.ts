import { emptyTruncation } from "./limits.js";
import type { CaptureSession, PopupStateSnapshot } from "../shared/types.js";
import type { PopupStateResponse } from "../shared/messages.js";

export const POPUP_STATE_KEY = "browserListenerPopupState";

export function emptyPopupStateSnapshot(): PopupStateSnapshot {
  return {
    session: null,
    counts: { network: 0 },
    canExport: false,
  };
}

export function buildPopupStateSnapshot(
  session: CaptureSession | null,
  networkCount: number,
): PopupStateSnapshot {
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
    counts: { network: networkCount },
    canExport: !active && networkCount > 0,
  };
}

export function popupStateFromSnapshot(snapshot: PopupStateSnapshot): PopupStateResponse {
  return {
    session: snapshot.session,
    counts: snapshot.counts,
    canExport: snapshot.canExport,
  };
}
