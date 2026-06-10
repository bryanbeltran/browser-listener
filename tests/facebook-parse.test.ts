import { describe, expect, it } from "vitest";
import {
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
