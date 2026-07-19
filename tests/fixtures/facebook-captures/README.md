# Facebook capture fixtures

Redacted GraphQL network entries committed for CI. Generated from local capture ZIPs via:

```bash
node scripts/build-facebook-fixtures.mjs
```

Source ZIPs are read from `~/Downloads/browser-listener-*.zip` (not committed). Request session tokens (`__user`, `fb_dtsg`, `lsd`, etc.) and sensitive headers are redacted before write.

| File | Scenario |
|------|----------|
| `comments-dialog.json` | Single-post dialog with comments and tooltip-only reactions |
| `reactions-dialog.json` | Feed + post dialog with photo attachment and full reactions dialog |
| `permalink.json` | Permalink session with partial JSON parse warnings |
| `feed.json` | Group feed with member hovercards and member count |
