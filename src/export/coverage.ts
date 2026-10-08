import type {
  CoverageMetric,
  CoverageReport,
  FacebookGroupActivity,
  SessionData,
} from "../shared/types.js";

export const COVERAGE_REPORT_SCHEMA_VERSION = 1 as const;

function metric(total: number, present: number): CoverageMetric {
  return {
    present,
    total,
    percent: total === 0 ? 0 : Math.round((present / total) * 1000) / 10,
  };
}

function hasValue(value: unknown): boolean {
  return typeof value === "string" ? value.trim().length > 0 : value != null;
}

function buildFieldCoverage(activity: FacebookGroupActivity): CoverageReport["fields"] {
  const { posts, comments, reactions } = activity;
  return {
    posts: {
      text: metric(posts.length, posts.filter((post) => hasValue(post.text)).length),
      authorId: metric(posts.length, posts.filter((post) => hasValue(post.authorId)).length),
      url: metric(posts.length, posts.filter((post) => hasValue(post.url)).length),
    },
    comments: {
      text: metric(comments.length, comments.filter((comment) => hasValue(comment.text)).length),
      authorId: metric(
        comments.length,
        comments.filter((comment) => hasValue(comment.authorId)).length,
      ),
      postId: metric(comments.length, comments.filter((comment) => hasValue(comment.postId)).length),
    },
    reactions: {
      userId: metric(reactions.length, reactions.filter((reaction) => hasValue(reaction.userId)).length),
      targetId: metric(
        reactions.length,
        reactions.filter((reaction) =>
          hasValue(reaction.target === "comment" ? reaction.commentId : reaction.postId),
        ).length,
      ),
      targetText: metric(
        reactions.length,
        reactions.filter((reaction) => hasValue(reaction.targetText)).length,
      ),
      reactionType: metric(
        reactions.length,
        reactions.filter((reaction) => hasValue(reaction.reactionType)).length,
      ),
    },
  };
}

export function buildCoverageReport(data: SessionData): CoverageReport {
  const activity = data.enrichments?.facebookGroups;
  const posts = activity?.posts ?? [];
  const comments = activity?.comments ?? [];
  const reactions = activity?.reactions ?? [];
  const health = data.session?.health;

  return {
    schemaVersion: COVERAGE_REPORT_SCHEMA_VERSION,
    generatedAt: Date.now(),
    source: {
      tabUrl: data.session?.tabUrl,
      sessionPermalink: activity?.sessionPermalink,
      startedAt: data.session?.startedAt,
      stoppedAt: data.session?.stoppedAt,
    },
    totals: {
      network: data.network.length,
      groups: activity?.groups.length ?? 0,
      members: activity?.members.length ?? 0,
      people: activity?.people.length ?? 0,
      posts: posts.length,
      comments: comments.length,
      reactions: reactions.length,
    },
    fields: buildFieldCoverage(activity ?? {
      groups: [],
      members: [],
      people: [],
      posts: [],
      comments: [],
      reactions: [],
      graphqlQueryHints: [],
    }),
    quality: {
      partialPosts: posts.filter((post) => post.partialParse).length,
      parseWarnings: activity?.parseWarnings?.length ?? 0,
      networkTruncated: health?.truncation.network ?? 0,
      healthGaps: health?.partialGaps.length ?? 0,
      persistenceErrors: health?.persistenceErrors.length ?? 0,
    },
  };
}
