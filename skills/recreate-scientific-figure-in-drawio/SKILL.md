---
name: recreate-scientific-figure-in-drawio
description: Recreate, design, inspect, refine, or export scientific figures live in the visible draw.io desktop canvas through draw.io's graph API. Use as the draw.io Drawer for step-by-step editable reconstruction or clean no-reference design with text/shapes/lines, composite tables/charts, atomic images, exact layout operations, and repeated structure-plus-renderer quality gates.
---

# Recreate Scientific Figure in draw.io

Act as the draw.io Drawer in the four-role Scientific Illustrator protocol. Use MCP tools beginning with `drawio_live_`. Match the PowerPoint adapter's semantic result and acceptance gate even when draw.io represents tables and charts as editable composites.

## Respect read-only requests

If the user requests inspection only, call `drawio_live_get_capabilities`, connect only when needed to read the current canvas, then call `drawio_live_status` and `drawio_live_inspect`. Do not clear, add, update, save, or close anything.

## Establish a safe live session

1. Call `drawio_live_get_capabilities` before selecting cell types.
2. Launch or connect visibly, call `drawio_live_status`, and require `graph_ready=true`.
3. Inspect the existing live model before editing it.
4. Control only draw.io's graph/model API; never use operating-system mouse, keyboard, window, or full-screen automation.
5. Do not clear an existing canvas without explicit confirmation.
6. Do not prebuild XML as the drawing method. Save a snapshot only after the cells visibly exist.

Use file utilities only to validate, inspect, or export an already saved live snapshot. Reopen and visually review any narrowly repaired file.

## Map the shared semantic contract

| Semantic object/operation | draw.io implementation |
|---|---|
| Editable text | `drawio_live_add_shape` with `shape=text` |
| Editable symbol/panel | `drawio_live_add_shape` using a baseline or currently registered capability name/style |
| Free arrow/axis/tick | `drawio_live_add_line` with endpoint clearances |
| Attached relationship | `drawio_live_add_edge` with entry/exit and waypoints |
| Editable table | `drawio_live_add_table`, cell updates, and `drawio_live_update_table_layout` |
| Editable regular chart | `drawio_live_add_chart` or deliberate editable primitives |
| Repeated motif | duplicate, group/ungroup, and z-order tools |
| Exact layout | `drawio_live_align_cells` and `drawio_live_distribute_cells` |
| Structure review | `drawio_live_audit_figure` plus `drawio_live_inspect` |
| Renderer review | `drawio_live_screenshot` |

Use editable cells or editable composites for every reconstructable semantic object. Never substitute a panel screenshot.

Never invent a shape name. Unknown or unloaded shape/stencil names are rejected to prevent draw.io silently displaying a generic rectangle. If the required object is not listed by `drawio_live_get_capabilities`, construct it from editable primitives; use an atomic image only when the smallest remaining semantic region is genuinely irreducible.

## Inventory before drawing

Use the Designer's specification or extract an inventory from the reference. Assign stable ids, bounds, parent group, construction order, and z-order. Classify every item as editable text, shape, free line, connector, table/chart composite, repeated motif, or irreducible raster field.

## Enforce atomic images

Use `drawio_live_add_image` only for one tightly scoped irreducible visual field. Require:

- a specific `raster_reason`;
- `source_is_tightly_cropped=true` or explicit crop percentages;
- `atomic_raster_unit=true`;
- `contains_reconstructable_content=false`;
- a precise `decomposition_note`.

Split prediction grids, mask comparisons, channel stacks, microscopy arrays, and before/after blocks into separate image cells. Rebuild all text, frames, grid lines, legends, arrows, axes, tables, and regular plots as editable cells.

## Draw one region at a time

1. Establish page/canvas bounds, grid, margins, panel rectangles, alignment anchors, spacing tokens, z-order, and connector lanes.
2. Draw one logical region from background to foreground with stable ids and nonzero pacing.
3. Keep labels in explicit text cells with planned bounds and wrapping.
4. Use attached edges for semantic relationships; use free lines for axes, ticks, separators, and annotations.
5. Apply start/end clearance and deliberate entry/exit points so arrows touch boundaries without covering fills or labels.
6. Use exact align/distribute and table-layout tools instead of visual guessing.
7. Group a region only after its members remain editable and its local gate passes.

## Mandatory Reviewer-Corrector loop

After each completed region:

1. Fit the current canvas and capture `drawio_live_screenshot`.
2. Run `drawio_live_audit_figure` and inspect named cells.
3. Give structure and renderer evidence to `$audit-scientific-figure`.
4. If it reports any finding, give the findings to `$correct-scientific-figure`.
5. Execute the returned object-level operations.
6. Capture and audit again.

Do not draw the next region until the Reviewer reports no unresolved finding except documented source ambiguity. After all regions pass, run the same loop on the whole canvas until it passes.

## Acceptance gate

Require exact readable semantics, 1.00 reconstructable editability, 1.00 clipping/overlap safety, at least 0.95 layout/alignment confidence, at least 0.95 connector clarity, at least 0.90 reference correspondence when applicable, zero deterministic hard failures, and no unjustified warning.

## Delivery

Inspect once more, save with `drawio_live_save_snapshot`, validate the `.drawio`, and export a review image. Report stable object counts, native/composite/group counts, image count, every raster declaration, local and whole-canvas Reviewer results, validation, and remaining ambiguity.
