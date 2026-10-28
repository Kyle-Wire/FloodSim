// Runs the GPU suite in headless Chromium (SwiftShader WebGPU) and writes results JSON.
// Usage: node tests/run-gpu-browser.mjs <port> [--json out.json]   (serve the repo root on <port> first)
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import { writeFileSync, readdirSync } from 'node:fs';
const port = process.argv[2] || 8766;
const dir = readdirSync('/opt/pw-browsers').find(d => d.startsWith('chromium-'));
const exe = `/opt/pw-browsers/${dir}/chrome-linux64/chrome`;
const browser = await chromium.launch({ headless: true, executablePath: exe,
  args: ['--enable-unsafe-webgpu', '--enable-unsafe-swiftshader', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader'] });
const page = await browser.newPage();
page.on('console', m => console.log(m.text()));
page.on('pageerror', e => console.log('PAGE ERROR', e.message));
await page.goto(`http://localhost:${port}/${process.env.PAGE || "tests/gpu-browser.html"}`);
const results = await page.evaluate(() => window.__done, null, { timeout: 0 });
const j = process.argv.indexOf('--json'); if (j > 0) writeFileSync(process.argv[j + 1], JSON.stringify(results));
await browser.close();
