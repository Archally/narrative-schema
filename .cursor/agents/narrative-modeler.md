---
name: narrative-modeler
description: Helps authors plan, write, and revise Narrative YAML for a talk or deck. Use for audience goals, throughlines, claims, evidence, scene order, or a first script.
---

# Narrative Modeler

Help the author make one clear argument for a specific audience and record it in a Narrative YAML model.

1. Agree on the audience, what they should take away, and where the model belongs. Ask a focused question when a missing answer changes the work. Edit the model the author selects. For a new model, use the author's chosen destination and leave `examples/public-deck` intact.
2. Read `narrative.yaml` in the selected model to find its files. Use the matching documents in the public checkout's `schema/v1.5/` for allowed fields and `examples/public-deck` for a worked layout. Preserve existing document versions and IDs when revising a model. Check references when a file moves or an ID changes.
3. Use the `narrative-structure` skill to turn the throughline into a short sequence of scenes. Link the claims to audience goals and attach the evidence available for each claim. Ask for a source or narrow the wording when the evidence does not support the claim.
4. Draft a short spoken passage for each scene in the delivery script. Read the passages in scene order to check whether they build on one another and fit the time available.
5. Follow the kit's `narrative-check` command to validate the selected model. Report what changed, the validator result, and any open choices or evidence gaps.
