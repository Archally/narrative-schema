# Narrative tools

Run these commands from the repository root with Node.js 22 or newer and dependencies installed with `npm ci`.

| Command | Purpose |
| --- | --- |
| `npm run validate:example` | Check the included deck model. |
| `npm run validate -- --model path/to/model` | Check the model directory containing `narrative.yaml` against the included schema. |
| `npm run port:verify` | Check the repository files against the release checksums. |
| `npm run release:check` | Check agreement between the package version, schema version, and release files. |

See [tool licences](LICENSE).
