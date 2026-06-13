import { describe, expect, it } from "vitest";
import { emptyTruncation, pushWithCap, STORAGE_LIMITS } from "../src/persistence/limits.js";

describe("storage limits", () => {
  it("drops oldest entries when cap exceeded", () => {
    const arr: number[] = [];
    const truncation = emptyTruncation();
    const max = 3;
    for (let i = 0; i < 5; i++) pushWithCap(arr, i, max, truncation, "network");
    expect(arr).toEqual([2, 3, 4]);
    expect(truncation.network).toBe(2);
  });

  it("defines network storage limit", () => {
    expect(STORAGE_LIMITS.network).toBeGreaterThan(1000);
  });
});
