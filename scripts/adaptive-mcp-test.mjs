import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

for (const [file, name] of [['live-server.mjs', 'drawio_live_plan_reconstruction'], ['powerpoint-server.mjs', 'powerpoint_plan_reconstruction']]) {
  test(`${name} is discoverable and callable without connecting an application`, async () => {
    const child = spawn(process.execPath, [fileURLToPath(new URL(`../plugins/scientific-illustrator/scripts/${file}`, import.meta.url))], { stdio: ['pipe', 'pipe', 'pipe'] });
    const lines = createInterface({ input: child.stdout });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const input = { reference_size: { width: 100, height: 100 }, modules: [{ id: 'sample', kind: 'photo', confidence: 0.9, source_available: true, bbox: { x: 10, y: 10, width: 80, height: 80 } }] };
    try {
      const responses = await new Promise((resolve, reject) => {
        const result = new Map();
        const timer = setTimeout(() => reject(new Error(`Planner MCP timed out: ${stderr}`)), 5000);
        child.once('error', (error) => { clearTimeout(timer); reject(error); });
        child.once('exit', () => { if (result.size < 3) { clearTimeout(timer); reject(new Error(`MCP exited: ${stderr}`)); } });
        lines.on('line', (line) => {
          try {
            const message = JSON.parse(line);
            result.set(message.id, message);
            if (result.size === 3) { clearTimeout(timer); resolve(result); }
          } catch (error) { clearTimeout(timer); reject(error); }
        });
        for (const [id, method, params] of [[1, 'tools/list', {}], [2, 'tools/call', { name, arguments: input }], [3, 'tools/call', { name, arguments: { ...input, max_attempts: -1 } }]]) {
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
        }
      });
      assert.ok(responses.get(1).result.tools.some((tool) => tool.name === name));
      assert.equal(responses.get(2).result.structuredContent.modules[0].strategy, 'crop');
      assert.equal(responses.get(2).result.structuredContent.automatic_image_analysis, false);
      assert.equal(responses.get(3).result.isError, true);
      assert.match(responses.get(3).result.content[0].text, /max_attempts/);
    } finally { lines.close(); child.kill(); }
  });
}
