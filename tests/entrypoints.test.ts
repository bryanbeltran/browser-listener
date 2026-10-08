import { describe, expect, it } from "vitest";
import manifest from "../manifest.json";

describe("browser extension entrypoints", () => {
  it("uses explicit selected-tab permissions without broad hosts", () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.background.service_worker).toBe("background.js");
    expect(manifest.action.default_popup).toBe("popup.html");
    expect(manifest.content_scripts).toBeUndefined();
    expect(manifest.permissions).toEqual([
      "storage",
      "unlimitedStorage",
      "downloads",
      "activeTab",
      "tabs",
      "debugger",
    ]);
    expect(manifest.host_permissions).toBeUndefined();
  });

  it("export orchestrator module loads", async () => {
    const mod = await import("../src/export/orchestrator");
    expect(mod.buildZipFromSessionData).toBeTypeOf("function");
  });
});
