import { extractFacebookGroupActivity } from "../enrichers/facebook-groups.js";
import type { FacebookGroupActivity, NetworkEntry } from "../shared/types.js";

let cached: { key: string; activity: FacebookGroupActivity } | null = null;

function snapshotKey(network: NetworkEntry[], tabUrl?: string): string {
  const last = network.at(-1);
  return `${network.length}:${last?.id ?? ""}:${last?.timestamp ?? 0}:${tabUrl ?? ""}`;
}

export function invalidateHydrationSnapshot(): void {
  cached = null;
}

/** Cached enricher pass for hydration target selection (invalidated when network changes). */
export function activityForHydration(
  network: NetworkEntry[],
  tabUrl?: string,
): FacebookGroupActivity {
  const key = snapshotKey(network, tabUrl);
  if (cached?.key === key) return cached.activity;
  const activity = extractFacebookGroupActivity(network, { tabUrl });
  cached = { key, activity };
  return activity;
}
