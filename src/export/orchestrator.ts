import { applyEnrichers } from "../enrichers/index.js";
import { redactDeep } from "../redaction/engine.js";
import { readSessionData } from "../persistence/store.js";
import { generateReportHtml } from "../report/generate.js";
import { buildExportManifest, baseManifestFiles } from "./manifest-builder.js";
import { buildTraceSummary } from "./trace-summary.js";
import { buildFacebookCsvFiles } from "./facebook-csv.js";
import { buildGraphqlCaptures } from "./graphql-captures.js";
import { buildZip, zipFileMapFromExport } from "./zip-builder.js";
import type { SessionData } from "../shared/types.js";

/** Redact and enrich session data for export (single enrich pass). */
export async function processSessionForExport(data: SessionData): Promise<SessionData> {
  let processed = redactDeep(data);
  processed = redactDeep(await applyEnrichers(processed));
  return processed;
}

export async function buildZipFromSessionData(data: SessionData): Promise<Uint8Array> {
  return buildZipBundle(await processSessionForExport(data));
}

async function buildZipBundle(data: SessionData): Promise<Uint8Array> {
  const facebookActivity = data.enrichments?.facebookGroups;
  const graphqlCaptures = buildGraphqlCaptures(data.network);
  const csvFiles = facebookActivity ? buildFacebookCsvFiles(facebookActivity) : {};
  const files = baseManifestFiles(
    Boolean(facebookActivity),
    graphqlCaptures.length > 0,
    Object.keys(csvFiles),
  );

  const bundle = {
    reportHtml: generateReportHtml(data),
    traceSummary: JSON.stringify(buildTraceSummary(data), null, 2),
    manifest: JSON.stringify(buildExportManifest(data, files), null, 2),
    graphqlCaptures:
      graphqlCaptures.length > 0
        ? JSON.stringify(graphqlCaptures, null, 2)
        : undefined,
    groupActivity:
      facebookActivity != null
        ? JSON.stringify(facebookActivity, null, 2)
        : undefined,
  };

  const map = zipFileMapFromExport(bundle);
  for (const [path, content] of Object.entries(csvFiles)) {
    map[path] = content;
  }
  return buildZip(map);
}

export async function buildZipExport(): Promise<Uint8Array> {
  return buildZipFromSessionData(await readSessionData());
}

export function exportFilename(sessionId?: string | null): string {
  return `browser-listener-${sessionId ?? "session"}-${Date.now()}.zip`;
}

/** Build ZIP bytes + filename + entity counts for download in popup or background. */
export async function prepareZipExport(): Promise<{
  zip: Uint8Array;
  filename: string;
  counts: ReturnType<typeof buildTraceSummary>["counts"];
}> {
  const data = await readSessionData();
  const processed = await processSessionForExport(data);
  const zip = await buildZipBundle(processed);
  return {
    zip,
    filename: exportFilename(data.session?.id),
    counts: buildTraceSummary(processed).counts,
  };
}

/** @deprecated Use prepareZipExport + downloadZipFromPage/Worker */
export async function buildZipExportBlob(): Promise<{ zip: Uint8Array; filename: string }> {
  return prepareZipExport();
}
