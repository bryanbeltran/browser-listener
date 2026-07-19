import { describe, expect, it } from "vitest";
import manifest from "../manifest.json";

describe("browser extension entrypoints", () => {
  it("manifest references built service worker and popup", () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.background.service_worker).toBe("background.js");
    expect(manifest.action.default_popup).toBe("popup.html");
    expect(manifest.content_scripts).toBeUndefined();
    expect(manifest.permissions).not.toContain("pageCapture");
  });

  it("export orchestrator module loads", async () => {
    const mod = await import("../src/export/orchestrator");
    expect(mod.buildZipFromSessionData).toBeTypeOf("function");
  });
});
