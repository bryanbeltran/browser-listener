/** Capture only ordinary web pages. Chrome internal pages remain out of scope. */
export function isCaptureableUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/** Validate and canonicalize an explicit HTTP(S) origin allowlist. */
export function normalizeOriginAllowlist(value: unknown): string[] | undefined {
  if (value == null) return undefined;
  if (!Array.isArray(value)) throw new Error("Origin allowlist must be an array");
  const origins = value.map((candidate) => {
    if (typeof candidate !== "string" || !candidate.trim()) {
      throw new Error("Origin allowlist entries must be non-empty strings");
    }
    const parsed = new URL(candidate.trim());
    if (!isCaptureableUrl(parsed.toString()) || parsed.pathname !== "/" || parsed.search || parsed.hash) {
      throw new Error(`Origin allowlist entry is not an exact HTTP(S) origin: ${candidate}`);
    }
    return parsed.origin;
  });
  return [...new Set(origins)];
}

export function isOriginAllowed(value: string | undefined, allowedOrigins?: readonly string[]): boolean {
  if (allowedOrigins == null) return true;
  try {
    const origin = new URL(value ?? "").origin;
    return allowedOrigins.includes(origin);
  } catch {
    return false;
  }
}
