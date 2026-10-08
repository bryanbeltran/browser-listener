import { describe, expect, it } from "vitest";
import { buildCoverageReport } from "../src/export/coverage.js";
import type { SessionData } from "../src/shared/types.js";
import { sampleSession } from "./helpers/fixtures.js";

function evidenceData(): SessionData {
  return {
    session: sampleSession({
      tabUrl: "https://example.test/problem",
      health: {
        ...sampleSession().health,
        truncation: { network: 2, navigation: 3, console: 4 },
        partialGaps: [{ at: 1, reason: "debugger_detach: canceled" }],
        persistenceErrors: ["quota"],
        bodiesSkippedSessionCap: 2,
      },
    }),
    network: [
      {
        id: "network-1",
        sessionId: "test-session-1",
        requestId: "request-1",
        timestamp: 1,
        url: "https://example.test/api",
        method: "GET",
        type: "fetch",
        statusCode: 200,
        responseHeaders: { "content-type": "application/json" },
        responseBody: "{}",
      },
      {
        id: "network-2",
        sessionId: "test-session-1",
        requestId: "request-2",
        timestamp: 2,
        url: "https://example.test/asset",
        method: "GET",
        type: "image",
      },
    ],
    navigation: [
      {
        id: "nav-1",
        sessionId: "test-session-1",
        timestamp: 1,
        url: "https://example.test/problem",
        title: "Problem",
      },
    ],
    console: [
      {
        id: "console-1",
        sessionId: "test-session-1",
        timestamp: 1,
        level: "error",
        text: "boom",
        source: "javascript",
      },
    ],
    markers: [
      {
        id: "marker-1",
        sessionId: "test-session-1",
        timestamp: 3,
        label: "User marker",
        note: "Clicked submit",
      },
    ],
  };
}

describe("coverage report", () => {
  it("summarizes generic evidence, field coverage, and quality signals", () => {
    const report = buildCoverageReport(evidenceData());

    expect(report.schemaVersion).toBe(4);
    expect(report.source.tabUrl).toContain("example.test");
    expect(report.capture).toEqual({ paused: false, pauseIntervals: [] });
    expect(report.policy).toMatchObject({
      profile: "network-console",
      redactionEnabled: true,
      captureBodies: false,
      captureConsole: true,
      allowedOrigins: [],
      budgets: {
        perOriginBytes: 32 * 1024 * 1024,
        perCategoryBytes: 64 * 1024 * 1024,
      },
    });
    expect(report.policy.epochs).toHaveLength(1);
    expect(report.totals).toEqual({
      network: 2,
      navigation: 1,
      console: 1,
      markers: 1,
      requestBodies: 0,
      responseBodies: 1,
      contextSnapshots: 0,
      performanceSignals: 0,
    });
    expect(report.fields.network.responseBody).toMatchObject({ present: 1, total: 2, percent: 50 });
    expect(report.fields.navigation.title).toMatchObject({ present: 1, total: 1, percent: 100 });
    expect(report.fields.console.text).toMatchObject({ present: 1, total: 1, percent: 100 });
    expect(report.fields.markers.note).toMatchObject({ present: 1, total: 1, percent: 100 });
    expect(report.quality).toEqual({
      networkTruncated: 2,
      navigationTruncated: 3,
      consoleTruncated: 4,
      bodiesTruncated: 0,
      bodiesSkippedSessionCap: 2,
      healthGaps: 1,
      persistenceErrors: 1,
      markersTruncated: 0,
      contextSnapshotsTruncated: 0,
      performanceSignalsTruncated: 0,
      filteredNetworkRequests: 0,
      fairBudgetEvictions: 0,
      bodySkipReasons: {},
      partial: true,
      gapReasons: ["debugger_detach: canceled"],
    });
    expect(report.states.network.observed).toBe(2);
    expect(report.states.network.dropped).toBe(2);
    expect(report.states.bodies.request.excluded).toBe(2);
    expect(report.states.bodies.response.observed).toBe(1);
    expect(report.states.bodies.response.excluded).toBe(1);
  });
});
