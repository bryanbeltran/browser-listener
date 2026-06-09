import {
  DEFAULT_OBJECT_SENSITIVE_KEYS,
  DEFAULT_SENSITIVE_KEYS,
  DEFAULT_URL_PARAM_KEYS,
} from "./defaults.js";
import type { RedactionConfig } from "../shared/types.js";

export const REDACTED = "[REDACTED]";

const DEFAULT_CONFIG: RedactionConfig = {
  sensitiveKeys: [...DEFAULT_SENSITIVE_KEYS],
  urlParamKeys: [...DEFAULT_URL_PARAM_KEYS],
  customRules: [],
};

const objectSensitiveKeys: string[] = [...DEFAULT_OBJECT_SENSITIVE_KEYS];

let config: RedactionConfig = { ...DEFAULT_CONFIG };

export function setRedactionConfig(partial: Partial<RedactionConfig>): void {
  config = {
    sensitiveKeys: partial.sensitiveKeys ?? config.sensitiveKeys,
    urlParamKeys: partial.urlParamKeys ?? config.urlParamKeys,
    customRules: partial.customRules ?? config.customRules,
  };
}

export function getRedactionConfig(): RedactionConfig {
  return config;
}

export function resetRedactionConfig(): void {
  config = {
    sensitiveKeys: [...DEFAULT_SENSITIVE_KEYS],
    urlParamKeys: [...DEFAULT_URL_PARAM_KEYS],
    customRules: [],
  };
}

/** Header/cookie names — allow substring match (e.g. x-authorization-token). */
function isSensitiveHeaderName(name: string): boolean {
  const lower = name.toLowerCase();
  return config.sensitiveKeys.some((k) => lower.includes(k.toLowerCase()));
}

/** Object field names — exact match only (avoid redacting sessionId, etc.). */
function isSensitiveObjectKey(name: string): boolean {
  const lower = name.toLowerCase();
  return objectSensitiveKeys.some((k) => lower === k.toLowerCase());
}

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
    return redactString(u.toString());
  } catch {
    return redactString(url);
  }
}

export function redactHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!headers) return undefined;
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    out[name] = isSensitiveHeaderName(name) ? REDACTED : redactString(value);
  }
  return out;
}

function looksSensitiveValue(value: string): boolean {
  const lower = value.toLowerCase();
  if (DEFAULT_SENSITIVE_KEYS.some((k) => lower.includes(k))) return true;
  if (/bearer\s+[a-z0-9._-]+/i.test(value)) return true;
  if (/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/.test(value)) return true;
  return false;
}

export function redactSensitiveString(value: string): string {
  if (looksSensitiveValue(value)) return REDACTED;
  return redactString(value);
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
  return redactString(out.slice(0, 50_000));
}

export function redactDeep<T>(value: T): T {
  if (value == null) return value;
  if (typeof value === "string") return redactString(value) as T;
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
