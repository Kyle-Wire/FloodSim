// WGSL compute kernels. A line-for-line port of solver-cpu.js.
// One module; each pipeline uses layout:'auto', so it binds only what its entry point touches.
export const KERNELS_WGSL = /* wgsl */`
struct Params {
  nx: u32, ny: u32, NX: u32, NY: u32,
  dx: f32, g: f32, hdry: f32, hfront: f32,
  cfl: f32, rain: f32, tEnd: f32, dtDry: f32,
  secondOrder: u32, limiter: u32, bcW: u32, bcE: u32,
  bcS: u32, bcN: u32, nInlets: u32, stage: f32,
  tilesX: u32, tilesY: u32, tiles: u32, nBar: u32,
  nLine: u32, pad1: u32, pad2: u32, pad3: u32,
};
const GH: i32 = 2;
override STAGE: u32 = 0u;

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read_write> U: array<vec4f>;   // h, hu, hv, -
@group(0) @binding(2) var<storage, read_write> U0: array<vec4f>;  // stage-start copy
@group(0) @binding(3) var<storage, read_write> S: array<vec4f>;   // z, manning n, mask, infiltration (m/s); sediment moves z
@group(0) @binding(4) var<storage, read_write> W: array<vec4f>;   // primitives incl. ghosts: h, eta, u, v
@group(0) @binding(5) var<storage, read_write> FX: array<f32>;    // 9 per x-face, stored at right cell
@group(0) @binding(6) var<storage, read_write> FY: array<f32>;    // 9 per y-face, stored at upper cell
@group(0) @binding(7) var<storage, read_write> A: array<vec4f>;   // max depth, infil cum (m), outflow cum (m3), clipped (m)
@group(0) @binding(8) var<storage, read_write> DT: array<f32>;    // dt, t, kahan c, steps
@group(0) @binding(9) var<storage, read_write> RED: atomic<u32>;  // max wave speed (float bits)
@group(0) @binding(10) var<storage, read_write> OUT: array<vec2f>; // render: depth, speed
@group(0) @binding(11) var<storage, read_write> TH: array<f32>;    // draining-time scale per donor cell (1 in ghosts)
@group(0) @binding(12) var<storage, read> RF: array<f32>;         // rainfall multiplier per cell (roof routing; 1 by default)
@group(0) @binding(13) var<storage, read> INC: array<u32>;        // drainage inlets: padded cell index
@group(0) @binding(14) var<storage, read> INQ: array<f32>;        // inlet exchange rate, m3/s (+ = surface into network)
@group(0) @binding(15) var<storage, read_write> INX: array<vec4f>; // volume exchanged since last read (m3), latest depth (m), Kahan residual of x
@group(0) @binding(16) var<storage, read> STG: array<f32>;         // 1 on ghost cells that see the external water level (P.stage)
// active tiles (8×8 interior cells): wet flags, always-active flags, the two tile lists, their counts, indirect args
@group(0) @binding(17) var<storage, read_write> TF: array<atomic<u32>>; // per tile: 1 if any cell holds water this step
@group(0) @binding(18) var<storage, read> TS: array<u32>;               // per tile: 1 = always active (inlets, stage edges)
@group(0) @binding(19) var<storage, read_write> TL: array<u32>;         // [0, tiles): wet ⊕ 1 tile; [tiles, 2·tiles): wet ⊕ 2 tiles
@group(0) @binding(20) var<storage, read_write> TC: array<atomic<u32>>; // the two list lengths
@group(0) @binding(21) var<storage, read_write> TA: array<u32>;         // indirect dispatch args: (n1, 1, 1), (n2, 1, 1)
// green infrastructure: per-cell GI infiltration into a store of fixed capacity that drains to native soil
@group(0) @binding(22) var<storage, read> GI: array<vec4f>;          // rate (m/s), capacity (m), drain to the native soil (m/s), underdrain (m/s); capacity 0 = no GI
@group(0) @binding(23) var<storage, read_write> GS: array<vec4f>;   // GI stored (m), time of last update (s), Green-Ampt depth infiltrated F (m per pervious area), underdrained so far (m)
// Green-Ampt (src/soil.js): ψ·Δθ (m), soil storage to the water table / bedrock (m per pervious area), pervious share, on
@group(0) @binding(31) var<storage, read> GAP: array<vec4f>;
// flood barriers on cell faces: crest (m, -1e30 = none) and weir coefficient, for the x-face west of the cell and the
// y-face below it; the barrier faces in a list, and per face the volume over in each direction plus its peak rate
@group(0) @binding(24) var<storage, read> CR: array<vec4f>;          // x crest, x weir C, y crest, y weir C
@group(0) @binding(25) var<storage, read> BF: array<u32>;            // padded cell index x 2 + (1 for a y-face)
@group(0) @binding(26) var<storage, read_write> BQ: array<vec4f>;  // [3m] volume over +, −, Kahan +, −; [3m+1] peak |q| (m²/s), highest water, peak load (kN/m), ground; [3m+2] their times, first overtopping (−1 = never)
@group(0) @binding(27) var<storage, read_write> HZ: array<vec4f>;  // [4c] peak d·v, peak force, time deeper than 15 cm, arrival (−1 = never); [4c+1] worst class ARR, FD2320, FD2320 urban
                                                                    // [4c+2] peak bed shear (Pa), excess shear × time (Pa·s), potential erosion (m), time of peak shear;
                                                                    // [4c+3] peak speed where deeper than 5 cm, first time deeper than 5 cm (−1 = never)
@group(0) @binding(32) var<storage, read> SCR: array<vec4f>;       // scour: critical shear of the erodible ground (Pa; 1e9 = paved / not erodible), Manning n; sediment: sand and gravel sizes (m)
// sediment state, 4 vec4 per cell (ping-pong: each pass reads SDI and writes SDO, and the host swaps them; see sedAdvect)
@group(0) @binding(33) var<storage, read> SDI: array<vec4f>;
@group(0) @binding(34) var<storage, read_write> SDO: array<vec4f>;
// sediment ground per cell: the soil's own critical shear (Pa) and its skin (grain) roughness n = d50^⅙ / 21.1: the share of
// the flow's shear that reaches the soil under grass or trees (HEC-15's effective shear), not the total that includes drag;
// its strength for slope failure: cohesion c′ with roots (Pa), tan φ′
@group(0) @binding(35) var<storage, read> SDP: array<vec4f>;
// sediment, fixed per cell (2 vec4, ghosts included): the initial bed store per class (m); the initial bed z (the bed is
// always z0 + its change, so small changes are not lost to rounding), soil depth to bedrock (m), effective porosity, -
@group(0) @binding(36) var<storage, read> SE0: array<vec4f>;
// bank stability (src/banks.js), 2 vec4 per bank: [2b] bank-top cell, toe (water) cell (padded indices), horizontal run
// L (m), cohesion c′ (Pa); [2b+1] tan φ′, the bank water table's lag T (s), water-table elevation (−1e30 = none), -
@group(0) @binding(37) var<storage, read> BK: array<vec4f>;
// per bank: [3b] bank water-table elevation (state), lowest FS, highest probability of failure during the run given the
// bank stood at the start (−1 = not rated: it stands only on strength the survey lacks), its time; [3b+1] FS now,
// probability now, highest channel water against the bank (m), time of the lowest FS; [3b+2] bank water and river
// over the toe at the start (m), the chance it stands then (from the soil's strength alone), -
@group(0) @binding(38) var<storage, read_write> BR: array<vec4f>;
override LIST: u32 = 1u;
override TRACKMAX: bool = true; // tiled entry points: 1 = update list (wet ⊕ 1), 2 = flux list (wet ⊕ 2)
const TILE: u32 = 8u;

fn lim(a: f32, b: f32) -> f32 {
  if (a * b <= 0.0) { return 0.0; }
  if (P.limiter == 1u) { return 2.0 * a * b / (a + b); }
  return select(b, a, abs(a) < abs(b));
}

// Outward velocity at a free-outfall edge cell e (n = next cell inward): Manning velocity on the water-surface slope
// toward the edge beyond OUT_SLOPE, capped at critical. A level or inward-sloping surface gives 0, so still water stays
// still (the threshold keeps √slope from amplifying round-off into a drain).
const OUT_SLOPE: f32 = 1e-4;
fn outVel(e: i32, n: i32) -> f32 {
  let he = U[e].x;
  if (he <= P.hdry || U[n].x <= P.hdry || S[n].z < 0.5) { return 0.0; } // a dry inner cell (its bed) drives nothing
  let s = ((U[n].x + S[n].x) - (he + S[e].x)) / P.dx - OUT_SLOPE;
  if (s <= 0.0) { return 0.0; }
  let crit = sqrt(P.g * he);
  if (S[e].y <= 0.0) { return crit; }
  return min(crit, pow(he, 2.0 / 3.0) * sqrt(s) / S[e].y);
}

// ---- primitives, with mirrored ghost cells (wall = reflect normal velocity, open = copy)
@compute @workgroup_size(8, 8)
fn prim(@builtin(global_invocation_id) gid: vec3u) {
  let NX = i32(P.NX); let NY = i32(P.NY);
  let i = i32(gid.x); let j = i32(gid.y);
  if (i >= NX || j >= NY) { return; }
  var si = i; var sj = j; var fu = 1.0; var fv = 1.0;
  // walls mirror across the boundary face; open / outflow edges copy the edge cell into every ghost layer
  if (i < GH) { si = select(GH, 2 * GH - 1 - i, P.bcW == 0u); } else if (i >= NX - GH) { si = select(NX - GH - 1, 2 * (NX - GH) - 1 - i, P.bcE == 0u); }
  if (j < GH) { sj = select(GH, 2 * GH - 1 - j, P.bcS == 0u); } else if (j >= NY - GH) { sj = select(NY - GH - 1, 2 * (NY - GH) - 1 - j, P.bcN == 0u); }
  let c = j * NX + i;
  let q = U[sj * NX + si];
  // bc: 0 wall (reflect), 1 open (transmissive), 2 outflow (free outfall: normal-depth velocity, see outVel)
  if (i < GH && P.bcW == 0u) { fu = -1.0; }
  if (i >= NX - GH && P.bcE == 0u) { fu = -1.0; }
  if (j < GH && P.bcS == 0u) { fv = -1.0; }
  if (j >= NY - GH && P.bcN == 0u) { fv = -1.0; }
  var u = 0.0; var v = 0.0;
  if (q.x > P.hdry) { u = q.y / q.x * fu; v = q.z / q.x * fv; }
  let e = sj * NX + si;
  if (i < GH && P.bcW == 2u) { u = -outVel(e, e + 1); }
  if (i >= NX - GH && P.bcE == 2u) { u = outVel(e, e - 1); }
  if (j < GH && P.bcS == 2u) { v = -outVel(e, e + NX); }
  if (j >= NY - GH && P.bcN == 2u) { v = outVel(e, e - NX); }
  // water-level boundary: ghost surface held at the observed stage (tide / surge), velocity zero-gradient
  if (STG[c] > 0.5 && P.stage - S[c].x > P.hdry) {
    let hs = P.stage - S[c].x;
    if (q.x <= P.hdry) { u = 0.0; v = 0.0; } else { u = q.y / q.x; v = q.z / q.x; }
    W[c] = vec4f(hs, P.stage, u, v);
    return;
  }
  W[c] = vec4f(q.x, q.x + S[c].x, u, v);
}

// ---- MUSCL reconstruction of (h, eta, u_n, u_t) toward side sg along stride s
fn recon(c: i32, s: i32, sg: f32, isX: bool) -> vec4f {
  let wc = W[c]; let wa = W[c - s]; let wb = W[c + s];
  let Ma = S[c - s].z > 0.5; let Mb = S[c + s].z > 0.5;
  let qc = vec4f(wc.x, wc.y, select(wc.w, wc.z, isX), select(wc.z, wc.w, isX));
  var fo = (P.secondOrder == 0u) || (wc.x < P.hfront);
  if ((Ma && wa.x < P.hfront) || (Mb && wb.x < P.hfront)) { fo = true; }
  if (fo) { return qc; }
  var qa = vec4f(wa.x, wa.y, select(wa.w, wa.z, isX), select(wa.z, wa.w, isX));
  var qb = vec4f(wb.x, wb.y, select(wb.w, wb.z, isX), select(wb.z, wb.w, isX));
  if (!Ma) { qa = qc; }
  if (!Mb) { qb = qc; }
  let hf = 0.5 * sg;
  return vec4f(qc.x + hf * lim(qc.x - qa.x, qb.x - qc.x),
               qc.y + hf * lim(qc.y - qa.y, qb.y - qc.y),
               qc.z + hf * lim(qc.z - qa.z, qb.z - qc.z),
               qc.w + hf * lim(qc.w - qa.w, qb.w - qc.w));
}

// ---- HLLC (Toro) in the face-normal frame
fn hllc(hL_: f32, uL_: f32, vL_: f32, hR_: f32, uR_: f32, vR_: f32) -> vec3f {
  let g = P.g;
  let wetL = hL_ > P.hdry; let wetR = hR_ > P.hdry;
  if (!wetL && !wetR) { return vec3f(0.0); }
  let hL = hL_; let hR = hR_;
  let uL = select(0.0, uL_, wetL); let vL = select(0.0, vL_, wetL);
  let uR = select(0.0, uR_, wetR); let vR = select(0.0, vR_, wetR);
  let cL = sqrt(g * hL); let cR = sqrt(g * hR);
  var SL: f32; var SR: f32;
  if (!wetL) { SL = uR - 2.0 * cR; SR = uR + cR; }
  else if (!wetR) { SL = uL - cL; SR = uL + 2.0 * cL; }
  else {
    let us = 0.5 * (uL + uR) + cL - cR;
    let cs = 0.5 * (cL + cR) + 0.25 * (uL - uR);
    SL = min(uL - cL, us - cs); SR = max(uR + cR, us + cs);
  }
  let FL0 = hL * uL; let FL1 = hL * uL * uL + 0.5 * g * hL * hL;
  let FR0 = hR * uR; let FR1 = hR * uR * uR + 0.5 * g * hR * hR;
  if (SL >= 0.0) { return vec3f(FL0, FL1, FL0 * vL); }
  if (SR <= 0.0) { return vec3f(FR0, FR1, FR0 * vR); }
  let den = SR - SL;
  let H0 = (SR * FL0 - SL * FR0 + SL * SR * (hR - hL)) / den;
  let H1 = (SR * FL1 - SL * FR1 + SL * SR * (hR * uR - hL * uL)) / den;
  let dSM = hR * (uR - SR) - hL * (uL - SL);
  var SM = 0.0;
  if (abs(dSM) > 1e-30) { SM = (SL * hR * (uR - SR) - SR * hL * (uL - SL)) / dSM; }
  return vec3f(H0, H1, H0 * select(vR, vL, SM >= 0.0));
}

// ---- flow over a barrier crest zc on the face a|b: broad-crested weir q = C·H1^1.5 from the higher water surface,
// Villemonte submergence (1 − (H2/H1)^1.5)^0.385, capped so one stage cannot more than half-close the level difference
// (drowned flow stays stable). Momentum carries the critical velocity over the crest; pressure is the mean of the
// two sides' depths over the crest, so water at rest on both sides stays at rest.
fn weir(a: i32, b: i32, isX: bool, zc: f32, cw: f32, hLs: f32, hRs: f32) -> vec3f {
  let wa = W[a]; let wb = W[b];
  let left = wa.y >= wb.y;
  let up = select(wb, wa, left); let dn = select(wa, wb, left);
  let pres = 0.25 * P.g * (hLs * hLs + hRs * hRs);
  let H1 = up.y - zc;
  if (H1 <= P.hdry || up.x <= P.hdry) { return vec3f(0.0, pres, 0.0); }
  let r = max(0.0, dn.y - zc) / H1;
  if (r >= 1.0) { return vec3f(0.0, pres, 0.0); }
  var q = cw * pow(H1, 1.5) * pow(1.0 - pow(r, 1.5), 0.385);
  if (DT[0] > 0.0) { q = min(q, (up.y - dn.y) * P.dx / (4.0 * DT[0])); }
  let un = q / max(2.0 / 3.0 * H1, P.hdry);
  let F0 = select(-q, q, left);
  return vec3f(F0, q * un + pres, F0 * select(up.z, up.w, isX));
}

// ---- face flux with hydrostatic reconstruction (Audusse et al. 2004); a barrier crest above both beds is a weir
fn face(a: i32, b: i32, s: i32, isX: bool, zc: f32, cw: f32) -> array<f32, 9> {
  var o: array<f32, 9>;
  let Ma = S[a].z > 0.5; let Mb = S[b].z > 0.5;
  if (!Ma && !Mb) { return o; }
  var L = vec4f(0.0); var R = vec4f(0.0);
  if (Ma) { L = recon(a, s, 1.0, isX); }
  if (Mb) { R = recon(b, s, -1.0, isX); }
  if (!Mb) { R = vec4f(L.x, L.y, -L.z, L.w); }
  if (!Ma) { L = vec4f(R.x, R.y, -R.z, R.w); }
  let zL = L.y - L.x; let zR = R.y - R.x;
  let zs = max(max(zL, zR), zc);
  let hLs = max(0.0, L.y - zs); let hRs = max(0.0, R.y - zs);
  var F: vec3f;
  if (Ma && Mb && zc > max(S[a].x, S[b].x)) { F = weir(a, b, isX, zc, cw, hLs, hRs); } else { F = hllc(hLs, L.z, L.w, hRs, R.z, R.w); }
  o[0] = F.x; o[1] = F.y; o[2] = F.z;
  o[3] = select(0.5 * P.g * (L.x * L.x - hLs * hLs), 0.0, !Ma);
  o[4] = select(0.5 * P.g * (R.x * R.x - hRs * hRs), 0.0, !Mb);
  o[5] = L.x; o[6] = zL; o[7] = R.x; o[8] = zR;
  return o;
}

// Depth is stored as fp32 h (U.x) plus a Kahan residual (U.w): the true depth is h − w. Cells that take in and pass on
// nearly the same water every step (inflows, river links) round the same way each time in plain fp32 and drift
// (~1e-4 of the volume over hours); carrying the residual keeps the books at round-off.
fn kadd(q: vec4f, d: f32) -> vec4f {
  var r = q; let y = d - q.w; let t = q.x + y;
  r.w = (t - q.x) - y; r.x = t;
  return r;
}

fn faceXAt(x: u32, y: u32) {
  if (x > P.nx || y >= P.ny) { return; }
  let NX = i32(P.NX);
  let b = (i32(y) + GH) * NX + i32(x) + GH;
  let cr = CR[b];
  let o = face(b - 1, b, 1, true, cr.x, cr.y);
  for (var k = 0; k < 9; k++) { FX[b * 9 + k] = o[k]; }
}
fn faceYAt(x: u32, y: u32) {
  if (x >= P.nx || y > P.ny) { return; }
  let NX = i32(P.NX);
  let b = (i32(y) + GH) * NX + i32(x) + GH;
  let cr = CR[b];
  let o = face(b - NX, b, NX, false, cr.z, cr.w);
  for (var k = 0; k < 9; k++) { FY[b * 9 + k] = o[k]; }
}
// interior cell handled by a tiled workgroup: tile from the list, cell from the local id
fn tileCell(wid: vec3u, lid: vec3u) -> vec2u {
  let t = TL[select(0u, P.tiles, LIST == 2u) + wid.x];
  return vec2u((t % P.tilesX) * TILE + lid.x, (t / P.tilesX) * TILE + lid.y);
}
@compute @workgroup_size(8, 8)
fn faceX(@builtin(global_invocation_id) gid: vec3u) { faceXAt(gid.x, gid.y); }
@compute @workgroup_size(8, 8)
fn faceY(@builtin(global_invocation_id) gid: vec3u) { faceYAt(gid.x, gid.y); }
@compute @workgroup_size(8, 8)
fn faceXT(@builtin(workgroup_id) wid: vec3u, @builtin(local_invocation_id) lid: vec3u) { let c = tileCell(wid, lid); faceXAt(c.x, c.y); }
@compute @workgroup_size(8, 8)
fn faceYT(@builtin(workgroup_id) wid: vec3u, @builtin(local_invocation_id) lid: vec3u) { let c = tileCell(wid, lid); faceYAt(c.x, c.y); }

// ---- draining-time limiter: theta = min(1, cell volume / volume it would export this stage)
@compute @workgroup_size(8, 8)
fn theta(@builtin(global_invocation_id) gid: vec3u) { thetaAt(gid.x, gid.y); }
@compute @workgroup_size(8, 8)
fn thetaT(@builtin(workgroup_id) wid: vec3u, @builtin(local_invocation_id) lid: vec3u) { let c = tileCell(wid, lid); thetaAt(c.x, c.y); }
fn thetaAt(x: u32, y: u32) {
  if (x >= P.nx || y >= P.ny) { return; }
  let NX = i32(P.NX);
  let c = (i32(y) + GH) * NX + i32(x) + GH;
  var t = 1.0;
  if (S[c].z > 0.5) {
    let fw = FX[c * 9]; let fe = FX[(c + 1) * 9]; let fs = FY[c * 9]; let fq = FY[(c + NX) * 9];
    let outv = (max(fe, 0.0) - min(fw, 0.0) + max(fq, 0.0) - min(fs, 0.0)) * P.dx * DT[0];
    let vol = U[c].x * P.dx * P.dx;
    if (outv > vol) { t = vol / outv; }
  }
  TH[c] = t;
}
fn fx3(f: i32, l: i32, r: i32) -> vec3f { let F = vec3f(FX[f], FX[f + 1], FX[f + 2]); return F * TH[select(r, l, F.x > 0.0)]; }
fn fy3(f: i32, l: i32, r: i32) -> vec3f { let F = vec3f(FY[f], FY[f + 1], FY[f + 2]); return F * TH[select(r, l, F.x > 0.0)]; }

// ---- barrier books, after theta and before the update, from the stage's own primitives (W): the flux the update will
// apply at each barrier face, booked as overtopping only while the barrier is up and the water against it stands more
// than BAR_OVER over the crest (thinner films are rain running off a berm top). In stage 0 (the step-start state) also
// the peak unit discharge, the highest water against the face and the peak hydrostatic load, each with its time.
// Faces of tiles the step skipped can hold stale fluxes, but their cells are dry, so faces with no water are skipped.
const BAR_OVER: f32 = 0.02;
@compute @workgroup_size(64)
fn barrier(@builtin(global_invocation_id) gid: vec3u) {
  let m = gid.x;
  if (m >= P.nBar) { return; }
  let dt = DT[0];
  if (dt <= 0.0) { return; }
  let code = BF[m]; let b = i32(code >> 1u); let isY = (code & 1u) == 1u;
  let a = b - select(1, i32(P.NX), isY);
  let wa = W[a]; let wb = W[b];
  if (wa.x <= 0.0 && wb.x <= 0.0) { return; }
  let cr = CR[b]; let crest = select(cr.x, cr.z, isY);
  if (crest < -1e29) { return; }
  let ea = select(-1e30, wa.y, wa.x > 0.005); let eb = select(-1e30, wb.y, wb.x > 0.005); let w = max(ea, eb);
  var f = FX[b * 9]; if (isY) { f = FY[b * 9]; }
  f = f * TH[select(b, a, f > 0.0)];
  let over = w > crest + BAR_OVER;
  var tm = BQ[3u * m + 2u]; let tnow = DT[1] - dt;
  if (over) {
    let v = f * P.dx * dt * select(1.0, 0.5, P.secondOrder == 1u);
    var q = BQ[3u * m];
    if (v > 0.0) { let y = v - q.z; let t = q.x + y; q.z = (t - q.x) - y; q.x = t; }
    if (v < 0.0) { let y = -v - q.w; let t = q.y + y; q.w = (t - q.y) - y; q.y = t; }
    BQ[3u * m] = q;
    if (tm.w < 0.0 && v != 0.0) { tm.w = tnow; }
  }
  if (STAGE == 0u) {
    var pk = BQ[3u * m + 1u];
    if (over && abs(f) > pk.x) { pk.x = abs(f); tm.x = tnow; }
    if (w > pk.y) { pk.y = w; tm.y = tnow; }
    let dA = max(0.0, min(ea, crest) - pk.w); let dB = max(0.0, min(eb, crest) - pk.w);
    let load = select(0.0, 0.5 * P.g * abs(dA * dA - dB * dB), pk.w > -1e29); // kN/m: ½ρg·Δ(d²), ρ = 1000 kg/m³
    if (load > pk.z) { pk.z = load; tm.z = tnow; }
    BQ[3u * m + 1u] = pk;
  }
  BQ[3u * m + 2u] = tm;
}

// ---- hazard and intensity, every step after the sources (see src/hazard.js): per cell the peak depth × velocity, peak
// force per metre of width ρ(h·v² + ½g·h²), time deeper than HZ_THR and the time it first got that deep, and the worst
// hazard class under ARR 2019 H1–H6, FD2320 and FD2320 with the urban debris factor. Velocity counts only where the
// water is at least HZ_VCUT deep (thinner wetting-front water is velocity noise); under HZ_WET nothing is classified.
const HZ_WET: f32 = 0.01; const HZ_VCUT: f32 = 0.05; const HZ_THR: f32 = 0.15;
fn arrClass(d: f32, v: f32) -> f32 {
  let dv = d * v;
  if (dv <= 0.3 && d <= 0.3 && v <= 2.0) { return 1.0; }
  if (dv <= 0.6 && d <= 0.5 && v <= 2.0) { return 2.0; }
  if (dv <= 0.6 && d <= 1.2 && v <= 2.0) { return 3.0; }
  if (dv <= 1.0 && d <= 2.0 && v <= 2.0) { return 4.0; }
  if (dv <= 4.0 && d <= 4.0 && v <= 4.0) { return 5.0; }
  return 6.0;
}
fn hrClass(hr: f32) -> f32 { if (hr < 0.75) { return 1.0; } if (hr < 1.25) { return 2.0; } if (hr < 2.0) { return 3.0; } return 4.0; }
@compute @workgroup_size(8, 8)
fn hazard(@builtin(global_invocation_id) gid: vec3u) { hazardAt(gid.x, gid.y); }
@compute @workgroup_size(8, 8)
fn hazardT(@builtin(workgroup_id) wid: vec3u, @builtin(local_invocation_id) lid: vec3u) { let c = tileCell(wid, lid); hazardAt(c.x, c.y); }
fn hazardAt(x: u32, y: u32) {
  if (x >= P.nx || y >= P.ny) { return; }
  let c = (i32(y) + GH) * i32(P.NX) + i32(x) + GH;
  if (S[c].z < 0.5) { return; }
  let dt = DT[0];
  if (dt <= 0.0) { return; }
  let q = U[c]; let d = q.x;
  if (d < HZ_WET) { return; }
  var v = 0.0; if (d >= HZ_VCUT) { v = sqrt(q.y * q.y + q.z * q.z) / d; }
  hzRecord(c, d, v, dt);
}
fn hzRecord(c: i32, d: f32, v: f32, dt: f32) {
  var h0 = HZ[4 * c]; var h1 = HZ[4 * c + 1];
  h0.x = max(h0.x, d * v); h0.y = max(h0.y, d * v * v + 0.5 * P.g * d * d);
  if (d > HZ_THR) { h0.z += dt; if (h0.w < 0.0) { h0.w = DT[1]; } }
  var h3 = HZ[4 * c + 3]; // peak speed (where deeper than HZ_VCUT) and the first time deeper than HZ_VCUT
  if (d > HZ_VCUT) { h3.x = max(h3.x, v); if (h3.y < 0.0) { h3.y = DT[1]; } }
  HZ[4 * c + 3] = h3;
  let hr = d * (v + 0.5);
  h1.x = max(h1.x, arrClass(d, v)); h1.y = max(h1.y, hrClass(hr)); h1.z = max(h1.z, hrClass(hr + select(0.0, 1.0, d > 0.25)));
  HZ[4 * c] = h0; HZ[4 * c + 1] = h1;
  // bed shear τ = ρg·n²·v²/h^⅓ (Manning); over the ground's critical shear it scours at ε = k_d·(τ − τc), with the
  // erodibility k_d = 0.2·τc^−½ cm³/(N·s) (Hanson & Simon 2001). Indicative depths: no supply limit, no deposition.
  let tc = SCR[c];
  if (d >= HZ_VCUT && tc.y > 0.0) {
    let tau = 1000.0 * P.g * tc.y * tc.y * v * v / pow(d, 1.0 / 3.0);
    var h2 = HZ[4 * c + 2];
    if (tau > h2.x) { h2.x = tau; h2.w = DT[1]; }
    if (tau > tc.x) { h2.y += (tau - tc.x) * dt; h2.z += 0.2e-6 * inverseSqrt(tc.x) * (tau - tc.x) * dt; }
    HZ[4 * c + 2] = h2;
  }
}

// ---- conservative update: STAGE 0 = Euler / RK stage 1, STAGE 1 = RK stage 2 (Heun average)
@compute @workgroup_size(8, 8)
fn update(@builtin(global_invocation_id) gid: vec3u) { updateAt(gid.x, gid.y); }
@compute @workgroup_size(8, 8)
fn updateT(@builtin(workgroup_id) wid: vec3u, @builtin(local_invocation_id) lid: vec3u) { let c = tileCell(wid, lid); updateAt(c.x, c.y); }
fn updateAt(x: u32, y: u32) {
  if (x >= P.nx || y >= P.ny) { return; }
  let NX = i32(P.NX); let NY = i32(P.NY);
  let i = i32(x) + GH; let j = i32(y) + GH;
  let c = j * NX + i;
  if (S[c].z < 0.5) { return; }
  let dt = DT[0];
  if (dt <= 0.0) { return; }
  let w = c * 9; let e = (c + 1) * 9; let sI = c * 9; let nI = (c + NX) * 9;
  let inv = 1.0 / P.dx;
  let hW = FX[w + 7]; let zW = FX[w + 8]; let hE = FX[e + 5]; let zE = FX[e + 6];
  let hS = FY[sI + 7]; let zS = FY[sI + 8]; let hN = FY[nI + 5]; let zN = FY[nI + 6];
  let Fw = fx3(w, c - 1, c); let Fe = fx3(e, c, c + 1); let Fs = fy3(sI, c - NX, c); let Fn = fy3(nI, c, c + NX);
  let dh = -inv * (Fe.x - Fw.x + Fn.x - Fs.x);
  let dhu = -inv * ((Fe.y + FX[e + 3]) - (Fw.y + FX[w + 4]) + 0.5 * P.g * (hW + hE) * (zE - zW) + Fn.z - Fs.z);
  let dhv = -inv * ((Fn.y + FY[nI + 3]) - (Fs.y + FY[sI + 4]) + 0.5 * P.g * (hS + hN) * (zN - zS) + Fe.z - Fw.z);
  var q = U[c];
  if (STAGE == 0u) {
    U0[c] = q;
    q.y = q.y + dt * dhu; q.z = q.z + dt * dhv;
    q = kadd(q, dt * dh);
  } else {
    // Heun average of the true depths (h − w), added to this stage's depth as one compensated increment
    let q0 = U0[c];
    q.y = 0.5 * (q0.y + q.y + dt * dhu); q.z = 0.5 * (q0.z + q.z + dt * dhv);
    q = kadd(q, 0.5 * ((q0.x - q0.w) - (q.x - q.w) + dt * dh));
  }
  var a = A[c];
  if (q.x < 0.0) { a.w += -(q.x - q.w); q.x = 0.0; q.w = 0.0; }
  if (q.x <= P.hdry) { q.y = 0.0; q.z = 0.0; }
  U[c] = q; A[c] = a; // boundary outflow is booked per edge face by edgeOut (compensated)
}

// ---- semi-implicit friction, rainfall, infiltration, max depth
@compute @workgroup_size(8, 8)
fn sources(@builtin(global_invocation_id) gid: vec3u) { sourcesAt(gid.x, gid.y); }
@compute @workgroup_size(8, 8)
fn sourcesT(@builtin(workgroup_id) wid: vec3u, @builtin(local_invocation_id) lid: vec3u) { let c = tileCell(wid, lid); sourcesAt(c.x, c.y); }
fn sourcesAt(x: u32, y: u32) {
  if (x >= P.nx || y >= P.ny) { return; }
  let NX = i32(P.NX);
  let c = (i32(y) + GH) * NX + i32(x) + GH;
  let s = S[c];
  if (s.z < 0.5) { return; }
  let dt = DT[0];
  if (dt <= 0.0) { return; }
  var q = U[c]; var a = A[c];
  let d = q.x;
  if (d > P.hdry && s.y > 0.0) {
    let u = q.y / d; let v = q.z / d;
    let k = 1.0 + dt * P.g * s.y * s.y * sqrt(u * u + v * v) / pow(d, 4.0 / 3.0);
    q.y = q.y / k; q.z = q.z / k;
  }
  let r = P.rain * RF[c] * dt;
  // infiltration capacity: constant (s.w), or Green-Ampt K·(1 + ψΔθ/F) with s.w = K on the cell basis, none once the
  // soil is full to the water table
  var st = GS[c]; let ga = GAP[c];
  var cap = s.w * dt;
  if (ga.w > 0.5) { cap = select(min(cap * (1.0 + ga.x / max(st.z, 1e-3)), (ga.y - st.z) * ga.z), 0.0, st.z >= ga.y); }
  var inf = min(cap, d + r);
  let soil = inf;
  let gi = GI[c];
  if (gi.y > 0.0) {
    // the store drains linearly since its last update (tiles may skip dry cells, so the elapsed time is exact either way)
    let now = DT[1];
    // the store drains linearly to the native soil (gi.z) and through an underdrain (gi.w), which books its share
    let gone = min(st.x, (gi.z + gi.w) * (now - st.y));
    if (gi.w > 0.0 && gone > 0.0) { st.w += gone * gi.w / (gi.z + gi.w); }
    st.x = st.x - gone; st.y = now;
    let g2 = min(min(gi.x * dt, d + r - inf), gi.y - st.x);
    if (g2 > 0.0) { inf += g2; st.x += g2; }
  }
  // two infiltration paths can round past the water available (fp32): never leave a negative depth, and book
  // exactly what left the cell
  let hn = kadd(q, r - inf);
  if (hn.x < 0.0) { inf = d - q.w + r; q.x = 0.0; q.w = 0.0; } else { q = hn; }
  if (ga.w > 0.5) { st.z += min(soil, inf) / max(ga.z, 1e-6); }
  if (gi.y > 0.0 || ga.w > 0.5) { GS[c] = st; }
  a.y += inf;
  if (q.x <= P.hdry) { q.y = 0.0; q.z = 0.0; }
  if (TRACKMAX) { a.x = max(a.x, q.x); } // the subgrid mode tracks the peak water level instead (sgHazard)
  U[c] = q; A[c] = a;
}

// ---- 1D-2D exchange at drainage inlets (sparse, one thread per inlet; inlets never share a cell)
@compute @workgroup_size(64)
fn exchange(@builtin(global_invocation_id) gid: vec3u) {
  let m = gid.x;
  if (m >= P.nInlets) { return; }
  let c = i32(INC[m]);
  var q = U[c];
  let dt = DT[0];
  var x = INX[m];
  if (dt > 0.0) {
    let A = P.dx * P.dx;
    let dd = min(INQ[m] * dt / A, max(q.x, 0.0)); // never take more water than the cell holds
    q = kadd(q, -dd);
    if (q.x <= 0.0) { q.x = 0.0; q.w = 0.0; }
    if (q.x <= P.hdry) { q.y = 0.0; q.z = 0.0; }
    U[c] = q;
    let y = dd * A - x.z; let tx = x.x + y; x.z = (tx - x.x) - y; x.x = tx; // compensated: books match the water to round-off
  }
  x.y = q.x;
  INX[m] = x;
}

// ---- active tiles. Faces (and theta) run on wet tiles grown by 2, the update on wet tiles grown by 1: water moves
// < 1 cell per RK stage, an updated cell reads faces in its own and the next tile, and those faces read cells 2 away
// (prim runs everywhere; sources run on the update list, which holds every cell that can be wet after the step).
// "Wet" is any h > 0 (thin films still carry HLLC flux), static tiles hold inlets and stage edges, and everything is
// active while it rains, so results equal the untiled solver bit for bit.
@compute @workgroup_size(64)
fn tileClear(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x < P.tiles) { atomicStore(&TF[gid.x], 0u); }
  if (gid.x < 2u) { atomicStore(&TC[gid.x], 0u); }
}
@compute @workgroup_size(8, 8)
fn tileWet(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= P.nx || gid.y >= P.ny) { return; }
  let c = (i32(gid.y) + GH) * i32(P.NX) + i32(gid.x) + GH;
  if (U[c].x > 0.0 || P.rain > 0.0) { atomicMax(&TF[(gid.y / TILE) * P.tilesX + gid.x / TILE], 1u); }
}
@compute @workgroup_size(64)
fn tileList(@builtin(global_invocation_id) gid: vec3u) {
  let t = gid.x; if (t >= P.tiles) { return; }
  let tx = i32(t % P.tilesX); let ty = i32(t / P.tilesX);
  var d1 = TS[t] > 0u; var d2 = d1;
  for (var dy = -2; dy <= 2; dy++) { for (var dx = -2; dx <= 2; dx++) {
    let x = tx + dx; let y = ty + dy;
    if (x < 0 || y < 0 || x >= i32(P.tilesX) || y >= i32(P.tilesY)) { continue; }
    let n = u32(y) * P.tilesX + u32(x);
    if (atomicLoad(&TF[n]) > 0u || TS[n] > 0u) { d2 = true; if (abs(dx) <= 1 && abs(dy) <= 1) { d1 = true; } }
  } }
  if (d1) { TL[atomicAdd(&TC[0], 1u)] = t; }
  if (d2) { TL[P.tiles + atomicAdd(&TC[1], 1u)] = t; }
}
@compute @workgroup_size(1)
fn tileArgs() {
  TA[0] = atomicLoad(&TC[0]); TA[1] = 1u; TA[2] = 1u;
  TA[3] = atomicLoad(&TC[1]); TA[4] = 1u; TA[5] = 1u;
}

// ---- CFL time step: workgroup max, then global atomic max on float bits (positive floats sort as u32)
var<workgroup> wmax: atomic<u32>;
@compute @workgroup_size(8, 8)
fn dtReduce(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_index) li: u32) {
  if (li == 0u) { atomicStore(&wmax, 0u); }
  workgroupBarrier();
  if (gid.x < P.nx && gid.y < P.ny) {
    let c = (i32(gid.y) + GH) * i32(P.NX) + i32(gid.x) + GH;
    let q = U[c];
    if (S[c].z > 0.5 && q.x > P.hdry) {
      let sp = abs(q.y / q.x) + abs(q.z / q.x) + 2.0 * sqrt(P.g * q.x); // lambda_x + lambda_y
      atomicMax(&wmax, bitcast<u32>(sp));
    }
  }
  workgroupBarrier();
  if (li == 0u) { atomicMax(&RED, atomicLoad(&wmax)); }
}

@compute @workgroup_size(1)
fn dtFinal() {
  let smax = bitcast<f32>(atomicLoad(&RED));
  atomicStore(&RED, 0u);
  let t = DT[1];
  let rem = P.tEnd - t;
  var dt = 0.0;
  if (rem > 0.0) {
    let cand = select(P.dtDry, P.cfl * P.dx / smax, smax > 0.0);
    if (cand >= rem) { dt = rem; DT[1] = P.tEnd; DT[2] = 0.0; }
    else {
      dt = cand;
      let y = dt - DT[2]; let tn = t + y; DT[2] = (tn - t) - y; DT[1] = tn;
    }
    DT[3] = DT[3] + 1.0;
  }
  DT[0] = dt;
}

// ---- subgrid speed mode (src/subgrid.js): F-metre cells with 1 m storage and conveyance tables, local inertial.
// The state U.x is stored volume per cell area (so rain, infiltration, inlets and the books work unchanged); W holds the
// depth at the cell's lowest open pixel and the water level looked up from the cell table. Faces carry the unit
// discharge q (FX/FY[0]) and its flow depth H (FX/FY[1]), and q persists from step to step (it is the momentum).
const SG_NL: u32 = 16u; const SG_CT: u32 = 19u; const SG_FT: u32 = 35u;
@group(0) @binding(28) var<storage, read> SGC: array<f32>; // per padded cell: lowest ground, level step, open fraction, v_0…v_15 (−zref)
@group(0) @binding(29) var<storage, read> SGF: array<f32>; // per x-face (at the right cell), then per y-face (at the upper cell):
                                                           // lowest strip top, step, open fraction, H_0…, K^0.6_0…

fn sgLevel(c: i32, v: f32) -> f32 {
  let o = u32(c) * SG_CT; let lo = SGC[o]; let dz = SGC[o + 1u];
  if (lo > 1e29) { return -1e30; }
  if (v <= 0.0) { return lo; }
  let vt = SGC[o + 2u + SG_NL];
  if (v >= vt) { return lo + f32(SG_NL - 1u) * dz + (v - vt) / max(SGC[o + 2u], 1e-6); }
  var a = 0u; var b = SG_NL - 1u;
  loop { if (b - a <= 1u) { break; } let m = (a + b) / 2u; if (SGC[o + 3u + m] <= v) { a = m; } else { b = m; } }
  let va = SGC[o + 3u + a]; let vb = SGC[o + 3u + b];
  var t = 0.0; if (vb > va) { t = (v - va) / (vb - va); }
  return lo + dz * (f32(a) + t);
}
fn sgFt(isY: bool, i: u32) -> f32 { return SGF[select(i, i + P.NX * P.NY * SG_FT, isY)]; }
/** Flow depth H and conveyance K per unit width of face b at level zeta. */
fn sgFace(isY: bool, b: i32, zeta: f32) -> vec2f {
  let o = u32(b) * SG_FT; let lo = sgFt(isY, o); let dz = sgFt(isY, o + 1u);
  if (lo > 1e29 || zeta <= lo) { return vec2f(0.0); }
  let x = (zeta - lo) / dz; let l = u32(floor(x));
  var H = 0.0; var Kp = 0.0;
  if (l >= SG_NL - 1u) {
    let Ht = sgFt(isY, o + 2u + SG_NL); let Kt = sgFt(isY, o + 2u + 2u * SG_NL);
    H = Ht + sgFt(isY, o + 2u) * (zeta - lo - f32(SG_NL - 1u) * dz);
    if (Ht > 0.0) { Kp = Kt * H / Ht; }
  } else {
    let t = x - f32(l);
    H = sgFt(isY, o + 3u + l) + t * (sgFt(isY, o + 4u + l) - sgFt(isY, o + 3u + l));
    Kp = sgFt(isY, o + 3u + SG_NL + l) + t * (sgFt(isY, o + 4u + SG_NL + l) - sgFt(isY, o + 3u + SG_NL + l));
  }
  var K = 0.0; if (Kp > 0.0) { K = pow(Kp, 5.0 / 3.0); }
  return vec2f(H, K);
}

// levels for every cell, ghosts copy the edge cell; wall cells get level −1e30. A ghost that sees the observed water
// level (tide / surge) holds that level instead, flagged in W.z, and its edge face then runs the momentum equation
@compute @workgroup_size(8, 8)
fn sgPrim(@builtin(global_invocation_id) gid: vec3u) {
  let NX = i32(P.NX); let NY = i32(P.NY); let i = i32(gid.x); let j = i32(gid.y);
  if (i >= NX || j >= NY) { return; }
  let e = clamp(j, GH, NY - GH - 1) * NX + clamp(i, GH, NX - GH - 1); let c = j * NX + i;
  let lo = SGC[u32(e) * SG_CT];
  if (STG[c] > 0.5 && lo < 1e29 && P.stage - lo > P.hdry) { W[c] = vec4f(P.stage - lo, P.stage, 1.0, 0.0); return; }
  let eta = sgLevel(e, U[e].x);
  W[c] = vec4f(max(0.0, eta - lo), eta, 0.0, 0.0);
}

// local-inertial momentum on each face: q ← (q − g·H·Δt·Δη/Δx) / (1 + g·Δt·|q|·H/K²), H and K from the face table at
// the higher of the two levels, |q| ≤ critical, no flow out of a dry cell; a barrier crest above the face's lowest strip
// makes it a weir (as weir()); edge faces are walls or free outfalls (Manning on the surface slope, ≤ critical)
fn sgFluxAt(x: u32, y: u32, isY: bool) {
  if (isY) { if (x >= P.nx || y > P.ny) { return; } } else { if (x > P.nx || y >= P.ny) { return; } }
  let NX = i32(P.NX); let s = select(1, NX, isY);
  let b = (i32(y) + GH) * NX + i32(x) + GH; let a = b - s;
  let lo = select(x == 0u, y == 0u, isY); let hi = select(x == P.nx, y == P.ny, isY);
  let wa = W[a]; let wb = W[b]; let dt = DT[0];
  var q = 0.0; var H = 0.0;
  let stg = (lo && wa.z > 0.5) || (hi && wb.z > 0.5); // the ghost holds the observed water level
  if ((lo || hi) && !stg) {
    let bc = select(select(P.bcW, P.bcE, hi), select(P.bcS, P.bcN, hi), isY);
    let e = select(b, a, hi); let n = select(e + s, e - s, hi);
    let we = W[e]; let wn = W[n];
    if (bc == 2u && we.x > P.hdry && we.y > -1e29 && wn.x > P.hdry) {
      let sl = (wn.y - we.y) / P.dx - OUT_SLOPE;
      let hk = sgFace(isY, b, we.y); H = hk.x;
      if (sl > 0.0 && H > P.hdry) { q = min(H * sqrt(P.g * H), hk.y * sqrt(sl)); if (lo) { q = -q; } }
    }
  } else if (wa.y > -1e29 && wb.y > -1e29 && (wa.x > P.hdry || wb.x > P.hdry)) {
    let cr = CR[b]; let crest = select(cr.x, cr.z, isY); let cw = select(cr.y, cr.w, isY);
    if (crest > -1e29 && crest > sgFt(isY, u32(b) * SG_FT)) {
      let left = wa.y >= wb.y; let up = select(wb, wa, left); let dn = select(wa, wb, left);
      let H1 = up.y - crest;
      if (H1 > P.hdry && up.x > P.hdry) {
        let r = max(0.0, dn.y - crest) / H1;
        if (r < 1.0) {
          q = cw * pow(H1, 1.5) * pow(1.0 - pow(r, 1.5), 0.385);
          if (dt > 0.0) { q = min(q, (up.y - dn.y) * P.dx / (4.0 * dt)); }
          if (!left) { q = -q; }
        }
        H = 2.0 / 3.0 * H1;
      }
    } else {
      let hk = sgFace(isY, b, max(wa.y, wb.y)); H = hk.x; let K = hk.y;
      if (H > P.hdry && K > 0.0) {
        var q0 = FX[b * 9]; if (isY) { q0 = FY[b * 9]; }
        q0 = q0 * TH[select(b, a, q0 > 0.0)];
        q = (q0 - P.g * H * dt * (wb.y - wa.y) / P.dx) / (1.0 + P.g * dt * abs(q0) * H / (K * K));
        let qm = H * sqrt(P.g * H); q = clamp(q, -qm, qm);
        if ((q > 0.0 && wa.x <= P.hdry) || (q < 0.0 && wb.x <= P.hdry)) { q = 0.0; }
      } else { H = 0.0; }
    }
  }
  if (isY) { FY[b * 9] = q; FY[b * 9 + 1] = H; } else { FX[b * 9] = q; FX[b * 9 + 1] = H; }
  if (H > P.hdry) { atomicMax(&RED, bitcast<u32>(sqrt(P.g * H) + abs(q) / H)); } // wave speed for the next step
}
@compute @workgroup_size(8, 8)
fn sgFluxX(@builtin(global_invocation_id) gid: vec3u) { sgFluxAt(gid.x, gid.y, false); }
@compute @workgroup_size(8, 8)
fn sgFluxY(@builtin(global_invocation_id) gid: vec3u) { sgFluxAt(gid.x, gid.y, true); }
@compute @workgroup_size(8, 8)
fn sgFluxXT(@builtin(workgroup_id) wid: vec3u, @builtin(local_invocation_id) lid: vec3u) { let c = tileCell(wid, lid); sgFluxAt(c.x, c.y, false); }
@compute @workgroup_size(8, 8)
fn sgFluxYT(@builtin(workgroup_id) wid: vec3u, @builtin(local_invocation_id) lid: vec3u) { let c = tileCell(wid, lid); sgFluxAt(c.x, c.y, true); }

// continuity: volume per area changes by the (draining-limited) face discharges
fn sgUpdateAt(x: u32, y: u32) {
  if (x >= P.nx || y >= P.ny) { return; }
  let NX = i32(P.NX); let NY = i32(P.NY); let i = i32(x) + GH; let j = i32(y) + GH; let c = j * NX + i;
  if (S[c].z < 0.5) { return; }
  let dt = DT[0];
  if (dt <= 0.0) { return; }
  let Fw = fx3(c * 9, c - 1, c).x; let Fe = fx3((c + 1) * 9, c, c + 1).x;
  let Fs = fy3(c * 9, c - NX, c).x; let Fn = fy3((c + NX) * 9, c, c + NX).x;
  var q = kadd(U[c], -dt / P.dx * (Fe - Fw + Fn - Fs));
  var a = A[c];
  if (q.x < 0.0) { a.w += -(q.x - q.w); q.x = 0.0; q.w = 0.0; }
  U[c] = q; A[c] = a;
}
@compute @workgroup_size(8, 8)
fn sgUpdate(@builtin(global_invocation_id) gid: vec3u) { sgUpdateAt(gid.x, gid.y); }
@compute @workgroup_size(8, 8)
fn sgUpdateT(@builtin(workgroup_id) wid: vec3u, @builtin(local_invocation_id) lid: vec3u) { let c = tileCell(wid, lid); sgUpdateAt(c.x, c.y); }

// cell speed from the face discharges: mean of the two faces' q/H in each direction
fn sgSpeed(c: i32) -> f32 {
  let NX = i32(P.NX); var u = 0.0; var v = 0.0;
  let Hw = FX[c * 9 + 1]; let He = FX[(c + 1) * 9 + 1]; let Hs = FY[c * 9 + 1]; let Hn = FY[(c + NX) * 9 + 1];
  if (Hw > 0.001) { u += 0.5 * FX[c * 9] / Hw; } if (He > 0.001) { u += 0.5 * FX[(c + 1) * 9] / He; }
  if (Hs > 0.001) { v += 0.5 * FY[c * 9] / Hs; } if (Hn > 0.001) { v += 0.5 * FY[(c + NX) * 9] / Hn; }
  return sqrt(u * u + v * v);
}
// peak water level (A.x, relative to zref) and the hazard products at the cell's deepest point (conservative)
fn sgHazardAt(x: u32, y: u32) {
  if (x >= P.nx || y >= P.ny) { return; }
  let c = (i32(y) + GH) * i32(P.NX) + i32(x) + GH;
  if (SGC[u32(c) * SG_CT] > 1e29) { return; } // a wall cell
  let dt = DT[0];
  if (dt <= 0.0) { return; }
  let eta = sgLevel(c, U[c].x); var a = A[c]; a.x = max(a.x, eta); A[c] = a;
  let d = eta - SGC[u32(c) * SG_CT];
  if (d < HZ_WET) { return; }
  var v = 0.0; if (d >= HZ_VCUT) { v = sgSpeed(c); }
  hzRecord(c, d, v, dt);
}
@compute @workgroup_size(8, 8)
fn sgHazard(@builtin(global_invocation_id) gid: vec3u) { sgHazardAt(gid.x, gid.y); }
@compute @workgroup_size(8, 8)
fn sgHazardT(@builtin(workgroup_id) wid: vec3u, @builtin(local_invocation_id) lid: vec3u) { let c = tileCell(wid, lid); sgHazardAt(c.x, c.y); }

// wave speed from each cell's mean depth over its open area (catches deep water before any face has seen it)
@compute @workgroup_size(8, 8)
fn sgDt(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= P.nx || gid.y >= P.ny) { return; }
  let c = (i32(gid.y) + GH) * i32(P.NX) + i32(gid.x) + GH;
  let o = u32(c) * SG_CT; let v = U[c].x;
  if (SGC[o] > 1e29 || v <= P.hdry) { return; }
  atomicMax(&RED, bitcast<u32>(sqrt(P.g * v / max(SGC[o + 2u], 0.05))));
}

// render: depth at the lowest point (the app adds the lowest ground to get the level) and speed
@compute @workgroup_size(8, 8)
fn sgPack(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= P.nx || gid.y >= P.ny) { return; }
  let c = (i32(gid.y) + GH) * i32(P.NX) + i32(gid.x) + GH;
  let o = u32(c) * SG_CT; var d = 0.0; var sp = 0.0;
  if (SGC[o] < 1e29) { d = max(0.0, sgLevel(c, U[c].x) - SGC[o]); if (d > P.hdry) { sp = sgSpeed(c); } }
  OUT[gid.y * P.nx + gid.x] = vec2f(d, sp);
}

// inlet exchange, reporting the depth at the cell's lowest point (where the inlet sits) for the network
@compute @workgroup_size(64)
fn sgExchange(@builtin(global_invocation_id) gid: vec3u) {
  let m = gid.x;
  if (m >= P.nInlets) { return; }
  let c = i32(INC[m]);
  var q = U[c]; let dt = DT[0]; var x = INX[m];
  if (dt > 0.0) {
    let A = P.dx * P.dx;
    let dd = min(INQ[m] * dt / A, max(q.x, 0.0));
    q = kadd(q, -dd);
    if (q.x <= 0.0) { q.x = 0.0; q.w = 0.0; }
    U[c] = q;
    let y = dd * A - x.z; let tx = x.x + y; x.z = (tx - x.x) - y; x.x = tx;
  }
  x.y = max(0.0, sgLevel(c, q.x) - SGC[u32(c) * SG_CT]);
  INX[m] = x;
}

// ---- boundary outflow, per edge face, after theta and before the update (as the barrier books): the flux the update
// applies across the domain edge, summed with a Kahan residual. A plain fp32 total per edge cell lost ~1e-5 of the
// volume when a river carried hundreds of m³/s out through a few cells between reads. One thread per edge face: the
// west and east columns, then the south and north rows (corners count once per side). Faces of tiles the step skipped
// can hold stale fluxes, but then neither the edge cell nor its ghost holds water, so those are skipped.
@group(0) @binding(30) var<storage, read_write> EO: array<vec2f>; // per edge face: outflow (m³, − = inflow), Kahan residual
@compute @workgroup_size(64)
fn edgeOut(@builtin(global_invocation_id) gid: vec3u) {
  let m = gid.x; let nx = P.nx; let ny = P.ny;
  if (m >= 2u * (nx + ny)) { return; }
  let dt = DT[0];
  if (dt <= 0.0) { return; }
  let NX = i32(P.NX);
  var c = 0; var g = 0; var f = 0.0; var sgn = 1.0;
  if (m < 2u * ny) {
    let j = i32(m % ny) + GH; let east = m >= ny;
    if (east) { c = j * NX + i32(nx) - 1 + GH; g = c + 1; f = FX[g * 9]; } else { c = j * NX + GH; g = c - 1; f = FX[c * 9]; sgn = -1.0; }
  } else {
    let k = m - 2u * ny; let i = i32(k % nx) + GH; let north = k >= nx;
    if (north) { c = (i32(ny) - 1 + GH) * NX + i; g = c + NX; f = FY[g * 9]; } else { c = GH * NX + i; g = c - NX; f = FY[c * 9]; sgn = -1.0; }
  }
  if (W[c].x <= 0.0 && W[g].x <= 0.0) { return; }
  f = f * TH[select(c, g, (f > 0.0) == (sgn < 0.0))]; // the donor: the edge cell for outflow, the ghost for inflow
  let v = sgn * f * P.dx * dt * select(1.0, 0.5, P.secondOrder == 1u);
  var e = EO[m]; let y = v - e.y; let t = e.x + y; e.y = (t - e.x) - y; e.x = t; EO[m] = e;
}

// ---- underdrains of drawn bioretention (src/stormwater.js UnderdrainLinks): the depth each listed cell's GI store has
// let out through its underdrain so far, gathered for the host
@group(0) @binding(41) var<storage, read> UDC: array<u32>;         // padded cells
@group(0) @binding(42) var<storage, read_write> UDX: array<f32>;   // underdrained depth (m)
@compute @workgroup_size(64)
fn udGather(@builtin(global_invocation_id) gid: vec3u) {
  let m = gid.x;
  if (m >= arrayLength(&UDC)) { return; }
  UDX[m] = GS[UDC[m]].w;
}

// ---- control lines (src/compare.js lineFaces): the volume across each listed face, booked every stage exactly as
// edgeOut books the domain edge, so a line around the domain matches the edge outflow and a line across a channel the
// water that passed it. + = from cell i−1 (j−1) into cell i (j); the host signs each face to its line.
@group(0) @binding(39) var<storage, read> LF: array<u32>;          // per control face: padded cell · 2 + axis (1 = y-face)
@group(0) @binding(40) var<storage, read_write> CL: array<vec4f>;  // per control face: volume in +, Kahan residual, volume in −, residual (m³)
@compute @workgroup_size(64)
fn lineFlux(@builtin(global_invocation_id) gid: vec3u) {
  let m = gid.x;
  if (m >= P.nLine) { return; }
  let dt = DT[0];
  if (dt <= 0.0) { return; }
  let code = LF[m]; let c = i32(code / 2u);
  var g = c - 1; var f = FX[c * 9];
  if (code % 2u == 1u) { g = c - i32(P.NX); f = FY[c * 9]; }
  if (W[c].x <= 0.0 && W[g].x <= 0.0) { return; } // a face of a skipped (dry) tile can hold a stale flux
  f = f * TH[select(c, g, f > 0.0)]; // the donor's draining-time scale, as the update applies it
  let v = f * P.dx * dt * select(1.0, 0.5, P.secondOrder == 1u);
  var e = CL[m];
  if (v > 0.0) { let y = v - e.y; let t = e.x + y; e.y = (t - e.x) - y; e.x = t; }
  else if (v < 0.0) { let y = -v - e.w; let t = e.z + y; e.w = (t - e.z) - y; e.z = t; }
  CL[m] = e;
}

// ---- sediment transport (src/sediment.js) in four grain classes: clay (as flocs), silt, sand and gravel, each carried
// with the water and settling at its own velocity; sand and gravel also move as bedload; the bed keeps a store of each
// class, so a scoured bed loses its fines and coarsens. The bed (S.x) moves with the difference (Exner), so the flow sees
// the scour and the deposits. State per cell, 4 vec4 (ping-pong SDI → SDO, the host swaps them):
//   [4c]   suspended solids per class (m of solids per area)
//   [4c+1] change of the bed store per class (m of bed, pores included) since the start: the store, SE0[2c] + this, is
//          what the flow can take (kept as the change so solids balance to rounding of small numbers)
//   [4c+2] solids carried out across the domain edge in suspension, per class (m per cell area)
//   [4c+3] pore water the bed gave the flow, net (m; debris mode), time of a slope failure (s, −1 = none), sand and
//          gravel carried out across the domain edge as bedload (m per cell area)
// Debris-flow mode (DEBRIS): the flow is a water–sediment mixture (U.x is the mixture depth: entrained bed brings its
// pore water, deposits take theirs), it erodes and deposits toward the equilibrium of Egashira et al. (1997), resists
// with the quadratic rheology of O'Brien & Julien (1988), and saturated steep soil fails (infinite slope) into it.
const SED_POR: f32 = 0.4; // bed porosity
const SED_LA: f32 = 0.01; // thinnest active (surface) layer, m: armouring works in a layer about two coarse grains thick
const SED_CMAX: f32 = 0.1; // suspended solids by volume at most (≈ 265 g/L: hyperconcentrated flow)
const DEB_CMAX: f32 = 0.5; // in the debris-flow mode
const SED_BEDCAP: f32 = 0.5; // bedload (bulk bed volume) at most this share of the water flux across the face
const DEB_SLOPE: f32 = 0.1763; // tan 10°: debris flows entrain the bed on slopes this steep
const DEB_C: f32 = 0.2; // solids by volume from which the flow is a debris flow (entrains and deposits as a mass)
override DEBRIS: bool = false;
fn sedCmax() -> f32 { return select(SED_CMAX, DEB_CMAX, DEBRIS); }
fn sedSizes(k: i32) -> vec4f { let sc = SCR[k]; return vec4f(2e-6, 3e-5, sc.z, sc.w); }
fn sedWs(d: f32) -> f32 { return max(1e-4, 1.65 * P.g * d * d / (18.0e-6 + sqrt(0.75 * 1.65 * P.g * d * d * d))); }
fn vsum(v: vec4f) -> f32 { return v.x + v.y + v.z + v.w; }
fn sedConc(k: i32) -> vec4f { let h = U[k].x - U[k].w; return select(vec4f(0.0), SDI[5 * k] / h, h > P.hdry); }
// the active layer's thickness: two of the coarsest grains present (gravel when it is more than 5 % of the store), at least SED_LA
fn sedLa(e: vec4f, sz: vec4f) -> f32 { return max(SED_LA, 2.0 * select(sz.z, sz.w, e.w > 0.05 * vsum(e))); }
// advection, once per RK stage with that stage's (theta-limited) water fluxes and weight, before the update (U is the
// stage-start state): solids move with the water at the upstream cell's concentration; ghost cells bring clean water
fn sedFace(f0: f32, l: i32, r: i32) -> vec4f { let F = f0 * TH[select(r, l, f0 > 0.0)]; return F * select(sedConc(r), sedConc(l), F > 0.0); }
@compute @workgroup_size(8, 8)
fn sedAdvect(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= P.nx || gid.y >= P.ny) { return; }
  let NX = i32(P.NX); let i = i32(gid.x) + GH; let j = i32(gid.y) + GH; let c = j * NX + i;
  var s = SDI[5 * c]; var o = SDI[5 * c + 2]; let dt = DT[0];
  if (dt > 0.0) {
    let w = dt / P.dx * select(1.0, 0.5, P.secondOrder == 1u);
    let fw = sedFace(FX[c * 9], c - 1, c); let fe = sedFace(FX[(c + 1) * 9], c, c + 1);
    let fs = sedFace(FY[c * 9], c - NX, c); let fq = sedFace(FY[(c + NX) * 9], c, c + NX);
    s = max(vec4f(0.0), s - w * (fe - fw + fq - fs));
    var out = vec4f(0.0); // solids across the domain edge, + = out
    if (i == GH) { out -= fw; } if (i == NX - GH - 1) { out += fe; } if (j == GH) { out -= fs; } if (j == i32(P.NY) - GH - 1) { out += fq; }
    o += w * out;
  }
  SDO[5 * c] = s; SDO[5 * c + 1] = SDI[5 * c + 1]; SDO[5 * c + 2] = o; SDO[5 * c + 3] = SDI[5 * c + 3]; SDO[5 * c + 4] = SDI[5 * c + 4];
}
// shear on the soil in a cell (Pa), with the skin roughness
fn sedTau(k: i32) -> f32 {
  let q = U[k]; let h = q.x - q.w; if (h < HZ_VCUT) { return 0.0; }
  let n = SDP[k].y; return 1000.0 * P.g * n * n * (q.y * q.y + q.z * q.z) / (q.x * q.x) / pow(h, 1.0 / 3.0);
}
// bedload of sand and gravel across a face (bulk bed volume per unit width, m²/s, + toward r): Wilcock & Crowe (2003)
// for the bed's sand and gravel, W*ᵢ = 0.002φ^7.5 (φ < 1.35) or 14(1 − 0.894/√φ)^4.5 with φ = τ/τᵣᵢ,
// τᵣᵢ = τᵣₘ(Dᵢ/Dₛₘ)^b, b = 0.67/(1 + e^(1.5 − Dᵢ/Dₛₘ)), τ*ᵣₘ = 0.021 + 0.015e^(−20Fₛ), qᵢ = W*ᵢFᵢu*³/((s − 1)g), the
// fractions Fᵢ of the whole bed (fines bind the rest), from the upstream cell (by the face's water flux), the share of
// its flow crossing this face, no more than a quarter of its store per step, and no more than half the water crossing
fn bedFace(f0: f32, l: i32, r: i32, isY: bool, dt: f32) -> vec2f {
  if (f0 == 0.0) { return vec2f(0.0); }
  let d = select(r, l, f0 > 0.0); let e = SE0[2 * d] + SDI[5 * d + 1]; let a = SDI[5 * d + 4]; let tot = vsum(e);
  if (tot <= 0.0 || e.z + e.w <= 0.0 || a.z + a.w <= 0.0) { return vec2f(0.0); } // the bed's surface sets what moves
  let tau = sedTau(d); let q = U[d]; let sp = sqrt(q.y * q.y + q.z * q.z); if (tau <= 0.0 || sp <= 0.0) { return vec2f(0.0); }
  let sz = sedSizes(d); let Fs = a.z / vsum(a); let Fg = a.w / vsum(a);
  let Dsm = exp((Fs * log(sz.z) + Fg * log(sz.w)) / (Fs + Fg));
  let trm = (0.021 + 0.015 * exp(-20.0 * Fs)) * 1650.0 * P.g * Dsm; let us3 = pow(tau / 1000.0, 1.5);
  var qb = vec2f(0.0);
  for (var m = 0; m < 2; m++) {
    let Di = select(sz.z, sz.w, m == 1); let Fi = select(Fs, Fg, m == 1);
    let b = 0.67 / (1.0 + exp(1.5 - Di / Dsm)); let phi = tau / (trm * pow(Di / Dsm, b));
    let W = select(14.0 * pow(max(0.0, 1.0 - 0.894 * inverseSqrt(phi)), 4.5), 0.002 * pow(phi, 7.5), phi < 1.35);
    qb[m] = W * Fi * us3 / (1.65 * P.g) / (1.0 - SED_POR);
  }
  qb = min(qb * abs(select(q.y, q.z, isY)) / sp, vec2f(e.z, e.w) * P.dx / (4.0 * dt));
  let cap = SED_BEDCAP * abs(f0); if (qb.x + qb.y > cap) { qb *= cap / (qb.x + qb.y); }
  return select(-qb, qb, f0 > 0.0);
}
// bed slope along the flow (tan θ, + = downhill), central differences over open neighbours
fn flowSlope(c: i32, u: vec2f) -> f32 {
  let NX = i32(P.NX); let sp = length(u); if (sp <= 0.0) { return 0.0; }
  let zx = select(0.0, (S[c + 1].x - S[c - 1].x) / (2.0 * P.dx), S[c + 1].z > 0.5 && S[c - 1].z > 0.5);
  let zy = select(0.0, (S[c + NX].x - S[c - NX].x) / (2.0 * P.dx), S[c + NX].z > 0.5 && S[c - NX].z > 0.5);
  return -(zx * u.x + zy * u.y) / sp;
}
// the bed of a cell is its initial bed plus its change (b, m); the ghost cells beyond an edge cell carry the change too
// (else the edge would see a step and leak through a wall)
fn bedSet(k: i32, b: f32) { S[k].x = SE0[2 * k + 1].x + b; }
fn bedShift(c: i32, i: i32, j: i32, b: f32) {
  bedSet(c, b);
  let NX = i32(P.NX);
  if (i == GH) { bedSet(c - 1, b); bedSet(c - 2, b); }
  if (i == NX - GH - 1) { bedSet(c + 1, b); bedSet(c + 2, b); }
  if (j == GH) { bedSet(c - NX, b); bedSet(c - 2 * NX, b); }
  if (j == i32(P.NY) - GH - 1) { bedSet(c + NX, b); bedSet(c + 2 * NX, b); }
}
// erosion, settling and bedload at the end of the step, and the bed update. Settling: the exact decay of a well-mixed
// column over dt per class (all of it when the cell runs dry), hindered in a dense mixture (Richardson–Zaki, (1 − C)⁴)
// and none for grains the mixture's yield stress holds up (τy > 0.1·(ρs − ρm)g·d). Erosion into suspension: k_d·(τ − τc)
// on the bed's classes in proportion while any is left, except a class the flow cannot hold (u* < w_s): it stays behind
// (loose deposits, also on pavement, resist 1 Pa). Bedload: the face fluxes above, upwind by the water flux.
@compute @workgroup_size(8, 8)
fn sedSource(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= P.nx || gid.y >= P.ny) { return; }
  let NX = i32(P.NX); let i = i32(gid.x) + GH; let j = i32(gid.y) + GH; let c = j * NX + i;
  var s = SDI[5 * c]; let de = SDI[5 * c + 1]; var o = SDI[5 * c + 2]; var x = SDI[5 * c + 3]; var al = SDI[5 * c + 4]; let dt = DT[0];
  if (dt <= 0.0 || S[c].z < 0.5) { SDO[5 * c] = s; SDO[5 * c + 1] = de; SDO[5 * c + 2] = o; SDO[5 * c + 3] = x; SDO[5 * c + 4] = al; return; }
  let e = SE0[2 * c] + de;
  let bw = bedFace(FX[c * 9], c - 1, c, false, dt); let be = bedFace(FX[(c + 1) * 9], c, c + 1, false, dt);
  let bs = bedFace(FY[c * 9], c - NX, c, true, dt); let bq = bedFace(FY[(c + NX) * 9], c, c + NX, true, dt);
  let k = dt / P.dx; let dzb = -k * (be - bw + bq - bs);
  let bo = k * (max(be, vec2f(0.0)) + max(-bw, vec2f(0.0)) + max(bq, vec2f(0.0)) + max(-bs, vec2f(0.0))); // what leaves this cell's store
  var bout = vec2f(0.0);
  if (i == GH) { bout -= bw; } if (i == NX - GH - 1) { bout += be; } if (j == GH) { bout -= bs; } if (j == i32(P.NY) - GH - 1) { bout += bq; }
  x = vec4f(x.xy, x.zw + k * bout * (1.0 - SED_POR)); // sand and gravel leaving the domain as bedload (not in the water)
  var q = U[c]; let h = q.x - q.w; let sz = sedSizes(c); let C = select(0.0, min(0.6, vsum(s) / h), h > P.hdry);
  var ws = vec4f(sedWs(sz.x), sedWs(sz.y), sedWs(sz.z), sedWs(sz.w));
  var tauY = 0.0;
  if (DEBRIS) { // O'Brien & Julien (1988), Glenwood sample 1: τy = 0.0345e^(20.1C) dyn/cm², η = 0.0283e^(23.0C) P
    tauY = 0.00345 * exp(20.1 * C); ws *= pow(1.0 - C, 4.0);
    let held = vec4f(tauY) > 0.1 * (2650.0 - 1000.0 * (1.0 + 1.65 * C)) * P.g * sz; ws = select(ws, vec4f(0.0), held);
  }
  var dep = s; if (h > P.hdry) { dep = s * (1.0 - exp(-ws * dt / h)); }
  // a mixture packed like the bed (infiltration drained its water) is a deposit: all of it settles, so the infiltration
  // never takes the solids' volume as water
  if (DEBRIS && vsum(s) >= (1.0 - SED_POR) * h) { dep = s; }
  var ero = vec4f(0.0); let tot = vsum(e); let avail = max(vec4f(0.0), e - vec4f(0.0, 0.0, bo));
  // armouring (Hirano active layer): the flow takes grains from the bed's surface layer, in its proportions; bedload out
  // leaves from it first. alF: the surface's fractions (the store's while the layer is empty)
  al = max(vec4f(0.0), al - vec4f(0.0, 0.0, bo)); let alT = vsum(al); let alF = select(e / max(tot, 1e-12), al / max(alT, 1e-12), alT > 0.0);
  let sp = SDP[c]; let tc = select(1.0, sp.x, sp.x < 1e8 && sp.x > 0.0);
  if (h >= HZ_VCUT && sp.y > 0.0 && tot > 0.0) {
    let tau = sedTau(c);
    if (tau > tc) { ero = 0.2e-6 * inverseSqrt(tc) * (tau - tc) * dt * alF * select(vec4f(0.0), vec4f(1.0), vec4f(sqrt(tau / 1000.0)) > ws); }
  }
  let u = select(vec2f(0.0), q.yz / q.x, h > P.hdry); let spd = length(u);
  if (DEBRIS && h >= 0.01 && spd > 0.0 && C >= DEB_C) {
    // a debris flow (≥ 20 % solids; thinner flows entrain by shear alone), Egashira et al. (1997): the bed erodes (+) or
    // the mixture deposits (−) at i = u·tan(θ − θe), toward the slope the mixture is in equilibrium with,
    // tan θe = (σ/ρ − 1)C·tan φ / ((σ/ρ − 1)C + 1); erosion only on steep ground, unsorted
    let tS = flowSlope(c, u); let G = 1.65 * C; let tE = G * sp.w / (G + 1.0);
    let ie = spd * tan(atan(tS) - atan(tE)) * dt;
    if (ie > 0.0 && tS >= DEB_SLOPE && tot > 0.0) { ero += ie * e / tot; } // a debris flow scours unsorted
    if (ie < 0.0) { dep = max(dep, min(s, -ie * (1.0 - SED_POR) * s / max(1e-12, vsum(s)))); }
  }
  ero = min(ero, avail);
  let room = max(0.0, sedCmax() * h - vsum(s - dep)); let er = vsum(ero) * (1.0 - SED_POR); // the water carries at most Cmax solids by volume
  if (er > room) { ero *= room / er; }
  let nde = de + max(-e, dep / (1.0 - SED_POR) - ero + vec4f(0.0, 0.0, dzb)); // the store never below zero
  s = s - dep + ero * (1.0 - SED_POR);
  // the surface layer: loses what eroded, gains deposits and bedload in; then back to its thickness La: a lowered bed
  // exposes the substrate (its mix), a raised one buries the surface's excess into the substrate
  let en = SE0[2 * c] + nde; let La = min(sedLa(en, sz), vsum(en));
  al = max(vec4f(0.0), al - ero) + dep / (1.0 - SED_POR) + vec4f(0.0, 0.0, max(vec2f(0.0), dzb + bo));
  al = min(al, en); let aT = vsum(al);
  if (aT < La) { let sub = max(vec4f(0.0), en - al); let sT = vsum(sub); if (sT > 0.0) { al += sub * min(1.0, (La - aT) / sT); } }
  else if (aT > La && aT > 0.0) { al *= La / aT; }
  if (DEBRIS) {
    // the mixture: entrained bed brings its pore water, deposits trap theirs; then the rheology's resistance, implicit
    // the pore water booked is what the mixture depth actually gained less the solids it gained (a nearly dry cell's
    // deposit cannot take more water than it holds)
    let dv = vsum(ero) - vsum(dep) / (1.0 - SED_POR); let qx = max(0.0, q.x + dv);
    x.x += (qx - q.x) - (vsum(ero) * (1.0 - SED_POR) - vsum(dep)); q.x = qx;
    let hm = q.x - q.w; let Cm = select(0.0, min(0.6, vsum(s) / hm), hm > P.hdry); let mag = length(q.yz);
    if (hm > P.hdry && mag > 0.0) {
      let rho = 1000.0 * (1.0 + 1.65 * Cm); let ty = 0.00345 * exp(20.1 * Cm); let eta = 0.00283 * exp(23.0 * Cm);
      let m1 = max(0.0, mag - dt * ty / rho) / (1.0 + dt * 24.0 * eta / (8.0 * rho * hm * hm)); // yield (stops a plug), then laminar (K = 24)
      q = vec4f(q.x, q.yz * (m1 / mag), q.w);
    }
    U[c] = q;
  }
  SDO[5 * c] = s; SDO[5 * c + 1] = nde; SDO[5 * c + 2] = o; SDO[5 * c + 3] = x; SDO[5 * c + 4] = al;
  bedShift(c, i, j, vsum(nde));
}
// shallow landslides (debris mode), once per step after sedSource: infinite-slope factor of safety on the cell's
// steepest slope, FS = (c′ + (γ·z·cos²θ − u)·tan φ′) / (γ·z·sin θ·cos θ), at the Green-Ampt wetting front z = F/θe (no
// suction credit) or at bedrock once the soil is saturated to it (then slope-parallel seepage, u = γw·z·cos²θ). On
// FS < 1 the soil above the failure plane (as far as the bed store goes) joins the flow with its pore water.
@compute @workgroup_size(8, 8)
fn slopeFail(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= P.nx || gid.y >= P.ny) { return; }
  let NX = i32(P.NX); let i = i32(gid.x) + GH; let j = i32(gid.y) + GH; let c = j * NX + i;
  var s = SDI[5 * c]; var de = SDI[5 * c + 1]; let o = SDI[5 * c + 2]; var x = SDI[5 * c + 3]; var al = SDI[5 * c + 4];
  let e = SE0[2 * c] + de; let tot = vsum(e); let soil = SE0[2 * c + 1]; var failed = false;
  if (DT[0] > 0.0 && S[c].z > 0.5 && x.y < 0.0 && tot > 0.0 && soil.z > 0.0) {
    let zx = max(abs(S[c + 1].x - S[c].x), abs(S[c].x - S[c - 1].x)) / P.dx; let zy = max(abs(S[c + NX].x - S[c].x), abs(S[c].x - S[c - NX].x)) / P.dx;
    let t = length(vec2f(zx, zy));
    if (t > 0.2679) { // steeper than 15°
      let cs = inverseSqrt(1.0 + t * t); let sn = t * cs; let wet = GS[c].z / soil.z; let sat = wet >= soil.y;
      let z = min(wet, soil.y); let sp = SDP[c];
      if (z >= 0.1) {
        let gam = select(18.0e3, 20.0e3, sat); let u = select(0.0, 9810.0 * z * cs * cs, sat);
        let fs = (sp.z + (gam * z * cs * cs - u) * sp.w) / (gam * z * sn * cs);
        if (fs < 1.0) {
          let d = min(z, tot); let take = e * (d / tot);
          de -= take; s += take * (1.0 - SED_POR); x.x += SED_POR * d; x.y = DT[1]; failed = true;
          var q = U[c]; q.x += d; U[c] = q;
          bedShift(c, i, j, vsum(de));
        }
      }
    }
  }
  // a failure strips the surface with the soil: what is left is mixed again
  let en = SE0[2 * c] + de; let eT = vsum(en); al = min(al, en); if (eT > 0.0 && (failed || vsum(al) <= 0.0)) { al = en * min(1.0, sedLa(en, sedSizes(c)) / eT); }
  SDO[5 * c] = s; SDO[5 * c + 1] = de; SDO[5 * c + 2] = o; SDO[5 * c + 3] = x; SDO[5 * c + 4] = al;
}

// ---- bank collapse probability (src/banks.js), every step: the Culmann wedge through the toe, searched over 8 plane
// angles, with the channel water confining the face and the bank's own water table lagging the river (rapid drawdown);
// the probability of failure given the bank stood at the start (c′, tan φ′ uncertain; Gauss–Hermite over tan φ′)
fn normCdf(x: f32) -> f32 {
  let z = abs(x) * 0.70710678; let t = 1.0 / (1.0 + 0.3275911 * z);
  let erf = 1.0 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * exp(-z * z);
  return select(0.5 * (1.0 - erf), 0.5 * (1.0 + erf), x >= 0.0);
}
// (Lp, N, D) on the plane at angle a: FS = (c·Lp + N·tan φ′)/D
fn bankPlane(H: f32, beta: f32, a: f32, hp: f32, hw: f32) -> vec3f {
  let sa = sin(a); let ca = cos(a);
  let W = 0.5 * H * H * (ca / sa - cos(beta) / sin(beta)) * (18.0e3 + 2.0e3 * (hp / H) * (hp / H));
  let Uw = 0.5 * 9810.0 * hp * hp / sa; let Pw = 0.5 * 9810.0 * hw * hw / sin(beta);
  return vec3f(H / sa, max(0.0, W * ca - Uw + Pw * cos(beta - a)), W * sa - Pw * sin(beta - a));
}
var<private> GHX: array<f32, 5> = array<f32, 5>(0.3429013272, 1.0366108298, 1.7566836493, 2.5327316742, 3.4361591188);
var<private> GHW: array<f32, 5> = array<f32, 5>(0.6108626337, 0.2401386111, 0.0338743945, 0.0013436457, 0.0000076404);
@compute @workgroup_size(64)
fn bankFS(@builtin(global_invocation_id) gid: vec3u) {
  let b = i32(gid.x); if (b >= i32(arrayLength(&BK)) / 2) { return; }
  let dt = DT[0]; if (dt <= 0.0) { return; }
  let k0 = BK[2 * b]; let k1 = BK[2 * b + 1];
  let top = i32(k0.x); let toe = i32(k0.y); let L = k0.z; let c = k0.w; let tp = k1.x;
  let zt = S[top].x; let zb = S[toe].x; let H = zt - zb;
  var r0 = BR[3 * b]; var r1 = BR[3 * b + 1]; var r2 = BR[3 * b + 2];
  let eta = zb + max(0.0, U[toe].x - U[toe].w);
  var goal = max(eta, k1.z); if (U[top].x - U[top].w > 0.01) { goal = zt; } // water standing on the bank soaks it
  let first = r0.x < -1e29;
  if (first) { r0.x = goal; } else { r0.x += (goal - r0.x) * (1.0 - exp(-dt / k1.y)); }
  if (H > 0.3) {
    let hp = clamp(r0.x - zb, 0.0, H); let hw = clamp(eta - zb, 0.0, H);
    if (first) { r2.x = hp; r2.y = hw; } // the start: the bank stands with these
    let beta = atan2(H, L); let sc = max(1.0, 0.4 * c); let st = 0.1 * tp;
    var fsB = 1e30; var pfB = 0.0; var standMin = 1.0;
    for (var m = 0; m < 8; m++) {
      let a = beta * (0.2 + 0.79 * f32(m) / 7.0);
      let p = bankPlane(H, beta, a, hp, hw);
      if (p.z > 0.0) {
        let fs = (c * p.x + p.y * tp) / p.z;
        let q = bankPlane(H, beta, a, clamp(r2.x, 0.0, H), clamp(r2.y, 0.0, H));
        var stand = 1.0;
        if (q.z > 0.0) { let sd0 = length(vec2f(0.4 * c * q.x, st * q.y)) / q.z; stand = select(1.0, normCdf(((c * q.x + q.y * tp) / q.z - 1.0) / sd0), sd0 > 0.0); }
        var joint = 0.0;
        for (var g = 0; g < 10; g++) {
          let gi = g % 5; let x = select(-GHX[gi], GHX[gi], g < 5); let t = tp + 1.41421356 * st * x;
          let p1 = normCdf(((p.z - p.y * t) / p.x - c) / sc);
          let p0 = select(0.0, normCdf(((q.z - q.y * t) / q.x - c) / sc), q.z > 0.0);
          joint += GHW[gi] * 0.56418958 * max(0.0, p1 - p0);
        }
        standMin = min(standMin, stand);
        let pf = select(0.0, min(1.0, joint / stand), stand > 0.02);
        if (pf > pfB || (pf == pfB && fs < fsB)) { pfB = pf; fsB = fs; }
      }
    }
    if (standMin <= 0.02) { pfB = -1.0; } // it would stand only on strength the survey lacks: not rated
    r1.x = fsB; r1.y = pfB; r1.z = max(r1.z, hw); r2.z = standMin;
    if (fsB < r0.y) { r0.y = fsB; r1.w = DT[1]; }
    if (pfB > r0.z || pfB < 0.0) { r0.z = pfB; r0.w = select(DT[1], -1.0, pfB < 0.0); }
  }
  BR[3 * b] = r0; BR[3 * b + 1] = r1; BR[3 * b + 2] = r2;
}

// ---- restart the per-cell running totals (infiltration, outflow, clipping) and keep max depth; encoded right after the
// copy that reads them, so steps queued in between cannot be lost
@compute @workgroup_size(8, 8)
fn resetTotals(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= P.NX || gid.y >= P.NY) { return; }
  let c = gid.y * P.NX + gid.x; let a = A[c];
  A[c] = vec4f(a.x, 0.0, 0.0, 0.0);
}

// ---- pack depth and speed for rendering (interior cells, row-major)
@compute @workgroup_size(8, 8)
fn pack(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= P.nx || gid.y >= P.ny) { return; }
  let c = (i32(gid.y) + GH) * i32(P.NX) + i32(gid.x) + GH;
  let q = U[c];
  var sp = 0.0;
  if (q.x > P.hdry) { sp = sqrt(q.y * q.y + q.z * q.z) / q.x; }
  OUT[gid.y * P.nx + gid.x] = vec2f(q.x, sp);
}
`;
