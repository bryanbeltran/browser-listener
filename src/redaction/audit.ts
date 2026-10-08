import type { RedactionAudit, SessionData } from "../shared/types.js";

export const REDACTION_AUDIT_SCHEMA_VERSION = 1 as const;
export const REDACTED_VALUE = "[REDACTED]";

function redactedValues(value: unknown): number {
  if (typeof value === "string") {
    return value.split(REDACTED_VALUE).length - 1;
  }
  if (Array.isArray(value)) return value.reduce((total, item) => total + redactedValues(item), 0);
  if (value && typeof value === "object") {
    return Object.values(value).reduce((total, item) => total + redactedValues(item), 0);
  }
  return 0;
}

function hasRedaction(value: unknown): boolean {
  return redactedValues(value) > 0;
}

export function buildRedactionAudit(data: SessionData): RedactionAudit {
  if (data.session?.options?.redactionEnabled === false) {
    return { schemaVersion: REDACTION_AUDIT_SCHEMA_VERSION, redactedValues: 0, redactedRecords: 0 };
  }

  const records = [
    ...data.network,
    ...data.navigation,
    ...data.console,
    ...(data.markers ?? []),
    ...(data.contextSnapshots ?? []),
    ...(data.performanceSignals ?? []),
  ];
  return {
    schemaVersion: REDACTION_AUDIT_SCHEMA_VERSION,
    redactedValues: redactedValues(data),
    redactedRecords: records.filter(hasRedaction).length,
  };
}
