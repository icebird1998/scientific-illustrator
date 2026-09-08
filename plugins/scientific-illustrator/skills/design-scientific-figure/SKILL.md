---
name: design-scientific-figure
description: Design an editable scientific illustration, graphical abstract, workflow, architecture figure, or mechanism diagram from a brief for draw.io, PowerPoint, or WPS. Use when the layout and visual grammar must be created without a reference figure.
---

# Design Scientific Figure

Define a compact backend-neutral design before drawing. One model may plan, draw, inspect, and correct without separate role handoffs. The selected backend changes object mapping, not scientific accuracy or quality.

Use the checkpoints and correction rules in [Adaptive reconstruction workflow](../recreate-scientific-figure/references/adaptive-workflow.md). The routing planner is optional and useful only when supplied assets create an uncertain crop/native choice; ordinary text and geometry do not need it.

## Detect constraints

Read the selected backend's capabilities first. Use `powerpoint_status` then `powerpoint_get_capabilities` for PowerPoint/WPS, or `drawio_live_get_capabilities` for draw.io. When live Mac PowerPoint is requested, also require `powerpoint_officejs_status` to report a connected task pane. Design only with semantic objects the selected adapter can create editably; use declared editable composites when a native monolithic object is unavailable.

## Define the message

Record:

- one sentence stating the scientific message;
- intended audience and reading order;
- required stages, entities, evidence, comparisons, and causal links;
- target aspect ratio and output size;
- labels or facts that must remain exact;
- uncertainty or content still needing user input.

## Build the layout system

Specify before drawing:

- outer margins, panel grid, gutters, and shared alignment anchors;
- panel ids, bounds, hierarchy, and construction order;
- standard node sizes, corner radii, stroke widths, and spacing tokens;
- title, section, label, annotation, and caption typography;
- a limited semantic palette with accessible contrast;
- reserved connector lanes and permitted entry/exit sides;
- legend, annotation, table, chart, and raster-evidence locations;
- z-order and meaningful grouping.

Prefer one clear reading path: left-to-right, top-to-bottom, or an explicitly labeled cycle. Use no more than three primary hierarchy levels.

## Design connectors

- Route process flow through reserved orthogonal lanes with few bends.
- Connect from the side facing the destination and avoid immediate backtracking.
- Keep arrows outside unrelated shapes and labels.
- Separate parallel routes by a consistent lane gap.
- Avoid crossings; if scientific topology makes one unavoidable, redesign the node placement before accepting it.
- Distinguish process, inhibition, feedback, grouping, and association with consistent conventions.
- Reserve endpoint clearance so arrowheads touch a boundary without covering the target fill or text.

## Plan editability

Classify every planned element as editable text, shape, line, connector, table/chart, repeated motif, or irreducible raster evidence. Split any multi-image evidence block into one atomic image per field and plan its title, border, grid, legend, arrows, and annotations as editable objects.

Use verified data for quantitative charts and supplied evidence for retained raster fields. Do not invent experimental results or use image synthesis to manufacture evidence. Distinguish illustrative artwork from scientific observations. Intricate non-semantic artwork can be a supplied atomic image with editable semantic overlays; a no-reference design does not authorize claiming a nonexistent source crop.

## Produce the design handoff

Return a `design_spec` containing:

- canvas/slide geometry and layout tokens;
- region and object ids with bounds and styles;
- exact text and scientific topology;
- connector source, target, sites, waypoints, lanes, and arrow convention;
- grouping and z-order;
- raster decomposition declarations;
- local construction order and acceptance conditions.

Set the shared layout and topology before drawing; specify fine object geometry just before its batch. Adjust the design from rendered evidence while preserving scientific meaning and accepted modules.

## Enter the construction loop

Use `$edit-powerpoint-live` or `$recreate-scientific-figure-in-drawio` to execute bounded sequences with zero artificial delay. Inspect the first uncertain motif before reuse, then review predictable objects by batch and cross-panel connectors at dependency boundaries. Use `$audit-scientific-figure` for detailed findings and `$correct-scientific-figure` when needed to resolve them. Correct affected objects, inspect fresh evidence, and follow the shared retry budget.

Finish with a whole-figure structure and visual check for accurate semantics/text/data, intended topology, required editability, clear layout and connectors, and no unresolved hard failure or material visual defect. Document residual minor warnings and content ambiguity. Subjective confidence scores do not replace visible evidence.

## Delivery

Save the editable source and requested exports. Report the backend, key design choices, object counts, raster declarations, final validation, and remaining limitations.
