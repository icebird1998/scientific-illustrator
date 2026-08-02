---
name: sci-illu-cli
description: Reference for the sci-illu command-line interface of Scientific Illustrator. Use when you need to invoke any Scientific Illustrator capability from a shell, from an agent without MCP support (pi, Claude Code, Cursor, Windsurf, plain terminals), or when you want a concrete command example for any drawing, audit, export, or PowerPoint/WPS operation. Covers the tool mapping, flags, output contract, exit codes, the Office.js daemon lifecycle, and per-platform notes.
---

# sci-illu CLI reference

`sci-illu` is the CLI front end for the Scientific Illustrator servers. Every
subcommand maps 1:1 to an existing MCP tool; running it is equivalent to an
MCP `tools/call` and returns the same result object.

## Invocation shape

```bash
sci-illu <group> <tool> [flags]
```

| Group | Backend | Maps to MCP prefix |
|---|---|---|
| `file` | draw.io file utilities (create / validate / inspect / update / export) | `drawio_` |
| `live` | draw.io live canvas control over CDP (visible drawing) | `drawio_live_` |
| `ppt` | Microsoft PowerPoint / WPS Presentation (COM / Office.js / OOXML) | `powerpoint_` |

Tool names accept both kebab-case (`add-shape`) and the raw MCP name
(`drawio_live_add_shape`). The prefix is inferred from the group:
`drawio_X` ↔ `sci-illu file X`, `drawio_live_X` ↔ `sci-illu live X`,
`powerpoint_X` ↔ `sci-illu ppt X`.

## Flags

| Flag | Meaning |
|---|---|
| `--json '<json>'` | Tool arguments, **same shape as the MCP tool arguments** |
| `--output <path>` | Save the first screenshot / slide image result to `<path>` |
| `--backend <b>` | ppt only: `auto` \| `officejs` \| `com` \| `ooxml` |
| `--host <h>` | ppt only: `auto` \| `powerpoint` \| `wps` |
| `--focus-policy <p>` | ppt only: `preserve` \| `foreground` |
| `--file <path>` | Inject `file_path` into the tool arguments |
| `--state-dir <dir>` | State dir (default `~/.local/state/sci-illu`); keeps OOXML working copies and daemon state across calls |
| `--port <n>` | ppt daemon port (default 18090) |
| `--timeout-ms <n>` | Per-call timeout (default 300000) |
| `--pretty` | Pretty-print the result JSON |
| `--list-tools` | List the group's tools |
| `--help` | Show help |

## Output contract

stdout is always one JSON object; exit code 0 means the tool succeeded.

```json
{"ok":true,"tool":"drawio_live_add_shape","result":{...},"images":[{"path":"...","mimeType":"image/png"}]}
{"ok":false,"tool":"powerpoint_add_shape","error":"..."}
```

- `result` is the tool's `structuredContent` (or its text content parsed as JSON).
- `images` lists screenshot / slide-image files written by the CLI
  (auto-temp unless `--output`). Pass `--output` for the first image.
- Exit codes: `0` success, `1` tool or server failure (error JSON on stdout),
  `2` usage error (message on stderr).

## Office.js daemon (Mac PowerPoint live drawing)

The Office.js backend needs a persistent bridge that the PowerPoint task pane
long-polls, so `sci-illu` keeps one daemon per state dir. It is started
automatically on the first `--backend officejs` call:

```bash
sci-illu ppt serve --backend officejs --host powerpoint   # explicit start
sci-illu ppt status --backend officejs                     # auto-starts if needed
sci-illu ppt stop                                          # stop the daemon
```

Every `--backend officejs` call is routed through the daemon, keeping the
task pane connected and the session token stable. For COM (Windows) and OOXML
(file working copy) each call is a fresh one-shot process; state lives in the
target application or in the working copy under the state dir.

## Core workflow examples

```bash
# draw.io live: launch/reconnect, then draw
sci-illu live launch
sci-illu live get-capabilities
sci-illu live add-shape --json '{"label":"box","shape":"rectangle","x":40,"y":40,"width":120,"height":60,"style":"fillColor=#F08705;"}'
sci-illu live add-edge --json '{"source":"1","target":"2","label":"flow"}'
sci-illu live screenshot --output /tmp/figure.png
sci-illu live audit-figure
sci-illu live save-snapshot --json '{"output_path":"/tmp/figure.drawio"}'

# draw.io file utilities: create, patch, validate, export
sci-illu file create-diagram --json '{"output_path":"/tmp/f.drawio","workflow_context":"explicit-file-only-request"}'
sci-illu file update-cells --json '{"input_path":"/tmp/f.drawio","patches":[...]}'
sci-illu file validate --json '{"input_path":"/tmp/f.drawio"}'
sci-illu file export --json '{"input_path":"/tmp/f.drawio","format":"png","output_path":"/tmp/f.png"}'

# PowerPoint / WPS
sci-illu ppt status --backend ooxml
sci-illu ppt launch --backend ooxml
sci-illu ppt add-shape --backend ooxml --json '{"slide_index":1,"shape_type":"rectangle","left":72,"top":72,"width":144,"height":72,"fill_color":"#F08705","text":"label"}'
sci-illu ppt audit-figure --backend ooxml
sci-illu ppt export-slide-image --backend ooxml --json '{"slide_index":1,"output_path":"/tmp/slide.png"}'
sci-illu ppt save --backend ooxml --json '{"output_path":"/tmp/final.pptx"}'
```

## Platform notes

- **Linux**: `file` and `live` work fully. `ppt` OOXML works when
  `python-pptx` is installed (see install.sh); `ppt` COM and Office.js are
  unavailable and report a clear error. `live` requires the draw.io desktop
  app (auto-detected; `DRAWIO_PATH` override).
- **Windows**: draw.io via `file`/`live`; PowerPoint COM preferred; OOXML for
  WPS or working copies.
- **macOS**: draw.io via `file`/`live`; PowerPoint Office.js live backend via
  the daemon; OOXML fallback with `python-pptx`.

Install: `install.sh` / `install.ps1` add `sci-illu` to PATH, or symlink
`plugins/scientific-illustrator/scripts/cli.mjs` into a bin directory.

Discover available tools and their required arguments:

```bash
sci-illu help live
sci-illu ppt --list-tools
```
