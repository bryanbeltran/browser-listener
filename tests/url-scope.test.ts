import { describe, expect, it } from "vitest";
import { isFacebookHost, isFacebookUrl } from "../src/shared/urls.js";

describe("Facebook URL scope", () => {
  it("accepts Facebook and subdomain hosts only", () => {
    expect(isFacebookHost("facebook.com")).toBe(true);
    expect(isFacebookHost("www.facebook.com")).toBe(true);
    expect(isFacebookHost("evilfacebook.com")).toBe(false);
    expect(isFacebookHost("facebook.com.evil.test")).toBe(false);
  });

  it("requires HTTPS for capture URLs", () => {
    expect(isFacebookUrl("https://www.facebook.com/groups/example")).toBe(true);
    expect(isFacebookUrl("http://www.facebook.com/groups/example")).toBe(false);
    expect(isFacebookUrl("https://evilfacebook.com/groups/example")).toBe(false);
  });
});
