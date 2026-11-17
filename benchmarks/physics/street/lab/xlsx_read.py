import sys, zipfile, re
import xml.etree.ElementTree as ET
NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main', 'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}
def load(path):
    z = zipfile.ZipFile(path)
    shared = []
    if 'xl/sharedStrings.xml' in z.namelist():
        for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si', NS):
            shared.append(''.join(t.text or '' for t in si.iter('{%s}t' % NS['m'])))
    wb = ET.fromstring(z.read('xl/workbook.xml'))
    rels = {r.get('Id'): r.get('Target') for r in ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
    sheets = []
    for s in wb.find('m:sheets', NS):
        target = rels[s.get('{%s}id' % NS['r'])]
        sheets.append((s.get('name'), 'xl/' + target.lstrip('/').replace('xl/', '')))
    return z, shared, sheets
def col(ref):
    n = 0
    for ch in re.match(r'[A-Z]+', ref).group(0):
        n = n * 26 + ord(ch) - 64
    return n - 1
def rows(z, shared, part, limit=None):
    out = []
    for ev, el in ET.iterparse(z.open(part)):
        if el.tag == '{%s}row' % NS['m']:
            r = {}
            for c in el.findall('m:c', NS):
                v = c.find('m:v', NS)
                if v is None or v.text is None:
                    continue
                val = shared[int(v.text)] if c.get('t') == 's' else v.text
                r[col(c.get('r'))] = val
            out.append((int(el.get('r')), r))
            el.clear()
            if limit and len(out) >= limit:
                break
    return out
if __name__ == '__main__':
    z, shared, sheets = load(sys.argv[1])
    lim = int(sys.argv[2]) if len(sys.argv) > 2 else 6
    print(len(sheets), 'sheets:', [s[0] for s in sheets])
    for name, part in sheets[: int(sys.argv[3]) if len(sys.argv) > 3 else 3]:
        rr = rows(z, shared, part, lim)
        print('---', name, part)
        for n, r in rr:
            print(n, [str(r.get(k, ''))[:14] for k in range(max(r) + 1 if r else 0)])
