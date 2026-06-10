import type { SessionData } from "../../src/shared/types.js";
import { DEFAULT_CAPTURE_OPTIONS } from "../../src/shared/types.js";

/** Synthetic session for export/E2E tests — no secrets. */
export function sampleExportSessionData(): SessionData {
  const sessionId = "sample-session-export";
  return {
    session: {
      id: sessionId,
      active: false,
      consentedAt: 1_700_000_000_000,
      startedAt: 1_700_000_000_000,
      stoppedAt: 1_700_000_060_000,
      tabId: 1,
      tabUrl: "https://example.com/app",
      options: { ...DEFAULT_CAPTURE_OPTIONS, enricherIds: [] },
      health: {
        debuggerAttached: true,
        debuggerDetachCount: 0,
        serviceWorkerRestarts: 0,
        partialGaps: [],
        persistenceErrors: [],
        eventCounts: { console: 1, network: 1 },
        truncation: { console: 0, network: 0, timeline: 0, userActions: 0 },
      },
    },
    timeline: [
      {
        id: "t1",
        sessionId,
        timestamp: 1_700_000_010_000,
        category: "system",
        type: "session_stop",
        summary: "Capture stopped",
      },
    ],
    console: [
      {
        id: "c1",
        sessionId,
        timestamp: 1_700_000_005_000,
        level: "log",
        args: ["app ready"],
        url: "https://example.com/app",
      },
    ],
    network: [
      {
        id: "n1",
        sessionId,
        requestId: "req-1",
        timestamp: 1_700_000_002_000,
        url: "https://api.example.com/health",
        method: "GET",
        type: "xhr",
        statusCode: 200,
      },
    ],
    userActions: [],
    diagnostics: [],
    domSnapshots: [],
  };
}
