import { describe, expect, it } from "vitest";
import { matchesCaptureMime, matchesCaptureUrl, matchesOneRequest } from "../src/shared/capture-filters.js";

describe("capture filters", () => {
  it("matches case-insensitive URL substrings and host/path globs", () => {
    const filters = {
      urlIncludes: ["api.example.test/*"],
      urlExcludes: ["/telemetry"],
      mimeTypes: [],
    };
    expect(matchesCaptureUrl("https://API.EXAMPLE.TEST/v1/items", filters)).toBe(true);
    expect(matchesCaptureUrl("https://api.example.test/telemetry", filters)).toBe(false);
    expect(matchesCaptureUrl("https://other.example.test/v1/items", filters)).toBe(false);
  });

  it("matches exact and wildcard MIME filters", () => {
    const filters = { urlIncludes: [], urlExcludes: [], mimeTypes: ["application/json", "text/*"] };
    expect(matchesCaptureMime("application/json; charset=utf-8", filters)).toBe(true);
    expect(matchesCaptureMime("text/html", filters)).toBe(true);
    expect(matchesCaptureMime("image/png", filters)).toBe(false);
    expect(matchesCaptureMime(undefined, filters)).toBe(false);
  });

  it("supports an optional one-request URL matcher", () => {
    expect(matchesOneRequest("https://example.test/api/users", "/api/*")).toBe(true);
    expect(matchesOneRequest("https://example.test/graphql", "/api/*")).toBe(false);
    expect(matchesOneRequest("https://example.test/graphql", undefined)).toBe(true);
  });
});
