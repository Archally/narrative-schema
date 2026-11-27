# Author and read an untimed story outline

Start with a copy of [Lighthouse Ladder](../examples/storyworld-linear/narrative.yaml). The outline follows the keeper and mechanic through four scenes. The spare lens gives you a concrete question to check at each event that changes or uses it. Who holds it at that point in story time?

Run the following from the repository root with Node.js 22 or newer and the checkout dependencies installed with `npm ci`. Use the same shell for all the blocks. The copy retains the example's manifest, claims, concepts, and evidence.

```sh
MODEL_DIR="$(mktemp -d)"
cp -R examples/storyworld-linear/. "$MODEL_DIR/"

cat > "$MODEL_DIR/intent/intent.yaml" <<'YAML'
version: "1.0.0"
topic_statement: Keep the lighthouse beam lit through the storm.
audience:
  level: intermediate
  roles: [engineer]
  assumed_concepts:
    - concept: C001
      basis: Entry workshop covers lens optics
      evidence: [E001]
goals:
  - id: G001
    statement: Explain how the lighthouse beam is restored.
    priority: must
constraints: { language: en-US, format: reading_outline }
north_star:
  statement: The audience can explain how the spare lens restores the beam.
YAML

cat > "$MODEL_DIR/orchestration/scenes.yaml" <<'YAML'
version: "1.0.0"
narrative_arc: journey
timing: untimed
scenes:
  - { id: SC001, title: Harbour at dawn, role: hook, supports_goals: [G001], covers: {} }
  - id: SC002
    title: The storm warning
    role: setup
    supports_goals: [G001]
    covers: { concepts: [C002] }
  - { id: SC003, title: Tomas brings the lens, role: turn, supports_goals: [G001], covers: {} }
  - id: SC004
    title: The lamp is relit
    role: payoff
    covers: { concepts: [C003], claims: [CLM001] }
YAML

cat > "$MODEL_DIR/delivery/variants.yaml" <<'YAML'
version: "1.0.0"
variants:
  - id: DLV001
    name: Reading cut
    language: en-US
    confidentiality: public
    scene_selection: { scene_ids: [SC001, SC002, SC003, SC004] }
YAML
```

Read the selected scenes from `SC001` to `SC004`. The intent, scenes, and variant carry no budgets. The variant still chooses the scenes the reader follows.

Replace the copy's storyworld file with the following.

```sh
cat > "$MODEL_DIR/knowledge/storyworld.yaml" <<'YAML'
version: "1.0.0"
characters:
  - id: CHR001
    name: Mara
    appearances:
      - { scene: SC001, presence: on_screen }
      - { scene: SC002, presence: on_screen }
      - { scene: SC003, presence: on_screen }
      - { scene: SC004, presence: on_screen }
  - id: CHR002
    name: Tomas
    appearances:
      - { scene: SC001, presence: mentioned }
      - { scene: SC002, presence: heard }
      - { scene: SC003, presence: on_screen, presence_sequence: [heard, on_screen] }
story_objects:
  - { id: OBJ001, name: Spare lens, initial_holder: CHR002 }
story_events:
  - id: EVT001
    title: The lamp's lens cracks
    occurs_in: SC002
    before: [EVT003]
    overlaps: [EVT002]
  - id: EVT002
    title: Tomas radios a storm warning
    occurs_in: SC002
  - id: EVT003
    title: Tomas hands Mara the spare lens
    occurs_in: SC003
    before: [EVT004]
    object_effects:
      - { object: OBJ001, action: transfer, from: CHR002, to: CHR001 }
  - id: EVT004
    title: Mara relights the lamp with the spare lens
    occurs_in: SC004
    requires_events: [EVT003]
    before: [EVT005]
    telling_position: 2
    object_effects:
      - { object: OBJ001, action: use, by: CHR001 }
  - id: EVT005
    title: After relighting the lamp, Mara recalls the crack
    occurs_in: SC004
    recounts_events: [EVT001]
    telling_position: 1
YAML
```

| Question | Read the YAML |
| --- | --- |
| What happens when? | `EVT001` overlaps `EVT002`. The crack ends before or as the handoff `EVT003` starts. The handoff precedes the relighting `EVT004`, which precedes the recollection `EVT005`. |
| What does `SC004` tell first? | The recollection `EVT005` has position 1. The scene then tells the relighting `EVT004` at position 2. The crack keeps its own event ID and stays in `SC002`. |
| Where does Tomas first become visible? | `SC003`. He is mentioned in `SC001`, heard in `SC002`, and heard then seen in `SC003`. `presence: on_screen` summarizes the sequence because he becomes visible during that scene. |
| Who holds the spare lens? | Tomas holds it initially. After `EVT003`, Mara holds it. She still holds it after using it in `EVT004`. |

Use `before` for a directed story-time relation, and `requires_events` when the later event depends on an earlier event. `overlaps` is symmetric and may be written once per pair. An overlapping pair cannot also be ordered by the story-time relations. `recounts_events` points from a telling event to the earlier events it recounts. The story-time relations leave some pairs unordered. Use `telling_position` to order events within a scene. Positions start at 1 and may have gaps.

For possession, start at `initial_holder`, or leave it absent if nobody holds the object. Follow the effects in story time and read each event's effects in list order. `acquire` gives an unheld object to `to`, `transfer` passes it from `from` to `to`, and `lose` leaves it lost after `from` loses it. `regain` returns a lost object to its last holder, named by `to`. `use` records the character in `by` and leaves possession as it was.

Check the copy with the standalone validator and semantic checker.

```sh
node tools/validator/cli.mjs --schemas schema/v1.7 --model "$MODEL_DIR"
node tools/semantic-checker/cli.mjs "$MODEL_DIR" --strict
```

Use the table to answer the story questions from the checked YAML. The validator checks conformance and references. The semantic checker reports authored-graph rule findings.
