import { describe, expect, it } from "vitest";
import { buildCorrelationGraph } from "../src/export/correlation.js";
import { sampleExportSessionData } from "./fixtures/sample-session.js";

describe("evidence correlation graph", () => {
  it("uses browser identities and labels bounded heuristics", () => {
    const data = sampleExportSessionData();
    data.navigation[0]!.timestamp = 1_000;
    data.network = [
      {
        id: "network-redirect",
        sessionId: data.session!.id,
        requestId: "request-redirect",
        timestamp: 2_000,
        url: "https://example.test/api?token=should-not-enter-graph",
        method: "GET",
        type: "fetch",
        documentUrl: "https://example.test/checkout",
        statusCode: 500,
        error: "server failure",
      },
      {
        id: "network-followup",
        sessionId: data.session!.id,
        requestId: "request-followup",
        timestamp: 2_500,
        url: "https://example.test/api?token=should-not-enter-graph",
        method: "GET",
        type: "fetch",
        documentUrl: "https://example.test/checkout",
        redirectFromId: "network-redirect",
        initiator: { requestId: "request-redirect", type: "script" },
        statusCode: 500,
        error: "retry failure",
      },
    ];
    data.console = [{
      id: "console-error",
      sessionId: data.session!.id,
      timestamp: 2_600,
      level: "error",
      method: "Runtime.exceptionThrown",
      text: "request failed",
      url: "https://example.test/checkout",
      tabId: data.session!.tabId,
    }];
    data.markers = [{
      id: "marker-issue",
      sessionId: data.session!.id,
      timestamp: 2_700,
      label: "User marker",
      nearestNetworkId: "network-followup",
      nearestConsoleId: "console-error",
      tabId: data.session!.tabId,
    }];

    const graph = buildCorrelationGraph(data);
    expect(graph.schemaVersion).toBe(1);
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "redirect",
        from: "network:network-redirect",
        to: "network:network-followup",
        confidence: "direct",
        ambiguous: false,
      }),
      expect.objectContaining({
        type: "initiator",
        from: "network:network-redirect",
        to: "network:network-followup",
        confidence: "direct",
      }),
      expect.objectContaining({
        type: "console-error",
        to: "console:console-error",
        confidence: "heuristic",
      }),
      expect.objectContaining({
        type: "marker-context",
        from: "marker:marker-issue",
        to: "network:network-followup",
        confidence: "direct",
      }),
    ]));
    expect(JSON.stringify(graph)).not.toContain("should-not-enter-graph");
    expect(graph.edges.every((edge) => edge.provenance.source && edge.provenance.rule)).toBe(true);
  });
});
