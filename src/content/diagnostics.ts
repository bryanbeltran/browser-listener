import type { DiagnosticsBundle, DomSnapshot, FrameInfo } from "../shared/types.js";

export function collectFrameInfo(): FrameInfo {
  let crossOrigin = false;
  try {
    crossOrigin = window.parent !== window && window.parent.location.href === "";
  } catch {
    crossOrigin = window.parent !== window;
  }
  return {
    frameId: crypto.randomUUID(),
    url: location.href,
    name: window.name || undefined,
    crossOrigin,
    timestamp: Date.now(),
  };
}

export function collectDiagnostics(): DiagnosticsBundle {
  const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  return {
    frames: [collectFrameInfo()],
    route: {
      href: location.href,
      pathname: location.pathname,
      search: location.search,
      hash: location.hash,
      title: document.title,
    },
    performance: {
      timestamp: Date.now(),
      navigation: nav,
      resourceCount: performance.getEntriesByType("resource").length,
    },
    visibility: document.visibilityState,
    capturedAt: Date.now(),
  };
}

export function captureDomSnapshot(sessionId: string): DomSnapshot {
  const root = document.documentElement;
  const html = root?.outerHTML ?? "";
  return {
    id: crypto.randomUUID(),
    sessionId,
    timestamp: Date.now(),
    url: location.href,
    frameUrl: location.href,
    htmlSummary: html.slice(0, 20_000),
    nodeCount: document.querySelectorAll("*").length,
  };
}
