import { REDACTED } from "../redaction/engine.js";
import {
  captureProfileDefaults,
  DEFAULT_CAPTURE_OPTIONS,
  inferCaptureProfile,
  normalizeCaptureBudgets,
  policyEpochFromOptions,
} from "../shared/types.js";
import type {
  BodySkipReason,
  CoverageMetric,
  CoverageReport,
  CoverageState,
  CoverageStateCounts,
  CoverageStateSummary,
  NetworkEntry,
  SessionData,
} from "../shared/types.js";
import { getExtensionVersion } from "../shared/extension-version.js";
import { buildCapabilityMatrix } from "../capture/capabilities.js";

export const COVERAGE_REPORT_SCHEMA_VERSION = 4 as const;

const COVERAGE_STATES: CoverageState[] = [
  "observed",
  "excluded",
  "redacted",
  "truncated",
  "unavailable",
  "dropped",
];

function emptyStates(): CoverageStateCounts {
  return Object.fromEntries(COVERAGE_STATES.map((state) => [state, 0])) as CoverageStateCounts;
}

function stateCounts(observed: number, dropped = 0, excluded = 0): CoverageStateCounts {
  const counts = emptyStates();
  counts.observed = observed;
  counts.dropped = dropped;
  counts.excluded = excluded;
  return counts;
}

function bodyState(entry: NetworkEntry, direction: "request" | "response", captureBodies: boolean): CoverageState {
  const state = direction === "request" ? entry.requestBodyState : entry.responseBodyState;
  if (state) return state;
  const body = direction === "request" ? entry.requestBody : entry.responseBody;
  const truncated = direction === "request" ? entry.requestBodyTruncated : entry.responseBodyTruncated;
  if (body == null) return captureBodies ? "unavailable" : "excluded";
  if (truncated) return "truncated";
  if (body.includes(REDACTED)) return "redacted";
  return "observed";
}

function bodyStates(entries: NetworkEntry[], direction: "request" | "response", captureBodies: boolean): CoverageStateCounts {
  const counts = emptyStates();
  for (const entry of entries) counts[bodyState(entry, direction, captureBodies)] += 1;
  return counts;
}

function summarizeStates(data: SessionData, captureBodies: boolean): CoverageStateSummary {
  const health = data.session?.health;
  const truncation = health?.truncation;
  return {
    network: stateCounts(
      data.network.length,
      truncation?.network ?? 0,
      health?.filteredNetworkRequests ?? 0,
    ),
    navigation: stateCounts(data.navigation.length, truncation?.navigation ?? 0),
    console: stateCounts(data.console.length, truncation?.console ?? 0),
    markers: stateCounts(data.markers?.length ?? 0, truncation?.markers ?? 0),
    bodies: {
      request: bodyStates(data.network, "request", captureBodies),
      response: bodyStates(data.network, "response", captureBodies),
    },
  };
}

function bodySkipReasons(network: NetworkEntry[]): Partial<Record<BodySkipReason, number>> {
  const reasons: Partial<Record<BodySkipReason, number>> = {};
  for (const entry of network) {
    for (const reason of [entry.requestBodySkipReason, entry.responseBodySkipReason]) {
      if (reason) reasons[reason] = (reasons[reason] ?? 0) + 1;
    }
  }
  return reasons;
}

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
  const options = {
    ...DEFAULT_CAPTURE_OPTIONS,
    ...data.session?.options,
    ...profileOptions,
    profile,
    captureBodies: hasExplicitProfile
      ? profileOptions.captureBodies
      : data.session?.options?.captureBodies ?? profileOptions.captureBodies,
    captureConsole: hasExplicitProfile
      ? profileOptions.captureConsole
      : data.session?.options?.captureConsole ?? profileOptions.captureConsole,
    budgets: normalizeCaptureBudgets(data.session?.options?.budgets),
  };
  const epochs = data.session?.policyEpochs?.length
    ? data.session.policyEpochs
    : [policyEpochFromOptions(options, `legacy-${data.session?.id ?? "none"}`, data.session?.startedAt ?? generatedAt, data.session?.stoppedAt)];
  const states = summarizeStates(data, options.captureBodies);
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
      (health?.persistenceErrors.length ?? 0) > 0 ||
      (health?.fairBudgetEvictions ?? 0) > 0,
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
      capabilities: data.session?.capabilities ?? buildCapabilityMatrix(),
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
      budgets: options.budgets,
      epochs,
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
    states,
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
      fairBudgetEvictions: health?.fairBudgetEvictions ?? 0,
      bodySkipReasons: bodySkipReasons(network),
      partial,
      gapReasons,
    },
  };
}
