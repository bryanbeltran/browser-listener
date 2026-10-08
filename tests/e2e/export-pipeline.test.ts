import { describe, expect, it } from "vitest";
import { buildZipFromSessionData } from "../../src/export/orchestrator.js";
import { sampleExportSessionData } from "../fixtures/sample-session.js";
import { unzipToMap } from "../helpers/unzip.js";

const REQUIRED_FILES = [
  "report.html",
  "raw.har",
  "raw-console.json",
  "export-manifest.json",
];

describe("E2E export pipeline", () => {
  it("builds ZIP with four portable evidence artifacts", async () => {
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
    const har = JSON.parse(files["raw.har"]);
    const rawConsole = JSON.parse(files["raw-console.json"]);
    expect(manifest.privacy.localOnly).toBe(true);
    expect(manifest.privacy.remoteUpload).toBe(false);
    expect(manifest.files.map((file: { path: string }) => file.path)).toEqual(REQUIRED_FILES);
    expect(manifest.schemaVersion).toBe(2);
    expect(manifest.coverage.schemaVersion).toBe(1);
    expect(manifest.coverage.source.tabUrl).toContain("example.test");
    expect(har.log.version).toBe("1.2");
    expect(har.log.entries).toHaveLength(1);
    expect(har.log.entries[0].response.content.text).toContain('"items"');
    expect(har.log.pages).toHaveLength(1);
    expect(rawConsole).toHaveLength(1);
    expect(files["report.html"]).not.toContain('"items"');
  });
});
