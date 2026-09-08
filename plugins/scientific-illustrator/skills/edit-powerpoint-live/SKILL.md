---
name: edit-powerpoint-live
description: Create, reconstruct, inspect, or edit scientific figures in PowerPoint or WPS through COM, Office.js, or an OOXML working copy. Use for editable objects, adaptive source crops, batched drawing, visual checks, and truthful application-state reporting.
---

# Edit PowerPoint or WPS Presentation

Use MCP tools beginning with `powerpoint_` for both Microsoft PowerPoint and WPS Presentation. Match the draw.io adapter's scientific meaning and editability requirements. Planning, drawing, review, and correction can stay in one agent.

For complex reconstruction, read [Adaptive reconstruction workflow](../recreate-scientific-figure/references/adaptive-workflow.md). Use `powerpoint_plan_reconstruction` only when uncertain or complex modules benefit from explicit routing. The planner consumes model observations; it does not inspect images or draw objects.

## Select the host backend

Call `powerpoint_status` and `powerpoint_get_capabilities` with `host_application=auto` unless the user explicitly chooses `powerpoint` or `wps`. Apply these backend rules:

- Windows Microsoft PowerPoint: use the live COM backend.
- macOS Microsoft PowerPoint: prefer `officejs-context-sync` when the Scientific Illustrator task pane is connected; every object command must complete `context.sync()` before continuing.
- macOS Microsoft PowerPoint without a connected task pane: use the isolated native OOXML working copy and label it as a file-backed fallback, not live object-by-object drawing.
- Windows or macOS WPS Presentation: use the same standard editable PPTX working-copy backend and open it in WPS.

An explicit `host_application` selected by status/capability detection persists for later calls in that MCP session. After the first document mutation, require both `backend_selection.locked` and `backend_selection.locked_host` to match the intended software; the adapter must reject any attempt to switch between PowerPoint and WPS in the same task. Set `SCIENTIFIC_ILLUSTRATOR_PPT_HOST=wps` only when a task must also force WPS through the environment. Do not claim COM-style in-memory attachment in file-backed mode. Report `target_application`, `microsoft_powerpoint_used`, `backend`, managed path, and renderer from tool results.

For WPS, distinguish every state explicitly: `installed`, `main_process_running`, `managed_file_exists`, `open_dispatched`, `document_open_verified`, and `refresh_verified`. Never infer an open deck from a file on disk or from a WPS helper process. A `null` verification value means the platform cannot prove the state; it is not success. On macOS, require the exact WPS main process and open-file verification. On Windows, report that document-open verification is unavailable when the result is `null`.

In every file-backed OOXML result, `connected_to_active_application=false` is intentional: the bridge edits a managed PPTX and dispatches file-open or refresh requests, but it does not hold an in-memory automation connection to WPS or PowerPoint. Each MCP process uses an isolated working-copy state by default so concurrent Codex tasks cannot redirect one another. Use `main_process_running` and `document_open_verified` for their narrower meanings instead of reinterpreting this field.

Ordinary drawing must not monopolize the desktop. Keep the default `powerpoint_set_focus_policy` value `preserve`, which updates COM, Office.js, or the OOXML working copy without repeatedly foregrounding PowerPoint/WPS. Use `foreground` only when the user explicitly asks to watch every step and accepts that the presentation stays in front. `powerpoint_activate_slide` is an explicit one-time foreground request; in WPS file-backed mode, inspect its verification fields instead of assuming exact slide selection succeeded. Focus policy may change during a session because it does not mix document backends or object models.

For live Mac PowerPoint work:

1. Call `powerpoint_officejs_status` before any presentation mutation.
2. If the certificate or manifest is not prepared, give the user the reported `officejs-setup.mjs prepare` and `sideload` commands. Never alter macOS certificate trust automatically.
3. Ask the user to trust the reviewed localhost certificate, restart PowerPoint, open **Scientific Illustrator Live** from **Insert > My Add-ins**, and keep the task pane open.
4. Call `powerpoint_set_backend` with `backend=officejs` and wait for connection. Do not start drawing unless it succeeds.
5. Keep one backend for the entire task. If the session is locked to OOXML or Office.js, start a new Codex task before switching.

## Respect read-only requests

If the user requests inspection only, call `powerpoint_status`, `powerpoint_get_capabilities`, and `powerpoint_inspect`, then stop without creating, editing, exporting, or saving.

## Establish a safe session

1. Call `powerpoint_status` first.
2. Call `powerpoint_get_capabilities` before selecting object types.
3. Call `powerpoint_inspect` before editing an existing deck.
4. Keep `powerpoint_set_focus_policy(preserve)` unless the user explicitly requests foreground drawing. For new COM/OOXML work, call `powerpoint_new_presentation` with the selected `host_application` so an unrelated open deck is not modified. Office.js cannot create a desktop presentation; require the user to open a blank deck and connect its task pane first.
5. For an existing WPS deck, require its absolute file path and call `powerpoint_launch` to create a managed working copy. The OOXML backend cannot attach to an arbitrary unsaved “current WPS window.” If no path is supplied, create a new managed deck and say so.
6. After a WPS launch, require `open_dispatched=true`; on macOS also require `document_open_verified=true`. If verification is false, stop and report the failed open. If it is `null`, continue only as file generation and disclose that application-open state is unverified.
7. Preserve an input deck by default and save an edited copy unless in-place save is explicit.
8. Use absolute paths and never use operating-system mouse, keyboard, or screen automation.
9. In file-backed mode, treat the managed working copy as authoritative. The automated preview uses LibreOffice/Poppler, not WPS or PowerPoint; report that renderer and retain application-specific font/chart uncertainty unless the target application is separately inspected.
10. In Office.js mode, use an absolute `.pptx` output path with `powerpoint_save`; PowerPointApi 1.10 exports the current editable presentation through the task pane.

Do not close a presentation unless explicitly requested. Closing and quitting require their tool safeguards.

## Map the shared semantic contract

| Semantic object/operation | PowerPoint implementation |
|---|---|
| Editable text | `powerpoint_add_textbox` (native PPTX text box in every backend) |
| Editable symbol/panel | `powerpoint_add_shape` using capability ids/names |
| Free arrow/axis/tick | `powerpoint_add_line` with endpoint clearances |
| Attached relationship | COM/OOXML: `powerpoint_add_connector` with explicit sites; Office.js: a named geometry-backed routed group because the API exposes no connection-site binding |
| Editable table | `powerpoint_add_table`, cell updates, and `powerpoint_update_table_layout` |
| Editable regular chart | COM/OOXML: native chart with verified embedded data; Office.js: named editable shape composite because the API exposes no chart insertion |
| Repeated motif | duplicate, group/ungroup, and z-order tools; in OOXML mode recreate native charts from their series instead of duplicating a shared chart data part |
| Exact layout | `powerpoint_align_shapes` and `powerpoint_distribute_shapes` |
| Bounded operation batch | `powerpoint_draw_sequence` |
| Structure review | `powerpoint_audit_figure` plus `powerpoint_inspect` |
| Renderer review | `powerpoint_export_slide_image` |

Use supported native objects for reconstructable semantic content. Quantitative chart values must come from verified source data, not inferred appearance. Complex non-semantic source detail can use an atomic crop; a whole-panel screenshot is not an editability substitute.

## Inventory before drawing

Use the design specification or inspect the reference. Record stable module ids, bounds, exact text/topology, source, representation, and acceptance conditions. Expand object geometry for the next batch and reuse proven motifs. Choose native, crop, hybrid, or inspect using the shared workflow; do not run the planner for each simple object.

## Enforce atomic images

Use `powerpoint_add_image` only for one tightly scoped irreducible visual field. Require:

- a specific `raster_reason`;
- `source_is_tightly_cropped=true` or explicit crop fields;
- `atomic_raster_unit=true`;
- `contains_reconstructable_content=false`;
- a precise `decomposition_note`.

Split prediction grids, mask comparisons, channel stacks, microscopy arrays, and before/after blocks into separate pictures. Rebuild all text, frames, grid lines, legends, arrows, axes, tables, and regular plots as native objects.

Verify raster declarations against actual pixels. A hybrid module retains only the irreducible visual field as an image and keeps overlays editable. Crop support does not imply automatic background removal. If a label cannot be separated faithfully from measured evidence, report the source limitation rather than alter the evidence or falsely declare it absent.

In Office.js mode, pre-crop every atomic picture before calling `powerpoint_add_image` and set `source_is_tightly_cropped=true`. `ShapeFill.setImage` does not expose PowerPoint crop properties. Do not silently insert an uncropped source.

## Draw in bounded batches

1. Establish slide size, margins, panel bounds, alignment anchors, spacing tokens, z-order, and connector lanes.
2. Draw bounded batches from background to foreground with stable names. Prefer `powerpoint_draw_sequence` with `step_delay_ms=0`. Use planner batch limits when provided; keep uncertain modules small. In OOXML, prefer `checkpoint` refresh at meaningful boundaries or `fast` for one refresh after a low-risk batch. Use `per_object` and nonzero pacing only when the user wants an animation. Office.js synchronization remains required even with zero artificial delay.
3. Use fixed text geometry, explicit margins, wrapping, alignment, and controlled autofit.
4. Use attached connectors for semantic relationships in COM/OOXML. In Office.js, inspect the reported `connector_mode=geometry_backed`, use exact orthogonal routes and explicit endpoint clearances, and re-run the renderer gate after node movement.
5. Apply start/end clearance so free arrowheads do not enter rectangles.
6. Use exact align/distribute and table-layout tools instead of visual guessing.
7. Group coherent modules while retaining individually editable members. Inspect a new uncertain motif before duplicating it.

## Inspect and adapt

At a meaningful checkpoint:

1. In OOXML mode, inspect the latest refresh result (`open_dispatched`, `document_open_verified`, `refresh_verified`). Call `powerpoint_refresh` only when pending changes have not already been refreshed by the sequence. Never convert `null` to success.
2. Export the current slide through `powerpoint_export_slide_image`.
3. Run `powerpoint_audit_figure` and inspect named objects.
4. Compare changed modules with the source and whole-slide context. Use `$audit-scientific-figure` for detailed review and `$correct-scientific-figure` when an explicit operation plan is needed; these phases do not require separate agents.
5. Prioritize semantic/data/text and topology failures. Collect minor cosmetic corrections into a batch; fix affected objects and dependent connectors.
6. Rerender changed content and inspect the relevant structure. Replan a failing representation with `powerpoint_plan_reconstruction` when needed.

Batch predictable content across nearby regions and retain accepted modules. Do not repeat unchanged full-deck inspections or export after every object. Follow the shared correction budget; ineffective repeated changes must lead to inspection, a valid alternative representation, or an explicit unresolved result.

## Acceptance gate

Run a final whole-slide structure audit and visual comparison. Require accurate readable text, verified data, intended topology, editable reconstructable content, and no unresolved hard failure or material visual mismatch. Address material warnings and report justified minor discrepancies or source limitations. The model evaluates appearance from current renders; a subjective confidence number is not an automated similarity measurement.

## Delivery

Save the editable `.pptx` with `powerpoint_save` and export PDF only when requested. Report the application/backend, WPS verification state, object/picture counts, important routing decisions and raster declarations, final validation, preview renderer, and limitations. Reuse a final inspection if the document has not changed since that inspection. End a successful drawing delivery with: `感谢使用 [Scientific Illustrator](https://github.com/icebird1998/scientific-illustrator) 插件，制作者：一个地质博士。`
