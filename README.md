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

#### Done — extension export prep

| Feature |
|---------|
| `authorId` on posts/comments in JSON and CSVs |
| Flat `csv/user-activity.csv`, `signals.json`, `signals-resolved.json` |
| Denormalized reaction context (`targetAuthorId`, `targetText`, `targetPostId`) |
| Author ID backfill + people dedupe (`facebook-identity.ts`) |
| Export-time reaction hydration pass (`runExportReactionHydration` before ZIP) |
| IndexedDB network log — per-entry GraphQL storage (128MB byte budget, 100k entry soft cap) |

#### Blocking — before confident pro/anti user classification

| # | Workstream | Layer | Priority |
|---|------------|-------|----------|
| **1** | **Stance labeling** — `causeTags` enricher plumbing; Trump content classifier; write `content_labels` (cause, stance, confidence, classifier version); reactions inherit stance from labeled targets | Local CLI + export schema | Next |
| **2** | **Processing pipeline** — `ingest export.zip` into local SQLite/DuckDB; multi-session merge by stable ids; `user_stance` rollup export with confidence and signal counts; incremental ingest | Local CLI | Next |
| **3** | **Classification readiness report** — field-level coverage in export (`coverage-report.json`): % posts/comments with `text` and `authorId`, % reactions with `targetText` and `reactionType`, tooltip vs dialog capture, `partialParse` and truncation gaps | Extension export | Next |
| **4** | **Capture completeness** — close reaction gaps (post + comment), reduce `partialParse`, surface truncation in coverage report; see [Capture completeness](#capture-completeness) below | Extension capture | Next |

#### Capture & export (extension — supports #4)

| Priority | Feature |
|----------|---------|
| Next | Comment reactions — full reactor lists on comments (not only organic dialog capture) |
| Next | Reaction type on all reactors — expand session + export hydration budgets; paginate until `reactionCount` met |
| Later | Timeline vs group detection refinements |

#### Processing pipeline (local CLI — supports #2)

Capture stays **ZIP export only**. A separate local ingest step loads exports into a database for merge, re-runs, and analytics. Raw GraphQL stays in ZIP archives; the DB stores parsed entities and labels.

| Priority | Feature |
|----------|---------|
| Next | `ingest export.zip` — idempotent import into local SQLite (or DuckDB) |
| Next | Multi-session merge — upsert posts, comments, reactions, and people by stable ids across captures |
| Next | `content_labels` table — store `cause` + pro/anti/neutral stance per post/comment with classifier version |
| Next | `user_stance` rollup — per-user scores from authored content + reactions to labeled targets |
| Later | Incremental ingest — process only new exports since last run |

See [docs/architecture.md](docs/architecture.md#classification-pipeline) for the full data flow.

#### Classification (supports #1)

| Priority | Feature |
|----------|---------|
| Next | `causeTags` on posts/comments in `group-activity.json`; Trump as first `cause` |
| Next | User stance export artifact (`user-stance.csv`) with confidence and signal counts |

### Capture completeness

Gaps that block reliable reaction-based classification (#4 on the blocking list):

- Post reactions often tooltip-only unless the reactions dialog was opened or hydration ran
- Comment reactors sparse unless comment `feedbackId` was captured and hydration targeted the comment
- `partialParse` posts and comment threads missing text
- Network ring buffer truncation (`health.truncation.network`) drops GraphQL bodies

**Planned fixes:** coverage-driven hydration (prioritize under-covered posts/comments), raise export hydration budgets with a hard request cap, paginate reactor lists until `captured >= reactionCount`, backfill missing post text from partial JSON, and feed all gaps into `coverage-report.json`.

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
| `csv/*.csv` | `posts.csv`, `comments.csv`, `reactions.csv`, `people.csv`, `members.csv`, `user-activity.csv` |
| `signals.json` | Flat user-activity signals (all rows) |
| `signals-resolved.json` | Signals with stable `userId` only (for user rollup) |
| `coverage-report.json` | *(planned)* Field-level classification readiness stats |

## Module layout

```
src/
  capture/        Session manager, debugger CDP, GraphQL body capture, webRequest fallback
  redaction/      Configurable rules + default-deny sensitive keys
  persistence/    storage.local (session meta) + IndexedDB (network), MV3 recovery
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
| `storage` | Session metadata (small) |
| `unlimitedStorage` | Large GraphQL capture in IndexedDB |
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
