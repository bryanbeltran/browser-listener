import type { StorageTruncation } from "../shared/types.js";

export const STORAGE_LIMITS = {
  network: 10_000,
} as const;

export function emptyTruncation(): StorageTruncation {
  return { network: 0 };
}

export function pushWithCap<T>(
  arr: T[],
  item: T,
  limit: number,
  truncation: StorageTruncation,
  bucket: keyof StorageTruncation,
): void {
  arr.push(item);
  if (arr.length > limit) {
    arr.shift();
    truncation[bucket] += 1;
  }
}

export function hasTruncation(t: StorageTruncation): boolean {
  return t.network > 0;
}
