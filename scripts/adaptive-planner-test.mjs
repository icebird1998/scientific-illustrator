import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planReconstruction } from '../plugins/scientific-illustrator/scripts/adaptive-planner.mjs';

const module = (kind, extra = {}) => ({ id: 'a', kind, bbox: { x: 0, y: 0, width: 80, height: 80 }, confidence: 0.95, ...extra });
const plan = (item, extra = {}) => planReconstruction({ reference_size: { width: 100, height: 100 }, modules: [item], ...extra });
const decision = (item) => plan(item).modules[0];

test('text and connectors remain editable regardless of complexity or repeated fidelity complaints', () => {
  for (const kind of ['text', 'connector', 'geometry', 'table']) {
    const result = decision(module(kind, { complexity: 1, source_available: true, feedback: { strategy: 'native', attempts: 2, issues: ['fidelity'] } }));
    assert.equal(result.strategy, 'native');
    assert.equal(result.action, 'repair');
  }
});
test('atomic photos crop while labeled photos must be decomposed into a hybrid', () => {
  assert.equal(decision(module('photo', { source_available: true })).strategy, 'crop');
  const labeled = decision(module('photo', { source_available: true, contains_labels: true }));
  assert.equal(labeled.strategy, 'hybrid');
  assert.equal(labeled.editable_overlays_required, true);
});
test('missing evidence or low confidence cannot silently become an executable crop', () => {
  for (const extra of [{}, { source_available: true, confidence: 0.2 }, { source_available: true, editable_required: true }]) {
    assert.equal(decision(module('photo', extra)).action, 'inspect');
  }
});
test('charts need verified data independently of reference image availability', () => {
  assert.equal(decision(module('chart', { source_available: true })).strategy, 'inspect');
  assert.equal(decision(module('chart', { data_available: true })).strategy, 'native');
});
test('organic illustration changes strategy after repeated fidelity failure but layout errors only repair geometry', () => {
  const organic = module('organic', { complexity: 0.55, source_available: true });
  assert.equal(decision(organic).strategy, 'native');
  assert.equal(decision({ ...organic, feedback: { strategy: 'native', attempts: 2, issues: ['fidelity'] } }).strategy, 'crop');
  assert.equal(decision({ ...organic, feedback: { strategy: 'native', attempts: 2, issues: ['layout'] } }).strategy, 'native');
});
test('crop contamination requires decomposition, never a blind repeated crop', () => {
  const result = decision(module('texture', { source_available: true, feedback: { strategy: 'crop', attempts: 1, issues: ['crop_contamination'] } }));
  assert.equal(result.strategy, 'hybrid');
  assert.equal(result.action, 'inspect');
});
test('retaining a completed module requires both renderer and structure evidence and no issues', () => {
  const result = decision(module('geometry', { feedback: { strategy: 'native', attempts: 1, issues: [], structure_ok: true, visual_ok: true } }));
  assert.equal(result.action, 'retain');
  assert.notEqual(decision(module('geometry', { feedback: { strategy: 'native', attempts: 1, issues: [], structure_ok: true } })).action, 'retain');
  assert.notEqual(decision(module('geometry', { feedback: { strategy: 'native', attempts: 1, issues: ['semantic'], structure_ok: true, visual_ok: true } })).action, 'retain');
});
test('bounded correction stops honestly without marking unresolved work accepted', () => {
  const result = decision(module('geometry', { feedback: { strategy: 'native', attempts: 3, issues: ['layout'] } }));
  assert.equal(result.action, 'stop');
  assert.equal(result.accepted, false);
});
test('a verified hybrid is retained after its overlays have passed structure and visual checks', () => {
  const result = decision(module('photo', { source_available: true, contains_labels: true, feedback: { strategy: 'hybrid', attempts: 3, issues: [], structure_ok: true, visual_ok: true } }));
  assert.equal(result.action, 'retain');
  assert.equal(result.accepted, true);
});
test('fully editable mixed content never receives a raster hybrid recommendation', () => {
  const result = decision(module('mixed', { source_available: true, editable_required: true }));
  assert.equal(result.strategy, 'inspect');
  assert.match(result.reasons.join(' '), /native|editable/);
});
test('accepted organic representations do not oscillate when complexity estimates change', () => {
  for (const [strategy, complexity] of [['native', 1], ['crop', 0]]) {
    const result = decision(module('organic', { source_available: true, complexity, feedback: { strategy, attempts: 1, issues: [], structure_ok: true, visual_ok: true } }));
    assert.equal(result.strategy, strategy);
    assert.equal(result.action, 'retain');
  }
});
test('risk reduces batch size without removing final visual review or adding animation delays', () => {
  const low = plan(module('geometry'));
  const high = plan(module('unknown', { confidence: 0.3 }));
  assert.ok(high.execution.max_operations_per_batch < low.execution.max_operations_per_batch);
  assert.equal(low.execution.step_delay_ms, 0);
  assert.equal(low.requires_visual_review, true);
  assert.equal(high.requires_visual_review, true);
});
test('planner rejects invalid bounds, duplicate ids, unknown fields and non-finite feature values', () => {
  assert.throws(() => plan(module('photo', { bbox: { x: 90, y: 0, width: 80, height: 80 } })), /bounds/);
  assert.throws(() => plan(module('photo'), { modules: [module('photo'), module('text')] }), /Duplicate/);
  assert.throws(() => plan(module('photo', { confidence: NaN })), /confidence/);
  assert.throws(() => plan(module('photo', { pretend: true })), /pretend/);
  assert.throws(() => plan(module('not-a-kind')), /kind/);
});
