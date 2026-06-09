import { zipSync, strToU8 } from "fflate";
import type { SessionData } from "../shared/types.js";

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
  traceSummary: string;
  har: string;
  timeline: string;
  console: string;
  diagnostics: string;
  manifest: string;
  repro: string;
}): ZipFileMap {
  return {
    "report.html": bundle.reportHtml,
    "trace-summary.json": bundle.traceSummary,
    "network.har": bundle.har,
    "timeline.json": bundle.timeline,
    "console.json": bundle.console,
    "diagnostics.json": bundle.diagnostics,
    "export-manifest.json": bundle.manifest,
    "repro-recipe.txt": bundle.repro,
  };
}

export function sessionDiagnosticsJson(data: SessionData): string {
  return JSON.stringify(
    {
      frames: data.diagnostics.flatMap((d) => d.frames),
      domSnapshots: data.domSnapshots,
      latestDiagnostics: data.diagnostics.at(-1),
    },
    null,
    2,
  );
}
