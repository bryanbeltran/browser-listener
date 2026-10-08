import type { ArtifactManifestEntry, CoverageReport, ExportManifest, SessionData } from "../shared/types.js";
import { DEFAULT_CAPTURE_OPTIONS } from "../shared/types.js";
import { emptyTruncation } from "../persistence/limits.js";
import { getExtensionVersion } from "../shared/extension-version.js";
import { buildCoverageReport } from "./coverage.js";

export const REQUIRED_EXPORT_FILES = [
  "report.html",
  "raw.har",
  "raw-console.json",
  "export-manifest.json",
] as const;

export function buildExportManifest(
  data: SessionData,
  files: ArtifactManifestEntry[] = baseManifestFiles(),
  coverage: CoverageReport = buildCoverageReport(data),
): ExportManifest {
  const extensionVersion = data.session?.extensionVersion ?? getExtensionVersion();
  return {
    schemaVersion: 2,
    format: "browser-listener",
    version: extensionVersion,
    extensionVersion,
    sessionId: data.session?.id ?? "none",
    exportedAt: Date.now(),
    privacy: { localOnly: true, remoteUpload: false },
    options: data.session?.options ?? DEFAULT_CAPTURE_OPTIONS,
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
  }));
}
