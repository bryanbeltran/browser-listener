import type { SessionData } from "../../src/shared/types.js";
import { DEFAULT_CAPTURE_OPTIONS } from "../../src/shared/types.js";

export function sampleExportSessionData(): SessionData {
  return {
    session: {
      id: "sample-export-session",
      active: false,
      consentedAt: Date.now() - 120_000,
      startedAt: Date.now() - 120_000,
      stoppedAt: Date.now(),
      tabId: 42,
      tabUrl: "https://example.test/checkout",
      options: { ...DEFAULT_CAPTURE_OPTIONS },
      health: {
        debuggerAttached: true,
        debuggerEverAttached: true,
        debuggerDetachCount: 0,
        serviceWorkerRestarts: 0,
        partialGaps: [],
        persistenceErrors: [],
        truncation: { network: 0, navigation: 0, console: 0 },
      },
    },
    network: [
      {
        id: "n-sample-1",
        sessionId: "sample-export-session",
        requestId: "req-sample-1",
        timestamp: Date.now() - 30_000,
        url: "https://example.test/api/items?page=1",
        method: "GET",
        type: "fetch",
        statusCode: 200,
        contentType: "application/json",
        responseBody: '{"items":[{"id":"item-1"}]}',
        bodyCaptured: true,
      },
    ],
    navigation: [
      {
        id: "nav-sample-1",
        sessionId: "sample-export-session",
        timestamp: Date.now() - 110_000,
        url: "https://example.test/checkout",
        title: "Checkout",
        tabId: 42,
        frameId: 0,
      },
    ],
    console: [
      {
        id: "console-sample-1",
        sessionId: "sample-export-session",
        timestamp: Date.now() - 20_000,
        level: "warning",
        text: "slow response",
        url: "https://example.test/checkout",
        tabId: 42,
      },
    ],
  };
}
