#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = resolve(fileURLToPath(new URL(".", import.meta.url)));
const SDK_PATH = resolve(SCRIPT_DIR, "../sdk/dist/index.js");
const sdk = await import(pathToFileURL(SDK_PATH));
const args = process.argv.slice(2);
const jsonOutput = args.includes("--json");
const input = args.find((arg) => !arg.startsWith("--"));

function valueAfter(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

if (!input) {
  console.error("Usage: npm run inspect -- <export.zip> [--json] [--network] [--console]");
  process.exitCode = 2;
} else {
  try {
    const bundle = sdk.readBundle(readFileSync(resolve(input)));
    const validation = sdk.validateBundle(bundle);
    const checksums = await sdk.verifyChecksums(bundle);
    const summary = sdk.summarize(bundle);
    const network = args.includes("--network")
      ? sdk.filterNetwork(bundle, {
          urlIncludes: valueAfter("--url"),
          statusMin: valueAfter("--status-min") == null ? undefined : Number(valueAfter("--status-min")),
          statusMax: valueAfter("--status-max") == null ? undefined : Number(valueAfter("--status-max")),
        })
      : undefined;
    const consoleRecords = args.includes("--console")
      ? sdk.filterConsole(bundle, {
          levels: valueAfter("--level") ? [valueAfter("--level")] : undefined,
          textIncludes: valueAfter("--text"),
        })
      : undefined;
    const issues = [...validation.issues, ...checksums.issues];
    const result = {
      archive: resolve(input),
      ...summary,
      valid: issues.every((issue) => issue.severity !== "error"),
      warnings: issues.filter((issue) => issue.severity === "warning"),
      issues: issues.filter((issue) => issue.severity === "error"),
      ...(network ? { networkRecords: network } : {}),
      ...(consoleRecords ? { consoleRecords } : {}),
    };
    if (jsonOutput) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log("Browser Listener evidence bundle");
      console.log(`Archive: ${result.archive}`);
      console.log(`Session: ${result.sessionId}`);
      console.log(`Redaction: ${result.redactionEnabled === false ? "disabled — treat as sensitive" : "enabled"}`);
      console.log(`Evidence: ${result.network} network · ${result.console} console · ${result.navigation} navigation · ${result.markers} markers`);
      console.log(`Completeness: ${result.partial ? "partial" : "no recorded gaps"}`);
      for (const warning of result.warnings) console.log(`Warning: ${warning.message}`);
      for (const error of result.issues) console.log(`Error: ${error.message}`);
      if (network) for (const entry of network) console.log(`Network: ${entry.request?.method ?? "?"} ${entry.request?.url ?? "?"} → ${entry.response?.status ?? "?"}`);
      if (consoleRecords) for (const entry of consoleRecords) console.log(`Console: ${entry.level ?? "?"} ${entry.text ?? ""}`);
    }
    if (!result.valid) process.exitCode = 1;
  } catch (error) {
    console.error(`Could not inspect bundle: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
