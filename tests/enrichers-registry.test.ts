import { describe, expect, it } from "vitest";
import { applyEnrichers, listEnrichers, registerEnricher } from "../src/enrichers/index.js";
import { leakySessionData } from "./helpers/fixtures.js";

describe("enrichers registry", () => {
  it("core export works with empty registry", async () => {
    expect(listEnrichers()).toEqual([]);
    const out = await applyEnrichers(leakySessionData());
    expect(out.session?.id).toBe("test-session-1");
  });

  it("runs enricher only when enabled in session options", async () => {
    const data = leakySessionData();
    registerEnricher({
      id: "test-enricher",
      label: "Test",
      enrich: (s) => ({
        ...s,
        timeline: [
          ...s.timeline,
          {
            id: "t-enriched",
            sessionId: s.session!.id,
            timestamp: Date.now(),
            category: "system",
            type: "enriched",
            summary: "enriched",
          },
        ],
      }),
    });
    const without = await applyEnrichers(data);
    expect(without.timeline.some((t) => t.type === "enriched")).toBe(false);
    data.session!.options.enricherIds = ["test-enricher"];
    const with_ = await applyEnrichers(data);
    expect(with_.timeline.some((t) => t.type === "enriched")).toBe(true);
  });
});
