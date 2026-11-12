"""Independent reference values for the T2 ellipse experiment.
(1) true 38x60 in ellipse, (2) SWMM HORIZ_ELLIPSE code 9 as xsect.c computes it,
(3) SWMM CUSTOM shape from the curve as written (5 dp, as toINP writes it), as shape.c builds it."""
import json, math, sys
import numpy as np
from scipy.integrate import quad
from scipy.optimize import brentq
from scipy.special import ellipe

FT = 0.3048           # Ucf LENGTH (swmm5.c:110)
QCF = 0.02832         # Qcf CMS (swmm5.c:120)
PHI = 1.486           # consts.h:46
L, S0, n = 400.0, 0.004, 0.013
rise, span = 38 * 0.0254, 60 * 0.0254
a, b = span / 2, rise / 2

RES = json.load(open(sys.argv[1]))
out = {}

# ---------------- (1) true ellipse ----------------
def phi_of(y):  # y depth from invert (m); z=-b cos(phi)
    c = 1 - y / b
    return math.acos(max(-1.0, min(1.0, c)))
def true_A(y):
    p = phi_of(y); return a * b * (p - math.sin(p) * math.cos(p))
def true_W(y):
    return 2 * a * math.sin(phi_of(y))
def true_P(y):
    p = phi_of(y)
    f = lambda t: math.sqrt((a * math.cos(t)) ** 2 + (b * math.sin(t)) ** 2)
    return 2 * quad(f, 0, p, epsabs=1e-14, epsrel=1e-13, limit=200)[0]
Afull_t = math.pi * a * b
m = 1 - (b / a) ** 2
Pfull_t = 4 * a * ellipe(m)
assert abs(Pfull_t - true_P(rise)) < 1e-9
Rfull_t = Afull_t / Pfull_t
def true_R(y): return true_A(y) / true_P(y) if y > 0 else 0.0
def true_Q(y): return (1 / n) * true_A(y) * true_R(y) ** (2 / 3) * math.sqrt(S0)
out['true'] = dict(A=Afull_t, P=Pfull_t, R=Rfull_t, Qfull=true_Q(rise))
ys = np.linspace(rise * 0.5, rise, 20001)
qs = [true_Q(y) for y in ys]
k = int(np.argmax(qs)); out['true']['Qmax'] = qs[k]; out['true']['yQmax_over_D'] = ys[k] / rise

# ---------------- SWMM lookup functions (xsect.c 1474-1607) ----------------
def lookup(x, t):
    N = len(t); d = 1.0 / (N - 1); i = int(x / d)
    if i >= N - 1: return t[N - 1]
    x0 = i * d; x1 = (i + 1) * d
    y = t[i] + (x - x0) * (t[i + 1] - t[i]) / d
    if i < 2:
        y2 = y + (x - x0) * (x - x1) / (d * d) * (t[i] / 2 - t[i + 1] + t[i + 2] / 2)
        if y2 > 0: y = y2
    return max(y, 0.0)
def locate(y, t, jLast):
    if y <= t[0]: return 0
    if y >= t[jLast]: return jLast
    j1, j2 = 0, jLast
    while j2 - j1 > 1:
        j = (j1 + j2) >> 1
        if y >= t[j]: j1 = j
        else: j2 = j
    return j1
def invLookup(y, t):
    N = len(t); dx = 1.0 / (N - 1); nn = N
    if t[nn - 3] > t[nn - 1]: nn -= 2
    if nn < N and y > t[N - 1]:
        if y >= t[N - 3]: return (nn - 1) * dx
        i = N - 2 if y <= t[N - 2] else N - 3
    else:
        i = locate(y, t, nn - 1)
    if i >= nn - 1: return (nn - 1) * dx
    x0 = i * dx; dy = t[i + 1] - t[i]
    x = x0 if dy == 0 else x0 + (y - t[i]) * dx / dy
    return min(max(x, 0.0), 1.0)

class TabSect:
    """yFull, wMax (ft), aFull ft2, rFull ft, normalised A, R, W tables, sFull, sMax, aMax"""
    def __init__(s, yFull, wMax, aFull, rFull, At, Rt, Wt, sMax=None, aMax=None):
        s.yFull, s.wMax, s.aFull, s.rFull, s.At, s.Rt, s.Wt = yFull, wMax, aFull, rFull, At, Rt, Wt
        s.sFull = aFull * rFull ** (2 / 3)
        s.sMax = s.sFull if sMax is None else sMax
        s.aMax = aMax
    def A(s, y):
        return 0.0 if y <= 0 else s.aFull * lookup(y / s.yFull, s.At)
    def R(s, y): return s.rFull * lookup(y / s.yFull, s.Rt)
    def W(s, y): return s.wMax * lookup(y / s.yFull, s.Wt)
    def YofA(s, A): return s.yFull * invLookup(A / s.aFull, s.At)
    def RofA(s, A): return 0.0 if A <= 0 else s.R(s.YofA(A))
    def SofA(s, A):
        r = s.RofA(A); return 0.0 if A == 0 or r < 1e-6 else A * r ** (2 / 3)
    def Amax(s): return s.aMax
    def AofS(s, sf):  # generic_getAofS 1359-1400
        if sf > s.sMax: sf = s.sMax
        if s.sFull <= sf <= s.sMax and s.sMax != s.sFull:
            a1, a2 = s.aFull, s.Amax()
        else:
            a1, a2 = 0.0, s.Amax()
        lo, hi = min(a1, a2), max(a1, a2)
        f = lambda A: s.SofA(A) - sf
        # check sign change / uniqueness on a fine grid
        g = np.linspace(lo, hi, 4001); v = [f(x) for x in g]
        roots = [i for i in range(len(g) - 1) if v[i] == 0 or v[i] * v[i + 1] < 0]
        if not roots: return None, 0
        i = roots[0]
        return brentq(f, g[i], g[i + 1], xtol=1e-12), len(roots)
    def ynorm_SI(s, Q):  # link_getYnorm, link.c 783-803
        q = Q / QCF
        beta = PHI * math.sqrt(S0) / n
        qMax = s.sMax * beta
        q = min(q, qMax)
        A, nroots = s.AofS(q / beta)
        return s.YofA(A) * FT, nroots, A

# ---------------- (2) SWMM standard code 9 (xsect.c 552-577, xsect.dat 339-379) ----------------
A_HE = [.0000,.0150,.0400,.0650,.0950,.1300,.1650,.2050,.2500,.3000,.3550,.4150,.4800,.5200,.5850,.6450,.7000,.7500,.7950,.8350,.8700,.9050,.9350,.9600,.9850,1.000]
R_HE = [.0100,.0764,.1726,.2389,.3274,.4191,.5120,.5983,.6757,.7630,.8326,.9114,.9702,1.030,1.091,1.146,1.185,1.225,1.257,1.274,1.290,1.282,1.274,1.257,1.185,1.000]
W_HE = [.0,.3919,.5426,.6499,.7332,.8000,.8542,.8980,.9330,.9600,.9798,.9928,.9992,.9992,.9928,.9798,.9600,.9330,.8980,.8542,.8000,.7332,.6499,.5426,.3919,.0]
idx = int(math.floor(9)) - 1
std = TabSect(38 / 12, 60 / 12, 12.90, 0.969, A_HE, R_HE, W_HE)
std.aMax = 0.96 * std.aFull   # Amax[HORIZ_ELLIPSE] = 0.96 (xsect.c 68), sMax = sFull (xsect.c 576)

# ---------------- (3) SWMM custom: shape.c computeShapeTables ----------------
pts = RES['sections']['exact']['written']['curve']
pts5 = [(float(f"{x:.5f}"), float(f"{w:.5f}")) for x, w in pts]   # toINP writes +x.toFixed(5)
def shape_tables(curve):
    N = 51; nseg = N - 1; dy = 1.0 / nseg; TINY = 1e-6
    it = iter(curve)
    y1, w1 = next(it); wMax = w1
    st = {'A': 0.0, 'P': 0.0}
    def nxt():
        try: return next(it)
        except StopIteration: return None
    if y1 != 0:
        y2, w2 = y1, w1; y1, w1 = 0.0, 0.0
    else:
        e = nxt(); y2, w2 = e; y2 = min(y2, 1.0); wMax = max(wMax, w2)
    getW = lambda y, y1, y2, w1, w2: w2 if y2 == y1 else w1 + (y - y1) / (y2 - y1) * (w2 - w1)
    getA = lambda y, w, ya, wa: (min(w, wa) + abs(w - wa) / 2) * (y - ya)
    getP = lambda y, w, ya, wa: 2 * math.sqrt((y - ya) ** 2 + (abs(w - wa) / 2) ** 2)
    At = [0.0] * N; Rt = [0.0] * N; Wt = [0.0] * N
    Wt[0] = w1; st['P'] = w1
    y = 0.0; w = w1
    for i in range(1, nseg + 1):
        yLast, wLast = y, w
        y = y + dy
        if abs(y - 1.0) < TINY: y = 1.0
        if y > y2:
            while y > y2:
                if y2 > yLast:
                    st['A'] += getA(y2, w2, yLast, wLast); st['P'] += getP(y2, w2, yLast, wLast)
                    yLast, wLast = y2, w2
                y1, w1 = y2, w2
                e = nxt()
                if e is None: y2 = 1.0; break
                y2, w2 = e; wMax = max(wMax, w2); y2 = min(y2, 1.0)
            yLast, wLast = y1, w1
        w = getW(y, y1, y2, w1, w2)
        st['A'] += getA(y, w, yLast, wLast); st['P'] += getP(y, w, yLast, wLast)
        if y == 1.0: st['P'] += w2
        Wt[i] = w; At[i] = st['A']; Rt[i] = st['A'] / st['P'] if st['P'] > 0 else 0.0
    aF, rF = At[nseg], Rt[nseg]
    sMax, aMax = 0.0, 0.0
    for i in range(1, nseg + 1):
        sf = At[i] * Rt[i] ** (2 / 3)
        if sf > sMax: sMax, aMax = sf, At[i]
    return dict(aFull=aF, rFull=rF, wMax=wMax, sMax=sMax, aMax=aMax, Pfull=st['P'],
                At=[v / aF for v in At], Rt=[v / rF for v in Rt], Wt=[v / wMax for v in Wt])
def make_custom(curve):
    T = shape_tables(curve); yF = rise / FT   # xsect yFull = p[0]/ucf
    c = TabSect(yF, T['wMax'] * yF, T['aFull'] * yF * yF, T['rFull'] * yF, T['At'], T['Rt'], T['Wt'])
    c.sMax = T['sMax'] * yF * yF * yF ** (2 / 3); c.aMax = T['aMax'] * yF * yF   # xsect.c 652-657
    return c, T
cus, Tc = make_custom(pts5)
cus_raw, _ = make_custom([tuple(p) for p in pts])

def SI(sec, y):  # y in m
    yf = y / FT; A = sec.A(yf) * FT * FT; R = sec.R(yf) * FT
    return A, R, (A / R if R > 0 else 0.0), sec.W(yf) * FT
def full(sec):
    A = sec.aFull * FT * FT; R = sec.rFull * FT
    return dict(A=A, R=R, P=A / R, W=sec.wMax * FT, Qfull=sec.sFull * PHI * math.sqrt(S0) / n * QCF,
                Qmax=sec.sMax * PHI * math.sqrt(S0) / n * QCF)
out['std_full'] = full(std); out['cus_full'] = full(cus); out['cus_raw_full'] = full(cus_raw)
out['cus_Pfull_incl_top'] = Tc['Pfull'] * rise
out['std_ywMax'] = 0.48
# true section factor maxima for the tables themselves
def tab_Qmax_true_branch(sec):
    yy = np.linspace(0.3, 1.0, 7001) * sec.yFull
    q = [sec.A(y) * sec.R(y) ** (2 / 3) * PHI * math.sqrt(S0) / n * QCF for y in yy]
    k = int(np.argmax(q)); return q[k], yy[k] / sec.yFull
out['std_tableQmax'] = tab_Qmax_true_branch(std); out['cus_tableQmax'] = tab_Qmax_true_branch(cus)

# ---------------- depth table ----------------
rep_depths = sorted({p[k] for sec in ('standard', 'exact') for p in RES['sections'][sec]['partFull'] for k in ('linkDepth', 'headwaterDepth', 'outfallDepth')})
rows = []
for f in [round(0.05 * i, 2) for i in range(1, 21)]:
    y = f * rise
    rows.append(dict(f=f, true=(true_A(y), true_R(y), true_P(y), true_W(y)), std=SI(std, y), cus=SI(cus, y)))
out['depthTable'] = rows

# ---------------- normal depth (true, std, cus) and compare with SWMM ----------------
def true_ynorm(Q):
    f = lambda y: true_Q(y) - Q
    yq = out['true']['yQmax_over_D'] * rise
    if Q > out['true']['Qmax']: return None, None
    lo = brentq(f, 1e-6, yq)
    hi = brentq(f, yq, rise) if Q > out['true']['Qfull'] else None
    return lo, hi
nd = []
for i, Q in enumerate([0.1, 0.25, 0.5, 1.0, 1.5, 2.0, 2.5]):
    ps = RES['sections']['standard']['partFull'][i]; pc = RES['sections']['exact']['partFull'][i]
    yt, yt2 = true_ynorm(Q)
    ys_, nrs, _ = std.ynorm_SI(Q); yc_, nrc, _ = cus.ynorm_SI(Q)
    # SWMM geometry at the reported depths, and the JSON's implied values
    Ast, Rst, Pst, _ = SI(std, ps['linkDepth']); Acu, Rcu, Pcu, _ = SI(cus, pc['linkDepth'])
    nd.append(dict(Q=Q, y_true=yt, y_true_upper=yt2, y_std=ys_, y_cus=yc_, nroots_std=nrs, nroots_cus=nrc,
                   swmm_std=dict(hw=ps['headwaterDepth'], link=ps['linkDepth'], out=ps['outfallDepth']),
                   swmm_cus=dict(hw=pc['headwaterDepth'], link=pc['linkDepth'], out=pc['outfallDepth']),
                   std_geom_at_link=(Ast, Rst, Pst), std_implied=(ps['impliedArea'], ps['impliedHydRadius'], ps['impliedPerimeter']),
                   cus_geom_at_link=(Acu, Rcu, Pcu), cus_implied=(pc['impliedArea'], pc['impliedHydRadius'], pc['impliedPerimeter']),
                   true_geom_at_ytrue=(true_A(yt), true_R(yt), true_P(yt))))
out['normal'] = nd

# ---------------- full flow head loss ----------------
def hf(Q, A, R): return (Q * n) ** 2 * L / (A ** 2 * R ** (4 / 3))
def hf_swmm(Q, sec):  # SWMM friction in ft units: roughFactor = g (n/PHI)^2 ; Sf = (n/PHI)^2 V^2 / R^(4/3)
    q = Q / QCF; A = sec.aFull; R = sec.rFull; V = q / A
    return (n / PHI) ** 2 * V * V / R ** (4 / 3) * (L / FT) * FT
fl = []
for i, Q in enumerate([1.0, 2.0, 3.0]):
    fs = RES['sections']['standard']['full'][i]; fc = RES['sections']['exact']['full'][i]
    fl.append(dict(Q=Q, true=hf(Q, Afull_t, Rfull_t), std=hf(Q, out['std_full']['A'], out['std_full']['R']), std_swmmunits=hf_swmm(Q, std),
                   cus=hf(Q, out['cus_full']['A'], out['cus_full']['R']), cus_swmmunits=hf_swmm(Q, cus),
                   swmm_std=fs['headLoss'], swmm_cus=fc['headLoss'], Vstd=fs['velocityLink'], Vcus=fc['velocityLink'],
                   Rimpl_std=fs['impliedHydRadiusFromSwmmFullArea'], Rimpl_cus=fc['impliedHydRadiusFromSwmmFullArea']))
out['fullflow'] = fl

# ---------------- (7) consistency of code-9 tables ----------------
yN = np.linspace(0, 1, 26)
W = np.array(W_HE); At = np.array(A_HE); Rt = np.array(R_HE)
cumA_trap = np.concatenate([[0], np.cumsum((W[1:] + W[:-1]) / 2 * np.diff(yN))])
# finer: integrate SWMM's own lookup of W (quadratic near bottom) with many points
fine = np.linspace(0, 1, 200001)
Wf = np.array([lookup(x, W_HE) for x in fine])
cumA_fine = np.concatenate([[0], np.cumsum((Wf[1:] + Wf[:-1]) / 2 * np.diff(fine))])
Atrue = np.array([true_A(f * rise) / Afull_t for f in yN])
Wtrue = np.array([true_W(f * rise) / span for f in yN])
Rtrue = np.array([(true_R(f * rise) / Rfull_t) if f > 0 else 0 for f in yN])
cons = dict(intW_trap=cumA_trap[-1], intW_lookup=cumA_fine[-1],
            area_from_W_ft2=cumA_fine[-1] * (38 / 12) * (60 / 12), Afull_tab=12.90, Afull_true_ft2=Afull_t / FT ** 2,
            Rfull_tab_m=0.969 * FT, Rfull_true_m=Rfull_t, Afull_over_DB=12.90 / ((38 / 12) * (60 / 12)),
            nonstd_formula_A_ft2=1.2692 * (38 / 12) ** 2, nonstd_formula_R_ft=0.3061 * (38 / 12))
# A table vs normalised integral of W table
step = 200000 // 25
cons['rows'] = [dict(y=round(yN[i], 2), A_tab=At[i], A_fromW=cumA_fine[i * step] / cumA_fine[-1], A_true=Atrue[i],
                     W_tab=W[i], W_true=Wtrue[i], R_tab=Rt[i], R_true=Rtrue[i]) for i in range(26)]
# symmetry check A(1-y) + A(y) = 1
cons['A_sym_maxdev'] = max(abs(At[i] + At[25 - i] - 1) for i in range(26))
cons['W_sym_maxdev'] = max(abs(W[i] - W[25 - i]) for i in range(26))
# perimeter implied by A and R tables: P/Pfull = (A/Afull)/(R/Rfull)
Pfull_tab = 12.90 / 0.969
cons['Pfull_tab_ft'] = Pfull_tab; cons['Pfull_true_ft'] = Pfull_t / FT
# perimeter from the W table (polygon sides, scaled by wMax=5 ft, yFull=3.1667 ft)
Pw = np.concatenate([[0], np.cumsum(2 * np.sqrt((np.diff(fine) * 38 / 12) ** 2 + (np.diff(Wf) * 60 / 12 / 2) ** 2))])
cons['P_from_W_full_ft'] = Pw[-1]
cons['Prows'] = [dict(y=round(yN[i], 2), P_tab_ft=(At[i] * 12.90 / (Rt[i] * 0.969)) if i > 0 else 0, P_fromW_ft=Pw[i * step], P_true_ft=true_P(yN[i] * rise) / FT) for i in range(26)]
out['cons'] = cons
out['custom_tables'] = dict(aFull_norm=Tc['aFull'], rFull_norm=Tc['rFull'], wMax=Tc['wMax'], sMax=Tc['sMax'], aMax_over_aFull=Tc['aMax'] / Tc['aFull'],
                            ywMax_idx=None)
json.dump(out, open(sys.argv[2], 'w'), indent=1, default=float)

# ---------------- print ----------------
P = print
P('TRUE ellipse: A %.5f m2  P %.5f m  R %.5f m  Qfull %.4f  Qmax %.4f at y/D %.3f' % (Afull_t, Pfull_t, Rfull_t, out['true']['Qfull'], out['true']['Qmax'], out['true']['yQmax_over_D']))
for k in ('std_full', 'cus_full', 'cus_raw_full'):
    d = out[k]; P('%-12s A %.5f (%+.2f%%)  P %.5f (%+.2f%%)  R %.5f (%+.2f%%)  W %.4f  Qfull %.4f (%+.2f%%)  Qmax(code) %.4f' % (k, d['A'], 100 * (d['A'] / Afull_t - 1), d['P'], 100 * (d['P'] / Pfull_t - 1), d['R'], 100 * (d['R'] / Rfull_t - 1), d['W'], d['Qfull'], 100 * (d['Qfull'] / out['true']['Qfull'] - 1), d['Qmax']))
P('custom P incl top (shape.c Ptotal) %.5f' % out['cus_Pfull_incl_top'])
P('table Qmax over depth: std %.4f at %.3f, cus %.4f at %.3f' % (*out['std_tableQmax'], *out['cus_tableQmax']))
P('\ny/D | true A P R W | std A P R | cus A P R | dA% std cus | dR% std cus | dP% std cus')
for r in rows:
    t, s, c = r['true'], r['std'], r['cus']
    P('%.2f | %.4f %.4f %.4f %.4f | %.4f %.4f %.4f | %.4f %.4f %.4f | %+6.2f %+6.2f | %+6.2f %+6.2f | %+6.2f %+6.2f' % (
        r['f'], t[0], t[2], t[1], t[3], s[0], s[2], s[1], c[0], c[2], c[1],
        100 * (s[0] / t[0] - 1), 100 * (c[0] / t[0] - 1), 100 * (s[1] / t[1] - 1), 100 * (c[1] / t[1] - 1), 100 * (s[2] / t[2] - 1), 100 * (c[2] / t[2] - 1)))
P('\nNormal depth (m): Q | true (upper) | std calc | SWMM std hw/link/out | cus calc | SWMM cus hw/link/out | roots')
for d in nd:
    P('%.2f | %.4f %s | %.4f | %.4f %.4f %.4f | %.4f | %.4f %.4f %.4f | %d %d' % (d['Q'], d['y_true'], ('%.4f' % d['y_true_upper']) if d['y_true_upper'] else '-', d['y_std'], d['swmm_std']['hw'], d['swmm_std']['link'], d['swmm_std']['out'], d['y_cus'], d['swmm_cus']['hw'], d['swmm_cus']['link'], d['swmm_cus']['out'], d['nroots_std'], d['nroots_cus']))
P('\nGeometry at SWMM link depth vs JSON implied: Q | std A R P (calc) | implied | cus A R P (calc) | implied')
for d in nd:
    P('%.2f | %.5f %.5f %.5f | %.5f %.5f %.5f | %.5f %.5f %.5f | %.5f %.5f %.5f' % (d['Q'], *d['std_geom_at_link'], *d['std_implied'], *d['cus_geom_at_link'], *d['cus_implied']))
P('\nFull flow hf (m): Q | true | std calc (swmm-units) | SWMM std | cus calc (swmm-units) | SWMM cus | V std cus | Rimpl')
for d in fl:
    P('%.1f | %.5f | %.5f (%.5f) | %.5f | %.5f (%.5f) | %.5f | %.5f %.5f | %.5f %.5f' % (d['Q'], d['true'], d['std'], d['std_swmmunits'], d['swmm_std'], d['cus'], d['cus_swmmunits'], d['swmm_cus'], d['Vstd'], d['Vcus'], d['Rimpl_std'], d['Rimpl_cus']))
P('\nCode-9 consistency:', {k: v for k, v in cons.items() if k not in ('rows', 'Prows')})
P('y | A_tab A_fromW A_true | W_tab W_true | R_tab R_true | P_tab P_fromW P_true (ft)')
for r, q in zip(cons['rows'], cons['Prows']):
    P('%.2f | %.4f %.4f %.4f | %.4f %.4f | %.4f %.4f | %.3f %.3f %.3f' % (r['y'], r['A_tab'], r['A_fromW'], r['A_true'], r['W_tab'], r['W_true'], r['R_tab'], r['R_true'], q['P_tab_ft'], q['P_fromW_ft'], q['P_true_ft']))
P('\ncustom tables:', out['custom_tables'])
