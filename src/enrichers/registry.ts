import type { SessionEnricher } from "./types.js";
import type { SessionData } from "../shared/types.js";

const enrichers: SessionEnricher[] = [];

export function registerEnricher(enricher: SessionEnricher): void {
  if (!enrichers.some((e) => e.id === enricher.id)) enrichers.push(enricher);
}

export function listEnrichers(): SessionEnricher[] {
  return [...enrichers];
}

/** Run all registered enrichers at export time. */
export async function applyEnrichers(data: SessionData): Promise<SessionData> {
  let out = data;
  for (const e of enrichers) {
    out = await e.enrich(out);
  }
  return out;
}
