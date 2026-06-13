export {
  ensureHydrationIndex,
  getHydrationActivity,
  ingestNetworkEntry,
  resetHydrationIndex,
} from "./hydration-index.js";

import { getHydrationActivity } from "./hydration-index.js";
import type { FacebookGroupActivity, NetworkEntry } from "../shared/types.js";

/** @deprecated Use getHydrationActivity — kept for tests that pass a full network array. */
export function activityForHydration(
  network: NetworkEntry[],
  tabUrl?: string,
): Pick<FacebookGroupActivity, "posts" | "comments" | "reactions"> {
  void network;
  void tabUrl;
  return getHydrationActivity();
}

export function invalidateHydrationSnapshot(): void {
  /* incremental index updates per entry; no snapshot cache */
}
