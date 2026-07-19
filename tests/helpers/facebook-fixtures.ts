import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { NetworkEntry } from "../../src/shared/types.js";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/facebook-captures");

export interface FacebookCaptureFixture {
  description: string;
  tabUrl: string;
  network: NetworkEntry[];
}

export const FACEBOOK_FIXTURE_NAMES = [
  "comments-dialog",
  "reactions-dialog",
  "permalink",
  "feed",
] as const;

export type FacebookFixtureName = (typeof FACEBOOK_FIXTURE_NAMES)[number];

export function loadFacebookFixture(name: FacebookFixtureName): FacebookCaptureFixture {
  const raw = readFileSync(join(FIXTURE_DIR, `${name}.json`), "utf8");
  return JSON.parse(raw) as FacebookCaptureFixture;
}
