# Browser Listener

[![CI](https://github.com/bryanbeltran/browser-listener/actions/workflows/ci.yml/badge.svg)](https://github.com/bryanbeltran/browser-listener/actions/workflows/ci.yml)

Browser Listener is a local-first Chrome extension for recording browser sessions into portable bug-reproduction and evidence bundles.

Start capture only after explicit user activation, reproduce a problem, stop capture, and receive a redacted ZIP by default. No upload. No telemetry. Capture only pages and data you are authorized to collect.

## Why it is useful

- Network timeline with request and response metadata.
- Optional response/request bodies for safe JSON and text MIME types.
- Browser navigation history.
- Console logs, runtime exceptions, and browser log entries.
- Pause/resume controls with recorded pause intervals.
- Fixed capture profiles: Metadata only, Network + console, or opt-in Safe bodies.
- URL include/exclude and response-MIME filters recorded in the session policy.
- One-request body capture for narrowly investigating a request while bodies remain off.
- Bounded storage with visible truncation and debugger health gaps.
- Offline HTML report plus raw HAR and console artifacts.
- Explicit, optional screenshots with bounded local storage and manifest warnings.
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
| `raw.har` | Standard HAR 1.2 network log; redacted by default, with opt-in bounded bodies |
| `raw-console.json` | Console, exception, and browser log records; redacted by default |
| `export-manifest.json` | Version, privacy flags, capture options, artifact list, coverage, and health snapshot |

An export may also contain `screenshots/<id>.png` files when the user explicitly
requests screenshots during capture. These are optional opaque PNG artifacts;
they are listed in the manifest and are not text-redacted.

Redaction is enabled by default before persistence and again at export. The popup stores an explicit opt-out for future sessions and warns that exports may contain secrets when disabled. Body capture is off by default. When enabled, only JSON/text-like MIME types are eligible, each body is capped at 256 KiB, and session body storage is capped at 4 MiB.
URL filters are applied before network entries are retained, and MIME filters are
applied when response metadata arrives. The policy and filtered-request count are
included in coverage. The explicit one-request control overrides the normal
body-capture opt-in for one in-scope request, while safe MIME and byte budgets
still apply.

## Core flow

1. Popup grants explicit capture intent and lets the user select the current tab plus any additional HTTP(S) tabs through `activeTab`/`tabs`.
2. Service worker validates every selected tab, snapshots capture options including redaction state, then creates session metadata and attaches CDP independently to each target.
3. The selected profile fixes capture scope for the session; CDP records network lifecycle, optional safe bodies, navigation updates, console events, exceptions, and browser log entries for selected targets. URL/MIME filters narrow network evidence, and pause temporarily suspends evidence capture while preserving the session. Screenshots and one-request body capture require separate explicit actions.
4. Storage keeps network data in IndexedDB and low-volume evidence in bounded local storage.
5. Stop detaches CDP, snapshots health, builds four artifacts, and downloads ZIP locally.

## Privacy and permissions

Capture has no broad host permissions and no remote service. `activeTab` and the explicit tab picker scope user-triggered access to selected pages. Redaction defaults on and covers sensitive headers, cookies, tokens, URL parameters, bodies, console values, and configured patterns. Users can explicitly disable it for a session; the popup warns before capture.

| Permission | Purpose |
|------------|---------|
| `storage` | Session metadata and bounded auxiliary evidence |
| `unlimitedStorage` | IndexedDB network budget |
| `downloads` | Local ZIP download |
| `activeTab` | Explicit user-activated current-tab access |
| `tabs` | Enumerate and validate explicitly selected tabs |
| `debugger` | CDP capture while the session is active |

Chrome displays its debugger warning while capture is active. MV3 service-worker restarts and debugger detaches are recovered when possible and recorded in session health.

## Limits and completeness

- Network: 128 MiB byte budget and 100,000-entry soft cap; oldest entries evict first.
- Navigation: 2,000 entries per session.
- Console: 5,000 entries per session.
- Request/response bodies: opt-in, safe MIME types, 256 KiB per body, 4 MiB per session.
- Screenshots: explicit only, newest 12 entries, 8 MiB total; PNG bytes are opaque and not text-redacted.
- Exports are observational captures, not guaranteed complete copies of a page.
- `export-manifest.json` records field coverage, truncation, body skips, persistence errors, and debugger gaps.
- Coverage records the capture policy and every pause interval so user-controlled gaps are explicit.
- Treat opt-out exports as sensitive because HAR bodies and console records may contain secrets.

## Repository layout

```text
src/
  capture/        Session lifecycle, CDP capture, filters, body policy, stop/export flow
  background/     MV3 service worker and tab lifecycle
  persistence/    Metadata, preferences, bounded evidence storage, IndexedDB network store, recovery
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
