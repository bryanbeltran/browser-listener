import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  deleteBundle,
  ingestBundle,
  ingestBundles,
  listImportedBundles,
  queryIngested,
} from "../scripts/ingest-bundle.mjs";
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

    const first = await ingestBundle({ archivePath: paths.archivePath, dbPath: paths.databasePath });
    expect(first.status).toBe("imported");
    await expect(ingestBundle({ archivePath: paths.archivePath, dbPath: paths.databasePath })).resolves.toMatchObject({
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
    await ingestBundle({ archivePath: paths.archivePath, dbPath: paths.databasePath });

    const conflict = sampleExportSessionData();
    conflict.console[0]!.text = "changed evidence";
    const conflictPath = join(paths.directory, "conflict.zip");
    writeFileSync(conflictPath, await buildZipFromSessionData(conflict, 1_700_000_000_000));
    await expect(ingestBundle({ archivePath: conflictPath, dbPath: paths.databasePath })).rejects.toThrow(
      "already exists with a different source checksum",
    );

    const files = unzipToMap(readFileSync(paths.archivePath));
    const har = JSON.parse(files["raw.har"]);
    har.log.entries.push({ ...har.log.entries[0] });
    const invalidPath = join(paths.directory, "invalid.zip");
    writeFileSync(invalidPath, repack({ ...files, "raw.har": JSON.stringify(har) }));
    await expect(ingestBundle({ archivePath: invalidPath, dbPath: paths.databasePath })).rejects.toThrow(
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

  it("merges sessions, applies bounded read-only queries, cites rows, and deletes by bundle", async () => {
    const paths = temporaryPaths();
    const first = sampleExportSessionData();
    const second = sampleExportSessionData();
    second.session!.id = "second-session";
    second.network[0]!.id = "second-network";
    second.console[0]!.id = "second-console";
    second.navigation[0]!.id = "second-navigation";
    const firstPath = join(paths.directory, "first.zip");
    const secondPath = join(paths.directory, "second.zip");
    writeFileSync(firstPath, await buildZipFromSessionData(first, 1_700_000_000_000));
    writeFileSync(secondPath, await buildZipFromSessionData(second, 1_700_000_000_000));

    expect(await ingestBundles({ archivePaths: [firstPath, secondPath], dbPath: paths.databasePath })).toHaveLength(2);
    const result = queryIngested({
      dbPath: paths.databasePath,
      query: {
        entity: "network",
        filters: { statusMin: 200, urlIncludes: "/api/" },
        select: ["eventId", "url", "status", "durationMs"],
        limit: 10,
        maxBytes: 20_000,
      },
    });
    expect(result.truncated).toBe(false);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({
      eventId: expect.any(String),
      status: 200,
      citation: expect.stringContaining("/raw.har/")
    });

    const filtered = queryIngested({
      dbPath: paths.databasePath,
      query: { entity: "console", filters: { textIncludes: "slow" }, limit: 10 },
    });
    expect(filtered.rows).toHaveLength(2);
    expect(deleteBundle({ dbPath: paths.databasePath, bundleId: "second-session" })).toEqual({
      status: "deleted",
      bundleId: "second-session",
    });
    expect(queryIngested({ dbPath: paths.databasePath, query: { entity: "network", limit: 10 } }).rows).toHaveLength(1);
    expect(deleteBundle({ dbPath: paths.databasePath, bundleId: "second-session" })).toEqual({
      status: "not-found",
      bundleId: "second-session",
    });
  });
});
