# Browser Listener

[![CI](https://github.com/bryanbeltran/browser-listener/actions/workflows/ci.yml/badge.svg)](https://github.com/bryanbeltran/browser-listener/actions/workflows/ci.yml)

Privacy-first Chrome Extension (Manifest V3) that records a **user-started** browser session and exports a **local ZIP** with structured traces, diagnostics, and a standalone offline investigation report.

- No capture before explicit consent
- No remote upload or telemetry
- Redaction before persistence and export
- Optional screen/audio/static-body capture **off by default** (stubs)

## Stack

- TypeScript + Vite (multi-entry: background, content, popup)
- `chrome.storage.local` session persistence
- `chrome.debugger` (CDP) + `chrome.webRequest` (metadata fallback)
- `fflate` ZIP builder
- Vitest unit/regression tests

## Quick start

```bash
npm install
npm run verify   # lint + typecheck + test + build
```

Or individually: `npm run build`, `npm run typecheck`, `npm test`, `npm run lint`

**Architecture:** [docs/architecture.md](docs/architecture.md)  
**Sample export (synthetic):** [tests/fixtures/sample-export/](tests/fixtures/sample-export/)

### Version bump + rebuild on commit

Each commit auto-bumps the **patch** version (`0.3.0` → `0.3.1`), rebuilds `dist/`, and includes `package.json` + `manifest.json` in that commit.

**One-time setup:**

```bash
npm run setup:hooks
```

Then reload the extension in **chrome://extensions** after commits (version number confirms you have the latest build).

Skip once: `SKIP_VERSION_BUMP=1 git commit ...`  
Manual bump + build: `npm run bump:build`

### Load in Chrome (important)

1. `npm run build`
2. **chrome://extensions** → enable **Developer mode**
3. **Load unpacked** → select the **`dist/`** folder (not `src/`, not the repo root)

```
~/repos/browser-listener/dist
```

If you see *"Manifest file is missing or unreadable"*, you picked the wrong folder — it must be **`dist/`** after a successful build.

Reload the target tab after install. Click the extension icon, check consent, **Start capture**, then **Stop and export ZIP**.

## Core flow

1. **Consent** — checkbox required; no recording until confirmed.
2. **Start capture** — session on active tab; debugger attach (when allowed); content scripts in **all frames**.
3. **Stop and export** — detach debugger, stop session, download ZIP locally.

## ZIP contents

| File | Description |
|------|-------------|
| `report.html` | Offline investigation report (network + console explorers, cURL copy) |
| `trace-summary.json` | Compact session summary and counts |
| `network.har` | HAR 1.2 (metadata; bodies empty unless advanced opt-in added later) |
| `timeline.json` | Raw event timeline |
| `console.json` | Console, warnings, exceptions |
| `diagnostics.json` | Frames, route, performance, DOM snapshot refs |
| `export-manifest.json` | Artifact list, privacy flags, capture health |

Optional paths (`artifacts/screen.webm`, audio, static bodies) appear in manifest only when enabled.

## Module layout

```
src/
  capture/        Session manager, debugger CDP, webRequest fallback
  content/        Console, user actions, navigation, diagnostics (per-frame)
  redaction/      Configurable rules + default-deny sensitive keys
  persistence/    Storage + MV3 service-worker recovery
  export/         HAR, cURL, ZIP orchestration
  report/         Standalone HTML generator
  enrichers/      Pluggable post-processors (empty by default)
  background/     Service worker entry
  popup/          Consent + capture UI
  shared/         Types and messages
tests/            Vitest regression + E2E category registry
```

## Capture details

### Full-tab

- Content scripts: `all_frames: true` — top frame + embedded frames.
- Cross-origin iframe internals follow Chrome isolation; CDP/debugger improves network/console across targets when attached.

### Network

- Primary: CDP `Network.*` via debugger.
- Fallback: `chrome.webRequest` metadata on the captured tab.
- **No response-body capture by default** (privacy). Advanced static-body opt-in reserved for future CDP `getResponseBody` behind a flag.

### Console / runtime

- Content: wrapped `console.*`, `error`, `unhandledrejection`.
- Debugger: `Runtime.consoleAPICalled`, `Runtime.exceptionThrown`.

### User actions

- Click, submit, input, change, `history` API, visibility.

### Page diagnostics

- Frame inventory, route state, DOM snapshots (truncated + redacted), performance resource counts.

## Privacy / redaction

Applied on write and again on export. Default-deny keys include: `authorization`, `cookie`, `set-cookie`, `token`, `access_token`, `refresh_token`, `id_token`, `api_key`, `password`, `secret`, `session`, `jwt`, and related patterns.

Configure via `setRedactionConfig()` in `src/redaction/engine.ts` (runtime API for future options page).

## Enrichers

Register optional enrichers in `src/enrichers/index.ts`. Enable per session via `CaptureOptions.enricherIds`. Keep Oracle BUI, branding, and product-specific logic **out of core**.

## Reliability

- **Debugger detach** — health gap logged; automatic re-attach retry while session active.
- **Service worker restart** — `loadRecoverableSession()` + debugger reattach; gap recorded in `session.health.partialGaps`.
- **Partial gaps** — surfaced in export manifest and HTML report health section.

## Permissions

| Permission | Why |
|------------|-----|
| `storage` | Local session persistence |
| `downloads` | Local ZIP export only |
| `tabs` | Active tab targeting |
| `debugger` | CDP console/network/runtime (shows debugging banner) |
| `webRequest` | Metadata fallback |
| `<all_urls>` host | Capture on user pages (narrow before store publish) |
| `tabCapture` (optional) | Future screen/audio opt-in |

## API limits

- Response bodies not in HAR unless future opt-in + CDP body fetch.
- Debugger banner visible while attached.
- MV3 service worker may sleep; recovery paths documented above.
- Screen/audio/static-body UI toggles disabled until implemented.

## Testing

```bash
npm test
```

Covers redaction regression, ZIP privacy leak checks, HAR/cURL, export manifest, enrichers, session recovery mocks, E2E category registry, and entrypoint/manifest checks.

## Development

```bash
npm run dev   # watch build → dist/
```

After rebuild, reload the extension and target tabs.
