#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = resolve(fileURLToPath(new URL(".", import.meta.url)));
const SDK_PATH = resolve(SCRIPT_DIR, "../sdk/dist/index.js");
const sdk = await import(pathToFileURL(SDK_PATH));
const args = process.argv.slice(2);
const input = args.find((arg) => !arg.startsWith("--"));
const output = args.includes("--output") ? args[args.indexOf("--output") + 1] : undefined;
const force = args.includes("--force");

if (!input || !output) {
  console.error("Usage: npm run repair -- <source.zip> --output <derived.zip> [--force]");
  process.exitCode = 2;
} else {
  const sourcePath = resolve(input);
  const outputPath = resolve(output);
  if (sourcePath === outputPath) {
    console.error("Refusing to overwrite the source archive");
    process.exitCode = 2;
  } else {
    try {
      const repaired = await sdk.repairBundle(readFileSync(sourcePath));
      writeFileSync(outputPath, repaired, force ? undefined : { flag: "wx" });
      console.log(`Repaired archive written to ${outputPath}`);
    } catch (error) {
      console.error(`Could not repair archive: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  }
}
