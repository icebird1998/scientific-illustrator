import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { OfficeJsCommandBridge } from "../plugins/scientific-illustrator/scripts/officejs-bridge.mjs";

const execFileAsync = promisify(execFile);
const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "scientific-illustrator-officejs-"));
const certificatePath = path.join(temporaryDirectory, "localhost.crt");
const privateKeyPath = path.join(temporaryDirectory, "localhost.key");

function requestJson(port, method, route, token, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body), "utf8");
    const request = https.request({
      hostname: "127.0.0.1",
      port,
      path: route,
      method,
      rejectUnauthorized: false,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(payload ? { "Content-Type": "application/json", "Content-Length": payload.length } : {}),
      },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({ status: response.statusCode, value: text ? JSON.parse(text) : null });
      });
    });
    request.once("error", reject);
    if (payload) request.write(payload);
    request.end();
  });
}

function requestAsset(port, route) {
  return new Promise((resolve, reject) => {
    const request = https.request({
      hostname: "127.0.0.1",
      port,
      path: route,
      method: "GET",
      rejectUnauthorized: false,
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        status: response.statusCode,
        contentType: response.headers["content-type"],
        body: Buffer.concat(chunks),
      }));
    });
    request.once("error", reject);
    request.end();
  });
}

let bridge;
try {
  await execFileAsync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256", "-days", "1",
    "-keyout", privateKeyPath, "-out", certificatePath, "-subj", "/CN=localhost",
    "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
  ], { maxBuffer: 4 * 1024 * 1024 });

  bridge = new OfficeJsCommandBridge({
    host: "127.0.0.1",
    port: 0,
    certPath: certificatePath,
    keyPath: privateKeyPath,
    commandTimeoutMs: 1000,
    longPollMs: 500,
    clientTtlMs: 3000,
  });
  const started = await bridge.start();
  assert.equal(started.server_running, true);
  assert.ok(started.port > 0);

  const health = await requestJson(started.port, "GET", "/health");
  assert.equal(health.status, 200);
  assert.equal(health.value.ok, true);
  assert.equal(health.value.version, "1.6.0");

  for (const icon of ["icon-32.png", "icon-64.png"]) {
    const asset = await requestAsset(started.port, `/assets/${icon}`);
    assert.equal(asset.status, 200);
    assert.equal(asset.contentType, "image/png");
    assert.deepEqual(asset.body.subarray(0, 8), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }

  const unauthorized = await requestJson(started.port, "POST", "/api/register", "wrong-token", { client_id: "smoke-client-1" });
  assert.equal(unauthorized.status, 401);

  const metadata = { client_id: "smoke-client-1", host: "PowerPoint", platform: "Mac", office_version: "smoke", api_sets: { "1.10": true } };
  const registered = await requestJson(started.port, "POST", "/api/register", bridge.sessionToken, metadata);
  assert.equal(registered.status, 200);
  assert.equal(bridge.status().connected, true);

  const commandRequest = requestJson(started.port, "GET", "/api/command?client_id=smoke-client-1", bridge.sessionToken);
  const resultPromise = bridge.dispatch("status", { probe: true });
  const command = await commandRequest;
  assert.equal(command.status, 200);
  assert.equal(command.value.command.action, "status");
  assert.deepEqual(command.value.command.arguments, { probe: true });

  const posted = await requestJson(started.port, "POST", "/api/result", bridge.sessionToken, {
    client_id: "smoke-client-1",
    command_id: command.value.command.id,
    ok: true,
    result: { backend: "officejs-context-sync", context_sync: true },
  });
  assert.equal(posted.status, 200);
  assert.deepEqual(await resultPromise, { backend: "officejs-context-sync", context_sync: true });

  const timeoutCommandRequest = requestJson(started.port, "GET", "/api/command?client_id=smoke-client-1", bridge.sessionToken);
  const timeoutPromise = bridge.dispatch("timeout_probe", {});
  const timeoutCommand = await timeoutCommandRequest;
  assert.equal(timeoutCommand.value.command.action, "timeout_probe");
  await assert.rejects(timeoutPromise, /timed out/);

  const heartbeat = await requestJson(started.port, "POST", "/api/heartbeat", bridge.sessionToken, metadata);
  assert.equal(heartbeat.status, 200);
  console.log("Office.js HTTPS bridge assets, registration, long-poll dispatch, acknowledgement, and timeout checks passed.");
} finally {
  if (bridge) await bridge.close();
  await fs.rm(temporaryDirectory, { recursive: true, force: true });
}
