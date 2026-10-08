import type { ArtifactManifestEntry, ExportManifest, SessionData } from "../shared/types.js";
import { DEFAULT_CAPTURE_OPTIONS } from "../shared/types.js";
import { getExtensionVersion } from "../shared/extension-version.js";
import { COVERAGE_REPORT_SCHEMA_VERSION } from "./coverage.js";

export function buildExportManifest(
  data: SessionData,
  files: ArtifactManifestEntry[],
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
      truncation: { network: 0 },
    },
  };
}

export function baseManifestFiles(
  includeGroupActivity = false,
  includeGraphqlCaptures = false,
  csvPaths: string[] = [],
): ArtifactManifestEntry[] {
  return [
    { path: "report.html", kind: "report", optional: false, enabled: true },
    { path: "trace-summary.json", kind: "json", optional: false, enabled: true },
    { path: "coverage-report.json", kind: "json", optional: false, enabled: true },
    { path: "export-manifest.json", kind: "json", optional: false, enabled: true },
    {
      path: "group-activity.json",
      kind: "json",
      optional: true,
      enabled: includeGroupActivity,
    },
    {
      path: "graphql-captures.json",
      kind: "json",
      optional: true,
      enabled: includeGraphqlCaptures,
    },
    ...csvPaths.map(
      (path): ArtifactManifestEntry => ({
        path,
        kind: "json",
        optional: true,
        enabled: true,
      }),
    ),
  ];
}
