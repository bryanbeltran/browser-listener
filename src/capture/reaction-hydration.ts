import { extractFacebookGroupActivity } from "../enrichers/facebook-groups.js";
import { isDialogReactionSource, SAMPLE_REACTION_TYPE_IDS } from "../enrichers/facebook-parse.js";
import {
  buildGraphqlFormBody,
  findGraphqlDocId,
  findGraphqlRequestTemplate,
  parseGraphqlFormBody,
  tabContentRefetchVariables,
  tooltipReactionVariables,
} from "./graphql-template.js";
import { fetchGraphqlInPage } from "./page-fetch.js";
import { readSessionData, recordHealthGap, upsertNetwork } from "../persistence/store.js";
import { getAttachedTabId } from "./debugger-capture.js";
import { getActiveSession } from "./session-manager.js";
import type { FacebookPost, FacebookReaction, NetworkEntry } from "../shared/types.js";

export const REACTION_HYDRATION_MAX_POSTS = 5;
export const REACTION_HYDRATION_DEBOUNCE_MS = 8_000;
export const REACTION_HYDRATION_ACTIVITY_WINDOW_MS = 60_000;
export const REACTION_HYDRATION_REQUEST_DELAY_MIN_MS = 2_000;
export const REACTION_HYDRATION_REQUEST_DELAY_MAX_MS = 5_000;
export const REACTION_HYDRATION_POST_COOLDOWN_MIN_MS = 45_000;
export const REACTION_HYDRATION_POST_COOLDOWN_MAX_MS = 90_000;
export const REACTION_HYDRATION_INACTIVE_RETRY_MS = 15_000;
export const TAB_CONTENT_REFETCH_QUERY = "CometUFIReactionsDialogTabContentRefetchQuery";
export const TOOLTIP_REACTION_QUERY = "CometUFIReactionIconTooltipContentQuery";

const HOT_QUERY_PATTERN =
  /UFI|FocusedStory|permalink|CommentsDialog|StoryView|ReactionsDialog/i;

type SchedulerState = {
  hydratedPostIds: Set<string>;
  hotFeedbackIds: Set<string>;
  postsHydratedThisSession: number;
  lastOrganicActivityAt: number;
  lastPostHydratedAt: number;
  running: boolean;
  docIdGapRecorded: boolean;
  templateGapRecorded: boolean;
};

const state: SchedulerState = {
  hydratedPostIds: new Set(),
  hotFeedbackIds: new Set(),
  postsHydratedThisSession: 0,
  lastOrganicActivityAt: 0,
  lastPostHydratedAt: 0,
  running: false,
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
  state.hydratedPostIds.clear();
  state.hotFeedbackIds.clear();
  state.postsHydratedThisSession = 0;
  state.lastOrganicActivityAt = 0;
  state.lastPostHydratedAt = 0;
  state.running = false;
  state.docIdGapRecorded = false;
  state.templateGapRecorded = false;
  if (debounceTimer) clearTimeout(debounceTimer);
  if (retryTimer) clearTimeout(retryTimer);
  debounceTimer = null;
  retryTimer = null;
}

export function markReactionHydrationOrganicActivity(): void {
  state.lastOrganicActivityAt = Date.now();
}

/** Mark feedback ids from UFI / post-dialog GraphQL the user triggered. */
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

function postAlreadyHasSampleDialogReactions(
  postId: string | undefined,
  reactions: FacebookReaction[],
): boolean {
  if (!postId) return false;
  const types = new Set(
    reactions
      .filter(
        (r) =>
          r.postId === postId &&
          isDialogReactionSource(r.source) &&
          r.reactionType &&
          Object.keys(SAMPLE_REACTION_TYPE_IDS).includes(r.reactionType),
      )
      .map((r) => r.reactionType!),
  );
  const missing = Object.keys(SAMPLE_REACTION_TYPE_IDS).filter((name) => !types.has(name));
  return missing.length === 0;
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

/** Next single post to hydrate, preferring user-engaged (hot) posts. */
export function selectNextPostForHydration(
  posts: FacebookPost[],
  reactions: FacebookReaction[],
  opts: {
    hotFeedbackIds: ReadonlySet<string>;
    hydratedPostIds: ReadonlySet<string>;
    tabUrl?: string;
  },
): FacebookPost | undefined {
  const ranked = posts
    .filter((p) => p.feedbackId && !p.partialParse)
    .filter((p) => {
      const key = p.postId ?? p.id;
      return !opts.hydratedPostIds.has(key);
    })
    .filter((p) => !postAlreadyHasSampleDialogReactions(p.postId, reactions))
    .map((p) => ({
      post: p,
      score: postHydrationScore(p, opts.hotFeedbackIds, opts.tabUrl),
    }))
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.post;
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

/** Called after passive GraphQL body capture during an active session. */
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

async function tabReadyForHydration(tabId: number): Promise<boolean> {
  try {
    const tab = await chrome.tabs.get(tabId);
    return Boolean(tab.active && tab.url?.includes("facebook.com"));
  } catch {
    return false;
  }
}

async function runReactionHydrationCycle(tabId: number): Promise<void> {
  if (state.running) return;

  const session = await getActiveSession();
  if (!session?.active || !session.options.reactionHydration) return;
  if (!session.tabUrl?.includes("facebook.com")) return;
  if (getAttachedTabId() !== tabId) return;
  if (state.postsHydratedThisSession >= REACTION_HYDRATION_MAX_POSTS) return;

  const idleMs = Date.now() - state.lastOrganicActivityAt;
  if (state.lastOrganicActivityAt > 0 && idleMs > REACTION_HYDRATION_ACTIVITY_WINDOW_MS) {
    return;
  }

  if (!(await tabReadyForHydration(tabId))) {
    scheduleRetry(tabId, REACTION_HYDRATION_INACTIVE_RETRY_MS);
    return;
  }

  const sinceLastPost = Date.now() - state.lastPostHydratedAt;
  if (state.lastPostHydratedAt > 0 && sinceLastPost < REACTION_HYDRATION_POST_COOLDOWN_MIN_MS) {
    const waitMs = jitterMs(
      REACTION_HYDRATION_POST_COOLDOWN_MIN_MS,
      REACTION_HYDRATION_POST_COOLDOWN_MAX_MS,
    );
    scheduleRetry(tabId, Math.max(1_000, waitMs - sinceLastPost));
    return;
  }

  state.running = true;
  try {
    const hydrated = await hydrateOnePost(tabId, session.id, session.tabUrl);
    if (hydrated) {
      state.postsHydratedThisSession += 1;
      state.lastPostHydratedAt = Date.now();
      if (state.postsHydratedThisSession < REACTION_HYDRATION_MAX_POSTS) {
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

async function hydrateOnePost(
  tabId: number,
  sessionId: string,
  tabUrl?: string,
): Promise<boolean> {
  const data = await readSessionData();
  const activity = extractFacebookGroupActivity(data.network, { tabUrl });
  const post = selectNextPostForHydration(activity.posts, activity.reactions, {
    hotFeedbackIds: state.hotFeedbackIds,
    hydratedPostIds: state.hydratedPostIds,
    tabUrl,
  });
  if (!post?.feedbackId) return false;

  const postKey = post.postId ?? post.id;
  const template = findGraphqlRequestTemplate(data.network);
  if (!template) {
    if (!state.templateGapRecorded) {
      state.templateGapRecorded = true;
      await recordHealthGap("reaction_hydration: no GraphQL session template in capture");
    }
    return false;
  }

  const tooltipDocId = findGraphqlDocId(data.network, TOOLTIP_REACTION_QUERY);
  const tabDocId = findGraphqlDocId(data.network, TAB_CONTENT_REFETCH_QUERY);
  if (!tooltipDocId && !tabDocId) {
    if (!state.docIdGapRecorded) {
      state.docIdGapRecorded = true;
      await recordHealthGap("reaction_hydration: no reaction query doc_id captured");
    }
    return false;
  }

  const useTooltip = Boolean(tooltipDocId);
  const friendlyName = useTooltip ? TOOLTIP_REACTION_QUERY : TAB_CONTENT_REFETCH_QUERY;
  const docId = (useTooltip ? tooltipDocId : tabDocId)!;
  const feedbackId = post.feedbackId;

  let successes = 0;
  for (const reactionId of Object.values(SAMPLE_REACTION_TYPE_IDS)) {
    if (!(await tabReadyForHydration(tabId))) return successes > 0;

    const variables = useTooltip
      ? tooltipReactionVariables(feedbackId, reactionId)
      : tabContentRefetchVariables(feedbackId, reactionId);

    const fields = buildGraphqlFormBody(template, { friendlyName, docId, variables });
    const result = await fetchGraphqlInPage(tabId, fields);

    if (result.ok && result.body && responseLooksValid(result.body)) {
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
      successes++;
    }

    await sleep(jitterMs(REACTION_HYDRATION_REQUEST_DELAY_MIN_MS, REACTION_HYDRATION_REQUEST_DELAY_MAX_MS));
  }

  if (successes > 0) {
    state.hydratedPostIds.add(postKey);
    return true;
  }
  return false;
}
