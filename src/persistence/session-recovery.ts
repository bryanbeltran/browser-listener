import { getActiveSessionId, patchSession, readSessionMeta } from "./store.js";
import type { CaptureSession, CaptureTarget } from "../shared/types.js";

export async function markServiceWorkerRestart(): Promise<void> {
  await patchSession((session) => {
    if (!session?.active) return session;
    return {
      ...session,
      health: {
        ...session.health,
        serviceWorkerRestarts: session.health.serviceWorkerRestarts + 1,
        partialGaps: [
          ...session.health.partialGaps,
          { at: Date.now(), reason: "service_worker_restart" },
        ],
      },
    };
  });
}

export async function loadRecoverableSession(): Promise<{
  session: CaptureSession | null;
  shouldRecover: boolean;
}> {
  const id = await getActiveSessionId();
  const session = await readSessionMeta();
  if (!id || !session?.active || session.id !== id) {
    return { session: null, shouldRecover: false };
  }
  return { session, shouldRecover: true };
}

export async function updateDebuggerHealth(patch: {
  attached?: boolean;
  detached?: boolean;
  recovered?: boolean;
  /** Tab whose debugger state changed; omitted for legacy whole-session updates. */
  tabId?: number;
  /** Current in-memory attached tabs, used to derive aggregate health. */
  attachedTabIds?: readonly number[];
}): Promise<void> {
  await patchSession((session) => {
    if (!session) return session;
    const attached = new Set(patch.attachedTabIds ?? []);
    const hasAttachedSnapshot = patch.attachedTabIds != null;
    const targetChanged = (target: CaptureTarget): CaptureTarget => {
      if (patch.tabId == null && patch.detached && hasAttachedSnapshot) {
        return { ...target, debuggerAttached: attached.has(target.tabId) };
      }
      if (patch.tabId == null || target.tabId === patch.tabId) {
        if (patch.detached) {
          return { ...target, debuggerAttached: false };
        }
        if (patch.attached || patch.recovered) {
          return { ...target, debuggerAttached: true, debuggerEverAttached: true };
        }
      }
      if (hasAttachedSnapshot) {
        return { ...target, debuggerAttached: attached.has(target.tabId) };
      }
      return target;
    };

    let next = session;
    if (patch.detached) {
      const debuggerAttached = hasAttachedSnapshot
        ? attached.size > 0
        : patch.tabId == null
          ? false
          : session.health.debuggerAttached;
      next = {
        ...next,
        health: {
          ...next.health,
          debuggerAttached,
          debuggerDetachCount: next.health.debuggerDetachCount + 1,
          lastDetachAt: Date.now(),
          partialGaps: [
            ...next.health.partialGaps,
            { at: Date.now(), reason: "debugger_detached" },
          ],
        },
        ...(next.targets ? { targets: next.targets.map(targetChanged) } : {}),
      };
    }
    if (patch.attached) {
      next = {
        ...next,
        health: {
          ...next.health,
          debuggerAttached: hasAttachedSnapshot ? attached.size > 0 : true,
          debuggerEverAttached: true,
          lastAttachError: undefined,
        },
        ...(next.targets ? { targets: next.targets.map(targetChanged) } : {}),
      };
    }
    if (patch.recovered) {
      next = {
        ...next,
        health: {
          ...next.health,
          lastRecoverAt: Date.now(),
          debuggerAttached: hasAttachedSnapshot ? attached.size > 0 : true,
          debuggerEverAttached: true,
          lastAttachError: undefined,
        },
        ...(next.targets ? { targets: next.targets.map(targetChanged) } : {}),
      };
    }
    return next;
  });
}
