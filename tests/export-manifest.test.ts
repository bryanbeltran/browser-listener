import { describe, expect, it } from "vitest";
import { baseManifestFiles, buildExportManifest } from "../src/export/manifest-builder.js";
import { sampleSession, leakySessionData } from "./helpers/fixtures.js";

describe("export manifest", () => {
  it("includes required core artifacts", () => {
    const files = baseManifestFiles(sampleSession().options);
    const paths = files.map((f) => f.path);
    expect(paths).toContain("report.html");
    expect(paths).toContain("network.har");
    expect(paths).toContain("timeline.json");
    expect(files.filter((f) => f.enabled).length).toBeGreaterThan(5);
  });

  it("marks optional artifacts disabled by default", () => {
    const files = baseManifestFiles(sampleSession().options);
    const screen = files.find((f) => f.path.includes("screen"));
    expect(screen?.enabled).toBe(false);
    expect(screen?.optional).toBe(true);
  });

  it("buildExportManifest records privacy flags", () => {
    const data = leakySessionData();
    const manifest = buildExportManifest(data, baseManifestFiles(data.session!.options));
    expect(manifest.privacy.localOnly).toBe(true);
    expect(manifest.privacy.remoteUpload).toBe(false);
  });
});
