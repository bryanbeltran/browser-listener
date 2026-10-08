import {
  getDefaultRedactionConfig,
  getRedactionConfig,
  resetRedactionConfig,
  setRedactionConfig,
} from "../redaction/engine.js";
import type { RedactionConfig } from "../shared/types.js";

export const REDACTION_PREFERENCE_KEY = "browserListenerRedactionEnabled";
export const REDACTION_CONFIG_KEY = "browserListenerRedactionConfig";
export const DEFAULT_REDACTION_ENABLED = true;

export async function readRedactionPreference(): Promise<boolean> {
  const raw = await chrome.storage.local.get(REDACTION_PREFERENCE_KEY);
  const stored = raw[REDACTION_PREFERENCE_KEY];
  return stored == null ? DEFAULT_REDACTION_ENABLED : stored !== false;
}

export async function setRedactionPreference(enabled: boolean): Promise<void> {
  await chrome.storage.local.set({ [REDACTION_PREFERENCE_KEY]: enabled });
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
