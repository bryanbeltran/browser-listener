import { buildEvidenceCitation } from "./citations.js";
import { redactSensitiveString, redactUrl } from "../redaction/engine.js";
import { inferCaptureProfile } from "../shared/types.js";
import type {
  ConsoleEntry,
  EvidenceCitation,
  NavigationEntry,
  NetworkEntry,
  SessionData,
} from "../shared/types.js";

export const SESSION_DIFF_SCHEMA_VERSION = 1 as const;

export interface DiffChange {
  field: string;
  before: string | number | boolean | null | undefined;
  after: string | number | boolean | null | undefined;
}

export interface DiffRecord {
  key: string;
  occurrence: number;
  label: string;
  citation: EvidenceCitation;
}

export interface ChangedDiffRecord {
  key: string;
  occurrence: number;
  label: string;
  before: DiffRecord;
  after: DiffRecord;
  changes: DiffChange[];
}

export interface EventDiff {
  added: DiffRecord[];
  removed: DiffRecord[];
  changed: ChangedDiffRecord[];
}

export interface SessionDiff {
  schemaVersion: 1;
  comparable: boolean;
  nonComparableReasons: string[];
  left: {
    sessionId: string;
    redactionEnabled: boolean;
  };
  right: {
    sessionId: string;
    redactionEnabled: boolean;
  };
  network: EventDiff & { orderChanged: boolean };
  console: EventDiff;
  navigation: EventDiff;
  health: { changes: DiffChange[] };
  policy: { changes: DiffChange[] };
}

interface Indexed<T> {
  key: string;
  occurrence: number;
  value: T;
  record: DiffRecord;
}

function safeText(value: string | undefined): string | undefined {
  return value == null ? value : redactSensitiveString(value);
}

function safeUrl(value: string | undefined): string | undefined {
  return value == null ? value : redactUrl(value);
}

function bodyShape(value: string | undefined): string {
  if (value == null) return "absent";
  try {
    return shapeValue(JSON.parse(value), 0);
  } catch {
    return "text";
  }
}

function shapeValue(value: unknown, depth: number): string {
  if (depth >= 4) return "…";
  if (value == null) return "null";
  if (Array.isArray(value)) return `array<${value.length ? shapeValue(value[0], depth + 1) : "empty"}>`;
  if (typeof value !== "object") return typeof value;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `object{${keys.map((key) => `${key}:${shapeValue((value as Record<string, unknown>)[key], depth + 1)}`).join(",")}}`;
}

function indexed<T>(
  values: T[],
  keyOf: (value: T) => string,
  labelOf: (value: T) => string,
  citationOf: (value: T) => EvidenceCitation,
): Indexed<T>[] {
  const occurrences = new Map<string, number>();
  return values.map((value) => {
    const key = keyOf(value);
    const occurrence = occurrences.get(key) ?? 0;
    occurrences.set(key, occurrence + 1);
    return {
      key,
      occurrence,
      value,
      record: {
        key,
        occurrence,
        label: labelOf(value),
        citation: citationOf(value),
      },
    };
  });
}

function compareIndexed<T>(
  left: Indexed<T>[],
  right: Indexed<T>[],
  changesOf: (left: T, right: T) => DiffChange[],
): EventDiff {
  const leftMap = new Map(left.map((item) => [`${item.key}#${item.occurrence}`, item]));
  const rightMap = new Map(right.map((item) => [`${item.key}#${item.occurrence}`, item]));
  const keys = [...new Set([...leftMap.keys(), ...rightMap.keys()])].sort();
  const added: DiffRecord[] = [];
  const removed: DiffRecord[] = [];
  const changed: ChangedDiffRecord[] = [];
  for (const key of keys) {
    const before = leftMap.get(key);
    const after = rightMap.get(key);
    if (!before && after) {
      added.push(after.record);
      continue;
    }
    if (before && !after) {
      removed.push(before.record);
      continue;
    }
    if (!before || !after) continue;
    const changes = changesOf(before.value, after.value);
    if (changes.length) {
      changed.push({
        key: after.key,
        occurrence: after.occurrence,
        label: after.record.label,
        before: before.record,
        after: after.record,
        changes,
      });
    }
  }
  return { added, removed, changed };
}

function networkKey(entry: NetworkEntry): string {
  return `${entry.method.toUpperCase()} ${safeUrl(entry.url) ?? ""} ${entry.type}`;
}

function networkLabel(entry: NetworkEntry): string {
  return `${entry.method.toUpperCase()} ${safeUrl(entry.url) ?? ""}`;
}

function networkChanges(left: NetworkEntry, right: NetworkEntry): DiffChange[] {
  const changes: DiffChange[] = [];
  if (left.statusCode !== right.statusCode) changes.push({ field: "statusCode", before: left.statusCode, after: right.statusCode });
  if (safeText(left.error) !== safeText(right.error)) changes.push({ field: "error", before: safeText(left.error), after: safeText(right.error) });
  if (left.timing?.durationMs !== right.timing?.durationMs) {
    changes.push({ field: "durationMs", before: left.timing?.durationMs, after: right.timing?.durationMs });
  }
  if (Boolean(left.requestBody) !== Boolean(right.requestBody)) changes.push({ field: "requestBody", before: Boolean(left.requestBody), after: Boolean(right.requestBody) });
  if (Boolean(left.responseBody) !== Boolean(right.responseBody)) changes.push({ field: "responseBody", before: Boolean(left.responseBody), after: Boolean(right.responseBody) });
  if (bodyShape(left.responseBody) !== bodyShape(right.responseBody)) changes.push({ field: "responseBodyShape", before: bodyShape(left.responseBody), after: bodyShape(right.responseBody) });
  return changes;
}

function consoleKey(entry: ConsoleEntry): string {
  return `${entry.level}|${safeText(entry.text) ?? ""}|${safeUrl(entry.url) ?? ""}`;
}

function consoleLabel(entry: ConsoleEntry): string {
  return `${entry.level}: ${safeText(entry.text) ?? ""}`;
}

function consoleChanges(left: ConsoleEntry, right: ConsoleEntry): DiffChange[] {
  const changes: DiffChange[] = [];
  if (left.level !== right.level) changes.push({ field: "level", before: left.level, after: right.level });
  if (safeText(left.text) !== safeText(right.text)) changes.push({ field: "text", before: safeText(left.text), after: safeText(right.text) });
  if (safeUrl(left.url) !== safeUrl(right.url)) changes.push({ field: "url", before: safeUrl(left.url), after: safeUrl(right.url) });
  return changes;
}

function navigationKey(entry: NavigationEntry): string {
  return safeUrl(entry.url) ?? "";
}

function navigationLabel(entry: NavigationEntry): string {
  return safeUrl(entry.url) ?? "";
}

function navigationChanges(left: NavigationEntry, right: NavigationEntry): DiffChange[] {
  const before = safeText(left.title);
  const after = safeText(right.title);
  return before === after ? [] : [{ field: "title", before, after }];
}

function citationFor(bundleId: string, artifact: "raw.har" | "raw-console.json", id: string, schemaVersion: number): EvidenceCitation {
  return buildEvidenceCitation(bundleId, artifact, id, schemaVersion);
}

function healthChanges(left: SessionData, right: SessionData): DiffChange[] {
  const fields: Array<[string, string | number | boolean | null | undefined, string | number | boolean | null | undefined]> = [
    ["debuggerAttached", left.session?.health.debuggerAttached, right.session?.health.debuggerAttached],
    ["debuggerEverAttached", left.session?.health.debuggerEverAttached ?? false, right.session?.health.debuggerEverAttached ?? false],
    ["serviceWorkerRestarts", left.session?.health.serviceWorkerRestarts, right.session?.health.serviceWorkerRestarts],
    ["partialGaps", left.session?.health.partialGaps.length ?? 0, right.session?.health.partialGaps.length ?? 0],
    ["persistenceErrors", left.session?.health.persistenceErrors.length ?? 0, right.session?.health.persistenceErrors.length ?? 0],
    ["networkTruncated", left.session?.health.truncation.network ?? 0, right.session?.health.truncation.network ?? 0],
    ["consoleTruncated", left.session?.health.truncation.console ?? 0, right.session?.health.truncation.console ?? 0],
  ];
  return fields.filter(([, before, after]) => before !== after).map(([field, before, after]) => ({ field, before, after }));
}

function policyChanges(left: SessionData, right: SessionData): DiffChange[] {
  const fields: Array<[string, string | boolean | undefined, string | boolean | undefined]> = [
    ["profile", inferCaptureProfile(left.session?.options), inferCaptureProfile(right.session?.options)],
    ["redactionEnabled", left.session?.options.redactionEnabled !== false, right.session?.options.redactionEnabled !== false],
    ["captureBodies", left.session?.options.captureBodies ?? false, right.session?.options.captureBodies ?? false],
    ["captureConsole", left.session?.options.captureConsole ?? true, right.session?.options.captureConsole ?? true],
    ["allowedOrigins", [...(left.session?.options.allowedOrigins ?? [])].sort().join(","), [...(right.session?.options.allowedOrigins ?? [])].sort().join(",")],
  ];
  return fields.filter(([, before, after]) => before !== after).map(([field, before, after]) => ({ field, before, after }));
}

function orderChanged(left: Indexed<NetworkEntry>[], right: Indexed<NetworkEntry>[]): boolean {
  const leftKeys = left.map((entry) => `${entry.key}#${entry.occurrence}`);
  const rightKeys = right.map((entry) => `${entry.key}#${entry.occurrence}`);
  return leftKeys.join("\n") !== rightKeys.join("\n");
}

export function compareSessionData(
  left: SessionData,
  right: SessionData,
  schemaVersion = 3,
): SessionDiff {
  const leftId = left.session?.id ?? "none";
  const rightId = right.session?.id ?? "none";
  const leftRedaction = left.session?.options.redactionEnabled !== false;
  const rightRedaction = right.session?.options.redactionEnabled !== false;
  const nonComparableReasons: string[] = [];
  if (!left.session || !right.session) nonComparableReasons.push("one or both bundles have no session metadata");
  if (leftRedaction !== rightRedaction) nonComparableReasons.push("redaction policy differs");
  const leftNetwork = indexed(
    left.network,
    networkKey,
    networkLabel,
    (entry) => citationFor(leftId, "raw.har", entry.id, schemaVersion),
  );
  const rightNetwork = indexed(
    right.network,
    networkKey,
    networkLabel,
    (entry) => citationFor(rightId, "raw.har", entry.id, schemaVersion),
  );
  const leftConsole = indexed(
    left.console,
    consoleKey,
    consoleLabel,
    (entry) => citationFor(leftId, "raw-console.json", entry.id, schemaVersion),
  );
  const rightConsole = indexed(
    right.console,
    consoleKey,
    consoleLabel,
    (entry) => citationFor(rightId, "raw-console.json", entry.id, schemaVersion),
  );
  const leftNavigation = indexed(
    left.navigation,
    navigationKey,
    navigationLabel,
    (entry) => citationFor(leftId, "raw.har", entry.id, schemaVersion),
  );
  const rightNavigation = indexed(
    right.navigation,
    navigationKey,
    navigationLabel,
    (entry) => citationFor(rightId, "raw.har", entry.id, schemaVersion),
  );
  return {
    schemaVersion: SESSION_DIFF_SCHEMA_VERSION,
    comparable: nonComparableReasons.length === 0,
    nonComparableReasons,
    left: { sessionId: leftId, redactionEnabled: leftRedaction },
    right: { sessionId: rightId, redactionEnabled: rightRedaction },
    network: {
      ...compareIndexed(leftNetwork, rightNetwork, networkChanges),
      orderChanged: orderChanged(leftNetwork, rightNetwork),
    },
    console: compareIndexed(leftConsole, rightConsole, consoleChanges),
    navigation: compareIndexed(leftNavigation, rightNavigation, navigationChanges),
    health: { changes: healthChanges(left, right) },
    policy: { changes: policyChanges(left, right) },
  };
}
