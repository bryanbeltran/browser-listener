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

  return () => {
    for (const level of LEVELS) {
      const original = originals.get(level);
      if (original) console[level] = original;
    }
  };
}
