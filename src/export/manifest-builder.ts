import type { ArtifactManifestEntry, ExportManifest, SessionData } from "../shared/types.js";
import { DEFAULT_CAPTURE_OPTIONS } from "../shared/types.js";
import { emptyTruncation } from "../persistence/limits.js";
import { getExtensionVersion } from "../shared/extension-version.js";
import { COVERAGE_REPORT_SCHEMA_VERSION } from "./coverage.js";

export const REQUIRED_EXPORT_FILES = [
  "report.html",
  "session.json",
  "network.json",
  "console.json",
  "coverage-report.json",
  "export-manifest.json",
] as const;

export function buildExportManifest(
  data: SessionData,
  files: ArtifactManifestEntry[] = baseManifestFiles(),
): ExportManifest {
  const extensionVersion = data.session?.extensionVersion ?? getExtensionVersion();
  return {
    version: extensionVersion,
    extensionVersion,
    sessionId: data.session?.id ?? "none",
    exportedAt: Date.now(),
    privacy: { localOnly: true, remoteUpload: false },
    options: data.session?.options ?? DEFAULT_CAPTURE_OPTIONS,
    files,
    coverage: { path: "coverage-report.json", schemaVersion: COVERAGE_REPORT_SCHEMA_VERSION },
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
    kind: path === "report.html" ? "report" : "json",
    optional: false,
    enabled: true,
  }));
}
