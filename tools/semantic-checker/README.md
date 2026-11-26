# Narrative Semantic Checker

Evaluates Narrative semantic rules over a built authored graph using the generic `@archally/semantic-checker` engine.

## Usage

From the repository root:

```sh
npm run check:semantic -- examples/public-deck
npm run check:semantic -- examples/public-deck --strict
npm run check:semantic -- --list
```

Direct invocation (accepts a model directory, `narrative.yaml`, or a built `model.json`):

```sh
node tools/semantic-checker/cli.mjs <path> [--config <file>] [--strict] [--json]
```

## Rules (8 total, all default `warn`)

Declarative YAML rules (`rules/default.rules.yaml`):

- `orphan-concepts`
- `orphan-assets`
- `orphan-evidence`
- `unlinked-qa`
- `scene-without-goal-or-claim`

Custom extension rules (`rules/extensions.rules.yaml`):

- `unused-scene-in-variants`
- `asset-substitution-target-type`
- `timebox-ordering`

## Configuration

Auto-discovers `.narrative-lint.yaml` or `.narrative-lint.yml` in the model root directory, or accepts `--config <path>`:

```yaml
rules:
  orphan-concepts: error
  unused-scene-in-variants: off
```

## Exit codes

- `0`: check completed and passed (warnings/info allowed unless `--strict`)
- `1`: check completed with failing findings
- `2`: usage error, config error, model load error, rule pack error, or engine error
