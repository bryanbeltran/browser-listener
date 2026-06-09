import { applyEnrichers } from "../enrichers/index.js";
import { redactDeep } from "../redaction/engine.js";
import { readSessionData } from "../persistence/store.js";
import { generateReportHtml } from "../report/generate.js";
import { buildExportManifest, baseManifestFiles } from "./manifest-builder.js";
import { buildHar } from "./har.js";
import { buildTraceSummary } from "./trace-summary.js";
import { buildReproRecipe } from "./repro-recipe.js";
import { buildZip, zipFileMapFromExport, sessionDiagnosticsJson } from "./zip-builder.js";
import type { SessionData } from "../shared/types.js";

export async function buildZipFromSessionData(data: SessionData): Promise<Uint8Array> {
  let processed = redactDeep(data);
  processed = redactDeep(await applyEnrichers(processed));
  return buildZipBundle(processed);
}

async function buildZipBundle(data: SessionData): Promise<Uint8Array> {

  const pageUrl = data.session?.tabUrl ?? "about:blank";
  const files = baseManifestFiles(
    data.session?.options ?? {
      screenRecording: false,
      tabAudio: false,
      staticAssetBodies: false,
      enricherIds: [],
    },
  );

  const bundle = {
    reportHtml: generateReportHtml(data),
    traceSummary: JSON.stringify(buildTraceSummary(data), null, 2),
    har: JSON.stringify(buildHar(data.network, pageUrl), null, 2),
    timeline: JSON.stringify(data.timeline, null, 2),
    console: JSON.stringify(data.console, null, 2),
    diagnostics: sessionDiagnosticsJson(data),
    manifest: JSON.stringify(buildExportManifest(data, files), null, 2),
    repro: buildReproRecipe(data.userActions),
  };

  return buildZip(zipFileMapFromExport(bundle));
}

export async function buildZipExport(): Promise<Uint8Array> {
  return buildZipFromSessionData(await readSessionData());
}

export async function downloadZipExport(): Promise<void> {
  const zip = await buildZipExport();
  const blob = new Blob([new Uint8Array(zip)], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const data = await readSessionData();
  const name = `browser-listener-${data.session?.id ?? "session"}-${Date.now()}.zip`;
  try {
    await chrome.downloads.download({ url, filename: name, saveAs: true });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

/** Testable entry without Chrome downloads API */
export async function buildZipExportBlob(): Promise<{ zip: Uint8Array; filename: string }> {
  const zip = await buildZipExport();
  const data = await readSessionData();
  return {
    zip,
    filename: `browser-listener-${data.session?.id ?? "session"}-${Date.now()}.zip`,
  };
}
