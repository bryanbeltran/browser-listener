export type CaptureProfile = "metadata" | "network-console" | "safe-bodies";

export interface CaptureBudgets {
  /** Maximum estimated stored bytes for one URL origin within a session. */
  perOriginBytes: number;
  /** Maximum estimated stored bytes for one CDP resource category within a session. */
  perCategoryBytes: number;
}

export interface CaptureFilters {
  /** Case-insensitive URL substrings or glob patterns to include. Empty means all. */
  urlIncludes: string[];
  /** Case-insensitive URL substrings or glob patterns to exclude. */
  urlExcludes: string[];
  /** MIME types or type globs (for example application/json or image/*). */
  mimeTypes: string[];
}

export const DEFAULT_CAPTURE_FILTERS: CaptureFilters = {
  urlIncludes: [],
  urlExcludes: [],
  mimeTypes: [],
};

export function normalizeCaptureFilters(value: unknown): CaptureFilters {
  const candidate = value && typeof value === "object" ? value as Partial<CaptureFilters> : {};
  const list = (items: unknown, lower = false): string[] =>
    Array.isArray(items)
      ? [...new Set(items
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean)
          .map((item) => lower ? item.toLowerCase() : item))]
      : [];
  return {
    urlIncludes: list(candidate.urlIncludes),
    urlExcludes: list(candidate.urlExcludes),
    mimeTypes: list(candidate.mimeTypes, true),
  };
}

export const DEFAULT_CAPTURE_BUDGETS: CaptureBudgets = {
  perOriginBytes: 32 * 1024 * 1024,
  perCategoryBytes: 64 * 1024 * 1024,
};

export function normalizeCaptureBudgets(value: unknown): CaptureBudgets {
  const candidate = value && typeof value === "object" ? value as Partial<CaptureBudgets> : {};
  const positive = (candidateValue: unknown, fallback: number): number => {
    if (typeof candidateValue !== "number" || !Number.isFinite(candidateValue) || candidateValue <= 0) {
      return fallback;
    }
    return Math.floor(candidateValue);
  };
  return {
    perOriginBytes: positive(candidate.perOriginBytes, DEFAULT_CAPTURE_BUDGETS.perOriginBytes),
    perCategoryBytes: positive(candidate.perCategoryBytes, DEFAULT_CAPTURE_BUDGETS.perCategoryBytes),
  };
}

export interface CaptureOptions {
  /** Named, immutable capture policy selected before a session starts. */
  profile: CaptureProfile;
  /** Capture response/request bodies when their MIME type is safe and the user opts in. */
  captureBodies: boolean;
  /** Capture browser console, runtime exception, and log events. */
  captureConsole: boolean;
  /** Redact sensitive values before persistence and export. */
  redactionEnabled: boolean;
  /** Optional exact HTTP(S) origin allowlist; omitted means page plus dependencies. */
  allowedOrigins?: string[];
  /** Explicitly selected tab IDs; omitted means the primary tab only. */
  targetTabIds?: number[];
  /** Fairness budgets applied in addition to the global storage limits. */
  budgets?: CaptureBudgets;
  /** Optional local label; it never changes event identity or capture scope. */
  sessionName?: string;
  filters?: CaptureFilters;
}

export const DEFAULT_CAPTURE_OPTIONS: CaptureOptions = {
  profile: "network-console",
  captureBodies: false,
  captureConsole: true,
  redactionEnabled: true,
  budgets: DEFAULT_CAPTURE_BUDGETS,
  filters: DEFAULT_CAPTURE_FILTERS,
};

export function normalizeCaptureProfile(value: unknown): CaptureProfile {
  return value === "metadata" || value === "network-console" || value === "safe-bodies"
    ? value
    : DEFAULT_CAPTURE_OPTIONS.profile;
}

export function inferCaptureProfile(options: Partial<CaptureOptions> | undefined): CaptureProfile {
  if (options?.profile) return normalizeCaptureProfile(options.profile);
  if (options?.captureBodies) return "safe-bodies";
  if (options?.captureConsole === false) return "metadata";
  return DEFAULT_CAPTURE_OPTIONS.profile;
}

export function captureProfileDefaults(profile: CaptureProfile): Pick<CaptureOptions, "captureBodies" | "captureConsole"> {
  return profile === "metadata"
    ? { captureBodies: false, captureConsole: false }
    : profile === "safe-bodies"
      ? { captureBodies: true, captureConsole: true }
      : { captureBodies: false, captureConsole: true };
}

export interface CapturePolicyEpoch {
  id: string;
  startedAt: number;
  endedAt?: number;
  profile: CaptureProfile;
  redactionEnabled: boolean;
  captureBodies: boolean;
  captureConsole: boolean;
  allowedOrigins: string[];
  budgets: CaptureBudgets;
  filters: CaptureFilters;
}

export interface CapabilityStatus {
  supported: boolean;
  reason?: string;
}

/** Adapter-owned browser capability declaration; unsupported features remain visible in exports. */
export interface CapabilityMatrix {
  schemaVersion: 1;
  adapter: "chromium-mv3";
  browserFamily: "chromium";
  versions: {
    extension: string;
    manifest: number;
    userAgent?: string;
  };
  debuggerDomains: Record<string, CapabilityStatus>;
  bodyRetrieval: CapabilityStatus;
  workerTargets: CapabilityStatus;
  screenshots: CapabilityStatus;
  downloads: CapabilityStatus;
  storage: CapabilityStatus;
  lifecycleRecovery: CapabilityStatus;
}

export function policyEpochFromOptions(
  options: CaptureOptions,
  id: string,
  startedAt: number,
  endedAt?: number,
): CapturePolicyEpoch {
  return {
    id,
    startedAt,
    ...(endedAt == null ? {} : { endedAt }),
    profile: normalizeCaptureProfile(options.profile),
    redactionEnabled: options.redactionEnabled !== false,
    captureBodies: options.captureBodies === true,
    captureConsole: options.captureConsole !== false,
    allowedOrigins: [...(options.allowedOrigins ?? [])],
    budgets: normalizeCaptureBudgets(options.budgets),
    filters: normalizeCaptureFilters(options.filters),
  };
}

export interface NavigationEntry {
  id: string;
  sessionId: string;
  timestamp: number;
  url: string;
  title?: string;
  tabId?: number;
  frameId?: number;
}

export type ConsoleLevel = "verbose" | "debug" | "info" | "log" | "warning" | "error";

export interface ConsoleEntry {
  id: string;
  sessionId: string;
  timestamp: number;
  /** CDP event that produced this record. */
  method?: string;
  level: ConsoleLevel | string;
  text: string;
  tabId?: number;
  source?: string;
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
  stackTrace?: string;
  args?: string[];
}

/** A user-authored point-in-time annotation that anchors human reproduction steps. */
export interface MarkerEntry {
  id: string;
  sessionId: string;
  timestamp: number;
  label: string;
  note?: string;
  url?: string;
  tabId?: number;
  frameId?: number;
  /** Nearest evidence chosen at marker creation; IDs only, never copied values. */
  nearestNetworkId?: string;
  nearestConsoleId?: string;
}

export interface StorageTruncation {
  network: number;
  navigation: number;
  console: number;
  /** Added in export schema v3; optional for legacy session metadata. */
  markers?: number;
  contextSnapshots?: number;
  performanceSignals?: number;
  screenshots?: number;
}

export interface SessionHealth {
  debuggerAttached: boolean;
  /** True if CDP attach completed successfully at any point this session (export snapshot). */
  debuggerEverAttached?: boolean;
  debuggerDetachCount: number;
  lastDetachAt?: number;
  lastRecoverAt?: number;
  serviceWorkerRestarts: number;
  partialGaps: HealthGap[];
  persistenceErrors: string[];
  /** Last chrome.debugger.attach / CDP domain enable failure, if any. */
  lastAttachError?: string;
  truncation: StorageTruncation;
  bodyBytesStored?: number;
  bodiesSkippedSessionCap?: number;
  bodiesPerResponseTruncated?: number;
  filteredNetworkRequests?: number;
  fairBudgetEvictions?: number;
}

export interface HealthGap {
  at: number;
  reason: string;
  durationMs?: number;
}

export interface PauseInterval {
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
}

/** Explicitly consented capture target; optional for legacy single-tab sessions. */
export interface CaptureTarget {
  tabId: number;
  url?: string;
  title?: string;
  openerTabId?: number;
  frameIds?: number[];
  debuggerAttached?: boolean;
  debuggerEverAttached?: boolean;
  tabClosed?: boolean;
  partialGaps?: HealthGap[];
}

export interface CaptureSession {
  id: string;
  active: boolean;
  consentedAt: number | null;
  startedAt: number;
  stoppedAt?: number;
  tabId: number;
  tabUrl?: string;
  name?: string;
  /** Extension build active when the session was created. */
  extensionVersion?: string;
  options: CaptureOptions;
  health: SessionHealth;
  tabClosedDuringCapture?: boolean;
  paused?: boolean;
  pauseIntervals?: PauseInterval[];
  targets?: CaptureTarget[];
  /** Immutable policy snapshots; legacy sessions are normalized to one epoch on read. */
  policyEpochs?: CapturePolicyEpoch[];
  capabilities?: CapabilityMatrix;
  oneRequestCapture?: {
    armedAt: number;
    urlIncludes?: string;
  };
}

/** Slim session fields for popup UI. */
export interface PopupSessionView {
  id: string;
  active: boolean;
  startedAt: number;
  stoppedAt?: number;
  tabClosedDuringCapture?: boolean;
  paused?: boolean;
  allowedOrigins?: string[];
  health: Pick<
    SessionHealth,
    "debuggerAttached" | "debuggerEverAttached" | "partialGaps" | "truncation" | "lastAttachError"
  >;
}

export interface PopupCounts {
  network: number;
  navigation: number;
  console: number;
  markers?: number;
}

export interface PopupStateSnapshot {
  session: PopupSessionView | null;
  counts: PopupCounts;
  canExport: boolean;
}

export interface NetworkEntry {
  id: string;
  sessionId: string;
  requestId: string;
  timestamp: number;
  url: string;
  method: string;
  type: string;
  tabId?: number;
  frameId?: string;
  documentUrl?: string;
  redirectFromId?: string;
  initiator?: {
    type?: string;
    url?: string;
    requestId?: string;
    lineNumber?: number;
    columnNumber?: number;
  };
  isPreflight?: boolean;
  statusCode?: number;
  statusLine?: string;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  ip?: string;
  fromCache?: boolean;
  fromServiceWorker?: boolean;
  connectionReused?: boolean;
  error?: string;
  timing?: { start: number; end?: number; durationMs?: number };
  requestBody?: string;
  responseBody?: string;
  requestBodyTruncated?: boolean;
  responseBodyTruncated?: boolean;
  contentType?: string;
  requestBodySize?: number;
  responseBodySize?: number;
  bodyCaptured?: boolean;
  requestBodyState?: CoverageState;
  responseBodyState?: CoverageState;
  requestBodySkipReason?: BodySkipReason;
  responseBodySkipReason?: BodySkipReason;
  requestBodyEncoding?: BodyEncoding;
  responseBodyEncoding?: BodyEncoding;
  requestTransferSize?: number;
  responseTransferSize?: number;
  /** True when this entry consumed an explicit one-request body-capture arm. */
  oneRequestCapture?: boolean;
}

export type CoverageState =
  | "observed"
  | "excluded"
  | "redacted"
  | "truncated"
  | "unavailable"
  | "dropped";

export type BodySkipReason =
  | "capture-disabled"
  | "missing-mime-type"
  | "unsafe-mime-type"
  | "no-body"
  | "body-unavailable"
  | "capture-error"
  | "per-response-cap"
  | "session-budget";

export type BodyEncoding = "utf-8" | "base64" | "unknown";

export type CoverageStateCounts = Record<CoverageState, number>;

export interface FrameTreeNode {
  id: string;
  parentId?: string;
  url?: string;
  securityOrigin?: string;
  name?: string;
  childCount: number;
}

export interface FrameTreeSnapshot {
  browserSupport: "cdp-page-v1" | "unsupported";
  rootId?: string;
  frames: FrameTreeNode[];
  truncated?: boolean;
}

export interface NavigationTimingSummary {
  durationMs?: number;
  responseStartMs?: number;
  domContentLoadedMs?: number;
  loadEventMs?: number;
  transferSize?: number;
}

export interface ResourceTimingSummary {
  count: number;
  totalDurationMs: number;
  slowestDurationMs?: number;
  totalTransferSize?: number;
}

export interface LongTaskSummary {
  count: number;
  totalDurationMs: number;
  longestDurationMs?: number;
}

export interface CoverageStateSummary {
  network: CoverageStateCounts;
  navigation: CoverageStateCounts;
  console: CoverageStateCounts;
  markers: CoverageStateCounts;
  bodies: {
    request: CoverageStateCounts;
    response: CoverageStateCounts;
  };
}

/** Low-volume page metadata snapshot; page content and DOM are intentionally excluded. */
export interface BrowserContextSnapshot {
  id: string;
  sessionId: string;
  timestamp: number;
  tabId: number;
  frameId?: number;
  url?: string;
  title?: string;
  visibilityState?: "visible" | "hidden" | "prerender" | string;
  focused?: boolean;
  online?: boolean;
  viewport?: { width: number; height: number };
  deviceScaleFactor?: number;
  frameTree?: FrameTreeSnapshot;
  navigationTiming?: NavigationTimingSummary;
  resourceTiming?: ResourceTimingSummary;
  longTaskSummary?: LongTaskSummary;
  capabilities?: CapabilityMatrix;
  source: "Runtime.evaluate" | "tabs.get";
}

/** Selected CDP performance aggregates, never a DOM or page snapshot. */
export interface PerformanceSignal {
  id: string;
  sessionId: string;
  timestamp: number;
  tabId: number;
  samplingIntervalMs?: number;
  browserSupport: "cdp-performance-v1" | "unsupported";
  metrics: Record<string, number>;
}

/** Explicitly requested visual evidence; image bytes are never text-redacted. */
export interface ScreenshotEvidence {
  id: string;
  sessionId: string;
  timestamp: number;
  tabId: number;
  format: "png";
  state: "observed" | "unavailable" | "dropped";
  data?: string;
  byteLength?: number;
  reason?: string;
}

export interface ArtifactManifestEntry {
  path: string;
  kind: "report" | "har" | "json" | "other";
  optional: boolean;
  enabled: boolean;
  schemaVersion?: number;
  bytes?: number;
  /** SHA-256 of the materialized artifact; omitted for the self-referential manifest. */
  sha256?: string;
}

export interface CoverageMetric {
  present: number;
  total: number;
  percent: number;
}

/** Machine-readable provenance and completeness summary for an export. */
export interface CoverageReport {
  schemaVersion: 4;
  generatedAt: number;
  source: {
    sessionId?: string;
    extensionVersion?: string;
    tabUrl?: string;
    startedAt?: number;
    stoppedAt?: number;
    capabilities?: CapabilityMatrix;
    targets?: Array<{
      tabId: number;
      url?: string;
      closed?: boolean;
      debuggerEverAttached?: boolean;
      gapCount: number;
    }>;
  };
  capture: {
    paused: boolean;
    pauseIntervals: PauseInterval[];
  };
  policy: {
    profile: CaptureProfile;
    redactionEnabled: boolean;
    captureBodies: boolean;
    captureConsole: boolean;
    allowedOrigins: string[];
    budgets: CaptureBudgets;
    epochs: CapturePolicyEpoch[];
  };
  totals: {
    network: number;
    navigation: number;
    console: number;
    markers: number;
    requestBodies: number;
    responseBodies: number;
    contextSnapshots: number;
    performanceSignals: number;
  };
  fields: {
    network: {
      statusCode: CoverageMetric;
      responseHeaders: CoverageMetric;
      responseBody: CoverageMetric;
    };
    navigation: {
      title: CoverageMetric;
      url: CoverageMetric;
    };
    console: {
      text: CoverageMetric;
      source: CoverageMetric;
    };
    markers: {
      label: CoverageMetric;
      note: CoverageMetric;
    };
  };
  states: CoverageStateSummary;
  quality: {
    networkTruncated: number;
    navigationTruncated: number;
    consoleTruncated: number;
    bodiesTruncated: number;
    bodiesSkippedSessionCap: number;
    healthGaps: number;
    persistenceErrors: number;
    markersTruncated: number;
    contextSnapshotsTruncated: number;
    performanceSignalsTruncated: number;
    filteredNetworkRequests: number;
    fairBudgetEvictions: number;
    bodySkipReasons: Partial<Record<BodySkipReason, number>>;
    partial: boolean;
    gapReasons: string[];
  };
}

export interface PrivacyReceipt {
  schemaVersion: 2;
  redactionEnabled: boolean;
  redactionRuleSetVersion: string;
  audit: RedactionAudit;
  captureBodies: boolean;
  captureConsole: boolean;
  scope: "active-tab" | "selected-tabs";
  localOnly: true;
  remoteUpload: false;
  policyEpochs: CapturePolicyEpoch[];
  states: CoverageStateSummary;
  warnings: string[];
}

export interface RedactionAudit {
  schemaVersion: 1;
  redactedValues: number;
  redactedRecords: number;
}

export interface ExportManifest {
  /** Export contract version. */
  schemaVersion: 4;
  format: "browser-listener";
  /** Extension version at export time. */
  version: string;
  extensionVersion: string;
  sessionId: string;
  exportedAt: number;
  privacy: PrivacyReceipt;
  options: CaptureOptions;
  files: ArtifactManifestEntry[];
  provenance?: ExportProvenance;
  coverage: CoverageReport;
  health: SessionHealth;
}

export interface ExportProvenance {
  schemaVersion: 1;
  deterministic: true;
  checksumAlgorithm: "sha256";
  sourceSessionId: string;
  exportedAt: number;
  redactionRuleSetVersion: string;
  manifestChecksumExcluded: true;
}

export interface SessionSummary {
  sessionId: string;
  extensionVersion?: string;
  startedAt: number;
  stoppedAt?: number;
  durationMs: number;
  counts: {
    network: number;
    navigation: number;
    console: number;
    markers?: number;
    requestBodies: number;
    responseBodies: number;
  };
  health: SessionHealth;
}

export interface RetentionPolicy {
  schemaVersion: 1;
  /** Completed local sessions older than this are eligible for deletion. */
  maxAgeMs: number;
  /** Maximum number of completed session records retained locally. */
  maxSessions: number;
  /** Maximum estimated bytes across retained completed sessions. */
  maxBytes: number;
}

export interface SessionHistoryEntry {
  schemaVersion: 1;
  id: string;
  name?: string;
  startedAt: number;
  stoppedAt?: number;
  archivedAt: number;
  bytes: number;
  counts: SessionSummary["counts"];
  partial: boolean;
  redactionEnabled: boolean;
  policyEpochCount: number;
}

export type DeletionPhase = "network" | "evidence" | "metadata" | "history" | "receipt";

export interface DeletionReceipt {
  schemaVersion: 1;
  id: string;
  sessionId: string;
  requestedAt: number;
  completedAt?: number;
  state: "complete" | "partial";
  completedPhases: DeletionPhase[];
  remainingPhases: DeletionPhase[];
  errors: string[];
}

export interface SessionData {
  session: CaptureSession | null;
  network: NetworkEntry[];
  navigation: NavigationEntry[];
  console: ConsoleEntry[];
  /** Optional for legacy persisted sessions; normalized reads always provide an array. */
  markers?: MarkerEntry[];
  contextSnapshots?: BrowserContextSnapshot[];
  performanceSignals?: PerformanceSignal[];
  screenshots?: ScreenshotEvidence[];
}

export type CorrelationNodeType = "network" | "console" | "navigation" | "marker";
export type CorrelationEdgeType =
  | "redirect"
  | "initiator"
  | "preflight"
  | "document"
  | "frame"
  | "retry"
  | "cache"
  | "console-error"
  | "marker-context";
export type CorrelationConfidence = "direct" | "supported" | "heuristic";

/** A redaction-safe graph node. It contains identifiers and metadata, never URLs or bodies. */
export interface CorrelationNode {
  id: string;
  eventId: string;
  type: CorrelationNodeType;
  timestamp: number;
  tabId?: number;
  frameId?: number | string;
  statusCode?: number;
  level?: string;
}

export interface CorrelationEdge {
  id: string;
  from: string;
  to: string;
  type: CorrelationEdgeType;
  confidence: CorrelationConfidence;
  ambiguous: boolean;
  provenance: {
    source: string;
    rule: string;
  };
}

/** Deterministic, derived context for explaining relationships between evidence records. */
export interface CorrelationGraph {
  schemaVersion: 1;
  nodes: CorrelationNode[];
  edges: CorrelationEdge[];
}

export interface RedactionRule {
  pattern: string;
  flags?: string;
  replacement?: string;
}

export interface RedactionConfig {
  sensitiveKeys: string[];
  urlParamKeys: string[];
  objectSensitiveKeys?: string[];
  customRules: RedactionRule[];
}

export type CitationArtifact = "report.html" | "raw.har" | "raw-console.json";

/** Stable, secret-free address for one exported evidence record. */
export interface EvidenceCitation {
  schemaVersion: 1;
  bundleId: string;
  artifact: CitationArtifact;
  eventId: string;
  address: string;
}

export interface ReproductionContext {
  method: string;
  url: string;
  statusCode?: number;
  startedAt: number;
  durationMs?: number;
  bodyIncluded: boolean;
  omitted: string[];
}

/** Derived, reviewable request snippets; never a replay instruction. */
export interface ReproductionSnippets {
  citation: EvidenceCitation;
  curl: string;
  fetch: string;
  httpie: string;
  context: ReproductionContext;
}
