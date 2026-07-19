import { consolidateFacebookReactions, extractFacebookGroupActivity } from "../enrichers/facebook-groups.js";
import {
  findGraphqlDocId,
  findGraphqlRequestTemplate,
  isFacebookGraphqlUrl,
  parseGraphqlFormBody,
} from "./graphql-template.js";
import { listNetworkEntries } from "../persistence/network-store.js";
import type {
  FacebookComment,
  FacebookGroupActivity,
  FacebookPost,
  FacebookReaction,
  NetworkEntry,
} from "../shared/types.js";

interface HydrationIndexState {
  posts: Map<string, FacebookPost>;
  comments: Map<string, FacebookComment>;
  reactions: FacebookReaction[];
  template: Record<string, string> | null;
  templateTimestamp: number;
  docIds: Map<string, string>;
  rebuiltForSession: string | null;
}

const state: HydrationIndexState = {
  posts: new Map(),
  comments: new Map(),
  reactions: [],
  template: null,
  templateTimestamp: 0,
  docIds: new Map(),
  rebuiltForSession: null,
};

function postIndexKey(post: FacebookPost): string {
  return post.postId ?? post.id;
}

function commentIndexKey(comment: FacebookComment): string {
  return comment.id;
}

function mergePost(existing: FacebookPost | undefined, incoming: FacebookPost): FacebookPost {
  if (!existing) return incoming;
  return {
    ...existing,
    ...incoming,
    text: incoming.text ?? existing.text,
    url: incoming.url ?? existing.url,
    feedbackId: incoming.feedbackId ?? existing.feedbackId,
    reactionCount: incoming.reactionCount ?? existing.reactionCount,
    partialParse: incoming.partialParse ?? existing.partialParse,
  };
}

function mergeComment(
  existing: FacebookComment | undefined,
  incoming: FacebookComment,
): FacebookComment {
  if (!existing) return incoming;
  return {
    ...existing,
    ...incoming,
    text: incoming.text ?? existing.text,
    feedbackId: incoming.feedbackId ?? existing.feedbackId,
    reactionCount: incoming.reactionCount ?? existing.reactionCount,
  };
}

function mergeActivity(slice: FacebookGroupActivity): void {
  for (const post of slice.posts) {
    const key = postIndexKey(post);
    state.posts.set(key, mergePost(state.posts.get(key), post));
  }
  for (const comment of slice.comments) {
    const key = commentIndexKey(comment);
    state.comments.set(key, mergeComment(state.comments.get(key), comment));
  }
  state.reactions.push(...slice.reactions);
}

function ingestGraphqlTemplate(entry: NetworkEntry): void {
  if (!isFacebookGraphqlUrl(entry.url)) return;
  if (entry.method !== "POST") return;
  if (entry.requestId?.startsWith("hydrate-")) return;

  const form = parseGraphqlFormBody(entry.requestBody);
  if (form.fb_dtsg || form.lsd) {
    if (!state.template || entry.timestamp >= state.templateTimestamp) {
      state.template = { ...form };
      state.templateTimestamp = entry.timestamp;
    }
  }
  const friendlyName = form.fb_api_req_friendly_name;
  if (friendlyName && form.doc_id) {
    state.docIds.set(friendlyName, form.doc_id);
  }
}

/** Reset incremental hydration index (new session or tests). */
export function resetHydrationIndex(): void {
  state.posts.clear();
  state.comments.clear();
  state.reactions = [];
  state.template = null;
  state.templateTimestamp = 0;
  state.docIds.clear();
  state.rebuiltForSession = null;
}

/** Incrementally update hydration index from one persisted network entry. */
export function ingestNetworkEntry(entry: NetworkEntry, tabUrl?: string): void {
  ingestGraphqlTemplate(entry);
  if (!entry.responseBody || !isFacebookGraphqlUrl(entry.url)) return;
  mergeActivity(extractFacebookGroupActivity([entry], { tabUrl }));
}

/** One-time rebuild after service worker restart or IDB eviction. */
export async function ensureHydrationIndex(sessionId: string, tabUrl?: string): Promise<void> {
  if (state.rebuiltForSession === sessionId) return;
  resetHydrationIndex();
  for (const entry of await listNetworkEntries(sessionId)) {
    ingestNetworkEntry(entry, tabUrl);
  }
  state.rebuiltForSession = sessionId;
}

/** Force a full rebuild from IndexedDB (e.g. after oldest-entry eviction). */
export async function rebuildHydrationIndex(sessionId: string, tabUrl?: string): Promise<void> {
  state.rebuiltForSession = null;
  await ensureHydrationIndex(sessionId, tabUrl);
}

export function getHydrationActivity(): Pick<
  FacebookGroupActivity,
  "posts" | "comments" | "reactions"
> {
  return {
    posts: [...state.posts.values()],
    comments: [...state.comments.values()],
    reactions: consolidateFacebookReactions(state.reactions),
  };
}

export function getCachedGraphqlTemplate(network: NetworkEntry[]): Record<string, string> | null {
  return state.template ?? findGraphqlRequestTemplate(network);
}

export function getCachedGraphqlDocId(
  network: NetworkEntry[],
  friendlyName: string,
): string | undefined {
  return state.docIds.get(friendlyName) ?? findGraphqlDocId(network, friendlyName);
}
