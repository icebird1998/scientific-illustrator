# Adaptive reconstruction workflow

Use this workflow to reduce unnecessary tool calls while retaining scientific meaning, editability, and reference fidelity. The main model observes the source and the current render, chooses a representation, executes a bounded batch, and revises only what evidence shows is defective. It does not need four separate agents or user approval for each module.

## Choose a representation by module

A module is a coherent visual unit with a stable id and source bounding box, not necessarily an entire panel. Split a mixed panel into text, connectors, simple geometry, and genuinely irreducible visual fields before deciding how to build it.

| Observed content | Preferred representation | Check before execution |
|---|---|---|
| Readable text, symbols, arrows, simple geometry, regular tables | `native` | Exact text, topology, capability availability |
| Quantitative chart with verified values | `native` or editable composite | Data and axis definitions; never infer precise values from appearance |
| Chart without verified data | `inspect` | Obtain data or distinguish a schematic from measured evidence |
| Photograph, microscopy field, continuous texture | `crop` | Source exists, field is atomic, no reconstructable overlay remains |
| Intricate organic source illustration with costly non-semantic detail | `crop` or `hybrid` | Preserve semantic boundaries and editable required parts; test fidelity at final size |
| Visual field plus separable labels, markers, or arrows | `hybrid` | Raster only the field; rebuild overlays as editable objects |
| Ambiguous, low-resolution, unavailable, or inseparably labeled source | `inspect` | Enlarge/reinspect source before committing to a representation |

`native` means editable objects or supported editable composites. Complexity alone cannot justify flattening labels, topology, quantitative data, or an explicitly requested editable part. An organic silhouette with simple meaningful boundaries can still be native; do not approximate detailed non-semantic artwork using hundreds of primitives when a faithful atomic crop is appropriate.

`crop` means retaining source pixels in a bounded image object. It does not imply automatic segmentation, background removal, or extraction of obscured objects. Perform those only with an available, inspected image-editing capability and recheck the result. Never redraw or synthesize measured evidence to clean a crop. If overlays are baked into the only source and cannot be removed faithfully, report that conflict rather than mark the crop as clean.

## Optional planner tools

For several uncertain or complex modules, call `drawio_live_plan_reconstruction` or `powerpoint_plan_reconstruction`. Obvious text/shape work can be handled directly. The planner is a deterministic routing aid consuming observations supplied by the model; it does not read images, invoke another LLM, measure visual similarity, crop images, or draw objects.

Use source-pixel coordinates consistently:

```json
{
  "reference_size": { "width": 1600, "height": 900 },
  "modules": [
    {
      "id": "panel-b-specimen",
      "kind": "mixed",
      "bbox": { "x": 800, "y": 150, "width": 420, "height": 350 },
      "confidence": 0.85,
      "complexity": 0.9,
      "source_available": true,
      "editable_required": false,
      "contains_labels": true
    }
  ],
  "max_attempts": 3
}
```

Supported `kind` values are `text`, `geometry`, `connector`, `chart`, `table`, `photo`, `texture`, `organic`, `mixed`, and `unknown`. Set `data_available` for quantitative charts separately from `source_available`. Confidence describes the model's certainty in its source interpretation, not an automated quality score. `editable_required=true` requires all internal module content to be native editable objects and prevents crop fallback. Setting it false does not waive editable semantic text and relationships. If the user requires every component editable, propagate that constraint rather than relaxing it locally.

Use returned `strategy`, `action`, `risk`, `reasons`, `review`, and `editable_overlays_required` to refine the construction spec. Respect `inspect` before dependent drawing and `stop` as an unresolved result. Execution suggestions include `step_delay_ms=0`, `max_operations_per_batch`, and `checkpoint_policy`; they bound work between observations and do not weaken final acceptance.

## Observe, act, and feed back

1. **Observe:** inspect source and affected rendered module at readable resolution; use the full canvas to assess layout context. Read structure only as broadly as needed.
2. **Route:** preserve a successful representation. Replan an uncertain module when new evidence changes its fidelity, editability, or source assumptions.
3. **Execute:** send a bounded sequence in dependency order with stable ids and zero artificial delay. Reuse a reviewed motif. Keep enough log information to identify changed objects and the last successful checkpoint.
4. **Compare:** obtain one fresh render and relevant structure evidence per checkpoint. Check labels, topology, crop boundaries, alignment, silhouette, and connector clearance. Model visual assessment is qualitative evidence, separate from deterministic structure findings.
5. **Correct:** prioritize semantic/data/text errors, then topology and crop contamination, then layout/fidelity. Fix named objects and incident connectors; rerender affected content. Supply concise observed feedback to the planner only if a routing/retry decision is needed.

For a previously attempted module, add `feedback` to that module:

```json
{
  "strategy": "native",
  "attempts": 1,
  "issues": ["fidelity"],
  "structure_ok": true,
  "visual_ok": false,
  "improved": false
}
```

Feedback `issues` can include `semantic`, `text`, `routing`, `layout`, `fidelity`, `crop_contamination`, or `crop_quality`. Keep the detailed observation, exact object ids, source/render revision, and expected correction in the local draw log; the compact planner input is not a substitute for that evidence. Set `visual_ok` only after inspecting a current render. Do not mark a field true because a tool call succeeded.

## Checkpoints that preserve quality

- **Predictable content:** batch repeated text/geometry operations, then inspect the complete batch once. Reuse the established style and geometry template.
- **Uncertain content:** review the first intricate or mixed module before replicating its representation. Review a newly prepared crop before using it in many places.
- **Dependency boundaries:** inspect after connector routing, moving connected nodes, grouping/z-order changes, or a batch affecting several panels.
- **Completion:** perform one whole-figure structure audit and readable visual comparison, including cross-panel balance, typography, all semantic labels, and final exports.

An unchanged accepted module does not need another local render/inspection at each checkpoint. It is still included in the final whole-figure check. A screenshot and structure audit from the same unchanged document revision can be reused within that review; after a mutation, obtain fresh evidence for affected content.

Do not force per-object pauses or per-object exports. Use an available sequence tool rather than many independent round trips. With OOXML file-backed work, prefer checkpoint refresh; a completed sequence already refreshed by the tool does not need an immediate redundant refresh. A low-risk batch may use one end refresh. Keep Office.js synchronization and backend validation guarantees even when artificial delay is zero.

## Correction budget and stop conditions

Default to at most three correction attempts per module. If two consecutive attempts show no improvement, inspect the root cause or try a different valid representation; do not repeat the same primitive construction indefinitely. A route change does not reset the module's total budget. Preserve accepted objects and the latest editable checkpoint.

Stop correcting a module when its observed issue is resolved. Finish the figure only after current evidence supports semantic/text/data accuracy, correct topology, editability requirements, and no unresolved hard structure or visual failure. Treat small cosmetic warnings according to their actual impact and record any consciously retained discrepancy; never call unresolved material fidelity loss a pass.

If the budget is exhausted, a source ambiguity prevents a faithful result, or available tools cannot satisfy the requested editability, retain the editable work and report the exact blocked module, evidence, and required source/capability. Ask for missing information only when needed to resolve that block. Speed comes from reducing redundant work, not from erasing hard failures or silently lowering quality.
