import { describe, expect, it } from "vitest";
import { buildZipFromSessionData } from "../src/export/orchestrator.js";
import { REDACTED } from "../src/redaction/engine.js";
import { leakySessionData } from "./helpers/fixtures.js";
import { unzipToMap } from "./helpers/unzip.js";

const LEAK_PATTERNS = [
  "Bearer eyJhbG",
  "SECRET123",
  "leak-me",
  "abc123",
  "should-not-export",
  "super-secret-jwt",
  "hunter2",
];

describe("privacy export regression", () => {
  it("ZIP export does not contain known sensitive values", async () => {
    const zip = await buildZipFromSessionData(leakySessionData());
    const files = unzipToMap(zip);
    const combined = Object.values(files).join("\n");

    for (const pattern of LEAK_PATTERNS) {
      expect(combined).not.toContain(pattern);
    }
    expect(combined).toContain(REDACTED);
    expect(files["export-manifest.json"]).toContain('"localOnly": true');
    expect(files["export-manifest.json"]).toContain('"remoteUpload": false');
    expect(files["export-manifest.json"]).toContain('"redactionEnabled": true');
  });

  it("exports raw values only after explicit redaction opt-out", async () => {
    const data = leakySessionData();
    data.session!.options.redactionEnabled = false;
    const files = unzipToMap(await buildZipFromSessionData(data));

    expect(files["raw.har"]).toContain("Bearer eyJhbG.secret.payload");
    expect(files["raw-console.json"]).toContain("hunter2");
    expect(files["export-manifest.json"]).toContain('"redactionEnabled": false');
  });
});
