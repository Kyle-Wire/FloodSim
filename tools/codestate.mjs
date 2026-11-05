// The code a run was made with: the commit, and the files in it that differ from that commit. Only files that can change
// a result count (the app, the engine, the server, the vendored libraries, the tools that drive a run), new untracked
// ones included: a run whose code was committed is "clean" even while docs or the validation suite's own score files
// (benchmarks/validation/README.md, history.json) are being rewritten, and a run with an uncommitted source file is not.
import { spawnSync } from 'node:child_process';

export const CODE_PATHS = ['app', 'src', 'server', 'vendor', 'dist', 'tools', 'package.json', 'package-lock.json'];

/** → { commit (12 hex), dirty, changed: ['src/x.js', …] }; nulls outside a git checkout. */
export function codeState(root) {
  const git = (...a) => spawnSync('git', a, { cwd: root, encoding: 'utf8' });
  const head = git('rev-parse', '--short=12', 'HEAD');
  const st = git('status', '--porcelain', '--untracked-files=all', '--', ...CODE_PATHS, ':(exclude,glob)**/*.md');
  if (head.status !== 0 || st.status !== 0) return { commit: head.status === 0 ? head.stdout.trim() : null, dirty: null, changed: [] };
  const changed = st.stdout.split('\n').filter(Boolean).map(l => l.slice(3).replace(/^.* -> /, ''));
  return { commit: head.stdout.trim(), dirty: changed.length > 0, changed };
}
