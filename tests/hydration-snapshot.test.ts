import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getHydrationActivity,
  ingestNetworkEntry,
  resetHydrationIndex,
} from "../src/capture/hydration-index.js";
import { NETWORK_STORE_LIMITS } from "../src/persistence/limits.js";
import { upsertNetworkEntry } from "../src/persistence/network-store.js";
import { loadFacebookFixture } from "./helpers/facebook-fixtures.js";

const GROUP_FEED = "https://www.facebook.com/groups/richfieldmncommunity";
const SESSION = "hydration-index-audit";

describe("hydration index", () => {
  it("accumulates activity as entries are ingested", () => {
    resetHydrationIndex();
    const network = loadFacebookFixture("feed").network;
    for (const entry of network) {
      ingestNetworkEntry(entry, GROUP_FEED);
    }
    const activity = getHydrationActivity();
    expect(activity.posts.length).toBeGreaterThan(0);
    resetHydrationIndex();
    const empty = getHydrationActivity();
    expect(empty.posts).toHaveLength(0);
  });

  it("dedupes reactions across multiple ingests", () => {
    resetHydrationIndex();
    const network = loadFacebookFixture("feed").network;
    const withReactions = network.filter((e) => e.responseBody?.includes("reactor"));
    expect(withReactions.length).toBeGreaterThan(1);
    for (const entry of withReactions) {
      ingestNetworkEntry(entry, GROUP_FEED);
    }
    const activity = getHydrationActivity();
    const keys = activity.reactions.map((r) => `${r.postId}:${r.userId}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("network store byte budget", () => {
  const originalBudget = NETWORK_STORE_LIMITS.byteBudget;

  beforeEach(async () => {
    const { deleteNetworkDatabase } = await import("../src/persistence/network-store.js");
    await deleteNetworkDatabase();
    NETWORK_STORE_LIMITS.byteBudget = 900;
    NETWORK_STORE_LIMITS.entrySoftCap = 100_000;
  });

  afterEach(() => {
    NETWORK_STORE_LIMITS.byteBudget = originalBudget;
    NETWORK_STORE_LIMITS.entrySoftCap = 100_000;
  });

  it("evicts when projected byte estimate exceeds budget", async () => {
    const smallBody = "a".repeat(200);
    const largeBody = "b".repeat(700);
    const smallBytes = 256 + "https://www.facebook.com/api/graphql/".length + smallBody.length;
    const largeBytes = 256 + "https://www.facebook.com/api/graphql/".length + largeBody.length;

    await upsertNetworkEntry(
      SESSION,
      {
        id: "small",
        sessionId: SESSION,
        requestId: "req-small",
        timestamp: 1,
        url: "https://www.facebook.com/api/graphql/",
        method: "POST",
        type: "xhr",
        responseBody: smallBody,
      },
      0,
    );
    const result = await upsertNetworkEntry(
      SESSION,
      {
        id: "large",
        sessionId: SESSION,
        requestId: "req-large",
        timestamp: 2,
        url: "https://www.facebook.com/api/graphql/",
        method: "POST",
        type: "xhr",
        responseBody: largeBody,
      },
      smallBytes,
    );
    expect(result.truncated).toBeGreaterThan(0);
    expect(result.evicted.some((e) => e.requestId === "req-small")).toBe(true);
    expect(smallBytes + largeBytes).toBeGreaterThan(NETWORK_STORE_LIMITS.byteBudget);
  });
});
