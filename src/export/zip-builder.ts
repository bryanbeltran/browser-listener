import { zipSync, strToU8 } from "fflate";

export type ZipFileMap = Record<string, string | Uint8Array>;

export function buildZip(
  files: ZipFileMap,
  mtime: Date | number = new Date("1980-01-01T00:00:00.000Z"),
): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [path, content] of Object.entries(files)) {
    entries[path] = typeof content === "string" ? strToU8(content) : content;
  }
  return zipSync(entries, { mtime });
}

export function zipFileMapFromExport(bundle: {
  reportHtml: string;
  rawHar: string;
  rawConsole: string;
  manifest: string;
  screenshots?: Record<string, Uint8Array>;
}): ZipFileMap {
  return {
    "report.html": bundle.reportHtml,
    "raw.har": bundle.rawHar,
    "raw-console.json": bundle.rawConsole,
    "export-manifest.json": bundle.manifest,
    ...(bundle.screenshots ?? {}),
  };
}
