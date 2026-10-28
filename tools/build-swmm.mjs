// Compile EPA SWMM 5.2.4 (vendor/swmm/src/solver) to WebAssembly → vendor/swmm-wasm/swmm.mjs (+ .wasm).
// Needs the Emscripten SDK on PATH, e.g.  . ~/emsdk/emsdk_env.ps1 ; npm run build:swmm   (or source emsdk_env.sh)
// Arguments go through a response file: on Windows emcc is a .bat, and cmd.exe both caps the command line at 8191
// characters and splits comma lists such as -sEXPORTED_FUNCTIONS=a,b,c.
import { execFileSync } from 'node:child_process';
import { readdirSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const src = join(root, 'vendor', 'swmm', 'src', 'solver'), out = join(root, 'vendor', 'swmm-wasm');
mkdirSync(out, { recursive: true });
const files = readdirSync(src).filter(f => f.endsWith('.c'));
const exported = ['swmm_open', 'swmm_start', 'swmm_stride', 'swmm_step', 'swmm_end', 'swmm_report', 'swmm_close', 'swmm_run',
  'swmm_getError', 'swmm_getCount', 'swmm_getIndex', 'swmm_getName', 'swmm_getValue', 'swmm_setValue', 'swmm_getMassBalErr',
  'swmm_getVersion', 'swmm_getWarnings', 'malloc', 'free'].map(s => '_' + s);
const args = [
  ...files, '-I', 'include', '-O2', '-DNDEBUG', '-w',
  '-sMODULARIZE=1', '-sEXPORT_ES6=1', '-sEXPORT_NAME=createSWMM', '-sENVIRONMENT=web,worker,node',
  '-sALLOW_MEMORY_GROWTH=1', '-sSTACK_SIZE=1048576', `-sEXPORTED_FUNCTIONS=${exported.join(',')}`,
  '-sEXPORTED_RUNTIME_METHODS=FS,cwrap,getValue,setValue,UTF8ToString',
  '-o', join('..', '..', '..', 'swmm-wasm', 'swmm.mjs').replace(/\\/g, '/'),
];
const rsp = join(src, 'build.rsp');
writeFileSync(rsp, args.join('\n'));
// recent emsdk ships emcc.exe on Windows (older ones emcc.bat, which needs a shell)
const winBat = process.platform === 'win32' && !process.env.PATH.split(';').some(p => { try { return readdirSync(p).includes('emcc.exe'); } catch { return false; } });
console.log(`emcc: ${files.length} sources → ${join(out, 'swmm.mjs')}`);
try { execFileSync(winBat ? 'emcc.bat' : 'emcc', ['@build.rsp'], { stdio: 'inherit', shell: winBat, cwd: src }); }
finally { rmSync(rsp, { force: true }); }
console.log('done');
