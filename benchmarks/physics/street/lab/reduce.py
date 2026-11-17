"""Reduce the Rubinato et al. (2017) steady-test spreadsheets (Zenodo 10.5281/zenodo.1434156, CC BY 4.0) to one row
per test: the mean and standard deviation of every recorded column. Standard library only (no openpyxl).
  python -I reduce.py data  ->  rubinato2017-steady.json
The spreadsheets are not in the repository (fetch.mjs downloads them and checks their MD5)."""
import json, os, statistics, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from xlsx_read import load, rows

FILES = {'S1': 'rubinato2017-S1-weir.xlsx', 'S2': 'rubinato2017-S2-submerged.xlsx', 'S3': 'rubinato2017-S3-orifice.xlsx', 'S4': 'rubinato2017-S4-orifice.xlsx'}
out = {'source': 'Rubinato, Martins, Kesserwani, Leandro, Djordjevic, Shucksmith (2017) J. Hydrology 552:421-432, doi 10.1016/j.jhydrol.2017.06.024; data: Zenodo record 1434156, CC BY 4.0', 'scenarios': {}}
for sc, name in FILES.items():
    z, shared, sheets = load(os.path.join(sys.argv[1], name))
    tests = []
    for sheet, part in sheets:
        if not sheet.lower().startswith('test'):
            continue
        rr = rows(z, shared, part)
        head = [rr[0][1].get(k, '') for k in range(max(rr[0][1]) + 1)]
        cols = {h: [] for h in head}
        for _, r in rr[1:]:
            for k, h in enumerate(head):
                try:
                    cols[h].append(float(r[k]))
                except (KeyError, ValueError):
                    pass
        t = cols[head[0]]
        tests.append({'test': sheet, 'samples': len(t), 'seconds': t[-1] - t[0] if t else 0,
                      'mean': {h: statistics.fmean(v) for h, v in cols.items() if v and h != head[0]},
                      'sd': {h: statistics.pstdev(v) for h, v in cols.items() if v and h != head[0]}})
    out['scenarios'][sc] = {'file': name, 'tests': tests}
    print(sc, len(tests), 'tests;', 'columns', list(tests[0]['mean']))
    for t in tests:
        print('  ', t['test'].ljust(8), t['samples'], 'samples', ' '.join(f"{h}={v:.3f}" for h, v in t['mean'].items()))
json.dump(out, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'rubinato2017-steady.json'), 'w'), indent=1)
