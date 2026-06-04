# Browser Listener

Chrome Extension (Manifest V3) that captures page debug data: console logs and network **metadata**, with a path to add page archives later.

## Stack

- TypeScript
- Vite (multi-entry build: background, content, popup)
- `chrome.storage.local` for persistence
- JSON export via `chrome.downloads`

No backend, auth, or analytics.

## Project layout

```
manifest.json
src/
  background/     Service worker, network listeners, message hub
  content/        Console wrapping, forwards logs to background
  popup/          Start / stop / export / clear UI
  shared/         Types, storage, messages, export helpers
  page-capture/   Stub for future MHTML / archive export
```

## Development

```bash
npm install
npm run dev      # watch build → dist/
npm run build    # production build + copy manifest
npm run typecheck
```

Load unpacked: **chrome://extensions** → Developer mode → **Load unpacked** → select the `dist/` folder.

After install or rebuild, **reload tabs** you want to capture so the content script runs.

## Popup actions

| Action        | Behavior |
|---------------|----------|
| Start capture | Creates a session; content scripts wrap `console.*`; background records network metadata |
| Stop capture  | Ends session; restores original console |
| Export logs   | Downloads JSON (`ExportPayload`) via the downloads API |
| Clear logs    | Empties console/network arrays; keeps session metadata |

## Console capture

The content script (at `document_start`) wraps `console.log`, `info`, `warn`, `error`, and `debug`. Each call:

1. Invokes the original method (behavior preserved)
2. Serializes arguments to strings
3. Sends a normalized `ConsoleEntry` to the background when capture is active

## Network capture

Implemented in `src/background/network-capture.ts` using **`chrome.webRequest`** listeners:

- `onBeforeRequest` — URL, method, resource type, tab
- `onBeforeSendHeaders` — request headers (extra permission)
- `onHeadersReceived` — status, response headers
- `onCompleted` / `onErrorOccurred` — final status, cache, errors

Entries are merged by `requestId` and stored as `NetworkEntry`.

### API limits (important)

| Available | Not available (without other APIs) |
|-----------|-----------------------------------|
| URL, method, status, header names/values, timing, tab, IP, cache flag | **Response body**, request body bytes, WebSocket frame payloads |
| Observed traffic in tabs with host access | Full HAR identical to DevTools Network panel |

**We do not fake body capture.** Export only includes metadata.

### Future: richer network / page data

Structure allows adding later without rewriting storage:

- **`chrome.debugger`** — attach per tab, CDP `Network.*` (heavier UX, “debugging” banner)
- **DevTools extension** — `chrome.devtools.network` in a devtools panel only
- **Page archive** — see `src/page-capture/index.ts`

## Page capture (stub)

`chrome.pageCapture.saveAsMHTML` can save the current tab as MHTML when permitted (`activeTab` / host access). Limits:

- DOM snapshot at save time; not a full network recording
- Cross-origin iframe content may be incomplete
- Large pages → large files; should be explicit user action

`saveTabAsMhtml()` is stubbed; export JSON includes a `pageCapture` note field.

## Export format

See `ExportPayload` in `src/shared/types.ts`: session, `console[]`, `network[]`, and `pageCapture` stub metadata.

## Permissions

- `storage`, `downloads`, `tabs`, `webRequest`
- `host_permissions`: `<all_urls>` (network + content on all pages)

Review and narrow host permissions before publishing to a store.
