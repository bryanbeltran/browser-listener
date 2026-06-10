#!/usr/bin/env node
/**
 * Bump patch version in package.json + manifest.json.
 * dist/ is rebuilt by the post-commit hook (not here).
 * Skip: SKIP_VERSION_BUMP=1 git commit ...
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

if (process.env.SKIP_VERSION_BUMP === "1") {
  console.log("bump-and-build: skipped (SKIP_VERSION_BUMP=1)");
  process.exit(0);
}

const pkgPath = "package.json";
const manifestPath = "manifest.json";

const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const parts = String(pkg.version).split(".").map((n) => parseInt(n, 10));
if (parts.length !== 3 || parts.some(Number.isNaN)) {
  console.error("bump-and-build: expected semver MAJOR.MINOR.PATCH in package.json");
  process.exit(1);
}
parts[2] += 1;
const next = parts.join(".");
pkg.version = next;
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
manifest.version = next;
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`bump-and-build: version → ${next}`);

if (process.argv.includes("--stage")) {
  execSync("git add package.json manifest.json", { stdio: "inherit" });
}
