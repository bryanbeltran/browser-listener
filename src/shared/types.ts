export interface CaptureOptions {
  /** Capture response/request bodies when their MIME type is safe and the user opts in. */
  captureBodies: boolean;
  /** Capture browser console, runtime exception, and log events. */
  captureConsole: boolean;
}

export const DEFAULT_CAPTURE_OPTIONS: CaptureOptions = {
  captureBodies: false,
  captureConsole: true,
};

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

export interface StorageTruncation {
  network: number;
  navigation: number;
  console: number;
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
}

export interface HealthGap {
  at: number;
  reason: string;
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
}

/** Slim session fields for popup UI. */
export interface PopupSessionView {
  id: string;
  active: boolean;
  startedAt: number;
  stoppedAt?: number;
  tabClosedDuringCapture?: boolean;
  health: Pick<
    SessionHealth,
    "debuggerAttached" | "debuggerEverAttached" | "partialGaps" | "truncation" | "lastAttachError"
  >;
}

export interface PopupCounts {
  network: number;
  navigation: number;
  console: number;
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
  statusCode?: number;
  statusLine?: string;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  ip?: string;
  fromCache?: boolean;
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
  bytes?: number;
}

export interface CoverageMetric {
  present: number;
  total: number;
  percent: number;
}

/** Machine-readable provenance and completeness summary for an export. */
export interface CoverageReport {
  schemaVersion: 1;
  generatedAt: number;
  source: {
    tabUrl?: string;
    startedAt?: number;
    stoppedAt?: number;
  };
  totals: {
    network: number;
    navigation: number;
    console: number;
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
  };
  quality: {
    networkTruncated: number;
    navigationTruncated: number;
    consoleTruncated: number;
    bodiesTruncated: number;
    bodiesSkippedSessionCap: number;
    healthGaps: number;
    persistenceErrors: number;
  };
}

export interface ExportManifest {
  /** Export contract version. */
  schemaVersion: 2;
  format: "browser-listener";
  /** Extension version at export time. */
  version: string;
  extensionVersion: string;
  sessionId: string;
  exportedAt: number;
  privacy: { localOnly: true; remoteUpload: false };
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
}

export interface RedactionRule {
  pattern: string;
  flags?: string;
  replacement?: string;
}

export interface RedactionConfig {
  sensitiveKeys: string[];
  urlParamKeys: string[];
  customRules: RedactionRule[];
}
