# Browser Listener

[![CI](https://github.com/bryanbeltran/browser-listener/actions/workflows/ci.yml/badge.svg)](https://github.com/bryanbeltran/browser-listener/actions/workflows/ci.yml)

Browser Listener is a local-first Chrome extension for recording browser sessions into portable bug-reproduction and evidence bundles.

Start capture only after explicit user activation, reproduce a problem, stop capture, and receive a redacted ZIP. No upload. No telemetry. Capture only pages and data you are authorized to collect.

## Why it is useful

- Network timeline with request and response metadata.
- Optional response/request bodies for safe JSON and text MIME types.
- Browser navigation history.
- Console logs, runtime exceptions, and browser log entries.
- Bounded storage with visible truncation and debugger health gaps.
- Offline HTML report plus raw HAR and console artifacts.
- ZIP inspector for CI, support, and local debugging workflows.

## Stack

- TypeScript + Vite (Manifest V3 service worker and popup).
- `chrome.storage.local` for session metadata and bounded navigation/console evidence.
- IndexedDB for bounded network entries.
- `chrome.debugger` CDP for network, console, runtime, and log events.
- `fflate` for local ZIP creation.
- Vitest for unit, regression, and export pipeline tests.

## Quick start

```bash
npm install
npm run verify   # lint + typecheck + test + build
```

Load `dist/` from `chrome://extensions` with Developer mode enabled. Open a normal HTTP(S) page, click the extension, confirm authorization, start capture, reproduce the issue, then stop and download the ZIP.

Inspect an export without opening Chrome or uploading the archive:

```bash
npm run inspect -- path/to/browser-listener-export.zip
npm run inspect -- path/to/browser-listener-export.zip --json
```

## ZIP contract

Every export contains exactly four required artifacts:

| File | Contents |
|------|----------|
| `report.html` | Offline searchable timeline, coverage, citation, and health view |
| `raw.har` | Standard HAR 1.2 network log with redacted metadata and opt-in bounded bodies |
| `raw-console.json` | Redacted console, exception, and browser log records |
| `export-manifest.json` | Version, privacy flags, capture options, artifact list, coverage, and health snapshot |

All export content is redacted on persistence and again at export. Body capture is off by default. When enabled, only JSON/text-like MIME types are eligible, each body is capped at 256 KiB, and session body storage is capped at 4 MiB.

## Core flow

1. Popup grants explicit capture intent for current tab through `activeTab`.
2. Service worker creates session metadata and attaches CDP debugger.
3. CDP records network lifecycle, optional safe bodies, navigation updates, console events, exceptions, and browser log entries.
4. Storage keeps network data in IndexedDB and low-volume evidence in bounded local storage.
5. Stop detaches CDP, snapshots health, builds four artifacts, and downloads ZIP locally.

## Privacy and permissions

Capture has no broad host permissions and no remote service. `activeTab` scopes user-triggered access to the current page. Sensitive headers, cookies, tokens, URL parameters, and configured patterns are redacted.

| Permission | Purpose |
|------------|---------|
| `storage` | Session metadata and bounded auxiliary evidence |
| `unlimitedStorage` | IndexedDB network budget |
| `downloads` | Local ZIP download |
| `activeTab` | Explicit user-activated current-tab access |
| `debugger` | CDP capture while the session is active |

Chrome displays its debugger warning while capture is active. MV3 service-worker restarts and debugger detaches are recovered when possible and recorded in session health.

## Limits and completeness

- Network: 128 MiB byte budget and 100,000-entry soft cap; oldest entries evict first.
- Navigation: 2,000 entries per session.
- Console: 5,000 entries per session.
- Request/response bodies: opt-in, safe MIME types, 256 KiB per body, 4 MiB per session.
- Exports are observational captures, not guaranteed complete copies of a page.
- `export-manifest.json` records field coverage, truncation, body skips, persistence errors, and debugger gaps.

## Repository layout

```text
src/
  capture/        Session lifecycle, CDP capture, body policy, stop/export flow
  background/     MV3 service worker and tab lifecycle
  persistence/    Metadata, bounded evidence storage, IndexedDB network store, recovery
  export/         Four-file ZIP orchestration, HAR, manifest, coverage
  report/         Searchable offline HTML report
  popup/          Consent, start/stop, health, and download UI
  redaction/      Default-deny redaction rules
  shared/         Types, messages, URL checks, version helpers
tests/            Unit, regression, privacy, lifecycle, and export pipeline tests
```

## Development

```bash
npm run verify
npm run dev       # watch build
```

Commits can use the repository hook to bump patch version and rebuild `dist/`; skip the bump with `SKIP_VERSION_BUMP=1` and skip post-commit build with `SKIP_POST_COMMIT_BUILD=1`.
