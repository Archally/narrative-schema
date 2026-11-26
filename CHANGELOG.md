# Changelog

## [1.5.1]

- The Narrative agent kit helps you model a talk or deck in Claude Code, Codex, and Cursor.
- `next-id` suggests the next available model ID, `model-builder` builds a graph from the model's YAML files, and the semantic checker checks model quality. All three tools are licensed under FSL-1.1-ALv2.

## [1.5.0]

- Narrative is defined by JSON Schema 2020-12 resources in `schema/v1.5/`. These cover intent, knowledge, orchestration, delivery, assurance, and presentation.
- The standalone validator checks model conformance locally. Run `npm run validate:example` to check the included synthetic deck.
- The integrity verifier checks the files in the repository against the release checksums.
