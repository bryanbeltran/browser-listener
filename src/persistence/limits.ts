import type { NetworkEntry, StorageTruncation } from "../shared/types.js";

/** Mutable limits — patch in tests (e.g. `NETWORK_STORE_LIMITS.entrySoftCap = 5`). */
export const NETWORK_STORE_LIMITS = {
  byteBudget: 128 * 1024 * 1024,
  entrySoftCap: 100_000,
};

export const NETWORK_BYTE_BUDGET = NETWORK_STORE_LIMITS.byteBudget;
export const NETWORK_ENTRY_SOFT_CAP = NETWORK_STORE_LIMITS.entrySoftCap;

/** Small, bounded evidence streams kept in chrome.storage.local. */
export const AUXILIARY_STORAGE_LIMITS = {
  navigationEntries: 2_000,
  consoleEntries: 5_000,
  markerEntries: 500,
  contextSnapshots: 200,
  performanceSignals: 200,
  screenshots: 12,
  screenshotBytes: 8 * 1024 * 1024,
} as const;

/** Body capture is opt-in and bounded independently from metadata storage. */
export const BODY_CAPTURE_LIMITS = {
  perResponseBytes: 256 * 1024,
  sessionBytes: 4 * 1024 * 1024,
} as const;

/** @deprecated Use NETWORK_ENTRY_SOFT_CAP — kept for tests that mock limits. */
export const STORAGE_LIMITS = {
  network: NETWORK_ENTRY_SOFT_CAP,
} as const;

export function emptyTruncation(): StorageTruncation {
  return {
    network: 0,
    navigation: 0,
    console: 0,
    markers: 0,
    contextSnapshots: 0,
    performanceSignals: 0,
    screenshots: 0,
  };
}

export function estimateNetworkEntryBytes(entry: NetworkEntry): number {
  let bytes = 256;
  bytes += entry.url.length;
  if (entry.requestBody) bytes += entry.requestBody.length;
  if (entry.responseBody) bytes += entry.responseBody.length;
  return bytes;
}

export function totalNetworkBytes(entries: readonly NetworkEntry[]): number {
  let total = 0;
  for (const entry of entries) total += estimateNetworkEntryBytes(entry);
  return total;
}

export function hasTruncation(t: StorageTruncation): boolean {
  return t.network > 0 || t.navigation > 0 || t.console > 0 || (t.markers ?? 0) > 0 ||
    (t.contextSnapshots ?? 0) > 0 || (t.performanceSignals ?? 0) > 0 || (t.screenshots ?? 0) > 0;
}

/** Ring-buffer helper (used in unit tests; production uses IndexedDB eviction). */
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
    truncation[bucket] = (truncation[bucket] ?? 0) + 1;
  }
}
