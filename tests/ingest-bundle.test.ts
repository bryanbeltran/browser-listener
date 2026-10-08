import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { ingestBundle, listImportedBundles } from "../scripts/ingest-bundle.mjs";
import { buildZipFromSessionData } from "../src/export/orchestrator.js";
import { sampleExportSessionData } from "./fixtures/sample-session.js";
import { unzipToMap } from "./helpers/unzip.js";

function temporaryPaths() {
  const directory = mkdtempSync(join(tmpdir(), "browser-listener-ingest-"));
  return {
    directory,
    archivePath: join(directory, "bundle.zip"),
    databasePath: join(directory, "sessions.db"),
  };
}

function repack(files: Record<string, string>): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(files).map(([path, content]) => [path, strToU8(content)])));
}

describe("bundle ingest", () => {
  it("imports idempotently and records artifacts plus analytical rows", async () => {
    const paths = temporaryPaths();
    const archive = await buildZipFromSessionData(sampleExportSessionData(), 1_700_000_000_000);
    writeFileSync(paths.archivePath, archive);

    const first = ingestBundle({ archivePath: paths.archivePath, dbPath: paths.databasePath });
    expect(first.status).toBe("imported");
    expect(ingestBundle({ archivePath: paths.archivePath, dbPath: paths.databasePath })).toMatchObject({
      status: "already-imported",
      bundleId: "sample-export-session",
      sourceSha256: first.sourceSha256,
    });
    expect(listImportedBundles(paths.databasePath)).toMatchObject([
      {
        bundleId: "sample-export-session",
        sourceSha256: first.sourceSha256,
        partial: 0,
        redactionEnabled: 1,
      },
    ]);

    const db = new DatabaseSync(paths.databasePath);
    try {
      expect(db.prepare("SELECT COUNT(*) AS count FROM artifacts").get()?.count).toBe(4);
      expect(db.prepare("SELECT COUNT(*) AS count FROM network_events").get()?.count).toBe(1);
      expect(db.prepare("SELECT COUNT(*) AS count FROM console_events").get()?.count).toBe(1);
      expect(db.prepare("SELECT COUNT(*) AS count FROM navigation_events").get()?.count).toBe(1);
      expect(db.prepare("SELECT COUNT(*) AS count FROM artifacts WHERE sha256 IS NOT NULL AND bytes > 0").get()?.count).toBe(4);
    } finally {
      db.close();
    }
  });

  it("rejects checksum conflicts and validation failures without changing the database", async () => {
    const paths = temporaryPaths();
    const original = sampleExportSessionData();
    const archive = await buildZipFromSessionData(original, 1_700_000_000_000);
    writeFileSync(paths.archivePath, archive);
    ingestBundle({ archivePath: paths.archivePath, dbPath: paths.databasePath });

    const conflict = sampleExportSessionData();
    conflict.console[0]!.text = "changed evidence";
    const conflictPath = join(paths.directory, "conflict.zip");
    writeFileSync(conflictPath, await buildZipFromSessionData(conflict, 1_700_000_000_000));
    expect(() => ingestBundle({ archivePath: conflictPath, dbPath: paths.databasePath })).toThrow(
      "already exists with a different source checksum",
    );

    const files = unzipToMap(readFileSync(paths.archivePath));
    const har = JSON.parse(files["raw.har"]);
    har.log.entries.push({ ...har.log.entries[0] });
    const invalidPath = join(paths.directory, "invalid.zip");
    writeFileSync(invalidPath, repack({ ...files, "raw.har": JSON.stringify(har) }));
    expect(() => ingestBundle({ archivePath: invalidPath, dbPath: paths.databasePath })).toThrow(
      "Bundle validation failed",
    );

    expect(listImportedBundles(paths.databasePath)).toHaveLength(1);
    const db = new DatabaseSync(paths.databasePath);
    try {
      expect(db.prepare("SELECT COUNT(*) AS count FROM bundles").get()?.count).toBe(1);
      expect(db.prepare("SELECT COUNT(*) AS count FROM artifacts").get()?.count).toBe(4);
    } finally {
      db.close();
    }
  });
});
