import { describe, expect, it } from "vitest";
import { activityForHydration, invalidateHydrationSnapshot } from "../src/capture/hydration-snapshot.js";
import { loadFacebookFixture } from "./helpers/facebook-fixtures.js";

const GROUP_FEED = "https://www.facebook.com/groups/richfieldmncommunity";

describe("hydration snapshot", () => {
  it("caches activity until invalidated", () => {
    invalidateHydrationSnapshot();
    const network = loadFacebookFixture("feed").network;
    const a = activityForHydration(network, GROUP_FEED);
    const b = activityForHydration(network, GROUP_FEED);
    expect(a).toBe(b);
    invalidateHydrationSnapshot();
    const c = activityForHydration(network, GROUP_FEED);
    expect(c).not.toBe(b);
    expect(c.posts.length).toBe(a.posts.length);
  });
});
