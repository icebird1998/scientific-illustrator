---
name: recreate-scientific-figure
description: Rebuild a supplied scientific figure as an editable draw.io, PowerPoint, or WPS illustration. Use for reference reconstruction with adaptive native, cropped, or hybrid modules and targeted visual correction.
---

# Recreate Scientific Figure

Preserve the reference's scientific meaning, layout, and readable text while choosing an efficient representation for each module. Use `$recreate-scientific-figure-in-drawio` or `$edit-powerpoint-live` for the user's chosen backend. Planning, drawing, reviewing, and correction are responsibilities one agent can perform; separate agents are useful for an independent difficult review, not a required handoff after every edit.

Read [Adaptive reconstruction workflow](references/adaptive-workflow.md) for route selection, planner inputs, checkpoints, and bounded correction. Apply it when reconstructing a reference; direct, obvious text or geometry edits do not need a planner call.

## Establish the reconstruction

1. Inspect the full-resolution reference, then enlarge only ambiguous or intricate regions. Record unreadable content; never invent labels, quantitative values, or scientific connections.
2. Detect backend capabilities and inspect the target document before editing. Preserve existing work and use an isolated document or working copy for a new figure.
3. Define canvas size, coordinate transform, panel bounds, reading order, palette, typography, alignment anchors, and connector lanes.
4. Assign stable module/object ids. Record each module's bounds, semantic content, source, representation, grouping, and acceptance conditions in a compact `reconstruction_spec`. Expand object geometry only for the next batch; reuse proven motifs.
5. Use editable text, shapes, attached relationships, and native or editable-composite tables/charts for reconstructable content. Rebuild quantitative charts only from verified data. Choose source crops for genuinely irreducible visual fields; use hybrid modules when they need editable overlays.

## Execute and adapt

Use the selected backend's sequence tool for bounded operations with `step_delay_ms=0`. Explicit animation is optional. Build one representative uncertain module early, compare its rendered result with the source, then reuse a successful construction. Batch predictable objects across nearby regions; inspect risky source crops, complex silhouettes, dense text, and cross-panel connectors at the next meaningful checkpoint.

At checkpoints, combine a current structure audit with a readable render. The model compares the render with the source and identifies specific defects; audit tools do not automatically measure visual resemblance. Use `$audit-scientific-figure` for detailed review and `$correct-scientific-figure` when findings need an explicit operation plan. Fix affected objects and their dependencies, retaining accepted modules. Small cosmetic findings can be collected into one correction batch; semantic, data, editability, or topology failures block reuse of the affected module.

Do not repeat unchanged full-figure audits, regenerate accepted regions, or lower quality requirements to improve speed. Reduce overhead through batching, motif reuse, zero artificial delay, and targeted inspections. Follow the bounded retry rules in the shared workflow and report an unresolved limitation instead of claiming success.

## Raster boundary

Keep one image object per irreducible visual field, such as a photograph, microscopy field, or detailed non-semantic texture. A complex source illustration may retain its fine appearance while semantic shapes, text, markers, and connectors remain editable. Separate image arrays and comparison grids into fields.

Each retained image requires `raster_reason`, tight crop evidence, `atomic_raster_unit=true`, `contains_reconstructable_content=false`, and `decomposition_note`. Verify these declarations against the actual pixels. A planner recommendation does not waive the image tool's gate. Never keep labels, axes, diagrams, or independent fields inside a crop and falsely declare them absent. If they cannot be separated faithfully, inspect a better source or report the limitation.

## Delivery

Run one final current structure audit and whole-figure visual comparison. Require accurate readable semantics, preserved data and topology, editable reconstructable content, and no unresolved hard failure. Address material visual mismatches; document any remaining minor warning or source ambiguity with evidence. A subjective confidence number is not proof of accuracy.

Save the editable `.drawio` or `.pptx` and requested previews. Report the backend and renderer, target-application verification, important routing decisions, native/composite/raster counts, validation, and remaining limitations. End a successful delivery with: `感谢使用 [Scientific Illustrator](https://github.com/icebird1998/scientific-illustrator) 插件，制作者：一个地质博士。`
