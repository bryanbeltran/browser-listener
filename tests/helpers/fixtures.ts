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
    tabUrl: "https://example.com/app",
    options: { ...DEFAULT_CAPTURE_OPTIONS },
    health: {
      debuggerAttached: true,
      debuggerDetachCount: 0,
      serviceWorkerRestarts: 0,
      partialGaps: [],
      persistenceErrors: [],
      eventCounts: {},
      truncation: { console: 0, network: 0, timeline: 0, userActions: 0 },
    },
    ...overrides,
  };
}

export function leakySessionData(): SessionData {
  return {
    session: sampleSession(),
    timeline: [],
    console: [
      {
        id: "c1",
        sessionId: "test-session-1",
        timestamp: Date.now(),
        level: "log",
        args: ["token=super-secret-jwt-value"],
        url: "https://example.com?access_token=leak-me",
      },
    ],
    network: [
      {
        id: "n1",
        sessionId: "test-session-1",
        requestId: "req-1",
        timestamp: Date.now(),
        url: "https://api.example.com/data?api_key=SECRET123",
        method: "GET",
        type: "xhr",
        requestHeaders: {
          Authorization: "Bearer eyJhbG.secret.payload",
          Cookie: "session=abc123",
        },
        responseHeaders: {
          "Set-Cookie": "id_token=should-not-export",
        },
        statusCode: 200,
      },
    ],
    userActions: [
      {
        id: "u1",
        sessionId: "test-session-1",
        timestamp: Date.now(),
        type: "input",
        target: "input#password",
        valueSummary: "hunter2",
        url: "https://example.com",
      },
    ],
    diagnostics: [],
    domSnapshots: [
      {
        id: "d1",
        sessionId: "test-session-1",
        timestamp: Date.now(),
        url: "https://example.com",
        htmlSummary: '<input type="password" value="hunter2" />',
        nodeCount: 1,
      },
    ],
  };
}
