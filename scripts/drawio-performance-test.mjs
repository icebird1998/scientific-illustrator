import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { planReconstruction, reconstructionPlanTool } from "../plugins/scientific-illustrator/scripts/adaptive-planner.mjs";

// Run the real MCP dispatch and generated renderer expressions against a small
// deterministic mxGraph fake. This measures transport/delay overhead, not UI FPS.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(path.join(root, "plugins/scientific-illustrator/scripts/live-server.mjs"), "utf8");
const serverBody = source.slice(source.indexOf("const SERVER_NAME"), source.indexOf("const rl ="));
const plain = (value) => JSON.parse(JSON.stringify(value));

function createHarness({ screenshotFailure = false, transportFailure = false } = {}) {
  const metrics = { calls: [], delays: [], renderCommits: 0, selections: 0, scrolls: 0, screenshots: 0 };
  class Geometry {
    constructor(x = 0, y = 0, width = 0, height = 0) { Object.assign(this, { x, y, width, height }); }
    clone() { return Object.assign(new Geometry(), this); }
    setTerminalPoint(point, source) { this[source ? "sourcePoint" : "targetPoint"] = point; }
  }
  class Cell {
    constructor(value = "", geometry = null, style = "") { Object.assign(this, { value, geometry, style, children: [] }); }
    setVertex(value) { this.vertex = value; }
    setId(id) { this.id = id; }
    setGeometry(geometry) { this.geometry = geometry; }
    getGeometry() { return this.geometry; }
    getChildCount() { return this.children.length; }
    getChildAt(index) { return this.children[index]; }
  }
  const cells = new Map();
  const parent = new Cell(); parent.id = "root";
  let updateLevel = 0;
  const model = {
    getCell: (id) => cells.get(id),
    beginUpdate() { updateLevel += 1; },
    endUpdate() { updateLevel -= 1; assert.ok(updateLevel >= 0); if (!updateLevel) metrics.renderCommits += 1; },
    setGeometry(cell, geometry) { cell.geometry = geometry; },
    setStyle(cell, style) { cell.style = style; },
    add(container, cell) { cells.set(cell.id, cell); container.children.push(cell); cell.parent = container; return cell; },
  };
  const renderers = Object.fromEntries(["rectangle", "ellipse", "rhombus", "text", "image", "triangle"].map((name) => [name, {}]));
  const graph = {
    getModel: () => model,
    getDefaultParent: () => parent,
    getStylesheet: () => ({ styles: {} }),
    getCellStyle(cell) {
      const style = {};
      for (const token of cell.style.split(";")) {
        if (token.includes("=")) { const [key, value] = token.split("="); style[key] = value; }
        else if (renderers[token]) style.shape = token;
      }
      return style;
    },
    insertVertex(container, id, value, x, y, width, height, style) {
      const cell = new Cell(value, new Geometry(x, y, width, height), style);
      cell.id = id; cell.vertex = true; return model.add(container, cell);
    },
    insertEdge(container, id, value, source, target, style) {
      const cell = new Cell(value, new Geometry(), style);
      Object.assign(cell, { id, source, target, edge: true }); return model.add(container, cell);
    },
    convertValueToString: (cell) => typeof cell.value === "string" ? cell.value : cell.value.getAttribute("label"),
    cellLabelChanged(cell, value) { cell.value = value; },
    setSelectionCell(cell) { metrics.selections += 1; graph.selection = cell; },
    setSelectionCells(items) { metrics.selections += 1; graph.selection = items.at(-1); },
    clearSelection() { graph.selection = null; },
    scrollCellToVisible() { metrics.scrolls += 1; },
    view: { scale: 1 },
    fit() { graph.view.scale = 0.8; },
    zoomTo(value) { graph.view.scale = value; },
  };
  const renderer = vm.createContext({
    window: { __codexDrawioGraph: graph, ui: { editor: { graph } } },
    mxCell: Cell, mxGeometry: Geometry, mxPoint: class { constructor(x, y) { Object.assign(this, { x, y }); } },
    mxConstants: { STYLE_SHAPE: "shape" }, mxCellRenderer: { defaultShapes: renderers },
    mxStencilRegistry: { stencils: {}, getStencil: () => undefined },
    mxUtils: { createXmlDocument: () => ({ createElement: () => { const attrs = {}; return { setAttribute: (key, value) => { attrs[key] = value; }, getAttribute: (key) => attrs[key] || "" }; } }) },
    document: { title: "fake draw.io" }, location: { href: "file:///drawio/index.html" }, innerWidth: 1000, innerHeight: 800,
    requestAnimationFrame: (callback) => callback(0), setTimeout: (callback) => callback(), performance,
  });
  const server = vm.createContext({
    process, Buffer, console, path, os, performance, planReconstruction, reconstructionPlanTool,
    resolveDrawioExecutable: () => ({ executable: "fake-drawio", source: "test" }),
    WebSocket: { OPEN: 1 },
    setTimeout: (callback, ms) => { metrics.delays.push(ms); callback(); return 0; }, clearTimeout: () => {},
  });
  vm.runInContext(`${serverBody}\nglobalThis.harness = { handleTool, handleMessage, live, tools };`, server);
  server.harness.live.cdp = {
    ws: { readyState: 1 },
    async call(method, params) {
      metrics.calls.push(method);
      if (method === "Page.captureScreenshot") { metrics.screenshots += 1; if (screenshotFailure) throw new Error("Screenshot timed out"); return { data: "ZmFrZQ==" }; }
      assert.equal(method, "Runtime.evaluate");
      if (transportFailure) throw new Error("Debugging channel closed");
      try { return { result: { value: plain(await vm.runInContext(params.expression, renderer)) } }; }
      catch (error) { return { exceptionDetails: { exception: { description: error.message } } }; }
    },
  };
  return { ...server.harness, cells, graph, metrics, renderer };
}

const shapes = (count) => Array.from({ length: count }, (_, index) => ({ type: "shape", id: `node-${index}`, label: `Node ${index}`, x: index * 20, y: 10, width: 18, height: 12, shape: "rectangle" }));
const snapshot = (harness) => [...harness.cells.values()].map((cell) => ({ id: cell.id, value: typeof cell.value === "string" ? cell.value : cell.value.getAttribute("label"), geometry: plain(cell.geometry), style: cell.style, source: cell.source?.id, target: cell.target?.id }));
const tests = [];
const test = (name, run) => tests.push({ name, run });

test("default sequence batches identical editable objects without per-object delay", async () => {
  const input = shapes(100);
  const harness = createHarness();
  const result = await harness.handleTool("drawio_live_draw_sequence", { operations: input, screenshot_after: false });
  assert.equal(result.value.operations_applied, 100);
  assert.deepEqual([...harness.cells.keys()], input.map((item) => item.id));
  console.log(`100 default shapes: ${harness.metrics.calls.length} CDP calls, ${harness.metrics.delays.reduce((sum, value) => sum + value, 0)} ms requested waits, ${harness.metrics.renderCommits} render commits`);
  assert.equal(harness.metrics.delays.reduce((sum, value) => sum + value, 0), 0);
  assert.ok(harness.metrics.calls.length <= 4);
  assert.ok(harness.metrics.renderCommits <= 4);
  assert.equal(result.value.execution.mode, "batched");
  assert.equal(result.value.execution.batches, 4);
});

test("paced and batched modes produce the same ordered shape, edge, update and line data", async () => {
  const input = [...shapes(4), { type: "edge", id: "link", source: "node-0", target: "node-3" }, { type: "update", id: "node-0", label: "Edited", x: 12 }, { type: "line", id: "axis", begin_x: 0, begin_y: 0, end_x: 20, end_y: 0, end_clearance: 2 }];
  const paced = createHarness(); const batched = createHarness();
  await paced.handleTool("drawio_live_draw_sequence", { operations: input, execution_mode: "paced", step_delay_ms: 20, screenshot_after: false });
  await batched.handleTool("drawio_live_draw_sequence", { operations: input, execution_mode: "batched", batch_size: 3, screenshot_after: false });
  assert.deepEqual(snapshot(batched), snapshot(paced));
  assert.equal(paced.metrics.delays.reduce((sum, value) => sum + value, 0), input.length * 20);
  assert.equal(batched.metrics.delays.reduce((sum, value) => sum + value, 0), 0);
});

test("explicit positive delays retain paced playback and zero disables timer scheduling", async () => {
  const harness = createHarness();
  const result = await harness.handleTool("drawio_live_draw_sequence", { operations: shapes(3), step_delay_ms: 9, screenshot_after: false });
  assert.equal(result.value.execution.mode, "paced");
  assert.deepEqual(harness.metrics.delays, [9, 9, 9]);
  const zero = createHarness();
  await zero.handleTool("drawio_live_add_shape", { ...shapes(1)[0], pause_after_ms: 0 });
  assert.deepEqual(zero.metrics.delays, []);
});

test("batch stops at duplicate id with exact failure and no replay or later mutation", async () => {
  const harness = createHarness();
  const operations = [...shapes(2), { ...shapes(1)[0] }, { ...shapes(1)[0], id: "after-failure" }];
  const response = await harness.handleMessage({ id: 1, method: "tools/call", params: { name: "drawio_live_draw_sequence", arguments: { operations, execution_mode: "batched", screenshot_after: false } } });
  assert.equal(response.result.isError, true);
  const result = response.result.structuredContent;
  assert.equal(result.operations_applied, 2);
  assert.equal(result.failure.index, 2);
  assert.equal(result.failure.id, "node-0");
  assert.match(result.failure.error, /already exists/);
  assert.deepEqual([...harness.cells.keys()], ["node-0", "node-1"]);
  assert.equal(harness.metrics.renderCommits, 1);
});

test("batch validates renderer names and explicit styles before inserting the failed object", async () => {
  for (const extra of [{ shape: "imaginary-shape" }, { style: "shape=imaginary-shape;" }, { style: "imaginary-style;" }]) {
    const harness = createHarness();
    const response = await harness.handleMessage({ id: 1, method: "tools/call", params: { name: "drawio_live_draw_sequence", arguments: { operations: [{ ...shapes(1)[0], ...extra }], execution_mode: "batched", screenshot_after: false } } });
    assert.equal(response.result.isError, true);
    assert.equal(harness.cells.size, 0);
    assert.equal(response.result.structuredContent.failure.index, 0);
  }
});

test("wait and fit preserve ordering and a successful sequence captures only one screenshot", async () => {
  const harness = createHarness();
  const response = await harness.handleTool("drawio_live_draw_sequence", { operations: [...shapes(2), { type: "wait", ms: 15 }, { type: "fit", zoom_percent: 125 }, { type: "update", id: "node-1", label: "Last" }], execution_mode: "batched", batch_size: 100 });
  assert.equal(response.value.operations_applied, 5);
  assert.equal(harness.graph.view.scale, 1.25);
  assert.deepEqual(harness.metrics.delays, [15]);
  assert.equal(harness.metrics.screenshots, 1);
  assert.equal(harness.cells.get("node-1").value, "Last");
});

test("invalid sequence bounds and unsupported operations are rejected before any canvas mutation", async () => {
  for (const args of [{ batch_size: 0 }, { batch_size: 101 }, { batch_size: 2.5 }, { execution_mode: "unknown" }, { step_delay_ms: -1 }, { operations: [...shapes(1), { type: "unknown" }] }]) {
    const harness = createHarness();
    const response = await harness.handleMessage({ id: 1, method: "tools/call", params: { name: "drawio_live_draw_sequence", arguments: { operations: shapes(1), ...args } } });
    assert.equal(response.result.isError, true);
    assert.equal(harness.cells.size, 0);
  }
});

test("screenshot failure retains successful drawing results so clients do not replay mutations", async () => {
  const harness = createHarness({ screenshotFailure: true });
  const response = await harness.handleMessage({ id: 1, method: "tools/call", params: { name: "drawio_live_draw_sequence", arguments: { operations: shapes(3) } } });
  assert.equal(response.result.isError, false);
  assert.equal(response.result.structuredContent.operations_applied, 3);
  assert.match(response.result.structuredContent.screenshot_error, /Screenshot timed out/);
  assert.equal(harness.cells.size, 3);
});

test("a transport error never retries a possibly applied batch and reports uncertain indexes", async () => {
  const harness = createHarness({ transportFailure: true });
  const response = await harness.handleMessage({ id: 1, method: "tools/call", params: { name: "drawio_live_draw_sequence", arguments: { operations: shapes(3), screenshot_after: false } } });
  assert.equal(response.result.isError, true);
  assert.equal(response.result.structuredContent.failure.outcome_unknown, true);
  assert.deepEqual(plain(response.result.structuredContent.failure.attempted_indexes), [0, 1, 2]);
  assert.equal(harness.metrics.calls.length, 1);
});

let failures = 0;
for (const { name, run } of tests) {
  try { await run(); console.log(`PASS ${name}`); }
  catch (error) { failures += 1; console.error(`FAIL ${name}\n${error.stack}`); }
}
if (failures) process.exitCode = 1;
else console.log(`Draw.io performance regression tests passed (${tests.length}).`);
