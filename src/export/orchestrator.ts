import { redactDeep, redactSensitiveString } from "../redaction/engine.js";
import { readSessionData } from "../persistence/store.js";
import { generateReportHtml } from "../report/generate.js";
import { buildCoverageReport } from "./coverage.js";
import { buildHar } from "./har.js";
import { baseManifestFiles, buildExportManifest } from "./manifest-builder.js";
import { buildSessionSummary } from "./summary.js";
import { buildZip, zipFileMapFromExport } from "./zip-builder.js";
import type { ArtifactManifestEntry, SessionData } from "../shared/types.js";
import { sha256Hex } from "./checksum.js";
import { strToU8 } from "fflate";
import { REDACTION_RULE_SET_VERSION } from "../redaction/engine.js";
import { base64ToUint8 } from "../shared/bytes.js";

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
    markers: (redacted.markers ?? []).map((entry) => ({
      ...entry,
      note: entry.note ? redactSensitiveString(entry.note) : undefined,
    })),
    // Screenshot data is opaque PNG bytes encoded as base64; redacting it would
    // make the visual artifact unreadable. Its inclusion is called out in the
    // manifest privacy warnings instead.
    screenshots: data.screenshots,
  };
}

export async function buildZipFromSessionData(
  data: SessionData,
  exportedAt = Date.now(),
): Promise<Uint8Array> {
  return buildZipBundle(await processSessionForExport(data), exportedAt);
}

async function buildZipBundle(data: SessionData, exportedAt: number): Promise<Uint8Array> {
  const coverageReport = buildCoverageReport(data, exportedAt);
  const reportHtml = generateReportHtml(data, coverageReport);
  const rawHar = JSON.stringify(buildHar(data), null, 2);
  const rawConsole = JSON.stringify(data.console, null, 2);
  const screenshotFiles: Record<string, Uint8Array> = {};
  const screenshotArtifacts: ArtifactManifestEntry[] = (data.screenshots ?? [])
    .filter((entry) => entry.state === "observed" && typeof entry.data === "string" && entry.data.length > 0)
    .flatMap((entry) => {
      const path = `screenshots/${entry.id.replace(/[^a-zA-Z0-9_-]/g, "_")}.png`;
      try {
        screenshotFiles[path] = base64ToUint8(entry.data!);
        return [{
          path,
          kind: "other" as const,
          optional: true,
          enabled: true,
          schemaVersion: 1,
        }];
      } catch {
        return [];
      }
    });
  const artifactBytes: Record<string, Uint8Array> = {
    "report.html": strToU8(reportHtml),
    "raw.har": strToU8(rawHar),
    "raw-console.json": strToU8(rawConsole),
    ...screenshotFiles,
  };
  const files = [...baseManifestFiles(), ...screenshotArtifacts].map((file) => {
    const bytes = artifactBytes[file.path];
    return bytes
      ? { ...file, bytes: bytes.byteLength, sha256: undefined }
      : file;
  });
  for (const file of files) {
    const bytes = artifactBytes[file.path];
    if (bytes) file.sha256 = await sha256Hex(bytes);
  }
  const provenance = {
    schemaVersion: 1 as const,
    deterministic: true as const,
    checksumAlgorithm: "sha256" as const,
    sourceSessionId: data.session?.id ?? "none",
    exportedAt,
    redactionRuleSetVersion: REDACTION_RULE_SET_VERSION,
    manifestChecksumExcluded: true as const,
  };
  const manifest = JSON.stringify(
    buildExportManifest(data, files, coverageReport, exportedAt, provenance),
    null,
    2,
  );
  const bundle = { reportHtml, rawHar, rawConsole, manifest, screenshots: screenshotFiles };
  return buildZip(zipFileMapFromExport(bundle), exportedAt);
}

export async function buildZipExport(): Promise<Uint8Array> {
  return buildZipFromSessionData(await readSessionData());
}

export function exportFilename(sessionId?: string | null, exportedAt = Date.now()): string {
  return `browser-listener-${sessionId ?? "session"}-${exportedAt}.zip`;
}

/** Build ZIP bytes + filename + evidence counts for popup or background. */
export async function prepareZipExport(): Promise<{
  zip: Uint8Array;
  filename: string;
  counts: ReturnType<typeof buildSessionSummary>["counts"];
}> {
  const data = await readSessionData();
  const processed = await processSessionForExport(data);
  const exportedAt = Date.now();
  const zip = await buildZipBundle(processed, exportedAt);
  return {
    zip,
    filename: exportFilename(data.session?.id, exportedAt),
    counts: buildSessionSummary(processed).counts,
  };
}

/** @deprecated Use prepareZipExport + downloadZipFromPage/Worker. */
export async function buildZipExportBlob(): Promise<{ zip: Uint8Array; filename: string }> {
  const bundle = await prepareZipExport();
  return { zip: bundle.zip, filename: bundle.filename };
}
