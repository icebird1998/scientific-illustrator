#!/usr/bin/env node

import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_DIR = path.resolve(SCRIPT_DIR, "..");
const OFFICEJS_DIR = path.join(PLUGIN_DIR, "officejs");
const DEFAULT_STATE_DIR = path.join(os.homedir(), ".codex", "scientific-illustrator", "officejs");
const DEFAULT_PORT = 17645;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_COMMAND_TIMEOUT_MS = 45_000;
const DEFAULT_CLIENT_TTL_MS = 35_000;
const DEFAULT_LONG_POLL_MS = 20_000;
const MAX_BODY_BYTES = 64 * 1024 * 1024;
const SERVER_VERSION = "1.6.0";

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

export function defaultOfficeJsPaths() {
  const stateDir = path.resolve(process.env.SCIENTIFIC_ILLUSTRATOR_OFFICEJS_DIR || DEFAULT_STATE_DIR);
  return {
    state_dir: stateDir,
    certificate_path: path.resolve(process.env.SCIENTIFIC_ILLUSTRATOR_OFFICEJS_CERT || path.join(stateDir, "localhost.crt")),
    private_key_path: path.resolve(process.env.SCIENTIFIC_ILLUSTRATOR_OFFICEJS_KEY || path.join(stateDir, "localhost.key")),
    manifest_path: path.join(OFFICEJS_DIR, "manifest.xml"),
    officejs_dir: OFFICEJS_DIR,
  };
}

function remoteIsLoopback(address = "") {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function secureTokenEqual(actual, expected) {
  const left = Buffer.from(String(actual || ""));
  const right = Buffer.from(String(expected || ""));
  return left.length === right.length && timingSafeEqual(left, right);
}

function normalizeClientId(value) {
  const text = String(value || "").trim();
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(text)) throw new Error("Invalid Office.js client_id.");
  return text;
}

function jsonResponse(response, status, value) {
  const body = Buffer.from(JSON.stringify(value), "utf8");
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Length": body.length,
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

function emptyResponse(response, status = 204) {
  response.writeHead(status, { "Cache-Control": "no-store", "Content-Length": 0 });
  response.end();
}

async function readJsonBody(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > MAX_BODY_BYTES) {
      const error = new Error(`Request body exceeds ${MAX_BODY_BYTES} bytes.`);
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Request body is not valid JSON.");
    error.statusCode = 400;
    throw error;
  }
}

export class OfficeJsCommandBridge {
  constructor(options = {}) {
    const defaults = defaultOfficeJsPaths();
    this.host = options.host || process.env.SCIENTIFIC_ILLUSTRATOR_OFFICEJS_HOST || DEFAULT_HOST;
    this.port = Number(options.port ?? process.env.SCIENTIFIC_ILLUSTRATOR_OFFICEJS_PORT ?? DEFAULT_PORT);
    this.certPath = path.resolve(options.certPath || defaults.certificate_path);
    this.keyPath = path.resolve(options.keyPath || defaults.private_key_path);
    this.assetDir = path.resolve(options.assetDir || defaults.officejs_dir);
    this.commandTimeoutMs = Number(options.commandTimeoutMs || DEFAULT_COMMAND_TIMEOUT_MS);
    this.clientTtlMs = Number(options.clientTtlMs || DEFAULT_CLIENT_TTL_MS);
    this.longPollMs = Number(options.longPollMs || DEFAULT_LONG_POLL_MS);
    this.sessionToken = options.sessionToken || randomBytes(32).toString("base64url");
    this.server = null;
    this.startPromise = null;
    this.client = null;
    this.commandQueue = [];
    this.commandWaiter = null;
    this.pending = new Map();
    this.startedAt = null;
    this.lastError = null;
  }

  get origin() {
    return `https://localhost:${this.port}`;
  }

  async start() {
    if (this.server?.listening) return this.status();
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.#start().finally(() => { this.startPromise = null; });
    return this.startPromise;
  }

  async #start() {
    if (!existsSync(this.certPath) || !existsSync(this.keyPath)) {
      this.lastError = "Office.js localhost certificate is not prepared.";
      return this.status();
    }
    const [cert, key] = await Promise.all([fs.readFile(this.certPath), fs.readFile(this.keyPath)]);
    const server = https.createServer({ cert, key }, (request, response) => {
      this.#handleRequest(request, response).catch((error) => {
        if (!response.headersSent) jsonResponse(response, error.statusCode || 500, { error: error.message });
        else response.destroy(error);
      });
    });
    server.on("clientError", (_error, socket) => socket.destroy());
    await new Promise((resolve, reject) => {
      const onError = (error) => { server.off("listening", onListening); reject(error); };
      const onListening = () => { server.off("error", onError); resolve(); };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(this.port, this.host);
    });
    this.server = server;
    const address = server.address();
    if (address && typeof address === "object") this.port = address.port;
    this.startedAt = new Date().toISOString();
    this.lastError = null;
    return this.status();
  }

  status() {
    const now = Date.now();
    const connected = Boolean(this.client && now - this.client.lastSeen <= this.clientTtlMs);
    return {
      backend: "officejs-context-sync",
      configured: existsSync(this.certPath) && existsSync(this.keyPath),
      server_running: Boolean(this.server?.listening),
      connected,
      origin: this.origin,
      bind_host: this.host,
      port: this.port,
      certificate_path: this.certPath,
      private_key_path: this.keyPath,
      taskpane_url: `${this.origin}/taskpane.html`,
      started_at: this.startedAt,
      last_error: this.lastError,
      client: this.client ? {
        client_id: this.client.id,
        registered_at: this.client.registeredAt,
        last_seen: new Date(this.client.lastSeen).toISOString(),
        host: this.client.host,
        platform: this.client.platform,
        office_version: this.client.officeVersion,
        api_sets: this.client.apiSets,
      } : null,
      queued_command_count: this.commandQueue.length,
      pending_command_count: this.pending.size,
    };
  }

  async waitForClient(timeoutMs = 0) {
    const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
    do {
      if (this.status().connected) return this.status();
      if (Date.now() >= deadline) break;
      await new Promise((resolve) => setTimeout(resolve, Math.min(200, deadline - Date.now())));
    } while (Date.now() <= deadline);
    return this.status();
  }

  async dispatch(action, args = {}, options = {}) {
    await this.start();
    const status = await this.waitForClient(options.waitForClientMs || 0);
    if (!status.connected || !this.client) {
      throw new Error("Office.js live backend is not connected. Open the Scientific Illustrator task pane in the current PowerPoint deck, then call powerpoint_status again.");
    }
    const command = {
      id: randomUUID(),
      action: String(action),
      arguments: args || {},
      issued_at: new Date().toISOString(),
    };
    const timeoutMs = Math.max(1_000, Number(options.timeoutMs || this.commandTimeoutMs));
    const resultPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(command.id);
        reject(new Error(`Office.js command timed out after ${timeoutMs} ms: ${command.action}`));
      }, timeoutMs);
      this.pending.set(command.id, { resolve, reject, timer, action: command.action });
    });
    this.commandQueue.push(command);
    this.#flushCommandWaiter();
    return resultPromise;
  }

  async close() {
    if (this.commandWaiter) {
      clearTimeout(this.commandWaiter.timer);
      emptyResponse(this.commandWaiter.response, 204);
      this.commandWaiter = null;
    }
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Office.js command bridge closed."));
    }
    this.pending.clear();
    this.commandQueue.length = 0;
    const server = this.server;
    this.server = null;
    if (server) await new Promise((resolve) => server.close(resolve));
  }

  #authorized(request) {
    const header = String(request.headers.authorization || "");
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    return secureTokenEqual(token, this.sessionToken);
  }

  #touchClient(clientId, metadata = {}) {
    const id = normalizeClientId(clientId);
    const now = Date.now();
    if (this.client && this.client.id !== id && now - this.client.lastSeen <= this.clientTtlMs) {
      const error = new Error("Another PowerPoint task pane is already connected. Close the other Scientific Illustrator Live pane before selecting a different deck.");
      error.statusCode = 409;
      throw error;
    }
    if (!this.client || this.client.id !== id) {
      this.client = {
        id,
        registeredAt: new Date(now).toISOString(),
        lastSeen: now,
        host: String(metadata.host || "PowerPoint"),
        platform: String(metadata.platform || "unknown"),
        officeVersion: String(metadata.office_version || ""),
        apiSets: metadata.api_sets && typeof metadata.api_sets === "object" ? metadata.api_sets : {},
      };
    } else {
      this.client.lastSeen = now;
      if (metadata.api_sets) this.client.apiSets = metadata.api_sets;
    }
    return this.client;
  }

  #flushCommandWaiter() {
    if (!this.commandWaiter || !this.commandQueue.length) return;
    const waiter = this.commandWaiter;
    this.commandWaiter = null;
    clearTimeout(waiter.timer);
    const command = this.commandQueue.shift();
    jsonResponse(waiter.response, 200, { command });
  }

  async #serveAsset(pathname, response) {
    const relative = pathname === "/" ? "taskpane.html" : pathname.replace(/^\/+/, "");
    const resolved = path.resolve(this.assetDir, relative);
    if (resolved !== this.assetDir && !resolved.startsWith(`${this.assetDir}${path.sep}`)) {
      jsonResponse(response, 403, { error: "Forbidden." });
      return;
    }
    if (!existsSync(resolved) || (await fs.stat(resolved)).isDirectory()) {
      jsonResponse(response, 404, { error: "Not found." });
      return;
    }
    let body = await fs.readFile(resolved);
    if (path.extname(resolved) === ".html") {
      body = Buffer.from(body.toString("utf8").replaceAll("__SCIENTIFIC_ILLUSTRATOR_TOKEN__", this.sessionToken), "utf8");
    }
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Length": body.length,
      "Content-Security-Policy": "default-src 'self'; script-src 'self' https://appsforoffice.microsoft.com; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self' https://*.officeapps.live.com https://*.office.com",
      "Content-Type": CONTENT_TYPES[path.extname(resolved)] || "application/octet-stream",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(body);
  }

  async #handleRequest(request, response) {
    if (!remoteIsLoopback(request.socket.remoteAddress)) {
      jsonResponse(response, 403, { error: "Loopback clients only." });
      return;
    }
    const url = new URL(request.url || "/", this.origin);
    if (request.method === "GET" && url.pathname === "/health") {
      jsonResponse(response, 200, { ok: true, version: SERVER_VERSION, backend: "officejs-context-sync" });
      return;
    }
    if (!url.pathname.startsWith("/api/")) {
      if (request.method !== "GET") {
        jsonResponse(response, 405, { error: "Method not allowed." });
        return;
      }
      await this.#serveAsset(url.pathname, response);
      return;
    }
    if (!this.#authorized(request)) {
      jsonResponse(response, 401, { error: "Invalid or expired Office.js session token." });
      return;
    }
    if (url.pathname === "/api/register" && request.method === "POST") {
      const body = await readJsonBody(request);
      const client = this.#touchClient(body.client_id, body);
      jsonResponse(response, 200, { ok: true, client_id: client.id, poll_timeout_ms: this.longPollMs });
      return;
    }
    if (url.pathname === "/api/heartbeat" && request.method === "POST") {
      const body = await readJsonBody(request);
      this.#touchClient(body.client_id, body);
      jsonResponse(response, 200, { ok: true });
      return;
    }
    if (url.pathname === "/api/command" && request.method === "GET") {
      const clientId = normalizeClientId(url.searchParams.get("client_id"));
      this.#touchClient(clientId);
      if (this.client?.id !== clientId) {
        jsonResponse(response, 409, { error: "Another Office.js client is active." });
        return;
      }
      if (this.commandQueue.length) {
        jsonResponse(response, 200, { command: this.commandQueue.shift() });
        return;
      }
      if (this.commandWaiter) {
        clearTimeout(this.commandWaiter.timer);
        emptyResponse(this.commandWaiter.response, 204);
      }
      const timer = setTimeout(() => {
        if (this.commandWaiter?.response === response) this.commandWaiter = null;
        emptyResponse(response, 204);
      }, this.longPollMs);
      this.commandWaiter = { response, timer, clientId };
      response.once("close", () => {
        if (this.commandWaiter?.response === response) {
          clearTimeout(timer);
          this.commandWaiter = null;
        }
      });
      return;
    }
    if (url.pathname === "/api/result" && request.method === "POST") {
      const body = await readJsonBody(request);
      this.#touchClient(body.client_id);
      const pending = this.pending.get(String(body.command_id || ""));
      if (!pending) {
        jsonResponse(response, 404, { error: "Unknown or expired command_id." });
        return;
      }
      this.pending.delete(String(body.command_id));
      clearTimeout(pending.timer);
      if (body.ok === true) pending.resolve(body.result ?? {});
      else pending.reject(new Error(body.error?.message || body.error || `Office.js command failed: ${pending.action}`));
      jsonResponse(response, 200, { ok: true });
      return;
    }
    jsonResponse(response, 404, { error: "Unknown bridge endpoint." });
  }
}

let singleton;

export function getOfficeJsBridge(options = {}) {
  if (!singleton) singleton = new OfficeJsCommandBridge(options);
  return singleton;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const bridge = getOfficeJsBridge();
  const status = await bridge.start();
  process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
  if (!status.server_running) process.exitCode = 1;
  else {
    process.stdout.write(`Scientific Illustrator Office.js bridge listening on ${status.origin}. Press Ctrl+C to stop.\n`);
    const stop = async () => { await bridge.close(); process.exit(0); };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  }
}
