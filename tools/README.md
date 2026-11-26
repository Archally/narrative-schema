# Narrative tools

Run these commands from the repository root with Node.js 22 or newer and dependencies installed with `npm ci`.

| Command | Purpose |
| --- | --- |
| `npm run validate:example` | Check the included deck model. |
| `npm run validate -- --model path/to/model` | Check the model directory containing `narrative.yaml` against the included schema. |
| `npm run build:model -- examples/public-deck --pretty --output /tmp/public-deck.model.json` | Build a deterministic authored-graph `model.json` snapshot. |
| `npm run next-id -- /tmp/public-deck.model.json CLM` | Suggest the next available ID for a schema-backed prefix from a built `model.json` snapshot. |
| `npm run check:semantic:example` | Run all eight semantic rules against the included deck model in strict mode. |
| `npm run check:semantic -- path/to/model` | Run the semantic checker against a model directory, manifest, or built `model.json`. |
| `npm run port:verify` | Check the repository files against the release checksums. |
| `npm run release:check` | Check agreement between the package version, schema version, and release files. |

See [tool licences](LICENSE).
