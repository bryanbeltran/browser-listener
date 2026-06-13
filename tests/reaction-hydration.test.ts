import { describe, expect, it } from "vitest";
import {
  buildGraphqlFormBody,
  findGraphqlDocId,
  findGraphqlRequestTemplate,
  tabContentRefetchVariables,
  tooltipReactionVariables,
} from "../src/capture/graphql-template.js";
import {
  postHydrationScore,
  selectNextPostForHydration,
  TAB_CONTENT_REFETCH_QUERY,
  TOOLTIP_REACTION_QUERY,
} from "../src/capture/reaction-hydration.js";
import { extractFacebookGroupActivity } from "../src/enrichers/facebook-groups.js";
import { SAMPLE_REACTION_TYPE_IDS } from "../src/enrichers/facebook-parse.js";
import type { FacebookPost } from "../src/shared/types.js";
import { loadFacebookFixture } from "./helpers/facebook-fixtures.js";

const GROUP_FEED = "https://www.facebook.com/groups/richfieldmncommunity";
const HOT_FEEDBACK = "ZmVlZGJhY2s6MjcwMjE3NTYzODQxMTg4MzY=";

describe("reaction hydration", () => {
  it("finds GraphQL session template and reaction doc_ids from fixtures", () => {
    const network = loadFacebookFixture("feed").network;
    const template = findGraphqlRequestTemplate(network);
    expect(template?.fb_dtsg).toBe("[REDACTED]");
    expect(findGraphqlDocId(network, TAB_CONTENT_REFETCH_QUERY)).toBe("25576256592037408");
    expect(findGraphqlDocId(network, TOOLTIP_REACTION_QUERY)).toBe("26417294487963485");
  });

  it("builds TabContentRefetch variables for Like/Love/Haha only", () => {
    const feedbackId = HOT_FEEDBACK;
    for (const reactionId of Object.values(SAMPLE_REACTION_TYPE_IDS)) {
      const vars = tabContentRefetchVariables(feedbackId, reactionId);
      expect(vars.reactionID).toBe(reactionId);
      expect(vars.feedbackTargetID).toBe(feedbackId);
      expect(vars.count).toBe(10);
      expect(vars.cursor).toBeNull();
    }
  });

  it("builds tooltip fallback variables per reaction type", () => {
    const vars = tooltipReactionVariables(HOT_FEEDBACK, SAMPLE_REACTION_TYPE_IDS.Love);
    expect(vars).toEqual({
      feedbackTargetID: HOT_FEEDBACK,
      reactionID: SAMPLE_REACTION_TYPE_IDS.Love,
    });
  });

  it("overrides friendly name, doc_id, and variables on template", () => {
    const network = loadFacebookFixture("feed").network;
    const template = findGraphqlRequestTemplate(network)!;
    const body = buildGraphqlFormBody(template, {
      friendlyName: TAB_CONTENT_REFETCH_QUERY,
      docId: "25576256592037408",
      variables: tabContentRefetchVariables(HOT_FEEDBACK, SAMPLE_REACTION_TYPE_IDS.Like),
    });
    expect(body.fb_api_req_friendly_name).toBe(TAB_CONTENT_REFETCH_QUERY);
    expect(body.doc_id).toBe("25576256592037408");
    const vars = JSON.parse(body.variables) as { reactionID: string };
    expect(vars.reactionID).toBe(SAMPLE_REACTION_TYPE_IDS.Like);
  });

  it("selects one post, preferring hot feedback ids over raw reaction count", () => {
    const posts: FacebookPost[] = [
      { id: "a", postId: "a", feedbackId: "fb-a", reactionCount: 40, source: "x" },
      { id: "b", postId: "b", feedbackId: HOT_FEEDBACK, reactionCount: 2, source: "x" },
      { id: "c", source: "x" },
    ];
    const hot = new Set([HOT_FEEDBACK]);
    const chosen = selectNextPostForHydration(posts, [], {
      hotFeedbackIds: hot,
      hydratedPostIds: new Set(),
      tabUrl: GROUP_FEED,
    });
    expect(chosen?.id).toBe("b");
    expect(postHydrationScore(posts[1], hot, GROUP_FEED)).toBeGreaterThan(
      postHydrationScore(posts[0], hot, GROUP_FEED),
    );
  });

  it("skips already-hydrated posts when selecting next target", () => {
    const posts: FacebookPost[] = [
      { id: "a", postId: "a", feedbackId: "fb-a", reactionCount: 2, source: "x" },
      { id: "b", postId: "b", feedbackId: "fb-b", reactionCount: 40, source: "x" },
    ];
    const chosen = selectNextPostForHydration(posts, [], {
      hotFeedbackIds: new Set(),
      hydratedPostIds: new Set(["a"]),
      skipDialogCoverage: true,
    });
    expect(chosen?.id).toBe("b");
  });

  it("TabContentRefetch fixture responses produce typed post reactions", () => {
    const network = loadFacebookFixture("feed").network;
    const activity = extractFacebookGroupActivity(network, { tabUrl: GROUP_FEED });
    const dialog = activity.reactions.filter((r) => r.source.includes("TabContentRefetch"));
    expect(dialog.length).toBeGreaterThan(0);
    expect(dialog.some((r) => r.reactionType)).toBe(true);
  });
});
