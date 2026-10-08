# `@browser-listener/bundle-sdk`

Read-only helpers for Browser Listener’s four-file ZIP bundle.

The SDK parses `export-manifest.json`, `raw.har`, and `raw-console.json` without executing `report.html` or any captured content. It validates manifest references and event IDs, filters network and console records, summarizes coverage, and creates stable secret-free citations.

```ts
import { readBundle, validateBundle, filterNetwork, cite } from "@browser-listener/bundle-sdk";

const bundle = readBundle(zipBytes);
const result = validateBundle(bundle);
const failures = filterNetwork(bundle, { statusMin: 400 });
const citation = failures[0]?._browserListener?.id
  ? cite(bundle, "raw.har", failures[0]._browserListener.id)
  : undefined;
```

The package is intentionally read-only. It does not replay requests, open captured HTML, upload data, or bypass the bundle’s redaction and provenance metadata. Semver governs the package API; artifact schema compatibility is reported by `validateBundle`.
