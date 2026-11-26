# Narrative Conformance Validator

Standalone, zero-build Apache-2.0 conformance validator for Narrative v1 models.
Depends only on Node 22 built-ins, `ajv`, and `yaml`.

## Usage

```bash
# Validate the worked example
npm run validate:example

# Validate a model directory (positional path or --model)
npm run validate -- path/to/model
node tools/validator/cli.mjs examples/public-deck
node tools/validator/cli.mjs --model examples/public-deck --schemas schema/v1.5

# Emit a structured JSON report
node tools/validator/cli.mjs --model examples/public-deck --json

# Relax schema errors into warnings (cross-schema and graph errors remain fatal)
node tools/validator/cli.mjs --model path/to/model --compat
```

## Options

| Flag | Default | Description |
| --- | --- | --- |
| `[PATH]` / `--model`, `-m` | `.narrative/v1` | Narrative model directory (containing `narrative.yaml`) or direct path to `narrative.yaml`. |
| `--schemas`, `-s` | Auto-detected `schema/v1.5` | Direct schema version folder (for example `schema/v1.5`) or suite directory containing `schema/`. |
| `--compat`, `-c` | `false` | Downgrade JSON Schema errors and missing-plane-file errors to warnings; cross-reference, structure, graph, variant, film, picture, and external-link errors stay fatal. |
| `--json` | `false` | Print the structured `NarrativeValidationReport` JSON to stdout. |
| `--help`, `-h` | `false` | Print CLI usage and exit 0. |

## Enforced Checks

1. **JSON Schema 2020-12** (`Ajv2020`) against native `urn:narrative:*` URNs.
   - `orchestration.scenes` dispatches by own-property presence of `graph`: absent selects `urn:narrative:scenes:1.0.0`, present selects `urn:narrative:scenes:1.1.0` (even for `null`, empty, or malformed `graph` values).
   - Read-only `delivery.slides` pointers are never treated as load errors or baseline findings.
2. **Duplicate IDs and cross-file references**: warns on duplicate entity IDs (`^[A-Z]{1,5}[0-9]{3}$`) and fails on unresolved local references across all schema-backed planes.
3. **Scene structure**: validates `beat` values against root `structure_framework` and verifies `pays_off` targets exist, differ from self, and appear earlier in `scenes`.
4. **Opt-in branching graph**: when `orchestration.scenes` declares `graph`, enforces `version: "1.1.0"`, unique scene IDs, valid entry/ending/transition references, non-empty endings with unique `scene_id`/`code`, no outgoing transitions from endings, at most one `default` transition per scene without a `when` guard, and declared state variable domains in `when`/`effects` (fatal in both strict and compat modes).
5. **Delivery variants**: rejects duplicate scene selections, overrides targeting unselected scenes, and duration overruns; warns on missing timeboxes or under-filled duration budgets.
6. **Film checks**: active only when `planes.orchestration.film` names a film file (contiguous lines per scene, valid shot line spans, unique language scripts, script word coverage, spoken timing estimates and `max_seconds` limits, anchor-in-span, analogy claim linkage, and single call-to-action per cut).
7. **Picture and external links**: rejects duplicate `media.shows.subjects[].id` per asset and duplicate external entity links on goals or concepts.
8. **Gap analysis (warnings only)**: reports goals uncovered by any scene, `strong` claims without `evidence_refs`, and evidence records unreferenced by any claim.

## Format Validation Policy

The validator runs Ajv draft-2020-12 with `{ allErrors: true, strict: false, allowUnionTypes: true, validateSchema: false }` and without `ajv-formats`.

- All structural keywords (`type`, `required`, `additionalProperties`, `enum`, `pattern`, `minLength`, `minimum`, `maximum`, `$ref`, `oneOf`, `anyOf`, `allOf`) are strictly enforced.
- JSON Schema `format` keywords (`uri`, `date-time`, `date`) are advisory annotations rather than hard failures. Ajv emits `unknown format "<name>" ignored in schema at path "..."` lines to `stderr` while compiling the schemas; these stderr lines are expected and do not change the exit code.

## Exit Codes

| Code | Meaning |
| --- | --- |
| `0` | Passed (gap warnings or info lines may be present; in `--compat` mode, schema warnings alone still exit `0`). |
| `1` | Validation failed (one or more schema errors in strict mode, or cross-reference/structure/graph/variant/film/picture/link errors in strict or compat mode). |
| `2` | Runner or usage error (invalid CLI flags, missing model path or `narrative.yaml`, unreadable or invalid YAML in manifest or bound plane file, or unavailable/invalid schema directory). |

## Module Layout

| Path | Responsibility |
| --- | --- |
| `cli.mjs` | Executable CLI entry point (`narrative-validate`). |
| `index.mjs` | Programmatic exports, CLI argument parser, default schema discovery, text report formatter. |
| `core/reader.mjs` | Manifest and plane pointer reader plus presence-dispatched `resolveScenesSchemaUrn`. |
| `core/native-schema.mjs` | Ajv2020 schema registry loader for native `$id` URNs and flexible schema directory resolution. |
| `core/source-status.mjs` | Separates exit-2 load failures from exit-1 validation findings. |
| `core/occurrences.mjs` | Pure entity, reference, duplicate, and external-link occurrence extractor. |
| `core/baseline.mjs` | Schema, cross-reference, structure, branching-graph, variant, film, picture, link, and gap checks. |
| `validator.test.mjs` | Self-contained conformance test suite (`node --test tools/validator/validator.test.mjs`). |
