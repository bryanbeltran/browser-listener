# Sample export fixture

Synthetic session data for reviewers who will not load the Chrome extension.

- **Source:** `tests/fixtures/sample-session.ts` → `buildZipFromSessionData()`
- **E2E tests:** `tests/e2e/export-pipeline.test.ts` validates ZIP layout and privacy flags
- **No secrets** — safe to commit

Generated ZIP contains `report.html`, `raw.har`, `raw-console.json`, and
`export-manifest.json`.

To regenerate a ZIP locally:

```bash
npm test -- tests/e2e/export-pipeline.test.ts
```
