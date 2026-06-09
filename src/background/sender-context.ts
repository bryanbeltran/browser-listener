import type {
  ConsoleEntry,
  DiagnosticsBundle,
  DomSnapshot,
  UserAction,
} from "../shared/types.js";

export function frameIdFromSender(sender: chrome.runtime.MessageSender): string | undefined {
  return sender.frameId != null && sender.frameId >= 0 ? String(sender.frameId) : undefined;
}

export function withSenderFrame<T extends { frameId?: string; tabId?: number }>(
  item: T,
  sender: chrome.runtime.MessageSender,
): T {
  const frameId = frameIdFromSender(sender);
  const tabId = sender.tab?.id;
  return {
    ...item,
    ...(frameId != null ? { frameId } : {}),
    ...(tabId != null ? { tabId } : {}),
  };
}

export function enrichDiagnosticsBundle(
  bundle: DiagnosticsBundle,
  sender: chrome.runtime.MessageSender,
): DiagnosticsBundle {
  const frameId = frameIdFromSender(sender);
  if (frameId == null) return bundle;
  return {
    ...bundle,
    frames: bundle.frames.map((f, i) => (i === 0 ? { ...f, frameId } : f)),
  };
}

export function enrichConsoleEntry(
  entry: ConsoleEntry,
  sender: chrome.runtime.MessageSender,
): ConsoleEntry {
  return withSenderFrame(entry, sender);
}

export function enrichUserAction(action: UserAction, sender: chrome.runtime.MessageSender): UserAction {
  return withSenderFrame(action, sender);
}

export function enrichDomSnapshot(
  snapshot: DomSnapshot,
  sender: chrome.runtime.MessageSender,
): DomSnapshot {
  return withSenderFrame(snapshot, sender);
}

export function userActionTimelineSummary(action: UserAction): string {
  const target = action.target ?? "element";
  switch (action.type) {
    case "click":
      return `click ${target}`;
    case "submit":
      return `submit ${target}`;
    case "input":
    case "change":
      return `${action.type} ${target}`;
    case "route":
      return `route ${action.valueSummary ?? action.url}`;
    case "visibility":
      return `visibility ${action.valueSummary ?? "changed"}`;
    default:
      return action.type;
  }
}
