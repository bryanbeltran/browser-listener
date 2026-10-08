import {
  appendContextSnapshot,
  appendPerformanceSignal,
  readSessionData,
  recordHealthGap,
} from "../persistence/store.js";
import { buildCapabilityMatrix } from "./capabilities.js";
import { getActiveSession } from "./session-manager.js";
import type {
  BrowserContextSnapshot,
  FrameTreeNode,
  FrameTreeSnapshot,
  LongTaskSummary,
  NavigationTimingSummary,
  PerformanceSignal,
  ResourceTimingSummary,
} from "../shared/types.js";

const CONTEXT_EXPRESSION = `(() => ({
  url: location.href,
  title: document.title,
  visibilityState: document.visibilityState,
  focused: document.hasFocus(),
  online: navigator.onLine,
  viewport: { width: window.innerWidth, height: window.innerHeight },
  deviceScaleFactor: window.devicePixelRatio,
  navigationTiming: (() => {
    const entry = performance.getEntriesByType('navigation')[0];
    if (!entry) return undefined;
    return {
      durationMs: entry.duration,
      responseStartMs: entry.responseStart,
      domContentLoadedMs: entry.domContentLoadedEventEnd,
      loadEventMs: entry.loadEventEnd,
      transferSize: entry.transferSize
    };
  })(),
  resourceTiming: (() => {
    const entries = performance.getEntriesByType('resource');
    let totalDurationMs = 0;
    let totalTransferSize = 0;
    let slowestDurationMs = 0;
    let hasTransferSize = false;
    for (const entry of entries) {
      totalDurationMs += Number.isFinite(entry.duration) ? entry.duration : 0;
      slowestDurationMs = Math.max(slowestDurationMs, Number.isFinite(entry.duration) ? entry.duration : 0);
      if (Number.isFinite(entry.transferSize)) {
        totalTransferSize += entry.transferSize;
        hasTransferSize = true;
      }
    }
    return {
      count: entries.length,
      totalDurationMs,
      slowestDurationMs: entries.length ? slowestDurationMs : undefined,
      totalTransferSize: hasTransferSize ? totalTransferSize : undefined
    };
  })(),
  longTaskSummary: (() => {
    const entries = performance.getEntriesByType('longtask');
    let totalDurationMs = 0;
    let longestDurationMs = 0;
    for (const entry of entries) {
      totalDurationMs += Number.isFinite(entry.duration) ? entry.duration : 0;
      longestDurationMs = Math.max(longestDurationMs, Number.isFinite(entry.duration) ? entry.duration : 0);
    }
    return {
      count: entries.length,
      totalDurationMs,
      longestDurationMs: entries.length ? longestDurationMs : undefined
    };
  })()
}))()`;

const MAX_FRAME_NODES = 200;

const PERFORMANCE_METRICS = new Set([
  "NavigationStart",
  "DomContentLoaded",
  "LoadEvent",
  "FirstMeaningfulPaint",
  "LayoutCount",
  "RecalcStyleCount",
  "TaskDuration",
  "JSHeapUsedSize",
  "JSHeapTotalSize",
  "Nodes",
  "Documents",
  "Frames",
]);

function numeric(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function timingSummary(value: unknown): NavigationTimingSummary | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Record<string, unknown>;
  const summary: NavigationTimingSummary = {};
  for (const key of ["durationMs", "responseStartMs", "domContentLoadedMs", "loadEventMs", "transferSize"] as const) {
    const number = numeric(candidate[key]);
    if (number != null) summary[key] = number;
  }
  return Object.keys(summary).length ? summary : undefined;
}

function resourceTimingSummary(value: unknown): ResourceTimingSummary | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Record<string, unknown>;
  const count = numeric(candidate.count);
  const totalDurationMs = numeric(candidate.totalDurationMs);
  if (count == null || totalDurationMs == null) return undefined;
  return {
    count: Math.max(0, Math.floor(count)),
    totalDurationMs: Math.max(0, totalDurationMs),
    ...(numeric(candidate.slowestDurationMs) == null ? {} : { slowestDurationMs: Math.max(0, numeric(candidate.slowestDurationMs)!) }),
    ...(numeric(candidate.totalTransferSize) == null ? {} : { totalTransferSize: Math.max(0, numeric(candidate.totalTransferSize)!) }),
  };
}

function longTaskSummary(value: unknown): LongTaskSummary | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Record<string, unknown>;
  const count = numeric(candidate.count);
  const totalDurationMs = numeric(candidate.totalDurationMs);
  if (count == null || totalDurationMs == null) return undefined;
  return {
    count: Math.max(0, Math.floor(count)),
    totalDurationMs: Math.max(0, totalDurationMs),
    ...(numeric(candidate.longestDurationMs) == null ? {} : { longestDurationMs: Math.max(0, numeric(candidate.longestDurationMs)!) }),
  };
}

function frameTreeSnapshot(value: unknown): FrameTreeSnapshot {
  if (!value || typeof value !== "object") return { browserSupport: "cdp-page-v1", frames: [] };
  const root = value as Record<string, unknown>;
  const frames: FrameTreeNode[] = [];
  let truncated = false;
  const visit = (node: unknown, parentId?: string): void => {
    if (!node || typeof node !== "object") return;
    const candidate = node as Record<string, unknown>;
    const frame = candidate.frame && typeof candidate.frame === "object"
      ? candidate.frame as Record<string, unknown>
      : candidate;
    const id = typeof frame.id === "string" ? frame.id : undefined;
    if (!id) return;
    const children = Array.isArray(candidate.childFrames) ? candidate.childFrames : [];
    if (frames.length >= MAX_FRAME_NODES) {
      truncated = true;
      return;
    }
    frames.push({
      id,
      ...(typeof frame.parentId === "string" ? { parentId: frame.parentId } : parentId ? { parentId } : {}),
      ...(typeof frame.url === "string" ? { url: frame.url } : {}),
      ...(typeof frame.securityOrigin === "string" ? { securityOrigin: frame.securityOrigin } : {}),
      ...(typeof frame.name === "string" && frame.name ? { name: frame.name } : {}),
      childCount: children.length,
    });
    for (const child of children) visit(child, id);
  };
  visit(root.frameTree ?? root);
  return {
    browserSupport: "cdp-page-v1",
    ...(frames[0]?.id ? { rootId: frames[0].id } : {}),
    frames,
    ...(truncated ? { truncated: true } : {}),
  };
}

async function captureFrameTree(tabId: number): Promise<FrameTreeSnapshot> {
  try {
    const result = await chrome.debugger.sendCommand({ tabId }, "Page.getFrameTree") as { frameTree?: unknown };
    return frameTreeSnapshot(result.frameTree);
  } catch {
    return { browserSupport: "unsupported", frames: [] };
  }
}

async function activeTarget(tabId: number) {
  const session = await getActiveSession();
  return session?.tabId === tabId || session?.targets?.some((target) => target.tabId === tabId)
    ? session
    : null;
}

export async function captureBrowserContext(tabId: number, frameId?: number): Promise<BrowserContextSnapshot | null> {
  const session = await activeTarget(tabId);
  if (!session || session.paused) return null;
  let value: Record<string, unknown> | undefined;
  let source: BrowserContextSnapshot["source"] = "Runtime.evaluate";
  try {
    const result = await chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", {
      expression: CONTEXT_EXPRESSION,
      returnByValue: true,
      awaitPromise: false,
    }) as { result?: { value?: unknown } };
    if (result?.result?.value && typeof result.result.value === "object") value = result.result.value as Record<string, unknown>;
  } catch {
    source = "tabs.get";
  }
  if (!value) {
    try {
      const tab = await chrome.tabs.get(tabId);
      value = { url: tab.url, title: tab.title };
      source = "tabs.get";
    } catch {
      await recordHealthGap("context_snapshot_unavailable");
      return null;
    }
  }
  const viewport = value.viewport && typeof value.viewport === "object"
    ? value.viewport as { width?: unknown; height?: unknown }
    : undefined;
  const snapshot: BrowserContextSnapshot = {
    id: crypto.randomUUID(),
    sessionId: session.id,
    timestamp: Date.now(),
    tabId,
    ...(frameId == null ? {} : { frameId }),
    ...(typeof value.url === "string" ? { url: value.url } : {}),
    ...(typeof value.title === "string" ? { title: value.title } : {}),
    ...(typeof value.visibilityState === "string" ? { visibilityState: value.visibilityState } : {}),
    ...(typeof value.focused === "boolean" ? { focused: value.focused } : {}),
    ...(typeof value.online === "boolean" ? { online: value.online } : {}),
    ...(numeric(viewport?.width) != null && numeric(viewport?.height) != null
      ? { viewport: { width: numeric(viewport?.width)!, height: numeric(viewport?.height)! } }
      : {}),
    ...(numeric(value.deviceScaleFactor) == null ? {} : { deviceScaleFactor: numeric(value.deviceScaleFactor) }),
    ...(timingSummary(value.navigationTiming) ? { navigationTiming: timingSummary(value.navigationTiming) } : {}),
    ...(resourceTimingSummary(value.resourceTiming) ? { resourceTiming: resourceTimingSummary(value.resourceTiming) } : {}),
    ...(longTaskSummary(value.longTaskSummary) ? { longTaskSummary: longTaskSummary(value.longTaskSummary) } : {}),
    frameTree: await captureFrameTree(tabId),
    capabilities: session.capabilities ?? buildCapabilityMatrix(),
    source,
  };
  await appendContextSnapshot(snapshot);
  return snapshot;
}

export async function capturePerformanceSignal(tabId: number): Promise<PerformanceSignal | null> {
  const session = await activeTarget(tabId);
  if (!session || session.paused) return null;
  const timestamp = Date.now();
  const metrics: Record<string, number> = {};
  let browserSupport: PerformanceSignal["browserSupport"] = "cdp-performance-v1";
  try {
    const result = await chrome.debugger.sendCommand({ tabId }, "Performance.getMetrics") as { metrics?: Array<{ name?: string; value?: number }> };
    for (const metric of result.metrics ?? []) {
      if (typeof metric.name === "string" && PERFORMANCE_METRICS.has(metric.name) && numeric(metric.value) != null) {
        metrics[metric.name] = metric.value!;
      }
    }
  } catch {
    browserSupport = "unsupported";
  }
  const previous = (await readSessionData()).performanceSignals?.filter((entry) => entry.tabId === tabId).at(-1);
  const signal: PerformanceSignal = {
    id: crypto.randomUUID(),
    sessionId: session.id,
    timestamp,
    tabId,
    ...(previous ? { samplingIntervalMs: Math.max(0, timestamp - previous.timestamp) } : {}),
    browserSupport,
    metrics,
  };
  await appendPerformanceSignal(signal);
  return signal;
}
