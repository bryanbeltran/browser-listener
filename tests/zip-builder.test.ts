import { describe, expect, it } from "vitest";
import { buildZip, zipFileMapFromExport } from "../src/export/zip-builder.js";
import { unzipToMap } from "./helpers/unzip.js";

describe("zip builder", () => {
  it("packages export files", () => {
    const zip = buildZip(
      zipFileMapFromExport({
        reportHtml: "<html></html>",
        traceSummary: "{}",
        har: "{}",
        timeline: "[]",
        console: "[]",
        diagnostics: "{}",
        manifest: "{}",
        repro: "steps",
      }),
    );
    const files = unzipToMap(zip);
    expect(Object.keys(files).sort()).toEqual(
      [
        "console.json",
        "diagnostics.json",
        "export-manifest.json",
        "network.har",
        "report.html",
        "repro-recipe.txt",
        "timeline.json",
        "trace-summary.json",
      ].sort(),
    );
  });
});
