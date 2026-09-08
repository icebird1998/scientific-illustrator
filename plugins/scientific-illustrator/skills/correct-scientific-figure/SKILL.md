---
name: correct-scientific-figure
description: Convert Reviewer findings for a scientific illustration into minimal, ordered, object-level correction instructions for visible draw.io, Microsoft PowerPoint, or WPS Presentation. Use when layout, text, connector, z-order, reference-fidelity, or raster editability defects must be translated into exact backend operations and measurable regression checks without flattening the figure.
---

# Correct Scientific Figure

Diagnose observed findings and produce a minimal executable correction plan. Planning, execution, and visual review are separate phases that one model may perform; a plan is not evidence that its correction worked. Use [Adaptive reconstruction workflow](../recreate-scientific-figure/references/adaptive-workflow.md) for feedback, representation changes, and bounded retries.

## Required inputs

Use:

- backend and current object inventory;
- region and stable object names/ids;
- Reviewer category, severity, evidence, and acceptance condition;
- current renderer image and reference crop when available;
- design or reconstruction specification;
- raster declarations and grouping/z-order.

If a finding lacks an identifiable object, obtain a narrower inspection; never replace the whole panel as a shortcut. Reuse current evidence and accepted geometry instead of collecting the entire document again.

## Diagnose before prescribing

Classify the root cause as one or more of:

- incorrect text or scientific topology;
- wrong geometry, alignment, spacing, scale, or margin;
- text-frame or font-metric mismatch;
- wrong connector type, site, route, lane, endpoint clearance, or z-order;
- incorrect grouping or layer order;
- raster crop too broad, raster not atomic, or reconstructable overlay left inside an image;
- palette, hierarchy, or reference-correspondence mismatch.

Prefer the smallest change set that fixes the root cause and preserves already approved objects.

Resolve scientific text/data/topology and crop contamination before cosmetic issues. Batch independent small corrections into one sequence with zero artificial delay. Do not send the same vague finding through several role handoffs. When two attempts fail to improve a module, reassess the source or representation rather than repeat the same operation; retain the total per-module attempt count across route changes.

## Emit an object-level plan

For every finding, return:

```text
correction_id: stable id
finding_id: source finding
backend: powerpoint | drawio
region: stable region id
objects: exact names/ids
root_cause: concise diagnosis
operations: ordered backend tool calls with exact target values
preserve: objects/properties that must not change
acceptance: measurable rerender and re-audit condition
rollback_signal: evidence that the correction harmed an approved area
```

Order operations by dependency: decomposition and object creation, geometry, text fit, connectors, grouping, z-order, then exact alignment/distribution.

Include incident connectors when moving nodes, and recheck their endpoints after final alignment/distribution. Use the backend planner's feedback fields only when deciding to repair, reroute, inspect, or stop; ordinary measurable geometry fixes can proceed directly.

## Equivalent backend operations

| Intent | PowerPoint Drawer | draw.io Drawer |
|---|---|---|
| Move/resize/restyle | `powerpoint_update_shape` | `drawio_live_update_cell` |
| Align | `powerpoint_align_shapes` | `drawio_live_align_cells` |
| Equal spacing | `powerpoint_distribute_shapes` | `drawio_live_distribute_cells` |
| Table dimensions | `powerpoint_update_table_layout` | `drawio_live_update_table_layout` |
| Free arrow clearance | redraw with `powerpoint_add_line` clearances | redraw with `drawio_live_add_line` clearances |
| Attached relationship | COM/OOXML: `powerpoint_add_connector` with correct sites; Office.js: rebuild its named geometry-backed route and recheck after node movement | `drawio_live_add_edge` with entry/exit and waypoints |
| Layer order | `powerpoint_set_z_order` | `drawio_live_set_z_order` |
| Atomic image | `powerpoint_add_image` | `drawio_live_add_image` |

Use delete/replace operations only for the exact defective object and only when in-place correction cannot express the required result.

## Correction recipes

### Arrowhead or path overlaps a rectangle

Identify the intended source/target and boundary sides. Prefer an attached connector for semantic links. Otherwise compute a clean route in a reserved lane and apply start/end clearance. Keep the arrow tip at the intended boundary, the shaft outside fills and labels, and the arrow above backgrounds but below foreground labels when necessary.

### Repeated objects are uneven

First make equal-role objects equal in size. Align the intended shared edge/center. Preserve the outer anchors, then distribute equally. Recheck connector attachment after movement.

### Text differs or wraps incorrectly

Correct text exactly, then set explicit box bounds, margins, wrapping, alignment, and font metrics. Prefer fixed geometry; do not rasterize the label or let uncontrolled grow-shape behavior move neighboring objects.

### Picture is still composite

Reject a broad crop. Split every independent microscopy field, mask, heatmap, photograph, channel, or prediction into a separate atomic image. Recreate titles, method names, borders, grids, legends, arrows, axes, and annotations as editable objects. Require all five raster declarations on each retained image.

Do not set `contains_reconstructable_content=false` until inspection confirms it. If baked-in overlays cannot be removed faithfully from measured evidence, request a better source or report the limitation. Cropping alone is not background removal.

### Native reconstruction loses intricate appearance

Inspect whether the missing detail is scientifically meaningful or non-semantic appearance. Preserve editable semantic boundaries, data, labels, and connections. For an intricate irreducible field with a valid source and no conflicting editability requirement, plan an atomic crop or a hybrid field with editable overlays. Check crop quality and final-size fidelity before replacing the named native detail. A failed native attempt never authorizes flattening an entire panel.

### Global correction would damage passed regions

Constrain the operation to named objects or one region. If a shared style token is wrong, list every affected object explicitly and preserve already validated geometry.

## Regression handoff

Execute through `$edit-powerpoint-live` or `$recreate-scientific-figure-in-drawio`. After the correction batch, obtain a fresh renderer image and relevant `powerpoint_audit_figure` or `drawio_live_audit_figure` evidence. Review changed objects and affected neighbors using `$audit-scientific-figure`; reserve repeated whole-figure checks for broad changes and final acceptance.

Mark a correction complete only when current evidence satisfies its acceptance condition without a regression. At the retry budget, retain the latest editable checkpoint and report the specific unresolved finding; never claim a pass because attempts are exhausted.
