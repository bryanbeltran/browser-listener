import { buildRedactionAudit } from "../redaction/audit.js";
import { REDACTED, REDACTION_RULE_SET_VERSION } from "../redaction/engine.js";
import { EXCLUDED_FIELD, fieldsForSession, policyForSession } from "../shared/field-policy.js";
import type {
  CaptureField,
  CoverageReport,
  CoverageState,
  NetworkEntry,
  PrivacyFieldReceipt,
  PrivacyReceipt,
  SessionData,
} from "../shared/types.js";

export const PRIVACY_FIELD_KEYS: CaptureField[] = [
  "urls",
  "headers",
  "requestBodies",
  "responseBodies",
  "consoleArguments",
  "navigationTitles",
  "visualEvidence",
];

function emptyFieldReceipt(): PrivacyFieldReceipt {
  return { captured: 0, excluded: 0, redacted: 0, truncated: 0, dropped: 0, unavailable: 0 };
}

function emptyReceipt(): Record<CaptureField, PrivacyFieldReceipt> {
  return Object.fromEntries(PRIVACY_FIELD_KEYS.map((field) => [field, emptyFieldReceipt()])) as Record<CaptureField, PrivacyFieldReceipt>;
}

function isRedacted(value: unknown): boolean {
  if (typeof value === "string") return value.includes(REDACTED);
  if (Array.isArray(value)) return value.some(isRedacted);
  if (value && typeof value === "object") return Object.values(value).some(isRedacted);
  return false;
}

function stateForValue(value: unknown, fallback: Exclude<CoverageState, "observed"> = "unavailable"): CoverageState {
  if (value === EXCLUDED_FIELD) return "excluded";
  if (value == null || value === "") return fallback;
  return isRedacted(value) ? "redacted" : "observed";
}

function addState(
  fields: Record<CaptureField, PrivacyFieldReceipt>,
  field: CaptureField,
  state: CoverageState,
  amount = 1,
): void {
  const bucket = state === "observed"
    ? "captured"
    : state === "redacted"
      ? "redacted"
      : state;
  fields[field][bucket] += amount;
}

function addValue(
  fields: Record<CaptureField, PrivacyFieldReceipt>,
  field: CaptureField,
  value: unknown,
  fallback: Exclude<CoverageState, "observed"> = "unavailable",
): void {
  addState(fields, field, stateForValue(value, fallback));
}

function bodyState(entry: NetworkEntry, direction: "request" | "response", enabled: boolean): CoverageState {
  const state = direction === "request" ? entry.requestBodyState : entry.responseBodyState;
  if (state) return state;
  const body = direction === "request" ? entry.requestBody : entry.responseBody;
  const truncated = direction === "request" ? entry.requestBodyTruncated : entry.responseBodyTruncated;
  if (body == null) return enabled ? "unavailable" : "excluded";
  if (truncated) return "truncated";
  return isRedacted(body) ? "redacted" : "observed";
}

function addDroppedCounts(
  fields: Record<CaptureField, PrivacyFieldReceipt>,
  coverage: CoverageReport,
): void {
  const add = (field: CaptureField, count: number | undefined): void => {
    if (count) fields[field].dropped += count;
  };
  add("urls", coverage.quality.networkTruncated + coverage.quality.navigationTruncated + coverage.quality.consoleTruncated);
  add("headers", coverage.quality.networkTruncated);
  add("consoleArguments", coverage.quality.consoleTruncated);
  add("navigationTitles", coverage.quality.navigationTruncated);
  add("visualEvidence", coverage.quality.screenshotsTruncated);
}

function receiptWarnings(
  data: SessionData,
  fields: Record<CaptureField, PrivacyFieldReceipt>,
  enabledFields: Record<CaptureField, boolean>,
): string[] {
  const warnings: string[] = [];
  const disabled = PRIVACY_FIELD_KEYS.filter((field) => enabledFields[field] === false && fields[field].excluded > 0);
  if (disabled.length) {
    warnings.push(`Field-level consent excluded: ${disabled.join(", ")}.`);
  }
  if (fields.visualEvidence.captured > 0) {
    warnings.push("Visual evidence is included; screenshot pixels are opaque and are not text-redacted.");
  }
  if (fields.visualEvidence.excluded > 0) {
    warnings.push("A screenshot request was excluded because visual evidence consent was disabled.");
  }
  if (data.session?.options?.redactionEnabled === false) {
    warnings.push("Redaction was explicitly disabled; captured values may contain secrets.");
  }
  return warnings;
}

/** Build a machine-readable, export-local accounting of privacy decisions. */
export function buildPrivacyReceipt(
  data: SessionData,
  coverage: CoverageReport,
  additionalWarnings: string[] = [],
): PrivacyReceipt {
  const fields = emptyReceipt();
  const session = data.session;

  for (const entry of data.network) {
    const policy = policyForSession(session, entry.policyEpochId);
    const consent = fieldsForSession(session, entry.policyEpochId);
    addValue(fields, "urls", consent.urls ? entry.url : EXCLUDED_FIELD, "excluded");
    addValue(
      fields,
      "headers",
      consent.headers ? { request: entry.requestHeaders, response: entry.responseHeaders } : EXCLUDED_FIELD,
      "unavailable",
    );
    addState(fields, "requestBodies", consent.requestBodies ? bodyState(entry, "request", policy?.captureBodies === true) : "excluded");
    addState(fields, "responseBodies", consent.responseBodies ? bodyState(entry, "response", policy?.captureBodies === true) : "excluded");
  }

  for (const entry of data.navigation) {
    const consent = fieldsForSession(session, entry.policyEpochId);
    addValue(fields, "urls", consent.urls ? entry.url : EXCLUDED_FIELD, "excluded");
    addValue(fields, "navigationTitles", consent.navigationTitles ? entry.title : EXCLUDED_FIELD, "excluded");
  }

  for (const entry of data.console) {
    const consent = fieldsForSession(session, entry.policyEpochId);
    if (entry.url != null || !consent.urls) addValue(fields, "urls", consent.urls ? entry.url : EXCLUDED_FIELD, "excluded");
    if (entry.method === "Runtime.consoleAPICalled" || entry.args != null || !consent.consoleArguments) {
      addValue(fields, "consoleArguments", consent.consoleArguments ? entry.args : EXCLUDED_FIELD, "excluded");
    }
  }

  for (const entry of data.markers ?? []) {
    const consent = fieldsForSession(session, entry.policyEpochId);
    if (entry.url != null || !consent.urls) addValue(fields, "urls", consent.urls ? entry.url : EXCLUDED_FIELD, "excluded");
  }

  for (const entry of data.contextSnapshots ?? []) {
    const consent = fieldsForSession(session, entry.policyEpochId);
    if (entry.url != null || !consent.urls) addValue(fields, "urls", consent.urls ? entry.url : EXCLUDED_FIELD, "excluded");
    if (entry.title != null || !consent.navigationTitles) {
      addValue(fields, "navigationTitles", consent.navigationTitles ? entry.title : EXCLUDED_FIELD, "excluded");
    }
  }

  for (const entry of data.screenshots ?? []) {
    const consent = fieldsForSession(session, entry.policyEpochId);
    addState(
      fields,
      "visualEvidence",
      consent.visualEvidence ? entry.state : "excluded",
    );
  }

  addDroppedCounts(fields, coverage);

  const userConfirmedExceptions = new Set<string>();
  if (session?.options?.redactionEnabled === false) userConfirmedExceptions.add("redaction-disabled");
  if (session?.options?.captureBodies === true) userConfirmedExceptions.add("body-capture-opt-in");
  if (data.network.some((entry) => entry.oneRequestCapture === true)) userConfirmedExceptions.add("one-request-body-capture");
  if (data.screenshots?.some((entry) => entry.state === "observed")) userConfirmedExceptions.add("visual-evidence-explicit-button");

  return {
    schemaVersion: 2,
    redactionEnabled: session?.options?.redactionEnabled !== false,
    redactionRuleSetVersion: REDACTION_RULE_SET_VERSION,
    audit: buildRedactionAudit(data),
    captureBodies: session?.options?.captureBodies === true,
    captureConsole: session?.options?.captureConsole !== false,
    scope: (session?.targets?.length ?? session?.options?.targetTabIds?.length ?? 1) > 1 ? "selected-tabs" : "active-tab",
    localOnly: true,
    remoteUpload: false,
    policyEpochs: coverage.policy.epochs,
    states: coverage.states,
    fields,
    exportDestination: "local-device",
    userConfirmedExceptions: [...userConfirmedExceptions].sort(),
    warnings: [...new Set([...additionalWarnings, ...receiptWarnings(data, fields, coverage.policy.fields)])],
  };
}
