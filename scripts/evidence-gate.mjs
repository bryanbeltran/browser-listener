#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = resolve(fileURLToPath(new URL(".", import.meta.url)));
const SDK_PATH = resolve(SCRIPT_DIR, "../sdk/dist/index.js");
let sdk;
try {
  sdk = await import(pathToFileURL(SDK_PATH));
} catch (error) {
  throw new Error(`Bundle SDK is not built; run npm run build:sdk first (${error instanceof Error ? error.message : String(error)})`);
}

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function numberAfter(args, flag, fallback) {
  const value = Number(valueAfter(args, flag));
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function issue(path, code, message) {
  return { path, code, message, severity: "error" };
}

const args = process.argv.slice(2);
const jsonOutput = args.includes("--json");
const requireRedaction = args.includes("--require-redaction");
const failOnPartial = args.includes("--fail-on-partial");
const archivePath = args.find((arg) => !arg.startsWith("--"));
const resultBase = { command: "evidence-gate", archive: archivePath ? resolve(archivePath) : undefined };

if (!archivePath) {
  const result = { ...resultBase, valid: false, issues: [issue("arguments", "usage", "Usage: npm run evidence:gate -- <bundle.zip> [--json] [--require-redaction] [--fail-on-partial] [--min-network N] [--min-console N] [--min-navigation N]")] };
  if (jsonOutput) console.log(JSON.stringify(result, null, 2));
  else console.error(result.issues[0].message);
  process.exitCode = 2;
} else {
  try {
    const bundle = sdk.readBundle(readFileSync(resolve(archivePath)));
    const structural = sdk.validateBundle(bundle);
    const checksum = await sdk.verifyChecksums(bundle);
    const issues = [...structural.issues, ...checksum.issues];
    const coverage = bundle.manifest.coverage;
    if (requireRedaction && bundle.manifest.privacy?.redactionEnabled !== true) {
      issues.push(issue("export-manifest.json.privacy.redactionEnabled", "redaction-required", "Redaction is disabled but this gate requires redaction"));
    }
    if (failOnPartial && coverage?.quality?.partial === true) {
      issues.push(issue("export-manifest.json.coverage.quality.partial", "partial-capture", "Coverage is marked partial"));
    }
    const minimums = [
      ["network", numberAfter(args, "--min-network", 0)],
      ["console", numberAfter(args, "--min-console", 0)],
      ["navigation", numberAfter(args, "--min-navigation", 0)],
    ];
    for (const [name, minimum] of minimums) {
      const actual = Number(coverage?.totals?.[name] ?? 0);
      if (actual < minimum) issues.push(issue(`export-manifest.json.coverage.totals.${name}`, "coverage-threshold", `${name} total ${actual} is below required minimum ${minimum}`));
    }
    const result = {
      ...resultBase,
      valid: issues.every((item) => item.severity !== "error"),
      sessionId: bundle.manifest.sessionId,
      redactionEnabled: bundle.manifest.privacy?.redactionEnabled,
      totals: coverage?.totals ?? {},
      partial: coverage?.quality?.partial === true,
      warnings: issues.filter((item) => item.severity === "warning"),
      issues: issues.filter((item) => item.severity === "error"),
    };
    if (jsonOutput) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`${result.valid ? "PASS" : "FAIL"}: ${result.sessionId ?? "unknown session"}`);
      for (const warning of result.warnings) console.log(`warning ${warning.code}: ${warning.message}`);
      for (const failure of result.issues) console.log(`error ${failure.code}: ${failure.message}`);
    }
    if (!result.valid) process.exitCode = 4;
  } catch (error) {
    const result = { ...resultBase, valid: false, issues: [issue("archive", "archive-invalid", error instanceof Error ? error.message : String(error))] };
    if (jsonOutput) console.log(JSON.stringify(result, null, 2));
    else console.error(`FAIL: ${result.issues[0].message}`);
    process.exitCode = 3;
  }
}
