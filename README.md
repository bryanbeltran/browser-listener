# Browser Listener

[![CI](https://github.com/bryanbeltran/browser-listener/actions/workflows/ci.yml/badge.svg)](https://github.com/bryanbeltran/browser-listener/actions/workflows/ci.yml)

Privacy-first Chrome extension for **creating portable, searchable Facebook session archives**. Start a session on Facebook, browse normally, and export a local ZIP with structured posts, comments, reactions, provenance, and capture health — no upload, no telemetry.

- **Posts** — author, text, media, where found (group feed, timeline, profile/page)
- **Comments** — text linked to parent post and author
- **Reactions** — who reacted to posts (type when available: Like, Love, etc.)
- **People** — authors and reactors encountered in the session

Planned: richer reaction capture, local inspection/ingest tools, and additional archive workflows.

Capture starts only after an explicit user action, is limited to Facebook hosts, stored locally, and redacted before export. Use it only for pages and data you are authorized to capture. Optional screen/audio/static-body capture remains **off by default** (stubs).

## Stack

- TypeScript + Vite (multi-entry: background, content, popup)
- `chrome.storage.local` session metadata + popup snapshot
- IndexedDB network log (append per entry; 128MB byte budget, 100k entry soft cap per session)
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

Inspect an export without opening the extension or uploading the archive:

```bash
npm run inspect -- path/to/browser-listener-export.zip
npm run inspect -- path/to/browser-listener-export.zip --json
```

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

Reload the target tab after install. Open Facebook (group feed, timeline, or a post), click the extension icon, confirm the permission checkbox, choose **Start capture**, browse normally, then **Stop and export ZIP**.

## Facebook workflow

1. **Start capture** on a Facebook tab (group, home feed, or permalink).
2. **Browse** — scroll feeds, open post dialogs, expand comments, open reaction lists when you want full reactor names.
3. **Stop and export** — ZIP includes `group-activity.json`, CSVs, `graphql-captures.json`, `coverage-report.json`, and an offline HTML report with search and citation tools.

### What we extract today

| Entity | Fields |
|--------|--------|
| **Post** | text, author, URL, post id, group/timeline context, linked comments & post reactions |
| **Comment** | text, author, parent post id (from GraphQL + CommentList fallback) |
| **Reaction** | user, post id, reaction type when dialog captured |
| **Group** | name, id, URL when seen in GraphQL |

### Roadmap

#### Done — extension export prep

| Feature |
|---------|
| `authorId` on posts/comments in JSON and CSVs |
| Flat `csv/user-activity.csv`, `signals.json`, `signals-resolved.json` |
| Denormalized reaction context (`targetAuthorId`, `targetText`, `targetPostId`) |
| Author ID backfill + people dedupe (`facebook-identity.ts`) |
| Export-time reaction hydration pass (`runExportReactionHydration` before ZIP) |
| IndexedDB network log — per-entry GraphQL storage (128MB byte budget, 100k entry soft cap) |

#### Done — trustworthy local exports

| Feature |
|---------|
| Searchable offline HTML report with source URL and copyable citation |
| `coverage-report.json` with field-level completeness and provenance |
| Local `npm run inspect -- export.zip` summary command |
| Redaction, local-only manifest, health gaps, and storage truncation in every export |
| Facebook-only host permissions and capture URL validation |

#### Next — archive quality and inspection

| Priority | Feature |
|----------|---------|
| Next | Improve coverage-driven reaction hydration and partial-parse recovery |
| Next | Add a local searchable importer for multiple authorized exports |
| Later | Add another site adapter only after the export format and privacy boundary are stable |

#### Capture & export

| Priority | Feature |
|----------|---------|
| Next | Comment reactions — full reactor lists on comments (not only organic dialog capture) |
| Next | Reaction type on all reactors — expand session + export hydration budgets; paginate until `reactionCount` met |
| Later | Timeline vs group detection refinements |

Political or other sensitive-trait inference is explicitly out of the core extension. Any future analysis must be a separate, opt-in local tool with its own privacy review.

### Capture completeness

Exports are observational archives, not guaranteed complete copies of a page. Current completeness gaps include:

- Post reactions often tooltip-only unless the reactions dialog was opened or hydration ran
- Comment reactors sparse unless comment `feedbackId` was captured and hydration targeted the comment
- `partialParse` posts and comment threads missing text
- Network ring buffer truncation (`health.truncation.network`) drops GraphQL bodies

**Planned fixes:** coverage-driven hydration (prioritize under-covered posts/comments), raise export hydration budgets with a hard request cap, paginate reactor lists until `captured >= reactionCount`, and backfill missing post text from partial JSON. Current gaps are surfaced in `coverage-report.json`.

Tips for richer exports: open the full reactions dialog (not just hover tooltip), expand comment threads, and stay on the tab until stop.

## Core flow

1. **Start capture** on a Facebook tab — debugger attaches for GraphQL network capture.
2. **Browse** — scroll feeds, open posts, expand comments and reaction dialogs.
3. **Stop and export** — detach debugger, parse GraphQL into structured data, download ZIP locally.

## ZIP contents

| File | Description |
|------|-------------|
| `report.html` | Offline Facebook session report (posts, comments, reactions) |
| `trace-summary.json` | Session duration and entity counts |
| `coverage-report.json` | Field-level completeness, provenance, and quality signals |
| `export-manifest.json` | Artifact list, privacy flags, capture health |
| `group-activity.json` | Structured Facebook posts, comments, reactions, people |
| `graphql-captures.json` | Raw Facebook `/api/graphql` bodies (parser debug archive) |
| `csv/*.csv` | `posts.csv`, `comments.csv`, `reactions.csv`, `people.csv`, `members.csv`, `user-activity.csv` |
| `signals.json` | Flat user-activity signals (all rows) |
| `signals-resolved.json` | Signals with stable `userId` only (for user rollup) |

## Module layout

```
src/
  capture/        Session manager, debugger CDP, GraphQL body capture, webRequest fallback
  redaction/      Configurable rules + default-deny sensitive keys
  persistence/    storage.local (session meta) + IndexedDB (network), MV3 recovery
  export/         ZIP orchestration, CSV, coverage, graphql-captures
  report/         Searchable offline archive report
  enrichers/      Facebook GraphQL parser (always on at export)
  background/     Service worker entry
  popup/          Start/stop + export UI
  shared/         Types and messages
tests/            Vitest regression + E2E category registry
```

## Capture details

### Network

- Primary: CDP `Network.*` via debugger with GraphQL body capture on `facebook.com`.
- Fallback: `chrome.webRequest` metadata when debugger is not attached.

## Privacy / redaction

Applied on write and again on export. Default-deny keys include: `authorization`, `cookie`, `set-cookie`, `token`, `access_token`, `refresh_token`, `id_token`, `api_key`, `password`, `secret`, `session`, `jwt`, and related patterns.

Configure via `setRedactionConfig()` in `src/redaction/engine.ts` (runtime API for future options page).

## Enrichers

Facebook parsing runs automatically at export via `src/enrichers/facebook-groups.ts`. Register additional adapters only after their capture scope and privacy behavior are documented.

## Reliability

- **Debugger detach** — health gap logged; automatic re-attach retry while session active.
- **Service worker restart** — `loadRecoverableSession()` + debugger reattach; gap recorded in `session.health.partialGaps`.
- **Partial gaps** — surfaced in export manifest and HTML report health section.

## Permissions

| Permission | Why |
|------------|-----|
| `storage` | Session metadata (small) |
| `unlimitedStorage` | Large GraphQL capture in IndexedDB |
| `downloads` | Local ZIP export only |
| `tabs` | Active tab targeting |
| `debugger` | CDP network capture for GraphQL (shows debugging banner) |
| `webRequest` | Metadata fallback |
| `webNavigation` | Track tab URL during capture |
| `https://facebook.com/*`, `https://*.facebook.com/*` | Capture authorized Facebook tabs only |

## API limits

- GraphQL bodies only on `facebook.com` paths (full response stored subject to the IndexedDB byte budget).
- Debugger banner visible while attached.
- MV3 service worker may sleep; recovery paths documented above.

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
