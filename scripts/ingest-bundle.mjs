#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = resolve(fileURLToPath(new URL(".", import.meta.url)));
const SDK_PATH = resolve(SCRIPT_DIR, "../sdk/dist/index.js");

let sdk;
try {
  sdk = await import(pathToFileURL(SDK_PATH));
} catch (error) {
  throw new Error(`Bundle SDK is not built; run npm run build:sdk first (${error instanceof Error ? error.message : String(error)})`);
}

export const INGEST_SCHEMA_VERSION = 1;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function ensureSchema(db) {
  db.exec("PRAGMA foreign_keys = ON");
  const version = db.prepare("PRAGMA user_version").get().user_version;
  if (version > INGEST_SCHEMA_VERSION) {
    throw new Error(`Unsupported ingest database schema version: ${version}`);
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS bundles (
      bundle_id TEXT PRIMARY KEY,
      source_sha256 TEXT NOT NULL,
      source_path TEXT NOT NULL,
      imported_at INTEGER NOT NULL,
      exported_at INTEGER,
      manifest_schema_version INTEGER NOT NULL,
      coverage_schema_version INTEGER,
      redaction_enabled INTEGER NOT NULL,
      partial INTEGER NOT NULL,
      manifest_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS artifacts (
      bundle_id TEXT NOT NULL,
      path TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      content BLOB NOT NULL,
      PRIMARY KEY (bundle_id, path),
      FOREIGN KEY (bundle_id) REFERENCES bundles(bundle_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS network_events (
      bundle_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      request_id TEXT,
      sequence INTEGER NOT NULL,
      started_at TEXT,
      url TEXT,
      method TEXT,
      type TEXT,
      status INTEGER,
      duration_ms REAL,
      body_captured INTEGER NOT NULL,
      event_json TEXT NOT NULL,
      PRIMARY KEY (bundle_id, event_id),
      FOREIGN KEY (bundle_id) REFERENCES bundles(bundle_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS console_events (
      bundle_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      timestamp INTEGER,
      level TEXT,
      text TEXT,
      event_json TEXT NOT NULL,
      PRIMARY KEY (bundle_id, event_id),
      FOREIGN KEY (bundle_id) REFERENCES bundles(bundle_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS navigation_events (
      bundle_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      timestamp INTEGER,
      url TEXT,
      title TEXT,
      event_json TEXT NOT NULL,
      PRIMARY KEY (bundle_id, event_id),
      FOREIGN KEY (bundle_id) REFERENCES bundles(bundle_id) ON DELETE CASCADE
    );
  `);
  if (version === 0) db.exec(`PRAGMA user_version = ${INGEST_SCHEMA_VERSION}`);
}

function rowValue(row, key) {
  return row?.[key];
}

export function listImportedBundles(dbPath) {
  const db = new DatabaseSync(dbPath);
  try {
    ensureSchema(db);
    return db.prepare(`
      SELECT bundle_id AS bundleId, source_sha256 AS sourceSha256, source_path AS sourcePath,
             imported_at AS importedAt, exported_at AS exportedAt, partial,
             redaction_enabled AS redactionEnabled
      FROM bundles ORDER BY imported_at, bundle_id
    `).all();
  } finally {
    db.close();
  }
}

export function ingestBundle({ archivePath, dbPath }) {
  const archiveBytes = readFileSync(resolve(archivePath));
  const sourceSha256 = sha256(archiveBytes);
  const bundle = sdk.readBundle(archiveBytes);
  const validation = sdk.validateBundle(bundle);
  const errors = validation.issues.filter((issue) => issue.severity === "error");
  if (errors.length) {
    throw new Error(`Bundle validation failed: ${errors.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`);
  }
  const manifest = bundle.manifest;
  const bundleId = manifest.sessionId ?? "none";
  const coverage = manifest.coverage ?? {};
  const db = new DatabaseSync(resolve(dbPath));
  try {
    ensureSchema(db);
    const existing = db.prepare("SELECT source_sha256 AS sourceSha256 FROM bundles WHERE bundle_id = ?").get(bundleId);
    if (existing && rowValue(existing, "sourceSha256") !== sourceSha256) {
      throw new Error(`Bundle ${bundleId} already exists with a different source checksum`);
    }
    if (existing) return { status: "already-imported", bundleId, sourceSha256 };

    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(`
        INSERT INTO bundles (
          bundle_id, source_sha256, source_path, imported_at, exported_at,
          manifest_schema_version, coverage_schema_version, redaction_enabled, partial, manifest_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        bundleId,
        sourceSha256,
        resolve(archivePath),
        Date.now(),
        manifest.exportedAt ?? null,
        manifest.schemaVersion ?? 0,
        coverage.schemaVersion ?? null,
        manifest.privacy?.redactionEnabled === false ? 0 : 1,
        coverage.quality?.partial === true ? 1 : 0,
        JSON.stringify(manifest),
      );

      const artifactInsert = db.prepare("INSERT INTO artifacts (bundle_id, path, sha256, bytes, content) VALUES (?, ?, ?, ?, ?)");
      for (const path of ["report.html", "raw.har", "raw-console.json", "export-manifest.json"]) {
        const bytes = bundle.files[path];
        artifactInsert.run(bundleId, path, sha256(bytes), bytes.byteLength, Buffer.from(bytes));
      }

      const networkInsert = db.prepare(`
        INSERT INTO network_events (
          bundle_id, event_id, request_id, sequence, started_at, url, method, type,
          status, duration_ms, body_captured, event_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const [sequence, entry] of (bundle.har.log?.entries ?? []).entries()) {
        const metadata = entry._browserListener ?? {};
        const eventId = metadata.id ?? `network-${sequence}`;
        networkInsert.run(
          bundleId,
          eventId,
          metadata.requestId ?? null,
          sequence,
          entry.startedDateTime ?? null,
          entry.request?.url ?? null,
          entry.request?.method ?? null,
          metadata.type ?? null,
          entry.response?.status ?? null,
          typeof entry.time === "number" ? entry.time : null,
          metadata.bodyCaptured === true ? 1 : 0,
          JSON.stringify(entry),
        );
      }

      const consoleInsert = db.prepare(`
        INSERT INTO console_events (bundle_id, event_id, sequence, timestamp, level, text, event_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const [sequence, entry] of bundle.console.entries()) {
        const eventId = entry.id ?? `console-${sequence}`;
        consoleInsert.run(bundleId, eventId, sequence, entry.timestamp ?? null, entry.level ?? null, entry.text ?? null, JSON.stringify(entry));
      }

      const navigationInsert = db.prepare(`
        INSERT INTO navigation_events (bundle_id, event_id, sequence, timestamp, url, title, event_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const [sequence, page] of (bundle.har.log?.pages ?? []).entries()) {
        const metadata = page?._browserListener ?? {};
        const eventId = typeof page?.id === "string" ? page.id : `navigation-${sequence}`;
        const timestamp = typeof page?.startedDateTime === "string" ? Date.parse(page.startedDateTime) : null;
        navigationInsert.run(bundleId, eventId, sequence, Number.isFinite(timestamp) ? timestamp : null, metadata.url ?? null, page?.title ?? null, JSON.stringify(page));
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return { status: "imported", bundleId, sourceSha256 };
  } finally {
    db.close();
  }
}

function argValue(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const archivePath = args.find((arg) => !arg.startsWith("--"));
  const dbPath = argValue(args, "--db");
  const json = args.includes("--json");
  const list = args.includes("--list");
  if (!dbPath || (!archivePath && !list)) {
    console.error("Usage: npm run ingest -- <bundle.zip> --db <sessions.db> [--json]");
    console.error("       npm run ingest -- --list --db <sessions.db> [--json]");
    process.exitCode = 2;
  } else {
    try {
      const result = list ? listImportedBundles(resolve(dbPath)) : ingestBundle({ archivePath, dbPath });
      if (json) console.log(JSON.stringify(result, null, 2));
      else if (list) for (const row of result) console.log(`${row.bundleId}\t${row.sourceSha256}\t${row.partial ? "partial" : "complete"}`);
      else console.log(`${result.status}: ${result.bundleId}`);
    } catch (error) {
      console.error(`Could not ingest bundle: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  }
}
