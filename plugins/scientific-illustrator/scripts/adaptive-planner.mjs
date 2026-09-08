// A deterministic routing aid for observations supplied by the calling model.
// It does not inspect pixels, call another model, crop images, or mutate a document.
const unit = { type: 'number', minimum: 0, maximum: 1 };
const positive = { type: 'number', exclusiveMinimum: 0 };
const strategies = ['native', 'crop', 'hybrid', 'inspect'];
const kinds = ['text', 'geometry', 'connector', 'chart', 'table', 'photo', 'texture', 'organic', 'mixed', 'unknown'];
const issues = ['semantic', 'text', 'routing', 'layout', 'fidelity', 'crop_contamination', 'crop_quality'];
const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });

export const reconstructionPlanSchema = object({
  reference_size: object({ width: positive, height: positive }, ['width', 'height']),
  modules: {
    type: 'array', minItems: 1, maxItems: 200,
    items: object({
      id: { type: 'string', minLength: 1, maxLength: 160 },
      kind: { type: 'string', enum: kinds },
      bbox: object({ x: { type: 'number', minimum: 0 }, y: { type: 'number', minimum: 0 }, width: positive, height: positive }, ['x', 'y', 'width', 'height']),
      confidence: { ...unit, description: 'Calling model confidence in its module classification; not a measured image similarity.' },
      complexity: { ...unit, description: 'Calling model estimate of primitive reconstruction effort; default 0.5.' },
      source_available: { type: 'boolean', description: 'The original image is available for a local crop; does not imply chart values are available.' },
      editable_required: { type: 'boolean', description: 'All internal content must be native editable objects; blocks crop fallback.' },
      contains_labels: { type: 'boolean', description: 'Text, arrows, axes, borders or other reconstructable overlays occur inside this region.' },
      data_available: { type: 'boolean', description: 'Verified underlying values exist for a quantitative chart.' },
      feedback: object({
        strategy: { type: 'string', enum: strategies },
        attempts: { type: 'integer', minimum: 0, maximum: 100 },
        issues: { type: 'array', maxItems: 7, uniqueItems: true, items: { type: 'string', enum: issues } },
        structure_ok: { type: 'boolean' },
        visual_ok: { type: 'boolean' },
        improved: { type: 'boolean', description: 'Did the latest correction improve the observed defect? Omit if unknown.' },
      }, ['strategy', 'attempts', 'issues']),
    }, ['id', 'kind', 'bbox', 'confidence']),
  },
  max_attempts: { type: 'integer', minimum: 1, maximum: 6, default: 3 },
}, ['reference_size', 'modules']);

// MCP schemas are descriptive; validate here too because clients can bypass them.
function validate(value, schema, field = 'arguments') {
  const fail = (message) => { throw new Error(`${field}: ${message}`); };
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('expected an object');
    for (const key of schema.required) if (!Object.hasOwn(value, key)) fail(`missing ${key}`);
    for (const [key, entry] of Object.entries(value)) {
      if (!Object.hasOwn(schema.properties, key)) fail(`unknown field ${key}`);
      validate(entry, schema.properties[key], `${field}.${key}`);
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value)) fail('expected an array');
    if (value.length < (schema.minItems ?? 0) || value.length > schema.maxItems) fail('array length outside supported range');
    if (schema.uniqueItems && new Set(value).size !== value.length) fail('duplicate items');
    value.forEach((entry, i) => validate(entry, schema.items, `${field}[${i}]`));
  } else if (schema.type === 'number' || schema.type === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value)) fail('expected a finite number');
    if (schema.type === 'integer' && !Number.isInteger(value)) fail('expected an integer');
    if (value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity) || value <= (schema.exclusiveMinimum ?? -Infinity)) fail('number outside supported range');
  } else {
    if (typeof value !== schema.type) fail(`expected ${schema.type}`);
    if (schema.type === 'string' && (value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? Infinity))) fail('string length outside supported range');
  }
  if (schema.enum && !schema.enum.includes(value)) fail(`expected one of ${schema.enum.join(', ')}`);
}

function route(item, maxAttempts) {
  const feedback = item.feedback;
  const defects = feedback?.issues ?? [];
  const reasons = [];
  const nativeKinds = ['text', 'geometry', 'connector', 'table'];
  const atomicKinds = ['photo', 'texture', 'organic'];
  let strategy = 'native';
  let action = feedback ? 'repair' : 'draw';
  const inspection = (reason) => { strategy = 'inspect'; action = 'inspect'; reasons.push(reason); };

  if (nativeKinds.includes(item.kind)) {
    reasons.push('Use native objects to preserve editable content and precise geometry.');
  } else if (item.kind === 'chart') {
    if (item.data_available) reasons.push('Rebuild the chart using verified values and editable labels.');
    else inspection('Inspect the plot and obtain verified values or identify a schematic; never invent quantitative data from a reference image.');
  } else if (item.kind === 'mixed') {
    if (item.editable_required) inspection('Decompose this mixed module into native editable components; the requested full editability prohibits a crop fallback.');
    else {
      strategy = 'hybrid'; action = 'inspect';
      reasons.push('Split into atomic visual fields and separate editable overlays before drawing; a hybrid plan is not permission to rasterize this panel.');
    }
  } else if (item.kind === 'unknown') {
    inspection('Inspect a readable reference crop before choosing a construction method.');
  } else if (atomicKinds.includes(item.kind)) {
    const complexOrganic = item.kind === 'organic' && (item.complexity ?? 0.5) >= 0.8;
    const fidelityFailed = feedback?.strategy === 'native' && feedback.attempts >= 2 && defects.includes('fidelity');
    const useImage = item.kind !== 'organic' || complexOrganic || fidelityFailed;
    if (useImage) {
      if (item.editable_required) inspection('Native internal editability is required; inspect or simplify only with the user’s stated fidelity requirements preserved.');
      else if (!item.source_available) inspection('An atomic image fallback needs the original source; inspect available native alternatives.');
      else {
        strategy = item.contains_labels ? 'hybrid' : 'crop';
        reasons.push(fidelityFailed ? 'Repeated native fidelity failure warrants a source-preserving local image fallback.' : 'Preserve irreducible appearance using only the smallest source image field.');
        if (strategy === 'hybrid') { action = 'inspect'; reasons.push('Separate text, arrows, frames and other overlays; do not duplicate them inside the image.'); }
      }
    } else reasons.push('The illustration is tractable with native primitives; reuse motifs and adjust coordinates.');
  }

  if (item.confidence < 0.65) inspection('Classification confidence is low; inspect the source details before an expensive or irreversible strategy choice.');
  if (defects.includes('semantic')) inspection('Resolve the scientific meaning or label ambiguity before further drawing.');
  if (defects.includes('crop_contamination') && !nativeKinds.includes(item.kind) && item.kind !== 'chart' && !item.editable_required && item.source_available) {
    strategy = 'hybrid'; action = 'inspect';
    reasons.push('The image contains reconstructable content; re-segment it and rebuild the overlays separately.');
  }
  if (defects.includes('crop_quality') && ['crop', 'hybrid'].includes(strategy)) {
    action = 'inspect'; reasons.push('Inspect source resolution, crop bounds and background before inserting another image.');
  }

  // Accepted evidence applies to the same submitted module revision. Do not infer
  // success from object existence, subjective scores, or only one evidence channel.
  if (item.kind === 'organic' && item.confidence >= 0.65 && feedback?.structure_ok === true && feedback?.visual_ok === true && !defects.length) {
    const priorAllowed = feedback.strategy === 'native'
      || (!item.editable_required && item.source_available && (feedback.strategy === 'hybrid' || (feedback.strategy === 'crop' && !item.contains_labels)));
    if (priorAllowed) {
      strategy = feedback.strategy;
      reasons.length = 0;
      reasons.push('Keep the verified representation; a changed complexity estimate alone does not justify redrawing.');
    }
  }
  const compatible = feedback && feedback.strategy === strategy && strategy !== 'inspect'
    && (strategy !== 'hybrid' || item.source_available === true);
  const accepted = Boolean(compatible && !defects.length && feedback.structure_ok === true && feedback.visual_ok === true);
  if (accepted) {
    action = 'retain'; reasons.push('Both structure and renderer checks passed; leave this module unchanged.');
  } else if (feedback?.attempts >= maxAttempts) {
    action = 'stop'; reasons.push('Correction budget reached. Preserve the best verified version, report unresolved defects, and do not claim completion.');
  } else if (feedback?.improved === false && feedback.attempts >= 2 && feedback.strategy === strategy) {
    action = 'inspect'; reasons.push('Repeated correction did not improve the defect; inspect evidence and change the correction method before spending another batch.');
  } else if (feedback && !defects.length && (feedback.structure_ok !== true || feedback.visual_ok !== true)) {
    action = 'inspect'; reasons.push('Collect the missing structure or visual evidence before making speculative edits.');
  }

  const highRisk = action === 'inspect' || action === 'stop' || defects.length > 0 || item.kind === 'mixed';
  const risk = accepted ? 'low' : highRisk ? 'high' : strategy === 'crop' || (item.complexity ?? 0.5) > 0.65 ? 'medium' : 'low';
  return {
    id: item.id, bbox: item.bbox, strategy, action, accepted, risk, reasons,
    editable_overlays_required: strategy === 'hybrid' || Boolean(item.contains_labels),
    review: accepted ? 'Reuse evidence only while this module and its connected objects are unchanged.' : risk === 'high' ? 'Inspect source details first where requested; then compare this module’s renderer crop and object structure at the next checkpoint.' : 'Check structure and renderer after a coherent batch; include the whole figure in the final check.',
  };
}

export function planReconstruction(args) {
  validate(args, reconstructionPlanSchema);
  const seen = new Set();
  for (const item of args.modules) {
    if (seen.has(item.id)) throw new Error(`Duplicate module id: ${item.id}`);
    seen.add(item.id);
    const box = item.bbox;
    if (box.x + box.width > args.reference_size.width || box.y + box.height > args.reference_size.height) throw new Error(`Module ${item.id}: bbox exceeds reference bounds`);
  }
  const modules = args.modules.map((item) => route(item, args.max_attempts ?? 3));
  const pending = modules.filter((item) => item.action !== 'retain');
  const risk = pending.some((item) => item.risk === 'high') ? 'high' : pending.some((item) => item.risk === 'medium') ? 'medium' : 'low';
  return {
    schema_version: 1,
    observation_source: 'calling_model',
    automatic_image_analysis: false,
    modules,
    execution: {
      step_delay_ms: 0,
      max_operations_per_batch: { low: 40, medium: 20, high: 8 }[risk],
      checkpoint_policy: 'Batch simple/repeated objects; inspect uncertain modules before drawing; audit structure plus renderer at each coherent checkpoint and the final whole figure.',
      max_attempts: args.max_attempts ?? 3,
    },
    requires_visual_review: true,
    unresolved_module_ids: modules.filter((item) => item.action === 'stop' || item.action === 'inspect').map((item) => item.id),
    note: 'Routing uses model-supplied observations, not measured image similarity. Apply it to ambiguous modules; routine native objects do not need repeated planner calls. Cropping is not automatic background removal. Preserve stable object ids and inspect a partial failure before resuming; never replay completed mutations blindly.',
  };
}

export function reconstructionPlanTool(name) {
  return {
    name,
    description: 'Plan uncertain figure modules from the calling model’s reference observations and optional checkpoint feedback. Returns native/crop/hybrid/inspect routing, bounded batch guidance and targeted review actions. Read-only: does not analyze pixels, crop images, draw, or call an external model. Simple native objects do not need repeated planning calls.',
    inputSchema: reconstructionPlanSchema,
  };
}
