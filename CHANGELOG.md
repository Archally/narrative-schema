# Changelog

## [1.5.0]

- Narrative is defined by JSON Schema 2020-12 resources in `schema/v1.5/`. These cover intent, knowledge, orchestration, delivery, assurance, and presentation.
- The standalone validator checks model conformance locally. Run `npm run validate:example` to check the included synthetic deck.
- The integrity verifier checks the files in the repository against the release checksums.
