import type { ArtifactManifestEntry, CoverageReport, ExportManifest, SessionData } from "../shared/types.js";
import {
  captureProfileDefaults,
  DEFAULT_CAPTURE_OPTIONS,
  inferCaptureProfile,
} from "../shared/types.js";
import { emptyTruncation } from "../persistence/limits.js";
import { getExtensionVersion } from "../shared/extension-version.js";
import { buildCoverageReport } from "./coverage.js";
import { REDACTION_RULE_SET_VERSION } from "../redaction/engine.js";
import { buildRedactionAudit } from "../redaction/audit.js";

export const REQUIRED_EXPORT_FILES = [
  "report.html",
  "raw.har",
  "raw-console.json",
  "export-manifest.json",
] as const;

export const EXPORT_MANIFEST_SCHEMA_VERSION = 3 as const;

export function buildExportManifest(
  data: SessionData,
  files: ArtifactManifestEntry[] = baseManifestFiles(),
  coverage: CoverageReport = buildCoverageReport(data),
  exportedAt = coverage.generatedAt,
): ExportManifest {
  const extensionVersion = data.session?.extensionVersion ?? getExtensionVersion();
  const profile = inferCaptureProfile(data.session?.options);
  const options = {
    ...DEFAULT_CAPTURE_OPTIONS,
    ...data.session?.options,
    ...captureProfileDefaults(profile),
    profile,
  };
  return {
    schemaVersion: EXPORT_MANIFEST_SCHEMA_VERSION,
    format: "browser-listener",
    version: extensionVersion,
    extensionVersion,
    sessionId: data.session?.id ?? "none",
    exportedAt,
    privacy: {
      schemaVersion: 1,
      redactionRuleSetVersion: REDACTION_RULE_SET_VERSION,
      audit: buildRedactionAudit(data),
      captureBodies: options.captureBodies,
      captureConsole: options.captureConsole,
      scope: "active-tab",
      localOnly: true,
      remoteUpload: false,
      redactionEnabled: data.session?.options?.redactionEnabled !== false,
    },
    options,
    files,
    coverage,
    health: data.session?.health ?? {
      debuggerAttached: false,
      debuggerEverAttached: false,
      debuggerDetachCount: 0,
      serviceWorkerRestarts: 0,
      partialGaps: [],
      persistenceErrors: [],
      truncation: emptyTruncation(),
    },
  };
}

export function baseManifestFiles(): ArtifactManifestEntry[] {
  return REQUIRED_EXPORT_FILES.map((path) => ({
    path,
    kind: path === "report.html" ? "report" : path === "raw.har" ? "har" : "json",
    optional: false,
    enabled: true,
    schemaVersion: 1,
  }));
}
