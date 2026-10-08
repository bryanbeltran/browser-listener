import { describe, expect, it } from "vitest";
import { baseManifestFiles, buildExportManifest } from "../src/export/manifest-builder.js";
import { leakySessionData } from "./helpers/fixtures.js";

describe("export manifest", () => {
  it("lists four required evidence files", () => {
    expect(baseManifestFiles().map((file) => file.path)).toEqual([
      "report.html",
      "raw.har",
      "raw-console.json",
      "export-manifest.json",
    ]);
  });

  it("records privacy flags and extension version", () => {
    const data = leakySessionData();
    data.session!.extensionVersion = "0.3.21";
    const manifest = buildExportManifest(data);
    expect(manifest.privacy.localOnly).toBe(true);
    expect(manifest.privacy.remoteUpload).toBe(false);
    expect(manifest.version).toBe("0.3.21");
    expect(manifest.extensionVersion).toBe("0.3.21");
    expect(manifest.schemaVersion).toBe(2);
    expect(manifest.format).toBe("browser-listener");
    expect(manifest.coverage.schemaVersion).toBe(1);
    expect(manifest.coverage.source.tabUrl).toContain("example.test");
  });
});
