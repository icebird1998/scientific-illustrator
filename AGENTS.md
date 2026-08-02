# Scientific Illustrator — agent notes

This repository ships Scientific Illustrator, a plugin that rebuilds or designs
scientific figures as **editable objects** in draw.io, Microsoft PowerPoint, or
WPS Presentation, with a Designer → Drawer → Reviewer → Corrector workflow.

## Two execution backends

1. **MCP (Codex).** The three servers under `plugins/scientific-illustrator/scripts/`
   (`server.mjs`, `live-server.mjs`, `powerpoint-server.mjs`) expose the
   `drawio_*`, `drawio_live_*`, and `powerpoint_*` tools over stdio JSON-RPC.
2. **CLI (all other agents and plain shells).** `sci-illu` maps 1:1 to those
   tools: `sci-illu file <tool>` / `sci-illu live <tool>` /
   `sci-illu ppt <tool>`, arguments as `--json '<args>'` with the same shape
   as the MCP tool arguments. stdout is JSON; exit codes 0/1/2.

## What to do in this repo

- **To build/recreate a figure**: follow the four-role loop in
  `plugins/scientific-illustrator/skills/recreate-scientific-figure/SKILL.md`
  (and its draw.io / PowerPoint adapters), and use the tool name → `sci-illu`
  mapping noted at the top of each skill.
- **To look up an exact command**: read
  `plugins/scientific-illustrator/skills/sci-illu-cli/SKILL.md`, or run
  `sci-illu help <group>` / `sci-illu <group> --list-tools`.
- **Platforms**: Linux works fully for draw.io (`file`/`live`) and for
  `ppt` OOXML with `python-pptx`; PowerPoint COM is Windows-only, Office.js
  live drawing is macOS-only and uses the `sci-illu ppt serve` daemon.

## Verification

Run `npm test` before committing. The CLI smoke tests live in
`scripts/cli-smoke-test.mjs`.
