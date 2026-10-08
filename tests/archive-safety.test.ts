import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { readBundle } from "../sdk/src/index.js";
import { buildZipFromSessionData } from "../src/export/orchestrator.js";
import { sampleExportSessionData } from "./fixtures/sample-session.js";

describe("archive safety corpus", () => {
  it("rejects malformed bytes without attempting to interpret captured content", () => {
    let state = 0x12345678;
    for (let iteration = 0; iteration < 64; iteration += 1) {
      const bytes = new Uint8Array(32);
      for (let index = 0; index < bytes.length; index += 1) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        bytes[index] = state & 0xff;
      }
      expect(() => readBundle(bytes)).toThrow();
    }
  });

  it("rejects expansion bombs and invalid UTF-8 before JSON parsing", async () => {
    const bomb = zipSync({ "bomb.txt": new Uint8Array(1_000_000).fill(65) }, { level: 9 });
    expect(() => readBundle(bomb)).toThrow(/expansion ratio|expanded byte|too many entries|Missing required/);

    const valid = await buildZipFromSessionData(sampleExportSessionData(), 1_700_000_000_000);
    const bundle = readBundle(valid);
    const files = Object.fromEntries(Object.entries(bundle.files));
    files["raw-console.json"] = new Uint8Array([0xc3, 0x28]);
    expect(() => readBundle(zipSync(files))).toThrow("Invalid UTF-8 in raw-console.json");
  });
});
