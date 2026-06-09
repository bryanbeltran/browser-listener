import type { SessionData, TraceSummary } from "../shared/types.js";

export function buildTraceSummary(data: SessionData): TraceSummary {
  const s = data.session;
  const stopped = s?.stoppedAt ?? Date.now();
  const started = s?.startedAt ?? stopped;
  return {
    sessionId: s?.id ?? "none",
    startedAt: started,
    stoppedAt: s?.stoppedAt,
    durationMs: Math.max(0, stopped - started),
    counts: {
      console: data.console.length,
      network: data.network.length,
      userActions: data.userActions.length,
      timeline: data.timeline.length,
      domSnapshots: data.domSnapshots.length,
    },
    health: s?.health ?? {
      debuggerAttached: false,
      debuggerDetachCount: 0,
      serviceWorkerRestarts: 0,
      partialGaps: [],
      persistenceErrors: [],
      eventCounts: {},
    },
  };
}
