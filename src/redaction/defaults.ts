/** Header/cookie/param names (substring match). */
export const DEFAULT_SENSITIVE_KEYS = [
  "authorization",
  "cookie",
  "set-cookie",
  "token",
  "access_token",
  "refresh_token",
  "id_token",
  "api_key",
  "apikey",
  "password",
  "secret",
  "session",
  "jwt",
  "bearer",
  "x-api-key",
  "x-auth-token",
] as const;

/** Object field names (exact match only — excludes structural keys like top-level `session`). */
export const DEFAULT_OBJECT_SENSITIVE_KEYS = [
  "authorization",
  "cookie",
  "set-cookie",
  "token",
  "access_token",
  "refresh_token",
  "id_token",
  "api_key",
  "apikey",
  "password",
  "secret",
  "jwt",
  "bearer",
] as const;

export const DEFAULT_URL_PARAM_KEYS = [
  "token",
  "access_token",
  "api_key",
  "password",
  "secret",
  "session",
  "auth",
  "jwt",
] as const;
