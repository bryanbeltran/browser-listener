import { captureProfileDefaults, inferCaptureProfile } from "../shared/types.js";
import type { CoverageMetric, CoverageReport, SessionData } from "../shared/types.js";
import { getExtensionVersion } from "../shared/extension-version.js";

export const COVERAGE_REPORT_SCHEMA_VERSION = 3 as const;

function metric(total: number, present: number): CoverageMetric {
  return {
    present,
    total,
    percent: total === 0 ? 0 : Math.round((present / total) * 1000) / 10,
  };
}

function hasValue(value: unknown): boolean {
  return typeof value === "string" ? value.trim().length > 0 : value != null;
}

export function buildCoverageReport(data: SessionData, generatedAt = Date.now()): CoverageReport {
  const health = data.session?.health;
  const network = data.network;
  const navigation = data.navigation;
  const consoleEntries = data.console;
  const markers = data.markers ?? [];
  const contextSnapshots = data.contextSnapshots ?? [];
  const performanceSignals = data.performanceSignals ?? [];
  const requestBodies = network.filter((entry) => hasValue(entry.requestBody));
  const responseBodies = network.filter((entry) => hasValue(entry.responseBody));
  const profile = inferCaptureProfile(data.session?.options);
  const profileOptions = captureProfileDefaults(profile);
  const hasExplicitProfile = data.session?.options?.profile != null;
  const gapReasons = [...new Set((health?.partialGaps ?? []).map((gap) => gap.reason))].sort();
  const truncation = health?.truncation;
  const partial = Boolean(
    data.session?.tabClosedDuringCapture ||
      gapReasons.length > 0 ||
      (truncation &&
        (truncation.network > 0 ||
          truncation.navigation > 0 ||
          truncation.console > 0 ||
          (truncation.markers ?? 0) > 0 ||
          (truncation.contextSnapshots ?? 0) > 0 ||
          (truncation.performanceSignals ?? 0) > 0)) ||
      (health?.persistenceErrors.length ?? 0) > 0,
  );

  return {
    schemaVersion: COVERAGE_REPORT_SCHEMA_VERSION,
    generatedAt,
    source: {
      sessionId: data.session?.id,
      extensionVersion: data.session?.extensionVersion ?? getExtensionVersion(),
      tabUrl: data.session?.tabUrl,
      startedAt: data.session?.startedAt,
      stoppedAt: data.session?.stoppedAt,
      targets: (data.session?.targets ?? [{ tabId: data.session?.tabId ?? -1, url: data.session?.tabUrl }]).map((target) => ({
        tabId: target.tabId,
        ...(target.url ? { url: target.url } : {}),
        ...(target.tabClosed == null ? {} : { closed: target.tabClosed }),
        ...(target.debuggerEverAttached == null ? {} : { debuggerEverAttached: target.debuggerEverAttached }),
        gapCount: target.partialGaps?.length ?? 0,
      })),
    },
    capture: {
      paused: data.session?.paused === true,
      pauseIntervals: data.session?.pauseIntervals ?? [],
    },
    policy: {
      profile,
      redactionEnabled: data.session?.options?.redactionEnabled !== false,
      captureBodies: hasExplicitProfile
        ? profileOptions.captureBodies
        : data.session?.options?.captureBodies ?? profileOptions.captureBodies,
      captureConsole: hasExplicitProfile
        ? profileOptions.captureConsole
        : data.session?.options?.captureConsole ?? profileOptions.captureConsole,
      allowedOrigins: data.session?.options?.allowedOrigins ?? [],
    },
    totals: {
      network: network.length,
      navigation: navigation.length,
      console: consoleEntries.length,
      markers: markers.length,
      requestBodies: requestBodies.length,
      responseBodies: responseBodies.length,
      contextSnapshots: contextSnapshots.length,
      performanceSignals: performanceSignals.length,
    },
    fields: {
      network: {
        statusCode: metric(network.length, network.filter((entry) => entry.statusCode != null).length),
        responseHeaders: metric(
          network.length,
          network.filter((entry) => Object.keys(entry.responseHeaders ?? {}).length > 0).length,
        ),
        responseBody: metric(network.length, responseBodies.length),
      },
      navigation: {
        title: metric(navigation.length, navigation.filter((entry) => hasValue(entry.title)).length),
        url: metric(navigation.length, navigation.filter((entry) => hasValue(entry.url)).length),
      },
      console: {
        text: metric(consoleEntries.length, consoleEntries.filter((entry) => hasValue(entry.text)).length),
        source: metric(consoleEntries.length, consoleEntries.filter((entry) => hasValue(entry.source)).length),
      },
      markers: {
        label: metric(markers.length, markers.filter((entry) => hasValue(entry.label)).length),
        note: metric(markers.length, markers.filter((entry) => hasValue(entry.note)).length),
      },
    },
    quality: {
      networkTruncated: health?.truncation.network ?? 0,
      navigationTruncated: health?.truncation.navigation ?? 0,
      consoleTruncated: health?.truncation.console ?? 0,
      bodiesTruncated: network.filter(
        (entry) => entry.requestBodyTruncated || entry.responseBodyTruncated,
      ).length,
      bodiesSkippedSessionCap: health?.bodiesSkippedSessionCap ?? 0,
      healthGaps: health?.partialGaps.length ?? 0,
      persistenceErrors: health?.persistenceErrors.length ?? 0,
      markersTruncated: health?.truncation.markers ?? 0,
      contextSnapshotsTruncated: health?.truncation.contextSnapshots ?? 0,
      performanceSignalsTruncated: health?.truncation.performanceSignals ?? 0,
      filteredNetworkRequests: health?.filteredNetworkRequests ?? 0,
      partial,
      gapReasons,
    },
  };
}
