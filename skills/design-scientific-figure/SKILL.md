---
name: design-scientific-figure
description: Design a new scientific illustration, graphical abstract, workflow, architecture figure, or mechanism diagram from a brief without a reference image, for visible draw.io, Microsoft PowerPoint, or WPS Presentation. Use when a clean editable layout, planned connector lanes, consistent visual grammar, and Designer-to-Drawer-to-Reviewer-to-Corrector quality gates are required.
---

# Design Scientific Figure

Act as the Designer in the four-role Scientific Illustrator protocol. Produce a backend-neutral design specification before the Drawer adds any object. The selected backend affects object mapping, not the design quality or acceptance gate.

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

## Produce the design handoff

Return a `design_spec` containing:

- canvas/slide geometry and layout tokens;
- region and object ids with bounds and styles;
- exact text and scientific topology;
- connector source, target, sites, waypoints, lanes, and arrow convention;
- grouping and z-order;
- raster decomposition declarations;
- local construction order and acceptance conditions.

Do not improvise geometry one object at a time after drawing begins.

## Enter the construction loop

Hand the design to `$edit-powerpoint-live` or `$recreate-scientific-figure-in-drawio`. After each region, require `$audit-scientific-figure`; when it finds a defect, require `$correct-scientific-figure`, return the object-level plan to the Drawer, rerender, and review again.

Finish only when every local region and the whole figure have exact readable semantics, full reconstructable editability, no clipping or unintended overlap, layout and connector confidence of at least 0.95, and no unresolved audit finding except documented content ambiguity.

## Delivery

Save the editable source and requested exports. Report the selected backend, design tokens, object counts, raster declarations, local gates, whole-figure gate, and remaining content ambiguity.
