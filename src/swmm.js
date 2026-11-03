// EPA SWMM 5.2 engine (compiled to WebAssembly by tools/build-swmm.mjs) behind a small stepping API.
// Files live in the module's in-memory filesystem; units follow the .inp (FloodSim writes CMS / metres).

const OBJ = { GAGE: 0, SUBCATCH: 1, NODE: 2, LINK: 3 };
const P = { NODE_DEPTH: 303, NODE_HEAD: 304, NODE_VOLUME: 305, NODE_LATFLOW: 306, NODE_INFLOW: 307, NODE_OVERFLOW: 308, LINK_FLOW: 410, LINK_DEPTH: 411, LINK_VELOCITY: 412, LINK_FULLDEPTH: 405 };

export async function loadSWMM(url = new URL('../vendor/swmm-wasm/swmm.mjs', import.meta.url).href) {
  const { default: create } = await import(url);
  return new SWMM(await create({ print: () => {}, printErr: () => {} }));
}

export class SWMM {
  constructor(M) {
    this.M = M;
    const w = (n, r, a) => M.cwrap(n, r, a);
    this._open = w('swmm_open', 'number', ['string', 'string', 'string']);
    this._start = w('swmm_start', 'number', ['number']);
    this._stride = w('swmm_stride', 'number', ['number', 'number']);
    this._step = w('swmm_step', 'number', ['number']);
    this._end = w('swmm_end', 'number', []);
    this._report = w('swmm_report', 'number', []);
    this._close = w('swmm_close', 'number', []);
    this._getError = w('swmm_getError', 'number', ['number', 'number']);
    this._getCount = w('swmm_getCount', 'number', ['number']);
    this._getIndex = w('swmm_getIndex', 'number', ['number', 'string']);
    this._getValue = w('swmm_getValue', 'number', ['number', 'number']);
    this._setValue = w('swmm_setValue', null, ['number', 'number', 'number']);
    this._massBal = w('swmm_getMassBalErr', 'number', ['number', 'number', 'number']);
    this._version = w('swmm_getVersion', 'number', []);
    this.buf = M._malloc(1024);
  }
  get version() { return this._version(); }
  _check(code, what) {
    if (!code) return;
    this._getError(this.buf, 1000);
    const msg = this.M.UTF8ToString(this.buf).trim();
    let rpt = ''; try { rpt = this.M.FS.readFile('/m.rpt', { encoding: 'utf8' }).split('\n').filter(l => /ERROR|WARNING/.test(l)).slice(0, 5).join(' | '); } catch { /* none */ }
    throw new Error(`SWMM ${what} failed (${code}): ${msg} ${rpt}`.trim());
  }
  /** Load a model from .inp text and start the simulation. */
  open(inp) {
    this.M.FS.writeFile('/m.inp', inp);
    this._check(this._open('/m.inp', '/m.rpt', '/m.out'), 'open');
    this._check(this._start(0), 'start');
    this.t = 0;
  }
  /** Advance by `sec` seconds of routing; returns elapsed simulation time (s). */
  stride(sec) {
    const p = this.buf;
    this._check(this._stride(Math.round(sec), p), 'step');
    this.t = this.M.getValue(p, 'double') * 86400;
    return this.t;
  }
  /**
   * Advance to elapsed time `t` (s) one routing step at a time, calling onStep(dt) after each; returns elapsed time.
   * Lets callers integrate per-step quantities (node overflow) exactly as SWMM's own mass balance does.
   */
  stepTo(t, onStep) {
    const p = this.buf;
    while (this.t < t - 1e-6) {
      this._check(this._step(p), 'step');
      const now = this.M.getValue(p, 'double') * 86400;
      if (now <= this.t) break; // end of simulation
      onStep?.(now - this.t); this.t = now;
    }
    return this.t;
  }
  count(type = 'NODE') { return this._getCount(OBJ[type]); }
  index(type, name) { return this._getIndex(OBJ[type], name); }
  node(prop, i) { return this._getValue(P['NODE_' + prop], i); }
  link(prop, i) { return this._getValue(P['LINK_' + prop], i); }
  setLatFlow(i, q) { this._setValue(P.NODE_LATFLOW, i, q); }
  /** Fix an outfall's water level (m), e.g. the observed tide where it discharges to a tidal stream. */
  setOutfallStage(i, z) { this._setValue(P.NODE_HEAD, i, z); }
  /** Continuity errors (%) — SWMM only computes these when the run ends (0 before). */
  massBalance() {
    const p = this.buf; this._massBal(p, p + 4, p + 8);
    return { runoff: this.M.getValue(p, 'float'), flow: this.M.getValue(p + 4, 'float') };
  }
  /** End the run and return the SWMM report text (continuity tables, node flooding, link surcharge). */
  finish() {
    this._end(); this._report(); const rpt = this.M.FS.readFile('/m.rpt', { encoding: 'utf8' }); this._close();
    return rpt;
  }
  /** Flow-routing continuity table from a finished report: volumes (10^6 L) and error (%). */
  static continuity(rpt) {
    const block = (rpt.split('Flow Routing Continuity')[1] ?? '').split('Highest Continuity Errors')[0];
    const row = (label) => { const m = block.match(new RegExp(label + '[ .]+(-?[\\d.]+)\\s+(-?[\\d.]+)')); return m ? Number(m[2]) : null; };
    return { externalInflow: row('External Inflow'), dryWeatherInflow: row('Dry Weather Inflow'), externalOutflow: row('External Outflow'), flooding: row('Flooding Loss'),
      initialStored: row('Initial Stored Volume'), finalStored: row('Final Stored Volume'),
      errorPct: Number(block.match(/Continuity Error \(%\)[ .]+(-?[\d.]+)/)?.[1] ?? NaN) };
  }
  dispose() { try { this._close(); } catch { /* already closed */ } this.M._free(this.buf); }
}
