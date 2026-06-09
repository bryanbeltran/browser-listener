import type { StorageTruncation } from "../shared/types.js";

/** Max persisted entries per array; oldest dropped first. */
export const STORAGE_LIMITS = {
  console: 5_000,
  network: 5_000,
  timeline: 10_000,
  userActions: 2_000,
} as const;

export type TruncationBucket = keyof typeof STORAGE_LIMITS;

export function emptyTruncation(): StorageTruncation {
  return { console: 0, network: 0, timeline: 0, userActions: 0 };
}

export function pushWithCap<T>(
  arr: T[],
  item: T,
  max: number,
  truncation: StorageTruncation,
  bucket: TruncationBucket,
): void {
  arr.push(item);
  while (arr.length > max) {
    arr.shift();
    truncation[bucket]++;
  }
}

export function hasTruncation(t: StorageTruncation): boolean {
  return t.console > 0 || t.network > 0 || t.timeline > 0 || t.userActions > 0;
}
