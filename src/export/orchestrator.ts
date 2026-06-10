import { applyEnrichers } from "../enrichers/index.js";
import { redactDeep } from "../redaction/engine.js";
import { readSessionData } from "../persistence/store.js";
import { generateReportHtml } from "../report/generate.js";
import { buildExportManifest, baseManifestFiles } from "./manifest-builder.js";
import { buildHar } from "./har.js";
import { buildTraceSummary } from "./trace-summary.js";
import { buildFacebookCsvFiles } from "./facebook-csv.js";
import { buildGraphqlCaptures } from "./graphql-captures.js";
import { buildZip, zipFileMapFromExport, sessionDiagnosticsJson } from "./zip-builder.js";
import type { SessionData } from "../shared/types.js";

export interface ExportArtifacts {
  pageMhtml?: string;
}

export async function buildZipFromSessionData(
  data: SessionData,
  artifacts: ExportArtifacts = {},
): Promise<Uint8Array> {
  let processed = redactDeep(data);
  processed = redactDeep(await applyEnrichers(processed));
  return buildZipBundle(processed, artifacts);
}

async function buildZipBundle(
  data: SessionData,
  artifacts: ExportArtifacts,
): Promise<Uint8Array> {
  const pageUrl = data.session?.tabUrl ?? "about:blank";
  const facebookActivity = data.enrichments?.facebookGroups;
  const graphqlCaptures = buildGraphqlCaptures(data.network);
  const csvFiles = facebookActivity ? buildFacebookCsvFiles(facebookActivity) : {};
  const files = baseManifestFiles(
    data.session?.options ?? {
      screenRecording: false,
      tabAudio: false,
      staticAssetBodies: false,
      graphqlBodies: true,
      consoleCapture: false,
      enricherIds: [],
    },
    Boolean(artifacts.pageMhtml),
    Boolean(facebookActivity),
    graphqlCaptures.length > 0,
    Object.keys(csvFiles),
  );

  const bundle = {
    reportHtml: generateReportHtml(data),
    traceSummary: JSON.stringify(buildTraceSummary(data), null, 2),
    har: JSON.stringify(buildHar(data.network, pageUrl), null, 2),
    timeline: JSON.stringify(data.timeline, null, 2),
    console: JSON.stringify(data.console, null, 2),
    diagnostics: sessionDiagnosticsJson(data),
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
  if (artifacts.pageMhtml) {
    map["artifacts/page.mhtml"] = artifacts.pageMhtml;
  }
  for (const [path, content] of Object.entries(csvFiles)) {
    map[path] = content;
  }
  return buildZip(map);
}

export async function buildZipExport(artifacts: ExportArtifacts = {}): Promise<Uint8Array> {
  return buildZipFromSessionData(await readSessionData(), artifacts);
}

export function exportFilename(sessionId?: string | null): string {
  return `browser-listener-${sessionId ?? "session"}-${Date.now()}.zip`;
}

/** Build ZIP bytes + filename for download in popup or background. */
export async function prepareZipExport(
  artifacts: ExportArtifacts = {},
): Promise<{ zip: Uint8Array; filename: string }> {
  const data = await readSessionData();
  const zip = await buildZipFromSessionData(data, artifacts);
  return { zip, filename: exportFilename(data.session?.id) };
}

/** @deprecated Use prepareZipExport + downloadZipFromPage/Worker */
export async function buildZipExportBlob(): Promise<{ zip: Uint8Array; filename: string }> {
  return prepareZipExport();
}
