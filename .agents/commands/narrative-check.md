---
description: Validate a selected Narrative model or the explicitly requested bundled example.
argument-hint: "[model directory | --example]"
---

# /narrative-check

Use the public checkout's validator to check YAML and references. This procedure reads the model without editing it.

1. **Choose what to check.** Use `$ARGUMENTS` or the model directory explicitly selected in the conversation. `--example` or an explicit request for the bundled example selects `examples/public-deck`. If the intended model is unclear, ask for its directory. Resolve a custom directory relative to the original working directory before changing to the checkout root. Use its absolute path as `MODEL_DIR` and confirm it contains `narrative.yaml`. Keep paths quoted, including paths that contain spaces.
2. **Find the checkout.** Use the checkout path supplied by the user, the `NARRATIVE_SCHEMA_ROOT` environment variable, or the nearest enclosing checkout that contains a `package.json` named `"@archally/narrative-schema"` and a version directory under `schema/` (for example `schema/v1.6`). Check both markers for the chosen root and resolve it to an absolute `SCHEMA_ROOT`. If no root is known or the supplied path fails the check, ask for the correct checkout path.
3. **Run the selected check.** Use Node.js 22 or later. The checkout's dependencies are prepared with `npm ci --ignore-scripts`. If dependencies are missing, report the setup problem and the preparation command.

   For the explicitly requested bundled example:

   ```bash
   (cd "$SCHEMA_ROOT" && npm run validate:example)
   ```

   For a selected model:

   ```bash
   (cd "$SCHEMA_ROOT" && npm run validate -- --model "$MODEL_DIR")
   ```

4. **Report what happened.** Give the directory checked, the exit status, and any diagnostics, including warnings on a successful check. If the check could not run, report the missing prerequisite or path problem separately from any schema or reference findings.
