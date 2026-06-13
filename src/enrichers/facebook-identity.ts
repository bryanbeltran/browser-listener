import type {
  FacebookComment,
  FacebookPerson,
  FacebookPost,
  FacebookReaction,
} from "../shared/types.js";

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
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

function buildNameToIdMap(people: FacebookPerson[]): Map<string, string> {
  const counts = new Map<string, Set<string>>();
  for (const p of people) {
    if (!p.id || !p.name) continue;
    const key = normalizeName(p.name);
    const ids = counts.get(key) ?? new Set<string>();
    ids.add(p.id);
    counts.set(key, ids);
  }
  const out = new Map<string, string>();
  for (const [name, ids] of counts) {
    if (ids.size === 1) out.set(name, [...ids][0]!);
  }
  return out;
}

export function backfillAuthorIds(
  posts: FacebookPost[],
  comments: FacebookComment[],
  people: FacebookPerson[],
): { posts: FacebookPost[]; comments: FacebookComment[] } {
  const byId = new Map(people.map((p) => [p.id, p]));
  const nameToId = buildNameToIdMap(people);

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
  const commentById = new Map(comments.map((c) => [c.id, c]));

  return reactions.map((reaction) => {
    if (reaction.target === "comment" && reaction.commentId) {
      const comment = commentById.get(reaction.commentId);
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
