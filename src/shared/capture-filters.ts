import type { CaptureFilters } from "./types.js";

function patternMatches(value: string, pattern: string): boolean {
  const normalizedValue = value.toLowerCase();
  const normalizedPattern = pattern.trim().toLowerCase();
  if (!normalizedPattern) return true;
  if (!normalizedPattern.includes("*") && !normalizedPattern.includes("?")) {
    return normalizedValue.includes(normalizedPattern);
  }
  const escaped = normalizedPattern.replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  // URL filters are useful both as full globs and as host/path fragments.
  // Keep wildcard patterns substring-compatible with the plain substring form.
  return new RegExp(escaped, "i").test(normalizedValue);
}

export function matchesCaptureUrl(url: string | undefined, filters: CaptureFilters | undefined): boolean {
  if (!url) return false;
  const normalized = filters ?? { urlIncludes: [], urlExcludes: [], mimeTypes: [] };
  if (normalized.urlExcludes.some((pattern) => patternMatches(url, pattern))) return false;
  return !normalized.urlIncludes.length || normalized.urlIncludes.some((pattern) => patternMatches(url, pattern));
}

export function matchesCaptureMime(contentType: string | undefined, filters: CaptureFilters | undefined): boolean {
  const allowed = filters?.mimeTypes ?? [];
  if (!allowed.length) return true;
  const mime = contentType?.split(";", 1)[0]?.trim().toLowerCase();
  if (!mime) return false;
  return allowed.some((pattern) => {
    const normalizedPattern = pattern.toLowerCase();
    if (normalizedPattern.endsWith("/*")) return mime.startsWith(`${normalizedPattern.slice(0, -1)}`);
    return mime === normalizedPattern;
  });
}

export function matchesOneRequest(url: string | undefined, pattern: string | undefined): boolean {
  return !pattern || patternMatches(url ?? "", pattern);
}
