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

if (!input) {
  usage();
  process.exitCode = 1;
} else {
  try {
    const archive = unzipSync(new Uint8Array(readFileSync(resolve(input))));
    const files = Object.keys(archive).sort();
    const readJson = (path) => {
      const bytes = archive[path];
      if (!bytes) return undefined;
      return JSON.parse(strFromU8(bytes));
    };
    const manifest = readJson("export-manifest.json");
    if (!manifest) throw new Error("export-manifest.json is missing");
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
    if (isCurrent) {
      const har = readJson("raw.har");
      const rawConsole = readJson("raw-console.json");
      if (har?.log?.version !== "1.2" || !Array.isArray(har.log.entries)) {
        throw new Error("raw.har is not a HAR 1.2 document");
      }
      if (!Array.isArray(rawConsole)) throw new Error("raw-console.json is not an array");
    }
    const coverage = manifest.coverage ?? readJson("coverage-report.json");

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
      console.log(`Files (${files.length}):`);
      for (const file of files) console.log(`  ${file}`);
    }
  } catch (error) {
    console.error(`Could not inspect export: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
