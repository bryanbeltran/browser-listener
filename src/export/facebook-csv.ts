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
        "reactionCount",
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
        p.reactionCount,
        p.source,
        p.partialParse ? "yes" : "",
      ]),
    );
  }

  if (activity.reactions.length) {
    files["csv/reactions.csv"] = toCsv(
      ["userId", "userName", "postId", "feedbackId", "reactionCount", "source"],
      activity.reactions.map((r) => [
        r.userId,
        r.userName,
        r.postId,
        r.feedbackId,
        r.reactionCount,
        r.source,
      ]),
    );
  }

  if (activity.comments.length) {
    files["csv/comments.csv"] = toCsv(
      ["id", "postId", "authorName", "text", "source"],
      activity.comments.map((c) => [c.id, c.postId, c.authorName, c.text, c.source]),
    );
  }

  return files;
}
