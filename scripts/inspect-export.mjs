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
    const coverage = readJson("coverage-report.json");
    if (!manifest) throw new Error("export-manifest.json is missing");

    const summary = {
      archive: resolve(input),
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
      console.log("Entities:");
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
