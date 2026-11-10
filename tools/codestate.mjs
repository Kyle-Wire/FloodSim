// The code a run was made with: the commit, and the files in it that differ from that commit. Only files that can change
// a result count (the app, the engine, the server, the vendored libraries, the tools that drive a run), new untracked
// ones included: a run whose code was committed is "clean" even while docs or the validation suite's own score files
// (benchmarks/validation/README.md, history.json) are being rewritten, and a run with an uncommitted source file is not.
// A dirty checkout also gets a hash of those files' contents: two runs made at one commit with different uncommitted
// edits (one rule tried, then a narrower one) are then different code, not both "+dirty".
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const CODE_PATHS = ['app', 'src', 'server', 'vendor', 'dist', 'tools', 'package.json', 'package-lock.json'];

/** Hash (8 hex) of the changed files' contents, in path order (a deleted file counts as deleted). */
export function changedHash(root, changed) {
  const h = createHash('sha1');
  for (const f of [...changed].sort()) {
    h.update(f + '\0');
    try { h.update(readFileSync(join(root, f))); } catch { h.update('\0deleted'); }
    h.update('\0');
  }
  return h.digest('hex').slice(0, 8);
}

/** → { commit (12 hex), dirty, changed: ['src/x.js', …], diff: content hash of the changed files | null }; nulls outside a git checkout. */
export function codeState(root) {
  const git = (...a) => spawnSync('git', a, { cwd: root, encoding: 'utf8' });
  const head = git('rev-parse', '--short=12', 'HEAD');
  const st = git('status', '--porcelain', '--untracked-files=all', '--', ...CODE_PATHS, ':(exclude,glob)**/*.md');
  if (head.status !== 0 || st.status !== 0) return { commit: head.status === 0 ? head.stdout.trim() : null, dirty: null, changed: [], diff: null };
  // status lines: staged and unstaged edits, untracked and deleted files; a rename "old -> new" counts both paths (the
  // old one as deleted). The hash is of the working tree, which is what the server serves.
  const unq = (p) => p.replace(/^"|"$/g, '');
  const changed = [...new Set(st.stdout.split('\n').filter(Boolean).flatMap(l => l.slice(3).split(' -> ').map(unq)))];
  return { commit: head.stdout.trim(), dirty: changed.length > 0, changed, diff: changed.length ? changedHash(root, changed) : null };
}
