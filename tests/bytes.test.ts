import { describe, expect, it } from "vitest";
import { base64ToUint8, uint8ToBase64 } from "../src/shared/bytes.js";

describe("bytes", () => {
  it("round-trips zip bytes through base64", () => {
    const original = new Uint8Array([0, 1, 2, 255, 80, 75, 3, 4]);
    const encoded = uint8ToBase64(original);
    const decoded = base64ToUint8(encoded);
    expect(Array.from(decoded)).toEqual(Array.from(original));
  });
});
