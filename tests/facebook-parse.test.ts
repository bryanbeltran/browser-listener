import { describe, expect, it } from "vitest";
import {
  collectReactionNames,
  decodeCommentPostId,
  decodeFeedbackPostId,
  decodeFeedbackTarget,
  extractMediaFromAttachments,
  extractStoryTextsFromPartialJson,
  feedbackCounts,
  recordFeedbackCounts,
  applyFeedbackCountIndex,
  groupMemberCountText,
  inferFacebookSurface,
  isNoisePostText,
  KNOWN_REACTION_NAMES,
  permalinkPostId,
  postIdFromFacebookUrl,
  reactionTypeFromId,
  shareFromAttachedStory,
} from "../src/enrichers/facebook-parse.js";

describe("facebook parse helpers", () => {
  it("decodes feedback id to post id", () => {
    expect(decodeFeedbackPostId("ZmVlZGJhY2s6MjcwMjE2NzAxODQxMjc0NTY=")).toBe("27021670184127456");
  });

  it("classifies comment feedback ids separately from post feedback", () => {
    const target = decodeFeedbackTarget(
      "ZmVlZGJhY2s6MjcwMDMxMTAzMjU5ODM0NDJfMjcwMDUwNjgxNTU3ODc2NTk=",
    );
    expect(target.target).toBe("comment");
    expect(target.postId).toBe("27003110325983442");
    expect(target.commentId).toBe(
      "Y29tbWVudDoyNzAwMzExMDMyNTk4MzQ0Ml8yNzAwNTA2ODE1NTc4NzY1OQ==",
    );
    expect(decodeFeedbackPostId(target.commentId)).toBeUndefined();
  });

  it("decodes comment id to post id", () => {
    expect(
      decodeCommentPostId(
        "Y29tbWVudDoyNzAwMzExMDMyNTk4MzQ0Ml8yNzAwNTA2ODE1NTc4NzY1OQ==",
      ),
    ).toBe("27003110325983442");
  });

  it("decodes feedback-prefixed comment id to post id", () => {
    expect(
      decodeCommentPostId(
        "ZmVlZGJhY2s6MjcwMDMxMTAzMjU5ODM0NDJfMjcwMDUwNjgxNTU3ODc2NTk=",
      ),
    ).toBe("27003110325983442");
  });

  it("extracts story text from truncated JSON line", () => {
    const raw = `{"data":{"viewer":{}}}\n{"data":{"feed":{"story":{"message":{"text":"Her family came to the U.S. shortly before she was born."}`;
    const texts = extractStoryTextsFromPartialJson(raw);
    expect(texts).toContain("Her family came to the U.S. shortly before she was born.");
  });

  it("filters noise sidebar text", () => {
    expect(isNoisePostText("Public group")).toBe(true);
    expect(isNoisePostText("Her family came to the U.S. shortly before she was born.")).toBe(false);
  });

  it("reads permalink post id from tab url", () => {
    expect(
      permalinkPostId(
        "https://www.facebook.com/groups/richfieldmncommunity/permalink/27021670184127456/",
      ),
    ).toBe("27021670184127456");
  });

  it("infers Facebook surface from URL", () => {
    expect(
      inferFacebookSurface("https://www.facebook.com/groups/richfieldmncommunity"),
    ).toBe("group");
    expect(inferFacebookSurface("https://www.facebook.com/")).toBe("timeline");
    expect(
      inferFacebookSurface(
        "https://www.facebook.com/groups/foo/posts/123/",
      ),
    ).toBe("group");
  });

  it("reads post id from group posts URL", () => {
    expect(
      postIdFromFacebookUrl(
        "https://www.facebook.com/groups/richfieldmncommunity/posts/27014819028145905/",
      ),
    ).toBe("27014819028145905");
  });

  it("extracts photo attachment caption and dimensions", () => {
    const media = extractMediaFromAttachments([
      {
        styles: {
          attachment: {
            media: {
              __typename: "Photo",
              id: "4382532358628286",
              accessibility_caption: "May be an image of hotdog",
              viewer_image: { width: 1254, height: 1254 },
            },
          },
        },
      },
    ]);
    expect(media).toHaveLength(1);
    expect(media[0].type).toBe("photo");
    expect(media[0].caption).toContain("hotdog");
    expect(media[0].width).toBe(1254);
  });

  it("reads group member count text", () => {
    expect(
      groupMemberCountText({
        group_member_profiles: { formatted_count_text: "53.8K members" },
      }),
    ).toBe("53.8K members");
  });

  it("builds share info from attached_story", () => {
    const share = shareFromAttachedStory({
      id: "UzpfSTE",
      post_id: "12345",
      url: "https://www.facebook.com/groups/foo/posts/12345/",
      message: { text: "Original post text" },
      actors: [{ name: "Jane Doe" }],
    });
    expect(share?.originalPostId).toBe("12345");
    expect(share?.originalAuthorName).toBe("Jane Doe");
    expect(share?.originalText).toBe("Original post text");
  });

  it("collects reaction names from top_reactions summary", () => {
    const names = new Map<string, string>();
    collectReactionNames(
      {
        top_reactions: {
          summary: [{ reaction: { id: "1635855486666999", localized_name: "Like" } }],
        },
      },
      names,
    );
    expect(reactionTypeFromId("1635855486666999", names)).toBe("Like");
  });

  it("falls back to known reaction ids when localized_name is missing", () => {
    expect(reactionTypeFromId("1635855486666999", new Map())).toBe(
      KNOWN_REACTION_NAMES["1635855486666999"],
    );
  });

  it("reads reaction and comment totals from feedback nodes", () => {
    expect(
      feedbackCounts({
        reaction_count: { count: 5 },
        comment_count: { total_count: 3 },
      }),
    ).toEqual({ reactionCount: 5, commentCount: 3 });
    expect(feedbackCounts({ i18n_reaction_count: "2" })).toEqual({
      reactionCount: 2,
      commentCount: undefined,
    });
    expect(feedbackCounts({ total_reaction_count: { count: 1 } })).toEqual({
      reactionCount: 1,
      commentCount: undefined,
    });
    expect(
      feedbackCounts({
        comment_rendering_instance: { comments: { total_count: 10 } },
      }),
    ).toEqual({ reactionCount: undefined, commentCount: 10 });
  });

  it("indexes nested feedback counts by feedback id", () => {
    const feedbackId = btoa("feedback:26939693175658491");
    const index = new Map();
    recordFeedbackCounts(
      {
        id: feedbackId,
        reaction_count: { count: 9 },
        comment_rendering_instance: { comments: { total_count: 10 } },
      },
      index,
    );
    const posts = [{ feedbackId, reactionCount: undefined, commentCount: undefined }];
    applyFeedbackCountIndex(posts, index);
    expect(posts[0].reactionCount).toBe(9);
    expect(posts[0].commentCount).toBe(10);
  });
});
