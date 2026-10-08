import { strToU8, unzipSync, zipSync } from "fflate";

export const SDK_VERSION = "0.1.0" as const;
export const REQUIRED_ARTIFACTS = [
  "report.html",
  "raw.har",
  "raw-console.json",
  "export-manifest.json",
] as const;

export const ARCHIVE_LIMITS = {
  maxArchiveBytes: 25 * 1024 * 1024,
  maxEntries: 64,
  maxExpandedBytes: 50 * 1024 * 1024,
  maxEntryBytes: 20 * 1024 * 1024,
  maxExpansionRatio: 100,
} as const;

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

function unsafeArchivePath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  return normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized) || normalized.split("/").includes("..") || normalized.includes("\0");
}

function extractArchive(input: Uint8Array): Record<string, Uint8Array> {
  if (input.byteLength > ARCHIVE_LIMITS.maxArchiveBytes) {
    throw new Error(`Archive exceeds ${ARCHIVE_LIMITS.maxArchiveBytes} byte limit`);
  }
  let entries = 0;
  let expandedBytes = 0;
  return unzipSync(input, {
    filter(file) {
      entries += 1;
      const originalSize = file.originalSize ?? 0;
      const compressedSize = file.size ?? 0;
      if (entries > ARCHIVE_LIMITS.maxEntries) throw new Error("Archive contains too many entries");
      if (unsafeArchivePath(file.name)) throw new Error(`Unsafe archive path: ${file.name}`);
      if (originalSize > ARCHIVE_LIMITS.maxEntryBytes) throw new Error(`Archive entry exceeds size limit: ${file.name}`);
      expandedBytes += originalSize;
      if (expandedBytes > ARCHIVE_LIMITS.maxExpandedBytes) throw new Error("Archive exceeds expanded byte limit");
      if (compressedSize > 0 && originalSize / compressedSize > ARCHIVE_LIMITS.maxExpansionRatio) {
        throw new Error(`Archive entry exceeds expansion ratio: ${file.name}`);
      }
      return true;
    },
  });
}

function decodeUtf8(bytes: Uint8Array, path: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error(`Invalid UTF-8 in ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function parseJson<T>(files: Record<string, Uint8Array>, path: string): T {
  const bytes = files[path];
  if (!bytes) throw new Error(`Missing artifact: ${path}`);
  try {
    return JSON.parse(decodeUtf8(bytes, path)) as T;
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
  return files.filter(unsafeArchivePath);
}

/** Parse a bundle without executing report.html or any captured content. */
export function readBundle(input: Uint8Array | ArrayBuffer): Bundle {
  const archive = extractArchive(asBytes(input));
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
  const manifestFiles = bundle.manifest.files ?? [];
  const manifestPaths = new Set<string>();
  for (const file of manifestFiles) {
    if (!file.path) continue;
    if (manifestPaths.has(file.path)) add("export-manifest.json.files", "duplicate-artifact", `Manifest lists ${file.path} more than once`);
    manifestPaths.add(file.path);
    if (!bundle.files[file.path]) add("export-manifest.json.files", "manifest-reference", `Manifest references missing artifact ${file.path}`);
    const bytes = bundle.files[file.path];
    if (bytes && file.bytes != null && file.bytes !== bytes.byteLength) {
      add(`export-manifest.json.files.${file.path}.bytes`, "artifact-bytes", `Declared ${file.bytes} bytes but found ${bytes.byteLength}`);
    }
  }
  for (const path of Object.keys(bundle.files)) {
    if (!REQUIRED_ARTIFACTS.includes(path as ArtifactName) && !manifestPaths.has(path)) {
      add(`archive.${path}`, "unknown-artifact", "Artifact is not listed in the manifest", "warning");
    }
  }
  const totals = bundle.manifest.coverage?.totals;
  if (totals?.network != null && totals.network !== (bundle.har.log?.entries?.length ?? 0)) {
    add("export-manifest.json.coverage.totals.network", "count-mismatch", "Network total does not match raw.har");
  }
  if (totals?.navigation != null && totals.navigation !== (bundle.har.log?.pages?.length ?? 0)) {
    add("export-manifest.json.coverage.totals.navigation", "count-mismatch", "Navigation total does not match raw.har pages");
  }
  if (totals?.console != null && totals.console !== bundle.console.length) {
    add("export-manifest.json.coverage.totals.console", "count-mismatch", "Console total does not match raw-console.json");
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

/** Verify manifest-declared SHA-256 values without executing any captured content. */
export async function verifyChecksums(bundle: Bundle): Promise<ValidationResult> {
  const issues: ValidationIssue[] = [];
  for (const file of bundle.manifest.files ?? []) {
    if (!file.path || !file.sha256) continue;
    const bytes = bundle.files[file.path];
    if (!bytes) continue;
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes as BufferSource);
    const actual = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
    if (actual !== file.sha256) {
      issues.push({
        path: `archive.${file.path}`,
        code: "checksum-mismatch",
        message: "Artifact SHA-256 does not match the manifest",
        severity: "error",
      });
    }
  }
  return { valid: issues.length === 0, issues };
}

/** Create a new conservative archive with only required artifacts and a repaired manifest. */
export async function repairBundle(input: Uint8Array | ArrayBuffer): Promise<Uint8Array> {
  const bundle = readBundle(input);
  const validation = validateBundle(bundle);
  const semanticErrors = validation.issues.filter((issue) =>
    issue.severity === "error" && !["manifest-reference", "artifact-bytes", "count-mismatch"].includes(issue.code),
  );
  if (semanticErrors.length) {
    throw new Error(`Bundle has semantic errors that cannot be repaired: ${semanticErrors.map((issue) => issue.message).join("; ")}`);
  }
  const files: Array<Record<string, unknown>> = [];
  for (const path of REQUIRED_ARTIFACTS) {
    const original = bundle.manifest.files?.find((file) => file.path === path);
    const bytes = bundle.files[path];
    const file: Record<string, unknown> = {
      path,
      kind: original?.kind ?? (path === "report.html" ? "report" : path === "raw.har" ? "har" : "json"),
      optional: false,
      enabled: true,
      schemaVersion: original?.schemaVersion ?? 1,
    };
    if (path !== "export-manifest.json") {
      const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes as BufferSource);
      file.bytes = bytes.byteLength;
      file.sha256 = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
    }
    files.push(file);
  }
  const manifest = {
    ...bundle.manifest,
    files,
    provenance: bundle.manifest.provenance ?? {
      schemaVersion: 1,
      deterministic: true,
      checksumAlgorithm: "sha256",
      sourceSessionId: bundle.manifest.sessionId ?? "none",
      exportedAt: bundle.manifest.exportedAt ?? 0,
      redactionRuleSetVersion: "unknown",
      manifestChecksumExcluded: true,
    },
  };
  const manifestBytes = strToU8(JSON.stringify(manifest, null, 2));
  return zipSync({
    "report.html": bundle.files["report.html"],
    "raw.har": bundle.files["raw.har"],
    "raw-console.json": bundle.files["raw-console.json"],
    "export-manifest.json": manifestBytes,
  }, { mtime: new Date("1980-01-01T00:00:00.000Z") });
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
