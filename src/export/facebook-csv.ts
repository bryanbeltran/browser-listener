import type { FacebookGroupActivity } from "../shared/types.js";

function escCsv(value: string | number | undefined): string {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(headers: string[], rows: (string | number | undefined)[][]): string {
  const lines = [headers.map(escCsv).join(",")];
  for (const row of rows) lines.push(row.map(escCsv).join(","));
  return `${lines.join("\n")}\n`;
}

export function buildFacebookCsvFiles(
  activity: FacebookGroupActivity,
): Record<string, string> {
  const files: Record<string, string> = {};

  if (activity.members.length) {
    files["csv/members.csv"] = toCsv(
      ["userId", "name", "groupId", "groupName", "role", "source"],
      activity.members.map((m) => [m.userId, m.name, m.groupId, m.groupName, m.role, m.source]),
    );
  }

  if (activity.people.length) {
    files["csv/people.csv"] = toCsv(
      ["id", "name", "url", "source"],
      activity.people.map((p) => [p.id, p.name, p.url, p.source]),
    );
  }

  if (activity.posts.length) {
    files["csv/posts.csv"] = toCsv(
      [
        "id",
        "postId",
        "feedbackId",
        "authorName",
        "text",
        "url",
        "surface",
        "groupId",
        "groupName",
        "reactionCount",
        "commentCount",
        "mediaCount",
        "shareAuthor",
        "shareText",
        "source",
        "partialParse",
      ],
      activity.posts.map((p) => [
        p.id,
        p.postId,
        p.feedbackId,
        p.authorName,
        p.text,
        p.url,
        p.surface,
        p.groupId,
        p.groupName,
        p.reactionCount,
        p.commentCount,
        p.media?.length,
        p.share?.originalAuthorName,
        p.share?.originalText,
        p.source,
        p.partialParse ? "yes" : "",
      ]),
    );
  }

  if (activity.reactions.length) {
    files["csv/reactions.csv"] = toCsv(
      [
        "userId",
        "userName",
        "reactionType",
        "postId",
        "commentId",
        "target",
        "feedbackId",
        "reactionCount",
        "source",
      ],
      activity.reactions.map((r) => [
        r.userId,
        r.userName,
        r.reactionType,
        r.postId,
        r.commentId,
        r.target,
        r.feedbackId,
        r.reactionCount,
        r.source,
      ]),
    );
  }

  if (activity.comments.length) {
    files["csv/comments.csv"] = toCsv(
      ["id", "postId", "authorName", "text", "reactionCount", "source"],
      activity.comments.map((c) => [
        c.id,
        c.postId,
        c.authorName,
        c.text,
        c.reactionCount,
        c.source,
      ]),
    );
  }

  return files;
}
