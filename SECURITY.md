# Security policy

Browser Listener is a local-first evidence collector. It is deliberately not a
security guarantee: an explicit redaction opt-out, a broad capture scope, or a
user-shared ZIP can contain secrets.

## Threat model and controls

- Capture starts only after an explicit user action and consent statement.
- The extension has no upload endpoint, telemetry, account integration, or
  broad host permission.
- Redaction is enabled by default, applied before persistence and again at
  export, and recorded in the manifest. Custom rules cannot remove built-in
  rules.
- Bodies, visual evidence, replay, and integrations are opt-in features; the
  current core captures no screenshots, microphone, camera, or DOM snapshot.
- The SDK and inspector treat `report.html` and captured content as inert data;
  they never execute archive entries.
- ZIP readers enforce entry, expanded-size, path, and expansion-ratio limits.
- Synthetic canary, malformed-event, checksum, and archive-safety tests run in
  CI. Every downloaded bundle remains under the user's control.

## Reporting a vulnerability

Please use GitHub's **Report a vulnerability** flow in the repository's
Security tab for suspected vulnerabilities. Do not include real credentials,
cookies, private URLs, or unredacted bundles in a public issue. If private
reporting is unavailable, open a minimal issue asking for a private contact
channel and include only a sanitized description and reproduction steps.

Reports should include the affected version or commit, a minimal synthetic
reproduction, impact, and any proposed mitigation. The maintainers will
coordinate disclosure after a fix or mitigation is available.
