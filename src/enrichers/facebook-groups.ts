import {
  commentLegacyKey,
  collectReactionNames,
  decodeCommentPostId,
  decodeFeedbackTarget,
  extractCommentsFromPartialJson,
  extractMediaFromAttachments,
  extractStoryTextsFromPartialJson,
  feedbackCounts,
  recordFeedbackCounts,
  applyFeedbackCountIndex,
  type FeedbackCountIndex,
  groupMemberCountText,
  groupPermalinkUrl,
  inferFacebookSurface,
  isDialogReactionSource,
  parseGraphqlLines,
  permalinkPostId,
  postIdFromFacebookUrl,
  preferCommentId,
  reactionTypeFromId,
  shareFromAttachedStory,
} from "./facebook-parse.js";
import type {
  FacebookComment,
  FacebookGroupActivity,
  FacebookGroupMember,
  FacebookGroupSummary,
  FacebookMediaAttachment,
  FacebookPerson,
  FacebookPost,
  FacebookReaction,
  FacebookShareInfo,
  NetworkEntry,
} from "../shared/types.js";
import type { SessionEnricher } from "./types.js";

function isFacebookGraphql(entry: NetworkEntry): boolean {
  try {
    const u = new URL(entry.url);
    return u.hostname.endsWith("facebook.com") && /\/api\/graphql\/?$/i.test(u.pathname);
  } catch {
    return false;
  }
}

function parseFormBody(body?: string): Record<string, string> {
  if (!body) return {};
  const params = new URLSearchParams(body);
  const out: Record<string, string> = {};
  params.forEach((v, k) => {
    out[k] = v;
  });
  return out;
}

function personKey(id: string, name: string): string {
  return `${id}:${name}`;
}

function postKey(id: string): string {
  return id;
}

function walk(
  value: unknown,
  visit: (node: Record<string, unknown>, path: string) => void,
  path = "",
  depth = 0,
): void {
  if (depth > 32 || value == null) return;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) walk(value[i], visit, `${path}[${i}]`, depth + 1);
    return;
  }
  if (typeof value !== "object") return;
  const node = value as Record<string, unknown>;
  visit(node, path);
  for (const [k, v] of Object.entries(node)) {
    walk(v, visit, path ? `${path}.${k}` : k, depth + 1);
  }
}

function messageText(message: unknown): string | undefined {
  if (!message || typeof message !== "object") return undefined;
  const text = (message as { text?: unknown }).text;
  return typeof text === "string" && text.trim() ? text.trim() : undefined;
}

function attachmentCaption(attachments: unknown): string | undefined {
  const media = extractMediaFromAttachments(attachments);
  return media.find((m) => m.caption)?.caption;
}

function mediaRichness(m: FacebookMediaAttachment): number {
  return (m.caption ? 4 : 0) + (m.width ? 2 : 0) + (m.height ? 1 : 0);
}

function mergeMedia(
  existing?: FacebookMediaAttachment[],
  incoming?: FacebookMediaAttachment[],
): FacebookMediaAttachment[] | undefined {
  const merged = [...(existing ?? []), ...(incoming ?? [])];
  if (!merged.length) return undefined;
  const byKey = new Map<string, FacebookMediaAttachment>();
  for (const item of merged) {
    const key = `${item.type}:${item.id ?? item.caption ?? ""}`;
    const prev = byKey.get(key);
    if (!prev || mediaRichness(item) > mediaRichness(prev)) {
      byKey.set(key, item);
    }
  }
  const out = [...byKey.values()];
  return out.length ? out : undefined;
}

function mergeShare(
  existing?: FacebookShareInfo,
  incoming?: FacebookShareInfo,
): FacebookShareInfo | undefined {
  if (!existing) return incoming;
  if (!incoming) return existing;
  return {
    originalPostId: incoming.originalPostId ?? existing.originalPostId,
    originalAuthorName: incoming.originalAuthorName ?? existing.originalAuthorName,
    originalText: incoming.originalText ?? existing.originalText,
    originalUrl: incoming.originalUrl ?? existing.originalUrl,
  };
}

function commentText(node: Record<string, unknown>): string | undefined {
  const body = node.body;
  if (body && typeof body === "object") {
    const fromBody = messageText(body);
    if (fromBody) return fromBody;
  }
  const fromMessage = messageText(node.message);
  if (fromMessage) return fromMessage;
  return attachmentCaption(node.attachments);
}

function commentCreatedAt(node: Record<string, unknown>): number | undefined {
  if (typeof node.created_time === "number") return node.created_time;
  if (typeof node.creation_time === "number") return node.creation_time;
  return undefined;
}

function storyFromNode(node: Record<string, unknown>): Record<string, unknown> | null {
  if (node.__typename === "Story") return node;
  const story = node.story;
  if (story && typeof story === "object") return story as Record<string, unknown>;
  const typename = node.__typename;
  if (typeof typename === "string" && typename.includes("CometFeedStory")) {
    const nested = node.story;
    if (nested && typeof nested === "object") return nested as Record<string, unknown>;
  }
  return null;
}

export interface ExtractFacebookOptions {
  tabUrl?: string;
}

function postRichness(post: FacebookPost): number {
  let score = 0;
  if (post.text) score += Math.min(post.text.length, 500);
  if (post.authorName) score += 20;
  if (post.authorId) score += 5;
  if (post.url) score += 10;
  if (post.feedbackId) score += 5;
  if (post.media?.length) score += 30;
  if (post.share) score += 15;
  if (!post.partialParse) score += 100;
  if (post.createdAt) score += 3;
  return score;
}

function mergePosts(primary: FacebookPost, secondary: FacebookPost): FacebookPost {
  const richer = postRichness(primary) >= postRichness(secondary) ? primary : secondary;
  const other = richer === primary ? secondary : primary;
  return {
    ...other,
    ...richer,
    id: richer.id,
    postId: richer.postId ?? other.postId,
    text:
      (richer.text?.length ?? 0) >= (other.text?.length ?? 0) ? richer.text : other.text,
    authorName: richer.authorName ?? other.authorName,
    authorId: richer.authorId ?? other.authorId,
    url: richer.url ?? other.url,
    feedbackId: richer.feedbackId ?? other.feedbackId,
    partialParse: Boolean(richer.partialParse && other.partialParse),
    reactionCount:
      richer.reactionCount != null && other.reactionCount != null
        ? Math.max(richer.reactionCount, other.reactionCount)
        : richer.reactionCount ?? other.reactionCount,
    commentCount:
      richer.commentCount != null && other.commentCount != null
        ? Math.max(richer.commentCount, other.commentCount)
        : richer.commentCount ?? other.commentCount,
    media: mergeMedia(other.media, richer.media),
    share: mergeShare(other.share, richer.share),
    createdAt: richer.createdAt ?? other.createdAt,
    source: richer.source || other.source,
  };
}

function normalizePostTextForMatch(text?: string): string {
  if (!text) return "";
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function postsMatchByText(a: FacebookPost, b: FacebookPost): boolean {
  const left = normalizePostTextForMatch(a.text);
  const right = normalizePostTextForMatch(b.text);
  if (!left || !right) return false;
  if (left === right) return true;
  const minLen = Math.min(left.length, right.length);
  if (minLen < 20) return false;
  const prefixLen = Math.min(40, minLen);
  return left.slice(0, prefixLen) === right.slice(0, prefixLen);
}

/** Drop regex-fallback partial posts when a full parse exists for the same text. */
function dedupePartialPosts(posts: FacebookPost[]): FacebookPost[] {
  const fullPosts = posts.filter((post) => !post.partialParse && post.text);
  return posts.filter((post) => {
    if (!post.partialParse) return true;
    return !fullPosts.some((full) => postsMatchByText(post, full));
  });
}

function dedupePostsByPostId(posts: FacebookPost[]): FacebookPost[] {
  const withoutPostId: FacebookPost[] = [];
  const byPostId = new Map<string, FacebookPost>();

  for (const post of posts) {
    const postId = post.postId ?? postIdFromFacebookUrl(post.url);
    if (!postId) {
      withoutPostId.push(post);
      continue;
    }
    const normalized = post.postId ? post : { ...post, postId };
    const existing = byPostId.get(postId);
    byPostId.set(postId, existing ? mergePosts(existing, normalized) : normalized);
  }

  return [...withoutPostId, ...byPostId.values()];
}

function pushReactor(
  reactions: FacebookReaction[],
  addPerson: (p: Omit<FacebookPerson, "source"> & { source: string }) => void,
  args: {
    feedbackId?: string;
    userId: string;
    userName: string;
    reactionType?: string;
    reactionCount?: number;
    source: string;
  },
): void {
  const target = decodeFeedbackTarget(args.feedbackId);
  if (target.target === "comment" && target.commentId) {
    reactions.push({
      feedbackId: args.feedbackId,
      postId: target.postId,
      commentId: target.commentId,
      target: "comment",
      userId: args.userId,
      userName: args.userName,
      reactionType: args.reactionType,
      reactionCount: args.reactionCount,
      source: args.source,
    });
  } else if (target.target === "post" && target.postId) {
    reactions.push({
      feedbackId: args.feedbackId,
      postId: target.postId,
      target: "post",
      userId: args.userId,
      userName: args.userName,
      reactionType: args.reactionType,
      reactionCount: args.reactionCount,
      source: args.source,
    });
  }
  addPerson({ id: args.userId, name: args.userName, source: args.source });
}
function backfillReactionTypes(reactions: FacebookReaction[]): FacebookReaction[] {
  const typed = new Map<string, string>();
  for (const reaction of reactions) {
    if (!reaction.reactionType) continue;
    const key =
      reaction.target === "comment" && reaction.commentId
        ? `comment:${reaction.commentId}:${reaction.userId}`
        : reaction.postId
          ? `post:${reaction.postId}:${reaction.userId}`
          : undefined;
    if (key) typed.set(key, reaction.reactionType);
  }

  return reactions.map((reaction) => {
    if (reaction.reactionType) return reaction;
    const key =
      reaction.target === "comment" && reaction.commentId
        ? `comment:${reaction.commentId}:${reaction.userId}`
        : reaction.postId
          ? `post:${reaction.postId}:${reaction.userId}`
          : undefined;
    const fromPeer = key ? typed.get(key) : undefined;
    return fromPeer ? { ...reaction, reactionType: fromPeer } : reaction;
  });
}

function consolidateReactionBucket(
  raw: FacebookReaction[],
  keyFor: (reaction: FacebookReaction) => string | undefined,
  hintPrefix: string,
): { reactions: FacebookReaction[]; hints: string[] } {
  const hints: string[] = [];
  const byKey = new Map<string, FacebookReaction[]>();
  const unmatched: FacebookReaction[] = [];

  for (const reaction of raw) {
    const key = keyFor(reaction);
    if (!key) {
      unmatched.push(reaction);
      continue;
    }
    const list = byKey.get(key) ?? [];
    list.push(reaction);
    byKey.set(key, list);
  }

  const out: FacebookReaction[] = [...unmatched];
  for (const [key, list] of byKey) {
    const dialog = list.filter((r) => isDialogReactionSource(r.source));
    const chosen = dialog.length > 0 ? dialog : list;
    const seen = new Set<string>();
    for (const reaction of chosen) {
      if (seen.has(reaction.userId)) continue;
      seen.add(reaction.userId);
      out.push(reaction);
    }
    if (dialog.length === 0 && list.length > 0) {
      const total = list[0]?.reactionCount;
      const captured = seen.size;
      if (total != null && total > captured) {
        hints.push(
          `${hintPrefix} ${key}: only reaction tooltip captured (${captured}/${total}) — open full reactions dialog for complete list`,
        );
      }
    }
  }

  return { reactions: out, hints };
}

function consolidateReactions(
  raw: FacebookReaction[],
): { reactions: FacebookReaction[]; hints: string[] } {
  const postRaw = raw.filter((r) => r.target !== "comment");
  const commentRaw = raw.filter((r) => r.target === "comment");
  const posts = consolidateReactionBucket(postRaw, (r) => r.postId, "Post");
  const comments = consolidateReactionBucket(commentRaw, (r) => r.commentId, "Comment");
  return {
    reactions: [...posts.reactions, ...comments.reactions],
    hints: [...posts.hints, ...comments.hints],
  };
}

function toLinkedReaction(r: FacebookReaction) {
  return {
    userId: r.userId,
    userName: r.userName,
    reactionType: r.reactionType,
  };
}

function attachPostContext(
  posts: FacebookPost[],
  groups: FacebookGroupSummary[],
  tabUrl?: string,
): FacebookPost[] {
  const primaryGroup = groups[0];
  const sessionSurface = inferFacebookSurface(tabUrl);
  return posts.map((post) => {
    const url = post.url ?? tabUrl;
    let surface = post.surface ?? inferFacebookSurface(url);
    if (surface === "unknown") surface = sessionSurface;
    const inGroup = surface === "group";
    return {
      ...post,
      surface,
      groupId: post.groupId ?? (inGroup ? primaryGroup?.id : undefined),
      groupName: post.groupName ?? (inGroup ? primaryGroup?.name : undefined),
    };
  });
}

function linkCommentsToReactions(
  comments: FacebookComment[],
  reactions: FacebookReaction[],
): FacebookComment[] {
  const byCommentId = new Map<string, FacebookReaction[]>();
  const byLegacyKey = new Map<string, FacebookReaction[]>();

  for (const reaction of reactions) {
    if (reaction.target !== "comment" || !reaction.commentId) continue;
    const list = byCommentId.get(reaction.commentId) ?? [];
    list.push(reaction);
    byCommentId.set(reaction.commentId, list);
    const legacy = commentLegacyKey(reaction.commentId);
    if (legacy) {
      const legacyList = byLegacyKey.get(legacy) ?? [];
      legacyList.push(reaction);
      byLegacyKey.set(legacy, legacyList);
    }
  }

  return comments.map((comment) => {
    const legacy = commentLegacyKey(comment.id);
    const matched = [
      ...(byCommentId.get(comment.id) ?? []),
      ...(legacy ? byLegacyKey.get(legacy) ?? [] : []),
    ];
    if (!matched.length) return comment;

    const seen = new Set<string>();
    const unique: FacebookReaction[] = [];
    for (const reaction of matched) {
      if (seen.has(reaction.userId)) continue;
      seen.add(reaction.userId);
      unique.push(reaction);
    }

    return {
      ...comment,
      reactionCount: unique.length,
      linkedReactions: unique.map(toLinkedReaction),
    };
  });
}

function linkPostsToComments(
  posts: FacebookPost[],
  comments: FacebookComment[],
): FacebookPost[] {
  const byPostId = new Map<string, FacebookComment[]>();
  for (const c of comments) {
    if (!c.postId) continue;
    const list = byPostId.get(c.postId) ?? [];
    list.push(c);
    byPostId.set(c.postId, list);
  }

  return posts.map((post) => {
    const postId = post.postId ?? postIdFromFacebookUrl(post.url);
    const matched = postId ? byPostId.get(postId) ?? [] : [];
    if (matched.length === 0) {
      return postId && !post.postId ? { ...post, postId } : post;
    }
    return {
      ...post,
      postId,
      commentCount:
        post.commentCount != null
          ? Math.max(post.commentCount, matched.length)
          : matched.length,
      linkedComments: matched.map((c) => ({
        id: c.id,
        authorName: c.authorName,
        text: c.text,
        createdAt: c.createdAt,
        reactionCount: c.reactionCount,
        linkedReactions: c.linkedReactions,
      })),
    };
  });
}

function linkPostsToReactions(
  posts: FacebookPost[],
  reactions: FacebookReaction[],
): FacebookPost[] {
  const byPostId = new Map<string, FacebookReaction[]>();
  for (const r of reactions) {
    if (!r.postId || r.target === "comment") continue;
    const list = byPostId.get(r.postId) ?? [];
    list.push(r);
    byPostId.set(r.postId, list);
  }

  const linked = posts.map((post) => {
    const postId = post.postId ?? postIdFromFacebookUrl(post.url);
    const matched = postId ? byPostId.get(postId) ?? [] : [];
    if (matched.length === 0) {
      return postId && !post.postId ? { ...post, postId } : post;
    }
    return {
      ...post,
      postId,
      feedbackId: post.feedbackId ?? matched[0]?.feedbackId,
      reactionCount:
        post.reactionCount != null
          ? Math.max(post.reactionCount, matched.length)
          : matched.length,
      linkedReactions: matched.map(toLinkedReaction),
    };
  });

  for (const [postId, matched] of byPostId) {
    if (linked.some((p) => p.postId === postId)) continue;
    linked.push({
      id: `reactions-only:${postId}`,
      postId,
      feedbackId: matched[0]?.feedbackId,
      source: "reactions_inferred",
      reactionCount: matched.length,
      linkedReactions: matched.map(toLinkedReaction),
    });
  }

  return linked;
}

function linkPosts(
  posts: FacebookPost[],
  reactions: FacebookReaction[],
  comments: FacebookComment[],
): FacebookPost[] {
  return linkPostsToComments(linkPostsToReactions(posts, reactions), comments);
}

export function extractFacebookGroupActivity(
  network: NetworkEntry[],
  opts: ExtractFacebookOptions = {},
): FacebookGroupActivity {
  const groups = new Map<string, FacebookGroupSummary>();
  const members = new Map<string, FacebookGroupMember>();
  const people = new Map<string, FacebookPerson>();
  const reactionNames = new Map<string, string>();
  const feedbackCountIndex: FeedbackCountIndex = new Map();
  const posts = new Map<string, FacebookPost>();
  const comments = new Map<string, FacebookComment>();
  const commentKeys = new Map<string, string>();
  const reactions: FacebookReaction[] = [];
  const queryHints = new Map<string, { docId: string; friendlyName?: string; count: number }>();
  const parseWarnings: string[] = [];
  const sessionPostId = permalinkPostId(opts.tabUrl);
  let primaryGroupUrl: string | undefined;

  const addPerson = (p: Omit<FacebookPerson, "source"> & { source: string }) => {
    if (!p.id || !p.name) return;
    const key = personKey(p.id, p.name);
    if (!people.has(key)) people.set(key, p);
  };

  const addGroup = (
    id: string,
    name?: string,
    url?: string,
    memberCountText?: string,
  ) => {
    const existing = groups.get(id);
    if (existing) {
      groups.set(id, {
        id,
        name: name ?? existing.name,
        url: url ?? existing.url,
        memberCountText: memberCountText ?? existing.memberCountText,
      });
    } else {
      groups.set(id, { id, name, url, memberCountText });
    }
    if (url?.includes("/groups/") && !primaryGroupUrl) primaryGroupUrl = url;
  };

  const addMember = (member: FacebookGroupMember) => {
    const key = `${member.userId}:${member.groupId ?? ""}`;
    if (!members.has(key)) members.set(key, member);
  };

  const normalizePost = (post: FacebookPost): FacebookPost => ({
    ...post,
    postId: post.postId ?? postIdFromFacebookUrl(post.url),
  });

  const addPost = (post: FacebookPost) => {
    const normalized = normalizePost(post);
    const key = postKey(normalized.id);
    const existing = posts.get(key);
    if (!existing) {
      posts.set(key, normalized);
      return;
    }
    posts.set(key, normalizePost({
      ...existing,
      ...normalized,
      text: normalized.text ?? existing.text,
      url: normalized.url ?? existing.url,
      authorName: normalized.authorName ?? existing.authorName,
      authorId: normalized.authorId ?? existing.authorId,
      postId: normalized.postId ?? existing.postId,
      feedbackId: normalized.feedbackId ?? existing.feedbackId,
      media: mergeMedia(existing.media, normalized.media),
      share: mergeShare(existing.share, normalized.share),
    }));
  };

  const addComment = (
    comment: FacebookComment,
    legacyKey?: string,
  ) => {
    const postId =
      comment.postId ?? decodeCommentPostId(comment.id) ?? sessionPostId ?? undefined;
    const normalized: FacebookComment = { ...comment, postId };
    const key = legacyKey ?? commentLegacyKey(normalized.id) ?? normalized.id;
    const existingId = commentKeys.get(key);
    const existing = existingId ? comments.get(existingId) : undefined;
    if (!existing) {
      commentKeys.set(key, normalized.id);
      comments.set(normalized.id, normalized);
      return;
    }
    const mergedId = preferCommentId(existing.id, normalized.id) ?? existing.id;
    if (mergedId !== existing.id) {
      comments.delete(existing.id);
      commentKeys.set(key, mergedId);
    }
    comments.set(mergedId, {
      ...existing,
      ...normalized,
      id: mergedId,
      text: normalized.text ?? existing.text,
      authorName: normalized.authorName ?? existing.authorName,
      authorId: normalized.authorId ?? existing.authorId,
      postId: normalized.postId ?? existing.postId,
      createdAt: normalized.createdAt ?? existing.createdAt,
    });
  };

  for (const entry of network) {
    if (!isFacebookGraphql(entry)) continue;

    const form = parseFormBody(entry.requestBody);
    const docId = form.doc_id;
    const friendlyName = form.fb_api_req_friendly_name;
    if (docId) {
      const existing = queryHints.get(docId);
      if (existing) existing.count += 1;
      else queryHints.set(docId, { docId, friendlyName, count: 1 });
    }

    const source = friendlyName ?? docId ?? entry.id;
    if (!entry.responseBody) continue;

    if (entry.responseBodyTruncated) {
      parseWarnings.push(
        `Truncated GraphQL body (${source}, ${entry.responseBodySize ?? "?"} bytes)`,
      );
    }

    const { parsed, partialLines } = parseGraphqlLines(entry.responseBody);
    if (partialLines > 0) {
      parseWarnings.push(
        `Partial JSON line(s) in ${source} — regex fallback used for posts/comments`,
      );
      for (const text of extractStoryTextsFromPartialJson(entry.responseBody)) {
        const id = `partial:${source}:${text.slice(0, 40)}`;
        addPost({
          id,
          text,
          source,
          partialParse: true,
          postId: sessionPostId,
          url:
            sessionPostId && opts.tabUrl?.includes("/permalink/")
              ? opts.tabUrl
              : undefined,
        });
      }
      for (const c of extractCommentsFromPartialJson(entry.responseBody)) {
        const cid = c.id ?? `partial-comment:${c.text.slice(0, 40)}`;
        addComment({
          id: cid,
          text: c.text,
          source,
          postId: decodeCommentPostId(c.id) ?? sessionPostId,
        });
      }
    }

    for (const root of parsed) {
      walk(root, (node) => {
        collectReactionNames(node, reactionNames);
        recordFeedbackCounts(node, feedbackCountIndex);

        const hovercard = node.comet_hovercard_renderer;
        if (hovercard && typeof hovercard === "object") {
          const renderer = hovercard as Record<string, unknown>;
          if (renderer.__typename === "CometHovercardGroupMemberRenderer") {
            const actor = renderer.actor;
            if (actor && typeof actor === "object") {
              const a = actor as Record<string, unknown>;
              const userId = typeof a.id === "string" ? a.id : undefined;
              const name = typeof a.name === "string" ? a.name : undefined;
              const groupNode =
                (renderer.group as Record<string, unknown> | undefined) ??
                (
                  (renderer.group_membership as { group?: unknown } | undefined)?.group as
                    | Record<string, unknown>
                    | undefined
                );
              const groupId = typeof groupNode?.id === "string" ? groupNode.id : undefined;
              const groupName = typeof groupNode?.name === "string" ? groupNode.name : undefined;
              const membership = renderer.group_membership as { role?: unknown } | undefined;
              const role = typeof membership?.role === "string" ? membership.role : undefined;
              if (userId && name) {
                addMember({ userId, name, groupId, groupName, role, source });
                addPerson({ id: userId, name, source });
              }
            }
          }
        }

        const feedbackNode =
          node.__typename === "Feedback"
            ? node
            : node.feedback && typeof node.feedback === "object"
              ? (node.feedback as Record<string, unknown>)
              : null;
        if (feedbackNode) {
          const feedbackId = typeof feedbackNode.id === "string" ? feedbackNode.id : undefined;
          const total =
            feedbackNode.total_reaction_count &&
            typeof feedbackNode.total_reaction_count === "object" &&
            typeof (feedbackNode.total_reaction_count as { count?: unknown }).count === "number"
              ? (feedbackNode.total_reaction_count as { count: number }).count
              : undefined;
          const reactors = feedbackNode.reactors as
            | { nodes?: unknown[]; edges?: unknown[] }
            | undefined;
          for (const edge of reactors?.edges ?? []) {
            if (!edge || typeof edge !== "object") continue;
            const e = edge as Record<string, unknown>;
            const user = e.node;
            if (!user || typeof user !== "object") continue;
            const u = user as Record<string, unknown>;
            const userId = typeof u.id === "string" ? u.id : undefined;
            const userName = typeof u.name === "string" ? u.name : undefined;
            if (!userId || !userName) continue;
            const reactionInfo = e.feedback_reaction_info as { id?: string } | undefined;
            const reactionType = reactionTypeFromId(reactionInfo?.id, reactionNames);
            pushReactor(reactions, addPerson, {
              feedbackId,
              userId,
              userName,
              reactionType,
              reactionCount: total,
              source,
            });
          }
          for (const r of reactors?.nodes ?? []) {
            if (!r || typeof r !== "object") continue;
            const u = r as Record<string, unknown>;
            if (u.__typename === "User" && typeof u.id === "string" && typeof u.name === "string") {
              pushReactor(reactions, addPerson, {
                feedbackId,
                userId: u.id,
                userName: u.name,
                reactionCount: total,
                source,
              });
            }
          }
        }

        const typename = node.__typename;
        if (typeof typename === "string") {
          if (typename === "Group" && typeof node.id === "string") {
            addGroup(
              node.id,
              typeof node.name === "string" ? node.name : undefined,
              typeof node.url === "string" ? node.url : undefined,
              groupMemberCountText(node),
            );
          }

          if (typename === "User" && typeof node.id === "string" && typeof node.name === "string") {
            addPerson({
              id: node.id,
              name: node.name,
              url: typeof node.url === "string" ? node.url : undefined,
              source,
            });
          }

          if (typename === "Comment" && typeof node.id === "string") {
            const text = commentText(node);
            const author = node.author;
            let authorName: string | undefined;
            let authorId: string | undefined;
            if (author && typeof author === "object") {
              const a = author as Record<string, unknown>;
              authorName = typeof a.name === "string" ? a.name : undefined;
              authorId = typeof a.id === "string" ? a.id : undefined;
            }
            const legacyToken =
              typeof node.legacy_token === "string" ? node.legacy_token : undefined;
            const legacyFbid =
              typeof node.legacy_fbid === "string" ? node.legacy_fbid : undefined;
            addComment(
              {
                id: node.id,
                text,
                authorId,
                authorName,
                createdAt: commentCreatedAt(node),
                source,
                postId: decodeCommentPostId(node.id) ?? sessionPostId,
              },
              commentLegacyKey(node.id, legacyToken, legacyFbid),
            );
            if (authorId && authorName) {
              addPerson({ id: authorId, name: authorName, source });
            }
          }
        }

        const story = storyFromNode(node);
        if (story && typeof story.id === "string") {
          const text = messageText(story.message);
          const actors = story.actors ?? story.actor;
          let authorName: string | undefined;
          let authorId: string | undefined;
          if (Array.isArray(actors) && actors[0] && typeof actors[0] === "object") {
            const a = actors[0] as Record<string, unknown>;
            authorName = typeof a.name === "string" ? a.name : undefined;
            authorId = typeof a.id === "string" ? a.id : undefined;
          } else if (actors && typeof actors === "object") {
            const a = actors as Record<string, unknown>;
            authorName = typeof a.name === "string" ? a.name : undefined;
            authorId = typeof a.id === "string" ? a.id : undefined;
          }
          const url =
            typeof story.url === "string"
              ? story.url
              : undefined;
          const storyPostId =
            postIdFromFacebookUrl(url) ??
            (typeof story.post_id === "string"
              ? story.post_id
              : typeof story.post_id === "number"
                ? String(story.post_id)
                : sessionPostId);
          const storyFeedbackObj =
            story.feedback && typeof story.feedback === "object"
              ? (story.feedback as Record<string, unknown>)
              : undefined;
          const storyFeedback =
            typeof storyFeedbackObj?.id === "string" ? storyFeedbackObj.id : undefined;
          const feedCounts = feedbackCounts(storyFeedbackObj);
          const media = extractMediaFromAttachments(story.attachments);
          const share = shareFromAttachedStory(story.attached_story);
          addPost({
            id: story.id,
            postId: storyPostId,
            feedbackId: storyFeedback,
            text,
            authorId,
            authorName,
            createdAt: typeof story.creation_time === "number" ? story.creation_time : undefined,
            url:
              url ??
              (storyPostId
                ? groupPermalinkUrl(primaryGroupUrl ?? opts.tabUrl, storyPostId)
                : undefined),
            source,
            reactionCount: feedCounts.reactionCount,
            commentCount: feedCounts.commentCount,
            media: media.length ? media : undefined,
            share,
          });
        }
      });
    }
  }

  // Link permalink session post to reactions without explicit post rows
  if (sessionPostId && opts.tabUrl?.includes("/permalink/")) {
    const hasPost = [...posts.values()].some((p) => p.postId === sessionPostId);
    if (!hasPost) {
      const reactionForPost = reactions.find((r) => r.postId === sessionPostId);
      addPost({
        id: `permalink:${sessionPostId}`,
        postId: sessionPostId,
        url: opts.tabUrl,
        source: "session_tabUrl",
        feedbackId: reactionForPost?.feedbackId,
      });
    }
  }

  const postList = [...posts.values()];
  applyFeedbackCountIndex(postList, feedbackCountIndex);
  const { reactions: mergedReactions, hints: reactionHints } = consolidateReactions(
    backfillReactionTypes(reactions),
  );
  const linkedComments = linkCommentsToReactions([...comments.values()], mergedReactions);
  const dedupedPosts = dedupePartialPosts(dedupePostsByPostId(postList));
  const linkedPosts = attachPostContext(
    linkPosts(dedupedPosts, mergedReactions, linkedComments),
    [...groups.values()],
    opts.tabUrl,
  );
  const uniqueWarnings = [...new Set([...parseWarnings, ...reactionHints])];

  return {
    groups: [...groups.values()],
    members: [...members.values()],
    people: [...people.values()],
    posts: linkedPosts,
    comments: linkedComments,
    reactions: mergedReactions,
    graphqlQueryHints: [...queryHints.values()].sort((a, b) => b.count - a.count),
    sessionPermalink: opts.tabUrl?.includes("/permalink/") ? opts.tabUrl : undefined,
    parseWarnings: uniqueWarnings.length ? uniqueWarnings : undefined,
  };
}

export const facebookGroupsEnricher: SessionEnricher = {
  id: "facebook-groups",
  label: "Facebook activity",
  enrich(data) {
    const activity = extractFacebookGroupActivity(data.network, {
      tabUrl: data.session?.tabUrl,
    });
    const hasData =
      activity.groups.length > 0 ||
      activity.members.length > 0 ||
      activity.people.length > 0 ||
      activity.posts.length > 0 ||
      activity.comments.length > 0 ||
      activity.reactions.length > 0;
    if (!hasData) return data;
    return {
      ...data,
      enrichments: { ...data.enrichments, facebookGroups: activity },
    };
  },
};
