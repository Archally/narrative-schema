# Archally Narrative Schema

Narrative is a YAML format for modeling talks, presentations, and films. It connects audience goals, claims and evidence, scenes, and delivery scripts. The [JSON Schema definitions](schema/v1.6/) describe the format.

## Quickstart

With Node.js 22 or newer, clone the repository and install its dependencies.

```sh
git clone https://github.com/Archally/narrative-schema.git
cd narrative-schema
npm ci
npm run validate:example
npm run build:model -- examples/public-deck --pretty --output /tmp/public-deck.model.json
npm run next-id -- /tmp/public-deck.model.json CLM
npm run check:semantic:example
```

Explore the [worked example](examples/README.md) and the [format and tools](docs/README.md).

## Use it with your agent

Open this checkout as your project in Claude Code, Codex, or Cursor. Ask the Narrative modeler for help with a talk or deck and give it the model directory. When working from another project, also give it the path to this checkout.

In Claude Code or Cursor, run `/narrative-check --example` to validate the bundled deck, or replace `--example` with your model directory. In Codex, ask it to follow the [Narrative check procedure](.agents/commands/narrative-check.md) for the same example or directory. <!-- public-docs-scan:allow -->

## Licence

The schema, example, documentation, agent kit, validator and integrity tools are [Apache-2.0](LICENSE-APACHE). The model builder, next-id allocator and semantic checker are [FSL-1.1-ALv2](LICENSE-FSL): free for internal use, education, research and professional services, and each version becomes Apache-2.0 two years after release. The [licence map](LICENSE) lists every path. [Contribution terms](CONTRIBUTING.md) apply by path.

Learn more about Narrative and Archally Pro at [narrative.archally.pro](https://narrative.archally.pro).
