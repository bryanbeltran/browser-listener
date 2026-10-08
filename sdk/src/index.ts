import { strFromU8, unzipSync } from "fflate";

export const SDK_VERSION = "0.1.0" as const;
export const REQUIRED_ARTIFACTS = [
  "report.html",
  "raw.har",
  "raw-console.json",
  "export-manifest.json",
] as const;

export type ArtifactName = (typeof REQUIRED_ARTIFACTS)[number];

export interface HarEntry {
  startedDateTime?: string;
  time?: number;
  request?: { method?: string; url?: string };
  response?: { status?: number; statusText?: string };
  _browserListener?: { id?: string; type?: string; sessionId?: string };
  [key: string]: unknown;
}

export interface HarDocument {
  log?: {
    version?: string;
    entries?: HarEntry[];
    pages?: unknown[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface ConsoleRecord {
  id?: string;
  level?: string;
  text?: string;
  timestamp?: number;
  [key: string]: unknown;
}

export interface BundleManifest {
  schemaVersion?: number;
  format?: string;
  sessionId?: string;
  extensionVersion?: string;
  exportedAt?: number;
  privacy?: { redactionEnabled?: boolean; [key: string]: unknown };
  coverage?: {
    schemaVersion?: number;
    totals?: Record<string, number>;
    quality?: Record<string, unknown>;
    [key: string]: unknown;
  };
  files?: Array<{ path?: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

export interface Bundle {
  files: Readonly<Record<string, Uint8Array>>;
  manifest: BundleManifest;
  har: HarDocument;
  console: ConsoleRecord[];
}

export interface ValidationIssue {
  path: string;
  code: string;
  message: string;
  severity: "error" | "warning";
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

export interface NetworkFilter {
  urlIncludes?: string;
  methods?: string[];
  types?: string[];
  statusMin?: number;
  statusMax?: number;
}

export interface ConsoleFilter {
  levels?: string[];
  textIncludes?: string;
}

export interface BundleSummary {
  sessionId: string;
  extensionVersion?: string;
  redactionEnabled?: boolean;
  files: string[];
  network: number;
  console: number;
  navigation: number;
  markers: number;
  partial: boolean;
}

function asBytes(input: Uint8Array | ArrayBuffer): Uint8Array {
  return input instanceof Uint8Array ? input : new Uint8Array(input);
}

function parseJson<T>(files: Record<string, Uint8Array>, path: string): T {
  const bytes = files[path];
  if (!bytes) throw new Error(`Missing artifact: ${path}`);
  try {
    return JSON.parse(strFromU8(bytes)) as T;
  } catch (error) {
    throw new Error(`Invalid JSON in ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function duplicateIds(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort();
}

function safeArchivePaths(files: string[]): string[] {
  return files.filter((path) => {
    const normalized = path.replaceAll("\\", "/");
    return normalized.startsWith("/") || normalized.split("/").includes("..") || normalized.includes("\0");
  });
}

/** Parse a bundle without executing report.html or any captured content. */
export function readBundle(input: Uint8Array | ArrayBuffer): Bundle {
  const archive = unzipSync(asBytes(input));
  const unsafe = safeArchivePaths(Object.keys(archive));
  if (unsafe.length) throw new Error(`Unsafe archive path(s): ${unsafe.join(", ")}`);
  for (const path of REQUIRED_ARTIFACTS) {
    if (!archive[path]) throw new Error(`Missing required artifact: ${path}`);
  }
  const manifest = parseJson<BundleManifest>(archive, "export-manifest.json");
  const har = parseJson<HarDocument>(archive, "raw.har");
  const consoleRecords = parseJson<ConsoleRecord[]>(archive, "raw-console.json");
  if (!Array.isArray(consoleRecords)) throw new Error("raw-console.json is not an array");
  if (har.log?.version !== "1.2" || !Array.isArray(har.log.entries)) {
    throw new Error("raw.har is not a HAR 1.2 document");
  }
  return { files: archive, manifest, har, console: consoleRecords };
}

export function validateBundle(bundle: Bundle): ValidationResult {
  const issues: ValidationIssue[] = [];
  const add = (path: string, code: string, message: string, severity: ValidationIssue["severity"] = "error") => {
    issues.push({ path, code, message, severity });
  };
  if (bundle.manifest.format !== "browser-listener") add("export-manifest.json.format", "format", "Unsupported bundle format");
  if (![2, 3].includes(bundle.manifest.schemaVersion ?? -1)) {
    add("export-manifest.json.schemaVersion", "schema", "Unsupported manifest schema version");
  }
  if (bundle.manifest.coverage?.schemaVersion != null && ![1, 2, 3].includes(bundle.manifest.coverage.schemaVersion)) {
    add("export-manifest.json.coverage.schemaVersion", "schema", "Unsupported coverage schema version");
  }
  const listed = new Set((bundle.manifest.files ?? []).map((file) => file.path).filter((path): path is string => Boolean(path)));
  for (const path of REQUIRED_ARTIFACTS) {
    if (!listed.has(path)) add("export-manifest.json.files", "manifest-reference", `Manifest does not list ${path}`);
  }
  const harDuplicates = duplicateIds((bundle.har.log?.entries ?? []).map((entry) => entry._browserListener?.id));
  if (harDuplicates.length) add("raw.har.log.entries", "duplicate-id", `Duplicate event IDs: ${harDuplicates.join(", ")}`);
  const consoleDuplicates = duplicateIds(bundle.console.map((entry) => entry.id));
  if (consoleDuplicates.length) add("raw-console.json", "duplicate-id", `Duplicate event IDs: ${consoleDuplicates.join(", ")}`);
  if (bundle.manifest.privacy?.redactionEnabled === false) {
    add("export-manifest.json.privacy.redactionEnabled", "redaction-disabled", "Bundle may contain secrets", "warning");
  }
  return { valid: issues.every((issue) => issue.severity !== "error"), issues };
}

export function filterNetwork(bundle: Bundle, filter: NetworkFilter = {}): HarEntry[] {
  const methods = new Set((filter.methods ?? []).map((method) => method.toUpperCase()));
  const types = new Set(filter.types ?? []);
  const needle = filter.urlIncludes?.toLowerCase();
  return (bundle.har.log?.entries ?? []).filter((entry) => {
    const method = entry.request?.method?.toUpperCase();
    const url = entry.request?.url ?? "";
    const status = entry.response?.status;
    return (
      (!methods.size || (method != null && methods.has(method))) &&
      (!types.size || (entry._browserListener?.type != null && types.has(entry._browserListener.type))) &&
      (!needle || url.toLowerCase().includes(needle)) &&
      (filter.statusMin == null || (status != null && status >= filter.statusMin)) &&
      (filter.statusMax == null || (status != null && status <= filter.statusMax))
    );
  });
}

export function filterConsole(bundle: Bundle, filter: ConsoleFilter = {}): ConsoleRecord[] {
  const levels = new Set((filter.levels ?? []).map((level) => level.toLowerCase()));
  const needle = filter.textIncludes?.toLowerCase();
  return bundle.console.filter((entry) => (
    (!levels.size || (entry.level != null && levels.has(entry.level.toLowerCase()))) &&
    (!needle || (entry.text ?? "").toLowerCase().includes(needle))
  ));
}

export function cite(bundle: Bundle, artifact: "report.html" | "raw.har" | "raw-console.json", eventId: string): string {
  const bundleId = bundle.manifest.sessionId ?? "none";
  const schemaVersion = bundle.manifest.coverage?.schemaVersion ?? bundle.manifest.schemaVersion ?? 0;
  return `browser-listener://${encodeURIComponent(bundleId)}/${encodeURIComponent(artifact)}/${encodeURIComponent(eventId)}?schema=${schemaVersion}`;
}

export function summarize(bundle: Bundle): BundleSummary {
  const coverage = bundle.manifest.coverage;
  const totals = coverage?.totals ?? {};
  return {
    sessionId: bundle.manifest.sessionId ?? "none",
    extensionVersion: bundle.manifest.extensionVersion,
    redactionEnabled: bundle.manifest.privacy?.redactionEnabled,
    files: Object.keys(bundle.files).sort(),
    network: totals.network ?? bundle.har.log?.entries?.length ?? 0,
    console: totals.console ?? bundle.console.length,
    navigation: totals.navigation ?? (bundle.har.log?.pages?.length ?? 0),
    markers: totals.markers ?? 0,
    partial: coverage?.quality?.partial === true,
  };
}
