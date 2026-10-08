import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  countNetworkEntries,
  listNetworkEntries,
  putNetworkEntries,
  upsertNetworkEntry,
} from "../src/persistence/network-store.js";
import { NETWORK_STORE_LIMITS } from "../src/persistence/limits.js";
import { installChromeStorageMock, uninstallChromeStorageMock } from "./helpers/mock-chrome.js";

const SESSION = "session-idb-test";

describe("network store (IndexedDB)", () => {
  beforeEach(async () => {
    installChromeStorageMock();
    const { deleteNetworkDatabase } = await import("../src/persistence/network-store.js");
    await deleteNetworkDatabase();
  });

  afterEach(() => {
    uninstallChromeStorageMock();
  });

  it("upserts and lists entries sorted by timestamp", async () => {
    await upsertNetworkEntry(SESSION, {
      id: "a",
      sessionId: SESSION,
      requestId: "req-b",
      timestamp: 20,
      url: "https://example.test/api/items",
      method: "GET",
      type: "fetch",
    });
    await upsertNetworkEntry(SESSION, {
      id: "b",
      sessionId: SESSION,
      requestId: "req-a",
      timestamp: 10,
      url: "https://example.test/api/items",
      method: "GET",
      type: "fetch",
    });

    const entries = await listNetworkEntries(SESSION);
    expect(entries.map((e) => e.requestId)).toEqual(["req-a", "req-b"]);
    expect(await countNetworkEntries(SESSION)).toBe(2);
  });

  it("updates an existing entry by requestId", async () => {
    await upsertNetworkEntry(SESSION, {
      id: "a",
      sessionId: SESSION,
      requestId: "req-1",
      timestamp: 1,
      url: "https://example.test/api/items",
      method: "GET",
      type: "fetch",
      statusCode: 200,
    });
    await upsertNetworkEntry(SESSION, {
      id: "a",
      sessionId: SESSION,
      requestId: "req-1",
      timestamp: 1,
      url: "https://example.test/api/items",
      method: "GET",
      type: "fetch",
      statusCode: 201,
      responseBody: '{"ok":true}',
    });

    const entries = await listNetworkEntries(SESSION);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.statusCode).toBe(201);
    expect(entries[0]?.responseBody).toBe('{"ok":true}');
  });

  it("bulk put replaces session entries via store writeSessionData path", async () => {
    const result = await putNetworkEntries(SESSION, [
      {
        id: "1",
        sessionId: SESSION,
        requestId: "r1",
        timestamp: 1,
        url: "https://example.test/api/items",
        method: "GET",
        type: "fetch",
      },
      {
        id: "2",
        sessionId: SESSION,
        requestId: "r2",
        timestamp: 2,
        url: "https://example.test/api/items",
        method: "GET",
        type: "fetch",
      },
    ]);
    expect(result.truncated).toBe(0);
    expect(await countNetworkEntries(SESSION)).toBe(2);
  });

  it("evicts oldest entries when soft cap exceeded without listing all rows each time", async () => {
    const originalCap = NETWORK_STORE_LIMITS.entrySoftCap;
    NETWORK_STORE_LIMITS.entrySoftCap = 3;
    NETWORK_STORE_LIMITS.byteBudget = Number.MAX_SAFE_INTEGER;
    try {
      for (let i = 0; i < 5; i++) {
        await upsertNetworkEntry(SESSION, {
          id: `id-${i}`,
          sessionId: SESSION,
          requestId: `req-${i}`,
          timestamp: i,
          url: `https://example.test/api/items?i=${i}`,
          method: "GET",
          type: "fetch",
        });
      }
      const entries = await listNetworkEntries(SESSION);
      expect(entries).toHaveLength(3);
      expect(entries.map((e) => e.requestId)).toEqual(["req-2", "req-3", "req-4"]);
    } finally {
      NETWORK_STORE_LIMITS.entrySoftCap = originalCap;
      NETWORK_STORE_LIMITS.byteBudget = 128 * 1024 * 1024;
    }
  });

  it("evicts oldest entries from an overrepresented origin and reports the fairness eviction", async () => {
    const result = await upsertNetworkEntry(
      SESSION,
      {
        id: "origin-2",
        sessionId: SESSION,
        requestId: "origin-2",
        timestamp: 2,
        url: "https://example.test/api/second",
        method: "GET",
        type: "fetch",
      },
      undefined,
      { perOriginBytes: 500, perCategoryBytes: 10_000 },
    );
    const secondResult = await upsertNetworkEntry(
      SESSION,
      {
        id: "origin-1",
        sessionId: SESSION,
        requestId: "origin-1",
        timestamp: 1,
        url: "https://example.test/api/first",
        method: "GET",
        type: "fetch",
      },
      undefined,
      { perOriginBytes: 500, perCategoryBytes: 10_000 },
    );

    expect(result.fairBudgetEvicted).toBe(0);
    expect(secondResult.fairBudgetEvicted).toBe(1);
    const entries = await listNetworkEntries(SESSION);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.requestId).toBe("origin-2");
  });
});
