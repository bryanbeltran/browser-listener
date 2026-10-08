#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { strFromU8, unzipSync } from "fflate";

function usage() {
  console.error("Usage: npm run inspect -- <export.zip> [--json]");
}

const args = process.argv.slice(2);
const jsonOutput = args.includes("--json");
const input = args.find((arg) => !arg.startsWith("--"));

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values.filter(Boolean)) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

function assertSafeArchivePaths(files) {
  const unsafe = files.filter((file) => {
    const normalized = file.replaceAll(/\\/g, "/");
    return normalized.startsWith("/") || normalized.split("/").includes("..") || normalized.includes("\0");
  });
  if (unsafe.length) throw new Error(`Unsafe archive path(s): ${unsafe.join(", ")}`);
}

function assertCoverage(coverage) {
  if (!coverage || typeof coverage !== "object") throw new Error("Coverage report is missing");
  if (![1, 2, 3].includes(coverage.schemaVersion)) {
    throw new Error(`Unsupported coverage schema version: ${coverage.schemaVersion ?? "missing"}`);
  }
  if (!coverage.totals || typeof coverage.totals !== "object") throw new Error("Coverage totals are missing");
  if (!coverage.quality || typeof coverage.quality !== "object") throw new Error("Coverage quality is missing");
  if (coverage.schemaVersion >= 2) {
    if (typeof coverage.quality.partial !== "boolean") throw new Error("Coverage partial flag is missing");
    if (!Array.isArray(coverage.quality.gapReasons)) throw new Error("Coverage gap reasons are missing");
    if (typeof coverage.totals.markers !== "number") throw new Error("Coverage marker total is missing");
  }
  if (coverage.schemaVersion >= 3) {
    if (!coverage.capture || typeof coverage.capture.paused !== "boolean") {
      throw new Error("Coverage capture state is missing");
    }
    if (!Array.isArray(coverage.capture.pauseIntervals)) {
      throw new Error("Coverage pause intervals are missing");
    }
    if (!coverage.policy || typeof coverage.policy !== "object") {
      throw new Error("Coverage capture policy is missing");
    }
    if (!["metadata", "network-console", "safe-bodies"].includes(coverage.policy.profile)) {
      throw new Error("Coverage capture profile is missing or unsupported");
    }
    for (const key of ["redactionEnabled", "captureBodies", "captureConsole"]) {
      if (typeof coverage.policy[key] !== "boolean") {
        throw new Error(`Coverage policy field is missing: ${key}`);
      }
    }
    if (!Array.isArray(coverage.policy.allowedOrigins)) {
      throw new Error("Coverage origin policy is missing");
    }
  }
}

function validateCurrentExport(archive, manifest, readJson, warnings) {
  const required = ["report.html", "raw.har", "raw-console.json", "export-manifest.json"];
  const missing = required.filter((path) => !archive[path]);
  if (missing.length) throw new Error(`Required artifact(s) missing: ${missing.join(", ")}`);

  if (manifest.format !== "browser-listener") throw new Error("Unsupported export format");
  if (![2, 3].includes(manifest.schemaVersion)) {
    throw new Error(`Unsupported export schema version: ${manifest.schemaVersion ?? "missing"}`);
  }
  if (manifest.schemaVersion < 3) warnings.push(`Legacy current export schema v${manifest.schemaVersion}`);
  if (!Array.isArray(manifest.files)) throw new Error("Manifest artifact list is missing");
  const manifestPaths = manifest.files.map((file) => file?.path);
  if (new Set(manifestPaths).size !== manifestPaths.length) throw new Error("Manifest contains duplicate artifact paths");
  for (const path of required) {
    if (!manifestPaths.includes(path)) throw new Error(`Manifest does not list required artifact: ${path}`);
  }

  const har = readJson("raw.har");
  const rawConsole = readJson("raw-console.json");
  if (har?.log?.version !== "1.2" || !Array.isArray(har.log.entries)) {
    throw new Error("raw.har is not a HAR 1.2 document");
  }
  if (!Array.isArray(rawConsole)) throw new Error("raw-console.json is not an array");
  const harIds = duplicateValues(har.log.entries.map((entry) => entry?._browserListener?.id));
  if (harIds.length) throw new Error(`Duplicate HAR event id(s): ${harIds.join(", ")}`);
  const consoleIds = duplicateValues(rawConsole.map((entry) => entry?.id));
  if (consoleIds.length) throw new Error(`Duplicate console event id(s): ${consoleIds.join(", ")}`);

  assertCoverage(manifest.coverage);
  if (!manifest.privacy || typeof manifest.privacy.redactionEnabled !== "boolean") {
    throw new Error("Manifest privacy receipt is missing redaction state");
  }
  if (manifest.privacy.redactionEnabled === false) {
    warnings.push("Redaction is disabled; this export may contain secrets");
  }
  return { format: "raw-har", coverage: manifest.coverage, har, rawConsole };
}

if (!input) {
  usage();
  process.exitCode = 1;
} else {
  try {
    const archive = unzipSync(new Uint8Array(readFileSync(resolve(input))));
    const files = Object.keys(archive).sort();
    assertSafeArchivePaths(files);
    const expandedBytes = files.reduce((total, path) => total + archive[path].byteLength, 0);
    const sourceBytes = readFileSync(resolve(input)).byteLength;
    if (expandedBytes > 256 * 1024 * 1024) throw new Error("Expanded archive exceeds 256 MiB safety limit");
    if (sourceBytes > 0 && expandedBytes / sourceBytes > 200) throw new Error("Archive expansion ratio exceeds safety limit");
    const readJson = (path) => {
      const bytes = archive[path];
      if (!bytes) return undefined;
      try {
        return JSON.parse(strFromU8(bytes));
      } catch (error) {
        throw new Error(`Invalid JSON in ${path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    };
    const manifest = readJson("export-manifest.json");
    if (!manifest) throw new Error("export-manifest.json is missing");
    const warnings = [];
    const currentRequired = [
      "report.html",
      "raw.har",
      "raw-console.json",
      "export-manifest.json",
    ];
    const legacyRequired = [
      "report.html",
      "session.json",
      "network.json",
      "console.json",
      "coverage-report.json",
      "export-manifest.json",
    ];
    const isCurrent = currentRequired.every((path) => archive[path]);
    const isLegacy = legacyRequired.every((path) => archive[path]);
    if (!isCurrent && !isLegacy) {
      const missing = currentRequired.filter((path) => !archive[path]);
      throw new Error(`Required artifact(s) missing: ${missing.join(", ")}`);
    }
    const current = isCurrent ? validateCurrentExport(archive, manifest, readJson, warnings) : null;
    if (isLegacy) warnings.push("Legacy six-file export; upgrade before relying on current schema guarantees");
    const coverage = current?.coverage ?? manifest.coverage ?? readJson("coverage-report.json");
    if (coverage) assertCoverage(coverage);

    const summary = {
      archive: resolve(input),
      format: isCurrent ? "raw-har" : "legacy-six-file",
      sessionId: manifest.sessionId,
      extensionVersion: manifest.extensionVersion,
      exportedAt: manifest.exportedAt,
      source: coverage?.source ?? {},
      totals: coverage?.totals ?? {},
      quality: coverage?.quality ?? {},
      files,
      valid: true,
      warnings,
    };

    if (jsonOutput) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      console.log("Browser Listener export");
      console.log(`Archive: ${summary.archive}`);
      console.log(`Session: ${summary.sessionId ?? "unknown"}`);
      console.log(`Version: ${summary.extensionVersion ?? "unknown"}`);
      if (summary.source.tabUrl) console.log(`Source: ${summary.source.tabUrl}`);
      if (summary.source.startedAt) {
        const end = summary.source.stoppedAt
          ? ` → ${new Date(summary.source.stoppedAt).toISOString()}`
          : "";
        console.log(`Captured: ${new Date(summary.source.startedAt).toISOString()}${end}`);
      }
      console.log("Evidence:");
      for (const [name, count] of Object.entries(summary.totals)) {
        console.log(`  ${name}: ${count}`);
      }
      const warnings = Object.entries(summary.quality).filter(([, count]) => count > 0);
      if (warnings.length) {
        console.log("Quality warnings:");
        for (const [name, count] of warnings) console.log(`  ${name}: ${count}`);
      } else {
        console.log("Quality warnings: none");
      }
      if (summary.warnings.length) {
        console.log("Inspector warnings:");
        for (const warning of summary.warnings) console.log(`  ${warning}`);
      }
      console.log(`Files (${files.length}):`);
      for (const file of files) console.log(`  ${file}`);
    }
  } catch (error) {
    console.error(`Could not inspect export: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
