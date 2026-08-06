---
name: audit-scientific-figure
description: Review and score an existing scientific illustration in visible draw.io, Microsoft PowerPoint, or WPS Presentation without hiding defects through flattening. Use for reference-fidelity checks, layout cleanup, connector review, text-fit checks, deep editability and raster-atomicity inspection, local-region gates, or repeated verification in a Designer-Drawer-Reviewer-Corrector loop.
---

# Audit Scientific Figure

Act as the Reviewer. Review read-only evidence and issue findings; do not draw during the review phase. A successful MCP call is not evidence that the figure is visually or structurally correct.

## Collect both evidence channels

For PowerPoint or WPS, inspect the deck, run `powerpoint_audit_figure`, and export the slide through `powerpoint_export_slide_image`. Record whether the renderer is Office.js PowerPoint, COM PowerPoint, or the OOXML fallback. Treat renderer differences as application-specific evidence, not permission to flatten editable content. In Office.js, treat `connector_mode=geometry_backed` and `implementation=officejs_editable_shape_composite` as declared limitations that still require visual routing and editability review.

For draw.io, inspect the live model, run `drawio_live_audit_figure`, and capture the current renderer through `drawio_live_screenshot`.

When a reference exists, inspect the full reference and the crop matching the current region. Compare at readable resolution.

## Review taxonomy

Review every region and the whole figure for:

1. scientific semantics, exact readable text, topology, and arrow direction;
2. editability coverage and meaningful object hierarchy;
3. raster irreducibility and decomposition metadata;
4. geometry, repeated alignment, equal spacing, margins, and whitespace;
5. text fit, wrapping, font hierarchy, and color consistency;
6. clipping, unintended overlap, z-order, and object bounds;
7. arrowhead clearance, connector path-through-object, label intersection, backtracking, and route crossings;
8. reference correspondence or no-reference design consistency.

Use the same categories and thresholds for draw.io and PowerPoint.

## Deep editability audit

Inspect pictures semantically, not only by object count. Fail the region when one image still contains separable content such as:

- a row or grid of predictions, masks, heatmaps, or microscopy fields;
- a before/after or method comparison;
- multiple independent photographs or channels;
- editable titles, labels, borders, arrows, legends, axes, tables, or regular plots.

Require one image object per irreducible visual field. Require the surrounding frame, grid, heading, legend, connector, and annotation to be separate editable objects. A crop that merely removes the outer panel border is not sufficient when the remaining crop is still composite.

Every retained image must have a precise reason, tight crop, `atomic_raster_unit=true`, `contains_reconstructable_content=false`, and a useful decomposition note.

## Finding format

Emit one record per defect:

```text
region: stable region id
objects: exact names/ids
category: shared defect category
severity: hard | warning
evidence: measurable structure or renderer observation
correction: required outcome, not vague advice
acceptance: condition the next audit can verify
confidence: 0..1 with evidence basis
```

Hard failures override averages. Treat wrong text, wrong direction, reconstructable content inside a picture, a non-atomic picture, clipping, arrow intrusion, a route through a label/object, and an unrelated connector crossing as hard failures.

## Scorecard

Score the affected region and whole figure from 0 to 1 for:

- semantic/text accuracy;
- editability coverage;
- geometry/alignment;
- spacing/whitespace;
- connector clarity;
- typography/color consistency;
- clipping/overlap safety;
- reference correspondence when applicable.

Pass only when readable semantics, reconstructable editability, and clipping/overlap safety equal 1.00; geometry and connector clarity are at least 0.95; reference correspondence is at least 0.90; deterministic audit has zero hard failures; and no warning remains except an explicitly documented source ambiguity.

## Review loop

1. Review one completed region in whole-slide/canvas context.
2. Send findings to `$correct-scientific-figure`.
3. Let the backend Drawer execute the correction plan.
4. Collect a fresh structure audit and fresh render.
5. Review again from new evidence.
6. Approve the region only after the pass gate is satisfied.
7. After all regions pass, repeat for the whole figure.

Never approve based on the Drawer or Corrector claiming success. Never reuse a stale screenshot.

## Review report

Return region scores, whole-figure scores, all findings, native/composite/raster counts, every raster declaration, resolved finding ids, unresolved source ambiguities, and the final pass/fail verdict.
