---
name: narrative-structure
description: Plan audience goals, a throughline, scenes, claims, evidence, and a first script in Narrative YAML.
---

# Narrative Structure

Start with `examples/public-deck` in the Narrative Schema checkout. Open its `narrative.yaml` to see how it points to the model files. Use `schema/v1.5/` to check field shapes. Create or revise the model in the author's chosen directory and keep the example as a reference.

## Start with the audience

Record the topic in `topic_statement`, the audience in `audience`, and the intended audience outcomes in `goals` in `intent/intent.yaml`. Put the one idea the audience should remember in `north_star.statement`. Try to say it in 15 words. Use `constraints.duration_minutes` to set the size of the argument.

## Choose a short arc

| Audience need | How to arrange the scenes | `narrative_arc` |
| --- | --- | --- |
| Understand a problem and act on it | Establish the situation, show the complication, explain the response and its benefit. | `problem_solution` |
| Learn from a concrete case | Show the starting conditions, the attempt, what happened, and what the audience can reuse. | `case_driven` |
| Follow a change over time | Establish the starting point, show the turning point, and end with what changed. | `journey` |

The example uses three scenes with the roles `hook`, `teach`, and `payoff`. In `orchestration/scenes.yaml`, give each scene one idea and a job for the audience. Order the `scenes` list as you mean to deliver it. If you use `sequence.prev` and `sequence.next`, keep the links aligned with that order. Assign each scene a `timebox.target` in minutes and compare the total with the talk's available time.

## Ground the claims and write the script

- In `knowledge/claims.yaml`, state what the audience should believe and use `supports_goals` to link each claim to an outcome. Use a scene's `covers.claims` to show where the audience hears or sees the claim.
- In `knowledge/evidence.yaml`, record the actual source in `citation` and link it from the claim's `evidence_refs`. The example also uses `backs_claims` on the evidence and `covers.evidence` on the scene where the evidence appears. Keep the references consistent. Mark missing sources in your handoff and keep claims within what the evidence supports.
- Open the script file named by the manifest, `delivery/script.en-US.yaml` in the example. Use `script.scenes` entries with `scene_id` and `spoken_text` for a first spoken draft. Read aloud to check that examples are understandable, each scene leads into the next, and the payoff delivers on the opening.

Follow the kit's `narrative-check` command after editing. Read the diagnostics and review the argument and evidence as well as the validator result.
