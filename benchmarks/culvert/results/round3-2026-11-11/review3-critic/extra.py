import sys, runpy, io, contextlib, math
from scipy.optimize import brentq
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    g = runpy.run_path(sys.argv[1] + '/calc.py', run_name='x') if False else None
sys.argv = ['calc.py', sys.argv[2], sys.argv[1] + '/out.json']
with contextlib.redirect_stdout(buf):
    g = runpy.run_path(sys.argv[0].replace('calc.py', '') + 'calc.py' if False else __file__.replace('extra.py', 'calc.py'))
cus, std, FT, PHI, QCF, S0, n = g['cus'], g['std'], g['FT'], g['PHI'], g['QCF'], g['S0'], g['n']
def Qof(sec, y):
    return sec.A(y) * sec.R(y) ** (2 / 3) * PHI * math.sqrt(S0) / n * QCF
for name, sec in (('cus', cus), ('std', std)):
    yq = 0.92 * sec.yFull
    lo = brentq(lambda y: Qof(sec, y) - 2.5, 0.3 * sec.yFull, yq)
    print(name, 'lower root at Q 2.5 (m):', lo * FT, ' Q at full', Qof(sec, sec.yFull * 0.99999))
# custom ywMax
Wt = cus.Wt; iMax = 0; w = Wt[0]
for i in range(1, 51):
    if Wt[i] < w: break
    w = Wt[i]; iMax = i
print('custom ywMax/yFull', iMax / 50)
# slot cutoff check for Q 2.5 custom outfall
print('outfall y/D custom Q2.5', 0.96183 / 0.9652, '> CrownCutoff 0.985257')
# low-depth quadratic-vs-linear inconsistency: getYofA(getAofY(y)) round trip for std
for f in (0.02, 0.04, 0.06, 0.1, 0.15):
    y = f * std.yFull; A = std.A(y); print('std roundtrip y/D', f, '->', std.YofA(A) / std.yFull)
# velocity head at inlet for each Q (std, custom) to show depth != energy headwater
for Q, ys, yc in ((1.0, 0.423, 0.4303), (2.0, 0.61255, 0.64659), (2.5, 0.72339, 0.77377)):
    As = std.A(ys / FT) * FT * FT; Ac = cus.A(yc / FT) * FT * FT
    print('Q', Q, 'V2/2g std %.3f cus %.3f' % ((Q / As) ** 2 / 19.62, (Q / Ac) ** 2 / 19.62))
# full area from link velocity
print('Af from V: std', 1 / 0.83432, 'cus', 1 / 0.86638)
