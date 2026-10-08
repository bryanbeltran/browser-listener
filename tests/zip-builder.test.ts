import { describe, expect, it } from "vitest";
import { buildZip, zipFileMapFromExport } from "../src/export/zip-builder.js";
import { unzipToMap } from "./helpers/unzip.js";

describe("zip builder", () => {
  it("includes six required export files", () => {
    const zip = buildZip(
      zipFileMapFromExport({
        reportHtml: "<html></html>",
        session: "{}",
        network: "[]",
        console: "[]",
        coverageReport: "{}",
        manifest: "{}",
      }),
    );
    expect(Object.keys(unzipToMap(zip)).sort()).toEqual([
      "console.json",
      "coverage-report.json",
      "export-manifest.json",
      "network.json",
      "report.html",
      "session.json",
    ]);
  });
});
