import { unzipSync, strFromU8 } from "fflate";

export function unzipToMap(zip: Uint8Array): Record<string, string> {
  const raw = unzipSync(zip);
  const out: Record<string, string> = {};
  for (const [path, bytes] of Object.entries(raw)) {
    out[path] = strFromU8(bytes);
  }
  return out;
}
