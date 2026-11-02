// Radar overlay tests: product by date, tile and listing URLs, frame listing across the N0R → N0Q change, and which
// frame shows at a given time (latest at or before it; none across an archive gap).
// Usage: node tests/run-radar-tests.mjs [--live]   (--live lists Hurricane Ida's frames from IEM)
import { productFor, stamp, tileURL, listURL, parseScans, listFrames, frameAt, N0Q_FROM, MAX_GAP_MS } from '../src/radar.js';

let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) fails++; };
const T = (s) => Date.parse(s);

check('product: Katrina 2005 is N0R, Ida 2021 is N0Q', productFor(T('2005-08-29T12:00Z')) === 'N0R' && productFor(T('2021-09-01T22:00Z')) === 'N0Q');
check('product changes on 15 Nov 2010', productFor(N0Q_FROM - 1) === 'N0R' && productFor(N0Q_FROM) === 'N0Q');
check('stamp is UTC YYYYMMDDHHMI', stamp(T('2021-09-01T22:05:30Z')) === '202109012205', stamp(T('2021-09-01T22:05:30Z')));
check('historic tile URL', tileURL(T('2021-09-01T22:05Z')) === 'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/ridge::USCOMP-N0Q-202109012205/{z}/{x}/{y}.png');
check('live tile URL', tileURL(null).endsWith('/nexrad-n0q-900913/{z}/{x}/{y}.png'));
const lu = new URL(listURL('N0Q', T('2021-09-01T22:00Z'), T('2021-09-01T23:00Z')));
check('listing URL', lu.pathname === '/json/radar.py' && lu.searchParams.get('product') === 'N0Q' && lu.searchParams.get('start') === '2021-09-01T22:00Z' && lu.searchParams.get('end') === '2021-09-01T23:00Z', lu.search);
check('parse sorts and skips bad stamps', JSON.stringify(parseScans({ scans: [{ ts: '2021-09-01T22:05Z' }, { ts: 'x' }, { ts: '2021-09-01T22:00Z' }] })) === JSON.stringify([T('2021-09-01T22:00Z'), T('2021-09-01T22:05Z')]));
check('parse an empty listing', parseScans({ scans: [] }).length === 0 && parseScans(null).length === 0);

// a window across the product change is listed from each product for its own part
const asked = [];
const fake = async (url) => { const q = new URL(url).searchParams; asked.push([q.get('product'), q.get('start'), q.get('end')]); return { scans: [{ ts: q.get('start') }] }; };
const fr = await listFrames(N0Q_FROM - 3600e3, N0Q_FROM + 3600e3, fake);
check('window across 15 Nov 2010: N0R then N0Q', asked.length === 2 && asked[0][0] === 'N0R' && asked[1][0] === 'N0Q' && fr.map(f => f.product).join() === 'N0R,N0Q', JSON.stringify(asked));

// frame at a time: latest at or before it, none before the first or across a gap
const frames = ['22:00', '22:05', '22:10', '23:00'].map(h => ({ t: T(`2021-09-01T${h}Z`), product: 'N0Q' }));
check('frame at an exact time', frameAt(frames, T('2021-09-01T22:05Z')) === 1);
check('frame between two: the earlier', frameAt(frames, T('2021-09-01T22:07:30Z')) === 1);
check('no frame before the first', frameAt(frames, T('2021-09-01T21:59Z')) === -1);
check(`no frame across a gap over ${MAX_GAP_MS / 60e3} min`, frameAt(frames, T('2021-09-01T22:40Z')) === -1 && frameAt(frames, T('2021-09-01T22:24Z')) === 2);
check('no frames at all', frameAt([], T('2021-09-01T22:00Z')) === -1);

if (process.argv.includes('--live')) {
  const live = await listFrames(T('2021-09-01T20:00Z'), T('2021-09-02T02:00Z'), async (u) => (await fetch(u)).json());
  check('live: Ida over Philadelphia, 6 h of 5-min N0Q frames', live.length >= 70 && live.every(f => f.product === 'N0Q'), `${live.length} frames`);
}

console.log(fails ? `\n${fails} check(s) FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
