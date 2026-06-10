import { describe, expect, it } from "vitest";
import { buildZipFromSessionData } from "../../src/export/orchestrator.js";
import { sampleExportSessionData } from "../fixtures/sample-session.js";
import { unzipToMap } from "../helpers/unzip.js";

const REQUIRED_FILES = [
  "report.html",
  "trace-summary.json",
  "network.har",
  "timeline.json",
  "console.json",
  "diagnostics.json",
  "export-manifest.json",
];

describe("E2E export pipeline", () => {
  it("builds ZIP with all core artifacts from sample session", async () => {
    const zip = await buildZipFromSessionData(sampleExportSessionData());
    const files = unzipToMap(zip);
    for (const path of REQUIRED_FILES) {
      expect(files[path], `missing ${path}`).toBeDefined();
    }
  });

  it("offline report references session data and facebook section", async () => {
    const zip = await buildZipFromSessionData(sampleExportSessionData());
    const files = unzipToMap(zip);
    expect(files["report.html"]).toContain("Browser Listener");
    expect(files["report.html"]).toContain("Network explorer");
    expect(files["report.html"]).toContain("Facebook group activity");
  });

  it("includes optional page.mhtml when artifact provided", async () => {
    const zip = await buildZipFromSessionData(sampleExportSessionData(), {
      pageMhtml: "<html><!-- sample mhtml --></html>",
    });
    const files = unzipToMap(zip);
    expect(files["artifacts/page.mhtml"]).toContain("sample mhtml");
    const manifest = JSON.parse(files["export-manifest.json"]);
    expect(manifest.files.some((f: { path: string; enabled: boolean }) => f.path === "artifacts/page.mhtml" && f.enabled)).toBe(true);
  });

  it("manifest asserts local-only privacy", async () => {
    const zip = await buildZipFromSessionData(sampleExportSessionData());
    const manifest = JSON.parse(unzipToMap(zip)["export-manifest.json"]);
    expect(manifest.privacy.localOnly).toBe(true);
    expect(manifest.privacy.remoteUpload).toBe(false);
  });
});
