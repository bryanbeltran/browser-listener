import type { ConsoleEntry, ConsoleLevel } from "../shared/types.js";

const LEVELS: ConsoleLevel[] = ["log", "info", "warn", "error", "debug"];

function serializeArg(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function createEntry(sessionId: string, level: ConsoleLevel, args: unknown[]): ConsoleEntry {
  return {
    id: crypto.randomUUID(),
    sessionId,
    timestamp: Date.now(),
    level,
    args: args.map(serializeArg),
    url: location.href,
    frameUrl: location.href,
    source: "content",
  };
}

export function installConsoleCapture(
  sessionId: string,
  onEntry: (entry: ConsoleEntry) => void,
): () => void {
  const originals = new Map<ConsoleLevel, (...args: unknown[]) => void>();

  for (const level of LEVELS) {
    const original = console[level].bind(console);
    originals.set(level, original);
    console[level] = (...args: unknown[]) => {
      original(...args);
      onEntry(createEntry(sessionId, level, args));
    };
  }

  window.addEventListener("error", (ev) => {
    onEntry({
      ...createEntry(sessionId, "error", [ev.message]),
      stack: ev.error?.stack,
    });
  });

  window.addEventListener("unhandledrejection", (ev) => {
    const reason = ev.reason instanceof Error ? ev.reason.message : String(ev.reason);
    onEntry(createEntry(sessionId, "error", [`Unhandled rejection: ${reason}`]));
  });

  return () => {
    for (const level of LEVELS) {
      const original = originals.get(level);
      if (original) console[level] = original;
    }
  };
}
