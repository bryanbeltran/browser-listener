# Browser Listener

[![CI](https://github.com/bryanbeltran/browser-listener/actions/workflows/ci.yml/badge.svg)](https://github.com/bryanbeltran/browser-listener/actions/workflows/ci.yml)

Privacy-first Chrome extension for **collecting and organizing Facebook data while you browse**. Start a session, scroll groups or your timeline, open posts, and export a local ZIP with structured posts, comments, reactions, and people — no upload, no telemetry.

- **Posts** — author, text, media, where found (group feed, timeline, profile/page)
- **Comments** — text linked to parent post and author
- **Reactions** — who reacted to posts (type when available: Like, Love, etc.)
- **People** — authors and reactors encountered in the session

Planned: richer reaction capture, local DB ingest for multi-session processing, and pro/anti cause tagging (Trump first) with per-user stance rollup.

All capture is consent-gated, stored locally, and redacted before export. Optional screen/audio/static-body capture remains **off by default** (stubs).

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

Reload the target tab after install. Open Facebook (group feed, timeline, or a post), click the extension icon, check consent, **Start capture**, browse normally, then **Stop and export ZIP**.

## Facebook workflow

1. **Start capture** on a Facebook tab (group, home feed, or permalink).
2. **Browse** — scroll feeds, open post dialogs, expand comments, open reaction lists when you want full reactor names.
3. **Stop and export** — ZIP includes `group-activity.json`, CSVs, `graphql-captures.json`, and an offline HTML report.

### What we extract today

| Entity | Fields |
|--------|--------|
| **Post** | text, author, URL, post id, group/timeline context, linked comments & post reactions |
| **Comment** | text, author, parent post id (from GraphQL + CommentList fallback) |
| **Reaction** | user, post id, reaction type when dialog captured |
| **Group** | name, id, URL when seen in GraphQL |

### Roadmap

#### Capture & export (extension)

| Priority | Feature |
|----------|---------|
| Next | Comment reactions — who reacted to each comment |
| Next | Reaction type on all reactors (not only reactions dialog); expand reaction hydration before export |
| Next | Classification readiness report — field-level coverage stats in export (`trace-summary` or `coverage-report.json`) |
| Next | Stable user identity — `authorId` on all posts/comments; include in CSVs |
| Next | Flat `user-activity` export — one row per post, comment, or reaction for downstream processing |
| Next | Denormalized reaction context — target author, text snapshot, and post/comment ids on reaction rows |
| Later | Timeline vs group detection refinements |

#### Processing pipeline (local CLI, outside the extension)

Capture stays **ZIP export only**. A separate local ingest step loads exports into a database for merge, re-runs, and analytics. Raw GraphQL stays in ZIP archives; the DB stores parsed entities and labels.

| Priority | Feature |
|----------|---------|
| Next | `ingest export.zip` — idempotent import into local SQLite (or DuckDB) |
| Next | Multi-session merge — upsert posts, comments, reactions, and people by stable ids across captures |
| Next | `content_labels` table — store `cause` + pro/anti/neutral stance per post/comment with classifier version |
| Later | `user_stance` rollup — per-user scores from authored content + reactions to labeled targets |
| Later | Incremental ingest — process only new exports since last run |

See [docs/architecture.md](docs/architecture.md#classification-pipeline) for the full data flow.

#### Classification (after prerequisites above)

| Priority | Feature |
|----------|---------|
| Next | `causeTags` enricher plumbing — schema wired through export; Trump as first `cause` |
| Later | User stance export artifact (`user-stance.csv`) with confidence and signal counts |

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
| `export-manifest.json` | Artifact list, privacy flags, capture health |
| `group-activity.json` | Structured Facebook posts, comments, reactions, people |
| `graphql-captures.json` | Raw Facebook `/api/graphql` bodies (parser debug archive) |
| `csv/*.csv` | `posts.csv`, `comments.csv`, `reactions.csv`, `people.csv`, `members.csv` |

## Module layout

```
src/
  capture/        Session manager, debugger CDP, GraphQL body capture, webRequest fallback
  redaction/      Configurable rules + default-deny sensitive keys
  persistence/    Storage + MV3 service-worker recovery
  export/         ZIP orchestration, CSV, graphql-captures
  report/         Facebook-focused HTML report
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

Facebook parsing runs automatically at export via `src/enrichers/facebook-groups.ts`. Register additional enrichers in `src/enrichers/index.ts` (e.g. future cause-tagging).

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
| `debugger` | CDP network capture for GraphQL (shows debugging banner) |
| `webRequest` | Metadata fallback |
| `webNavigation` | Track tab URL during capture |
| `<all_urls>` host | Capture on Facebook tabs (narrow before store publish) |

## API limits

- GraphQL bodies only on `facebook.com` paths (full response stored; subject to `chrome.storage` quota).
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
