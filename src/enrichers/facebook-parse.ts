/** Shared parsers for Facebook GraphQL bodies (multi-line, truncated, Comet shapes). */

const NOISE_TEXT =
  /^(Public group|Your group suggestions|\d+K? members|.*posts a day|.*is a member|Ian Holmes)/i;

export function decodeFeedbackPostId(feedbackId?: string): string | undefined {
  if (!feedbackId) return undefined;
  try {
    const decoded = atob(feedbackId);
    const m = decoded.match(/^feedback:(\d+)$/);
    return m?.[1];
  } catch {
    return undefined;
  }
}

export function unescapeJsonString(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return raw.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
}

export function isNoisePostText(text: string): boolean {
  const t = text.trim();
  if (t.length < 12) return true;
  if (NOISE_TEXT.test(t)) return true;
  if (/^\d+K? members/i.test(t)) return true;
  return false;
}

export function parseGraphqlLines(raw: string): { parsed: unknown[]; partialLines: number } {
  const parsed: unknown[] = [];
  let partialLines = 0;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      parsed.push(JSON.parse(trimmed));
    } catch {
      partialLines += 1;
    }
  }
  return { parsed, partialLines };
}

/** Extract story message text from partial / truncated JSON lines. */
export function extractStoryTextsFromPartialJson(raw: string): string[] {
  const texts: string[] = [];
  const seen = new Set<string>();
  for (const chunk of raw.split('"story":').slice(1)) {
    const m = chunk.match(/"message"\s*:\s*\{[^}]*"text"\s*:\s*"((?:\\.|[^"\\])*)"/);
    if (!m) continue;
    const text = unescapeJsonString(m[1]).trim();
    if (isNoisePostText(text) || seen.has(text)) continue;
    seen.add(text);
    texts.push(text);
  }
  return texts;
}

/** Extract comments from partial JSON via typename + message.text. */
export function extractCommentsFromPartialJson(
  raw: string,
): { id?: string; text: string }[] {
  const out: { id?: string; text: string }[] = [];
  const seen = new Set<string>();
  const re =
    /"__typename"\s*:\s*"Comment"[^}]*"id"\s*:\s*"([^"]+)"[^}]*"message"\s*:\s*\{[^}]*"text"\s*:\s*"((?:\\.|[^"\\])*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const text = unescapeJsonString(m[2]).trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push({ id: m[1], text });
  }
  return out;
}

export function permalinkPostId(tabUrl?: string): string | undefined {
  if (!tabUrl) return undefined;
  const m = tabUrl.match(/\/permalink\/(\d+)/);
  return m?.[1];
}

export function groupPermalinkUrl(groupUrl: string | undefined, postId: string): string | undefined {
  if (!groupUrl) return undefined;
  const base = groupUrl.replace(/\/$/, "");
  if (base.includes("/groups/")) {
    return `${base}/permalink/${postId}/`;
  }
  return undefined;
}
