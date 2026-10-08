import { describe, expect, it } from "vitest";
import { compareSessionData } from "../src/export/diff.js";
import type { SessionData } from "../src/shared/types.js";
import { sampleExportSessionData } from "./fixtures/sample-session.js";

describe("session diff", () => {
  it("compares normalized evidence with citations and deterministic changes", () => {
    const left = sampleExportSessionData();
    const right: SessionData = {
      ...sampleExportSessionData(),
      session: {
        ...sampleExportSessionData().session!,
        id: "failing-session",
        options: { ...sampleExportSessionData().session!.options, captureBodies: true },
      },
      network: [
        {
          ...sampleExportSessionData().network[0]!,
          id: "failing-network",
          sessionId: "failing-session",
          statusCode: 500,
          timing: { start: 10, durationMs: 250 },
        },
        {
          ...sampleExportSessionData().network[0]!,
          id: "new-network",
          sessionId: "failing-session",
          url: "https://example.test/api/error",
          statusCode: 503,
        },
      ],
      console: [
        {
          ...sampleExportSessionData().console[0]!,
          id: "failing-console",
          sessionId: "failing-session",
          level: "error",
          text: "request failed",
        },
      ],
    };

    const diff = compareSessionData(left, right);

    expect(diff.schemaVersion).toBe(1);
    expect(diff.comparable).toBe(true);
    expect(diff.policy.changes).toEqual([{ field: "captureBodies", before: false, after: true }]);
    expect(diff.network.changed[0]?.changes).toEqual([
      { field: "statusCode", before: 200, after: 500 },
      { field: "durationMs", before: undefined, after: 250 },
    ]);
    expect(diff.network.added[0]?.citation.address).toContain("failing-session/raw.har/new-network");
    expect(diff.network.orderChanged).toBe(true);
    expect(diff.console.added[0]?.citation.artifact).toBe("raw-console.json");
    expect(JSON.stringify(diff)).not.toContain("secret");
  });

  it("marks captures with different redaction policy as non-comparable", () => {
    const left = sampleExportSessionData();
    const right = sampleExportSessionData();
    right.session!.id = "opt-out-session";
    right.session!.options.redactionEnabled = false;

    const diff = compareSessionData(left, right);

    expect(diff.comparable).toBe(false);
    expect(diff.nonComparableReasons).toContain("redaction policy differs");
  });
});
