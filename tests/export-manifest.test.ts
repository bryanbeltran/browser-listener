import { describe, expect, it } from "vitest";
import { baseManifestFiles, buildExportManifest } from "../src/export/manifest-builder.js";
import { leakySessionData } from "./helpers/fixtures.js";

describe("export manifest", () => {
  it("lists core Facebook export files", () => {
    const paths = baseManifestFiles(true, true, ["csv/posts.csv"]).map((f) => f.path);
    expect(paths).toContain("report.html");
    expect(paths).toContain("trace-summary.json");
    expect(paths).toContain("coverage-report.json");
    expect(paths).toContain("group-activity.json");
    expect(paths).toContain("graphql-captures.json");
    expect(paths).not.toContain("network.har");
    expect(paths).not.toContain("timeline.json");
  });

  it("buildExportManifest records privacy flags and extension version", () => {
    const data = leakySessionData();
    data.session!.extensionVersion = "0.3.21";
    const manifest = buildExportManifest(data, baseManifestFiles());
    expect(manifest.privacy.localOnly).toBe(true);
    expect(manifest.privacy.remoteUpload).toBe(false);
    expect(manifest.version).toBe("0.3.21");
    expect(manifest.extensionVersion).toBe("0.3.21");
    expect(manifest.coverage).toEqual({ path: "coverage-report.json", schemaVersion: 1 });
  });
});
