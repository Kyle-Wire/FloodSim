// Stamp every benchmarks/ea/results/test*.json with the provenance a referee needs to reproduce it:
// which code version produced the number, which input archive it was fed, and which GPU ran it.
//
// Without this, a published EA score is a number with no version attached — the first thing an external
// reviewer attacks. Run it immediately after a benchmark run, from the same checkout:
//
//   node benchmarks/ea/stamp-provenance.mjs --archive path/to/Benchmarking_Model_Data.zip
//   node benchmarks/ea/stamp-provenance.mjs --sha256 <hex>   (when the archive is no longer on disk)
//
// --check-only hashes the archive, reports whether it is the expected one and exits without touching any
// result. It exists so a long run can verify its inputs before it starts rather than after: the check and the
// stamp then share one expected value, instead of a second copy of the hash living in a CI workflow.
//
// The adapter is not read here: benchmarks/ea/run.html already records it in each result as it runs, which is
// the only place that knows it. This script refuses to stamp a result that has no adapter recorded, so a file
// stamped by this script always names all three of commit, archive hash and GPU.
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const opt = (name, dflt) => { const i = argv.indexOf('--' + name); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : dflt; };

const resultsDir = fileURLToPath(new URL('./results/', import.meta.url));
const root = fileURLToPath(new URL('../../', import.meta.url));

// The archive this benchmark is defined against. Recorded so a stamp cannot quietly be made from a different
// download: --archive is hashed and must match, and --sha256 must equal it too.
const ARCHIVE = {
  name: 'Benchmarking_Model_Data.zip',
  url: 'https://assets.publishing.service.gov.uk/media/6033a9bbd3bf7f72182e99ca/Benchmarking_Model_Data.zip',
  sha256: '388c2789570e5975fe909033e34bedbe5d7bde5e6d7f9b7d7c1eaf04e58bc732',
  bytes: 52456734,
};

const sha256File = (p) => new Promise((ok, fail) => {
  const h = createHash('sha256');
  createReadStream(p).on('data', d => h.update(d)).on('end', () => ok(h.digest('hex'))).on('error', fail);
});

const git = (...args) => { try { return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim(); } catch { return null; } };

// ---- which inputs produced the numbers
let sha256 = opt('sha256') ?? null, verifiedFrom = sha256 ? 'asserted on the command line' : null;
const archivePath = opt('archive');
if (archivePath) {
  if (!existsSync(archivePath)) { console.error(`--archive ${archivePath}: not found`); process.exit(1); }
  sha256 = await sha256File(archivePath);
  verifiedFrom = `hashed from ${archivePath}`;
}
if (!sha256) { console.error('need --archive <zip> or --sha256 <hex>'); process.exit(1); }
const checkOnly = argv.includes('--check-only');
if (sha256.toLowerCase() !== ARCHIVE.sha256) {
  console.error(`archive SHA-256 mismatch:\n  got      ${sha256}\n  expected ${ARCHIVE.sha256}\nThe inputs are not the archive this benchmark is defined against; not ${checkOnly ? 'proceeding' : 'stamping'}.`);
  process.exit(1);
}
if (checkOnly) {
  // A check that was satisfied by an assertion rather than by a measurement is not a check, so say which it
  // was. --check-only with --sha256 only confirms the operator typed the right hex, and reads as exactly that.
  console.log(`EA data archive SHA-256 matches ${ARCHIVE.sha256} (${verifiedFrom}).`);
  process.exit(0);
}

// ---- which code version produced them
const commit = git('rev-parse', 'HEAD');
if (!commit) { console.error('not a git checkout: cannot record a commit, and an unpinned result is the thing this script exists to prevent'); process.exit(1); }
// Only files that can change the numbers count towards "dirty". A modified README or workflow does not
// invalidate a run; a modified solver or case definition does.
const NUMERIC = /^(src\/|benchmarks\/ea\/(cases|case7|lib|test7-river)\.mjs|benchmarks\/ea\/run\.html)/;
const porcelain = (git('status', '--porcelain') ?? '').split('\n').filter(Boolean).map(l => l.slice(3));
const dirtyNumeric = porcelain.filter(p => NUMERIC.test(p.replace(/\\/g, '/')));

const stamp = {
  commit,
  commitSubject: git('log', '-1', '--format=%s'),
  commitDateISO: git('log', '-1', '--format=%cI'),
  // True if any file that can change a benchmark number was uncommitted at stamp time. A result with this set
  // is not pinned to the commit it names, and says so rather than looking clean.
  numericTreeDirty: dirtyNumeric.length > 0,
  ...(dirtyNumeric.length ? { dirtyNumericFiles: dirtyNumeric } : {}),
  dataArchive: { ...ARCHIVE, sha256, verifiedFrom },
  stampedUTC: new Date().toISOString(),
};

const files = readdirSync(resultsDir).filter(f => /^test[0-9]+[ab]?\.json$/.test(f)).sort();
if (!files.length) { console.error(`no results/test*.json in ${resultsDir}`); process.exit(1); }

let missingAdapter = 0;
for (const f of files) {
  const p = resultsDir + f;
  const r = JSON.parse(readFileSync(p, 'utf8'));
  const adapterString = r.adapterString ?? (r.adapter ? String(r.adapter) : null);
  if (!adapterString || adapterString === '?') {
    console.error(`${f}: no GPU adapter recorded — re-run the benchmark with the current run.html before stamping`);
    missingAdapter++; continue;
  }
  r.provenance = { ...stamp, adapter: adapterString, adapterInfo: r.adapterInfo ?? null, runDate: r.date ?? null };
  writeFileSync(p, JSON.stringify(r));
  console.log(`${f.padEnd(12)} commit ${commit.slice(0, 7)}  archive ${sha256.slice(0, 8)}…  ${adapterString}`);
}

console.log(`\n${files.length - missingAdapter}/${files.length} results stamped at ${commit.slice(0, 7)}` +
  (stamp.numericTreeDirty ? `\nWARNING: ${dirtyNumeric.length} uncommitted file(s) can change the numbers: ${dirtyNumeric.join(', ')}` : ''));
process.exit(missingAdapter ? 1 : 0);
