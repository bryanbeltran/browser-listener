import { describe, expect, it } from "vitest";
import {
  indexCommentFeedbackFromTarget,
  recordCommentFeedbackId,
  resolveCommentFeedbackId,
  emptyCommentFeedbackIndex,
} from "../src/enrichers/comment-feedback-index.js";

describe("comment feedback index", () => {
  it("indexes and resolves feedback id by comment id and legacy key", () => {
    const index = emptyCommentFeedbackIndex();
    const commentId = btoa("comment:27021756384118836_12345");
    const feedbackId = btoa("feedback:27021756384118836_12345");
    recordCommentFeedbackId(index, feedbackId, commentId, "27021756384118836_12345");

    expect(resolveCommentFeedbackId(index, commentId)).toBe(feedbackId);
    expect(resolveCommentFeedbackId(index, commentId, "27021756384118836_12345")).toBe(
      feedbackId,
    );
  });

  it("indexes from decoded reaction feedback targets", () => {
    const index = emptyCommentFeedbackIndex();
    const feedbackId = btoa("feedback:27021756384118836_999");
    indexCommentFeedbackFromTarget(index, feedbackId);
    const commentId = btoa("comment:27021756384118836_999");
    expect(resolveCommentFeedbackId(index, commentId)).toBe(feedbackId);
  });
});
