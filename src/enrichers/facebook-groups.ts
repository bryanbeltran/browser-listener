import {
  decodeFeedbackPostId,
  extractCommentsFromPartialJson,
  extractStoryTextsFromPartialJson,
  groupPermalinkUrl,
  parseGraphqlLines,
  permalinkPostId,
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

export function extractFacebookGroupActivity(
  network: NetworkEntry[],
  opts: ExtractFacebookOptions = {},
): FacebookGroupActivity {
  const groups = new Map<string, FacebookGroupSummary>();
  const people = new Map<string, FacebookPerson>();
  const posts = new Map<string, FacebookPost>();
  const comments = new Map<string, FacebookComment>();
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

  const addPost = (post: FacebookPost) => {
    const key = postKey(post.id);
    const existing = posts.get(key);
    if (!existing) {
      posts.set(key, post);
      return;
    }
    posts.set(key, {
      ...existing,
      ...post,
      text: post.text ?? existing.text,
      url: post.url ?? existing.url,
      authorName: post.authorName ?? existing.authorName,
      authorId: post.authorId ?? existing.authorId,
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
        if (!comments.has(cid)) {
          comments.set(cid, {
            id: cid,
            text: c.text,
            source,
            postId: sessionPostId,
          });
        }
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
            const text = messageText(node.message);
            const author = node.author;
            let authorName: string | undefined;
            let authorId: string | undefined;
            if (author && typeof author === "object") {
              const a = author as Record<string, unknown>;
              authorName = typeof a.name === "string" ? a.name : undefined;
              authorId = typeof a.id === "string" ? a.id : undefined;
            }
            if (!comments.has(node.id)) {
              comments.set(node.id, {
                id: node.id,
                text,
                authorId,
                authorName,
                createdAt: typeof node.created_time === "number" ? node.created_time : undefined,
                source,
                postId: sessionPostId,
              });
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
          const storyPostId =
            typeof story.post_id === "string"
              ? story.post_id
              : typeof story.post_id === "number"
                ? String(story.post_id)
                : sessionPostId;
          const url =
            typeof story.url === "string"
              ? story.url
              : storyPostId
                ? groupPermalinkUrl(primaryGroupUrl ?? opts.tabUrl, storyPostId)
                : undefined;
          addPost({
            id: story.id,
            postId: storyPostId,
            text,
            authorId,
            authorName,
            createdAt: typeof story.creation_time === "number" ? story.creation_time : undefined,
            url,
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

  const uniqueWarnings = [...new Set(parseWarnings)];

  return {
    groups: [...groups.values()],
    people: [...people.values()],
    posts: [...posts.values()],
    comments: [...comments.values()],
    reactions,
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
