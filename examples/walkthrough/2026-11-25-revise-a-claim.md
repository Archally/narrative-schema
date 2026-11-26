# Revise a claim in the example deck

[Single-Source Narrative Delivery](../public-deck/narrative.yaml) is a synthetic model. Its IDs, evidence entries and diagram are illustrative. The model uses format version `1.0.0` and validates with the schema in release `1.5.0`.

From the repository root, use Node.js 22 or newer and run:

```sh
npm ci
npm run validate:example
```

The validator reports `PASSED with 0 warning(s).` The command checks the YAML model and its references.

1. In [claims.yaml](../public-deck/knowledge/claims.yaml), find `CLM001`, “Resolving the manifest once prevents slide outlines and validation findings from drifting across tools.” Change its `title` to “One manifest keeps slide outlines and validation findings aligned.” Keep the claim ID as written.
2. In [scenes.yaml](../public-deck/orchestration/scenes.yaml), find `SC002`, “Resolve the Authored Graph Once.” Its `covers.claims` still points to the claim you edited. The claim’s `scene_refs` points back to this scene. The scene also names `A001`, “Single-source Narrative delivery flow,” whose [asset entry](../public-deck/knowledge/assets.yaml) points to the [local diagram](../public-deck/media/pipeline-overview.svg).
3. Run `npm run validate:example` again. Expect the same result. The title has changed and the references still resolve. The scene text stays as written, so review it against your revised claim.

The model and diagram are [Apache-2.0 licensed](../../LICENSE-APACHE).
