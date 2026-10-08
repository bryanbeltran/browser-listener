import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildZipFromSessionData } from "../src/export/orchestrator.js";
import { sampleExportSessionData } from "./fixtures/sample-session.js";

describe("evidence CI gate", () => {
  it("returns stable machine-readable success and policy failure results", async () => {
    const directory = mkdtempSync(join(tmpdir(), "browser-listener-gate-"));
    const archivePath = join(directory, "bundle.zip");
    writeFileSync(archivePath, await buildZipFromSessionData(sampleExportSessionData(), 1_700_000_000_000));
    const output = execFileSync(process.execPath, [
      "scripts/evidence-gate.mjs",
      archivePath,
      "--json",
      "--require-redaction",
      "--min-network",
      "1",
    ], { encoding: "utf8" });
    expect(JSON.parse(output)).toMatchObject({ valid: true, sessionId: "sample-export-session" });

    const optOut = sampleExportSessionData();
    optOut.session!.options.redactionEnabled = false;
    const optOutPath = join(directory, "opt-out.zip");
    writeFileSync(optOutPath, await buildZipFromSessionData(optOut, 1_700_000_000_000));
    const rejected = spawnSync(process.execPath, [
      "scripts/evidence-gate.mjs",
      optOutPath,
      "--json",
      "--require-redaction",
    ], { encoding: "utf8" });
    expect(rejected.status).toBe(4);
    expect(JSON.parse(rejected.stdout)).toMatchObject({ valid: false, issues: [expect.objectContaining({ code: "redaction-required" })] });
  });
});
