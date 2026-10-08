import { describe, expect, it } from "vitest";
import { buildRedactionPreview } from "../src/redaction/preview.js";

describe("redaction preview", () => {
  it("uses synthetic canaries and demonstrates default protections", () => {
    const preview = buildRedactionPreview();
    expect(preview.synthetic).toBe(true);
    expect(preview.examples.length).toBeGreaterThanOrEqual(5);
    expect(preview.examples.every((example) => example.redacted)).toBe(true);
    expect(JSON.stringify(preview)).toContain("synthetic");
    expect(preview.note).toContain("not a guarantee");
    expect(JSON.stringify(preview.examples.map((example) => example.output))).not.toContain("synthetic-token");
  });
});
