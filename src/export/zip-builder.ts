import { zipSync, strToU8 } from "fflate";

export type ZipFileMap = Record<string, string | Uint8Array>;

export function buildZip(files: ZipFileMap): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [path, content] of Object.entries(files)) {
    entries[path] = typeof content === "string" ? strToU8(content) : content;
  }
  return zipSync(entries);
}

export function zipFileMapFromExport(bundle: {
  reportHtml: string;
  session: string;
  network: string;
  console: string;
  coverageReport: string;
  manifest: string;
}): ZipFileMap {
  return {
    "report.html": bundle.reportHtml,
    "session.json": bundle.session,
    "network.json": bundle.network,
    "console.json": bundle.console,
    "coverage-report.json": bundle.coverageReport,
    "export-manifest.json": bundle.manifest,
  };
}
