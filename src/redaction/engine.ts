import {
  DEFAULT_OBJECT_SENSITIVE_KEYS,
  DEFAULT_SENSITIVE_KEYS,
  DEFAULT_URL_PARAM_KEYS,
} from "./defaults.js";
import type { RedactionConfig, RedactionRule } from "../shared/types.js";

export const REDACTED = "[REDACTED]";
export const REDACTION_RULE_SET_VERSION = "default-v2" as const;

const DEFAULT_CONFIG: RedactionConfig = {
  sensitiveKeys: [...DEFAULT_SENSITIVE_KEYS],
  urlParamKeys: [...DEFAULT_URL_PARAM_KEYS],
  objectSensitiveKeys: [...DEFAULT_OBJECT_SENSITIVE_KEYS],
  customRules: [],
};

function uniqueKeys(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))];
}

function validRules(rules: readonly RedactionRule[]): RedactionRule[] {
  return rules.filter((rule) => {
    if (!rule || typeof rule.pattern !== "string" || !rule.pattern) return false;
    try {
      new RegExp(rule.pattern, rule.flags);
      return true;
    } catch {
      return false;
    }
  }).map((rule) => ({
    pattern: rule.pattern,
    ...(rule.flags ? { flags: rule.flags } : {}),
    ...(rule.replacement != null ? { replacement: rule.replacement } : {}),
  }));
}

function normalizedConfig(partial: Partial<RedactionConfig> = {}): RedactionConfig {
  return {
    sensitiveKeys: uniqueKeys([...DEFAULT_SENSITIVE_KEYS, ...(partial.sensitiveKeys ?? [])]),
    urlParamKeys: uniqueKeys([...DEFAULT_URL_PARAM_KEYS, ...(partial.urlParamKeys ?? [])]),
    objectSensitiveKeys: uniqueKeys([
      ...DEFAULT_OBJECT_SENSITIVE_KEYS,
      ...(partial.objectSensitiveKeys ?? []),
    ]),
    customRules: validRules(partial.customRules ?? []),
  };
}

let config: RedactionConfig = { ...DEFAULT_CONFIG };

export function setRedactionConfig(partial: Partial<RedactionConfig>): void {
  config = normalizedConfig({
    sensitiveKeys: partial.sensitiveKeys ?? config.sensitiveKeys,
    urlParamKeys: partial.urlParamKeys ?? config.urlParamKeys,
    objectSensitiveKeys: partial.objectSensitiveKeys ?? config.objectSensitiveKeys,
    customRules: partial.customRules ?? config.customRules,
  });
}

export function getRedactionConfig(): RedactionConfig {
  return {
    sensitiveKeys: [...config.sensitiveKeys],
    urlParamKeys: [...config.urlParamKeys],
    objectSensitiveKeys: [...(config.objectSensitiveKeys ?? DEFAULT_OBJECT_SENSITIVE_KEYS)],
    customRules: config.customRules.map((rule) => ({ ...rule })),
  };
}

export function getDefaultRedactionConfig(): RedactionConfig {
  return normalizedConfig();
}

export function resetRedactionConfig(): void {
  config = normalizedConfig();
}

/** Header/cookie names — allow substring match (e.g. x-authorization-token). */
function isSensitiveHeaderName(name: string): boolean {
  const lower = name.toLowerCase();
  return config.sensitiveKeys.some((k) => lower.includes(k.toLowerCase()));
}

/** Object field names — exact match only (avoid redacting sessionId, etc.). */
function isSensitiveObjectKey(name: string): boolean {
  const lower = name.toLowerCase();
  return (config.objectSensitiveKeys ?? DEFAULT_OBJECT_SENSITIVE_KEYS).some((k) => lower === k.toLowerCase());
}

const HIGH_CONFIDENCE_SECRET_PATTERNS = [
  /-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----[\s\S]+-----END(?: [A-Z]+)? PRIVATE KEY-----/i,
  /\b(?:sk|pk)_(?:live|test)_[a-z0-9]{16,}\b/i,
  /\bgh[pousr]_[a-z0-9]{20,}\b/i,
  /\bAIza[0-9A-Za-z_-]{20,}\b/,
];

export function redactString(value: string): string {
  let out = value;
  for (const rule of config.customRules) {
    try {
      const re = new RegExp(rule.pattern, rule.flags);
      out = out.replace(re, rule.replacement ?? REDACTED);
    } catch {
      /* ignore invalid regex */
    }
  }
  return out;
}

export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.forEach((_, key) => {
      if (config.urlParamKeys.some((k) => key.toLowerCase().includes(k.toLowerCase()))) {
        u.searchParams.set(key, REDACTED);
      }
    });
    return redactSensitiveString(u.toString());
  } catch {
    return redactSensitiveString(url);
  }
}

export function redactHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!headers) return undefined;
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    out[name] = isSensitiveHeaderName(name) ? REDACTED : redactSensitiveString(value);
  }
  return out;
}

function looksSensitiveValue(value: string): boolean {
  if (/(?:authorization|cookie|set-cookie|token|access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|password|secret|session|jwt|bearer)\b\s*(?:is\s*)?(?:[:=]|\s)\s*[a-z0-9][a-z0-9._~+/=-]{2,}/i.test(value)) return true;
  if (/bearer\s+[a-z0-9._-]+/i.test(value)) return true;
  if (/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/.test(value)) return true;
  return HIGH_CONFIDENCE_SECRET_PATTERNS.some((pattern) => pattern.test(value));
}

export function redactSensitiveString(value: string): string {
  if (looksSensitiveValue(value)) return REDACTED;
  return redactString(value);
}

/** Redact structured JSON or form bodies while preserving safe fields. */
export function redactBodyText(value: string): string {
  try {
    return redactSensitiveString(JSON.stringify(redactDeep(JSON.parse(value))));
  } catch {
    const params = new URLSearchParams(value);
    if (params.size > 0 && value.includes("=")) {
      const form: Record<string, string> = {};
      params.forEach((entry, key) => {
        form[key] = entry;
      });
      return new URLSearchParams(redactDeep(form) as Record<string, string>).toString();
    }
    return redactSensitiveString(value);
  }
}

export function redactValueSummary(value: string | undefined): string | undefined {
  if (value == null) return value;
  return REDACTED;
}

export function redactHtmlSummary(html: string): string {
  let out = html;
  out = out.replace(
    /<(input|textarea)[^>]*(value|placeholder)=["'][^"']*["']/gi,
    (m) => m.replace(/(value|placeholder)=["'][^"']*["']/i, '$1="' + REDACTED + '"'),
  );
  out = out.replace(/type=["']password["']/gi, 'type="password" data-redacted="true"');
  return redactSensitiveString(out.slice(0, 50_000));
}

export function redactDeep<T>(value: T): T {
  if (value == null) return value;
  if (typeof value === "string") return redactSensitiveString(value) as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v)) as T;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (isSensitiveObjectKey(k)) {
        out[k] = REDACTED;
      } else if (k === "url" || k === "href" || k === "frameUrl") {
        out[k] = typeof v === "string" ? redactUrl(v) : redactDeep(v);
      } else if (k === "requestHeaders" || k === "responseHeaders") {
        out[k] = redactHeaders(v as Record<string, string>);
      } else if (k === "htmlSummary") {
        out[k] = typeof v === "string" ? redactHtmlSummary(v) : v;
      } else if (k === "valueSummary") {
        out[k] = redactValueSummary(v as string);
      } else if (k === "requestBody" || k === "responseBody") {
        out[k] = typeof v === "string" ? redactBodyText(v) : redactDeep(v);
      } else if (k === "args" && Array.isArray(v)) {
        out[k] = (v as string[]).map((a) => redactSensitiveString(String(a)));
      } else {
        out[k] = redactDeep(v);
      }
    }
    return out as T;
  }
  return value;
}
