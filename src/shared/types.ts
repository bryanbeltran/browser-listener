export type ConsoleLevel = "log" | "info" | "warn" | "error" | "debug";

export interface CaptureOptions {
  screenRecording: boolean;
  tabAudio: boolean;
  staticAssetBodies: boolean;
  enricherIds: string[];
}

export const DEFAULT_CAPTURE_OPTIONS: CaptureOptions = {
  screenRecording: false,
  tabAudio: false,
  staticAssetBodies: false,
  enricherIds: [],
};

export interface SessionHealth {
  debuggerAttached: boolean;
  debuggerDetachCount: number;
  lastDetachAt?: number;
  lastRecoverAt?: number;
  serviceWorkerRestarts: number;
  partialGaps: HealthGap[];
  persistenceErrors: string[];
  eventCounts: Record<string, number>;
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
  options: CaptureOptions;
  health: SessionHealth;
}

export interface TimelineEvent {
  id: string;
  sessionId: string;
  timestamp: number;
  category: "console" | "network" | "user" | "navigation" | "diagnostic" | "system";
  type: string;
  summary: string;
  frameId?: string;
  tabId?: number;
  payloadRef?: string;
}

export interface ConsoleEntry {
  id: string;
  sessionId: string;
  timestamp: number;
  level: ConsoleLevel;
  args: string[];
  url: string;
  frameUrl?: string;
  frameId?: string;
  tabId?: number;
  stack?: string;
  source?: "content" | "debugger";
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
  /** Only when staticAssetBodies opt-in and CDP body captured */
  requestBodySize?: number;
  responseBodySize?: number;
  bodyCaptured?: boolean;
}

export interface UserAction {
  id: string;
  sessionId: string;
  timestamp: number;
  type: "click" | "submit" | "input" | "change" | "route" | "visibility";
  target?: string;
  valueSummary?: string;
  url: string;
  frameUrl?: string;
}

export interface FrameInfo {
  frameId: string;
  parentId?: string;
  url: string;
  name?: string;
  crossOrigin: boolean;
  timestamp: number;
}

export interface RouteState {
  href: string;
  pathname: string;
  search: string;
  hash: string;
  title: string;
}

export interface DomSnapshot {
  id: string;
  sessionId: string;
  timestamp: number;
  url: string;
  frameUrl?: string;
  htmlSummary: string;
  nodeCount: number;
}

export interface PerformanceSignals {
  timestamp: number;
  navigation?: PerformanceNavigationTiming;
  paint?: { fp?: number; fcp?: number };
  resourceCount?: number;
}

export interface DiagnosticsBundle {
  frames: FrameInfo[];
  route: RouteState;
  performance?: PerformanceSignals;
  visibility: DocumentVisibilityState;
  capturedAt: number;
}

export interface ArtifactManifestEntry {
  path: string;
  kind: "report" | "har" | "json" | "timeline" | "audio" | "video" | "asset" | "other";
  optional: boolean;
  enabled: boolean;
  bytes?: number;
}

export interface ExportManifest {
  version: string;
  sessionId: string;
  exportedAt: number;
  privacy: { localOnly: true; remoteUpload: false };
  options: CaptureOptions;
  files: ArtifactManifestEntry[];
  health: SessionHealth;
}

export interface TraceSummary {
  sessionId: string;
  startedAt: number;
  stoppedAt?: number;
  durationMs: number;
  counts: {
    console: number;
    network: number;
    userActions: number;
    timeline: number;
    domSnapshots: number;
  };
  health: SessionHealth;
}

export interface SessionData {
  session: CaptureSession | null;
  timeline: TimelineEvent[];
  console: ConsoleEntry[];
  network: NetworkEntry[];
  userActions: UserAction[];
  diagnostics: DiagnosticsBundle[];
  domSnapshots: DomSnapshot[];
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
