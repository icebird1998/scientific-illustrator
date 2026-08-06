#!/usr/bin/env node

import { execFile } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { defaultOfficeJsPaths } from "./officejs-bridge.mjs";

const execFileAsync = promisify(execFile);
const paths = defaultOfficeJsPaths();
const command = String(process.argv[2] || "status").toLowerCase();
const macManifestDir = path.join(os.homedir(), "Library", "Containers", "com.microsoft.Powerpoint", "Data", "Documents", "wef");
const macManifestPath = path.join(macManifestDir, "scientific-illustrator-officejs.xml");

async function generateCertificate() {
  await fs.mkdir(paths.state_dir, { recursive: true, mode: 0o700 });
  if (existsSync(paths.certificate_path) && existsSync(paths.private_key_path)) return false;
  const common = [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256", "-days", "825",
    "-keyout", paths.private_key_path, "-out", paths.certificate_path,
    "-subj", "/CN=localhost/O=Scientific Illustrator Local Development",
  ];
  try {
    await execFileAsync("openssl", [...common, "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1", "-addext", "basicConstraints=critical,CA:TRUE"], { maxBuffer: 4 * 1024 * 1024 });
  } catch (firstError) {
    const configPath = path.join(paths.state_dir, `openssl-${process.pid}.cnf`);
    const config = [
      "[req]", "distinguished_name=req_dn", "x509_extensions=v3_req", "prompt=no",
      "[req_dn]", "CN=localhost", "O=Scientific Illustrator Local Development",
      "[v3_req]", "subjectAltName=@alt_names", "basicConstraints=critical,CA:TRUE", "keyUsage=critical,digitalSignature,keyEncipherment,keyCertSign",
      "[alt_names]", "DNS.1=localhost", "IP.1=127.0.0.1", "",
    ].join("\n");
    await fs.writeFile(configPath, config, { mode: 0o600 });
    try {
      await execFileAsync("openssl", [...common.slice(0, -2), "-config", configPath], { maxBuffer: 4 * 1024 * 1024 });
    } catch (secondError) {
      throw new Error(`Could not generate the Office.js localhost certificate. Install OpenSSL and retry. ${secondError.message || firstError.message}`);
    } finally {
      await fs.unlink(configPath).catch(() => {});
    }
  }
  await Promise.all([
    fs.chmod(paths.private_key_path, 0o600),
    fs.chmod(paths.certificate_path, 0o644),
  ]);
  return true;
}

async function sideloadMacManifest() {
  if (process.platform !== "darwin") throw new Error("Automatic manifest sideloading is currently provided for Microsoft PowerPoint on macOS only.");
  await fs.mkdir(macManifestDir, { recursive: true });
  await fs.copyFile(paths.manifest_path, macManifestPath);
  return macManifestPath;
}

function status() {
  const certificateReady = existsSync(paths.certificate_path) && existsSync(paths.private_key_path);
  return {
    officejs_backend: "officejs-context-sync",
    platform: process.platform,
    certificate_ready: certificateReady,
    certificate_path: paths.certificate_path,
    private_key_path: paths.private_key_path,
    source_manifest_path: paths.manifest_path,
    sideload_manifest_path: process.platform === "darwin" ? macManifestPath : null,
    manifest_sideloaded: process.platform === "darwin" && existsSync(macManifestPath),
    taskpane_url: "https://localhost:17645/taskpane.html",
    trust_changed_automatically: false,
  };
}

function nextSteps() {
  if (process.platform === "darwin") {
    return [
      `Review and trust this local certificate in macOS Keychain Access: ${paths.certificate_path}`,
      "Restart Microsoft PowerPoint after trusting the certificate and sideloading the manifest.",
      "In a new Codex or Claude Code task, select Scientific Illustrator and call powerpoint_officejs_status once to start the local bridge.",
      "Then in PowerPoint, open Insert > My Add-ins > Scientific Illustrator Live and keep the task pane open.",
      "Call powerpoint_officejs_status again; connected must be true before drawing.",
    ];
  }
  return [
    `Trust the localhost certificate for the current user after reviewing it: ${paths.certificate_path}`,
    "Sideload officejs/manifest.xml with the Microsoft Office add-in development procedure for this platform.",
    "Call powerpoint_officejs_status in a new Codex or Claude Code task to start the bridge, then open Scientific Illustrator Live in PowerPoint and check status again.",
  ];
}

async function main() {
  if (command === "prepare") {
    const generated = await generateCertificate();
    process.stdout.write(`${JSON.stringify({ ...status(), certificate_generated: generated, next_steps: nextSteps() }, null, 2)}\n`);
    return;
  }
  if (command === "sideload") {
    await generateCertificate();
    const installed = await sideloadMacManifest();
    process.stdout.write(`${JSON.stringify({ ...status(), installed_manifest_path: installed, next_steps: nextSteps() }, null, 2)}\n`);
    return;
  }
  if (command === "status") {
    process.stdout.write(`${JSON.stringify({ ...status(), next_steps: nextSteps() }, null, 2)}\n`);
    return;
  }
  if (command === "help" || command === "--help" || command === "-h") {
    process.stdout.write("Usage: node officejs-setup.mjs <status|prepare|sideload>\n\nprepare generates a localhost certificate without trusting it.\nsideload also copies the reviewed manifest into the macOS PowerPoint WEF directory.\nNo command modifies certificate trust settings.\n");
    return;
  }
  throw new Error(`Unknown setup command: ${command}`);
}

main().catch((error) => {
  process.stderr.write(`${error.message || error}\n`);
  process.exitCode = 1;
});
