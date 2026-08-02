import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packagePath = path.join(root, "package.json");
const rootPackage = JSON.parse(await fs.readFile(packagePath, "utf8"));
const marketplacePath = path.join(root, ".agents", "plugins", "marketplace.json");
const marketplace = JSON.parse(await fs.readFile(marketplacePath, "utf8"));

if (marketplace.name !== "scientific-illustrator-tools") throw new Error("Unexpected marketplace name.");
if (!Array.isArray(marketplace.plugins) || marketplace.plugins.length !== 1) {
  throw new Error("Marketplace must expose exactly one plugin.");
}

const entry = marketplace.plugins[0];
if (entry.source?.source !== "local") throw new Error("Marketplace source must be local.");
if (entry.policy?.installation !== "AVAILABLE" || entry.policy?.authentication !== "ON_INSTALL") {
  throw new Error("Marketplace policy is incomplete.");
}

const pluginRoot = path.resolve(path.dirname(marketplacePath), "..", "..", entry.source.path);
const manifestPath = path.join(pluginRoot, ".codex-plugin", "plugin.json");
const mcpPath = path.join(pluginRoot, ".mcp.json");
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
const mcp = JSON.parse(await fs.readFile(mcpPath, "utf8"));

if (entry.name !== manifest.name || manifest.name !== "scientific-illustrator") {
  throw new Error("Marketplace and manifest plugin names differ.");
}
if (manifest.version !== "1.6.0") throw new Error("Unexpected public release version.");
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(manifest.version)) {
  throw new Error("Manifest version is not valid semantic versioning.");
}
if (rootPackage.version !== manifest.version) throw new Error("Package and plugin versions differ.");
if (manifest.repository !== "https://github.com/icebird1998/scientific-illustrator") {
  throw new Error("Manifest repository URL is incorrect.");
}
if (manifest.author?.name !== "科研up主:进击的土博" || manifest.interface?.developerName !== "科研up主:进击的土博") {
  throw new Error("Developer attribution is missing.");
}
if (!Array.isArray(manifest.interface?.defaultPrompt) || manifest.interface.defaultPrompt.length > 3) {
  throw new Error("Default prompts are invalid.");
}
if (manifest.interface.defaultPrompt.some((prompt) => [...prompt].length > 128)) {
  throw new Error("A default prompt exceeds 128 characters.");
}

const requiredServers = ["drawio-live", "drawio-file-utils", "powerpoint-live"];
for (const server of requiredServers) {
  const definition = mcp.mcpServers?.[server];
  if (!definition || definition.command !== "node" || !Array.isArray(definition.args)) {
    throw new Error(`Required MCP server is missing or invalid: ${server}`);
  }
  for (const argument of definition.args.filter((value) => value.endsWith(".mjs"))) {
    await fs.access(path.resolve(pluginRoot, argument));
  }
}
for (const serverFile of ["live-server.mjs", "server.mjs", "powerpoint-server.mjs", "officejs-bridge.mjs"]) {
  const source = await fs.readFile(path.join(pluginRoot, "scripts", serverFile), "utf8");
  if (!source.includes(`const SERVER_VERSION = "${manifest.version}";`)) {
    throw new Error(`${serverFile} does not report plugin version ${manifest.version}.`);
  }
}
for (const serverFile of ["live-server.mjs", "server.mjs", "powerpoint-server.mjs"]) {
  const source = await fs.readFile(path.join(pluginRoot, "scripts", serverFile), "utf8");
  if (!source.includes("let requestQueue = Promise.resolve()") || !source.includes("requestQueue.then(() => processInputLine(line))")) {
    throw new Error(`${serverFile} does not serialize stateful MCP requests.`);
  }
}
const ooxmlBridgePath = path.join(pluginRoot, "scripts", "powerpoint-mac-bridge.py");
await fs.access(ooxmlBridgePath);
await fs.access(path.join(pluginRoot, "scripts", "officejs-bridge.mjs"));
await fs.access(path.join(pluginRoot, "scripts", "officejs-setup.mjs"));
const [ooxmlBridge, powerpointServer] = await Promise.all([
  fs.readFile(ooxmlBridgePath, "utf8"),
  fs.readFile(path.join(pluginRoot, "scripts", "powerpoint-server.mjs"), "utf8"),
]);
for (const fragment of [
  "/Applications/wpsoffice.localized/wpsoffice.app",
  "com.kingsoft.wpsoffice.mac",
  "WPS_PRESENTATION_PATH",
  "SCIENTIFIC_ILLUSTRATOR_STATE_DIR",
  "document_open_verified",
  "refresh_verified",
  "_parse_macos_process_ids",
  "_parse_windows_tasklist_process_ids",
  '"connected_to_active_application": False',
  "Editing .pptm or .ppsx could discard macros",
  "repeat with deckIndex from 1 to count of presentations",
  "get path of presentation deckIndex",
  "set targetName to item 3 of argv",
  "_powerpoint_document_open_verification",
  "PowerPoint may release its file descriptor",
  "reload_blocked_by_unsaved_changes",
  'result["document_open_before"] is not True',
  '"already_closed": True',
  '"close_timed_out": close_timed_out',
]) {
  if (!ooxmlBridge.includes(fragment)) throw new Error(`OOXML WPS reliability safeguard is missing: ${fragment}`);
}
for (const forbidden of [
  '"active_presentation": bool(path and path.exists())',
  '["pgrep", "-f", process_pattern]',
  '"presentation_count": 0',
]) {
  if (ooxmlBridge.includes(forbidden)) throw new Error(`False-positive WPS status logic returned: ${forbidden}`);
}
for (const fragment of ["powerpoint_refresh", 'pacingMode = args.pacing_mode || "checkpoint"', "SCIENTIFIC_ILLUSTRATOR_DEFER_REFRESH"]) {
  if (!powerpointServer.includes(fragment)) throw new Error(`Checkpoint refresh safeguard is missing: ${fragment}`);
}
for (const fragment of ["const OOXML_STATE_DIR =", "presentations\", \"sessions", "let hostPreference =", "let lockedHost = null", "effectiveArgs.host_application = requested", "runOoxmlBridge(\"status\", effectiveArgs)", "No object was dispatched for this operation", "host_preference: hostPreference", "locked_host: lockedHost", "Backend ${backend} cannot control WPS Presentation", "if (inheritedHost) operation.host_application = inheritedHost"]) {
  if (!powerpointServer.includes(fragment)) throw new Error(`PowerPoint/WPS target-application lock safeguard is missing: ${fragment}`);
}
const drawioPathSource = await fs.readFile(path.join(pluginRoot, "scripts", "drawio-path.mjs"), "utf8");
for (const fragment of ["drawioExecutableCandidates", 'platform === "win32"', 'platform === "darwin"', "DRAWIO_PATH"]) {
  if (!drawioPathSource.includes(fragment)) throw new Error(`Cross-platform draw.io discovery safeguard is missing: ${fragment}`);
}
const drawioLiveSource = await fs.readFile(path.join(pluginRoot, "scripts", "live-server.mjs"), "utf8");
for (const fragment of [
  "BASELINE_SHAPE_SET",
  "registered_stencils",
  "mxStencilRegistry.getStencil",
  "Unknown or unloaded draw.io shape",
  "refused draw.io's silent rectangle fallback",
  "unknownBareTokens",
  "unregistered resolved renderer",
  "shape_validation",
  '"edgeStyle=none;rounded=0;html=1;endArrow=none;startArrow=none;"',
]) {
  if (!drawioLiveSource.includes(fragment)) throw new Error(`draw.io no-silent-shape-fallback safeguard is missing: ${fragment}`);
}
const workflow = await fs.readFile(path.join(root, ".github", "workflows", "ci.yml"), "utf8");
for (const runner of ["ubuntu-latest", "macos-latest", "windows-latest"]) {
  if (!workflow.includes(runner)) throw new Error(`CI platform matrix is missing ${runner}.`);
}
await fs.access(path.join(root, "scripts", "wps-bridge-unit.py"));
await fs.access(path.join(root, "scripts", "wps-reliability-smoke.mjs"));
await fs.access(path.join(root, "scripts", "compile-python.mjs"));
await fs.access(path.join(root, "scripts", "platform-compat-smoke.mjs"));
await fs.access(path.join(root, "scripts", "windows-compat-smoke.ps1"));
const officeJsManifestPath = path.join(pluginRoot, "officejs", "manifest.xml");
await fs.access(officeJsManifestPath);
const officeJsManifest = await fs.readFile(officeJsManifestPath, "utf8");
if (!officeJsManifest.includes(`<Version>${manifest.version}.0</Version>`)) {
  throw new Error("Office.js and plugin versions differ.");
}
for (const [element, fileName, width, height] of [
  ["IconUrl", "icon-32.png", 32, 32],
  ["HighResolutionIconUrl", "icon-64.png", 64, 64],
]) {
  const match = officeJsManifest.match(new RegExp(`<${element}\\s+DefaultValue="([^"]+)"\\s*/>`));
  const expectedUrl = `https://localhost:17645/assets/${fileName}`;
  if (match?.[1] !== expectedUrl) {
    throw new Error(`${element} must use ${expectedUrl}; Office manifest icons cannot use SVG.`);
  }
  const image = await fs.readFile(path.join(pluginRoot, "officejs", "assets", fileName));
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!image.subarray(0, pngSignature.length).equals(pngSignature)) {
    throw new Error(`${fileName} is not a valid PNG asset.`);
  }
  if (image.readUInt32BE(16) !== width || image.readUInt32BE(20) !== height) {
    throw new Error(`${fileName} must be ${width}x${height} pixels.`);
  }
}
await fs.access(path.join(pluginRoot, "officejs", "taskpane.html"));
const officeJsTaskpanePath = path.join(pluginRoot, "officejs", "taskpane.js");
await fs.access(officeJsTaskpanePath);
const officeJsTaskpane = await fs.readFile(officeJsTaskpanePath, "utf8");
if (!officeJsTaskpane.includes('shape.shape_type !== "Line"') || !officeJsTaskpane.includes('shape.shape_type === "Image"')) {
  throw new Error("Office.js audit must classify inspected inventory entries through shape_type.");
}
for (const fragment of [
  "Office.js cannot safely retarget arrowhead geometry in place",
  "Office.js chart composite does not implement",
  "table.columns.load(\"items\")",
  "fill_transparency",
  "const textSettings =",
  "Aspect-ratio-preserving Office.js export requires PowerPointApi 1.10",
  "scatterMaximum === scatterMinimum",
  "Shape target is ambiguous",
  "duplicate_name",
  "assertShapeNameAvailable",
  "Shape name already exists on this slide",
  "Table data has ${args.data.length} rows",
  "cell_styles entry (${style.row},${style.column}) is outside",
  "Office.js editable presentation export requires a .pptx output_path",
]) {
  if (!officeJsTaskpane.includes(fragment)) throw new Error(`Office.js no-silent-degradation safeguard is missing: ${fragment}`);
}
const comBridge = await fs.readFile(path.join(pluginRoot, "scripts", "powerpoint-bridge.ps1"), "utf8");
for (const fragment of ["preserve_aspect_ratio", "$presentation.PageSetup.SlideWidth", "aspect_ratio_preserved"]) {
  if (!comBridge.includes(fragment)) throw new Error(`Windows COM export fidelity safeguard is missing: ${fragment}`);
}
if (!comBridge.includes("Shape target is ambiguous because semantic name")) throw new Error("Windows COM duplicate-name target safeguard is missing.");

const requiredSkills = [
  "audit-scientific-figure",
  "correct-scientific-figure",
  "design-scientific-figure",
  "edit-powerpoint-live",
  "recreate-scientific-figure",
  "recreate-scientific-figure-in-drawio",
];
for (const skill of requiredSkills) {
  await fs.access(path.join(pluginRoot, "skills", skill, "SKILL.md"));
  await fs.access(path.join(pluginRoot, "skills", skill, "agents", "openai.yaml"));
}

async function collectFiles(directory) {
  const files = [];
  for (const item of await fs.readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, item.name);
    if (item.isDirectory()) files.push(...await collectFiles(fullPath));
    else files.push(fullPath);
  }
  return files;
}

for (const file of await collectFiles(pluginRoot)) {
  const text = await fs.readFile(file, "utf8");
  if (/C:\\Users\\[^\\]+|C:\/Users\/[^/]+|ProgramData\\miniconda3|gho_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+/i.test(text)) {
    throw new Error(`Local path or credential-like value found in ${path.relative(root, file)}.`);
  }
  if (/\[TODO:[^\]]*\]/i.test(text)) throw new Error(`TODO placeholder found in ${path.relative(root, file)}.`);
}

console.log("Repository structure, attribution, portability, and plugin metadata checks passed.");
