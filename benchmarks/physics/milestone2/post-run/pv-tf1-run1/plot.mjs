// Figures for the PV-TF1 run-1 post-run analysis (UNSCORED). Reads the registered raw outputs and analysis.json;
// writes static SVG figures beside this file. Plain SVG, no dependencies. Bucketed min/max keeps every oscillation
// visible at full-run scale (no point is dropped from the envelope it draws).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from './analyse.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const A = JSON.parse(fs.readFileSync(path.join(here, 'analysis.json')));
const spec = JSON.parse(fs.readFileSync(path.resolve(here, '../../../spec/PV-TF1.json')));
const Cr = spec.criteria;
const INK = '#0b0b0b', INK2 = '#52514e', MUTED = '#8a8984', GRID = '#e6e5e0', SURF = '#fcfcfb';
const SER = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100']; // categorical slots 1-4, fixed order (validated, adjacent pairs)
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const fmt = (v) => { const a = Math.abs(v); if (v === 0) return '0'; if (a >= 1000 || a < 0.01) return v.toExponential(0).replace('e+', 'e'); return +v.toPrecision(3) + ''; };
function ticks(lo, hi, n = 5) { const step = Math.pow(10, Math.floor(Math.log10((hi - lo) / n))); const m = [1, 2, 2.5, 5, 10].find(k => (hi - lo) / (k * step) <= n) * step; const out = []; for (let v = Math.ceil(lo / m) * m; v <= hi + 1e-12; v += m) out.push(+v.toPrecision(12)); return out; }

/** one panel: series [{x, y, color, label, dash}], bands [{y0, y1}], hlines [{y, label}] */
function panel({ x, y, w, h, title, xr, yr, xlabel, ylabel, series, hlines = [], logY = false, logX = false, xt = null, yt = null, note = null }) {
  const L = 58, R = 10, T = 22, B = 34, pw = w - L - R, ph = h - T - B;
  const fx = (v) => x + L + (logX ? (Math.log10(v) - Math.log10(xr[0])) / (Math.log10(xr[1]) - Math.log10(xr[0])) : (v - xr[0]) / (xr[1] - xr[0])) * pw;
  const fy = (v) => y + T + ph - (logY ? (Math.log10(v) - Math.log10(yr[0])) / (Math.log10(yr[1]) - Math.log10(yr[0])) : (v - yr[0]) / (yr[1] - yr[0])) * ph;
  const clipY = (v) => Math.max(y + T, Math.min(y + T + ph, v));
  let s = `<g><text x="${x + L}" y="${y + 14}" font-size="12" font-weight="600" fill="${INK}">${esc(title)}</text>`;
  const yT = yt ?? (logY ? Array.from({ length: Math.floor(Math.log10(yr[1])) - Math.ceil(Math.log10(yr[0])) + 1 }, (_, i) => 10 ** (Math.ceil(Math.log10(yr[0])) + i)) : ticks(yr[0], yr[1]));
  const xT = xt ?? (logX ? Array.from({ length: Math.floor(Math.log10(xr[1])) - Math.ceil(Math.log10(xr[0])) + 1 }, (_, i) => 10 ** (Math.ceil(Math.log10(xr[0])) + i)) : ticks(xr[0], xr[1], 6));
  for (const v of yT) { const Y = fy(v); s += `<line x1="${x + L}" x2="${x + L + pw}" y1="${Y}" y2="${Y}" stroke="${GRID}" stroke-width="1"/><text x="${x + L - 5}" y="${Y + 3.5}" font-size="10" text-anchor="end" fill="${INK2}">${fmt(v)}</text>`; }
  for (const v of (Array.isArray(xT[0]) ? xT : xT.map(v => [v, fmt(v)]))) { const X = fx(v[0]); s += `<line x1="${X}" x2="${X}" y1="${y + T + ph}" y2="${y + T + ph + 4}" stroke="${MUTED}"/><text x="${X}" y="${y + T + ph + 15}" font-size="10" text-anchor="middle" fill="${INK2}">${esc(v[1])}</text>`; }
  s += `<line x1="${x + L}" x2="${x + L + pw}" y1="${y + T + ph}" y2="${y + T + ph}" stroke="${MUTED}"/>`;
  s += `<text x="${x + L + pw / 2}" y="${y + h - 4}" font-size="10" text-anchor="middle" fill="${INK2}">${esc(xlabel)}</text>`;
  s += `<text transform="translate(${x + 12},${y + T + ph / 2}) rotate(-90)" font-size="10" text-anchor="middle" fill="${INK2}">${esc(ylabel)}</text>`;
  s += `<clipPath id="c${x}_${y}"><rect x="${x + L}" y="${y + T}" width="${pw}" height="${ph}"/></clipPath><g clip-path="url(#c${x}_${y})">`;
  for (const hl of hlines) { const Y = fy(hl.y); s += `<line x1="${x + L}" x2="${x + L + pw}" y1="${Y}" y2="${Y}" stroke="${INK2}" stroke-width="1" stroke-dasharray="2 3"/>`; }
  // a trace leaves the plot where it leaves the y range (split there, never clamped onto the frame); the clip path
  // trims the one segment that crosses the edge
  for (const se of series) { const runs = [[]]; for (let i = 0; i < se.x.length; i++) { const yy = se.y[i]; if (!Number.isFinite(yy) || (logY && yy <= 0)) { runs.push([]); continue; }
      const Y = fy(yy), out = Y < y + T - 40 || Y > y + T + ph + 40; if (out) { runs.push([]); continue; } runs.at(-1).push(`${fx(se.x[i]).toFixed(1)},${Y.toFixed(1)}`); }
    for (const pts of runs) if (pts.length > 1) s += `<polyline fill="none" stroke="${se.color}" stroke-width="${se.width ?? 1.5}" stroke-linejoin="round" ${se.dash ? `stroke-dasharray="${se.dash}"` : ''} points="${pts.join(' ')}"/>`; }
  s += '</g>';
  for (const hl of hlines) if (hl.label) { const Y = fy(hl.y); s += `<text x="${x + L + pw - 3}" y="${Y - 3}" font-size="9.5" text-anchor="end" fill="${INK2}">${esc(hl.label)}</text>`; }
  // legend (always, for >= 2 series)
  const named = series.filter(se => se.label); if (named.length >= 2 || named.some(se => se.forceLegend)) { let lx = x + L + 6, ly = y + T + 10; for (const se of named) { s += `<line x1="${lx}" x2="${lx + 14}" y1="${ly - 3}" y2="${ly - 3}" stroke="${se.color}" stroke-width="2" ${se.dash ? `stroke-dasharray="${se.dash}"` : ''}/><text x="${lx + 18}" y="${ly}" font-size="9.5" fill="${INK}">${esc(se.label)}</text>`; lx += 24 + se.label.length * 5.4; } }
  if (note) s += `<text x="${x + L + pw - 3}" y="${y + T + ph - 5}" font-size="9.5" text-anchor="end" fill="${INK2}">${esc(note)}</text>`;
  return s + '</g>';
}
/** bucketed min/max so a full-run trace keeps every excursion */
function bucket(t, v, t0, t1, nb = 900) { const xs = [], ys = []; const dtb = (t1 - t0) / nb; let b = -1, mn = 0, mx = 0, tm = 0, tM = 0;
  const flush = () => { if (b < 0) return; if (tm <= tM) { xs.push(tm, tM); ys.push(mn, mx); } else { xs.push(tM, tm); ys.push(mx, mn); } };
  for (let i = 0; i < t.length; i++) { if (t[i] < t0 || t[i] > t1) continue; const k = Math.floor((t[i] - t0) / dtb); if (k !== b) { flush(); b = k; mn = mx = v[i]; tm = tM = t[i]; } else { if (v[i] < mn) { mn = v[i]; tm = t[i]; } if (v[i] > mx) { mx = v[i]; tM = t[i]; } } }
  flush(); return { x: xs, y: ys };
}
const svg = (w, h, body, title, desc) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="system-ui, -apple-system, Segoe UI, sans-serif"><title>${esc(title)}</title><desc>${esc(desc)}</desc><rect width="${w}" height="${h}" fill="${SURF}"/>${body}</svg>`;
const write = (name, s) => { fs.writeFileSync(path.join(here, name), s); console.log('wrote', name); };
const Ns = [1, 4, 16, 32], H = 3600, hrs = (t) => Array.from(t, v => v / H);

const data = {}; for (const N of Ns) { const r = load(`N${N}`); const t = r.series('t'); const h1 = r.series('T1.head'), h2 = r.series('T2.head');
  const cond = r.hdr.network.conduits.map(c => c.id), juncs = r.hdr.network.nodes.filter(x => x.id.startsWith('J')).map(x => x.id).sort((a, b) => +a.slice(1) - +b.slice(1));
  const pick = [...new Set([cond[0], cond[Math.floor(N / 2)] ?? cond[0], cond.at(-1)])]; const flows = Object.fromEntries(pick.map(c => [c, r.series(`${c}.flow`)]));
  const jp = juncs.length ? [...new Set([juncs[Math.floor((juncs.length - 1) / 4)], juncs[Math.floor((juncs.length - 1) / 2)], juncs[Math.floor(3 * (juncs.length - 1) / 4)]])] : [];
  const jdev = Object.fromEntries(jp.map(j => { const Hh = r.series(`${j}.head`); return [j, Hh.map((v, i) => (v - 0.5 * (h1[i] + h2[i])) * 1000)]; }));
  data[N] = { t, h1, h2, dH: h1.map((v, i) => (v - h2[i]) * 1000), flows, jdev }; }

// Figure 1: tank water-surface elevations, full run
{ let b = ''; const w = 560, h = 230; Ns.forEach((N, i) => { const d = data[N], x = (i % 2) * w, y = Math.floor(i / 2) * h;
    const a = bucket(d.t, d.h1, 0, 43200), c = bucket(d.t, d.h2, 0, 43200);
    b += panel({ x, y, w, h, title: `N = ${N}`, xr: [0, 12], yr: [0, 0.6], xlabel: 'simulated time (h)', ylabel: 'water surface (m, SWMM datum)', series: [{ x: hrs(a.x), y: a.y, color: SER[0], label: 'T1' }, { x: hrs(c.x), y: c.y, color: SER[1], label: 'T2' }], hlines: [{ y: spec.parameters.referenceLevel.value, label: 'still-water level 0.5066 m' }] }); });
  write('fig1-tank-wse.svg', svg(2 * w, 2 * h, b, 'Tank water surfaces', 'T1 and T2 NODE_HEAD over the 12 h run, per N, every routing step (bucketed min/max).')); }

// Figure 2: tank level difference, full run (top) and hours 6-12 zoom (bottom)
{ let b = ''; const w = 280, h = 230; Ns.forEach((N, i) => { const d = data[N]; const a = bucket(d.t, d.dH, 0, 43200, 500), z = bucket(d.t, d.dH, 21600, 43200, 500);
    b += panel({ x: i * w, y: 0, w, h, title: `N = ${N}: full run`, xr: [0, 12], yr: [-300, 300], xlabel: 'time (h)', ylabel: 'T1 − T2 (mm)', series: [{ x: hrs(a.x), y: a.y, color: SER[0] }], note: 'fill-phase peaks clipped' });
    b += panel({ x: i * w, y: h, w, h, title: `N = ${N}: hours 6–12`, xr: [6, 12], yr: [-6, 6], xlabel: 'time (h)', ylabel: 'T1 − T2 (mm)', series: [{ x: hrs(z.x), y: z.y, color: SER[0] }], hlines: [{ y: Cr.restLevelDiffM * 1000, label: '±1 mm' }, { y: -Cr.restLevelDiffM * 1000 }] }); });
  write('fig2-tank-level-difference.svg', svg(4 * w, 2 * h, b, 'Tank level difference', 'T1 minus T2 water surface (mm), every routing step; bottom row: hours 6–12 with the 1 mm rest condition.')); }

// Figure 3: conduit flows (first, middle, last segment): full run and the rest window
{ let b = ''; const w = 280, h = 230; Ns.forEach((N, i) => { const d = data[N]; const ids = Object.keys(d.flows);
    const full = ids.map((c, k) => { const q = bucket(d.t, d.flows[c], 0, 43200, 500); return { x: hrs(q.x), y: q.y, color: SER[k], label: c }; });
    const rest = ids.map((c, k) => { const q = bucket(d.t, d.flows[c].map(v => v * 1000), 39600, 43200, 500); return { x: hrs(q.x), y: q.y, color: SER[k], label: c }; });
    b += panel({ x: i * w, y: 0, w, h, title: `N = ${N}: full run`, xr: [0, 12], yr: [-0.05, 0.15], xlabel: 'time (h)', ylabel: 'flow (m³/s)', series: full });
    b += panel({ x: i * w, y: h, w, h, title: `N = ${N}: rest window (11–12 h)`, xr: [11, 12], yr: [-5, 5], xlabel: 'time (h)', ylabel: 'flow (10⁻³ m³/s)', series: rest, note: 'rest limit ±0.005 × 10⁻³: on the zero line', hlines: [{ y: 0 }] }); });
  write('fig3-conduit-flows.svg', svg(4 * w, 2 * h, b, 'Conduit flows', 'LINK_FLOW of the first, middle and last segment, every routing step; bottom: the rest window, where the registered limit (5e-6 m³/s) is indistinguishable from zero at this scale.')); }

// Figure 4: representative junction water surfaces minus the tank mean, hours 6-12
{ let b = ''; const w = 370, h = 230; [4, 16, 32].forEach((N, i) => { const d = data[N]; const ser = Object.entries(d.jdev).map(([j, v], k) => { const q = bucket(d.t, v, 21600, 43200, 600); return { x: hrs(q.x), y: q.y, color: SER[k], label: j }; });
    b += panel({ x: i * w, y: 0, w, h, title: `N = ${N}`, xr: [6, 12], yr: [-4, 4], xlabel: 'time (h)', ylabel: 'junction WSE − tank mean (mm)', series: ser, hlines: [{ y: Cr.restInternalWseAbsM * 1000, label: '±1 mm' }, { y: -Cr.restInternalWseAbsM * 1000 }] }); });
  write('fig4-junction-wse.svg', svg(3 * w, h, b, 'Junction water surfaces', 'Quarter, middle and three-quarter junction NODE_HEAD minus the mean tank water surface (mm), hours 6–12; N = 1 has no junction.')); }

// Figure 5: per-cycle decay envelopes (log), observed (solid) and the quadratic-friction fit extrapolated (dashed)
{ let b = ''; const w = 560, h = 300; const tx = [[1, '1 h'], [10, '10 h'], [24, '1 d'], [240, '10 d'], [2400, '100 d'], [24000, '1000 d']];
  const mk = (key, fitKey, scale, thr, ttl, yl, yr) => { const ser = [];
    Ns.forEach((N, k) => { const c = A.cases[`N${N}`]; const env = c.envelopes[key]; ser.push({ x: env.map(p => p[0] / H), y: env.map(p => p[1] * scale), color: SER[k], label: `N = ${N}` });
      const f = c.fits[fitKey]?.quadraticFriction; if (f) { const xs = [], ys = []; for (let lt = Math.log10(2); lt <= Math.log10(24000); lt += 0.02) { const t = 10 ** lt * H, m = 1 / (f.intercept + f.slopeOf1OverA * t); if (m > 0) { xs.push(10 ** lt); ys.push(m * scale); } } ser.push({ x: xs, y: ys, color: SER[k], dash: '5 4', width: 1.2 }); } });
    return { ser, thr, ttl, yl, yr }; };
  const p1 = mk('tankDiff', 'tankDiff_after2h', 1000, Cr.restLevelDiffM * 1000, 'Tank level difference, per-cycle maximum', 'mm', [0.01, 1000]);
  const p2 = mk('maxSegmentFlow', 'maxSegmentFlow_after2h', 1, Cr.restSegmentFlowAbsM3s, 'Largest segment |flow|, per-cycle maximum', 'm³/s', [1e-6, 1]);
  [p1, p2].forEach((p, i) => { b += panel({ x: i * w, y: 0, w, h, title: p.ttl, xr: [1, 24000], logX: true, logY: true, yr: p.yr, xt: tx, xlabel: 'simulated time (log); solid = observed (1–12 h), dashed = quadratic-friction fit, NOT observed', ylabel: p.yl, series: p.ser, hlines: [{ y: p.thr, label: `registered rest limit ${fmt(p.thr)} ${p.yl}` }] }); });
  write('fig5-decay-envelopes.svg', svg(2 * w, h, b, 'Oscillation decay', 'Per-cycle maxima of the tank level difference and of the largest segment flow, observed to 12 h, with the fitted 1/A = a + b t law extrapolated (dashed; a fit, not an observation).')); }
