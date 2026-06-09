import { describe, expect, it } from "vitest";
import { networkEntryToCurl } from "../src/export/curl.js";
import { REDACTED } from "../src/redaction/engine.js";
import { leakySessionData } from "./helpers/fixtures.js";

describe("copy as cURL", () => {
  it("redacts authorization header in curl output", () => {
    const entry = leakySessionData().network[0];
    const curl = networkEntryToCurl(entry);
    expect(curl).toContain("curl -X GET");
    expect(curl).toContain(REDACTED);
    expect(curl).not.toContain("Bearer eyJhbG");
  });
});
