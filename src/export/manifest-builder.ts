import type { ArtifactManifestEntry, ExportManifest, SessionData } from "../shared/types.js";

export function buildExportManifest(
  data: SessionData,
  files: ArtifactManifestEntry[],
): ExportManifest {
  return {
    version: "0.2.0",
    sessionId: data.session?.id ?? "none",
    exportedAt: Date.now(),
    privacy: { localOnly: true, remoteUpload: false },
    options: data.session?.options ?? { graphqlBodies: true },
    files,
    health: data.session?.health ?? {
      debuggerAttached: false,
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
