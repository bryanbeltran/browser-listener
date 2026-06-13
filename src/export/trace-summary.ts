import type { SessionData, TraceSummary } from "../shared/types.js";

export function buildTraceSummary(data: SessionData): TraceSummary {
  const fb = data.enrichments?.facebookGroups;
  const started = data.session?.startedAt ?? Date.now();
  const stopped = data.session?.stoppedAt;
  return {
    sessionId: data.session?.id ?? "none",
    startedAt: started,
    stoppedAt: stopped,
    durationMs: (stopped ?? Date.now()) - started,
    counts: {
      network: data.network.length,
      posts: fb?.posts.length ?? 0,
      comments: fb?.comments.length ?? 0,
      reactions: fb?.reactions.length ?? 0,
    },
    health: data.session?.health ?? {
      debuggerAttached: false,
      debuggerDetachCount: 0,
      serviceWorkerRestarts: 0,
      partialGaps: [],
      persistenceErrors: [],
      truncation: { network: 0 },
    },
  };
}
