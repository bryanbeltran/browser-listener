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

export const INGEST_SCHEMA_VERSION = 2;

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
    CREATE INDEX IF NOT EXISTS network_events_url_idx ON network_events (url);
    CREATE INDEX IF NOT EXISTS network_events_status_idx ON network_events (status);
    CREATE INDEX IF NOT EXISTS console_events_level_idx ON console_events (level);
    CREATE INDEX IF NOT EXISTS navigation_events_url_idx ON navigation_events (url);
  `);
  if (version < INGEST_SCHEMA_VERSION) db.exec(`PRAGMA user_version = ${INGEST_SCHEMA_VERSION}`);
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

export async function ingestBundle({ archivePath, dbPath }) {
  const archiveBytes = readFileSync(resolve(archivePath));
  const sourceSha256 = sha256(archiveBytes);
  const bundle = sdk.readBundle(archiveBytes);
  const validation = sdk.validateBundle(bundle);
  const checksumValidation = await sdk.verifyChecksums(bundle);
  const errors = [...validation.issues, ...checksumValidation.issues].filter((issue) => issue.severity === "error");
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

const QUERY_DEFINITIONS = {
  bundles: {
    table: "bundles",
    timeColumn: "imported_at",
    fields: {
      bundleId: "bundle_id AS bundleId",
      sourceSha256: "source_sha256 AS sourceSha256",
      sourcePath: "source_path AS sourcePath",
      importedAt: "imported_at AS importedAt",
      exportedAt: "exported_at AS exportedAt",
      manifestSchemaVersion: "manifest_schema_version AS manifestSchemaVersion",
      coverageSchemaVersion: "coverage_schema_version AS coverageSchemaVersion",
      redactionEnabled: "redaction_enabled AS redactionEnabled",
      partial: "partial",
    },
    defaults: ["bundleId", "sourceSha256", "importedAt", "exportedAt", "coverageSchemaVersion", "redactionEnabled", "partial"],
  },
  network: {
    table: "network_events",
    timeColumn: "started_at",
    urlColumn: "url",
    statusColumn: "status",
    methodColumn: "method",
    typeColumn: "type",
    fields: {
      bundleId: "bundle_id AS bundleId",
      eventId: "event_id AS eventId",
      requestId: "request_id AS requestId",
      sequence: "sequence",
      startedAt: "started_at AS startedAt",
      url: "url",
      method: "method",
      type: "type",
      status: "status",
      durationMs: "duration_ms AS durationMs",
      bodyCaptured: "body_captured AS bodyCaptured",
      schemaVersion: "(SELECT coverage_schema_version FROM bundles WHERE bundles.bundle_id = network_events.bundle_id) AS schemaVersion",
    },
    defaults: ["bundleId", "eventId", "sequence", "startedAt", "url", "method", "type", "status", "durationMs", "bodyCaptured"],
    citationArtifact: "raw.har",
  },
  console: {
    table: "console_events",
    timeColumn: "timestamp",
    textColumn: "text",
    levelColumn: "level",
    fields: {
      bundleId: "bundle_id AS bundleId",
      eventId: "event_id AS eventId",
      sequence: "sequence",
      timestamp: "timestamp",
      level: "level",
      text: "text",
      schemaVersion: "(SELECT coverage_schema_version FROM bundles WHERE bundles.bundle_id = console_events.bundle_id) AS schemaVersion",
    },
    defaults: ["bundleId", "eventId", "sequence", "timestamp", "level", "text"],
    citationArtifact: "raw-console.json",
  },
  navigation: {
    table: "navigation_events",
    timeColumn: "timestamp",
    urlColumn: "url",
    fields: {
      bundleId: "bundle_id AS bundleId",
      eventId: "event_id AS eventId",
      sequence: "sequence",
      timestamp: "timestamp",
      url: "url",
      title: "title",
      schemaVersion: "(SELECT coverage_schema_version FROM bundles WHERE bundles.bundle_id = navigation_events.bundle_id) AS schemaVersion",
    },
    defaults: ["bundleId", "eventId", "sequence", "timestamp", "url", "title"],
    citationArtifact: "raw.har",
  },
};

function parseQuery(query) {
  if (typeof query === "string") {
    try {
      return JSON.parse(query);
    } catch (error) {
      throw new Error(`Invalid query JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return query ?? {};
}

function asBoundedInteger(value, fallback, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

function queryTimeValue(value, numeric) {
  if (numeric) {
    const parsed = typeof value === "number" ? value : Date.parse(String(value));
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === "number") return new Date(value).toISOString();
  return typeof value === "string" && value ? value : null;
}

function addInFilter(clauses, params, column, values) {
  if (!column) return;
  const list = Array.isArray(values) ? values.filter((value) => typeof value === "string" && value) : [];
  if (!list.length) return;
  clauses.push(`${column} IN (${list.map(() => "?").join(", ")})`);
  params.push(...list);
}

function queryRows({ dbPath, query }) {
  const request = parseQuery(query);
  if (!request || typeof request !== "object" || Array.isArray(request)) throw new Error("Query must be a JSON object");
  const entity = request.entity ?? request.kind ?? "network";
  const definition = QUERY_DEFINITIONS[entity];
  if (!definition) throw new Error(`Unsupported query entity: ${entity}`);
  const filters = request.filters && typeof request.filters === "object" ? request.filters : {};
  const selected = Array.isArray(request.select) ? request.select : definition.defaults;
  const fields = [...new Set(["bundleId", ...(definition.citationArtifact ? ["schemaVersion"] : []), ...(selected.filter((field) => definition.fields[field]))])];
  const projection = fields.map((field) => definition.fields[field]).join(", ");
  const clauses = [];
  const params = [];
  const bundleId = filters.bundleId ?? filters.sessionId;
  if (typeof bundleId === "string" && bundleId) {
    clauses.push("bundle_id = ?");
    params.push(bundleId);
  }
  if (filters.redactionEnabled != null && entity === "bundles") {
    clauses.push("redaction_enabled = ?");
    params.push(filters.redactionEnabled === true ? 1 : 0);
  }
  if (definition.urlColumn && typeof filters.urlIncludes === "string" && filters.urlIncludes) {
    clauses.push(`${definition.urlColumn} LIKE ?`);
    params.push(`%${filters.urlIncludes}%`);
  }
  if (definition.textColumn && typeof filters.textIncludes === "string" && filters.textIncludes) {
    clauses.push(`${definition.textColumn} LIKE ?`);
    params.push(`%${filters.textIncludes}%`);
  }
  if (definition.levelColumn && typeof filters.level === "string" && filters.level) {
    clauses.push(`${definition.levelColumn} = ?`);
    params.push(filters.level);
  }
  addInFilter(clauses, params, definition.levelColumn, filters.levels);
  addInFilter(clauses, params, definition.methodColumn, filters.methods);
  addInFilter(clauses, params, definition.typeColumn, filters.types);
  if (definition.statusColumn && filters.statusMin != null) {
    clauses.push(`${definition.statusColumn} >= ?`);
    params.push(Number(filters.statusMin));
  }
  if (definition.statusColumn && filters.statusMax != null) {
    clauses.push(`${definition.statusColumn} <= ?`);
    params.push(Number(filters.statusMax));
  }
  const numericTime = entity === "console" || entity === "navigation" || entity === "bundles";
  const from = queryTimeValue(filters.from, numericTime);
  const to = queryTimeValue(filters.to, numericTime);
  if (from != null) {
    clauses.push(`${definition.timeColumn} >= ?`);
    params.push(from);
  }
  if (to != null) {
    clauses.push(`${definition.timeColumn} <= ?`);
    params.push(to);
  }
  const limit = asBoundedInteger(request.limit, 100, 1_000);
  const maxBytes = asBoundedInteger(request.maxBytes, 1_000_000, 10_000_000);
  const sql = `SELECT ${projection} FROM ${definition.table}${clauses.length ? ` WHERE ${clauses.join(" AND ")}` : ""} ORDER BY ${definition.timeColumn}, bundle_id, rowid LIMIT ?`;
  const db = new DatabaseSync(resolve(dbPath));
  try {
    ensureSchema(db);
    const rawRows = db.prepare(sql).all(...params, limit + 1);
    const rows = rawRows.slice(0, limit).map((row) => {
      const result = { ...row };
      if (definition.citationArtifact && result.eventId) {
        const schemaVersion = result.schemaVersion ?? 0;
        result.citation = `browser-listener://${encodeURIComponent(result.bundleId)}/${encodeURIComponent(definition.citationArtifact)}/${encodeURIComponent(result.eventId)}?schema=${schemaVersion}`;
        delete result.schemaVersion;
      }
      return result;
    });
    let truncated = rawRows.length > limit;
    while (rows.length && JSON.stringify(rows).length > maxBytes) {
      rows.pop();
      truncated = true;
    }
    return { entity, rows, truncated, bytes: JSON.stringify(rows).length };
  } finally {
    db.close();
  }
}

export function queryIngested({ dbPath, query }) {
  return queryRows({ dbPath, query });
}

export function deleteBundle({ dbPath, bundleId }) {
  if (typeof bundleId !== "string" || !bundleId) throw new Error("A bundle ID is required");
  const db = new DatabaseSync(resolve(dbPath));
  try {
    ensureSchema(db);
    db.exec("BEGIN IMMEDIATE");
    try {
      const existing = db.prepare("SELECT bundle_id AS bundleId FROM bundles WHERE bundle_id = ?").get(bundleId);
      if (!existing) {
        db.exec("ROLLBACK");
        return { status: "not-found", bundleId };
      }
      db.prepare("DELETE FROM bundles WHERE bundle_id = ?").run(bundleId);
      db.exec("COMMIT");
      return { status: "deleted", bundleId };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } finally {
    db.close();
  }
}

export async function ingestBundles({ archivePaths, dbPath }) {
  const results = [];
  for (const archivePath of archivePaths) {
    results.push(await ingestBundle({ archivePath, dbPath }));
  }
  return results;
}

function argValue(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const dbPath = argValue(args, "--db");
  const json = args.includes("--json");
  const list = args.includes("--list");
  const query = argValue(args, "--query");
  const deleteId = argValue(args, "--delete");
  const valueFlags = new Set(["--db", "--query", "--delete"]);
  const archivePaths = args.filter((arg, index) => {
    if (arg.startsWith("--")) return false;
    const previous = args[index - 1];
    return !valueFlags.has(previous);
  });
  if (!dbPath || (!archivePaths.length && !list && !query && !deleteId)) {
    console.error("Usage: npm run ingest -- <bundle.zip> [<bundle2.zip> ...] --db <sessions.db> [--json]");
    console.error("       npm run ingest -- --list --db <sessions.db> [--json]");
    console.error("       npm run ingest -- --query '<json>' --db <sessions.db> [--json]");
    console.error("       npm run ingest -- --delete <bundle-id> --db <sessions.db> [--json]");
    process.exitCode = 2;
  } else {
    try {
      const result = list
        ? listImportedBundles(resolve(dbPath))
        : query
          ? queryIngested({ dbPath, query })
          : deleteId
            ? deleteBundle({ dbPath, bundleId: deleteId })
            : await ingestBundles({ archivePaths, dbPath });
      if (json) console.log(JSON.stringify(result, null, 2));
      else if (list) for (const row of result) console.log(`${row.bundleId}\t${row.sourceSha256}\t${row.partial ? "partial" : "complete"}`);
      else if (query) for (const row of result.rows) console.log(JSON.stringify(row));
      else if (Array.isArray(result)) for (const row of result) console.log(`${row.status}: ${row.bundleId}`);
      else console.log(`${result.status}: ${result.bundleId}`);
    } catch (error) {
      console.error(`Could not ingest bundle: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  }
}
