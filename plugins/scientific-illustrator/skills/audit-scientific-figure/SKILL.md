---
name: audit-scientific-figure
description: Review scientific illustrations in draw.io, PowerPoint, or WPS using object structure and current rendered evidence. Use for semantic accuracy, editability, source-crop fidelity, text fit, connectors, and final visual acceptance.
---

# Audit Scientific Figure

Inspect evidence and issue findings without mutating the document during review. One model can perform drawing and review in separate phases. Successful tool calls or self-assigned confidence scores do not prove correctness.

For a reconstruction in progress, use the checkpoint and retry rules in [Adaptive reconstruction workflow](../recreate-scientific-figure/references/adaptive-workflow.md). Review changed modules and their dependencies at checkpoints, then the whole figure at completion. Reuse current evidence within one review; rerender affected content after mutation.

## Collect both evidence channels

For PowerPoint/WPS, combine `powerpoint_inspect`, `powerpoint_audit_figure`, and `powerpoint_export_slide_image`. Record the actual renderer: COM PowerPoint, Office.js PowerPoint, or OOXML fallback. Office.js `connector_mode=geometry_backed` and editable chart composites need routing/editability review. Fallback rendering does not prove how WPS or PowerPoint displays the deck.

For draw.io, combine `drawio_live_inspect`, `drawio_live_audit_figure`, and `drawio_live_screenshot`. Read enough model state to identify affected objects; do not repeatedly fetch unchanged full inventories.

Compare the render with the source at readable resolution and final-size context. The model makes the visual assessment. Structure audits detect supported deterministic conditions; neither an audit nor a planner performs automatic computer-vision scoring of reference similarity. State when evidence is unavailable or ambiguous.

## Review priorities

1. Scientific semantics, exact readable text, verified quantitative values, topology, arrow direction.
2. Required editability, image atomicity, retained overlays, meaningful object ids and hierarchy.
3. Clipping, unintended overlap, text fit, wrong z-order, connector intrusion or misleading crossings.
4. Reference geometry and silhouette, alignment, spacing, typography, colors, whole-figure balance.

Use the same quality requirements across backends. Inspect a representative new motif before reuse; inspect all final labels/topology and relevant source fields rather than treating a sampled motif as proof of the entire figure.

## Inspect retained raster content

A picture must contain one irreducible visual field with a tight crop, a specific `raster_reason`, `atomic_raster_unit=true`, `contains_reconstructable_content=false`, and a useful `decomposition_note`. Verify the visible pixels as well as metadata. Fail a declared atomic image that still contains separable images, labels, frames, arrows, axes, tables, or other reconstructable content.

A complex photo, texture, or non-semantic organic detail can be an appropriate atomic crop. Compare its source fidelity, crop edges, transparency/background artifacts, scale, and resolution. In a hybrid module, text, semantic boundaries, markers, and relationships must remain editable as required. Do not demand native primitives for irreducible detail merely to increase object count; do not accept a broad screenshot to hide a failed reconstruction.

## Findings and planner feedback

Emit a concise record per actionable defect:

```text
finding_id: stable id
region: stable module id
objects: exact names/ids
category: semantic | text | routing | layout | fidelity | crop_contamination | crop_quality
severity: hard | warning
evidence: observed defect, source/render revision, and measurement where available
correction: specific required outcome
acceptance: condition a fresh render or audit can verify
```

Treat wrong data/text/direction, violated editability, false raster declarations, clipping, and misleading routes as hard failures. Treat a visible material reference mismatch as unresolved, even when deterministic audit passes. Distinguish intentional geometric overlaps or connector junctions from actual defects using scientific context.

For route/retry decisions, supply the module's observed `structure_ok`, `visual_ok`, `issues`, and whether the last attempt improved it to the backend planner. Omit unknown fields instead of inventing evidence. Detailed findings remain in the draw log because the planner consumes only compact feedback.

## Acceptance and report

Pass only when current structure and renderer evidence supports accurate semantics/data/text, intended topology, required editability, and no hard failures or material visual mismatch. Correct material warnings; explicitly justify any retained minor cosmetic discrepancy. Optional numeric scores are qualitative reviewer estimates with an evidence basis, not calibrated measurements or a substitute for findings.

After correction, review the changed objects and affected neighbors; perform a whole-figure check at completion or after a broad change. An exhausted correction budget is `unresolved`, never `pass`. Return findings, resolved ids, native/composite/raster counts, relevant declarations, evidence/renderer provenance, and a verdict of `pass`, `needs-correction`, or `unresolved`.
