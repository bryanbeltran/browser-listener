import type { CaptureSession, SessionData } from "../../src/shared/types.js";
import { DEFAULT_CAPTURE_OPTIONS } from "../../src/shared/types.js";

export function sampleSession(overrides: Partial<CaptureSession> = {}): CaptureSession {
  return {
    id: "test-session-1",
    active: false,
    consentedAt: Date.now() - 60_000,
    startedAt: Date.now() - 60_000,
    stoppedAt: Date.now(),
    tabId: 1,
    tabUrl: "https://www.facebook.com/groups/example",
    options: { ...DEFAULT_CAPTURE_OPTIONS },
    health: {
      debuggerAttached: true,
      debuggerDetachCount: 0,
      serviceWorkerRestarts: 0,
      partialGaps: [],
      persistenceErrors: [],
      truncation: { network: 0 },
    },
    ...overrides,
  };
}

export function leakySessionData(): SessionData {
  return {
    session: sampleSession(),
    network: [
      {
        id: "n1",
        sessionId: "test-session-1",
        requestId: "req-1",
        timestamp: Date.now(),
        url: "https://www.facebook.com/api/graphql/?api_key=SECRET123",
        method: "POST",
        type: "xhr",
        requestHeaders: {
          Authorization: "Bearer eyJhbG.secret.payload",
          Cookie: "session=abc123",
        },
        responseHeaders: {
          "Set-Cookie": "id_token=should-not-export",
        },
        requestBody: "doc_id=1&access_token=leak-me",
        responseBody: '{"data":{"viewer":{"token":"super-secret-jwt-value"}}}',
        statusCode: 200,
        bodyCaptured: true,
      },
    ],
  };
}
