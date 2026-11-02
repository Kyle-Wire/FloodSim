// NEXRAD radar overlay: the US composite base reflectivity from the Iowa Environmental Mesonet (IEM), as map tiles at
// 5-minute steps. Display only; it does not enter the solver.
//   N0Q: 8-bit (0.5 dBZ) composite, from 15 November 2010.  N0R: the older 4-bit (5 dBZ) composite, from 1995.
// IEM lists the frames it holds for a window (json/radar.py), so gaps in the archive show as gaps, not as stale tiles.

const IEM = 'https://mesonet.agron.iastate.edu';
export const N0Q_FROM = Date.UTC(2010, 10, 15);
export const FRAME_MIN = 5;
/** A frame further than this from the time asked for is not shown (an archive gap). */
export const MAX_GAP_MS = 15 * 60e3;

/** The composite product holding a time (ms UTC). */
export const productFor = (t) => (t >= N0Q_FROM ? 'N0Q' : 'N0R');

/** 'YYYYMMDDHHMI' (UTC) for a time in ms. */
export const stamp = (t) => new Date(t).toISOString().slice(0, 16).replace(/[-T:]/g, '');

/** XYZ tile template for one frame (ms UTC), or the live composite when t is null. */
export const tileURL = (t, product = productFor(t)) =>
  `${IEM}/cache/tile.py/1.0.0/${t == null ? 'nexrad-n0q-900913' : `ridge::USCOMP-${product}-${stamp(t)}`}/{z}/{x}/{y}.png`;

/** IEM's frame listing for [t0, t1] (ms UTC). */
export const listURL = (product, t0, t1) => `${IEM}/json/radar.py?` + new URLSearchParams({
  operation: 'list', product, radar: 'USCOMP', start: new Date(t0).toISOString().slice(0, 16) + 'Z', end: new Date(t1).toISOString().slice(0, 16) + 'Z' });

/** Frame times (ms UTC, ascending) from a listing response. */
export const parseScans = (json) => (json?.scans ?? []).map(s => Date.parse(s.ts)).filter(Number.isFinite).sort((a, b) => a - b);

/**
 * Frames covering [t0, t1] (ms UTC): { product, times }. A window that crosses into N0Q's start is split, each part
 * from its own product. `getJSON(url)` fetches and parses a listing.
 */
export async function listFrames(t0, t1, getJSON) {
  const parts = t0 < N0Q_FROM && t1 >= N0Q_FROM ? [['N0R', t0, N0Q_FROM - 1], ['N0Q', N0Q_FROM, t1]] : [[productFor(t0), t0, t1]];
  const frames = [];
  for (const [product, a, b] of parts) for (const t of parseScans(await getJSON(listURL(product, a, b)))) frames.push({ t, product });
  return frames;
}

/** Index of the frame shown at time t: the latest at or before t, within MAX_GAP_MS; -1 if none. */
export function frameAt(frames, t) {
  let lo = 0, hi = frames.length - 1, k = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (frames[m].t <= t) { k = m; lo = m + 1; } else hi = m - 1; }
  return k >= 0 && t - frames[k].t <= MAX_GAP_MS ? k : -1;
}
