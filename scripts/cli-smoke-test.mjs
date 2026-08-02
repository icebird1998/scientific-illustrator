// CLI smoke tests for sci-illu.
//
// Spawns the real sci-illu binary and asserts the stdout JSON contract,
// exit codes, tool mapping, error propagation, image-to-file saving, and the
// ppt Office.js daemon lifecycle. Environment-gated sections degrade to
// informative skips (e.g., draw.io not installed, python-pptx missing).

import { spawn } from "node:child_process";
import http from "node:http";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(root, "plugins", "scientific-illustrator", "scripts", "cli.mjs");
const STATE_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "sci-illu-smoke-state-"));
const WORK_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "sci-illu-smoke-work-"));

let failures = 0;
let skips = 0;

function check(name, condition, detail = "") {
  if (condition) {
    console.log(`ok   ${name}`);
  } else {
    failures += 1;
    console.error(`FAIL ${name}${detail ? `\n     ${detail}` : ""}`);
  }
}

function skip(name, reason) {
  skips += 1;
  console.log(`skip ${name} (${reason})`);
}

async function runCli(args, env = {}, { timeoutMs = 120_000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      env: { ...process.env, SCIENTIFIC_ILLUSTRATOR_STATE_DIR: STATE_DIR, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

function parseOut(run) {
  try {
    return JSON.parse(run.stdout.trim().split("\n").pop());
  } catch {
    return null;
  }
}

// --- usage and help ---------------------------------------------------------

const noArgs = await runCli([]);
check("no-args prints usage and exits 0", noArgs.code === 0 && noArgs.stdout.includes("Usage: sci-illu"));

const badGroup = await runCli(["nope", "status"]);
check("unknown group exits 2", badGroup.code === 2, `code=${badGroup.code}`);

const missingTool = await runCli(["file"]);
check("missing tool exits 2", missingTool.code === 2, `code=${missingTool.code}`);

const badJson = await runCli(["file", "status", "--json", "{not json"]);
check("invalid --json exits 2", badJson.code === 2, `code=${badJson.code}`);

const version = await runCli(["--version"]);
check("--version prints version", version.code === 0 && /^sci-illu \d+\.\d+\.\d+/.test(version.stdout.trim()));

const helpLive = await runCli(["help", "live"]);
check("help live lists live tools", helpLive.code === 0 && helpLive.stderr.includes("add-shape"), helpLive.stderr);

const listFile = await runCli(["file", "--list-tools"]);
const listFileBody = parseOut(listFile);
check("file --list-tools returns 9 tools", listFile.code === 0 && listFileBody?.result?.tools?.length === 9);

// --- file group --------------------------------------------------------------

const fileStatus = await runCli(["file", "status"]);
const fileStatusBody = parseOut(fileStatus);
check("file status ok", fileStatus.code === 0 && fileStatusBody?.ok === true && fileStatusBody?.tool === "drawio_status");

const diagramPath = path.join(WORK_DIR, "smoke.drawio");
const create = await runCli(["file", "create-diagram", "--json", JSON.stringify({
  output_path: diagramPath,
  workflow_context: "explicit-file-only-request",
})]);
const createBody = parseOut(create);
check("file create-diagram ok", create.code === 0 && createBody?.ok === true && createBody?.result?.output_path === diagramPath, create.stdout);
check("file create-diagram writes file", await fs.access(diagramPath).then(() => true, () => false));

const validate = await runCli(["file", "validate", "--json", JSON.stringify({ input_path: diagramPath })]);
const validateBody = parseOut(validate);
check("file validate ok", validate.code === 0 && validateBody?.ok === true && validateBody?.result?.valid === true, validate.stdout);

const inspect = await runCli(["file", "inspect", "--json", JSON.stringify({ input_path: diagramPath })]);
const inspectBody = parseOut(inspect);
check("file inspect reports one page", inspect.code === 0 && inspectBody?.ok === true && inspectBody?.result?.pages?.length === 1);

const wrongContext = await runCli(["file", "create-diagram", "--json", JSON.stringify({ output_path: path.join(WORK_DIR, "x.drawio") })]);
const wrongBody = parseOut(wrongContext);
check("file tool error propagates with exit 1", wrongContext.code === 1 && wrongBody?.ok === false && typeof wrongBody?.error === "string", `code=${wrongContext.code}`);

// --- kebab-case mapping ------------------------------------------------------

const kebabStatus = await runCli(["file", "create-diagram", "--json", JSON.stringify({
  output_path: path.join(WORK_DIR, "kebab.drawio"),
  workflow_context: "explicit-file-only-request",
})]);
const kebabBody = parseOut(kebabStatus);
check("kebab-case maps to drawio_create_diagram", kebabStatus.code === 0 && kebabBody?.tool === "drawio_create_diagram");

// --- image-to-file saving via the stub server --------------------------------

const stubPath = path.join(WORK_DIR, "stub-server.mjs");
await fs.writeFile(stubPath, `#!/usr/bin/env node
import { createInterface } from "node:readline";
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") return process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "stub", version: "0" } } }) + "\\n");
  if (message.method === "tools/list") return process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { tools: [{ name: "stub_screenshot", inputSchema: { type: "object", properties: {} } }] } }) + "\\n");
  if (message.method?.startsWith("notifications/")) return;
  if (message.method === "tools/call") {
    return process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: {
      content: [{ type: "text", text: JSON.stringify({ ok: 1 }) }, { type: "image", data: PNG, mimeType: "image/png" }],
      structuredContent: { ok: 1 },
      isError: false,
    } }) + "\\n");
  }
});
`);

const stubEnv = { SCI_ILLU_SERVER_LIVE: stubPath };
const stubImage = await runCli(["live", "stub_screenshot", "--output", path.join(WORK_DIR, "out.png")], stubEnv);
const stubBody = parseOut(stubImage);
check("stub screenshot saves to --output", stubImage.code === 0 && stubBody?.images?.[0]?.path === path.join(WORK_DIR, "out.png"), stubImage.stdout);
check("stub screenshot file exists and is PNG", await fs.readFile(path.join(WORK_DIR, "out.png")).then((buf) => buf.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])), () => false));

const stubAutoImage = await runCli(["live", "stub_screenshot"], stubEnv);
const stubAutoBody = parseOut(stubAutoImage);
check("stub screenshot auto-temp path reported", stubAutoImage.code === 0 && stubAutoBody?.images?.length === 1 && path.dirname(stubAutoBody.images[0].path) !== WORK_DIR);

// --- live group (draw.io optional) -------------------------------------------

const liveStatus = await runCli(["live", "status"]);
const liveBody = parseOut(liveStatus);
if (liveStatus.code === 0 && liveBody?.ok === true) {
  check("live status ok with draw.io", true);
} else if (liveBody && liveBody.ok === false && typeof liveBody.error === "string") {
  skip("live status", "draw.io not reachable; graceful error returned");
} else {
  check("live status contract", false, liveStatus.stdout);
}

// --- ppt group (python-pptx optional) ----------------------------------------

const pptStatus = await runCli(["ppt", "status", "--backend", "ooxml"]);
const pptBody = parseOut(pptStatus);
if (pptStatus.code === 0 && pptBody?.ok === true) {
  check("ppt status ok via OOXML", true, pptStatus.stdout.slice(0, 200));
} else if (pptBody && pptBody.ok === false && /python-pptx|soffice|not found/i.test(pptBody.error)) {
  skip("ppt status", "python-pptx not installed; graceful error returned");
} else {
  check("ppt status contract", false, pptStatus.stdout);
}

// --- ppt Office.js daemon lifecycle ------------------------------------------

const daemonPort = String(18_100 + Math.floor(Math.random() * 400));
const daemonRun = await runCli(["ppt", "serve", "--port", daemonPort, "--state-dir", STATE_DIR]);
const daemonBody = parseOut(daemonRun);
check("ppt serve starts daemon", daemonRun.code === 0 && daemonBody?.ok === true, daemonRun.stdout);

if (daemonRun.code === 0) {
  const viaDaemon = await runCli(["ppt", "status", "--backend", "officejs", "--port", daemonPort, "--state-dir", STATE_DIR]);
  const viaBody = parseOut(viaDaemon);
  check("officejs call routed through daemon", viaDaemon.code === 0 && viaBody?.ok === true, viaDaemon.stdout.slice(0, 300));

  // Unauthenticated HTTP calls to the daemon must be rejected.
  const daemonState = await fs.readFile(path.join(STATE_DIR, "ppt-daemon.json"), "utf8").then(JSON.parse).catch(() => null);
  if (daemonState?.token) {
    const raw = http.request(`http://127.0.0.1:${daemonPort}/`, { method: "POST", headers: { "Content-Type": "application/json" } });
    const statusCode = await new Promise((resolve) => {
      raw.on("response", (res) => resolve(res.statusCode));
      raw.on("error", () => resolve(null));
      raw.write(JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/call", params: {} }));
      raw.end();
    });
    check("daemon rejects unauthenticated calls", statusCode === 401, `status=${statusCode}`);
  }

  const stopRun = await runCli(["ppt", "stop", "--port", daemonPort, "--state-dir", STATE_DIR]);
  const stopBody = parseOut(stopRun);
  check("ppt stop stops daemon", stopRun.code === 0 && stopBody?.ok === true && stopBody?.stopped === true, stopRun.stdout);
} else {
  skip("ppt daemon lifecycle", `serve failed (${daemonBody?.error || daemonRun.stderr.slice(0, 120)})`);
}

// --- cleanup ------------------------------------------------------------------

await fs.rm(STATE_DIR, { recursive: true, force: true });
await fs.rm(WORK_DIR, { recursive: true, force: true });

console.log(`\nCLI smoke tests: ${failures === 0 ? "passed" : "FAILED"} (${skips} skipped).`);
if (failures > 0) process.exit(1);
