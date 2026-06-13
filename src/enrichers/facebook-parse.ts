/** Shared parsers for Facebook GraphQL bodies (multi-line, truncated, Comet shapes). */

import type {
  FacebookMediaAttachment,
  FacebookShareInfo,
  FacebookSurface,
} from "../shared/types.js";

const NOISE_TEXT =
  /^(Public group|Your group suggestions|\d+K? members|.*posts a day|.*is a member|Ian Holmes)/i;

function countFromFeedbackField(field: unknown): number | undefined {
  if (typeof field === "number" && Number.isFinite(field)) return field;
  if (typeof field === "string") {
    const n = Number.parseInt(field, 10);
    return Number.isFinite(n) ? n : undefined;
  }
  if (!field || typeof field !== "object") return undefined;
  const obj = field as Record<string, unknown>;
  if (typeof obj.count === "number") return obj.count;
  if (typeof obj.total_count === "number") return obj.total_count;
  return undefined;
}

/** Read reaction/comment totals from a Comet Feedback node on feed stories. */
export function feedbackCounts(feedback: unknown): {
  reactionCount?: number;
  commentCount?: number;
} {
  if (!feedback || typeof feedback !== "object") return {};
  const fb = feedback as Record<string, unknown>;
  const reactionCount =
    countFromFeedbackField(fb.reaction_count) ??
    countFromFeedbackField(fb.total_reaction_count) ??
    countFromFeedbackField(fb.i18n_reaction_count);
  const commentCount =
    countFromFeedbackField(fb.comment_count) ??
    countFromFeedbackField(fb.total_comment_count) ??
    countFromFeedbackField(fb.comments_count);
  return { reactionCount, commentCount };
}

export function decodeFeedbackPostId(feedbackId?: string): string | undefined {
  const target = decodeFeedbackTarget(feedbackId);
  return target.target === "post" ? target.postId : undefined;
}

export interface FeedbackTarget {
  target: "post" | "comment" | "unknown";
  postId?: string;
  commentId?: string;
}

/** Classify feedback id as post-level or comment-level and decode linked ids. */
export function decodeFeedbackTarget(feedbackId?: string): FeedbackTarget {
  if (!feedbackId) return { target: "unknown" };
  try {
    const decoded = atob(feedbackId);
    const postOnly = decoded.match(/^feedback:(\d+)$/);
    if (postOnly) return { target: "post", postId: postOnly[1] };
    const commentMatch = decoded.match(/^feedback:(\d+)_(\d+)$/);
    if (commentMatch) {
      const postId = commentMatch[1];
      const fbid = commentMatch[2];
      return {
        target: "comment",
        postId,
        commentId: btoa(`comment:${postId}_${fbid}`),
      };
    }
  } catch {
    /* ignore */
  }
  return { target: "unknown" };
}

/** Decode post id from base64 `comment:{postId}_{fbid}` or `feedback:{postId}_{fbid}` ids. */
export function decodeCommentPostId(commentId?: string): string | undefined {
  if (!commentId) return undefined;
  try {
    const decoded = atob(commentId);
    const m = decoded.match(/^(?:comment|feedback):(\d+)_/);
    return m?.[1];
  } catch {
    return undefined;
  }
}

/** Stable dedupe key for the same comment across feedback/comment id variants. */
export function commentLegacyKey(
  id?: string,
  legacyToken?: string,
  legacyFbid?: string,
): string | undefined {
  if (legacyToken) return legacyToken;
  if (legacyFbid && id) {
    const postId = decodeCommentPostId(id);
    if (postId) return `${postId}_${legacyFbid}`;
  }
  if (!id) return undefined;
  try {
    const decoded = atob(id);
    const m = decoded.match(/^(?:comment|feedback):(\d+)_(\d+)$/);
    if (m) return `${m[1]}_${m[2]}`;
  } catch {
    /* ignore */
  }
  return id;
}

/** Prefer `comment:` ids over `feedback:` ids when merging duplicates. */
export function preferCommentId(current?: string, incoming?: string): string | undefined {
  if (!current) return incoming;
  if (!incoming) return current;
  try {
    const cur = atob(current);
    const next = atob(incoming);
    if (next.startsWith("comment:") && cur.startsWith("feedback:")) return incoming;
    if (cur.startsWith("comment:") && next.startsWith("feedback:")) return current;
  } catch {
    /* ignore */
  }
  return current.length >= incoming.length ? current : incoming;
}

export function isDialogReactionSource(source: string): boolean {
  return /CometUFIReactionsDialog/i.test(source);
}

export function isTooltipReactionSource(source: string): boolean {
  return source === "CometUFIReactionIconTooltipContentQuery";
}

/** Common Facebook reaction ids → names when localized_name is absent from payload. */
export const KNOWN_REACTION_NAMES: Readonly<Record<string, string>> = {
  "1635855486666999": "Like",
  "1678524932434102": "Love",
  "613557422527858": "Care",
  "115940658764963": "Haha",
  "908563459236466": "Wow",
  "1668917203513783": "Sad",
  "814576161897161": "Angry",
};

export function reactionTypeFromId(
  reactionId: string | undefined,
  reactionNames: ReadonlyMap<string, string>,
): string | undefined {
  if (!reactionId) return undefined;
  return reactionNames.get(reactionId) ?? KNOWN_REACTION_NAMES[reactionId];
}

/** Collect reaction id → localized_name entries from GraphQL nodes. */
export function collectReactionNames(
  node: Record<string, unknown>,
  reactionNames: Map<string, string>,
): void {
  if (typeof node.id === "string" && typeof node.localized_name === "string") {
    reactionNames.set(node.id, node.localized_name);
  }

  const reaction = node.reaction;
  if (reaction && typeof reaction === "object") {
    const r = reaction as Record<string, unknown>;
    if (typeof r.id === "string" && typeof r.localized_name === "string") {
      reactionNames.set(r.id, r.localized_name);
    }
  }

  const summary = (node.top_reactions as { summary?: unknown[] } | undefined)?.summary;
  if (Array.isArray(summary)) {
    for (const item of summary) {
      if (!item || typeof item !== "object") continue;
      const rx = (item as { reaction?: unknown }).reaction;
      if (rx && typeof rx === "object") {
        const r = rx as Record<string, unknown>;
        if (typeof r.id === "string" && typeof r.localized_name === "string") {
          reactionNames.set(r.id, r.localized_name);
        }
      }
    }
  }

  const edges = (node.top_reactions as { edges?: unknown[] } | undefined)?.edges;
  if (Array.isArray(edges)) {
    for (const edge of edges) {
      if (!edge || typeof edge !== "object") continue;
      const n = (edge as { node?: unknown }).node;
      if (n && typeof n === "object") {
        const rn = n as Record<string, unknown>;
        if (typeof rn.id === "string" && typeof rn.localized_name === "string") {
          reactionNames.set(rn.id, rn.localized_name);
        }
      }
    }
  }
}

export function unescapeJsonString(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return raw.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
}

export function isNoisePostText(text: string): boolean {
  const t = text.trim();
  if (t.length < 12) return true;
  if (NOISE_TEXT.test(t)) return true;
  if (/^\d+K? members/i.test(t)) return true;
  return false;
}

export function parseGraphqlLines(raw: string): { parsed: unknown[]; partialLines: number } {
  const parsed: unknown[] = [];
  let partialLines = 0;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      parsed.push(JSON.parse(trimmed));
    } catch {
      partialLines += 1;
    }
  }
  return { parsed, partialLines };
}

/** Extract story message text from partial / truncated JSON lines. */
export function extractStoryTextsFromPartialJson(raw: string): string[] {
  const texts: string[] = [];
  const seen = new Set<string>();
  for (const chunk of raw.split('"story":').slice(1)) {
    const m = chunk.match(/"message"\s*:\s*\{[^}]*"text"\s*:\s*"((?:\\.|[^"\\])*)"/);
    if (!m) continue;
    const text = unescapeJsonString(m[1]).trim();
    if (isNoisePostText(text) || seen.has(text)) continue;
    seen.add(text);
    texts.push(text);
  }
  return texts;
}

/** Extract comments from partial JSON via body.text or message.text. */
export function extractCommentsFromPartialJson(
  raw: string,
): { id?: string; text: string }[] {
  const out: { id?: string; text: string }[] = [];
  const seen = new Set<string>();
  const patterns = [
    /"__typename"\s*:\s*"Comment"[^}]*"id"\s*:\s*"([^"]+)"[^}]*"body"\s*:\s*\{[^}]*"text"\s*:\s*"((?:\\.|[^"\\])*)"/g,
    /"__typename"\s*:\s*"Comment"[^}]*"id"\s*:\s*"([^"]+)"[^}]*"message"\s*:\s*\{[^}]*"text"\s*:\s*"((?:\\.|[^"\\])*)"/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw)) !== null) {
      const text = unescapeJsonString(m[2]).trim();
      if (!text || seen.has(text)) continue;
      seen.add(text);
      out.push({ id: m[1], text });
    }
  }
  return out;
}

export function permalinkPostId(tabUrl?: string): string | undefined {
  if (!tabUrl) return undefined;
  return postIdFromFacebookUrl(tabUrl);
}

/** Numeric post id from `/posts/{id}` or `/permalink/{id}` URLs. */
export function postIdFromFacebookUrl(url?: string): string | undefined {
  if (!url) return undefined;
  const m = url.match(/\/(?:posts|permalink)\/(\d+)/);
  return m?.[1];
}

/** Infer browsing context from a Facebook URL (group feed, timeline, profile/page). */
export function inferFacebookSurface(url?: string): FacebookSurface {
  if (!url) return "unknown";
  try {
    const path = new URL(url).pathname;
    if (/\/groups\//i.test(path)) return "group";
    if (path === "/" || /^\/home/i.test(path) || /\/feed/i.test(path)) return "timeline";
    if (/\/posts\//i.test(path) || /\/permalink\//i.test(path)) return "page";
    return "unknown";
  } catch {
    return "unknown";
  }
}

export function groupPermalinkUrl(groupUrl: string | undefined, postId: string): string | undefined {
  if (!groupUrl) return undefined;
  const base = groupUrl.replace(/\/$/, "");
  if (base.includes("/groups/")) {
    return `${base}/permalink/${postId}/`;
  }
  return undefined;
}

function readCaption(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const caption = (value as { accessibility_caption?: unknown }).accessibility_caption;
  return typeof caption === "string" && caption.trim() ? caption.trim() : undefined;
}

function readViewerImage(value: unknown): { width?: number; height?: number } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const img = (value as { viewer_image?: { width?: unknown; height?: unknown } }).viewer_image;
  if (!img || typeof img !== "object") return undefined;
  const width = typeof img.width === "number" ? img.width : undefined;
  const height = typeof img.height === "number" ? img.height : undefined;
  if (width == null && height == null) return undefined;
  return { width, height };
}

function mediaTypeFromTypename(typename?: string): FacebookMediaAttachment["type"] {
  if (!typename) return "other";
  if (typename === "Photo") return "photo";
  if (typename === "Video") return "video";
  if (typename.includes("Link") || typename.includes("ExternalUrl")) return "link";
  return "other";
}

function mediaFromNode(media: Record<string, unknown>): FacebookMediaAttachment | undefined {
  const typename = typeof media.__typename === "string" ? media.__typename : undefined;
  const id = typeof media.id === "string" ? media.id : undefined;
  const caption = readCaption(media);
  const dims = readViewerImage(media);
  if (!id && !caption && !dims) return undefined;
  return {
    id,
    type: mediaTypeFromTypename(typename),
    caption,
    width: dims?.width,
    height: dims?.height,
  };
}

function mediaKey(m: FacebookMediaAttachment): string {
  return `${m.type}:${m.id ?? ""}:${m.caption ?? ""}`;
}

/** Extract photo/video attachments from a Story attachments array. */
export function extractMediaFromAttachments(attachments: unknown): FacebookMediaAttachment[] {
  if (!Array.isArray(attachments)) return [];
  const out: FacebookMediaAttachment[] = [];
  const seen = new Set<string>();

  for (const item of attachments) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const candidates: Record<string, unknown>[] = [];
    if (record.media && typeof record.media === "object") {
      candidates.push(record.media as Record<string, unknown>);
    }
    const styles = record.styles;
    if (styles && typeof styles === "object") {
      const attachment = (styles as { attachment?: { media?: unknown } }).attachment?.media;
      if (attachment && typeof attachment === "object") {
        candidates.push(attachment as Record<string, unknown>);
      }
    }
    const renderer = record.style_type_renderer;
    if (renderer && typeof renderer === "object") {
      const attachment = (renderer as { attachment?: { media?: unknown } }).attachment?.media;
      if (attachment && typeof attachment === "object") {
        candidates.push(attachment as Record<string, unknown>);
      }
    }
    for (const media of candidates) {
      const parsed = mediaFromNode(media);
      if (!parsed) continue;
      const key = mediaKey(parsed);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(parsed);
    }
  }
  return out;
}

function messageText(message: unknown): string | undefined {
  if (!message || typeof message !== "object") return undefined;
  const text = (message as { text?: unknown }).text;
  return typeof text === "string" && text.trim() ? text.trim() : undefined;
}

/** Build share metadata from a non-null attached_story node. */
export function shareFromAttachedStory(attached: unknown): FacebookShareInfo | undefined {
  if (!attached || typeof attached !== "object") return undefined;
  const story = attached as Record<string, unknown>;
  if (!story.id) return undefined;

  const actors = story.actors ?? story.actor;
  let originalAuthorName: string | undefined;
  if (Array.isArray(actors) && actors[0] && typeof actors[0] === "object") {
    const a = actors[0] as Record<string, unknown>;
    originalAuthorName = typeof a.name === "string" ? a.name : undefined;
  } else if (actors && typeof actors === "object") {
    const a = actors as Record<string, unknown>;
    originalAuthorName = typeof a.name === "string" ? a.name : undefined;
  }

  const originalPostId =
    typeof story.post_id === "string"
      ? story.post_id
      : typeof story.post_id === "number"
        ? String(story.post_id)
        : postIdFromFacebookUrl(typeof story.url === "string" ? story.url : undefined);

  return {
    originalPostId,
    originalAuthorName,
    originalText: messageText(story.message),
    originalUrl: typeof story.url === "string" ? story.url : undefined,
  };
}

/** Read formatted member count text from a Group node. */
export function groupMemberCountText(node: Record<string, unknown>): string | undefined {
  const profiles = node.group_member_profiles;
  if (profiles && typeof profiles === "object") {
    const text = (profiles as { formatted_count_text?: unknown }).formatted_count_text;
    if (typeof text === "string" && text.trim()) return text.trim();
  }
  const count = node.member_count;
  if (typeof count === "number") return `${count} members`;
  if (typeof count === "string" && count.trim()) return count.trim();
  return undefined;
}
