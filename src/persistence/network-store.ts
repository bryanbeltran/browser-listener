import { NETWORK_STORE_LIMITS, estimateNetworkEntryBytes } from "./limits.js";
import type { NetworkEntry } from "../shared/types.js";

const DB_NAME = "browser-listener";
const DB_VERSION = 2;
const STORE = "network_entries";

export interface UpsertNetworkResult {
  truncated: number;
  fairBudgetEvicted: number;
  isNew: boolean;
  previous: NetworkEntry | null;
  evicted: NetworkEntry[];
}

export interface NetworkFairBudgets {
  perOriginBytes?: number;
  perCategoryBytes?: number;
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
      req.onupgradeneeded = (event) => {
        const db = req.result;
        const transaction = req.transaction;
        if (!transaction) throw new Error("Network store upgrade transaction unavailable");
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: "id" });
          store.createIndex("sessionId", "sessionId", { unique: false });
          store.createIndex("sessionTimestamp", ["sessionId", "timestamp"], { unique: false });
          return;
        }
        if ((event as IDBVersionChangeEvent).oldVersion < 2) {
          const oldStore = transaction.objectStore(STORE);
          const getAll = oldStore.getAll();
          getAll.onsuccess = () => {
            const entries = getAll.result as NetworkEntry[];
            db.deleteObjectStore(STORE);
            const store = db.createObjectStore(STORE, { keyPath: "id" });
            store.createIndex("sessionId", "sessionId", { unique: false });
            store.createIndex("sessionTimestamp", ["sessionId", "timestamp"], { unique: false });
            for (const entry of entries) store.put(entry);
          };
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

async function deleteEntry(entryId: string): Promise<NetworkEntry | null> {
  return withStore("readwrite", async (store) => {
    const entry = (await requestToPromise(store.get(entryId))) as NetworkEntry | undefined;
    if (!entry) return null;
    await requestToPromise(store.delete(entryId));
    return entry;
  });
}

function originKey(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "<opaque>";
  }
}

function categoryKey(entry: NetworkEntry): string {
  return entry.type?.trim().toLowerCase() || "other";
}

function oldestFairCandidate(
  entries: NetworkEntry[],
  budgets: NetworkFairBudgets | undefined,
): NetworkEntry | null {
  if (!budgets || entries.length === 0) return null;
  const originBytes = new Map<string, number>();
  const categoryBytes = new Map<string, number>();
  for (const entry of entries) {
    const bytes = estimateNetworkEntryBytes(entry);
    originBytes.set(originKey(entry.url), (originBytes.get(originKey(entry.url)) ?? 0) + bytes);
    categoryBytes.set(categoryKey(entry), (categoryBytes.get(categoryKey(entry)) ?? 0) + bytes);
  }
  const violatingOrigins = new Set<string>();
  const violatingCategories = new Set<string>();
  if (budgets.perOriginBytes != null) {
    for (const [origin, bytes] of originBytes) {
      if (bytes > budgets.perOriginBytes) violatingOrigins.add(origin);
    }
  }
  if (budgets.perCategoryBytes != null) {
    for (const [category, bytes] of categoryBytes) {
      if (bytes > budgets.perCategoryBytes) violatingCategories.add(category);
    }
  }
  if (!violatingOrigins.size && !violatingCategories.size) return null;
  return [...entries]
    .filter((entry) => violatingOrigins.has(originKey(entry.url)) || violatingCategories.has(categoryKey(entry)))
    .sort((left, right) => left.timestamp - right.timestamp || left.id.localeCompare(right.id))[0] ?? null;
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
  fairBudgets?: NetworkFairBudgets,
): Promise<{ truncated: number; fairBudgetEvicted: number; evicted: NetworkEntry[] }> {
  const { byteBudget, entrySoftCap } = NETWORK_STORE_LIMITS;
  const evicted: NetworkEntry[] = [];
  let truncated = 0;
  let fairBudgetEvicted = 0;

  let count = await countNetworkEntries(sessionId);
  let bytes = byteEstimate ?? 0;
  const checkBytes = byteEstimate != null;
  let entries = fairBudgets ? await listNetworkEntries(sessionId) : [];

  while (count > entrySoftCap || (checkBytes && bytes > byteBudget) || oldestFairCandidate(entries, fairBudgets) != null) {
    const fairCandidate = oldestFairCandidate(entries, fairBudgets);
    if (count <= entrySoftCap && (!checkBytes || bytes <= byteBudget) && !fairCandidate) break;
    const deleted = fairCandidate ? await deleteEntry(fairCandidate.id) : await deleteOldestEntry(sessionId);
    if (!deleted) break;
    evicted.push(deleted);
    truncated += 1;
    if (fairCandidate) fairBudgetEvicted += 1;
    count -= 1;
    if (checkBytes) bytes -= estimateNetworkEntryBytes(deleted);
    if (entries.length) entries = entries.filter((entry) => entry.id !== deleted.id);
  }

  return { truncated, fairBudgetEvicted, evicted };
}

export async function putNetworkEntries(
  sessionId: string,
  entries: NetworkEntry[],
  byteEstimate?: number,
  fairBudgets?: NetworkFairBudgets,
): Promise<UpsertNetworkResult> {
  if (!entries.length) {
    return { truncated: 0, fairBudgetEvicted: 0, isNew: false, previous: null, evicted: [] };
  }
  let isNew = false;
  let previous: NetworkEntry | null = null;
  const writes: { entry: NetworkEntry; previous: NetworkEntry | null; isNew: boolean }[] = [];
  await withStore("readwrite", async (store) => {
    for (const entry of entries) {
      const existing = (await requestToPromise(store.get(entry.id))) as NetworkEntry | undefined;
      const entryIsNew = !existing;
      if (entryIsNew) isNew = true;
      else if (!previous) previous = existing;
      writes.push({ entry, previous: existing ?? null, isNew: entryIsNew });
      await requestToPromise(store.put({ ...entry, sessionId }));
    }
  });
  const { truncated, fairBudgetEvicted, evicted } = await enforceSessionLimits(
    sessionId,
    projectedByteEstimate(byteEstimate, writes),
    fairBudgets,
  );
  return {
    truncated,
    fairBudgetEvicted,
    isNew,
    previous,
    evicted,
  };
}

export async function upsertNetworkEntry(
  sessionId: string,
  entry: NetworkEntry,
  byteEstimate?: number,
  fairBudgets?: NetworkFairBudgets,
): Promise<UpsertNetworkResult> {
  let previous: NetworkEntry | null = null;
  let isNew = false;
  await withStore("readwrite", async (store) => {
    previous = ((await requestToPromise(store.get(entry.id))) as NetworkEntry | undefined) ?? null;
    isNew = !previous;
    await requestToPromise(store.put({ ...entry, sessionId }));
  });
  const { truncated, fairBudgetEvicted, evicted } = await enforceSessionLimits(
    sessionId,
    projectedByteEstimate(byteEstimate, [{ entry, previous, isNew }]),
    fairBudgets,
  );
  return { truncated, fairBudgetEvicted, isNew, previous, evicted };
}

export async function clearNetworkEntries(sessionId: string): Promise<void> {
  const entries = await listNetworkEntries(sessionId);
  if (!entries.length) return;
  await withStore("readwrite", async (store) => {
    for (const entry of entries) {
      await requestToPromise(store.delete(entry.id));
    }
  });
}
