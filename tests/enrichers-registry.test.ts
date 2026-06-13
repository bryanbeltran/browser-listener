import { describe, expect, it } from "vitest";
import { applyEnrichers, listEnrichers, registerEnricher } from "../src/enrichers/index.js";
import { leakySessionData } from "./helpers/fixtures.js";

describe("enrichers registry", () => {
  it("registers facebook-groups enricher by default", async () => {
    expect(listEnrichers().some((e) => e.id === "facebook-groups")).toBe(true);
    const out = await applyEnrichers(leakySessionData());
    expect(out.session?.id).toBe("test-session-1");
  });

  it("runs all registered enrichers at export time", async () => {
    const data = leakySessionData();
    registerEnricher({
      id: "test-enricher",
      label: "Test",
      enrich: (s) => ({
        ...s,
        enrichments: { ...s.enrichments, facebookGroups: { groups: [], members: [], people: [], posts: [], comments: [], reactions: [], graphqlQueryHints: [] } },
      }),
    });
    const out = await applyEnrichers(data);
    expect(out.enrichments?.facebookGroups).toBeDefined();
  });
});
