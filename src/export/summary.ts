import type { SessionData, SessionHealth, SessionSummary } from "../shared/types.js";
import { emptyTruncation } from "../persistence/limits.js";
import { getExtensionVersion } from "../shared/extension-version.js";

function emptyHealth(): SessionHealth {
  return {
    debuggerAttached: false,
    debuggerEverAttached: false,
    debuggerDetachCount: 0,
    serviceWorkerRestarts: 0,
    partialGaps: [],
    persistenceErrors: [],
    truncation: emptyTruncation(),
  };
}

export function buildSessionSummary(data: SessionData): SessionSummary {
  const started = data.session?.startedAt ?? Date.now();
  const stopped = data.session?.stoppedAt;
  return {
    sessionId: data.session?.id ?? "none",
    extensionVersion: data.session?.extensionVersion ?? getExtensionVersion(),
    startedAt: started,
    stoppedAt: stopped,
    durationMs: (stopped ?? Date.now()) - started,
    counts: {
      network: data.network.length,
      navigation: data.navigation.length,
      console: data.console.length,
      markers: data.markers?.length ?? 0,
      requestBodies: data.network.filter((entry) => entry.requestBody != null).length,
      responseBodies: data.network.filter((entry) => entry.responseBody != null).length,
    },
    health: data.session?.health ?? emptyHealth(),
  };
}
