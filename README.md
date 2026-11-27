# Archally Narrative Schema

Narrative is a YAML format for modeling talks, presentations, films, and reading outlines. It connects audience goals, claims and evidence, scenes, and delivery scripts. The [JSON Schema definitions](schema/v1.7/) describe the format.

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

Explore the [worked examples](examples/README.md) and the [format and tools](docs/README.md).

[Lighthouse Ladder](examples/storyworld-linear/narrative.yaml) is a four-scene example with two characters and two story events. The [reading outline walkthrough](docs/2026-11-27-author-a-reading-outline.md) uses it to show how to track story time, visible entrances, and who holds an object. See the [1.7 migration notes](docs/2026-11-27-narrative-1-7-migration.md) for compatibility and timing requirements.

## Use it with your agent

Open this checkout as your project in Claude Code, Codex, or Cursor. Ask the Narrative modeler for help with a talk or deck and give it the model directory. When working from another project, also give it the path to this checkout.

In Claude Code or Cursor, run `/narrative-check --example` to validate the bundled deck, or replace `--example` with your model directory. In Codex, ask it to follow the [Narrative check procedure](.agents/commands/narrative-check.md) for the same example or directory. <!-- public-docs-scan:allow -->

## Licence

The schema, example, documentation, agent kit, validator and integrity tools are [Apache-2.0](LICENSE-APACHE). The model builder, next-id allocator and semantic checker are [FSL-1.1-ALv2](LICENSE-FSL): free for internal use, education, research and professional services, and each version becomes Apache-2.0 two years after release. The [licence map](LICENSE) lists every path. [Contribution terms](CONTRIBUTING.md) apply by path.

Learn more about Narrative and Archally Pro at [narrative.archally.pro](https://narrative.archally.pro).
