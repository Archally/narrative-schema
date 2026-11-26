# public-narrative-modeler

Model a talk or deck in YAML and validate it with the Narrative Schema checkout.

**Covers:** `narrative`. Use this method when a request is about that work. Every other request
follows the project's own instructions (and its `CONTRIBUTING.md`, where one exists); this file
does not restrict it.

## Start here

- **Claude Code**: the `narrative-modeler` subagent (`.claude/agents/narrative-modeler.md`); the commands below run as slash commands.
- **Codex**: the `narrative-modeler` custom agent (`.codex/agents/narrative-modeler.toml`, loaded in a trusted project). Without it,
  read `.agents/agents/narrative-modeler.md` and follow it. To run a command below, read <!-- public-docs-scan:allow Codex and Cursor read this path -->
  `.agents/commands/<name>.md` and follow it. <!-- public-docs-scan:allow Codex and Cursor read this path -->
- **Cursor**: the `narrative-modeler` subagent (`.cursor/agents/narrative-modeler.md`); the commands below run as slash commands.

## Skills - load on demand, do not read them all up front

- `narrative-structure` - Plan audience goals, a throughline, scenes, claims, evidence, and a first script in Narrative YAML.

## Commands

`/narrative-check`

Reach for one when its subject comes up. This file is loaded with every request, so it is
deliberately short - the detail lives in the skills, not here.
