import type { SessionData } from "../shared/types.js";

export interface SessionEnricher {
  id: string;
  label: string;
  enrich(data: SessionData): SessionData | Promise<SessionData>;
}
