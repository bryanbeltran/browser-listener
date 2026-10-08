import { REDACTION_RULE_SET_VERSION, redactDeep } from "./engine.js";

export const REDACTION_PREVIEW_SCHEMA_VERSION = 1 as const;

export interface RedactionPreviewExample {
  name: string;
  input: unknown;
  output: unknown;
  redacted: boolean;
}

export interface RedactionPreview {
  schemaVersion: 1;
  ruleSetVersion: string;
  synthetic: true;
  examples: RedactionPreviewExample[];
  note: string;
}

/** Use only synthetic canaries; this function never reads the active session. */
export function buildRedactionPreview(): RedactionPreview {
  const examples: Array<{ name: string; input: unknown }> = [
    {
      name: "Sensitive headers",
      input: { requestHeaders: { Authorization: "Bearer synthetic-token", Cookie: "session=synthetic" } },
    },
    {
      name: "Sensitive URL parameters",
      input: { url: "https://example.invalid/problem?access_token=synthetic-token&view=summary" },
    },
    {
      name: "JSON and form values",
      input: { requestBody: JSON.stringify({ user: "demo", password: "synthetic-password" }), responseBody: "token=synthetic-token&ok=true" },
    },
    {
      name: "High-confidence secret shapes",
      input: { text: "sk_live_synthetic_key_1234567890", privateKey: "-----BEGIN PRIVATE KEY----- synthetic -----END PRIVATE KEY-----" },
    },
    {
      name: "Console and stack text",
      input: { text: "request failed with Bearer synthetic-token", stackTrace: "at demo (https://example.invalid/app.js:1:1)" },
    },
  ];
  return {
    schemaVersion: REDACTION_PREVIEW_SCHEMA_VERSION,
    ruleSetVersion: REDACTION_RULE_SET_VERSION,
    synthetic: true,
    examples: examples.map(({ name, input }) => {
      const output = redactDeep(input);
      return {
        name,
        input,
        output,
        redacted: JSON.stringify(output) !== JSON.stringify(input),
      };
    }),
    note: "Examples are synthetic canaries. A preview demonstrates configured rules; it is not a guarantee that an opt-out export is safe.",
  };
}
