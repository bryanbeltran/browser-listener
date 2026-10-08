import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import {
  readBundle,
  validateBundle,
  verifyChecksums,
  repairBundle,
  filterConsole,
  filterNetwork,
  cite,
  summarize,
} from "../sdk/src/index.js";
import { buildZipFromSessionData } from "../src/export/orchestrator.js";
import { sampleExportSessionData } from "./fixtures/sample-session.js";

describe("bundle SDK", () => {
  it("reads, validates, filters, summarizes, and cites without executing report HTML", async () => {
    const bundle = readBundle(await buildZipFromSessionData(sampleExportSessionData()));
    const validation = validateBundle(bundle);
    const checksums = await verifyChecksums(bundle);

    expect(validation.valid).toBe(true);
    expect(checksums.valid).toBe(true);
    expect(bundle.files["report.html"]).toBeInstanceOf(Uint8Array);
    expect(filterNetwork(bundle, { statusMin: 200 })).toHaveLength(1);
    expect(filterConsole(bundle, { levels: ["warning"] })).toHaveLength(1);
    expect(cite(bundle, "raw.har", "n-sample-1")).toBe(
      "browser-listener://sample-export-session/raw.har/n-sample-1?schema=4",
    );
    expect(summarize(bundle)).toMatchObject({
      sessionId: "sample-export-session",
      network: 1,
      console: 1,
      navigation: 1,
      markers: 0,
      partial: false,
    });
  });

  it("reports duplicate IDs and disabled-redaction warnings", async () => {
    const data = sampleExportSessionData();
    data.session!.options.redactionEnabled = false;
    data.network.push({ ...data.network[0]!, id: "n-sample-1" });
    const bundle = readBundle(await buildZipFromSessionData(data));
    const validation = validateBundle(bundle);

    expect(validation.valid).toBe(false);
    expect(validation.issues.some((issue) => issue.code === "duplicate-id")).toBe(true);
    expect(validation.issues.some((issue) => issue.code === "redaction-disabled" && issue.severity === "warning")).toBe(true);
  });

  it("detects tampered artifacts, rejects unsafe paths, and repairs unknown files conservatively", async () => {
    const original = await buildZipFromSessionData(sampleExportSessionData(), 1_700_000_000_000);
    const source = readBundle(original);
    const files = Object.fromEntries(Object.entries(source.files).map(([path, bytes]) => [path, bytes]));
    files["raw-console.json"] = strToU8("[]");
    const tampered = readBundle(zipSync(files));
    expect((await verifyChecksums(tampered)).issues).toEqual([
      expect.objectContaining({ code: "checksum-mismatch", path: "archive.raw-console.json" }),
    ]);

    const withUnknown = zipSync({ ...Object.fromEntries(Object.entries(source.files)), "derived/notes.txt": strToU8("local note") });
    const repaired = readBundle(await repairBundle(withUnknown));
    expect(Object.keys(repaired.files).sort()).toEqual([
      "export-manifest.json",
      "raw-console.json",
      "raw.har",
      "report.html",
    ]);
    expect(validateBundle(repaired).valid).toBe(true);
    expect((await verifyChecksums(repaired)).valid).toBe(true);

    expect(() => readBundle(zipSync({ ...Object.fromEntries(Object.entries(source.files)), "../escape.txt": strToU8("no") }))).toThrow(
      "Unsafe archive path",
    );
  });
});
