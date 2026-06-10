import { describe, expect, it } from "vitest";
import {
  decodeCommentPostId,
  decodeFeedbackPostId,
  extractStoryTextsFromPartialJson,
  isNoisePostText,
  permalinkPostId,
  postIdFromFacebookUrl,
} from "../src/enrichers/facebook-parse.js";

describe("facebook parse helpers", () => {
  it("decodes feedback id to post id", () => {
    expect(decodeFeedbackPostId("ZmVlZGJhY2s6MjcwMjE2NzAxODQxMjc0NTY=")).toBe("27021670184127456");
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

  it("reads post id from group posts URL", () => {
    expect(
      postIdFromFacebookUrl(
        "https://www.facebook.com/groups/richfieldmncommunity/posts/27014819028145905/",
      ),
    ).toBe("27014819028145905");
  });
});
