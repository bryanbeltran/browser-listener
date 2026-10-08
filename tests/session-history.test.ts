import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  archiveCurrentSession,
  clearSessionData,
  deleteSession,
  emptySessionData,
  readDeletionReceiptsSnapshot,
  readSessionData,
  readSessionHistory,
  resumePendingDeletions,
  updateRetentionPolicy,
  writeSessionData,
} from "../src/persistence/store.js";
import { listNetworkEntries } from "../src/persistence/network-store.js";
import type { SessionHistoryEntry } from "../src/shared/types.js";
import { sampleSession } from "./helpers/fixtures.js";
import { installChromeStorageMock, uninstallChromeStorageMock } from "./helpers/mock-chrome.js";

const HISTORY_KEY = "browserListenerSessionHistory";
const EVIDENCE_KEY = "browserListenerEvidence";
const SESSION_KEY = "browserListenerSessionData";

async function seedStoppedSession(id: string, responseBody = "payload"): Promise<SessionHistoryEntry> {
  const startedAt = Date.now() - 10_000;
  const session = sampleSession({
    id,
    active: false,
    startedAt,
    stoppedAt: startedAt + 1,
  });
  await writeSessionData({
    ...emptySessionData(),
    session,
    network: [{
      id: `${id}-network`,
      sessionId: id,
      requestId: `${id}-request`,
      timestamp: startedAt,
      url: "https://example.test/api/items",
      method: "GET",
      type: "fetch",
      responseBody,
    }],
    navigation: [{
      id: `${id}-navigation`,
      sessionId: id,
      timestamp: startedAt,
      url: "https://example.test/problem",
      title: "Problem",
      tabId: 1,
      frameId: 0,
    }],
    console: [{
      id: `${id}-console`,
      sessionId: id,
      timestamp: startedAt,
      level: "error",
      text: "request failed",
      url: "https://example.test/problem",
      tabId: 1,
    }],
  });
  const entry = await archiveCurrentSession();
  if (!entry) throw new Error(`Failed to archive ${id}`);
  return entry;
}

async function setHistoryTimes(times: Record<string, number>): Promise<void> {
  const history = await readSessionHistory();
  await chrome.storage.local.set({
    [HISTORY_KEY]: history.map((entry) => ({
      ...entry,
      archivedAt: times[entry.id] ?? entry.archivedAt,
    })),
  });
}

describe("session history and retention", () => {
  beforeEach(() => {
    installChromeStorageMock();
  });

  afterEach(() => {
    uninstallChromeStorageMock();
  });

  it("archives a stopped session without removing its network or evidence", async () => {
    const entry = await seedStoppedSession("archived-session");

    const data = await readSessionData();
    expect(entry.id).toBe("archived-session");
    expect(data.session?.id).toBe(entry.id);
    expect(data.network).toHaveLength(1);
    expect(data.navigation).toHaveLength(1);
    expect(data.console).toHaveLength(1);
    expect((await readSessionHistory()).map((item) => item.id)).toEqual([entry.id]);
  });

  it("preserves prior history and artifacts when preparing a new capture", async () => {
    await seedStoppedSession("prior-session");

    await clearSessionData({ archive: true, preserveHistory: true });

    expect((await readSessionData()).session).toBeNull();
    expect((await readSessionHistory()).map((entry) => entry.id)).toEqual(["prior-session"]);
    expect(await listNetworkEntries("prior-session")).toHaveLength(1);
    const raw = await chrome.storage.local.get(EVIDENCE_KEY);
    expect((raw[EVIDENCE_KEY] as Record<string, unknown>)["prior-session"]).toBeDefined();
  });

  it("explicitly discards the current session, history, and artifacts", async () => {
    await seedStoppedSession("discarded-session");

    await clearSessionData();

    expect(await readSessionHistory()).toEqual([]);
    expect(await listNetworkEntries("discarded-session")).toEqual([]);
    const raw = await chrome.storage.local.get(EVIDENCE_KEY);
    expect(raw[EVIDENCE_KEY]).toBeUndefined();
    expect((await chrome.storage.local.get(SESSION_KEY))[SESSION_KEY]).toBeUndefined();
  });

  it("makes per-session deletion idempotent", async () => {
    await seedStoppedSession("deletable-session");

    const first = await deleteSession("deletable-session");
    const second = await deleteSession("deletable-session");

    expect(first.state).toBe("complete");
    expect(second).toEqual(first);
    expect(await readSessionHistory()).toEqual([]);
    expect(await listNetworkEntries("deletable-session")).toEqual([]);
  });

  it("keeps a history row when an artifact phase fails and resumes it later", async () => {
    await seedStoppedSession("retry-session");
    const remove = chrome.storage.local.remove as unknown as ReturnType<typeof vi.fn>;
    remove.mockImplementationOnce(async () => {
      throw new Error("simulated evidence deletion failure");
    });

    const partial = await deleteSession("retry-session");

    expect(partial.state).toBe("partial");
    expect(partial.remainingPhases).toEqual(expect.arrayContaining(["evidence", "history"]));
    expect((await readSessionHistory()).map((entry) => entry.id)).toEqual(["retry-session"]);

    await resumePendingDeletions();

    expect((await readSessionHistory()).map((entry) => entry.id)).toEqual([]);
    expect((await readDeletionReceiptsSnapshot())[0]?.state).toBe("complete");
    expect(await listNetworkEntries("retry-session")).toEqual([]);
  });

  it("enforces retention age and count limits", async () => {
    await seedStoppedSession("old-session");
    await seedStoppedSession("middle-session");
    await seedStoppedSession("new-session");
    const now = Date.now();
    await setHistoryTimes({
      "old-session": now - 10_000,
      "middle-session": now - 2_000,
      "new-session": now,
    });

    await updateRetentionPolicy({ maxAgeMs: 5_000, maxSessions: 1, maxBytes: Number.MAX_SAFE_INTEGER });

    expect((await readSessionHistory()).map((entry) => entry.id)).toEqual(["new-session"]);
    expect(await listNetworkEntries("old-session")).toEqual([]);
    expect(await listNetworkEntries("middle-session")).toEqual([]);
  });

  it("counts the protected current session against count and byte limits", async () => {
    const old = await seedStoppedSession("old-session", "small");
    await seedStoppedSession("current-session", "x".repeat(10_000));
    const now = Date.now();
    await setHistoryTimes({ "old-session": now - 10_000, "current-session": now });

    await updateRetentionPolicy({
      maxAgeMs: 30 * 24 * 60 * 60 * 1000,
      maxSessions: 1,
      maxBytes: old.bytes + 1,
    });

    expect((await readSessionHistory()).map((entry) => entry.id)).toEqual(["current-session"]);
    expect(await listNetworkEntries("old-session")).toEqual([]);
    expect(await listNetworkEntries("current-session")).toHaveLength(1);
  });

  it("enforces the byte limit for archived sessions after the current session is cleared", async () => {
    await seedStoppedSession("large-session", "x".repeat(10_000));
    await clearSessionData({ preserveHistory: true });

    await updateRetentionPolicy({ maxAgeMs: 30 * 24 * 60 * 60 * 1000, maxSessions: 10, maxBytes: 1 });

    expect(await readSessionHistory()).toEqual([]);
    expect(await listNetworkEntries("large-session")).toEqual([]);
  });

  it("migrates legacy session network and evidence rows", async () => {
    const session = sampleSession({ id: "legacy-session", active: false });
    await chrome.storage.local.set({
      [SESSION_KEY]: {
        session,
        network: [{
          id: "legacy-network",
          sessionId: session.id,
          requestId: "legacy-request",
          timestamp: 1,
          url: "https://example.test/api/items",
          method: "GET",
          type: "fetch",
        }],
        navigation: [{
          id: "legacy-navigation",
          sessionId: session.id,
          timestamp: 2,
          url: "https://example.test/problem",
          title: "Legacy problem",
          tabId: 1,
          frameId: 0,
        }],
        console: [{
          id: "legacy-console",
          sessionId: session.id,
          timestamp: 3,
          level: "error",
          text: "Legacy error",
          url: "https://example.test/problem",
          tabId: 1,
        }],
      },
    });

    const data = await readSessionData();

    expect(data.session?.id).toBe(session.id);
    expect(data.network.map((entry) => entry.id)).toEqual(["legacy-network"]);
    expect(data.navigation.map((entry) => entry.id)).toEqual(["legacy-navigation"]);
    expect(data.console.map((entry) => entry.id)).toEqual(["legacy-console"]);
    const persisted = await chrome.storage.local.get(SESSION_KEY);
    expect((persisted[SESSION_KEY] as { network?: unknown[] }).network).toBeUndefined();
  });
});
