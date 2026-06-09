import { redactHeaders, redactUrl } from "../redaction/engine.js";
import type { NetworkEntry } from "../shared/types.js";

export function networkEntryToCurl(entry: NetworkEntry): string {
  const url = redactUrl(entry.url);
  const method = entry.method.toUpperCase();
  const parts = [`curl -X ${method} '${url}'`];
  const headers = redactHeaders(entry.requestHeaders);
  if (headers) {
    for (const [name, value] of Object.entries(headers)) {
      parts.push(`  -H '${name}: ${value.replace(/'/g, "'\\''")}'`);
    }
  }
  parts.push("  # Response body not included (privacy default)");
  return parts.join(" \\\n");
}
