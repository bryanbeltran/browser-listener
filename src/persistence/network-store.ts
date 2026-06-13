import { NETWORK_STORE_LIMITS, totalNetworkBytes } from "./limits.js";
import type { NetworkEntry } from "../shared/types.js";

const DB_NAME = "browser-listener";
const DB_VERSION = 1;
const STORE = "network_entries";

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

async function deleteOldestEntry(sessionId: string): Promise<boolean> {
  return withStore("readwrite", async (store) => {
    const index = store.index("sessionTimestamp");
    const cursor = await requestToPromise(
      index.openCursor(IDBKeyRange.bound([sessionId, 0], [sessionId, Number.MAX_SAFE_INTEGER])),
    );
    if (!cursor) return false;
    await requestToPromise(cursor.delete());
    return true;
  });
}

async function enforceSessionLimits(sessionId: string): Promise<number> {
  const { byteBudget, entrySoftCap } = NETWORK_STORE_LIMITS;
  let truncated = 0;
  for (let i = 0; i < entrySoftCap + 1; i++) {
    const entries = await listNetworkEntries(sessionId);
    if (entries.length <= entrySoftCap && totalNetworkBytes(entries) <= byteBudget) {
      break;
    }
    const deleted = await deleteOldestEntry(sessionId);
    if (!deleted) break;
    truncated += 1;
  }
  return truncated;
}

export async function putNetworkEntries(
  sessionId: string,
  entries: NetworkEntry[],
): Promise<number> {
  if (!entries.length) return 0;
  await withStore("readwrite", async (store) => {
    for (const entry of entries) {
      await requestToPromise(store.put({ ...entry, sessionId }));
    }
  });
  return enforceSessionLimits(sessionId);
}

export async function upsertNetworkEntry(
  sessionId: string,
  entry: NetworkEntry,
): Promise<number> {
  await withStore("readwrite", async (store) => {
    await requestToPromise(store.put({ ...entry, sessionId }));
  });
  return enforceSessionLimits(sessionId);
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
