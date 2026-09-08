import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundledPython = path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe");
if (!process.argv.includes("--baseline")) {
  const pythonCandidates = [process.env.SCIENTIFIC_ILLUSTRATOR_PYTHON, bundledPython, path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3"), "python3", "python.exe"].filter(Boolean);
  let python;
  for (const candidate of pythonCandidates) {
    try { await promisify(execFile)(candidate, ["-c", "import pptx"], { windowsHide: true }); python = candidate; break; } catch {}
  }
  if (!python) throw new Error("PowerPoint batch tests require Python with python-pptx.");
  await promisify(execFile)(python, [path.join(root, "scripts/powerpoint-batch-unit.py")], { windowsHide: true, maxBuffer: 1024 * 1024 });
  process.env.SCIENTIFIC_ILLUSTRATOR_PYTHON = python;
}
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "scientific-illustrator-ppt-perf-"));
const child = spawn(process.execPath, [path.join(root, "plugins/scientific-illustrator/scripts/powerpoint-server.mjs")], {
  cwd: root,
  stdio: ["pipe", "pipe", "pipe"],
  env: {
    ...process.env,
    ...(process.env.SCIENTIFIC_ILLUSTRATOR_PYTHON ? {} : existsSync(bundledPython) ? { SCIENTIFIC_ILLUSTRATOR_PYTHON: bundledPython } : {}),
    SCIENTIFIC_ILLUSTRATOR_PPT_HOST: "wps",
    SCIENTIFIC_ILLUSTRATOR_PPT_BACKEND: "ooxml",
    SCIENTIFIC_ILLUSTRATOR_STATE_DIR: temporary,
    SCIENTIFIC_ILLUSTRATOR_POWERPOINT_SYNC: "0",
  },
});
const lines = createInterface({ input: child.stdout });
const pending = new Map();
let stderr = "";
let nextId = 0;
child.stderr.on("data", (chunk) => { stderr += chunk; });
lines.on("line", (line) => {
  const message = JSON.parse(line);
  const resolve = pending.get(message.id);
  if (resolve) { pending.delete(message.id); resolve(message.result); }
});
async function request(method, params = {}) {
  const id = ++nextId;
  let timer;
  try {
    return await Promise.race([
      new Promise((resolve) => { pending.set(id, resolve); child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`); }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`RPC timeout: ${method}. ${stderr}`)), 60000); }),
    ]);
  } finally { clearTimeout(timer); pending.delete(id); }
}
const call = (name, args = {}) => request("tools/call", { name, arguments: args });
function shape(name, left = 10) {
  return { type: "add_shape", slide_index: 1, name, shape: "rectangle", left, top: 10, width: 20, height: 10 };
}
async function inventory() {
  const result = await call("powerpoint_inspect", { max_slides: 1, max_shapes_per_slide: 1000 });
  assert.equal(result.isError, undefined, JSON.stringify(result));
  return result.structuredContent.slides[0].shapes;
}

try {
  assert.equal((await call("powerpoint_new_presentation")).isError, undefined);
  const operations = Array.from({ length: 30 }, (_, index) => shape(`bench-${index}`, 10 + index));
  const started = performance.now();
  const measured = await call("powerpoint_draw_sequence", { operations, pacing_mode: "fast", step_delay_ms: 0 });
  const elapsed = Math.round(performance.now() - started);
  assert.equal(measured.isError, undefined, JSON.stringify(measured));
  assert.equal((await inventory()).length, 30);
  console.log(JSON.stringify({ benchmark: "30 native rectangles, OOXML, sync disabled", elapsed_ms: elapsed, batch_count: measured.structuredContent.batch_count ?? null }));
  if (!process.argv.includes("--baseline")) {
    assert.equal(measured.structuredContent.batch_count, 2, "30 objects should require two bounded bridge batches");
    const listed = await request("tools/list");
    const sequenceSchema = listed.tools.find((tool) => tool.name === "powerpoint_draw_sequence").inputSchema;
    assert.equal(sequenceSchema.properties.step_delay_ms.default, 0, "ordinary drawing has no artificial pause");
    const malformed = await call("powerpoint_draw_sequence", { operations: [shape("preflight-must-not-appear"), { type: "unsupported" }] });
    assert.equal(malformed.isError, true);
    assert(!(await inventory()).some((item) => item.shape_name === "preflight-must-not-appear"), "invalid operation types are rejected before mutation");

    const relational = await call("powerpoint_draw_sequence", {
      pacing_mode: "fast", operations: [
        shape("batch-source", 100), shape("batch-target", 200),
        { type: "add_connector", slide_index: 1, name: "batch-link", source_name: "batch-source", target_name: "batch-target" },
        { type: "update_shape", slide_index: 1, shape_name: "batch-source", text: "native & editable" },
      ],
    });
    assert.equal(relational.isError, undefined, JSON.stringify(relational));
    assert.equal(relational.structuredContent.batch_count, 1);
    const linked = await inventory();
    assert(linked.some((item) => item.shape_name === "batch-link"));
    assert.equal(linked.find((item) => item.shape_name === "batch-source").text, "native & editable");

    const failure = await call("powerpoint_draw_sequence", {
      pacing_mode: "fast", batch_size: 2,
      operations: [shape("committed-a"), shape("committed-b"), shape("committed-c"), { ...shape("failed-partial-object"), fill_color: "invalid" }],
    });
    assert.equal(failure.isError, true);
    assert.equal(failure.structuredContent.failed_operation_index, 3);
    assert.equal(failure.structuredContent.object_operations_applied, 3);
    assert.equal(failure.structuredContent.failed_operation_rolled_back, true);
    const afterFailure = await inventory();
    assert(afterFailure.some((item) => item.shape_name === "committed-a"));
    assert(afterFailure.some((item) => item.shape_name === "committed-b"));
    assert(afterFailure.some((item) => item.shape_name === "committed-c"));
    assert(!afterFailure.some((item) => item.shape_name === "failed-partial-object"));
    assert.equal((await call("powerpoint_draw_sequence", { operations: [shape("recovered")], pacing_mode: "fast" })).isError, undefined);

    const invalidSize = await call("powerpoint_draw_sequence", { operations: [shape("invalid-size")], batch_size: 101 });
    assert.equal(invalidSize.isError, true);

    const unicodeText = "中文β🙂&<editable>".repeat(3000);
    const largePayload = await call("powerpoint_draw_sequence", {
      pacing_mode: "fast", operations: [{ type: "add_textbox", slide_index: 1, name: "大载荷", text: unicodeText, left: 10, top: 80, width: 200, height: 30 }],
    });
    assert.equal(largePayload.isError, undefined, JSON.stringify(largePayload));
    assert.equal((await inventory()).find((item) => item.shape_name === "大载荷").text, unicodeText);

    const waited = await call("powerpoint_draw_sequence", { pacing_mode: "fast", operations: [shape("before-wait"), { type: "wait", ms: 0 }, shape("after-wait")] });
    assert.equal(waited.isError, undefined, JSON.stringify(waited));
    assert.equal(waited.structuredContent.batch_count, 2);
    assert.deepEqual(waited.structuredContent.results.map((item) => item.index), [0, 1, 2]);
    console.log("PowerPoint bounded batching, dependency order, preflight, partial failure, and recovery tests passed.");
  }
} finally {
  lines.close();
  const stopped = new Promise((resolve) => child.once("exit", resolve));
  child.kill();
  await stopped;
  await fs.rm(temporary, { recursive: true, force: true });
}
