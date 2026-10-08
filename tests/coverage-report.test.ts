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

    expect(report.schemaVersion).toBe(3);
    expect(report.source.tabUrl).toContain("example.test");
    expect(report.capture).toEqual({ paused: false, pauseIntervals: [] });
    expect(report.policy).toEqual({
      redactionEnabled: true,
      captureBodies: false,
      captureConsole: true,
      allowedOrigins: [],
    });
    expect(report.totals).toEqual({
      network: 2,
      navigation: 1,
      console: 1,
      markers: 1,
      requestBodies: 0,
      responseBodies: 1,
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
      filteredNetworkRequests: 0,
      partial: true,
      gapReasons: ["debugger_detach: canceled"],
    });
  });
});
