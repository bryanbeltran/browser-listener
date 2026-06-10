import { describe, expect, it } from "vitest";
import manifest from "../manifest.json";

describe("browser extension entrypoints", () => {
  it("manifest references built service worker and scripts", () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.background.service_worker).toBe("background.js");
    expect(manifest.content_scripts[0].js).toContain("content.js");
    expect(manifest.content_scripts[0].all_frames).toBe(true);
    expect(manifest.action.default_popup).toBe("popup.html");
  });

  it("export orchestrator module loads", async () => {
    const mod = await import("../src/export/orchestrator");
    expect(mod.buildZipFromSessionData).toBeTypeOf("function");
  });
});
