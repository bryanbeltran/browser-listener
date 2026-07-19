import { commentLegacyKey, decodeFeedbackTarget } from "./facebook-parse.js";

/** Maps comment ids / legacy keys → canonical GraphQL feedback id. */
export type CommentFeedbackIndex = Map<string, string>;

export function emptyCommentFeedbackIndex(): CommentFeedbackIndex {
  return new Map();
}

export function recordCommentFeedbackId(
  index: CommentFeedbackIndex,
  feedbackId: string,
  commentId?: string,
  legacyKey?: string,
): void {
  if (commentId) index.set(commentId, feedbackId);
  if (legacyKey) index.set(legacyKey, feedbackId);
  const legacyFromId = commentLegacyKey(commentId);
  if (legacyFromId) index.set(legacyFromId, feedbackId);
}

/** Index comment feedback ids from decoded feedback targets (e.g. reaction payloads). */
export function indexCommentFeedbackFromTarget(
  index: CommentFeedbackIndex,
  feedbackId?: string,
): void {
  if (!feedbackId) return;
  const target = decodeFeedbackTarget(feedbackId);
  if (target.target !== "comment" || !target.commentId) return;
  recordCommentFeedbackId(index, feedbackId, target.commentId);
}

export function resolveCommentFeedbackId(
  index: CommentFeedbackIndex,
  commentId: string,
  legacyKey?: string,
  legacyFbid?: string,
): string | undefined {
  const fromId = index.get(commentId);
  if (fromId) return fromId;

  const legacy = legacyKey ?? commentLegacyKey(commentId, undefined, legacyFbid);
  if (legacy) {
    const fromLegacy = index.get(legacy);
    if (fromLegacy) return fromLegacy;
  }

  for (const [key, feedbackId] of index) {
    if (key.includes("_") && legacyKey && key === legacyKey) return feedbackId;
  }
  return undefined;
}
