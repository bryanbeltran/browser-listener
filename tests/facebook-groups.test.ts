import { describe, expect, it } from "vitest";
import { extractFacebookGroupActivity } from "../src/enrichers/facebook-groups.js";
import { buildGraphqlCaptures } from "../src/export/graphql-captures.js";
import { prepareZipExport } from "../src/export/orchestrator.js";
import { buildZipFromSessionData } from "../src/export/orchestrator.js";
import { DEFAULT_CAPTURE_OPTIONS } from "../src/shared/types.js";
import type { NetworkEntry, SessionData } from "../src/shared/types.js";
import { unzipToMap } from "./helpers/unzip.js";
import {
  loadFacebookFixture,
  type FacebookFixtureName,
} from "./helpers/facebook-fixtures.js";

const PERMALINK =
  "https://www.facebook.com/groups/richfieldmncommunity/permalink/27021670184127456/";
const GROUP_FEED = "https://www.facebook.com/groups/richfieldmncommunity";

function fixture(name: FacebookFixtureName): NetworkEntry[] {
  return loadFacebookFixture(name).network;
}

function sessionData(network: NetworkEntry[], tabUrl: string, id: string): SessionData {
  return {
    session: {
      id,
      active: false,
      consentedAt: 1,
      startedAt: 1,
      stoppedAt: 2,
      tabId: 1,
      tabUrl,
      options: { ...DEFAULT_CAPTURE_OPTIONS },
      health: {
        debuggerAttached: true,
        debuggerDetachCount: 0,
        serviceWorkerRestarts: 0,
        partialGaps: [],
        persistenceErrors: [],
        truncation: { network: 0 },
      },
    },
    network,
  };
}

describe("facebook groups enricher", () => {
  it("extracts comment text and links comments to posts", () => {
    const activity = extractFacebookGroupActivity(fixture("comments-dialog"), {
      tabUrl: GROUP_FEED,
    });
    expect(activity.comments.length).toBe(7);
    expect(activity.comments.every((c) => c.text && c.postId)).toBe(true);
    expect(
      activity.comments.some((c) => c.text?.includes("Yes, like thjd")),
    ).toBe(true);
    expect(
      activity.comments.some((c) => c.text?.includes("Agree - never met him")),
    ).toBe(true);

    const catPost = activity.posts.find((p) => p.postId === "27003110325983442");
    expect(catPost?.commentCount).toBe(5);
    expect(catPost?.linkedComments?.length).toBe(5);
    expect(catPost?.linkedComments?.[0]?.text).toBeTruthy();

    const junkPost = activity.posts.find((p) => p.postId === "26999251709702637");
    expect(junkPost?.commentCount).toBe(2);
  });

  it("captures post reactions from the reactions dialog query", () => {
    const activity = extractFacebookGroupActivity(fixture("comments-dialog"), {
      tabUrl: GROUP_FEED,
    });
    expect(
      activity.reactions.some((r) => /CometUFIReactionsDialog/i.test(r.source)),
    ).toBe(true);
  });

  it("extracts posts with postId and linked reactions from dialog capture", () => {
    const activity = extractFacebookGroupActivity(fixture("reactions-dialog"), {
      tabUrl: GROUP_FEED,
    });
    expect(activity.people.length).toBeGreaterThan(5);
    expect(activity.posts.length).toBeGreaterThan(0);
    expect(
      activity.posts.some((p) => p.postId === "27014819028145905" && p.authorName),
    ).toBe(true);
    const reactionsOnly = activity.posts.find((p) => p.postId === "26978847508409724");
    expect(reactionsOnly?.reactionCount).toBeGreaterThan(0);
    expect(reactionsOnly?.linkedReactions?.length).toBeGreaterThan(0);
    expect(activity.reactions.length).toBeGreaterThan(5);
  });

  it("extracts photo media and typed reactions from dialog capture", () => {
    const activity = extractFacebookGroupActivity(fixture("reactions-dialog"), {
      tabUrl: GROUP_FEED,
    });
    const photoPosts = activity.posts.filter((p) => p.postId === "27014819028145905");
    expect(photoPosts).toHaveLength(1);
    const photoPost = photoPosts[0];
    expect(photoPost?.media?.length).toBeGreaterThan(0);
    expect(photoPost?.media?.[0]?.type).toBe("photo");
    expect(photoPost?.media?.[0]?.caption).toContain("hotdog");

    const dialogReactions = activity.reactions.filter((r) =>
      /CometUFIReactionsDialog/i.test(r.source),
    );
    expect(dialogReactions.some((r) => r.reactionType === "Like")).toBe(true);
  });

  it("extracts comment reactions and links them to comments", () => {
    const commentFeedbackId = btoa("feedback:27003110325983442_27005068155787659");
    const commentId = btoa("comment:27003110325983442_27005068155787659");
    const synthetic: NetworkEntry = {
      id: "n-comment-reaction",
      sessionId: "fixture",
      requestId: "req-comment-reaction",
      timestamp: Date.now(),
      url: "https://www.facebook.com/api/graphql/",
      method: "POST",
      type: "xhr",
      statusCode: 200,
      requestBody:
        "fb_api_req_friendly_name=CommentListComponentsRootQuery&doc_id=synthetic-comment-reactions",
      responseBody: JSON.stringify({
        data: {
          node: {
            __typename: "Feedback",
            id: commentFeedbackId,
            total_reaction_count: { count: 1 },
            reactors: {
              nodes: [{ __typename: "User", id: "9001", name: "Comment Reactor" }],
            },
            comments: {
              edges: [
                {
                  node: {
                    __typename: "Comment",
                    id: commentId,
                    body: { text: "Yes, like thjd?" },
                    author: { id: "1", name: "Author" },
                  },
                },
              ],
            },
          },
        },
      }),
      bodyCaptured: true,
    };

    const activity = extractFacebookGroupActivity(
      [...fixture("comments-dialog"), synthetic],
      { tabUrl: GROUP_FEED },
    );

    const comment = activity.comments.find((c) => c.text?.includes("Yes, like thjd"));
    expect(comment?.linkedReactions?.length).toBe(1);
    expect(comment?.linkedReactions?.[0]?.userName).toBe("Comment Reactor");

    const commentReaction = activity.reactions.find((r) => r.target === "comment");
    expect(commentReaction?.commentId).toBe(commentId);
    expect(commentReaction?.userName).toBe("Comment Reactor");

    const catPost = activity.posts.find((p) => p.postId === "27003110325983442");
    expect(catPost?.linkedComments?.some((c) => c.linkedReactions?.length === 1)).toBe(true);
  });

  it("extracts posts, linked reactions, and people from permalink capture", () => {
    const activity = extractFacebookGroupActivity(fixture("permalink"), {
      tabUrl: PERMALINK,
    });
    expect(activity.people.length).toBeGreaterThan(5);
    expect(activity.reactions.length).toBeGreaterThan(0);
    expect(
      activity.posts.some(
        (p) =>
          p.text?.includes("Her family came to the U.S.") ||
          p.postId === "27021670184127456",
      ),
    ).toBe(true);
    expect(activity.parseWarnings?.length).toBeGreaterThan(0);
  });

  it("extracts people, reactions, members, and group member count from feed capture", () => {
    const activity = extractFacebookGroupActivity(fixture("feed"));
    expect(activity.groups.some((g) => g.id === "623366241051210")).toBe(true);
    expect(activity.groups.find((g) => g.id === "623366241051210")?.memberCountText).toBe(
      "53.8K members",
    );
    expect(activity.members.length).toBeGreaterThan(0);
    expect(activity.members.some((m) => m.groupName?.includes("Richfield"))).toBe(true);
    expect(activity.people.length).toBeGreaterThan(5);
    expect(activity.reactions.length).toBeGreaterThan(0);
    expect(activity.reactions.every((r) => r.reactionType)).toBe(true);
    expect(activity.reactions.some((r) => r.reactionType === "Like")).toBe(true);
  });

  it("extracts feed-level reaction and comment counts onto posts", () => {
    const postText =
      "China cabinet for free. Items shown inside the cabinet are not included.";
    const responseBody = `{"data":{"__typename":"Story","id":"UzpfTest","post_id":"2405034246652002","message":{"text":"${postText}"},"feedback":{"id":"ZmVkYmFja2s6MjQwNTAzNDI0NjY1MjAwMg==","reaction_count":{"count":5},"comment_count":{"total_count":3}},"actors":[{"id":"541862394","name":"Christina Krol"}]}}
{broken`;
    const entry: NetworkEntry = {
      id: "n-feed-counts",
      sessionId: "fixture",
      requestId: "req-feed-counts",
      timestamp: Date.now(),
      url: "https://www.facebook.com/api/graphql/",
      method: "POST",
      type: "xhr",
      statusCode: 200,
      requestBody:
        "fb_api_req_friendly_name=GroupsCometFeedRegularStoriesPaginationQuery&doc_id=1",
      responseBody,
      bodyCaptured: true,
    };

    const activity = extractFacebookGroupActivity([entry], { tabUrl: GROUP_FEED });
    const post = activity.posts.find((p) => p.postId === "2405034246652002");
    expect(post?.reactionCount).toBe(5);
    expect(post?.commentCount).toBe(3);
    expect(activity.posts.some((p) => p.partialParse)).toBe(false);
  });

  it("drops partial posts when a full post matches by text", () => {
    const postText =
      "China cabinet for free. Items shown inside the cabinet are not included.";
    const responseBody = `{"data":{"__typename":"Story","id":"UzpfTest","post_id":"2405034246652002","message":{"text":"${postText}"},"feedback":{"id":"ZmVk"},"actors":[{"id":"541862394","name":"Christina Krol"}]}}
{broken`;
    const entry: NetworkEntry = {
      id: "n-partial-dedupe",
      sessionId: "fixture",
      requestId: "req-partial-dedupe",
      timestamp: Date.now(),
      url: "https://www.facebook.com/api/graphql/",
      method: "POST",
      type: "xhr",
      statusCode: 200,
      requestBody:
        "fb_api_req_friendly_name=GroupsCometFeedRegularStoriesPaginationQuery&doc_id=1",
      responseBody,
      bodyCaptured: true,
    };

    const activity = extractFacebookGroupActivity([entry], { tabUrl: GROUP_FEED });
    const matches = activity.posts.filter((p) => p.text?.includes("China cabinet"));
    expect(matches).toHaveLength(1);
    expect(matches[0]?.partialParse).toBeFalsy();
    expect(matches[0]?.postId).toBe("2405034246652002");
  });

  it("backfills reaction types onto tooltip reactors when tab refetch is present", () => {
    const postFeedbackId = btoa("feedback:27021756384118836");
    const tooltip: NetworkEntry = {
      id: "n-tooltip",
      sessionId: "fixture",
      requestId: "req-tooltip",
      timestamp: Date.now(),
      url: "https://www.facebook.com/api/graphql/",
      method: "POST",
      type: "xhr",
      statusCode: 200,
      requestBody:
        "fb_api_req_friendly_name=CometUFIReactionIconTooltipContentQuery&doc_id=tooltip",
      responseBody: JSON.stringify({
        data: {
          feedback: {
            __typename: "Feedback",
            id: postFeedbackId,
            reactors: {
              nodes: [{ __typename: "User", id: "9001", name: "Tooltip User" }],
            },
          },
        },
      }),
      bodyCaptured: true,
    };
    const tabRefetch: NetworkEntry = {
      id: "n-tab",
      sessionId: "fixture",
      requestId: "req-tab",
      timestamp: Date.now(),
      url: "https://www.facebook.com/api/graphql/",
      method: "POST",
      type: "xhr",
      statusCode: 200,
      requestBody:
        "fb_api_req_friendly_name=CometUFIReactionsDialogTabContentRefetchQuery&doc_id=tab",
      responseBody: JSON.stringify({
        data: {
          node: {
            __typename: "Feedback",
            id: postFeedbackId,
            reactors: {
              edges: [
                {
                  feedback_reaction_info: { id: "1635855486666999" },
                  node: { __typename: "User", id: "9001", name: "Tooltip User" },
                },
              ],
            },
          },
        },
      }),
      bodyCaptured: true,
    };

    const activity = extractFacebookGroupActivity([tooltip, tabRefetch]);
    const reaction = activity.reactions.find((r) => r.userId === "9001");
    expect(reaction?.reactionType).toBe("Like");
    expect(reaction?.source).toContain("TabContentRefetch");
  });

  it("builds graphql-captures.json entries with doc_id hints", () => {
    const captures = buildGraphqlCaptures(fixture("comments-dialog"));
    expect(captures.length).toBeGreaterThan(5);
    expect(captures.some((c) => c.friendlyName && c.docId)).toBe(true);
  });

  it("includes members csv when feed fixture has hovercard members", async () => {
    const network = fixture("feed");

    const zip = await buildZipFromSessionData(sessionData(network, GROUP_FEED, "fb-feed-fixture"));

    const files = unzipToMap(zip);
    expect(files["csv/members.csv"]).toBeDefined();
    expect(files["csv/members.csv"]).toContain("Richfield");
  });

  it("includes group-activity.json and csv in export when enricher enabled", async () => {
    const network = fixture("permalink");

    const zip = await buildZipFromSessionData(sessionData(network, PERMALINK, "fb-fixture"));

    const files = unzipToMap(zip);
    expect(files["group-activity.json"]).toBeDefined();
    expect(files["graphql-captures.json"]).toBeDefined();
    expect(files["csv/people.csv"]).toBeDefined();
    expect(files["csv/reactions.csv"]).toBeDefined();
    const activity = JSON.parse(files["group-activity.json"]);
    expect(activity.people.length).toBeGreaterThan(0);
    expect(files["report.html"]).toContain("Facebook activity");
    expect(files["report.html"]).toContain("post-block");
  });

  it("prepareZipExport returns entity counts for popup summary", async () => {
    const network = fixture("comments-dialog");
    const { writeSessionData } = await import("../src/persistence/store.js");
    const { installChromeStorageMock, uninstallChromeStorageMock } = await import(
      "./helpers/mock-chrome.js"
    );
    installChromeStorageMock();
    try {
      await writeSessionData(sessionData(network, GROUP_FEED, "counts-fixture"));
      const bundle = await prepareZipExport();
      expect(bundle.counts.posts).toBeGreaterThan(0);
      expect(bundle.counts.comments).toBeGreaterThan(0);
      expect(bundle.counts.reactions).toBeGreaterThan(0);
      expect(bundle.counts.network).toBe(network.length);
    } finally {
      uninstallChromeStorageMock();
    }
  });
});
