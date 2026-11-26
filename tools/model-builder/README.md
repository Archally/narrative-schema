# Narrative Model Builder

Builds a deterministic authored-graph JSON file (`model.json`) from a Narrative model directory or `narrative.yaml` manifest.

## Usage

From the repository root:

```sh
npm run build:model -- examples/public-deck --pretty --output build/model.json
```

Direct invocation:

```sh
node tools/model-builder/cli.mjs <path-to-model-or-manifest> [--output <file>] [--pretty] [--stats]
```

## Output

The emitted JSON contains:

- `entities`: sorted authored entities with typed IDs, plane, source `location` (`file`, `path`), all definition `occurrences`, `ambiguous` flag, and raw `data`
- `relations`: sorted, deduplicated resolved edges between uniquely defined entities, carrying `source`, `target`, `type`, `predicate`, and `occurrences`
- `occurrences`: per-ID occurrence counts (`byIdCount`), duplicate definitions, unresolved references, and ambiguous references
- `diagnostics`: pointer-level reader diagnostics without machine-local paths
- `metadata`: stable counts by entity type, plane, and relation type

## Exit codes

- `0`: model built cleanly
- `2`: invalid arguments, unreadable/unparseable manifest, or broken non-read-only plane pointer
