import { describe, expect, it } from "vitest";
import { buildHar } from "../src/export/har.js";
import { sampleExportSessionData } from "./fixtures/sample-session.js";

describe("HAR export", () => {
  it("maps network and navigation evidence to HAR 1.2", () => {
    const har = buildHar(sampleExportSessionData());
    const entry = har.log.entries[0];

    expect(har.log.version).toBe("1.2");
    expect(har.log.pages).toHaveLength(1);
    expect(har.log.pages[0]?._browserListener.url).toContain("example.test");
    expect(entry?.request.method).toBe("GET");
    expect(entry?.request.queryString).toEqual([{ name: "page", value: "1" }]);
    expect(entry?.response.status).toBe(200);
    expect(entry?.response.content.text).toContain('"items"');
    expect(entry?.timings.wait).toBe(entry?.time);
  });
});
