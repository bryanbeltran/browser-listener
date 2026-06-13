import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  countNetworkEntries,
  listNetworkEntries,
  putNetworkEntries,
  upsertNetworkEntry,
} from "../src/persistence/network-store.js";
import { installChromeStorageMock, uninstallChromeStorageMock } from "./helpers/mock-chrome.js";

const SESSION = "session-idb-test";

describe("network store (IndexedDB)", () => {
  beforeEach(() => {
    installChromeStorageMock();
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
      url: "https://www.facebook.com/api/graphql/",
      method: "POST",
      type: "xhr",
    });
    await upsertNetworkEntry(SESSION, {
      id: "b",
      sessionId: SESSION,
      requestId: "req-a",
      timestamp: 10,
      url: "https://www.facebook.com/api/graphql/",
      method: "POST",
      type: "xhr",
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
      url: "https://www.facebook.com/api/graphql/",
      method: "POST",
      type: "xhr",
      statusCode: 200,
    });
    await upsertNetworkEntry(SESSION, {
      id: "a",
      sessionId: SESSION,
      requestId: "req-1",
      timestamp: 1,
      url: "https://www.facebook.com/api/graphql/",
      method: "POST",
      type: "xhr",
      statusCode: 201,
      responseBody: '{"ok":true}',
    });

    const entries = await listNetworkEntries(SESSION);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.statusCode).toBe(201);
    expect(entries[0]?.responseBody).toBe('{"ok":true}');
  });

  it("bulk put replaces session entries via store writeSessionData path", async () => {
    const truncated = await putNetworkEntries(SESSION, [
      {
        id: "1",
        sessionId: SESSION,
        requestId: "r1",
        timestamp: 1,
        url: "https://www.facebook.com/api/graphql/",
        method: "POST",
        type: "xhr",
      },
      {
        id: "2",
        sessionId: SESSION,
        requestId: "r2",
        timestamp: 2,
        url: "https://www.facebook.com/api/graphql/",
        method: "POST",
        type: "xhr",
      },
    ]);
    expect(truncated).toBe(0);
    expect(await countNetworkEntries(SESSION)).toBe(2);
  });
});
