import type {
  ArtifactManifestEntry,
  CoverageReport,
  ExportManifest,
  ExportProvenance,
  SessionData,
} from "../shared/types.js";
import {
  captureProfileDefaults,
  DEFAULT_CAPTURE_OPTIONS,
  inferCaptureProfile,
  normalizeCaptureBudgets,
} from "../shared/types.js";
import { emptyTruncation } from "../persistence/limits.js";
import { getExtensionVersion } from "../shared/extension-version.js";
import { buildCoverageReport } from "./coverage.js";
import { buildPrivacyReceipt } from "./privacy-receipt.js";

export const REQUIRED_EXPORT_FILES = [
  "report.html",
  "raw.har",
  "raw-console.json",
  "export-manifest.json",
] as const;

export const EXPORT_MANIFEST_SCHEMA_VERSION = 4 as const;

function privacyWarnings(data: SessionData, coverage: CoverageReport): string[] {
  const warnings: string[] = [];
  if (data.session?.options?.redactionEnabled === false) {
    warnings.push("Redaction was explicitly disabled; treat captured values as sensitive.");
  }
  if (coverage.quality.partial) warnings.push("Capture completeness is partial; inspect coverage and health gaps before sharing.");
  if (coverage.quality.fairBudgetEvictions > 0) {
    warnings.push("Fair storage budgets evicted older network entries from an overrepresented origin or category.");
  }
  if (coverage.quality.bodySkipReasons["unsafe-mime-type"] || coverage.quality.bodySkipReasons["session-budget"]) {
    warnings.push("Some request or response bodies were not retained because of safety or storage policy.");
  }
  if (data.screenshots?.some((entry) => entry.state === "observed")) {
    warnings.push("Visual evidence is included; screenshots can contain visible secrets and are not text-redacted.");
  }
  if (data.screenshots?.some((entry) => entry.state === "unavailable")) {
    warnings.push("One or more explicit screenshot requests were unavailable; review capture health before relying on visual absence.");
  }
  return warnings;
}

export function buildExportManifest(
  data: SessionData,
  files: ArtifactManifestEntry[] = baseManifestFiles(),
  coverage: CoverageReport = buildCoverageReport(data),
  exportedAt = coverage.generatedAt,
  provenance?: ExportProvenance,
): ExportManifest {
  const extensionVersion = data.session?.extensionVersion ?? getExtensionVersion();
  const profile = inferCaptureProfile(data.session?.options);
  const options = {
    ...DEFAULT_CAPTURE_OPTIONS,
    ...data.session?.options,
    ...captureProfileDefaults(profile),
    profile,
    budgets: normalizeCaptureBudgets(data.session?.options?.budgets),
  };
  const baseWarnings = privacyWarnings(data, coverage);
  return {
    schemaVersion: EXPORT_MANIFEST_SCHEMA_VERSION,
    format: "browser-listener",
    version: extensionVersion,
    extensionVersion,
    sessionId: data.session?.id ?? "none",
    exportedAt,
    privacy: buildPrivacyReceipt(data, coverage, baseWarnings),
    options,
    files,
    ...(provenance ? { provenance } : {}),
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
