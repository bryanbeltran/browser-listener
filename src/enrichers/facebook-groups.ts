import {
  commentLegacyKey,
  decodeCommentPostId,
  decodeFeedbackPostId,
  extractCommentsFromPartialJson,
  extractStoryTextsFromPartialJson,
  groupPermalinkUrl,
  isDialogReactionSource,
  parseGraphqlLines,
  permalinkPostId,
  postIdFromFacebookUrl,
  preferCommentId,
} from "./facebook-parse.js";
import type {
  FacebookComment,
  FacebookGroupActivity,
  FacebookGroupSummary,
  FacebookPerson,
  FacebookPost,
  FacebookReaction,
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

function readCaption(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const caption = (value as { accessibility_caption?: unknown }).accessibility_caption;
  return typeof caption === "string" && caption.trim() ? caption.trim() : undefined;
}

function attachmentCaption(attachments: unknown): string | undefined {
  if (!Array.isArray(attachments)) return undefined;
  for (const item of attachments) {
    if (!item || typeof item !== "object") continue;
    const renderer = (item as Record<string, unknown>).style_type_renderer;
    if (!renderer || typeof renderer !== "object") continue;
    const attachment = (renderer as Record<string, unknown>).attachment;
    if (!attachment || typeof attachment !== "object") continue;
    const fromAttachment = readCaption(attachment);
    if (fromAttachment) return fromAttachment;
    const media = (attachment as { media?: unknown }).media;
    const fromMedia = readCaption(media);
    if (fromMedia) return fromMedia;
  }
  return undefined;
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

function consolidateReactions(
  raw: FacebookReaction[],
): { reactions: FacebookReaction[]; hints: string[] } {
  const hints: string[] = [];
  const byPost = new Map<string, FacebookReaction[]>();
  const noPost: FacebookReaction[] = [];

  for (const r of raw) {
    if (!r.postId) {
      noPost.push(r);
      continue;
    }
    const list = byPost.get(r.postId) ?? [];
    list.push(r);
    byPost.set(r.postId, list);
  }

  const out: FacebookReaction[] = [...noPost];
  for (const [postId, list] of byPost) {
    const dialog = list.filter((r) => isDialogReactionSource(r.source));
    const chosen = dialog.length > 0 ? dialog : list;
    const seen = new Set<string>();
    for (const r of chosen) {
      if (seen.has(r.userId)) continue;
      seen.add(r.userId);
      out.push(r);
    }
    if (dialog.length === 0 && list.length > 0) {
      const total = list[0]?.reactionCount;
      const captured = seen.size;
      if (total != null && total > captured) {
        hints.push(
          `Post ${postId}: only reaction tooltip captured (${captured}/${total}) — open full reactions dialog for complete list`,
        );
      }
    }
  }

  return { reactions: out, hints };
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
      commentCount: matched.length,
      linkedComments: matched.map((c) => ({
        id: c.id,
        authorName: c.authorName,
        text: c.text,
        createdAt: c.createdAt,
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
    if (!r.postId) continue;
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
      reactionCount: matched.length,
      linkedReactions: matched.map((r) => ({ userId: r.userId, userName: r.userName })),
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
      linkedReactions: matched.map((r) => ({ userId: r.userId, userName: r.userName })),
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
  const people = new Map<string, FacebookPerson>();
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

  const addGroup = (id: string, name?: string, url?: string) => {
    const existing = groups.get(id);
    if (existing) {
      groups.set(id, {
        id,
        name: name ?? existing.name,
        url: url ?? existing.url,
      });
    } else {
      groups.set(id, { id, name, url });
    }
    if (url?.includes("/groups/") && !primaryGroupUrl) primaryGroupUrl = url;
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
        const feedbackNode =
          node.__typename === "Feedback"
            ? node
            : node.feedback && typeof node.feedback === "object"
              ? (node.feedback as Record<string, unknown>)
              : null;
        if (feedbackNode) {
          const feedbackId = typeof feedbackNode.id === "string" ? feedbackNode.id : undefined;
          const postId = decodeFeedbackPostId(feedbackId);
          const total =
            feedbackNode.total_reaction_count &&
            typeof feedbackNode.total_reaction_count === "object" &&
            typeof (feedbackNode.total_reaction_count as { count?: unknown }).count === "number"
              ? (feedbackNode.total_reaction_count as { count: number }).count
              : undefined;
          const reactors = feedbackNode.reactors as { nodes?: unknown[] } | undefined;
          for (const r of reactors?.nodes ?? []) {
            if (!r || typeof r !== "object") continue;
            const u = r as Record<string, unknown>;
            if (u.__typename === "User" && typeof u.id === "string" && typeof u.name === "string") {
              reactions.push({
                feedbackId,
                postId,
                userId: u.id,
                userName: u.name,
                reactionCount: total,
                source,
              });
              addPerson({ id: u.id, name: u.name, source });
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
          const storyFeedback =
            story.feedback && typeof story.feedback === "object"
              ? (story.feedback as { id?: string }).id
              : undefined;
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

  const { reactions: mergedReactions, hints: reactionHints } = consolidateReactions(reactions);
  const linkedPosts = linkPosts([...posts.values()], mergedReactions, [...comments.values()]);
  const uniqueWarnings = [...new Set([...parseWarnings, ...reactionHints])];

  return {
    groups: [...groups.values()],
    people: [...people.values()],
    posts: linkedPosts,
    comments: [...comments.values()],
    reactions: mergedReactions,
    graphqlQueryHints: [...queryHints.values()].sort((a, b) => b.count - a.count),
    sessionPermalink: opts.tabUrl?.includes("/permalink/") ? opts.tabUrl : undefined,
    parseWarnings: uniqueWarnings.length ? uniqueWarnings : undefined,
  };
}

export const facebookGroupsEnricher: SessionEnricher = {
  id: "facebook-groups",
  label: "Facebook Groups activity",
  enrich(data) {
    const activity = extractFacebookGroupActivity(data.network, {
      tabUrl: data.session?.tabUrl,
    });
    const hasData =
      activity.groups.length > 0 ||
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
