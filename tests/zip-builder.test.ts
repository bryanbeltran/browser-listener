import { describe, expect, it } from "vitest";
import { buildZip, zipFileMapFromExport } from "../src/export/zip-builder.js";
import { unzipToMap } from "./helpers/unzip.js";

describe("zip builder", () => {
  it("includes core export files", () => {
    const zip = buildZip(
      zipFileMapFromExport({
        reportHtml: "<html></html>",
        traceSummary: "{}",
        manifest: "{}",
        graphqlCaptures: "[]",
        groupActivity: "{}",
      }),
    );
    const files = unzipToMap(zip);
    expect(Object.keys(files).sort()).toEqual(
      [
        "export-manifest.json",
        "graphql-captures.json",
        "group-activity.json",
        "report.html",
        "trace-summary.json",
      ].sort(),
    );
  });
});
