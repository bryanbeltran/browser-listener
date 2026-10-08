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
    tabUrl: "https://example.test/problem",
    options: { ...DEFAULT_CAPTURE_OPTIONS },
    health: {
      debuggerAttached: true,
      debuggerEverAttached: false,
      debuggerDetachCount: 0,
      serviceWorkerRestarts: 0,
      partialGaps: [],
      persistenceErrors: [],
      truncation: { network: 0, navigation: 0, console: 0 },
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
        url: "https://example.test/api?access_token=SECRET123&page=1",
        method: "POST",
        type: "fetch",
        requestHeaders: {
          Authorization: "Bearer eyJhbG.secret.payload",
          Cookie: "session=abc123",
        },
        responseHeaders: {
          "Set-Cookie": "id_token=should-not-export",
        },
        requestBody: "access_token=leak-me&message=hello",
        responseBody: '{"data":{"viewer":{"token":"super-secret-jwt-value"}}}',
        statusCode: 200,
        bodyCaptured: true,
      },
    ],
    navigation: [
      {
        id: "nav1",
        sessionId: "test-session-1",
        timestamp: Date.now(),
        url: "https://example.test/problem?session=hush",
        title: "Problem page",
        tabId: 1,
        frameId: 0,
      },
    ],
    console: [
      {
        id: "log1",
        sessionId: "test-session-1",
        timestamp: Date.now(),
        level: "error",
        text: "request failed with token hunter2",
        url: "https://example.test/problem",
        tabId: 1,
      },
    ],
  };
}
