import { getActiveSessionId, patchSession, readSessionMeta } from "./store.js";
import type { CaptureSession } from "../shared/types.js";

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
}): Promise<void> {
  await patchSession((session) => {
    if (!session) return session;
    const h = session.health;
    if (patch.detached) {
      session = {
        ...session,
        health: {
          ...h,
          debuggerAttached: false,
          debuggerDetachCount: h.debuggerDetachCount + 1,
          lastDetachAt: Date.now(),
          partialGaps: [
            ...h.partialGaps,
            { at: Date.now(), reason: "debugger_detached" },
          ],
        },
      };
    }
    if (patch.attached) {
      session = {
        ...session,
        health: { ...h, debuggerAttached: true, debuggerEverAttached: true, lastAttachError: undefined },
      };
    }
    if (patch.recovered) {
      session = {
        ...session,
        health: {
          ...session.health,
          lastRecoverAt: Date.now(),
          debuggerAttached: true,
          debuggerEverAttached: true,
          lastAttachError: undefined,
        },
      };
    }
    return session;
  });
}
