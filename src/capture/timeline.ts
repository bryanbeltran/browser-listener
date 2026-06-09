import { appendTimeline } from "../persistence/store.js";
import type { TimelineEvent } from "../shared/types.js";

export async function recordTimeline(
  sessionId: string,
  category: TimelineEvent["category"],
  type: string,
  summary: string,
  extra?: Partial<TimelineEvent>,
): Promise<void> {
  await appendTimeline({
    id: crypto.randomUUID(),
    sessionId,
    timestamp: Date.now(),
    category,
    type,
    summary,
    ...extra,
  });
}
