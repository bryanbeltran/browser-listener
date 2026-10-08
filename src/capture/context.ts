import {
  appendContextSnapshot,
  appendPerformanceSignal,
  readSessionData,
  recordHealthGap,
} from "../persistence/store.js";
import { getActiveSession } from "./session-manager.js";
import type { BrowserContextSnapshot, PerformanceSignal } from "../shared/types.js";

const CONTEXT_EXPRESSION = `(() => ({
  url: location.href,
  title: document.title,
  visibilityState: document.visibilityState,
  focused: document.hasFocus(),
  online: navigator.onLine,
  viewport: { width: window.innerWidth, height: window.innerHeight },
  deviceScaleFactor: window.devicePixelRatio
}))()`;

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
