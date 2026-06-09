import { getActiveSessionId, readSessionData, withSession } from "./store.js";
import type { CaptureSession } from "../shared/types.js";

export async function markServiceWorkerRestart(): Promise<void> {
  await withSession((data) => {
    if (!data.session?.active) return data;
    data.session = {
      ...data.session,
      health: {
        ...data.session.health,
        serviceWorkerRestarts: data.session.health.serviceWorkerRestarts + 1,
        partialGaps: [
          ...data.session.health.partialGaps,
          { at: Date.now(), reason: "service_worker_restart" },
        ],
      },
    };
    return data;
  });
}

export async function loadRecoverableSession(): Promise<{
  session: CaptureSession | null;
  shouldRecover: boolean;
}> {
  const id = await getActiveSessionId();
  const data = await readSessionData();
  if (!id || !data.session?.active || data.session.id !== id) {
    return { session: null, shouldRecover: false };
  }
  return { session: data.session, shouldRecover: true };
}

export async function updateDebuggerHealth(patch: {
  attached?: boolean;
  detached?: boolean;
  recovered?: boolean;
}): Promise<void> {
  await withSession((data) => {
    if (!data.session) return data;
    const h = data.session.health;
    if (patch.detached) {
      data.session = {
        ...data.session,
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
      data.session = {
        ...data.session,
        health: { ...h, debuggerAttached: true },
      };
    }
    if (patch.recovered) {
      data.session = {
        ...data.session,
        health: { ...data.session.health, lastRecoverAt: Date.now(), debuggerAttached: true },
      };
    }
    return data;
  });
}
