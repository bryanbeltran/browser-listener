# Browser Listener schemas

These schemas describe the stable, machine-readable contract consumed by the inspector and bundle SDK.

## Compatibility

- Manifest schema `4` and coverage schema `4` are the current export contract.
- Version `3` manifests and coverage reports remain readable as legacy exports.
- Version `2` manifests and coverage reports remain readable by the inspector as legacy current exports.
- Consumers must ignore unknown optional fields and reject unsupported required schema versions.
- Raw artifacts are immutable. A migration creates derived data; it never rewrites a source ZIP.
- `raw.har` follows HAR 1.2 with Browser Listener metadata under `_browserListener`.
- `raw-console.json` and report metadata use their own schema versions so derived views can evolve independently.

The schemas intentionally allow extension fields where the capture contract is expected to grow. Semantic changes that make an existing required field mean something different require a new schema version and a migration note.
