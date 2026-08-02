#!/usr/bin/env node

// sci-illu: CLI front end for the Scientific Illustrator MCP servers.
//
// Every subcommand maps 1:1 to an existing MCP tool:
//   sci-illu file <tool>  -> server.mjs            (draw.io file utilities)
//   sci-illu live <tool>  -> live-server.mjs       (draw.io live canvas, CDP)
//   sci-illu ppt  <tool>  -> powerpoint-server.mjs (PowerPoint / WPS)
//
// The servers are spawned as child processes and spoken to over the same
// JSON-RPC 2.0 stdio protocol they use as MCP servers, so CLI behavior is
// identical to the MCP path with zero refactoring of the server logic.
// The ppt group additionally supports an HTTP daemon for the Office.js
// backend (Mac PowerPoint live drawing), because that backend requires a
// persistent bridge that the PowerPoint task pane long-polls.
//
// Output contract (stdout, always JSON):
//   success: {"ok":true,"tool":"<tool>","result":{...},"images":[{"path","mimeType"}]}
//   failure: {"ok":false,"tool":"<tool>","error":"..."}
// Exit codes: 0 success, 1 tool/server failure, 2 usage error.

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline";
import { promises as fs } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CLI_VERSION = "1.6.0";

// Server script locations; the env overrides are a testing seam used by the
// CLI smoke tests and by users who vendor the servers elsewhere.
const GROUPS = {
  file: {
    server: process.env.SCI_ILLU_SERVER_FILE || path.join(SCRIPT_DIR, "server.mjs"),
    toolPrefix: "drawio_",
    description: "draw.io file utilities (create / validate / inspect / update / export .drawio)",
  },
  live: {
    server: process.env.SCI_ILLU_SERVER_LIVE || path.join(SCRIPT_DIR, "live-server.mjs"),
    toolPrefix: "drawio_live_",
    description: "draw.io live canvas control over CDP (visible object-by-object drawing)",
  },
  ppt: {
    server: process.env.SCI_ILLU_SERVER_PPT || path.join(SCRIPT_DIR, "powerpoint-server.mjs"),
    toolPrefix: "powerpoint_",
    description: "Microsoft PowerPoint / WPS Presentation control (COM / Office.js / OOXML)",
  },
};

const DEFAULT_STATE_DIR = path.join(os.homedir(), ".local", "state", "sci-illu");
const DEFAULT_PPT_HTTP_PORT = 18090;
const DEFAULT_TIMEOUT_MS = 300_000;
const DAEMON_FILE = "ppt-daemon.json";

function fail(message, code = 1) {
  if (code === 2) process.stderr.write(`sci-illu: ${message}\n`);
  process.stdout.write(`${JSON.stringify({ ok: false, error: message })}\n`);
  process.exit(code);
}

function usage() {
  const lines = [
    `sci-illu ${CLI_VERSION} - Scientific Illustrator CLI`,
    "",
    "Usage: sci-illu <group> <tool> [flags]",
    "",
    "Groups:",
  ];
  for (const [name, group] of Object.entries(GROUPS)) {
    lines.push(`  ${name.padEnd(8)} ${group.description}`);
  }
  lines.push(
    "",
    "Service commands:",
    "  sci-illu ppt serve [--port N] [--state-dir DIR]   Start the Office.js backend daemon",
    "  sci-illu ppt stop                                  Stop the Office.js backend daemon",
    "  sci-illu help [group]                              Show this help or a group's tools",
    "",
    "Flags:",
    "  --json <json>      Tool arguments as JSON, same shape as the MCP tool arguments.",
    "  --output <path>    Save screenshot / image results to <path>.",
    "  --backend <b>      ppt only: auto|officejs|com|ooxml.",
    "  --host <h>         ppt only: auto|powerpoint|wps.",
    "  --focus-policy <p> ppt only: preserve|foreground.",
    "  --file <path>      Inject file_path into tool arguments.",
    "  --state-dir <d>    State directory (daemon pid/port, OOXML working copies).",
    "  --port <n>         ppt daemon port (default 18090).",
    "  --timeout-ms <n>   Per-call timeout (default 300000).",
    "  --pretty           Pretty-print the result JSON.",
    "  --list-tools       List available tools for the group.",
    "  --help             Show this help.",
    "",
    "Tool names accept both kebab-case (add-shape) and the raw MCP name",
    "(drawio_live_add_shape). Run 'sci-illu help <group>' for the full list.",
  );
  return lines.join("\n");
}

function toolNameToMcp(group, name) {
  if (name.includes("_")) return name; // raw MCP tool name already
  const snake = name.replaceAll("-", "_");
  return `${GROUPS[group].toolPrefix}${snake}`;
}

function parseJsonArg(text) {
  try {
    const value = JSON.parse(text);
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("expected a JSON object");
    }
    return value;
  } catch (error) {
    fail(`--json must be a JSON object: ${error.message}`, 2);
  }
}

function parseCliArgs(args) {
  let values, positionals;
  try {
    ({ values, positionals } = parseArgs({
      args,
      options: {
        json: { type: "string" },
        output: { type: "string" },
        backend: { type: "string" },
        host: { type: "string" },
        "focus-policy": { type: "string" },
        file: { type: "string" },
        "state-dir": { type: "string" },
        port: { type: "string" },
        "timeout-ms": { type: "string" },
        pretty: { type: "boolean" },
        "list-tools": { type: "boolean" },
        help: { type: "boolean" },
      },
      allowPositionals: true,
    }));
  } catch (error) {
    fail(error.message, 2);
  }
  const toolArgs = parseJsonArg(values.json || "{}");
  if (values.file && toolArgs.file_path === undefined) toolArgs.file_path = path.resolve(values.file);
  if (values.host && toolArgs.host_application === undefined) toolArgs.host_application = values.host;
  return { values, positionals, toolArgs };
}

// ---------------------------------------------------------------------------
// stdio JSON-RPC client (one-shot child server)
// ---------------------------------------------------------------------------

async function oneShotCall(groupName, mcpTool, toolArgs, env, timeoutMs) {
  const group = GROUPS[groupName];
  const child = spawn(process.execPath, [group.server], {
    stdio: ["pipe", "pipe", "inherit"],
    env: { ...process.env, ...env },
  });
  const stdout = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const responses = new Map();
  const waiters = [];

  stdout.on("line", (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      process.stderr.write(`[sci-illu] non-JSON server output: ${line}\n`);
      return;
    }
    const waiter = waiters.shift();
    if (waiter) waiter.resolve(message);
    else responses.set(message.id, message);
  });

  const request = (method, params, id) => new Promise((resolve) => {
    if (responses.has(id)) {
      resolve(responses.get(id));
      return;
    }
    waiters.push({ resolve });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });

  try {
    // Initialize handshake (servers process stdin lines sequentially, FIFO order).
    await request("initialize", { protocolVersion: "2025-06-18", capabilities: {} }, 0);
    // Notification: the servers deliberately do not answer this, so fire and forget.
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, method: "notifications/initialized", params: {} })}\n`);
    const response = await withTimeout(
      request("tools/call", { name: mcpTool, arguments: toolArgs }, 1),
      timeoutMs,
      `Tool call timed out after ${timeoutMs} ms: ${mcpTool}`,
    );
    return { child, response };
  } catch (error) {
    try { child.kill(); } catch {}
    throw error;
  }
}

// Race a promise against a timeout; the timer is always cleared so the event
// loop never stays alive for a stale timeout.
function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ---------------------------------------------------------------------------
// result rendering (JSON to stdout, images to files)
// ---------------------------------------------------------------------------

async function saveImage(data, mimeType, output) {
  const buffer = Buffer.from(data, "base64");
  const ext = mimeType === "image/jpeg" ? ".jpg" : mimeType === "image/svg+xml" ? ".svg" : mimeType === "image/webp" ? ".webp" : ".png";
  let target;
  if (output) {
    target = output;
  } else {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sci-illu-img-"));
    target = path.join(dir, `image-${Date.now()}${ext}`);
  }
  await fs.writeFile(target, buffer);
  return { path: target, mimeType };
}

// toolResultObject is the MCP-style {content, structuredContent, isError}.
async function renderResult(mcpTool, toolResultObject, { output, pretty, saveImages = true }) {
  const value = toolResultObject || {};
  const isError = Boolean(value.isError);
  const textContent = (value.content || []).find((item) => item.type === "text");
  const imageContent = (value.content || []).filter((item) => item.type === "image");
  const structured = value.structuredContent;

  let parsedResult = structured;
  if (parsedResult === undefined && textContent) {
    try {
      parsedResult = JSON.parse(textContent.text);
    } catch {
      parsedResult = { text: textContent.text };
    }
  }
  if (parsedResult === undefined) parsedResult = {};

  // Tool-level errors are flattened to a top-level `error` string so agents
  // can read the failure without descending into result.
  const errorMessage = isError
    ? (typeof parsedResult?.error === "string" && parsedResult.error
        ? parsedResult.error
        : textContent?.text || "Tool failed.")
    : undefined;

  const images = [];
  if (saveImages) {
    for (let index = 0; index < imageContent.length; index += 1) {
      const item = imageContent[index];
      const target = index === 0 && output ? output : undefined;
      images.push(await saveImage(item.data, item.mimeType || "image/png", target));
    }
  }

  const body = {
    ok: !isError,
    tool: mcpTool,
    ...(errorMessage !== undefined ? { error: errorMessage } : {}),
    result: parsedResult,
    ...(images.length ? { images } : {}),
  };
  process.stdout.write(`${JSON.stringify(body, null, pretty ? 2 : undefined)}\n`);
  return isError ? 1 : 0;
}

// ---------------------------------------------------------------------------
// ppt Office.js HTTP daemon
// ---------------------------------------------------------------------------

function daemonStateFile(stateDir) {
  return path.join(stateDir, DAEMON_FILE);
}

async function readDaemon(stateDir) {
  try {
    const raw = await fs.readFile(daemonStateFile(stateDir), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function httpRequest(url, options = {}, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const { body, ...requestOptions } = options;
    const req = http.request(url, { ...requestOptions, timeout: timeoutMs }, (res) => {
      let responseText = "";
      res.on("data", (chunk) => { responseText += chunk; });
      res.on("end", () => {
        try {
          resolve(JSON.parse(responseText));
        } catch {
          reject(new Error(`Daemon returned non-JSON: ${responseText.slice(0, 120)}`));
        }
      });
    });
    req.on("timeout", () => { req.destroy(new Error("Daemon request timed out.")); });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function daemonHealth(port) {
  return httpRequest(`http://127.0.0.1:${port}/health`, { method: "GET" }, 2000)
    .catch(() => null);
}

function daemonAlive(port) {
  return daemonHealth(port).then((health) => Boolean(health?.ok));
}

function httpRpcCall(port, mcpTool, toolArgs, timeoutMs, token = "") {
  const payload = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: mcpTool, arguments: toolArgs },
  });
  return httpRequest(`http://127.0.0.1:${port}/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: payload,
  }, timeoutMs);
}

async function ensureDaemon({ stateDir, port, env, timeoutMs }) {
  const existing = await daemonHealth(port);
  if (existing?.ok) {
    // A healthy daemon is already running; record its real pid and reuse it.
    const state = (await readDaemon(stateDir)) || {};
    const pid = Number(existing.pid) || state.pid || null;
    await fs.mkdir(stateDir, { recursive: true });
    await fs.writeFile(daemonStateFile(stateDir), JSON.stringify({ pid, port, token: state.token || "", started_at: existing.started_at || new Date().toISOString() }), "utf8").catch(() => {});
    return { started: false, port, token: state.token || "" };
  }
  const token = randomBytes(24).toString("base64url");
  const child = spawn(process.execPath, [GROUPS.ppt.server], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, ...env, SCI_ILLU_HTTP: `127.0.0.1:${port}`, SCI_ILLU_HTTP_TOKEN: token },
  });
  child.unref();
  const deadline = Date.now() + Math.min(15_000, timeoutMs);
  for (;;) {
    if (await daemonAlive(port)) break;
    if (Date.now() >= deadline) {
      try { process.kill(child.pid, "SIGKILL"); } catch {}
      throw new Error(`Office.js daemon did not become healthy on port ${port} within ${Math.min(15_000, timeoutMs)} ms. Is the port free?`);
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(daemonStateFile(stateDir), JSON.stringify({ pid: child.pid, port, token, started_at: new Date().toISOString() }), "utf8");
  return { started: true, port, token };
}

async function stopDaemon(stateDir) {
  const daemon = await readDaemon(stateDir);
  if (!daemon || !daemon.pid) {
    fail("No ppt daemon state found. Start one with 'sci-illu ppt serve'.", 1);
  }
  let alreadyGone = false;
  try {
    process.kill(daemon.pid, "SIGTERM");
  } catch (error) {
    if (error.code === "ESRCH") alreadyGone = true;
    else throw error;
  }
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && !alreadyGone) {
    if (!(await daemonAlive(daemon.port))) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  await fs.rm(daemonStateFile(stateDir), { force: true }).catch(() => {});
  process.stdout.write(`${JSON.stringify({ ok: true, stopped: true, pid: daemon.pid, port: daemon.port, ...(alreadyGone ? { note: "pid already gone" } : {}) })}\n`);
}

// ---------------------------------------------------------------------------
// tools/list helpers (for --list-tools and help)
// ---------------------------------------------------------------------------

async function listTools(groupName) {
  const group = GROUPS[groupName];
  const child = spawn(process.execPath, [group.server], { stdio: ["pipe", "pipe", "inherit"], env: process.env });
  const stdout = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const tools = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error("Timed out listing tools.")); }, 15_000);
    stdout.on("line", (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (message.id === 0) {
        clearTimeout(timer);
        resolve(message.result?.tools || []);
      }
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 0, method: "tools/list", params: {} })}\n`);
  });
  try { child.kill(); } catch {}
  return tools;
}

async function printGroupHelp(groupName) {
  const group = GROUPS[groupName];
  process.stderr.write(`sci-illu ${groupName} - ${group.description}\n\nAvailable tools:\n`);
  try {
    const tools = await listTools(groupName);
    for (const tool of tools) {
      const cliName = tool.name.replace(group.toolPrefix, "").replaceAll("_", "-");
      const required = (tool.inputSchema?.required || []).join(",");
      process.stderr.write(`  ${cliName}${required ? ` (required: ${required})` : ""}\n`);
    }
  } catch (error) {
    process.stderr.write(`  (could not list tools: ${error.message})\n`);
  }
  process.exit(0);
}

// ---------------------------------------------------------------------------
// main dispatch
// ---------------------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    process.stdout.write(`${usage()}\n`);
    process.exit(0);
  }
  if (argv[0] === "--version" || argv[0] === "-v") {
    process.stdout.write(`sci-illu ${CLI_VERSION}\n`);
    process.exit(0);
  }
  if (argv[0] === "help" || argv[0] === "--help") {
    const groupName = argv[1];
    if (groupName && GROUPS[groupName]) await printGroupHelp(groupName);
    else process.stdout.write(`${usage()}\n`);
    process.exit(0);
  }

  const [groupName, ...rest] = argv;
  if (!GROUPS[groupName]) {
    fail(`Unknown group "${groupName}". Run 'sci-illu help'.`, 2);
  }

  const { values, positionals, toolArgs } = parseCliArgs(rest);
  const toolName = positionals[0];
  if (values.help) {
    await printGroupHelp(groupName);
  }

  if (values["list-tools"]) {
    const tools = await listTools(groupName);
    process.stdout.write(`${JSON.stringify({ ok: true, tool: `${groupName} list`, result: { tools: tools.map((t) => t.name) } })}\n`);
    process.exit(0);
  }

  if ((toolName === "serve" || toolName === "stop") && groupName !== "ppt") {
    fail(`'${toolName}' is only available for the ppt group.`, 2);
  }
  if (!toolName) {
    fail(`Missing tool name. Run 'sci-illu help ${groupName}'.`, 2);
  }

  const stateDir = values["state-dir"]
    ? path.resolve(values["state-dir"])
    : (process.env.SCIENTIFIC_ILLUSTRATOR_STATE_DIR && path.resolve(process.env.SCIENTIFIC_ILLUSTRATOR_STATE_DIR)) || DEFAULT_STATE_DIR;
  const timeoutMs = Number(values["timeout-ms"] || DEFAULT_TIMEOUT_MS);
  const env = { SCIENTIFIC_ILLUSTRATOR_STATE_DIR: stateDir };
  if (values.backend) env.SCIENTIFIC_ILLUSTRATOR_PPT_BACKEND = values.backend;
  if (values.host) env.SCIENTIFIC_ILLUSTRATOR_PPT_HOST = values.host;
  if (values["focus-policy"]) env.SCIENTIFIC_ILLUSTRATOR_FOCUS_POLICY = values["focus-policy"];

  // Office.js daemon service commands.
  if (groupName === "ppt" && (toolName === "serve" || toolName === "stop")) {
    const port = Number(values.port || DEFAULT_PPT_HTTP_PORT);
    if (toolName === "stop") {
      await stopDaemon(stateDir);
      process.exit(0);
    }
    const daemon = await ensureDaemon({ stateDir, port, env, timeoutMs });
    process.stdout.write(`${JSON.stringify({ ok: true, started: daemon.started, port: daemon.port, backend: "officejs", token_set: Boolean(daemon.token), daemon_file: daemonStateFile(stateDir) })}\n`);
    process.exit(0);
  }

  const mcpTool = toolNameToMcp(groupName, toolName);

  // Office.js backend needs the persistent daemon; everything else is one-shot.
  const backend = values.backend || process.env.SCIENTIFIC_ILLUSTRATOR_PPT_BACKEND || "auto";
  if (groupName === "ppt" && backend === "officejs") {
    const port = Number(values.port || DEFAULT_PPT_HTTP_PORT);
    try {
      const daemon = await ensureDaemon({ stateDir, port, env, timeoutMs });
      const response = await httpRpcCall(port, mcpTool, toolArgs, timeoutMs, daemon.token);
      if (response.error) {
        process.stdout.write(`${JSON.stringify({ ok: false, tool: mcpTool, error: response.error.message || JSON.stringify(response.error) })}\n`);
        process.exit(1);
      }
      process.exit(await renderResult(mcpTool, response.result, { output: values.output, pretty: values.pretty }));
    } catch (error) {
      fail(error.message, 1);
    }
  }

  try {
    const { child, response } = await oneShotCall(groupName, mcpTool, toolArgs, env, timeoutMs);
    const code = await renderResult(mcpTool, response.result, { output: values.output, pretty: values.pretty });
    try { child.stdin.end(); } catch {}
    try { child.kill(); } catch {}
    await new Promise((resolve) => child.once("exit", resolve)).catch(() => {});
    process.exitCode = code;
  } catch (error) {
    fail(error.message, 1);
  }
}

main().catch((error) => {
  fail(error.stack || error.message, 1);
});
