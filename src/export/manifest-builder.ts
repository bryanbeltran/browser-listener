import type { ArtifactManifestEntry, CaptureOptions, ExportManifest, SessionData } from "../shared/types.js";

export function buildExportManifest(
  data: SessionData,
  files: ArtifactManifestEntry[],
): ExportManifest {
  return {
    version: "0.2.0",
    sessionId: data.session?.id ?? "none",
    exportedAt: Date.now(),
    privacy: { localOnly: true, remoteUpload: false },
    options: data.session?.options ?? {
      screenRecording: false,
      tabAudio: false,
      staticAssetBodies: false,
      graphqlBodies: true,
      consoleCapture: false,
      enricherIds: [],
    },
    files,
    health: data.session?.health ?? {
      debuggerAttached: false,
      debuggerDetachCount: 0,
      serviceWorkerRestarts: 0,
      partialGaps: [],
      persistenceErrors: [],
      eventCounts: {},
      truncation: { console: 0, network: 0, timeline: 0, userActions: 0 },
    },
  };
}

export function baseManifestFiles(
  options: CaptureOptions,
  includePageMhtml = false,
  includeGroupActivity = false,
  includeGraphqlCaptures = false,
  csvPaths: string[] = [],
): ArtifactManifestEntry[] {
  return [
    { path: "report.html", kind: "report", optional: false, enabled: true },
    { path: "trace-summary.json", kind: "json", optional: false, enabled: true },
    { path: "network.har", kind: "har", optional: false, enabled: true },
    { path: "timeline.json", kind: "timeline", optional: false, enabled: true },
    { path: "console.json", kind: "json", optional: false, enabled: true },
    { path: "diagnostics.json", kind: "json", optional: false, enabled: true },
    { path: "export-manifest.json", kind: "json", optional: false, enabled: true },
    {
      path: "artifacts/page.mhtml",
      kind: "asset",
      optional: true,
      enabled: includePageMhtml,
    },
    {
      path: "artifacts/screen.webm",
      kind: "video",
      optional: true,
      enabled: options.screenRecording,
    },
    {
      path: "artifacts/audio.webm",
      kind: "audio",
      optional: true,
      enabled: options.tabAudio,
    },
    {
      path: "artifacts/static-bodies/",
      kind: "asset",
      optional: true,
      enabled: options.staticAssetBodies,
    },
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
