export function isFacebookHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return host === "facebook.com" || host.endsWith(".facebook.com");
}

export function isFacebookUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && isFacebookHost(url.hostname);
  } catch {
    return false;
  }
}
