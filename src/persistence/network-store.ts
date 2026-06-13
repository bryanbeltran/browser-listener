import { NETWORK_STORE_LIMITS, estimateNetworkEntryBytes } from "./limits.js";
import type { NetworkEntry } from "../shared/types.js";

const DB_NAME = "browser-listener";
const DB_VERSION = 1;
const STORE = "network_entries";

export interface UpsertNetworkResult {
  truncated: number;
  isNew: boolean;
  previous: NetworkEntry | null;
  evicted: NetworkEntry[];
}

function idb(): IDBFactory {
  const factory = globalThis.indexedDB;
  if (!factory) {
    throw new Error("IndexedDB is not available");
  }
  return factory;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;
let openDb: IDBDatabase | null = null;

export function resetNetworkStoreCacheForTests(): void {
  if (openDb) {
    openDb.close();
    openDb = null;
  }
  dbPromise = null;
}

export async function deleteNetworkDatabase(): Promise<void> {
  resetNetworkStoreCacheForTests();
  const factory = idb();
  await new Promise<void>((resolve, reject) => {
    const req = factory.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error("deleteDatabase failed"));
    req.onblocked = () => resolve();
  });
}

function openNetworkDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = idb().open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: "requestId" });
          store.createIndex("sessionId", "sessionId", { unique: false });
          store.createIndex("sessionTimestamp", ["sessionId", "timestamp"], { unique: false });
        }
      };
      req.onsuccess = () => {
        openDb = req.result;
        openDb.onclose = () => {
          openDb = null;
          dbPromise = null;
        };
        resolve(req.result);
      };
      req.onerror = () => reject(req.error ?? new Error("open failed"));
    });
  }
  return dbPromise;
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
  const db = await openNetworkDb();
  const tx = db.transaction(STORE, mode);
  const store = tx.objectStore(STORE);
  const result = await fn(store);
  await transactionDone(tx);
  return result;
}

export async function listNetworkEntries(sessionId: string): Promise<NetworkEntry[]> {
  return withStore("readonly", async (store) => {
    const index = store.index("sessionId");
    const entries = await requestToPromise(index.getAll(sessionId));
    return (entries as NetworkEntry[]).sort((a, b) => a.timestamp - b.timestamp);
  });
}

export async function countNetworkEntries(sessionId: string): Promise<number> {
  return withStore("readonly", async (store) => {
    const index = store.index("sessionId");
    return requestToPromise(index.count(sessionId));
  });
}

async function deleteOldestEntry(sessionId: string): Promise<NetworkEntry | null> {
  return withStore("readwrite", async (store) => {
    const index = store.index("sessionTimestamp");
    const cursor = await requestToPromise(
      index.openCursor(IDBKeyRange.bound([sessionId, 0], [sessionId, Number.MAX_SAFE_INTEGER])),
    );
    if (!cursor) return null;
    const entry = cursor.value as NetworkEntry;
    await requestToPromise(cursor.delete());
    return entry;
  });
}

function projectedByteEstimate(
  byteEstimate: number | undefined,
  entries: { entry: NetworkEntry; previous: NetworkEntry | null; isNew: boolean }[],
): number | undefined {
  if (byteEstimate == null) return undefined;
  let bytes = byteEstimate;
  for (const { entry, previous, isNew } of entries) {
    const nextBytes = estimateNetworkEntryBytes(entry);
    if (isNew) bytes += nextBytes;
    else if (previous) bytes += nextBytes - estimateNetworkEntryBytes(previous);
  }
  return bytes;
}

async function enforceSessionLimits(
  sessionId: string,
  byteEstimate?: number,
): Promise<{ truncated: number; evicted: NetworkEntry[] }> {
  const { byteBudget, entrySoftCap } = NETWORK_STORE_LIMITS;
  const evicted: NetworkEntry[] = [];
  let truncated = 0;

  let count = await countNetworkEntries(sessionId);
  let bytes = byteEstimate ?? 0;
  const checkBytes = byteEstimate != null;

  while (count > entrySoftCap || (checkBytes && bytes > byteBudget)) {
    if (count <= entrySoftCap && (!checkBytes || bytes <= byteBudget)) break;
    const deleted = await deleteOldestEntry(sessionId);
    if (!deleted) break;
    evicted.push(deleted);
    truncated += 1;
    count -= 1;
    if (checkBytes) bytes -= estimateNetworkEntryBytes(deleted);
  }

  return { truncated, evicted };
}

export async function putNetworkEntries(
  sessionId: string,
  entries: NetworkEntry[],
  byteEstimate?: number,
): Promise<UpsertNetworkResult> {
  if (!entries.length) {
    return { truncated: 0, isNew: false, previous: null, evicted: [] };
  }
  let isNew = false;
  let previous: NetworkEntry | null = null;
  const writes: { entry: NetworkEntry; previous: NetworkEntry | null; isNew: boolean }[] = [];
  await withStore("readwrite", async (store) => {
    for (const entry of entries) {
      const existing = (await requestToPromise(store.get(entry.requestId))) as NetworkEntry | undefined;
      const entryIsNew = !existing;
      if (entryIsNew) isNew = true;
      else if (!previous) previous = existing;
      writes.push({ entry, previous: existing ?? null, isNew: entryIsNew });
      await requestToPromise(store.put({ ...entry, sessionId }));
    }
  });
  const { truncated, evicted } = await enforceSessionLimits(
    sessionId,
    projectedByteEstimate(byteEstimate, writes),
  );
  return { truncated, isNew, previous, evicted };
}

export async function upsertNetworkEntry(
  sessionId: string,
  entry: NetworkEntry,
  byteEstimate?: number,
): Promise<UpsertNetworkResult> {
  let previous: NetworkEntry | null = null;
  let isNew = false;
  await withStore("readwrite", async (store) => {
    previous = ((await requestToPromise(store.get(entry.requestId))) as NetworkEntry | undefined) ?? null;
    isNew = !previous;
    await requestToPromise(store.put({ ...entry, sessionId }));
  });
  const { truncated, evicted } = await enforceSessionLimits(
    sessionId,
    projectedByteEstimate(byteEstimate, [{ entry, previous, isNew }]),
  );
  return { truncated, isNew, previous, evicted };
}

export async function clearNetworkEntries(sessionId: string): Promise<void> {
  const entries = await listNetworkEntries(sessionId);
  if (!entries.length) return;
  await withStore("readwrite", async (store) => {
    for (const entry of entries) {
      await requestToPromise(store.delete(entry.requestId));
    }
  });
}
