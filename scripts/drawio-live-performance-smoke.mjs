import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { promises as fs } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDrawioExecutable } from "../plugins/scientific-illustrator/scripts/drawio-path.mjs";

// Opt-in: launches and closes only a new isolated draw.io test profile.
// Kept out of npm test because a desktop app is not available on every CI host.
if (!process.argv.includes("--run")) {
  console.log("Pass --run to verify paced/batched drawing in an isolated visible draw.io desktop session.");
  process.exit(0);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = await fs.mkdtemp(path.join(os.tmpdir(), "drawio-performance-"));
// Empty fixture bypasses the first-run welcome dialog; every actual drawing
// object is still created live by the tested graph API operations below.
const blankPath = path.join(output, "empty-fixture.drawio");
await fs.writeFile(blankPath, '<mxfile><diagram name="Performance verification"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>');
const port = await new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => { const value = server.address().port; server.close(() => resolve(value)); });
});
const child = spawn(process.execPath, [path.join(root, "plugins/scientific-illustrator/scripts/live-server.mjs")], {
  cwd: root, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env, DRAWIO_LIVE_PORT: String(port), DRAWIO_LIVE_PROFILE: path.join(output, "profile") },
});
const lines = createInterface({ input: child.stdout });
const pending = new Map();
let nextId = 0;
child.stderr.on("data", (chunk) => process.stderr.write(chunk));
lines.on("line", (line) => {
  const response = JSON.parse(line);
  const waiting = pending.get(response.id);
  if (waiting) { clearTimeout(waiting.timer); pending.delete(response.id); waiting.resolve(response); }
});
function rpc(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method} ${params?.name || ""}`)); }, 60000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
}
async function call(name, args = {}) {
  const response = await rpc("tools/call", { name, arguments: args });
  if (response.error || response.result?.isError) throw new Error(JSON.stringify(response.error || response.result?.structuredContent));
  return response.result;
}
async function initializeTestDocument(targetId) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target = targets.find((item) => item.id === targetId);
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let id = 0;
  const send = (method, params) => new Promise((resolve, reject) => {
    const currentId = ++id;
    const listener = (event) => {
      const response = JSON.parse(String(event.data));
      if (response.id !== currentId) return;
      socket.removeEventListener("message", listener);
      if (response.error) reject(new Error(JSON.stringify(response.error)));
      else resolve(response.result);
    };
    socket.addEventListener("message", listener);
    socket.send(JSON.stringify({ id: currentId, method, params }));
  });
  try {
    // App keeps EditorUi in closures rather than on window. Resolve only this
    // isolated renderer's UI instance through its public prototype, then use the
    // app's document-loading API to dismiss first-run onboarding.
    const prototype = await send("Runtime.evaluate", { expression: "EditorUi.prototype" });
    const instances = await send("Runtime.queryObjects", { prototypeObjectId: prototype.result.objectId });
    const response = await send("Runtime.callFunctionOn", {
      objectId: instances.objects.objectId, returnByValue: true,
      functionDeclaration: `function() {
        const ui = this.find(item => item.editor?.graph === window.__codexDrawioGraph);
        if (!ui) throw new Error('Unable to find the isolated EditorUi instance');
        const data = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>';
        ui.fileLoaded(new LocalFile(ui, data, 'Performance verification.drawio'));
        ui.hideDialog();
        return { enabled: ui.editor.graph.isEnabled(), fileLoaded: !!ui.getCurrentFile() };
      }`,
    });
    if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
    assert.equal(response.result.value.fileLoaded, true);
    assert.equal(response.result.value.enabled, true);
  } finally { socket.close(); }
}
const operations = [
  { type: "shape", id: "title", shape: "text", label: "Editable scientific workflow", x: 40, y: 20, width: 650, height: 35, font_size: 24 },
  ...Array.from({ length: 100 }, (_, index) => ({
    type: "shape", id: `node-${index}`, shape: index % 3 === 0 ? "ellipse" : "rounded", label: `N${index + 1}`,
    x: 50 + (index % 10) * 65, y: 80 + Math.floor(index / 10) * 42, width: 48, height: 28,
    fill_color: index % 3 === 0 ? "#DCECF7" : "#E6F0DF", stroke_color: "#547482", font_size: 11,
  })),
  { type: "edge", id: "relationship", source: "node-80", target: "node-81", end_arrow: "block", color: "#547482" },
  { type: "line", id: "scale", begin_x: 50, begin_y: 525, end_x: 220, end_y: 525, end_clearance: 4, end_arrow: "block", color: "#547482" },
  { type: "shape", id: "annotation", shape: "text", label: "Native cells, editable labels and connectors", x: 240, y: 507, width: 420, height: 34, font_size: 16 },
  { type: "update", id: "node-0", label: "Start" },
  { type: "group", id: "motif", cell_ids: ["node-0", "node-1"] },
  { type: "fit", zoom_percent: 100 },
];
let launched = false;
try {
  await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "drawio-performance-smoke", version: "1.0.0" } });
  await call("drawio_live_get_capabilities");
  const launch = (await call("drawio_live_launch", { port, file_path: blankPath, step_delay_ms: 0, maximize: false, include_screenshot: false })).structuredContent;
  launched = Boolean(launch.spawned_process_id);
  assert.ok(launched, "Refuse to test an externally owned session");
  assert.equal(launch.status.graph_ready, true, "A blank diagram must be ready in the isolated profile");
  await initializeTestDocument(launch.target.id);
  const initial = (await call("drawio_live_inspect")).structuredContent;
  assert.equal(initial.total, 0, "Refuse to alter any existing diagram");
  const summaries = {};
  let expectedInspect;
  let expectedModel;
  for (const mode of ["paced", "batched"]) {
    if (mode === "batched") await call("drawio_live_clear", { confirm: true });
    const started = performance.now();
    const response = await call("drawio_live_draw_sequence", { operations, execution_mode: mode, step_delay_ms: 0, batch_size: 32, screenshot_after: false });
    const wallMs = performance.now() - started;
    const inspection = (await call("drawio_live_inspect", { max_cells: 500 })).structuredContent;
    const screenshot = await call("drawio_live_screenshot");
    const image = screenshot.content.find((item) => item.type === "image");
    assert.ok(image, "A renderer screenshot is required");
    await fs.writeFile(path.join(output, `${mode}.png`), Buffer.from(image.data, "base64"));
    const diagramPath = path.join(output, `${mode}.drawio`);
    await call("drawio_live_save_snapshot", { output_path: diagramPath });
    const xml = await fs.readFile(diagramPath, "utf8");
    const model = xml.match(/<mxGraphModel[\s\S]*?<\/mxGraphModel>/)?.[0];
    assert.ok(model);
    if (mode === "paced") { expectedInspect = inspection; expectedModel = model; }
    else {
      assert.deepEqual(inspection, expectedInspect, "Paced and batched graph inspections must be identical");
      assert.equal(model, expectedModel, "Paced and batched saved graph XML must be identical");
    }
    summaries[mode] = { wall_ms: Math.round(wallMs * 100) / 100, ...response.structuredContent.execution, objects: inspection.total };
    console.log(`${mode}: ${JSON.stringify(summaries[mode])}`);
  }
  const summary = { executable: resolveDrawioExecutable(), operations: operations.length, results: summaries, inspect_equal: true, graph_xml_equal: true, output };
  await fs.writeFile(path.join(output, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`Verified live renderer results: ${output}`);
} finally {
  if (launched) await call("drawio_live_close_session", { confirm: true }).catch((error) => console.error(error.message));
  lines.close();
  child.kill();
}
