import type { SessionData } from "../shared/types.js";

/** Optional post-processors; keep core generic — no product-specific logic here. */
export interface SessionEnricher {
  id: string;
  label: string;
  /** Run only when explicitly enabled in CaptureOptions.enricherIds */
  enrich(session: SessionData): SessionData | Promise<SessionData>;
}
