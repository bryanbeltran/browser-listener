import { describe, expect, it } from "vitest";
import { buildZip, zipFileMapFromExport } from "../src/export/zip-builder.js";
import { unzipToMap } from "./helpers/unzip.js";

describe("zip builder", () => {
  it("includes four required export files", () => {
    const zip = buildZip(
      zipFileMapFromExport({
        reportHtml: "<html></html>",
        rawHar: "{}",
        rawConsole: "[]",
        manifest: "{}",
      }),
    );
    expect(Object.keys(unzipToMap(zip)).sort()).toEqual([
      "export-manifest.json",
      "raw-console.json",
      "raw.har",
      "report.html",
    ]);
  });
});
