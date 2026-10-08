export type CaptureProfile = "metadata" | "network-console" | "safe-bodies";

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
}

export const DEFAULT_CAPTURE_OPTIONS: CaptureOptions = {
  profile: "network-console",
  captureBodies: false,
  captureConsole: true,
  redactionEnabled: true,
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
}

export interface StorageTruncation {
  network: number;
  navigation: number;
  console: number;
  /** Added in export schema v3; optional for legacy session metadata. */
  markers?: number;
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

export interface CaptureSession {
  id: string;
  active: boolean;
  consentedAt: number | null;
  startedAt: number;
  stoppedAt?: number;
  tabId: number;
  tabUrl?: string;
  /** Extension build active when the session was created. */
  extensionVersion?: string;
  options: CaptureOptions;
  health: SessionHealth;
  tabClosedDuringCapture?: boolean;
  paused?: boolean;
  pauseIntervals?: PauseInterval[];
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
}

export interface ArtifactManifestEntry {
  path: string;
  kind: "report" | "har" | "json" | "other";
  optional: boolean;
  enabled: boolean;
  schemaVersion?: number;
  bytes?: number;
}

export interface CoverageMetric {
  present: number;
  total: number;
  percent: number;
}

/** Machine-readable provenance and completeness summary for an export. */
export interface CoverageReport {
  schemaVersion: 3;
  generatedAt: number;
  source: {
    sessionId?: string;
    extensionVersion?: string;
    tabUrl?: string;
    startedAt?: number;
    stoppedAt?: number;
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
  };
  totals: {
    network: number;
    navigation: number;
    console: number;
    markers: number;
    requestBodies: number;
    responseBodies: number;
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
  quality: {
    networkTruncated: number;
    navigationTruncated: number;
    consoleTruncated: number;
    bodiesTruncated: number;
    bodiesSkippedSessionCap: number;
    healthGaps: number;
    persistenceErrors: number;
    markersTruncated: number;
    filteredNetworkRequests: number;
    partial: boolean;
    gapReasons: string[];
  };
}

export interface PrivacyReceipt {
  schemaVersion: 1;
  redactionEnabled: boolean;
  redactionRuleSetVersion: string;
  audit: RedactionAudit;
  captureBodies: boolean;
  captureConsole: boolean;
  scope: "active-tab";
  localOnly: true;
  remoteUpload: false;
}

export interface RedactionAudit {
  schemaVersion: 1;
  redactedValues: number;
  redactedRecords: number;
}

export interface ExportManifest {
  /** Export contract version. */
  schemaVersion: 3;
  format: "browser-listener";
  /** Extension version at export time. */
  version: string;
  extensionVersion: string;
  sessionId: string;
  exportedAt: number;
  privacy: PrivacyReceipt;
  options: CaptureOptions;
  files: ArtifactManifestEntry[];
  coverage: CoverageReport;
  health: SessionHealth;
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

export interface SessionData {
  session: CaptureSession | null;
  network: NetworkEntry[];
  navigation: NavigationEntry[];
  console: ConsoleEntry[];
  /** Optional for legacy persisted sessions; normalized reads always provide an array. */
  markers?: MarkerEntry[];
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
