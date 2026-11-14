# Instrumented SWMM build (benchmarks only)

The vendored SWMM 5.2.4 source, copied, with one getter added. It is built by an isolated Emscripten SDK into `out/`.

- `vendor/swmm` and `vendor/swmm-wasm` are not touched.
- Production (`src/swmm.js`) never loads this build.
- A benchmark uses it only through `FLOODSIM_SWMM_MJS`, which is unset by default.

```
node benchmarks/culvert/instrumented/build.mjs        → out/swmm.mjs, out/swmm.wasm, BUILD-MANIFEST.json
node benchmarks/culvert/instrumented/compare-b1.mjs   → b1/, b1-production/, COMPARE-B1.json
```

## The SDK: identifiers, and how they were verified (11 Nov 2026)

Two identifiers from two repositories, both recorded:

| | Repository | Identifier |
|---|---|---|
| emsdk tag `4.0.10` | github.com/emscripten-core/emsdk | commit `62a853cd3b3134398ce85cde8bb5cbb2ef0194cb` (lightweight tag; "Release 4.0.10 (#1565)", 2025-06-07) |
| toolchain release | chromium.googlesource.com/emscripten-releases | revision `8103ffedfb0c42d231c6af6859a5a1a832260b43` ("Version 4.0.10 RC2", 2025-06-06) |

**How they relate.**
- `emscripten-releases-tags.json` at emsdk commit `62a853cd` maps `4.0.10` → `8103ffed`. It is also that file's
  `latest`.
- `8103ffed`'s DEPS pin:
  - emscripten `b7dc6e5747465580df5984e723b9d1f10d8e804b`;
  - llvm-project `8f7e57485ee73205e108d74abb5565d5c63beaca`;
  - binaryen `8c82b6884483315011541e4519afdcb7fd46df68`.
- The installed `emcc --version` reports `4.0.10 (b7dc6e5747465580df5984e723b9d1f10d8e804b)`, the same emscripten
  revision.

**`emsdk.py` at the checkout.**
- It is Git blob `22c08386`, identical to the copy reviewed before the install.
- Its file hash differs only because `core.autocrlf` wrote CRLF line endings. The LF-normalised SHA-256 matches:
  `07ca1287…`.
- `emsdk.py` itself verifies no checksums. The archives' SHA-256 are recorded below, after download; there was no
  published value to compare them with.

## The install

- **Where:** `~/tools/emsdk-4.0.10` (a clone, checked out at `62a853cd`).
- **How:** `EMSDK_KEEP_DOWNLOADS=1 python emsdk.py install 4.0.10`, then `python emsdk.py activate 4.0.10`, with no
  `--permanent` or `--system`.
- **Nothing outside that folder was changed:**
  - `.emscripten` is in the SDK folder;
  - `HKCU\Environment` is byte-identical before and after activation (snapshots in the session record);
  - no PATH, registry or toolchain change was made.
  - The build sets the SDK's environment for its own child process only.
- **The archives are kept in `downloads/`.** SHA-256 (also in `downloads.sha256` there and in `BUILD-MANIFEST.json`):

  | Archive | Size | SHA-256 |
  |---|---|---|
  | `8103ffed…-wasm-binaries.zip` | 539,321,345 bytes | `1a66825e85fda039f57d39c98ae2bdb96a18e53745159e9599f69679be18439f` |
  | `node-v22.16.0-win-x64.zip` | 37,497,627 bytes | `c2d6eb9645ffaa3d95665a3cfad49ab206e3cac26099ec23f5d17738abd01c40` |
  | `python-3.13.3-0-win-amd64.zip` | 29,736,374 bytes | `6fe7a540c6b8b185780467cf7495e884ee62316ec4abb19e1c735b8a77c62465` |

## The instrumentation

One enum value and one getter case, applied to the copy by `build.mjs`. Each is asserted to apply exactly once:
- `swmm5.h`: `swmm_LINK_VOLUME = 420`.
- `swmm5.c`, `swmm_getValue`: `case swmm_LINK_VOLUME: return link->newVolume * UCF(VOLUME);`

Everything else is the vendored source, compiled with the flags of `tools/build-swmm.mjs`. `BUILD-MANIFEST.json`
records:
- the arguments and the environment;
- the compiler's version text;
- every vendored source's hash;
- the patch;
- the outputs' hashes.

## Agreement with production: B1 only

`compare-b1.mjs` runs `b1-inlet.mjs` twice:
- with this engine, into `b1/`;
- with production, into `b1-production/`.

`results/b1-inlet.json` is not touched; its hash is the same before and after.

- **All 1683 numbers in the two B1 result files are identical.** The largest difference is 0.
- Both runs exit 1, with B1's 37 known failures, as in round 3.
- **The getter:** a 0.9 m × 100 m pipe held full reads 63.6243 m³, against π D²/4 · L = 63.6173 m³ (+0.011 %).

**What this establishes.** The instrumented build behaves the same as production on B1, and on B1 only.

**What it does not establish:**
- that the builds are identical. The production wasm's compiler version was never recorded, so it cannot be
  reproduced or compared at the binary level;
- agreement on any other benchmark.

Any other use needs its own comparison first.

**The getter does not give an independent conduit volume.** It reads SWMM's own book: the volume SWMM computes from its
link depth, the same quantity PV-C1-b showed to be circular. It can show what SWMM believes is stored. It cannot check
whether that is right.
