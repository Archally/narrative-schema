# Narrative 1.7 migration notes

Existing valid Narrative models can be checked with [schema/v1.7](../schema/v1.7/) with their document versions, IDs, and references intact. Timed models keep their intent duration and scene timeboxes. A scenes document with a top-level `graph` uses the branching scenes schema. A scenes document without it uses the linear scenes schema.

The [storyworld schema](../schema/v1.7/knowledge/narrative.storyworld.schema.yaml) supports optional story-time relations, telling positions, ordered presence, and object effects. Use the 1.7 schema when sharing models that use those fields. A strict 1.6 validator rejects the new fields and the untimed outline format.

To author an explicitly untimed outline, set `timing: untimed` at the top level of the scenes file and `constraints.format: reading_outline` in intent. Omit `constraints.duration_minutes` and each scene's `timebox`. A delivery variant may select scenes, but omit its `duration_minutes`, `scene_selection.overrides`, and `film` settings. Timing is unavailable for that outline. For a timed model, omit `timing` and supply the intent duration and scene timeboxes.

Follow the [reading outline walkthrough](2026-11-27-author-a-reading-outline.md) for a runnable example.
