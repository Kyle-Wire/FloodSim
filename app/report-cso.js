// Report section: combined sewer overflows (src/cso.js books on the run record, rec.cso). Per regulator the overflow
// to the river (volume, peak, hours overflowing, events under the dry-period rule) and what went on to the interceptor,
// before vs after when the report is a pair; the capture over the run; the overflow and interceptor flow in time.
import * as R from '../src/report.js';

/**
 * The section ({ id, title, note, figures, tables }) for app/report-ui.js, or null when no run has combined-sewer books.
 * runs: [[role, record]]; A: the before run (or null); u: display units ({ q, Q, vol, V, dpQ }); tag(role) → 'Before' |
 * 'After' | 'Run'; size: chart size in the drawer.
 */
export function csoSection({ runs, A, theme, size, u, tag }) {
  const withBooks = runs.filter(([, r]) => r?.cso); if (!withBooks.length) return null;
  const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'x';
  const h = (s) => s / 3600, figs = [], rows = [], totals = [];
  const names = [...new Set(withBooks.flatMap(([, r]) => r.cso.regulators.map(g => g.name)))];
  for (const nm of names) {
    const series = [];
    for (const [role, r] of withBooks) {
      const g = r.cso.regulators.find(x => x.name === nm); if (!g) continue;
      series.push({ name: `${tag(role)} overflow`, role: A ? role : 'after', pts: g.series.cso.map(([t, q]) => [h(t), u.Q(q)]) });
      series.push({ name: `${tag(role)} to interceptor`, role: 'line', dash: role === 'before', pts: g.series.interceptor.map(([t, q]) => [h(t), u.Q(q)]) });
      rows.push({ where: `Regulator ${nm}`, run: tag(role), events: g.cso.events.length, volume: u.V(g.cso.volume), peak: u.Q(g.cso.peak), hours: h(g.cso.overflowS),
        icp: u.V(g.interceptor.volume), qcap: u.Q(g.qcap), gated: g.gated ? 'yes' : 'no' });
    }
    figs.push({ name: `cso_${slug(nm)}`, svg: R.lineChart(series, { title: `Regulator ${nm}: overflow to the river and flow on to the interceptor`, xLabel: 'hours from the start', yLabel: `flow, ${u.q}`, zeroY: true,
      refs: [{ y: u.Q(withBooks.at(-1)[1].cso.regulators.find(x => x.name === nm)?.qcap ?? NaN), label: 'capacity' }], theme, ...size }) });
  }
  for (const [role, r] of withBooks) {
    const t = r.cso.totals, pct = (v) => (v == null ? NaN : 100 * v);
    totals.push({ run: tag(role), cso: u.V(t.cso), events: t.events, icp: u.V(t.interceptor), offsite: u.V(t.offsite), capture: pct(t.capture), wet: pct(t.wetCapture), people: r.cso.people, dwf: u.Q(t.dwf) });
  }
  if (rows.length) figs.unshift({ name: 'cso_volume', svg: R.barChart(rows.map(x => ({ label: `${x.where.replace('Regulator ', '')} · ${x.run}`, value: x.volume, text: `${x.volume.toFixed(0)} ${u.vol}, ${x.events} event${x.events === 1 ? '' : 's'}` })),
    { title: 'Combined sewer overflow volume per regulator', unit: u.vol, theme, width: size?.width ?? 640 }) });
  const b = withBooks.at(-1)[1].cso, st = b.settings ?? {};
  return { id: 'cso', title: 'Combined sewer overflows',
    note: `${rows.length ? '' : 'No outfalls to a stream in this area: all combined flow left it in the sewer, so there is nothing to overflow. '}Each outfall to a stream is a regulator: an outlet passes flow up to the interceptor capacity (${st.capacity ?? '?'} × the peak dry-weather flow above it), and a weir at the depth where it reaches capacity spills the rest to the river. ` +
      `Sanitary flow ${st.dwf === false ? 'off' : `${st.perCapita ?? '?'} L per person per day, people ${st.density === 'by land cover' || st.density == null ? 'from the land cover' : `at ${st.density} per ha of developed land`}, on a typical residential daily pattern from local hour ${(b.startHour ?? 0).toFixed(1)}`}. ` +
      `An event is overflow above ${(b.rule.minQ * 1000).toFixed(1)} L/s, events apart by fewer than ${b.rule.interEventH} dry hours counting as one. Capture: interceptor / (interceptor + overflow) through the regulators; wet-weather capture takes each regulator's own dry-weather volume out first. ` +
      `Overflow outfalls ${st.gates ? 'are flap-gated against the tide' : 'are not gated'}. Pipes leaving the area are not regulated here and carry on downstream (column "left the area in the sewer"). Dry-weather flow, populations and capacities are estimates, not the utility's records.`,
    figures: figs,
    tables: [
      { name: 'cso_regulators', title: 'Overflow and interceptor flow per regulator', cols: [['where', 'regulator'], ['run', 'run'], ['events', 'events', 0], ['volume', `overflow_${u.vol}`, 0], ['peak', `peak_overflow_${u.q}`, u.dpQ], ['hours', 'hours_overflowing', 1], ['icp', `to_interceptor_${u.vol}`, 0], ['qcap', `capacity_${u.q}`, u.dpQ], ['gated', 'flap_gate']], rows },
      { name: 'cso_totals', title: 'Capture over the run', cols: [['run', 'run'], ['cso', `overflow_${u.vol}`, 0], ['events', 'events', 0], ['icp', `to_interceptor_${u.vol}`, 0], ['offsite', `left_the_area_in_the_sewer_${u.vol}`, 0], ['capture', 'capture_pct', 1], ['wet', 'wet_weather_capture_pct', 1], ['people', 'people_served', 0], ['dwf', `mean_dry_weather_flow_${u.q}`, u.dpQ]], rows: totals },
    ] };
}
