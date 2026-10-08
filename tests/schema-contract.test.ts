import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildZipFromSessionData } from "../src/export/orchestrator.js";
import { sampleExportSessionData } from "./fixtures/sample-session.js";
import { unzipToMap } from "./helpers/unzip.js";

const schemaDir = resolve(process.cwd(), "schemas");

function schema(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(schemaDir, name), "utf8")) as Record<string, unknown>;
}

describe("versioned schema contract", () => {
  it("publishes all current artifact schemas with stable IDs", () => {
    const names = [
      "export-manifest.v4.schema.json",
      "coverage.v4.schema.json",
      "export-manifest.v3.schema.json",
      "coverage.v3.schema.json",
      "raw-har.v1.2.schema.json",
      "raw-console.v1.schema.json",
      "session-data.v1.schema.json",
      "report-metadata.v1.schema.json",
    ];
    for (const name of names) {
      const current = schema(name);
      expect(current.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
      expect(current.$id).toContain("browser-listener.dev/schemas/");
      if (current.type === "object") expect(current.required).toBeInstanceOf(Array);
    }
  });

  it("covers every required ZIP artifact and current manifest/coverage versions", async () => {
    const files = unzipToMap(await buildZipFromSessionData(sampleExportSessionData()));
    const manifest = JSON.parse(files["export-manifest.json"]);
    const har = JSON.parse(files["raw.har"]);
    const rawConsole = JSON.parse(files["raw-console.json"]);
    expect(manifest.schemaVersion).toBe(4);
    expect(manifest.coverage.schemaVersion).toBe(4);
    expect(har.log.version).toBe("1.2");
    expect(Array.isArray(rawConsole)).toBe(true);
    expect(Object.keys(files).sort()).toEqual([
      "export-manifest.json",
      "raw-console.json",
      "raw.har",
      "report.html",
    ]);
  });
});
