// Geodesy: WGS84 ↔ UTM (Transverse Mercator, Snyder 1987 series; sub-millimetre inside a zone).
// The model grid lives in true metres in the local UTM zone; the map overlay is placed by its lon/lat corners.
const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996;
const e2 = f * (2 - f), ep2 = e2 / (1 - e2);
const D = Math.PI / 180;

export const utmZone = (lon) => Math.floor((lon + 180) / 6) + 1;
/** EPSG code for WGS84 / UTM zone (north 326xx, south 327xx). */
export const utmEPSG = (zone, north = true) => (north ? 32600 : 32700) + zone;

function M(phi) {
  return a * ((1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 ** 3 / 256) * phi
    - (3 * e2 / 8 + 3 * e2 * e2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * phi)
    + (15 * e2 * e2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * phi)
    - (35 * e2 ** 3 / 3072) * Math.sin(6 * phi));
}

/** lon/lat (deg) → [easting, northing] in metres for the given zone. */
export function toUTM(lon, lat, zone) {
  const phi = lat * D, lam0 = ((zone - 1) * 6 - 180 + 3) * D;
  const N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2), T = Math.tan(phi) ** 2, C = ep2 * Math.cos(phi) ** 2;
  const A = Math.cos(phi) * (lon * D - lam0);
  const x = k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5 / 120) + 500000;
  let y = k0 * (M(phi) + N * Math.tan(phi) * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24
    + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6 / 720));
  if (lat < 0) y += 10000000;
  return [x, y];
}

/** [easting, northing] → [lon, lat] (deg). */
export function fromUTM(x, y, zone, north = true) {
  const lam0 = ((zone - 1) * 6 - 180 + 3) * D;
  const m = (north ? y : y - 10000000) / k0, mu = m / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 ** 3 / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const phi1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu) + (21 * e1 * e1 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
    + (151 * e1 ** 3 / 96) * Math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
  const s = Math.sin(phi1), c = Math.cos(phi1);
  const N1 = a / Math.sqrt(1 - e2 * s * s), T1 = Math.tan(phi1) ** 2, C1 = ep2 * c * c;
  const R1 = a * (1 - e2) / (1 - e2 * s * s) ** 1.5, Dd = (x - 500000) / (N1 * k0);
  const lat = phi1 - (N1 * Math.tan(phi1) / R1) * (Dd * Dd / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * Dd ** 4 / 24
    + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * Dd ** 6 / 720);
  const lon = lam0 + (Dd - (1 + 2 * T1 + C1) * Dd ** 3 / 6 + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * Dd ** 5 / 120) / c;
  return [lon / D, lat / D];
}

/**
 * Model grid georeference. Row 0 is the NORTH edge (image order); cell (col,row) centre is
 * (x0 + (col+.5)·dx, y1 − (row+.5)·dx). The solver is isotropic, so its j index simply follows rows.
 */
export class GridRef {
  constructor({ zone, x0, y0, x1, y1, dx }) {
    Object.assign(this, { zone, x0, y0, x1, y1, dx });
    this.nx = Math.round((x1 - x0) / dx); this.ny = Math.round((y1 - y0) / dx);
    this.epsg = utmEPSG(zone);
  }
  /** Same extent at another cell size (must divide the extent). */
  withDx(dx) { return new GridRef({ ...this, dx }); }
  cellOf(x, y) { return [Math.floor((x - this.x0) / this.dx), Math.floor((this.y1 - y) / this.dx)]; }
  lonlatToCell(lon, lat) { const [x, y] = toUTM(lon, lat, this.zone); return [(x - this.x0) / this.dx, (this.y1 - y) / this.dx]; }
  /** Corners for a MapLibre image/canvas source: TL, TR, BR, BL as [lon, lat]. */
  corners() {
    const { x0, y0, x1, y1, zone } = this;
    return [fromUTM(x0, y1, zone), fromUTM(x1, y1, zone), fromUTM(x1, y0, zone), fromUTM(x0, y0, zone)];
  }
  /** lon/lat bounding box [w, s, e, n] covering the grid (for Overpass / SDA queries). */
  lonlatBounds(pad = 0) {
    const c = this.corners(); const lo = c.map(p => p[0]), la = c.map(p => p[1]);
    return [Math.min(...lo) - pad, Math.min(...la) - pad, Math.max(...lo) + pad, Math.max(...la) + pad];
  }
  toJSON() { return { crs: `EPSG:${this.epsg}`, zone: this.zone, x0: this.x0, y0: this.y0, x1: this.x1, y1: this.y1, dx: this.dx, nx: this.nx, ny: this.ny, rowOrder: 'north-up' }; }
}

/** A UTM grid snapped to whole metres around a lon/lat rectangle. */
export function gridFromLonLatBox(w, s, e, n, dx) {
  const zone = utmZone((w + e) / 2);
  const pts = [[w, s], [e, s], [e, n], [w, n]].map(([lo, la]) => toUTM(lo, la, zone));
  const step = Math.max(8, dx * 8); // extent divisible by every supported coarsening (1,2,4,8 m)
  const x0 = Math.floor(Math.min(...pts.map(p => p[0])) / step) * step, x1 = Math.ceil(Math.max(...pts.map(p => p[0])) / step) * step;
  const y0 = Math.floor(Math.min(...pts.map(p => p[1])) / step) * step, y1 = Math.ceil(Math.max(...pts.map(p => p[1])) / step) * step;
  return new GridRef({ zone, x0, y0, x1, y1, dx });
}

/** Even–odd point-in-polygon test; ring as [[x, y], …] (open or closed). */
export function insideRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Cells of `grid` at cell size F (m) whose centres fall inside a lon/lat ring: 1 inside, 0 outside. */
export function polygonCells(grid, ring, F = grid.dx) {
  const nx = Math.round(grid.nx * grid.dx / F), ny = Math.round(grid.ny * grid.dx / F), m = new Uint8Array(nx * ny);
  const pts = ring.map(([lo, la]) => toUTM(lo, la, grid.zone));
  for (let j = 0; j < ny; j++) {
    const y = grid.y1 - (j + 0.5) * F;
    for (let i = 0; i < nx; i++) m[j * nx + i] = insideRing(grid.x0 + (i + 0.5) * F, y, pts) ? 1 : 0;
  }
  return m;
}
