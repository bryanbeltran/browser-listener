import { describe, expect, it } from "vitest";
import { baseManifestFiles, buildExportManifest } from "../src/export/manifest-builder.js";
import { leakySessionData } from "./helpers/fixtures.js";

describe("export manifest", () => {
  it("lists core Facebook export files", () => {
    const paths = baseManifestFiles(true, true, ["csv/posts.csv"]).map((f) => f.path);
    expect(paths).toContain("report.html");
    expect(paths).toContain("trace-summary.json");
    expect(paths).toContain("group-activity.json");
    expect(paths).toContain("graphql-captures.json");
    expect(paths).not.toContain("network.har");
    expect(paths).not.toContain("timeline.json");
  });

  it("buildExportManifest records privacy flags", () => {
    const data = leakySessionData();
    const manifest = buildExportManifest(data, baseManifestFiles());
    expect(manifest.privacy.localOnly).toBe(true);
    expect(manifest.privacy.remoteUpload).toBe(false);
  });
});
