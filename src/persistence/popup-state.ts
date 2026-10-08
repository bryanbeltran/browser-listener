import { emptyTruncation } from "./limits.js";
import type { CaptureSession, PopupStateSnapshot, PopupCounts } from "../shared/types.js";
import type { PopupStateResponse } from "../shared/messages.js";

export const POPUP_STATE_KEY = "browserListenerPopupState";

export function emptyPopupStateSnapshot(): PopupStateSnapshot {
  return {
    session: null,
    counts: { network: 0, navigation: 0, console: 0 },
    canExport: false,
  };
}

export function buildPopupStateSnapshot(
  session: CaptureSession | null,
  counts: PopupCounts,
): PopupStateSnapshot {
  const active = Boolean(session?.active);
  const hasEvidence = counts.network + counts.navigation + counts.console > 0;
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
            debuggerEverAttached: session.health.debuggerEverAttached ?? false,
            partialGaps: session.health.partialGaps ?? [],
            truncation: session.health.truncation ?? emptyTruncation(),
            lastAttachError: session.health.lastAttachError,
          },
        }
      : null,
    counts,
    canExport: !active && hasEvidence,
  };
}

export function popupStateFromSnapshot(
  snapshot: PopupStateSnapshot,
  redactionEnabled = true,
): PopupStateResponse {
  return {
    session: snapshot.session,
    counts: {
      network: snapshot.counts?.network ?? 0,
      navigation: snapshot.counts?.navigation ?? 0,
      console: snapshot.counts?.console ?? 0,
    },
    canExport: snapshot.canExport,
    redactionEnabled,
  };
}
