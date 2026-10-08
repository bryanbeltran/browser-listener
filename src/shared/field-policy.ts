import { normalizeCaptureFields, policyEpochFromOptions } from "./types.js";
import type {
  BrowserContextSnapshot,
  CaptureFieldPolicy,
  CaptureSession,
  ConsoleEntry,
  MarkerEntry,
  NavigationEntry,
  NetworkEntry,
  PerformanceSignal,
  ScreenshotEvidence,
  SessionData,
} from "./types.js";

/** Stable placeholder used when a user excludes a required string field. */
export const EXCLUDED_FIELD = "[EXCLUDED]";

export function policyForSession(
  session: CaptureSession | null | undefined,
  policyEpochId?: string,
) {
  const epoch = policyEpochId && session?.policyEpochs?.find((candidate) => candidate.id === policyEpochId);
  if (epoch) return epoch;
  if (!session) return undefined;
  return session.policyEpochs?.at(-1) ?? policyEpochFromOptions(session.options, `current-${session.id}`, session.startedAt);
}

export function fieldsForSession(
  session: CaptureSession | null | undefined,
  policyEpochId?: string,
): CaptureFieldPolicy {
  return normalizeCaptureFields(policyForSession(session, policyEpochId)?.fields ?? session?.options?.fields);
}

function without<T extends object, K extends keyof T>(value: T, ...keys: K[]): Omit<T, K> {
  const copy = { ...value } as T & Partial<Record<K, unknown>>;
  for (const key of keys) delete copy[key];
  return copy as Omit<T, K>;
}

function sanitizeInitiator(
  value: NetworkEntry["initiator"],
  fields: CaptureFieldPolicy,
): NetworkEntry["initiator"] {
  if (!value || fields.urls) return value;
  return without(value, "url");
}

export function sanitizeNetworkEntry(entry: NetworkEntry, fields: CaptureFieldPolicy): NetworkEntry {
  let safe: NetworkEntry = { ...entry };
  if (!fields.urls) {
    safe = {
      ...without(safe, "documentUrl"),
      url: EXCLUDED_FIELD,
      initiator: sanitizeInitiator(safe.initiator, fields),
    };
  }
  if (!fields.headers) safe = without(safe, "requestHeaders", "responseHeaders");
  if (!fields.requestBodies) {
    safe = {
      ...without(safe, "requestBody", "requestBodySize", "requestBodyTruncated", "requestBodyEncoding"),
      requestBodyState: "excluded",
      requestBodySkipReason: "field-disabled",
    };
  }
  if (!fields.responseBodies) {
    safe = {
      ...without(safe, "responseBody", "responseBodySize", "responseBodyTruncated", "responseBodyEncoding"),
      responseBodyState: "excluded",
      responseBodySkipReason: "field-disabled",
    };
  }
  return safe;
}

export function sanitizeNavigationEntry(entry: NavigationEntry, fields: CaptureFieldPolicy): NavigationEntry {
  const safe = fields.navigationTitles ? entry : without(entry, "title");
  return fields.urls ? safe : { ...safe, url: EXCLUDED_FIELD };
}

export function sanitizeConsoleEntry(entry: ConsoleEntry, fields: CaptureFieldPolicy): ConsoleEntry {
  const safe = fields.consoleArguments ? entry : without(entry, "args");
  return fields.urls ? safe : without(safe, "url");
}

export function sanitizeMarkerEntry(entry: MarkerEntry, fields: CaptureFieldPolicy): MarkerEntry {
  return fields.urls ? entry : without(entry, "url");
}

function sanitizeFrameTree(snapshot: BrowserContextSnapshot["frameTree"], fields: CaptureFieldPolicy) {
  if (!snapshot || fields.urls) return snapshot;
  return {
    ...snapshot,
    frames: snapshot.frames.map(({ url: _url, ...frame }) => frame),
  };
}

export function sanitizeContextSnapshot(entry: BrowserContextSnapshot, fields: CaptureFieldPolicy): BrowserContextSnapshot {
  const safe = fields.navigationTitles ? entry : without(entry, "title");
  const withFrameTree = { ...safe, frameTree: sanitizeFrameTree(safe.frameTree, fields) };
  return fields.urls ? withFrameTree : without(withFrameTree, "url");
}

export function sanitizePerformanceSignal(entry: PerformanceSignal): PerformanceSignal {
  return entry;
}

export function sanitizeScreenshotEntry(entry: ScreenshotEvidence, fields: CaptureFieldPolicy): ScreenshotEvidence {
  if (fields.visualEvidence) return entry;
  return {
    ...without(entry, "data", "byteLength"),
    state: "excluded",
    reason: "field-disabled",
  };
}

export function sanitizeSessionDataForFields(data: SessionData): SessionData {
  const session = data.session;
  const sessionFields = normalizeCaptureFields(session?.options?.fields);
  return {
    ...data,
    session: session
      ? {
          ...session,
          ...(sessionFields.urls ? {} : { tabUrl: undefined }),
          targets: session.targets?.map((target) => ({
            ...target,
            ...(sessionFields.urls ? {} : { url: undefined }),
            ...(sessionFields.navigationTitles ? {} : { title: undefined }),
          })),
        }
      : null,
    network: data.network.map((entry) => sanitizeNetworkEntry(entry, fieldsForSession(session, entry.policyEpochId))),
    navigation: data.navigation.map((entry) => sanitizeNavigationEntry(entry, fieldsForSession(session, entry.policyEpochId))),
    console: data.console.map((entry) => sanitizeConsoleEntry(entry, fieldsForSession(session, entry.policyEpochId))),
    markers: (data.markers ?? []).map((entry) => sanitizeMarkerEntry(entry, fieldsForSession(session, entry.policyEpochId))),
    contextSnapshots: (data.contextSnapshots ?? []).map((entry) => sanitizeContextSnapshot(entry, fieldsForSession(session, entry.policyEpochId))),
    performanceSignals: (data.performanceSignals ?? []).map((entry) => sanitizePerformanceSignal(entry)),
    screenshots: (data.screenshots ?? []).map((entry) => sanitizeScreenshotEntry(entry, fieldsForSession(session, entry.policyEpochId))),
  };
}
