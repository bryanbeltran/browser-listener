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
      tabUrl: "https://www.facebook.com/groups/richfieldmncommunity",
      options: { ...DEFAULT_CAPTURE_OPTIONS },
      health: {
        debuggerAttached: true,
        debuggerDetachCount: 0,
        serviceWorkerRestarts: 0,
        partialGaps: [],
        persistenceErrors: [],
        truncation: { network: 0 },
      },
    },
    network: [
      {
        id: "n-sample-1",
        sessionId: "sample-export-session",
        requestId: "req-sample-1",
        timestamp: Date.now() - 30_000,
        url: "https://www.facebook.com/api/graphql/",
        method: "POST",
        type: "xhr",
        statusCode: 200,
        requestBody: "doc_id=123&fb_api_req_friendly_name=CometNewsFeedPaginationQuery",
        responseBody: '{"data":{"viewer":{}}}',
        bodyCaptured: true,
      },
    ],
  };
}
