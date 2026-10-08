export interface CaptureOptions {
  /** CDP capture of GraphQL request+response bodies on facebook.com. */
  graphqlBodies: boolean;
  /** During capture, slowly sample Like/Love/Haha reactors for engaged posts. */
  reactionHydration: boolean;
}

export const DEFAULT_CAPTURE_OPTIONS: CaptureOptions = {
  graphqlBodies: true,
  reactionHydration: true,
};

/** Where a post was encountered while browsing. */
export type FacebookSurface = "group" | "timeline" | "page" | "unknown";

/** Optional downstream annotation; the core extension does not infer stance. */
export interface FacebookCauseTag {
  cause: string;
  stance: "pro" | "anti" | "neutral";
}

export interface FacebookLinkedReaction {
  userId: string;
  userName: string;
  /** Like, Love, etc. when captured from GraphQL. */
  reactionType?: string;
}

export interface FacebookGroupSummary {
  id: string;
  name?: string;
  url?: string;
  /** e.g. "53.8K members" from group_member_profiles */
  memberCountText?: string;
}

export interface FacebookGroupMember {
  userId: string;
  name: string;
  groupId?: string;
  groupName?: string;
  role?: string;
  source: string;
}

export interface FacebookMediaAttachment {
  id?: string;
  type: "photo" | "video" | "link" | "other";
  caption?: string;
  width?: number;
  height?: number;
}

export interface FacebookShareInfo {
  originalPostId?: string;
  originalAuthorName?: string;
  originalText?: string;
  originalUrl?: string;
}

export interface FacebookPerson {
  id: string;
  name: string;
  url?: string;
  source: string;
}

export interface FacebookPost {
  id: string;
  postId?: string;
  feedbackId?: string;
  text?: string;
  authorId?: string;
  authorName?: string;
  createdAt?: number;
  url?: string;
  surface?: FacebookSurface;
  groupId?: string;
  groupName?: string;
  source: string;
  partialParse?: boolean;
  reactionCount?: number;
  linkedReactions?: FacebookLinkedReaction[];
  commentCount?: number;
  linkedComments?: {
    id: string;
    authorId?: string;
    authorName?: string;
    text?: string;
    createdAt?: number;
    reactionCount?: number;
    linkedReactions?: FacebookLinkedReaction[];
  }[];
  media?: FacebookMediaAttachment[];
  share?: FacebookShareInfo;
  causeTags?: FacebookCauseTag[];
}

export interface FacebookComment {
  id: string;
  feedbackId?: string;
  text?: string;
  authorId?: string;
  authorName?: string;
  createdAt?: number;
  postId?: string;
  source: string;
  reactionCount?: number;
  linkedReactions?: FacebookLinkedReaction[];
  causeTags?: FacebookCauseTag[];
}

export interface FacebookReaction {
  feedbackId?: string;
  postId?: string;
  commentId?: string;
  target?: "post" | "comment";
  userId: string;
  userName: string;
  reactionType?: string;
  reactionCount?: number;
  source: string;
  /** Author of the post or comment that was reacted to. */
  targetAuthorId?: string;
  /** Truncated text of the reacted-to post or comment. */
  targetText?: string;
  /** Post id of the reacted-to content (post or parent of comment). */
  targetPostId?: string;
}

/** Flat edge for classifiers — one observable user action. */
export interface FacebookUserActivitySignal {
  userId?: string;
  userName?: string;
  /** True when userId is a stable Facebook numeric id (not name-only inference). */
  userIdResolved: boolean;
  actionType: "post" | "comment" | "reaction";
  targetId?: string;
  targetType?: "post" | "comment" | "reaction";
  text?: string;
  reactionType?: string;
  postId?: string;
  commentId?: string;
  source: string;
}

export interface FacebookGroupActivity {
  groups: FacebookGroupSummary[];
  members: FacebookGroupMember[];
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
  network: number;
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
  /** Last chrome.debugger.attach / Network.enable failure, if any. */
  lastAttachError?: string;
  truncation: StorageTruncation;
  apiBodyBytesStored?: number;
  apiBodiesSkippedSessionCap?: number;
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
  /** Extension build active when the session was created. */
  extensionVersion?: string;
  options: CaptureOptions;
  health: SessionHealth;
  tabClosedDuringCapture?: boolean;
}

/** Slim session fields for popup UI (stored without network / GraphQL bodies). */
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

export interface PopupStateSnapshot {
  session: PopupSessionView | null;
  counts: { network: number };
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
  kind: "report" | "json" | "other";
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
    sessionPermalink?: string;
    startedAt?: number;
    stoppedAt?: number;
  };
  totals: {
    network: number;
    groups: number;
    members: number;
    people: number;
    posts: number;
    comments: number;
    reactions: number;
  };
  fields: {
    posts: {
      text: CoverageMetric;
      authorId: CoverageMetric;
      url: CoverageMetric;
    };
    comments: {
      text: CoverageMetric;
      authorId: CoverageMetric;
      postId: CoverageMetric;
    };
    reactions: {
      userId: CoverageMetric;
      targetId: CoverageMetric;
      targetText: CoverageMetric;
      reactionType: CoverageMetric;
    };
  };
  quality: {
    partialPosts: number;
    parseWarnings: number;
    networkTruncated: number;
    healthGaps: number;
    persistenceErrors: number;
  };
}

export interface ExportManifest {
  /** Extension version at export time. */
  version: string;
  extensionVersion: string;
  sessionId: string;
  exportedAt: number;
  privacy: { localOnly: true; remoteUpload: false };
  options: CaptureOptions;
  files: ArtifactManifestEntry[];
  coverage: { path: "coverage-report.json"; schemaVersion: 1 };
  health: SessionHealth;
}

export interface TraceSummary {
  sessionId: string;
  extensionVersion?: string;
  startedAt: number;
  stoppedAt?: number;
  durationMs: number;
  counts: {
    network: number;
    posts: number;
    comments: number;
    reactions: number;
  };
  health: SessionHealth;
}

export interface SessionData {
  session: CaptureSession | null;
  network: NetworkEntry[];
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
