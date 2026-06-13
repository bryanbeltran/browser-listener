import type {
  FacebookComment,
  FacebookGroupMember,
  FacebookPerson,
  FacebookPost,
  FacebookReaction,
} from "../shared/types.js";
import { commentLegacyKey } from "./facebook-parse.js";

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export interface AuthorIdBackfillContext {
  people: FacebookPerson[];
  members?: Pick<FacebookGroupMember, "userId" | "name">[];
  posts?: Pick<FacebookPost, "authorId" | "authorName">[];
  comments?: Pick<FacebookComment, "authorId" | "authorName">[];
  reactors?: Pick<FacebookReaction, "userId" | "userName">[];
}

/** One person per Facebook user id; merge display names (prefer longer). */
export function dedupePeopleById(people: FacebookPerson[]): FacebookPerson[] {
  const byId = new Map<string, FacebookPerson>();
  for (const person of people) {
    if (!person.id) continue;
    const existing = byId.get(person.id);
    if (!existing) {
      byId.set(person.id, person);
      continue;
    }
    byId.set(person.id, {
      ...existing,
      name:
        person.name.length > existing.name.length ? person.name : existing.name,
      url: person.url ?? existing.url,
      source: existing.source,
    });
  }
  return [...byId.values()];
}

function buildNameToIdMap(pairs: { id: string; name: string }[]): Map<string, string> {
  const counts = new Map<string, Set<string>>();
  for (const { id, name } of pairs) {
    if (!id || !name) continue;
    const key = normalizeName(name);
    const ids = counts.get(key) ?? new Set<string>();
    ids.add(id);
    counts.set(key, ids);
  }
  const out = new Map<string, string>();
  for (const [name, ids] of counts) {
    if (ids.size === 1) out.set(name, [...ids][0]!);
  }
  return out;
}

export function buildAuthorNameToIdMap(context: AuthorIdBackfillContext): Map<string, string> {
  const pairs: { id: string; name: string }[] = [];
  for (const p of context.people) {
    if (p.id && p.name) pairs.push({ id: p.id, name: p.name });
  }
  for (const m of context.members ?? []) {
    if (m.userId && m.name) pairs.push({ id: m.userId, name: m.name });
  }
  for (const p of context.posts ?? []) {
    if (p.authorId && p.authorName) pairs.push({ id: p.authorId, name: p.authorName });
  }
  for (const c of context.comments ?? []) {
    if (c.authorId && c.authorName) pairs.push({ id: c.authorId, name: c.authorName });
  }
  for (const r of context.reactors ?? []) {
    if (r.userId && r.userName) pairs.push({ id: r.userId, name: r.userName });
  }
  return buildNameToIdMap(pairs);
}

function normalizeBackfillContext(
  contextOrPeople: AuthorIdBackfillContext | FacebookPerson[],
): AuthorIdBackfillContext {
  if (Array.isArray(contextOrPeople)) {
    return { people: contextOrPeople };
  }
  return contextOrPeople;
}

export function backfillAuthorIds(
  posts: FacebookPost[],
  comments: FacebookComment[],
  contextOrPeople: AuthorIdBackfillContext | FacebookPerson[],
): { posts: FacebookPost[]; comments: FacebookComment[] } {
  const context = normalizeBackfillContext(contextOrPeople);
  const byId = new Map(context.people.map((p) => [p.id, p]));
  const nameToId = buildAuthorNameToIdMap(context);

  const fillPost = (post: FacebookPost): FacebookPost => {
    let authorId = post.authorId;
    let authorName = post.authorName;
    if (!authorId && authorName) {
      authorId = nameToId.get(normalizeName(authorName));
    }
    if (authorId && !authorName) {
      authorName = byId.get(authorId)?.name ?? authorName;
    }
    if (authorId === post.authorId && authorName === post.authorName) return post;
    return { ...post, authorId, authorName };
  };

  const fillComment = (comment: FacebookComment): FacebookComment => {
    let authorId = comment.authorId;
    let authorName = comment.authorName;
    if (!authorId && authorName) {
      authorId = nameToId.get(normalizeName(authorName));
    }
    if (authorId && !authorName) {
      authorName = byId.get(authorId)?.name ?? authorName;
    }
    if (authorId === comment.authorId && authorName === comment.authorName) return comment;
    return { ...comment, authorId, authorName };
  };

  return {
    posts: posts.map(fillPost),
    comments: comments.map(fillComment),
  };
}

export function syncLinkedCommentAuthors(
  posts: FacebookPost[],
  comments: FacebookComment[],
): FacebookPost[] {
  const byId = new Map(comments.map((c) => [c.id, c]));
  return posts.map((post) => {
    if (!post.linkedComments?.length) return post;
    return {
      ...post,
      linkedComments: post.linkedComments.map((linked) => {
        const full = byId.get(linked.id);
        if (!full) return linked;
        return {
          ...linked,
          authorId: full.authorId,
          authorName: full.authorName,
        };
      }),
    };
  });
}

function buildCommentLookup(comments: FacebookComment[]): Map<string, FacebookComment> {
  const map = new Map<string, FacebookComment>();
  for (const comment of comments) {
    map.set(comment.id, comment);
    const legacy = commentLegacyKey(comment.id);
    if (legacy) map.set(legacy, comment);
    if (comment.feedbackId) map.set(comment.feedbackId, comment);
  }
  return map;
}

function resolveCommentForReaction(
  reaction: FacebookReaction,
  commentByKey: Map<string, FacebookComment>,
): FacebookComment | undefined {
  if (!reaction.commentId) return undefined;
  const direct = commentByKey.get(reaction.commentId);
  if (direct) return direct;
  const legacy = commentLegacyKey(reaction.commentId);
  if (legacy) {
    const fromLegacy = commentByKey.get(legacy);
    if (fromLegacy) return fromLegacy;
  }
  if (reaction.feedbackId) {
    const fromFeedback = commentByKey.get(reaction.feedbackId);
    if (fromFeedback) return fromFeedback;
  }
  return undefined;
}

export function enrichReactionContext(
  reactions: FacebookReaction[],
  posts: FacebookPost[],
  comments: FacebookComment[],
): FacebookReaction[] {
  const postById = new Map<string, FacebookPost>();
  for (const post of posts) {
    const id = post.postId ?? post.id;
    if (id) postById.set(id, post);
  }
  const commentByKey = buildCommentLookup(comments);

  return reactions.map((reaction) => {
    if (reaction.target === "comment" && reaction.commentId) {
      const comment = resolveCommentForReaction(reaction, commentByKey);
      if (!comment) return reaction;
      return {
        ...reaction,
        targetAuthorId: comment.authorId,
        targetText: comment.text,
        targetPostId: comment.postId ?? reaction.postId,
      };
    }
    const postId = reaction.postId ?? reaction.targetPostId;
    const post = postId ? postById.get(postId) : undefined;
    if (!post) return reaction;
    return {
      ...reaction,
      targetAuthorId: post.authorId,
      targetText: post.text,
      targetPostId: post.postId ?? postId,
    };
  });
}
