// Scoring and classification for the physics verification suite. Statuses are never merged into one percentage.
//
// Error types (every scored row has exactly one):
//   physical-model  the model's equations against physics they do not contain (e.g. Manning against Darcy–Weisbach)
//   numerical       the solver against an exact solution of the SAME equations (discretisation, iteration, tolerance)
//   accounting      volume and continuity books: what went in, what is stored, what left
import crypto from 'node:crypto';

export const STATUSES = ['Passed', 'Failed', 'Qualified', 'Unsupported', 'Not independently validated', 'Numerically unstable', 'Insufficient reference data', 'Invalid setup'];
export const ERROR_TYPES = ['physical-model', 'numerical', 'accounting'];

/** Canonical JSON (sorted keys) and its SHA-256: the hash a spec's criteria revision must carry. */
export const canonical = (v) => (Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : JSON.stringify(v));
export const criteriaHash = (criteria) => crypto.createHash('sha256').update(canonical(criteria)).digest('hex');

/**
 * One scored row. `crit` { abs, rel } (either may be absent): the limit is max(abs, rel·|ref|). `status` overrides
 * the pass/fail decision (Qualified, Not independently validated, …) but the error is still computed and kept.
 */
export function row({ benchmark, caseId, quantity, errorType, ref, sim, crit = {}, status = null, unit = '', note = null, expected = null, extra = {} }) {
  if (!ERROR_TYPES.includes(errorType)) throw new Error(`row ${caseId}/${quantity}: errorType ${errorType}`);
  const abs = sim != null && ref != null ? sim - ref : null, rel = abs != null && ref !== 0 ? abs / Math.abs(ref) : null;
  const limit = ref != null && (crit.abs != null || crit.rel != null) ? Math.max(crit.abs ?? 0, (crit.rel ?? 0) * Math.abs(ref)) : null;
  let st = status;
  if (!st) st = abs == null || !Number.isFinite(abs) ? 'Insufficient reference data' : limit == null ? 'Insufficient reference data' : Math.abs(abs) <= limit ? 'Passed' : 'Failed';
  if (!STATUSES.includes(st)) throw new Error('unknown status ' + st);
  return { benchmark, case: caseId, quantity, errorType, unit, ref, sim, abs, rel, limit, criterion: crit, status: st, note, ...(expected ? { expected, caught: st === expected } : {}), ...extra };
}

/** Counts by status, by error type × status; deliberate-fault rows counted apart from the physics. */
export function tally(rows) {
  const by = {}, byType = {}, faults = { rows: 0, caught: 0 };
  for (const r of rows) {
    if (r.expected) { faults.rows++; if (r.caught) faults.caught++; continue; }
    by[r.status] = (by[r.status] ?? 0) + 1;
    const k = `${r.errorType}/${r.status}`; byType[k] = (byType[k] ?? 0) + 1;
  }
  return { byStatus: by, byErrorTypeAndStatus: byType, deliberateFaults: faults };
}
