import {
  ensureHydrationIndex,
  getCachedGraphqlDocId,
  getCachedGraphqlTemplate,
  getHydrationActivity,
} from "./hydration-index.js";
import { invalidateHydrationSnapshot } from "./hydration-snapshot.js";
import {
  ALL_REACTION_TYPE_IDS,
  isDialogReactionSource,
  SAMPLE_REACTION_TYPE_IDS,
} from "../enrichers/facebook-parse.js";
import {
  buildGraphqlFormBody,
  parseGraphqlFormBody,
  tabContentRefetchVariables,
  tooltipReactionVariables,
} from "./graphql-template.js";
import { fetchGraphqlInPage } from "./page-fetch.js";
import { readSessionData, recordHealthGap, upsertNetwork } from "../persistence/store.js";
import { getAttachedTabId } from "./debugger-capture.js";
import { getActiveSession } from "./session-manager.js";
import type {
  FacebookComment,
  FacebookPost,
  FacebookReaction,
  NetworkEntry,
} from "../shared/types.js";
import { isFacebookUrl } from "../shared/urls.js";

export const SESSION_HYDRATION_MAX_POSTS = 8;
export const SESSION_HYDRATION_MAX_COMMENTS = 5;
export const EXPORT_HYDRATION_MAX_POSTS = 12;
export const EXPORT_HYDRATION_MAX_COMMENTS = 8;
export const EXPORT_HYDRATION_MAX_MS = 45_000;
export const EXPORT_HYDRATION_MAX_REQUESTS = 36;
export const REACTION_HYDRATION_MAX_POSTS = SESSION_HYDRATION_MAX_POSTS;
export const REACTION_HYDRATION_DEBOUNCE_MS = 8_000;
export const REACTION_HYDRATION_ACTIVITY_WINDOW_MS = 60_000;
export const REACTION_HYDRATION_REQUEST_DELAY_MIN_MS = 2_000;
export const REACTION_HYDRATION_REQUEST_DELAY_MAX_MS = 5_000;
export const EXPORT_HYDRATION_REQUEST_DELAY_MIN_MS = 2_000;
export const EXPORT_HYDRATION_REQUEST_DELAY_MAX_MS = 5_000;
export const EXPORT_HYDRATION_TARGET_COOLDOWN_MIN_MS = 3_000;
export const EXPORT_HYDRATION_TARGET_COOLDOWN_MAX_MS = 8_000;
export const REACTION_HYDRATION_POST_COOLDOWN_MIN_MS = 45_000;
export const REACTION_HYDRATION_POST_COOLDOWN_MAX_MS = 90_000;
export const REACTION_HYDRATION_INACTIVE_RETRY_MS = 15_000;
export const EXPORT_HYDRATION_MAX_PAGES_PER_TYPE = 3;
export const TAB_CONTENT_REFETCH_QUERY = "CometUFIReactionsDialogTabContentRefetchQuery";
export const TOOLTIP_REACTION_QUERY = "CometUFIReactionIconTooltipContentQuery";

const HOT_QUERY_PATTERN =
  /UFI|FocusedStory|permalink|CommentsDialog|StoryView|ReactionsDialog/i;

type HydrationTargetKind = "post" | "comment";

interface HydrationTarget {
  kind: HydrationTargetKind;
  key: string;
  feedbackId: string;
  score: number;
}

type SchedulerState = {
  hydratedKeys: Set<string>;
  hotFeedbackIds: Set<string>;
  postsHydrated: number;
  commentsHydrated: number;
  lastOrganicActivityAt: number;
  lastTargetHydratedAt: number;
  running: boolean;
  exportInProgress: boolean;
  docIdGapRecorded: boolean;
  templateGapRecorded: boolean;
};

const state: SchedulerState = {
  hydratedKeys: new Set(),
  hotFeedbackIds: new Set(),
  postsHydrated: 0,
  commentsHydrated: 0,
  lastOrganicActivityAt: 0,
  lastTargetHydratedAt: 0,
  running: false,
  exportInProgress: false,
  docIdGapRecorded: false,
  templateGapRecorded: false,
};

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function jitterMs(min: number, max: number): number {
  return Math.round(min + Math.random() * (max - min));
}

export function resetReactionHydrationScheduler(): void {
  state.hydratedKeys.clear();
  state.hotFeedbackIds.clear();
  state.postsHydrated = 0;
  state.commentsHydrated = 0;
  state.lastOrganicActivityAt = 0;
  state.lastTargetHydratedAt = 0;
  state.running = false;
  state.exportInProgress = false;
  state.docIdGapRecorded = false;
  state.templateGapRecorded = false;
  if (debounceTimer) clearTimeout(debounceTimer);
  if (retryTimer) clearTimeout(retryTimer);
  debounceTimer = null;
  retryTimer = null;
  invalidateHydrationSnapshot();
}

export function markReactionHydrationOrganicActivity(): void {
  state.lastOrganicActivityAt = Date.now();
}

export function markHotFeedbackFromRequest(requestBody?: string): void {
  if (!requestBody) return;
  const form = parseGraphqlFormBody(requestBody);
  const friendlyName = form.fb_api_req_friendly_name ?? "";
  if (!HOT_QUERY_PATTERN.test(friendlyName)) return;
  try {
    const vars = JSON.parse(form.variables ?? "{}") as {
      feedbackTargetID?: string;
      id?: string;
    };
    const id = vars.feedbackTargetID ?? vars.id;
    if (typeof id === "string") state.hotFeedbackIds.add(id);
  } catch {
    /* ignore */
  }
}

function targetKey(kind: HydrationTargetKind, id: string): string {
  return `${kind}:${id}`;
}

function postHasSufficientDialogCoverage(
  postId: string | undefined,
  reactions: FacebookReaction[],
): boolean {
  if (!postId) return false;
  return reactions.some(
    (r) =>
      r.postId === postId &&
      r.target !== "comment" &&
      isDialogReactionSource(r.source),
  );
}

export function postHydrationScore(
  post: FacebookPost,
  hotFeedbackIds: ReadonlySet<string>,
  tabUrl?: string,
): number {
  let score = post.reactionCount ?? 0;
  if (post.feedbackId && hotFeedbackIds.has(post.feedbackId)) score += 1_000;
  if (tabUrl?.includes("/permalink/") && post.url?.includes("/permalink/")) score += 500;
  return score;
}

export function commentHydrationScore(
  comment: FacebookComment,
  hotFeedbackIds: ReadonlySet<string>,
): number {
  let score = comment.reactionCount ?? 0;
  if (comment.feedbackId && hotFeedbackIds.has(comment.feedbackId)) score += 1_000;
  return score;
}

export function selectNextPostForHydration(
  posts: FacebookPost[],
  reactions: FacebookReaction[],
  opts: {
    hotFeedbackIds: ReadonlySet<string>;
    hydratedPostIds: ReadonlySet<string>;
    tabUrl?: string;
    skipDialogCoverage?: boolean;
  },
): FacebookPost | undefined {
  const ranked = posts
    .filter((p) => p.feedbackId && !p.partialParse)
    .filter((p) => {
      const key = p.postId ?? p.id;
      return !opts.hydratedPostIds.has(key);
    })
    .filter(
      (p) =>
        opts.skipDialogCoverage ||
        !postHasSufficientDialogCoverage(p.postId, reactions),
    )
    .map((p) => ({
      post: p,
      score: postHydrationScore(p, opts.hotFeedbackIds, opts.tabUrl),
    }))
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.post;
}

export function selectNextCommentForHydration(
  comments: FacebookComment[],
  reactions: FacebookReaction[],
  opts: {
    hotFeedbackIds: ReadonlySet<string>;
    hydratedCommentIds: ReadonlySet<string>;
    skipExistingDialogReactions?: boolean;
  },
): FacebookComment | undefined {
  const ranked = comments
    .filter((c) => c.feedbackId)
    .filter((c) => !opts.hydratedCommentIds.has(c.id))
    .filter(
      (c) =>
        opts.skipExistingDialogReactions ||
        !reactions.some(
          (r) =>
            r.target === "comment" &&
            r.commentId === c.id &&
            isDialogReactionSource(r.source),
        ),
    )
    .map((c) => ({
      comment: c,
      score: commentHydrationScore(c, opts.hotFeedbackIds),
    }))
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.comment;
}

function selectNextHydrationTarget(
  posts: FacebookPost[],
  comments: FacebookComment[],
  reactions: FacebookReaction[],
  opts: {
    hotFeedbackIds: ReadonlySet<string>;
    hydratedKeys: ReadonlySet<string>;
    tabUrl?: string;
    maxPosts: number;
    maxComments: number;
    postsHydrated: number;
    commentsHydrated: number;
    skipDialogCoverage?: boolean;
    skipExistingDialogReactions?: boolean;
  },
): HydrationTarget | undefined {
  const hydratedPosts = new Set(
    [...opts.hydratedKeys]
      .filter((k) => k.startsWith("post:"))
      .map((k) => k.slice(5)),
  );
  const hydratedComments = new Set(
    [...opts.hydratedKeys]
      .filter((k) => k.startsWith("comment:"))
      .map((k) => k.slice(8)),
  );

  const candidates: HydrationTarget[] = [];

  if (opts.postsHydrated < opts.maxPosts) {
    const post = selectNextPostForHydration(posts, reactions, {
      hotFeedbackIds: opts.hotFeedbackIds,
      hydratedPostIds: hydratedPosts,
      tabUrl: opts.tabUrl,
      skipDialogCoverage: opts.skipDialogCoverage,
    });
    if (post?.feedbackId) {
      candidates.push({
        kind: "post",
        key: post.postId ?? post.id,
        feedbackId: post.feedbackId,
        score: postHydrationScore(post, opts.hotFeedbackIds, opts.tabUrl),
      });
    }
  }

  if (opts.commentsHydrated < opts.maxComments) {
    const comment = selectNextCommentForHydration(comments, reactions, {
      hotFeedbackIds: opts.hotFeedbackIds,
      hydratedCommentIds: hydratedComments,
      skipExistingDialogReactions: opts.skipExistingDialogReactions,
    });
    if (comment?.feedbackId) {
      candidates.push({
        kind: "comment",
        key: comment.id,
        feedbackId: comment.feedbackId,
        score: commentHydrationScore(comment, opts.hotFeedbackIds),
      });
    }
  }

  return candidates.sort((a, b) => b.score - a.score)[0];
}

function graphqlFormString(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

function responseLooksValid(body: string): boolean {
  try {
    const json = JSON.parse(body) as { errors?: unknown[] };
    return !json.errors?.length;
  } catch {
    return false;
  }
}

function parseReactorPageInfo(body: string): { hasNext: boolean; cursor: string | null } {
  try {
    const json = JSON.parse(body) as unknown;
    let found: { has_next_page?: boolean; end_cursor?: string | null } | undefined;
    const visit = (value: unknown): void => {
      if (found || value == null || typeof value !== "object") return;
      if (Array.isArray(value)) {
        for (const item of value) visit(item);
        return;
      }
      const node = value as Record<string, unknown>;
      const reactors = node.reactors as { page_info?: unknown } | undefined;
      if (reactors?.page_info && typeof reactors.page_info === "object") {
        found = reactors.page_info as { has_next_page?: boolean; end_cursor?: string | null };
      }
      for (const v of Object.values(node)) visit(v);
    };
    visit(json);
    return {
      hasNext: Boolean(found?.has_next_page),
      cursor: typeof found?.end_cursor === "string" ? found.end_cursor : null,
    };
  } catch {
    return { hasNext: false, cursor: null };
  }
}

interface HydrationQueryPlan {
  friendlyName: string;
  docId: string;
  useTabRefetch: boolean;
}

function resolveHydrationQuery(
  network: NetworkEntry[],
  preferTabRefetch: boolean,
): HydrationQueryPlan | null {
  const tabDocId = getCachedGraphqlDocId(network, TAB_CONTENT_REFETCH_QUERY);
  const tooltipDocId = getCachedGraphqlDocId(network, TOOLTIP_REACTION_QUERY);
  if (preferTabRefetch && tabDocId) {
    return {
      friendlyName: TAB_CONTENT_REFETCH_QUERY,
      docId: tabDocId,
      useTabRefetch: true,
    };
  }
  if (tooltipDocId) {
    return {
      friendlyName: TOOLTIP_REACTION_QUERY,
      docId: tooltipDocId,
      useTabRefetch: false,
    };
  }
  if (tabDocId) {
    return {
      friendlyName: TAB_CONTENT_REFETCH_QUERY,
      docId: tabDocId,
      useTabRefetch: true,
    };
  }
  return null;
}

async function storeHydrationResponse(
  tabId: number,
  sessionId: string,
  fields: Record<string, string>,
  result: { status: number; body: string },
): Promise<void> {
  const entry: NetworkEntry = {
    id: crypto.randomUUID(),
    sessionId,
    requestId: `hydrate-${crypto.randomUUID()}`,
    timestamp: Date.now(),
    url: "https://www.facebook.com/api/graphql/",
    method: "POST",
    type: "xhr",
    tabId,
    statusCode: result.status,
    requestBody: graphqlFormString(fields),
    responseBody: result.body,
    bodyCaptured: true,
  };
  await upsertNetwork(entry);
}

async function fetchReactionType(
  tabId: number,
  sessionId: string,
  template: Record<string, string>,
  plan: HydrationQueryPlan,
  feedbackId: string,
  reactionId: string,
  opts: {
    paginate: boolean;
    maxPages: number;
    delayMin: number;
    delayMax: number;
    onRequest?: () => boolean;
  },
): Promise<number> {
  let successes = 0;
  let cursor: string | null = null;

  for (let page = 0; page < opts.maxPages; page++) {
    if (opts.onRequest && !opts.onRequest()) break;

    const variables = plan.useTabRefetch
      ? tabContentRefetchVariables(feedbackId, reactionId, cursor)
      : tooltipReactionVariables(feedbackId, reactionId);

    const fields = buildGraphqlFormBody(template, {
      friendlyName: plan.friendlyName,
      docId: plan.docId,
      variables,
    });
    const result = await fetchGraphqlInPage(tabId, fields);

    if (result.ok && result.body && responseLooksValid(result.body)) {
      await storeHydrationResponse(tabId, sessionId, fields, result);
      successes++;
    }

    if (!opts.paginate || !plan.useTabRefetch) break;

    const pageInfo = parseReactorPageInfo(result.body ?? "");
    if (!pageInfo.hasNext || !pageInfo.cursor) break;
    cursor = pageInfo.cursor;
    await sleep(jitterMs(opts.delayMin, opts.delayMax));
  }

  return successes;
}

async function hydrateTarget(
  tabId: number,
  sessionId: string,
  target: HydrationTarget,
  opts: {
    reactionIds: readonly string[];
    preferTabRefetch: boolean;
    paginate: boolean;
    maxPages: number;
    delayMin: number;
    delayMax: number;
    recordGaps: boolean;
    onRequest?: () => boolean;
  },
): Promise<boolean> {
  let network: NetworkEntry[] = [];
  let template = getCachedGraphqlTemplate(network);
  const plan = template ? resolveHydrationQuery(network, opts.preferTabRefetch) : null;

  if (!template || !plan) {
    const data = await readSessionData();
    network = data.network;
    template = getCachedGraphqlTemplate(network);
  }
  if (!template) {
    if (opts.recordGaps && !state.templateGapRecorded) {
      state.templateGapRecorded = true;
      await recordHealthGap("reaction_hydration: no GraphQL session template in capture");
    }
    return false;
  }

  const planResolved = plan ?? resolveHydrationQuery(network, opts.preferTabRefetch);
  if (!planResolved) {
    if (opts.recordGaps && !state.docIdGapRecorded) {
      state.docIdGapRecorded = true;
      await recordHealthGap("reaction_hydration: no reaction query doc_id captured");
    }
    return false;
  }

  let successes = 0;
  for (const reactionId of opts.reactionIds) {
    if (opts.onRequest && !opts.onRequest()) break;
    if (!(await tabReadyForHydration(tabId, false))) return successes > 0;
    successes += await fetchReactionType(
      tabId,
      sessionId,
      template,
      planResolved,
      target.feedbackId,
      reactionId,
      {
        paginate: opts.paginate,
        maxPages: opts.maxPages,
        delayMin: opts.delayMin,
        delayMax: opts.delayMax,
        onRequest: opts.onRequest,
      },
    );
    await sleep(jitterMs(opts.delayMin, opts.delayMax));
  }

  return successes > 0;
}

function scheduleRetry(tabId: number, delayMs: number): void {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void runReactionHydrationCycle(tabId);
  }, delayMs);
}

export function scheduleReactionHydrationCheck(tabId: number): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void runReactionHydrationCycle(tabId);
  }, REACTION_HYDRATION_DEBOUNCE_MS);
}

export function onCaptureGraphqlActivity(tabId: number, requestBody?: string): void {
  markReactionHydrationOrganicActivity();
  markHotFeedbackFromRequest(requestBody);
  scheduleReactionHydrationCheck(tabId);
}

export function registerReactionHydrationListeners(): void {
  chrome.tabs.onActivated.addListener((activeInfo) => {
    void getActiveSession().then((session) => {
      if (session?.active && session.tabId === activeInfo.tabId) {
        scheduleReactionHydrationCheck(session.tabId);
      }
    });
  });
}

async function tabReadyForHydration(
  tabId: number,
  requireActive: boolean,
): Promise<boolean> {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!isFacebookUrl(tab.url)) return false;
    if (requireActive && !tab.active) return false;
    return true;
  } catch {
    return false;
  }
}

async function runReactionHydrationCycle(tabId: number): Promise<void> {
  if (state.running || state.exportInProgress) return;

  const session = await getActiveSession();
  if (!session?.active || !session.options.reactionHydration) return;
  if (!isFacebookUrl(session.tabUrl)) return;
  if (getAttachedTabId() !== tabId) return;
  if (
    state.postsHydrated >= SESSION_HYDRATION_MAX_POSTS &&
    state.commentsHydrated >= SESSION_HYDRATION_MAX_COMMENTS
  ) {
    return;
  }

  const idleMs = Date.now() - state.lastOrganicActivityAt;
  if (state.lastOrganicActivityAt > 0 && idleMs > REACTION_HYDRATION_ACTIVITY_WINDOW_MS) {
    return;
  }

  if (!(await tabReadyForHydration(tabId, true))) {
    scheduleRetry(tabId, REACTION_HYDRATION_INACTIVE_RETRY_MS);
    return;
  }

  const sinceLast = Date.now() - state.lastTargetHydratedAt;
  if (state.lastTargetHydratedAt > 0 && sinceLast < REACTION_HYDRATION_POST_COOLDOWN_MIN_MS) {
    const waitMs = jitterMs(
      REACTION_HYDRATION_POST_COOLDOWN_MIN_MS,
      REACTION_HYDRATION_POST_COOLDOWN_MAX_MS,
    );
    scheduleRetry(tabId, Math.max(1_000, waitMs - sinceLast));
    return;
  }

  state.running = true;
  try {
    await ensureHydrationIndex(session.id, session.tabUrl);
    const activity = getHydrationActivity();
    const target = selectNextHydrationTarget(
      activity.posts,
      activity.comments,
      activity.reactions,
      {
        hotFeedbackIds: state.hotFeedbackIds,
        hydratedKeys: state.hydratedKeys,
        tabUrl: session.tabUrl,
        maxPosts: SESSION_HYDRATION_MAX_POSTS,
        maxComments: SESSION_HYDRATION_MAX_COMMENTS,
        postsHydrated: state.postsHydrated,
        commentsHydrated: state.commentsHydrated,
      },
    );
    if (!target) return;

    const hydrated = await hydrateTarget(tabId, session.id, target, {
      reactionIds: Object.values(SAMPLE_REACTION_TYPE_IDS),
      preferTabRefetch: false,
      paginate: false,
      maxPages: 1,
      delayMin: REACTION_HYDRATION_REQUEST_DELAY_MIN_MS,
      delayMax: REACTION_HYDRATION_REQUEST_DELAY_MAX_MS,
      recordGaps: true,
    });

    if (hydrated) {
      state.hydratedKeys.add(targetKey(target.kind, target.key));
      if (target.kind === "post") state.postsHydrated += 1;
      else state.commentsHydrated += 1;
      state.lastTargetHydratedAt = Date.now();
      if (
        state.postsHydrated < SESSION_HYDRATION_MAX_POSTS ||
        state.commentsHydrated < SESSION_HYDRATION_MAX_COMMENTS
      ) {
        scheduleRetry(
          tabId,
          jitterMs(REACTION_HYDRATION_POST_COOLDOWN_MIN_MS, REACTION_HYDRATION_POST_COOLDOWN_MAX_MS),
        );
      }
    }
  } finally {
    state.running = false;
  }
}

/** Final hydration pass before export — all reaction types, dialog refetch, pagination. */
export async function runExportReactionHydration(tabId: number): Promise<void> {
  const session = await getActiveSession();
  if (!session?.active || !session.options.reactionHydration) return;
  if (!isFacebookUrl(session.tabUrl)) return;
  if (getAttachedTabId() !== tabId) return;
  if (!(await tabReadyForHydration(tabId, false))) return;

  if (debounceTimer) clearTimeout(debounceTimer);
  if (retryTimer) clearTimeout(retryTimer);
  debounceTimer = null;
  retryTimer = null;
  state.exportInProgress = true;

  const exportHydrated = new Set<string>();
  let postsDone = 0;
  let commentsDone = 0;
  const startedAt = Date.now();
  let requests = 0;
  let budgetExhausted = false;

  const consumeExportBudget = (): boolean => {
    if (Date.now() - startedAt >= EXPORT_HYDRATION_MAX_MS) {
      budgetExhausted = true;
      return false;
    }
    if (requests >= EXPORT_HYDRATION_MAX_REQUESTS) {
      budgetExhausted = true;
      return false;
    }
    requests += 1;
    return true;
  };

  try {
    while (postsDone < EXPORT_HYDRATION_MAX_POSTS || commentsDone < EXPORT_HYDRATION_MAX_COMMENTS) {
      if (Date.now() - startedAt >= EXPORT_HYDRATION_MAX_MS) {
        budgetExhausted = true;
        break;
      }

      await ensureHydrationIndex(session.id, session.tabUrl);
      const activity = getHydrationActivity();
      const target = selectNextHydrationTarget(
        activity.posts,
        activity.comments,
        activity.reactions,
        {
          hotFeedbackIds: state.hotFeedbackIds,
          hydratedKeys: exportHydrated,
          tabUrl: session.tabUrl,
          maxPosts: EXPORT_HYDRATION_MAX_POSTS,
          maxComments: EXPORT_HYDRATION_MAX_COMMENTS,
          postsHydrated: postsDone,
          commentsHydrated: commentsDone,
          skipDialogCoverage: true,
          skipExistingDialogReactions: true,
        },
      );
      if (!target) break;

      const hydrated = await hydrateTarget(tabId, session.id, target, {
        reactionIds: ALL_REACTION_TYPE_IDS,
        preferTabRefetch: true,
        paginate: true,
        maxPages: EXPORT_HYDRATION_MAX_PAGES_PER_TYPE,
        delayMin: EXPORT_HYDRATION_REQUEST_DELAY_MIN_MS,
        delayMax: EXPORT_HYDRATION_REQUEST_DELAY_MAX_MS,
        recordGaps: true,
        onRequest: consumeExportBudget,
      });

      if (!hydrated) break;

      exportHydrated.add(targetKey(target.kind, target.key));
      if (target.kind === "post") postsDone += 1;
      else commentsDone += 1;

      await sleep(
        jitterMs(EXPORT_HYDRATION_TARGET_COOLDOWN_MIN_MS, EXPORT_HYDRATION_TARGET_COOLDOWN_MAX_MS),
      );
    }

    if (budgetExhausted) {
      await recordHealthGap(
        `reaction_hydration: export budget reached (${requests} requests, ${Date.now() - startedAt}ms)`,
      );
    }
  } finally {
    state.exportInProgress = false;
  }
}
