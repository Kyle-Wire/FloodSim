// GPU verification under Dawn (Node). Needs a working Vulkan/Metal/D3D driver.
// Usage: node tests/run-gpu-tests.mjs [--json out.json]
import { create, globals } from 'webgpu';
import { writeFileSync } from 'node:fs';
import { runGpuSuite } from './gpu-suite.js';
Object.assign(globalThis, globals);
const adapter = await create([]).requestAdapter();
if (!adapter) { console.error('No WebGPU adapter'); process.exit(1); }
const device = await adapter.requestDevice();
const keep = setInterval(() => {}, 100);
const results = await runGpuSuite(device);
const j = process.argv.indexOf('--json'); if (j > 0) writeFileSync(process.argv[j + 1], JSON.stringify(results));
clearInterval(keep); process.exit(0);
