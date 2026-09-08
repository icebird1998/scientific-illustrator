---
name: recreate-scientific-figure-in-drawio
description: Create, reconstruct, refine, or export editable scientific figures through the live draw.io graph API. Use for native shapes, text, connectors, editable charts/tables, atomic source images, and adaptive visual checkpoints.
---

# Recreate Scientific Figure in draw.io

Use MCP tools beginning with `drawio_live_`. Preserve the same scientific meaning and editability contract as the PowerPoint adapter, using editable composites when needed. Planning, execution, and review can stay in one agent; delegate only an independently useful subtask.

For complex reconstruction, read [Adaptive reconstruction workflow](../recreate-scientific-figure/references/adaptive-workflow.md). Use `drawio_live_plan_reconstruction` for uncertain module routes; obvious shapes and labels can be drawn directly.

## Establish a live session

1. Call `drawio_live_get_capabilities` before choosing cell types.
2. Launch or connect visibly with `step_delay_ms=0`, call `drawio_live_status`, and require `graph_ready=true`.
3. Inspect the existing model before editing. An inspection-only request permits capabilities/status/inspect and no mutations or save.
4. Control draw.io through its graph/model API. Do not use operating-system mouse, keyboard, window, or full-screen automation.
5. Preserve existing canvas content unless the user authorized replacing it. Do not clear unrelated work.
6. Construct through the live graph API and save after cells exist. Do not use prebuilt XML as the drawing method. File utilities may validate, inspect, or export a saved snapshot; reopen and review a narrowly repaired file.

## Map objects to capabilities

| Semantic object/operation | draw.io implementation |
|---|---|
| Editable text | `drawio_live_add_shape` with `shape=text` |
| Editable symbol/panel | `drawio_live_add_shape` with a registered capability name/style |
| Free arrow/axis/tick | `drawio_live_add_line` with endpoint clearances |
| Attached relationship | `drawio_live_add_edge` with entry/exit and waypoints |
| Editable table | `drawio_live_add_table`, cell updates, `drawio_live_update_table_layout` |
| Editable regular chart | `drawio_live_add_chart` or editable primitives from verified data |
| Repeated motif | duplicate, group/ungroup, z-order tools |
| Exact layout | `drawio_live_align_cells`, `drawio_live_distribute_cells` |
| Bounded operation batch | `drawio_live_draw_sequence` |
| Structure and renderer review | `drawio_live_audit_figure`, `drawio_live_inspect`, `drawio_live_screenshot` |

Unknown or unloaded stencils can render as generic rectangles; use only names reported by capabilities or construct simple objects from editable primitives. Choose an atomic image for irreducible appearance rather than forcing intricate non-semantic detail into hundreds of shapes. Keep text and meaningful relationships editable.

## Use atomic source images

`drawio_live_add_image` requires one tightly scoped visual field and all declarations:

- specific `raster_reason`;
- `source_is_tightly_cropped=true` or explicit crop percentages;
- `atomic_raster_unit=true`;
- `contains_reconstructable_content=false`;
- precise `decomposition_note`.

Inspect the actual crop before declaring it clean. Split image grids and comparisons into fields; rebuild text, frames, legends, arrows, and axes as editable cells. A hybrid route does not allow an image containing those overlays. Cropping does not automatically remove a background or baked-in label. Keep measured evidence intact and report an inseparable source limitation.

## Draw in bounded batches

Establish canvas bounds, panel anchors, typography, spacing tokens, z-order, and connector lanes. Use stable ids and draw each batch back to front. For predictable objects, prefer `drawio_live_draw_sequence` with `step_delay_ms=0`; use pacing only when animation is explicitly desired. Follow planner batch limits when supplied and use smaller batches around uncertain or densely connected modules.

Keep labels in explicit editable text cells. Use attached edges for semantic links and free lines for axes, ticks, and separators. Set deliberate entry/exit points and endpoint clearance; use exact align/distribute/layout operations. Group coherent modules while keeping members editable. Reuse a checked motif rather than reconstructing every instance from scratch.

## Inspect and correct

At a meaningful checkpoint, capture a readable `drawio_live_screenshot` and obtain `drawio_live_audit_figure` plus any necessary named-cell inspection. Compare the changed region against its source and in whole-canvas context. Review uncertain modules before replicating them; batch cosmetic fixes across predictable regions. Do not require a screenshot after every object or block unrelated drawing over a minor cosmetic warning.

Use `$audit-scientific-figure` for detailed findings and `$correct-scientific-figure` for exact corrections when needed. Fix affected ids and incident edges, then obtain fresh evidence for those changes. When representation fails, feed observations into `drawio_live_plan_reconstruction`. Follow the shared retry budget; stop repeated ineffective changes and report an unresolved module rather than flatten it or claim success.

## Delivery

Run a final whole-canvas structure and visual check. Require exact readable semantics, preserved data/topology, editable reconstructable content, and no unresolved hard failures or material reference mismatch. Record residual minor warnings or source ambiguity with evidence; subjective confidence alone cannot establish a pass.

Save with `drawio_live_save_snapshot`, validate the `.drawio`, and export a review image. Report backend verification, object/image counts, meaningful route decisions and raster declarations, final validation, and limitations.
