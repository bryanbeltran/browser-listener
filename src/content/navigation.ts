import type { UserAction } from "../shared/types.js";

export function installNavigationCapture(
  sessionId: string,
  onAction: (action: UserAction) => void,
): () => void {
  const emit = (type: UserAction["type"], valueSummary?: string) => {
    onAction({
      id: crypto.randomUUID(),
      sessionId,
      timestamp: Date.now(),
      type,
      url: location.href,
      frameUrl: location.href,
      valueSummary,
    });
  };

  const onPop = () => emit("route", `popstate: ${location.href}`);
  const onHash = () => emit("route", `hashchange: ${location.href}`);
  const onVis = () => emit("visibility", document.visibilityState);

  const origPush = history.pushState.bind(history);
  const origReplace = history.replaceState.bind(history);
  history.pushState = (...args) => {
    origPush(...args);
    emit("route", `pushState: ${location.href}`);
  };
  history.replaceState = (...args) => {
    origReplace(...args);
    emit("route", `replaceState: ${location.href}`);
  };

  window.addEventListener("popstate", onPop);
  window.addEventListener("hashchange", onHash);
  document.addEventListener("visibilitychange", onVis);

  return () => {
    window.removeEventListener("popstate", onPop);
    window.removeEventListener("hashchange", onHash);
    document.removeEventListener("visibilitychange", onVis);
    history.pushState = origPush;
    history.replaceState = origReplace;
  };
}
