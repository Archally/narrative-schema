# Narrative Next ID

Suggests the next available three-digit identifier for a schema-backed Narrative entity prefix from a built `model.json` snapshot.

## Usage

First build `model.json`, then query the next ID:

```sh
npm run build:model -- examples/public-deck --output build/model.json
npm run next-id -- build/model.json CLM
```

Direct invocation:

```sh
node tools/next-id/cli.mjs <model.json> <PREFIX>
node tools/next-id/cli.mjs --list
```

## Snapshot semantics

Each call is read-only and computes `max + 1` (or `001` when unused) from the authored `entities` array in the given `model.json` snapshot. Reference-only IDs are ignored, gaps are never filled, and prefixes exhaust at `999`.

Because the command reads a static snapshot without locking, concurrent edits require rebuilding `model.json` before requesting another ID.

## Exit codes

- `0`: suggested ID (or prefix list) written to stdout
- `2`: usage error, unknown or reserved prefix, unreadable or malformed `model.json`, or range exhausted at `999`
