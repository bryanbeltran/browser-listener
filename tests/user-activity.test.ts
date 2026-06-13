import { describe, expect, it } from "vitest";
import { extractFacebookGroupActivity } from "../src/enrichers/facebook-groups.js";
import { buildUserActivityCsv, buildUserActivitySignals } from "../src/export/user-activity.js";
import { loadFacebookFixture } from "./helpers/facebook-fixtures.js";

const GROUP_FEED = "https://www.facebook.com/groups/richfieldmncommunity";

describe("user activity export", () => {
  it("emits flat post, comment, and reaction rows", () => {
    const network = loadFacebookFixture("comments-dialog").network;
    const activity = extractFacebookGroupActivity(network, { tabUrl: GROUP_FEED });
    const signals = buildUserActivitySignals(activity);

    expect(signals.some((s) => s.actionType === "post")).toBe(true);
    expect(signals.some((s) => s.actionType === "comment")).toBe(true);
    expect(signals.filter((s) => s.actionType === "reaction").length).toBeGreaterThan(0);

    const reaction = signals.find((s) => s.actionType === "reaction");
    expect(reaction?.userId).toBeTruthy();
    expect(reaction?.targetType).toBeTruthy();
  });

  it("builds user-activity.csv with expected headers", () => {
    const network = loadFacebookFixture("feed").network;
    const activity = extractFacebookGroupActivity(network, { tabUrl: GROUP_FEED });
    const csv = buildUserActivityCsv(activity);
    expect(csv.split("\n")[0]).toContain("userId");
    expect(csv).toContain("actionType");
    expect(csv).toContain("reaction");
  });
});
