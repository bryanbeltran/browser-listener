export type ConsoleLevel = "log" | "info" | "warn" | "error" | "debug";

export interface CaptureOptions {
  screenRecording: boolean;
  tabAudio: boolean;
  staticAssetBodies: boolean;
  /** CDP capture of GraphQL/ajax API request+response bodies (scoped URLs, size-capped). */
  graphqlBodies: boolean;
  /** Capture console + exceptions via CDP/content script. Off by default (noisy on large sites). */
  consoleCapture: boolean;
  enricherIds: string[];
}

export const DEFAULT_CAPTURE_OPTIONS: CaptureOptions = {
  screenRecording: false,
  tabAudio: false,
  staticAssetBodies: false,
  graphqlBodies: true,
  consoleCapture: false,
  enricherIds: ["facebook-groups"],
};

export interface FacebookGroupSummary {
  id: string;
  name?: string;
  url?: string;
}

export interface FacebookPerson {
  id: string;
  name: string;
  url?: string;
  source: string;
}

export interface FacebookPost {
  id: string;
  /** Numeric post id when known (from feedback decode or permalink). */
  postId?: string;
  feedbackId?: string;
  text?: string;
  authorId?: string;
  authorName?: string;
  createdAt?: number;
  url?: string;
  source: string;
  /** Extracted from truncated / non-JSON GraphQL line. */
  partialParse?: boolean;
}

export interface FacebookComment {
  id: string;
  text?: string;
  authorId?: string;
  authorName?: string;
  createdAt?: number;
  postId?: string;
  source: string;
}

export interface FacebookReaction {
  feedbackId?: string;
  /** Post id linked via decoded feedback id. */
  postId?: string;
  userId: string;
  userName: string;
  reactionCount?: number;
  source: string;
}

export interface FacebookGroupActivity {
  groups: FacebookGroupSummary[];
  people: FacebookPerson[];
  posts: FacebookPost[];
  comments: FacebookComment[];
  reactions: FacebookReaction[];
  graphqlQueryHints: { docId: string; friendlyName?: string; count: number }[];
  sessionPermalink?: string;
  parseWarnings?: string[];
}

export interface SessionEnrichments {
  facebookGroups?: FacebookGroupActivity;
}

export interface StorageTruncation {
  console: number;
  network: number;
  timeline: number;
  userActions: number;
}

export interface SessionHealth {
  debuggerAttached: boolean;
  debuggerDetachCount: number;
  lastDetachAt?: number;
  lastRecoverAt?: number;
  serviceWorkerRestarts: number;
  partialGaps: HealthGap[];
  persistenceErrors: string[];
  eventCounts: Record<string, number>;
  /** Count of entries dropped due to storage caps */
  truncation: StorageTruncation;
  /** Total bytes stored for API body capture this session */
  apiBodyBytesStored?: number;
  /** Responses whose bodies were skipped due to session byte cap */
  apiBodiesSkippedSessionCap?: number;
  /** Individual request/response bodies truncated to per-response cap */
  apiBodiesPerResponseTruncated?: number;
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
  tabClosedDuringCapture?: boolean;
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
  /** Redacted request body when graphqlBodies opt-in and URL matches */
  requestBody?: string;
  responseBody?: string;
  requestBodyTruncated?: boolean;
  responseBodyTruncated?: boolean;
  contentType?: string;
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
  frameId?: string;
  tabId?: number;
}

export interface FrameInfo {
  /** Chrome frameId as string (from CDP or message sender) */
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
  frameId?: string;
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
  /** Populated at export time by enrichers (not persisted during capture). */
  enrichments?: SessionEnrichments;
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
