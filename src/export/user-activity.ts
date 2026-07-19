import type { FacebookGroupActivity, FacebookUserActivitySignal } from "../shared/types.js";

function escCsv(value: string | number | undefined | boolean): string {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(headers: string[], rows: (string | number | undefined | boolean)[][]): string {
  const lines = [headers.map(escCsv).join(",")];
  for (const row of rows) lines.push(row.map(escCsv).join(","));
  return `${lines.join("\n")}\n`;
}

export function buildUserActivitySignals(
  activity: FacebookGroupActivity,
): FacebookUserActivitySignal[] {
  const signals: FacebookUserActivitySignal[] = [];

  for (const post of activity.posts) {
    if (!post.authorId && !post.authorName) continue;
    signals.push({
      userId: post.authorId,
      userName: post.authorName,
      userIdResolved: Boolean(post.authorId),
      actionType: "post",
      targetId: post.postId ?? post.id,
      targetType: "post",
      text: post.text,
      postId: post.postId ?? post.id,
      source: post.source,
    });
  }

  for (const comment of activity.comments) {
    if (!comment.authorId && !comment.authorName) continue;
    signals.push({
      userId: comment.authorId,
      userName: comment.authorName,
      userIdResolved: Boolean(comment.authorId),
      actionType: "comment",
      targetId: comment.id,
      targetType: "comment",
      text: comment.text,
      postId: comment.postId,
      commentId: comment.id,
      source: comment.source,
    });
  }

  for (const reaction of activity.reactions) {
    signals.push({
      userId: reaction.userId,
      userName: reaction.userName,
      userIdResolved: Boolean(reaction.userId),
      actionType: "reaction",
      targetId:
        reaction.target === "comment" ? reaction.commentId : reaction.postId,
      targetType: reaction.target ?? "post",
      text: reaction.targetText,
      reactionType: reaction.reactionType,
      postId: reaction.targetPostId ?? reaction.postId,
      commentId: reaction.commentId,
      source: reaction.source,
    });
  }

  return signals;
}

/** Signals with stable userId only — safe for user-level rollup. */
export function buildResolvedUserActivitySignals(
  activity: FacebookGroupActivity,
): FacebookUserActivitySignal[] {
  return buildUserActivitySignals(activity).filter((s) => s.userIdResolved);
}

export function buildUserActivityCsv(activity: FacebookGroupActivity): string {
  const signals = buildUserActivitySignals(activity);
  return toCsv(
    [
      "userId",
      "userIdResolved",
      "userName",
      "actionType",
      "targetId",
      "targetType",
      "text",
      "reactionType",
      "postId",
      "commentId",
      "source",
    ],
    signals.map((s) => [
      s.userId,
      s.userIdResolved ? "yes" : "no",
      s.userName,
      s.actionType,
      s.targetId,
      s.targetType,
      s.text,
      s.reactionType,
      s.postId,
      s.commentId,
      s.source,
    ]),
  );
}

export function buildUserActivityJson(activity: FacebookGroupActivity): string {
  return JSON.stringify(buildUserActivitySignals(activity), null, 2);
}

export function buildResolvedUserActivityJson(activity: FacebookGroupActivity): string {
  return JSON.stringify(buildResolvedUserActivitySignals(activity), null, 2);
}
