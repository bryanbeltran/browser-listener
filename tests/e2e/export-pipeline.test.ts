import { describe, expect, it } from "vitest";
import { buildZipFromSessionData } from "../../src/export/orchestrator.js";
import { sampleExportSessionData } from "../fixtures/sample-session.js";
import { unzipToMap } from "../helpers/unzip.js";

const REQUIRED_FILES = [
  "report.html",
  "trace-summary.json",
  "coverage-report.json",
  "export-manifest.json",
  "graphql-captures.json",
];

describe("E2E export pipeline", () => {
  it("builds ZIP with core Facebook export artifacts", async () => {
    const zip = await buildZipFromSessionData(sampleExportSessionData());
    const files = unzipToMap(zip);
    for (const path of REQUIRED_FILES) {
      expect(files[path], `missing ${path}`).toBeDefined();
    }
  });

  it("offline report focuses on Facebook activity", async () => {
    const zip = await buildZipFromSessionData(sampleExportSessionData());
    const files = unzipToMap(zip);
    expect(files["report.html"]).toContain("Browser Listener");
    expect(files["report.html"]).toContain("Facebook activity");
    expect(files["report.html"]).toContain("Copy citation");
    expect(files["report.html"]).toContain("activity-search");
    expect(files["report.html"]).not.toContain("Network explorer");
  });

  it("manifest asserts local-only privacy", async () => {
    const zip = await buildZipFromSessionData(sampleExportSessionData());
    const manifest = JSON.parse(unzipToMap(zip)["export-manifest.json"]);
    const coverage = JSON.parse(unzipToMap(zip)["coverage-report.json"]);
    expect(manifest.privacy.localOnly).toBe(true);
    expect(manifest.privacy.remoteUpload).toBe(false);
    expect(manifest.coverage).toEqual({ path: "coverage-report.json", schemaVersion: 1 });
    expect(coverage.schemaVersion).toBe(1);
    expect(coverage.source.tabUrl).toContain("facebook.com");
  });
});
