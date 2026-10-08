import {
  getDefaultRedactionConfig,
  getRedactionConfig,
  resetRedactionConfig,
  setRedactionConfig,
} from "../redaction/engine.js";
import type { RedactionConfig, RetentionPolicy } from "../shared/types.js";

export const REDACTION_PREFERENCE_KEY = "browserListenerRedactionEnabled";
export const REDACTION_CONFIG_KEY = "browserListenerRedactionConfig";
export const DEFAULT_REDACTION_ENABLED = true;
export const RETENTION_POLICY_KEY = "browserListenerRetentionPolicy";
export const DEFAULT_RETENTION_POLICY: RetentionPolicy = {
  schemaVersion: 1,
  maxAgeMs: 30 * 24 * 60 * 60 * 1000,
  maxSessions: 10,
  maxBytes: 512 * 1024 * 1024,
};

export async function readRedactionPreference(): Promise<boolean> {
  const raw = await chrome.storage.local.get(REDACTION_PREFERENCE_KEY);
  const stored = raw[REDACTION_PREFERENCE_KEY];
  return stored == null ? DEFAULT_REDACTION_ENABLED : stored !== false;
}

export async function setRedactionPreference(enabled: boolean): Promise<void> {
  await chrome.storage.local.set({ [REDACTION_PREFERENCE_KEY]: enabled });
}

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

export function normalizeRetentionPolicy(value: unknown): RetentionPolicy {
  const candidate = value && typeof value === "object" ? value as Partial<RetentionPolicy> : {};
  return {
    schemaVersion: 1,
    maxAgeMs: positiveInteger(candidate.maxAgeMs, DEFAULT_RETENTION_POLICY.maxAgeMs),
    maxSessions: positiveInteger(candidate.maxSessions, DEFAULT_RETENTION_POLICY.maxSessions),
    maxBytes: positiveInteger(candidate.maxBytes, DEFAULT_RETENTION_POLICY.maxBytes),
  };
}

export async function readRetentionPolicy(): Promise<RetentionPolicy> {
  const raw = await chrome.storage.local.get(RETENTION_POLICY_KEY);
  return normalizeRetentionPolicy(raw[RETENTION_POLICY_KEY]);
}

export async function setRetentionPolicy(policy: Partial<RetentionPolicy>): Promise<RetentionPolicy> {
  const normalized = normalizeRetentionPolicy(policy);
  await chrome.storage.local.set({ [RETENTION_POLICY_KEY]: normalized });
  return normalized;
}

function storedConfig(value: unknown): Partial<RedactionConfig> {
  if (!value || typeof value !== "object") return {};
  const candidate = value as Partial<RedactionConfig>;
  return {
    sensitiveKeys: Array.isArray(candidate.sensitiveKeys) ? candidate.sensitiveKeys.filter((item): item is string => typeof item === "string") : undefined,
    urlParamKeys: Array.isArray(candidate.urlParamKeys) ? candidate.urlParamKeys.filter((item): item is string => typeof item === "string") : undefined,
    objectSensitiveKeys: Array.isArray(candidate.objectSensitiveKeys)
      ? candidate.objectSensitiveKeys.filter((item): item is string => typeof item === "string")
      : undefined,
    customRules: Array.isArray(candidate.customRules) ? candidate.customRules : undefined,
  };
}

export async function readRedactionConfig(): Promise<RedactionConfig> {
  const raw = await chrome.storage.local.get(REDACTION_CONFIG_KEY);
  return applyRedactionConfig(raw[REDACTION_CONFIG_KEY]);
}

export function applyRedactionConfig(value: unknown): RedactionConfig {
  resetRedactionConfig();
  setRedactionConfig(storedConfig(value));
  return getRedactionConfig();
}

export async function loadRedactionConfig(): Promise<RedactionConfig> {
  return readRedactionConfig();
}

export async function setRedactionConfigPreference(config: Partial<RedactionConfig>): Promise<RedactionConfig> {
  setRedactionConfig(config);
  const normalized = getRedactionConfig();
  await chrome.storage.local.set({ [REDACTION_CONFIG_KEY]: normalized });
  return normalized;
}

export async function resetRedactionConfigPreference(): Promise<RedactionConfig> {
  resetRedactionConfig();
  const defaults = getDefaultRedactionConfig();
  await chrome.storage.local.set({ [REDACTION_CONFIG_KEY]: defaults });
  return defaults;
}
