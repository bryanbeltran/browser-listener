import { redactDeep, redactSensitiveString } from "../redaction/engine.js";
import { readSessionData } from "../persistence/store.js";
import { generateReportHtml } from "../report/generate.js";
import { buildCoverageReport } from "./coverage.js";
import { buildHar } from "./har.js";
import { baseManifestFiles, buildExportManifest } from "./manifest-builder.js";
import { buildSessionSummary } from "./summary.js";
import { buildZip, zipFileMapFromExport } from "./zip-builder.js";
import type { SessionData } from "../shared/types.js";

/** Redact export data again at the boundary. */
export async function processSessionForExport(data: SessionData): Promise<SessionData> {
  if (data.session?.options?.redactionEnabled === false) return data;
  const redacted = redactDeep(data);
  return {
    ...redacted,
    navigation: redacted.navigation.map((entry) => ({
      ...entry,
      title: entry.title ? redactSensitiveString(entry.title) : undefined,
    })),
    console: redacted.console.map((entry) => ({
      ...entry,
      text: redactSensitiveString(entry.text),
      stackTrace: entry.stackTrace ? redactSensitiveString(entry.stackTrace) : undefined,
      args: entry.args?.map((arg) => redactSensitiveString(arg)),
    })),
  };
}

export async function buildZipFromSessionData(data: SessionData): Promise<Uint8Array> {
  return buildZipBundle(await processSessionForExport(data));
}

async function buildZipBundle(data: SessionData): Promise<Uint8Array> {
  const coverageReport = buildCoverageReport(data);
  const files = baseManifestFiles();
  const bundle = {
    reportHtml: generateReportHtml(data, coverageReport),
    rawHar: JSON.stringify(buildHar(data), null, 2),
    rawConsole: JSON.stringify(data.console, null, 2),
    manifest: JSON.stringify(buildExportManifest(data, files, coverageReport), null, 2),
  };
  return buildZip(zipFileMapFromExport(bundle));
}

export async function buildZipExport(): Promise<Uint8Array> {
  return buildZipFromSessionData(await readSessionData());
}

export function exportFilename(sessionId?: string | null): string {
  return `browser-listener-${sessionId ?? "session"}-${Date.now()}.zip`;
}

/** Build ZIP bytes + filename + evidence counts for popup or background. */
export async function prepareZipExport(): Promise<{
  zip: Uint8Array;
  filename: string;
  counts: ReturnType<typeof buildSessionSummary>["counts"];
}> {
  const data = await readSessionData();
  const processed = await processSessionForExport(data);
  const zip = await buildZipBundle(processed);
  return {
    zip,
    filename: exportFilename(data.session?.id),
    counts: buildSessionSummary(processed).counts,
  };
}

/** @deprecated Use prepareZipExport + downloadZipFromPage/Worker. */
export async function buildZipExportBlob(): Promise<{ zip: Uint8Array; filename: string }> {
  const bundle = await prepareZipExport();
  return { zip: bundle.zip, filename: bundle.filename };
}
