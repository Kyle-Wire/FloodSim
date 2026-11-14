// The instrumented SWMM build: the vendored SWMM 5.2.4 source, COPIED (vendor/ is never touched), with one addition, a
// link-volume getter (swmm_getValue property 420, LINK_VOLUME: a conduit's current stored volume, m³ in CMS units).
// Compiled with the same flags as tools/build-swmm.mjs, by the isolated Emscripten SDK, into ./out/. A manifest records
// the SDK identifiers, the compiler's own version text, every argument and environment variable it was given, and the
// hashes of the sources, the patch and the outputs.
//
// The production wasm's compiler version was never recorded (tools/build-swmm.mjs uses whatever emcc is on PATH), so this
// is not the same build. Its use is limited by compare-b1.mjs: behavioural agreement on B1, for B1 only.
//
//   node benchmarks/culvert/instrumented/build.mjs [path to emsdk]   (default ~/tools/emsdk-4.0.10)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '../../..');
const EMSDK = path.resolve(process.argv[2] ?? path.join(os.homedir(), 'tools', 'emsdk-4.0.10'));
const vendor = path.join(root, 'vendor', 'swmm', 'src', 'solver'), work = path.join(here, 'build', 'src'), out = path.join(here, 'out');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

// 1. copy the source (fresh each time)
fs.rmSync(path.join(here, 'build'), { recursive: true, force: true });
fs.cpSync(vendor, work, { recursive: true });
const vendorHashes = {}; for (const f of fs.readdirSync(vendor, { recursive: true })) { const p = path.join(vendor, f); if (fs.statSync(p).isFile()) vendorHashes[f.replace(/\\/g, '/')] = sha(fs.readFileSync(p)); }

// 2. the patch: one enum value and one getter case, each asserted to apply exactly once
const PATCH = [
  ['include/swmm5.h', '    swmm_LINK_RPTFLAG    = 414\n', '    swmm_LINK_RPTFLAG    = 414,\n    swmm_LINK_VOLUME     = 420   // INSTRUMENTED (FloodSim benchmarks): current stored volume\n'],
  ['swmm5.c', '        case swmm_LINK_DEPTH:\n          return link->newDepth * UCF(LENGTH);\n',
    '        case swmm_LINK_DEPTH:\n          return link->newDepth * UCF(LENGTH);\n        case swmm_LINK_VOLUME: // INSTRUMENTED (FloodSim benchmarks)\n          return link->newVolume * UCF(VOLUME);\n'],
];
for (const [f, a, b] of PATCH) {
  const p = path.join(work, f); let s = fs.readFileSync(p, 'utf8'); const crlf = s.includes('\r\n'); if (crlf) s = s.replace(/\r\n/g, '\n');
  const n = s.split(a).length - 1; if (n !== 1) throw new Error(`patch for ${f} matched ${n} times`);
  s = s.replace(a, b); fs.writeFileSync(p, crlf ? s.replace(/\n/g, '\r\n') : s);
}

// 3. the environment, for this child process only (nothing is written to PATH, the registry or the shell)
const node = fs.readdirSync(path.join(EMSDK, 'node'))[0], py = fs.readdirSync(path.join(EMSDK, 'python'))[0];
const env = { ...process.env, EMSDK, EM_CONFIG: path.join(EMSDK, '.emscripten'), EMSDK_NODE: path.join(EMSDK, 'node', node, 'bin', 'node.exe'), EMSDK_PYTHON: path.join(EMSDK, 'python', py, 'python.exe'),
  PATH: [path.join(EMSDK, 'upstream', 'emscripten'), path.join(EMSDK, 'node', node, 'bin'), path.join(EMSDK, 'python', py), process.env.PATH].join(path.delimiter) };
const emcc = path.join(EMSDK, 'upstream', 'emscripten', process.platform === 'win32' ? 'emcc.bat' : 'emcc');
const run = (args, cwd) => execFileSync(emcc, args, { cwd, env, encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 1 << 26 });

// 4. the same flags as tools/build-swmm.mjs
fs.mkdirSync(out, { recursive: true });
const files = fs.readdirSync(work).filter(f => f.endsWith('.c')).sort();
const exported = ['swmm_open', 'swmm_start', 'swmm_stride', 'swmm_step', 'swmm_end', 'swmm_report', 'swmm_close', 'swmm_run',
  'swmm_getError', 'swmm_getCount', 'swmm_getIndex', 'swmm_getName', 'swmm_getValue', 'swmm_setValue', 'swmm_getMassBalErr',
  'swmm_getVersion', 'swmm_getWarnings', 'malloc', 'free'].map(s => '_' + s);
const args = [...files, '-I', 'include', '-O2', '-DNDEBUG', '-w',
  '-sMODULARIZE=1', '-sEXPORT_ES6=1', '-sEXPORT_NAME=createSWMM', '-sENVIRONMENT=web,worker,node',
  '-sALLOW_MEMORY_GROWTH=1', '-sSTACK_SIZE=1048576', `-sEXPORTED_FUNCTIONS=${exported.join(',')}`,
  '-sEXPORTED_RUNTIME_METHODS=FS,cwrap,getValue,setValue,UTF8ToString', '-o', path.join(out, 'swmm.mjs').replace(/\\/g, '/')];
fs.writeFileSync(path.join(work, 'build.rsp'), args.join('\n'));
const version = run(['--version'], work);
const t0 = Date.now(); run(['@build.rsp'], work); const seconds = (Date.now() - t0) / 1000;

// 5. the manifest
const git = (cwd, a) => { try { return execFileSync('git', a, { cwd, encoding: 'utf8' }).trim(); } catch { return null; } };
const manifest = {
  written: new Date().toISOString(), seconds,
  sdk: { path: EMSDK, emsdkCommit: git(EMSDK, ['rev-parse', 'HEAD']), emsdkTag: git(EMSDK, ['describe', '--tags']),
    releasesRevision: JSON.parse(fs.readFileSync(path.join(EMSDK, 'emscripten-releases-tags.json'))).releases['4.0.10'],
    emscriptenVersionFile: fs.readFileSync(path.join(EMSDK, 'upstream', 'emscripten', 'emscripten-version.txt'), 'utf8').trim(),
    downloadsSha256: fs.existsSync(path.join(EMSDK, 'downloads.sha256')) ? fs.readFileSync(path.join(EMSDK, 'downloads.sha256'), 'utf8').trim().split('\n') : null },
  compilerVersionText: version.trim(),
  args, env: { EMSDK: env.EMSDK, EM_CONFIG: env.EM_CONFIG, EMSDK_NODE: env.EMSDK_NODE, EMSDK_PYTHON: env.EMSDK_PYTHON, PATH_prepended: env.PATH.split(path.delimiter).slice(0, 3) },
  patch: PATCH.map(([f, a, b]) => ({ file: f, sha256Before: vendorHashes[f], removed: a, added: b })),
  vendorSources: vendorHashes,
  outputs: Object.fromEntries(fs.readdirSync(out).map(f => [f, sha(fs.readFileSync(path.join(out, f)))])),
  production: { wasmSha256: sha(fs.readFileSync(path.join(root, 'vendor/swmm-wasm/swmm.wasm'))), compiler: 'not recorded (tools/build-swmm.mjs uses whatever emcc is on PATH)' },
};
fs.writeFileSync(path.join(here, 'BUILD-MANIFEST.json'), JSON.stringify(manifest, null, 1));
console.log(`built ${files.length} sources in ${seconds.toFixed(0)} s → out/swmm.mjs; ${version.split('\n')[0]}`);
