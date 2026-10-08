import { describe, expect, it } from "vitest";
import { buildZipFromSessionData } from "../../src/export/orchestrator.js";
import { sampleExportSessionData } from "../fixtures/sample-session.js";
import { unzipToMap } from "../helpers/unzip.js";

const REQUIRED_FILES = [
  "report.html",
  "session.json",
  "network.json",
  "console.json",
  "coverage-report.json",
  "export-manifest.json",
];

describe("E2E export pipeline", () => {
  it("builds ZIP with six portable evidence artifacts", async () => {
    const files = unzipToMap(await buildZipFromSessionData(sampleExportSessionData()));
    expect(Object.keys(files).sort()).toEqual([...REQUIRED_FILES].sort());
  });

  it("offline report focuses on generic session evidence", async () => {
    const files = unzipToMap(await buildZipFromSessionData(sampleExportSessionData()));
    expect(files["report.html"]).toContain("Browser Listener");
    expect(files["report.html"]).toContain("Evidence timeline");
    expect(files["report.html"]).toContain("Copy citation");
    expect(files["report.html"]).toContain("timeline-search");
  });

  it("manifest asserts local-only privacy and generic coverage", async () => {
    const files = unzipToMap(await buildZipFromSessionData(sampleExportSessionData()));
    const manifest = JSON.parse(files["export-manifest.json"]);
    const coverage = JSON.parse(files["coverage-report.json"]);
    expect(manifest.privacy.localOnly).toBe(true);
    expect(manifest.privacy.remoteUpload).toBe(false);
    expect(manifest.files.map((file: { path: string }) => file.path)).toEqual(REQUIRED_FILES);
    expect(coverage.schemaVersion).toBe(1);
    expect(coverage.source.tabUrl).toContain("example.test");
    expect(JSON.parse(files["session.json"]).navigation).toHaveLength(1);
    expect(JSON.parse(files["console.json"])).toHaveLength(1);
  });
});
