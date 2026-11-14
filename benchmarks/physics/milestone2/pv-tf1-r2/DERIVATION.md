# PV-TF1-R2: derivation, draft 3a

**Status.** Draft 3a is a targeted closure pass after the technical review of draft 3 (`../reviews/review-r2-draft3-2026-11-12.md`).
- **Accepted by that review:** R3'' (representation-volume closure), C_fn, the period and ε treatment, and the design.
- **Required by it:**
  - D4 in the validity logic;
  - the Froude condition checked;
  - depth-endpoint guards;
  - the absolute-value statement in section 3.5.
- **Where the answers are:** sections 3.4, 3.5, 4.3–4.5, 5.2, 9 and 11. They are listed in [`CHANGELOG.md`](CHANGELOG.md) under "3 → 3a".
- **Draft 3** is preserved in [`drafts/draft3/`](drafts/draft3/).

Everything below otherwise stands as in draft 3, a derivation revision for technical review before independent review.
- Not hashed, not registered, not run. No execution or registration is authorised.
- The spec is [`PV-TF1-R2.json`](PV-TF1-R2.json).
- Every number comes from [`derive.mjs`](derive.mjs) → [`derived.json`](derived.json). The script uses only the declared inputs, `references/geometry.mjs` and `references/volume.mjs`. No run-1 number enters any reference, allowance or tolerance.
- The changes from draft 2 are in [`CHANGELOG.md`](CHANGELOG.md).
- Draft 2 is preserved in [`drafts/draft2/`](drafts/draft2/).
- The status of each conclusion (bounded, diagnosed or assumed) is in section 11.

**What draft 3 answers.** The technical review of draft 2 (`../reviews/resolution-r2-draft2-2026-11-12.md`) found four problems:
1. The leakage lemma is valid only for a non-increasing envelope.
2. The per-mode bounds do not give draft 2's multi-mode bound.
3. W1 does not establish the monotone-surface assumption R3'.
4. ε contained a coefficient-one scaling estimate and an unanalysed time-discretisation term.

## 1. Summary of the revision

The review's points are correct. Draft 3 does not repair draft 2's bound. It **reformulates the scored quantities so that no scored bound depends on modal leakage, on ε, or on the shape of the surface between nodes**:

| Scored quantity | Draft 2 relied on | Draft 3 relies on |
|---|---|---|
| Representation-volume closure, book stationarity | leakage lemma, multi-mode sum (W4), monotone surface (R3'), ε | the **representation volume** as the reference (R3''), and a quadrature bound computed from the recorded depths (section 3) |
| Uniformity | leakage of node amplitudes, v²/2g | an exact **window identity** of the reference link equation, evaluated on the recorded flows (section 4) |
| Level | leakage of the tank amplitude | an exact **level identity** from the representation volume (section 5) |

**Draft 3a changes two rows of this table.**
- **Uniformity:** the bound includes the measured residual r_s between SWMM and E4, gated by G-reference (Froude, depth, R_U). The row can therefore only Pass or be Insufficient (section 4.3).
- **Level:** the allowance uses the measured junction redistribution, so it no longer depends on E4 (section 5.2).

The window length M·T_ref stays. It now affects only the size of one computed term (the inertial term, section 4), not the validity of any row.

ε, W1, W3 and W4 remain as **diagnostics**, with what each can and cannot detect stated in section 6.

**The experiment design is retained:**
- NONE primary, BOTH paired and scored separately;
- N = 1 separate; N = 4, 16 and 32 under the comparability rules;
- M = 8, K = 3, β = 0.1;
- the 48 h maximum;
- the closure and level criteria;
- the hybrid raw output.

**One change of meaning is necessary, and is shown to be.** The closure row tests the volume of SWMM's N-segment representation, not the physical water volume in motion (section 3.2). At rest the two coincide. The technical reviewer accepted this in the review of draft 3. **The row is reported as representation-volume closure throughout, never as conservation of the physical moving water.**

## 2. Reference quantities (unchanged)

| Quantity | Value | Source |
|---|---|---|
| Stored volume after the inflow | V_in = 180.0 m³ | the declared hydrograph; closed system |
| Level | h_eq = 0.506637 m | 2·A_t·h + L·A(h) = V_in |
| Hydraulic depth at h_eq | A/W = 0.399371 m | geometry |
| Level storage | 2·A_t + L·W = 439.96 m² | dV_level/dh at h_eq |

**Reference periods** come from the lumped network (E10), with the continuum as a check:

| Case | T_ref (s) | Window, M = 8 (steps) | Fundamental vs continuum |
|---|---|---|---|
| N = 1 | 665.86 | 5327 | +49.9 % |
| N = 4 | 455.64 | 3645 | +2.55 % |
| N = 16 | 445.02 | 3560 | +0.16 % |
| N = 32 | 444.50 | 3556 | +0.04 % |

**N = 1.** The technical reviewer confirmed the intended reference: the pipe's water as one inertial column, L/(g·A), coupled to two lumped storage surfaces, S = A_t + W·L/2 = 219.98 m² each. The value 665.86 s uses the registered geometry: D 1 m, L 400 m, A_t 20 m², at h_eq.
- The full-pipe U-tube value, 143.2 s, does not apply.
- Independent reviewers are to verify the formula and the numbers, not the label.

## 3. The closure: the representation volume

### 3.1 The books

At every routing step:

  V_b(t) = A_t·d_T1 + A_t·d_T2 + Σ_s V_s(y_i, y_{i+1}) + Σ_j NODE_VOLUME_j   (E2)

where V_s is the exact circular-segment volume for a linear surface between the two recorded end depths. The scored quantity is the window mean ⟨V_b⟩_w3.

### 3.2 Why the physical volume in motion cannot be the reference

The physical water surface between two nodes is not part of SWMM's state: SWMM carries depths at nodes only. Its link depth is computed from them (yMid = (y1 + y2)/2, dwflow.c line 150). Any physical-volume reading of SWMM's state therefore needs an assumption about that surface. The review asked for a bound that allows internal extrema. Two classes were examined.

**(a) The envelope class.** Let η̄(x) be the linear interpolation of the window-mean node levels. Declare that the true surface satisfies |η(x, t) − η̄(x)| ≤ a_env everywhere in the segment, internal extrema allowed.

*Claim:* |η(x, t) − η_lin(x, t)| ≤ 2·a_env, where η_lin is the linear interpolation of the instantaneous node levels.

*Proof.*
1. At the nodes, the true surface passes through the recorded values, so |η_lin − η̄| ≤ a_env at both ends.
2. η_lin − η̄ is linear between the nodes, so |η_lin − η̄| ≤ a_env throughout.
3. Then |η − η_lin| ≤ |η − η̄| + |η̄ − η_lin| ≤ 2·a_env. ∎

The bound is attained: a profile at +a_env inside the segment, with both nodes at −a_env, is in the class.

The volume difference is therefore ≤ max W·2·a_env per unit length, and ≤ 2·a_env·D·L = 800·a_env m³ over the conduit.

**(b) The monotone class** (draft 2's R3', PV-C1's bracket). The bound is B(t) = Σ_s L_s·|A(y_i) − A(y_{i+1})|.

**Neither bound can be reduced by averaging without a model of how the unknown surface varies in time.** e(t) = V_b(t) − V_phys(t) is not a function of the recorded state. All that is known about it is a pointwise bound, so the most that can be said of its mean is |⟨e⟩| ≤ ⟨|e|⟩ ≤ ⟨bound⟩.

**Draft 2's leakage argument applied a modal decomposition to e(t). That was not justified, and draft 3 withdraws it.**

**What this means against the closure criterion,** using the allowance β·0.001·V_in = 0.018 m³ (`physicalProfileSensitivity`):

| Class | Largest amplitude the 0.018 m³ allowance admits |
|---|---|
| Envelope | a_env ≤ 22.5 µm, at every N |
| Monotone | node amplitude ≤ 35 µm (N = 1), 141 µm (N = 4), 0.57 mm (N = 16), 1.13 mm (N = 32), using the mean of \|cos\| = 2/π |

**Can monotonicity be verified independently?** It cannot be verified from SWMM's record. There is no inter-node state, and LINK_DEPTH carries no independent information. So it cannot be made a checkable validity condition. PV-C1's acceptance of the bracket concerned a level surface at rest, and does not extend to free oscillation.

**Conclusion.** A physical-volume closure in motion is not testable at the 0.1 % criterion from SWMM's state at any practical amplitude. **The reference is therefore redefined (R3'').** Both bounds are reported as diagnostic D5 and never scored.

### 3.3 The representation reference (R3'')

The reference statement is: *the geometric volume of the N-segment representation, read from the recorded node depths with a linear surface in each segment, equals V_in.*

- **Independence.** This is a fixed geometric functional of the recorded state. No SWMM volume quantity enters it.
- **At rest** it equals the physical volume.
- **In motion,** it is the volume the discrete representation holds.

SWMM's own continuity distributes storage through node surface areas. Each node carries (w_end + w_mid)·L_s/4 per joined conduit (dwflow.c lines 471–474), MIN_SURFAREA applies (dynwave.c line 670), and node continuity is trapezoidal in time (dynwave.c line 674).

A closure error of the representation volume is exactly what P2a and P2b predict: storage carried by node areas that does not match the volume the depths represent.

### 3.4 Definition sensitivity C_fn (replaces draft 2's C2)

The reference could equally have been the trapezoidal volume L_s·(A(y_i) + A(y_{i+1}))/2 or the midpoint volume L_s·A((y_i + y_{i+1})/2). C_fn bounds how much the choice matters.

*Lemma (quadrature error).* For one segment, let f(σ) = A(y_i + σ·Δ), σ ∈ [0, 1], Δ = y_{i+1} − y_i. Then:
- f″ = W′(y)·Δ²;
- ∫₀¹ f − (f(0) + f(1))/2 = −f″(ξ)/12;
- ∫₀¹ f − f(½) = f″(ζ)/24, for some ξ, ζ ∈ (0, 1).

Hence the linear-surface volume differs from the trapezoidal one by at most (L_s/12)·max|W′|·Δ², and from the midpoint one by at most (L_s/24)·max|W′|·Δ². Here max|W′| is taken over the depths between y_i and y_{i+1}.

So:

  **C_fn,w = max_{t∈w} Σ_s (L_s/12)·max|W′|_{s,t}·(y_i(t) − y_{i+1}(t))²**   (E3)

max|W′|_{s,t} is the maximum over the **complete depth range of segment s at step t**, [min(y_i(t), y_{i+1}(t)), max(y_i(t), y_{i+1}(t))]. This is exactly the interval in which the lemma's ξ and ζ lie. It is never evaluated at h_eq. |W′| = |D − 2y|/√(y(D − y)) is monotone in |y − D/2|, so the maximum is at an end of the range.

**Depth-endpoint guard G-depth (draft 3a).** W′ is singular at y = 0 and y = D, so C_fn (and R2, section 5.1) is evaluated only if every recorded node depth in w1–w3, and in the step before w1, lies in [0.1·D, 0.9·D].
- On that interval, max|W′| = 2.667 (derived.json `secondOrder.depthGuard`).
- Otherwise no value is computed (no infinite, clipped or substituted allowance), and the books and level rows are Insufficient reference data, sub-class IR-definition.
- The upper limit is the existing G-node and G-link guard (0.9·D). The lower limit is its mirror.
- At the end state the depths lie near h_eq = 0.507 m, far from both limits. The guard exists so that the implementation cannot produce a misleading allowance.

This replaces draft 2's C2 = ½·|W′|·a²·L, which assumed, without proof, that the internal deviation from the linear surface is at most a. Under R3'' there is no internal surface to deviate.

**Gate G-books:** C_fn,w3 ≤ β·0.001·V_in = 0.018 m³.

| N | A-priori worst case at a_lin = 3.99 mm (\|W′\| over h_eq ± 0.1 m) | Amplitude at which the gate binds |
|---|---|---|
| 1 | 9.3e-4 m³ | 18 mm |
| 4 | 6.4e-5 m³ | 67 mm |
| 16 | 4.1e-6 m³ | 263 mm |
| 32 | 1.0e-6 m³ | 500 mm |

The books are interpretable at any amplitude the guards allow.

### 3.5 No leakage argument is needed for the books

*Hypothesis:* SWMM conserves its representation volume, i.e. some representation volume in the class {linear surface, trapezoidal, midpoint} of the recorded depths equals V_in at every step after the fill.

Then, by the lemma of section 3.4:

  **|V_b(t) − V_in| ≤ C_fn(t) at every step**, and hence **|⟨V_b⟩_w − V_in| ≤ max_{t∈w} C_fn(t) = C_fn,w**

at any phase of any oscillation, whatever the modal content, period or envelope. Nothing about the oscillation enters.

**Why V_b barely oscillates.** For every oscillating mode m of the reference network, Σ_i S_i·φ_mi = 0. The modes are S-orthogonal to the uniform mode (`oscillatingModesCarryNoLinearVolume`: cosine ≤ 2.4e-12). The gradient of V_b at a level state is exactly S_i. So oscillation enters V_b only at second order, which C_fn covers. This is an explanation, not a premise: the bound above does not use it.

An offset |⟨V_b⟩_w3 − V_in| beyond C_fn is a genuine representation-volume closure error, which is the storage mechanism under test.

### 3.6 Book stationarity

D_k = |⟨V_b⟩_wk − ⟨V_b⟩_wk−1|, k = 2, 3. A conserving representation has D_k ≤ C_fn,wk + C_fn,wk−1.

| D_k | Status |
|---|---|
| ≤ C_fn,wk + C_fn,wk−1 | **Passed** |
| ≤ β·0.001·V_in = 0.018 m³ per window | **Qualified**: a resolvable drift below a tenth of the criterion |
| larger | **Failed** (accounting): continuing drift |

Draft 2 allowed E_V,k + E_V,k−1, up to about 0.036 m³. Draft 3's Passed threshold is stricter, and its Qualified ceiling is lower than draft 2's pass threshold.

## 4. Mean head differences and uniformity

### 4.1 The reference link equation (E4)

Start from St Venant for a horizontal channel with Manning friction:

  ∂Q/∂t + ∂(Q²/A)/∂x + g·A·∂H/∂x + g·A·S_f = 0,  S_f = n²·Q|Q| / (A²·R^{4/3})

Using continuity (∂A/∂t + ∂Q/∂x = 0), the momentum flux becomes ∂(Q²/A)/∂x = −2v·∂A/∂t − v²·∂A/∂x.

Lumped over a segment of length L_s, with Ā = A(ȳ) and ȳ = (y_i + y_{i+1})/2, and divided by g·Ā:

  **H_i − H_{i+1} = (L_s/(g·Ā))·dQ/dt + L_s·n²·Q|Q|/(Ā²·R̄^{4/3}) − (1/(g·Ā))·[2·L_s·v·dĀ/dt + v²·(A_{i+1} − A_i)]**   (E4)

This lumped network is the same reference model whose periods define T_ref (R1'').

**A fact about the source, not an input.** SWMM's EXTRAN link update (dwflow.c lines 192–240) is the backward-Euler form of E4:
- q(1 + dq1) = q_old − dq2 + dq3 + dq4, with dq2 = g·a_Wtd·(h2 − h1)·dt/L, dq3 = 2v·(a_Mid − a_Old), dq4 = v²·(a2 − a1)·dt/L, dq1 = g·n²·|v|·dt/R^{4/3} (in SI; SWMM works internally in US units with n/1.486);
- at Froude ≤ 0.5, σ = ρ = 1, so a_Wtd = a_Mid and r_Wtd = r_Mid.

**The correspondence is conditional.** It holds only where all of the following are true:
- (i) Fr ≤ 0.5 (dwflow.c line 192; SWMM's Froude number is |v|/√(g·A/W) at yMid, link.c lines 847–871);
- (ii) both ends are wet, y > FUDGE;
- (iii) the conduit is not full;
- (iv) the offsets are zero, so that getFlowClass returns SUBCRITICAL (dwflow.c lines 331–335) and the end heads are not replaced by critical or normal depth.

(iii) is guaranteed by G-link and (iv) by geometry (V1–V4). (i) and (ii) are checked at every scored step by G-reference (section 4.5).

**Where the correspondence holds, SWMM still departs from E4 in these ways:**
- |v| in the friction term, and q itself, are lagged and under-relaxed between iterations (line 265);
- the normal-flow limiter acts under BOTH (lines 255–258);
- the flow-reversal rule sets q to ±0.001 cfs when q changes sign between iterations (line 266). In a free oscillation this fires near every flow reversal;
- the dry-end rule (lines 280–281);
- the iteration stops at HEAD_TOLERANCE, not at exact convergence.

These are not bounded a priori. They are measured: they are the residual r_s of section 4.3.

### 4.2 The window identity (E5)

Average the backward-Euler form of E4 over the n steps of window w, with W = n·dt:

  **⟨H_i − H_{i+1}⟩_w = I_s + F_s − C_s ≡ P_s,w**

where:
- I_s = (L_s/(g·n·dt))·Σ_{t∈w}(Q_t − Q_{t−1})/Ā_t;
- F_s = ⟨L_s·n²·Q|Q|/(Ā²·R̄^{4/3})⟩_w;
- C_s = ⟨(1/(g·Ā))·[2·L_s·v·(Ā_t − Ā_{t−1})/dt + v²·(A_{i+1} − A_i)]⟩_w.

This is an exact consequence of the discrete equation. It holds for **any** window length, any modal content, and any envelope or phase. The inertial term I_s is computed from the recorded flows, including the step before the window. **No leakage bound, no ε and no linearity enter.**

The window of M·T_ref only makes I_s small, because the ends are nearly in phase. It is not required for validity.

### 4.3 The uniformity bound with the residual (E6, corrected in draft 3a)

Define:
- the measured mean head difference M_s = ⟨H_i − H_{i+1}⟩_w;
- the residual r_s = M_s − P_s (D4);
- the tank-mean h̄ = (⟨WSE_T1⟩ + ⟨WSE_T2⟩)/2;
- U = max_j |⟨WSE_j⟩ − h̄|, over every node j including both tanks.

*Claim.* U ≤ ½·Σ_s |M_s| ≤ τ_U + R_U, where τ_U = ½·Σ_s |P_s| and R_U = ½·Σ_s |r_s|. **No assumption is needed.**

*Proof.*
1. Along the chain, ⟨WSE_j⟩ − ⟨WSE_T1⟩ = −Σ_{s<j} M_s and ⟨WSE_j⟩ − ⟨WSE_T2⟩ = Σ_{s≥j} M_s.
2. Their average is ⟨WSE_j⟩ − h̄ = ½·(Σ_{s≥j} M_s − Σ_{s<j} M_s), so |⟨WSE_j⟩ − h̄| ≤ ½·Σ_s |M_s|.
3. For a tank, |⟨WSE_T1⟩ − h̄| = ½·|Σ_s M_s| ≤ ½·Σ_s |M_s|.
4. Finally, M_s = P_s + r_s gives ½·Σ|M_s| ≤ ½·Σ|P_s| + ½·Σ|r_s|. ∎

Draft 3 stated U ≤ τ_U "if M_s = P_s", and then treated r_s as diagnostic only. As the review pointed out, that left the residual's contribution unbounded. τ_U is what the reference equation explains; R_U is what it does not.

**A consequence the review's fix implies, stated openly.** U ≤ ½·Σ_s |M_s| holds identically. Any allowance that includes the residual therefore makes U impossible to exceed. So:
- **the uniformity row can no longer Fail**, under either form of the fix (adding R_U to the allowance, or gating it);
- what draft 3 called a persistent hydraulic imbalance, a mean head difference the motion does not explain, **is** a residual r_s.

Draft 3a therefore gates the residual (G-reference, section 4.5) and does not score it. **A persistent imbalance is reported as Insufficient reference data, sub-class IR-reference, with the full residual profile preserved.** It is never Failed.

This row also cannot separate a persistent imbalance from a departure of SWMM from E4 (the limiter, flow reversal, non-convergence), because both are residuals. The NONE/BOTH comparison of the residual (P4) is where they are told apart, and it is reported, not scored. Draft 3's Qualified and Failed tiers for U are withdrawn.

**Status of the uniformity row:**
- **Passed** when G-uniformity and G-reference hold. U ≤ τ_U + R_U ≤ 0.3 mm then follows, and is recorded as an arithmetic check;
- otherwise **Insufficient reference data**: IR-motion or IR-reference.

For N = 1, the uniformity row is the tank pair.

**Gate G-uniformity:** τ_U ≤ β·1.5 mm = 0.15 mm, else IR-motion. The motion allowance may use at most a tenth of the head-tolerance scale.

### 4.4 The residual and the Froude record (D4)

The residual profile r_s, its cumulative form along the chain, R_U, and the per-step Froude number of every segment are preserved for both arms. Expected sources under NONE:
- the flow-reversal rule near each reversal;
- iteration lag;
- convergence.

Under BOTH, the limiter adds to these.

**A residual under BOTH that is absent under NONE is the limiter acting (P4).** It is reported for interpretation. The residual is never scored as a physical result. Its only scored role is through G-reference.

### 4.5 Gate G-reference (the D4 gate)

The uniformity allowance is used only if **all** of the following hold:
- (a) Fr_s(t) = |Q_s/Ā_s| / √(g·Ā_s/W̄_s) ≤ 0.5 for **every segment at every step** of w1–w3 and at the step before w1 (E8a, the formula of link_getFroude at yMid);
- (b) G-depth, which also secures wet ends;
- (c) R_U,w3 ≤ β·1.5 mm = 0.15 mm, a predeclared numerical tolerance by the same β principle as the other gates.

**Otherwise** the uniformity row is IR-reference. Where (a) fails, the correspondence of section 4.1 is not established for that interval, and the residual is not interpretable as a departure from E4.

**A note on (a) and the lagged velocity.** SWMM evaluates its Froude number with the previous iterate's velocity. The recorded check uses the converged flow, so the two differ by at most one iteration's change of q. At a priori Froude numbers of about 0.01 (derived.json `froudeMax`, at a_lin), this does not approach the 0.5 boundary. If a recorded Froude number lies within that change of 0.5, the step is treated as failing (a).

**Feasibility of (c) is not known a priori.** Run 1 has no residual record. A case that fails (c) is IR-reference, which is a result.

### 4.6 A-priori worst case of τ_U (derived.json `budgets`)

The worst case is taken at node amplitude a, with the fundamental shape, the window ends at opposite phase, and friction and convection at their maxima.

| N | I, F, C at a_lin (mm) | τ_U at a_lin | Amplitude at which G-uniformity binds |
|---|---|---|---|
| 1 | 0.32, 0.18, 0.00 | 0.25 mm | 2.71 mm |
| 4 | 0.32, 0.09, 0.08 | 0.25 mm | 2.74 mm |
| 16 | 0.32, 0.09, 0.08 | 0.25 mm | 2.74 mm |
| 32 | 0.32, 0.09, 0.08 | 0.25 mm | 2.74 mm |

These numbers are not criteria. At run time the terms are computed from the record. For a decaying oscillation averaged over whole periods, I_s is much smaller than this worst case, which assumes window ends at opposite phase.

## 5. The level

### 5.1 The level identity (E7)

Let u_i(t) = y_i(t) − h̄_w. Let V_lev(h) = 2·A_t·h + L·A(h), the representation volume of a level surface.

Expand V_b about the level state h̄. The linear term for each segment gives W(h̄)·L_s/2 to each of its end nodes. The node lumped areas are then:
- tanks: S_T = A_t + W·L_s/2, equal for both;
- junctions: S_j = W·L_s.

Hence:

  V_b(t) = V_lev(h̄) + Σ_i S_i·u_i(t) + R2(t)

with R2 the exact remainder. Per segment, R2 = L_s·∫₀¹ ½·W′(ξ)·u(σ)² dσ. Since u is linear along the segment:

  |R2(t)| ≤ ½·Σ_s L_s·max|W′|_{s,t}·max(u_i², u_{i+1}²)

Here max|W′|_{s,t} is taken over [min(h̄, y_i(t), y_{i+1}(t)), max(h̄, y_i(t), y_{i+1}(t))], the complete range in which ξ lies. It is evaluated only under G-depth (section 3.4).

Average over the window. By the definition of h̄, ⟨u_T1⟩ + ⟨u_T2⟩ = 0, and the tank areas are equal, so the tank terms cancel. NODE_VOLUME_j = 0 (R4, scored). By the mean-value theorem, V_lev(h̄) − V_lev(h_eq) = S̃·(h̄ − h_eq), with S̃ ≥ 2·A_t + L·min W. Hence:

  **h̄ − h_eq = [(⟨V_b⟩ − V_in) − Σ_j S_j·⟨u_j⟩ − ⟨R2⟩] / S̃**   (exact)

The three terms are:
- a representation-volume closure error, counted as an error;
- the redistribution into junctions;
- a second-order remainder.

### 5.2 The allowance and the gate (E8, revised in draft 3a)

The redistribution term Σ_j S_j·⟨u_j⟩ is **measured**: ⟨u_j⟩ = ⟨WSE_j⟩ − h̄ is recorded. Draft 3 bounded it by S_J·τ_U, which made the level row inherit the reference link equation, and with it the residual problem of section 4.3. Draft 3a uses the recorded value:

  **E_h,w = [|Σ_j S_j·⟨u_j⟩_w| + ⟨R2 bound⟩_w] / (2·A_t + L·min W),  S_j = W(h̄)·L/N**   (E8)

This is exact by E7, and uses **no** reference link equation, no τ_U and no residual. The level row therefore **does not depend on G-reference or on the uniformity row**, and the dependency the review identified no longer exists.

E_h does not say why water is displaced into the junctions (motion or imbalance); it says how much. If too much is displaced, the level row cannot reflect the closure.

**Gate G-level:**
- G-depth holds, else IR-definition;
- E_h,w3 ≤ β·0.002 m = 0.2 mm, else IR-redistribution;
- W5 holds, else IR-drift.

Draft 3's IR-imbalance sub-class and its Qualified rule for the level row are retired: the level row no longer presumes a level mean surface.

The table below is an a-priori worst case. It estimates the junction deviations by τ_U, i.e. it assumes r_s = 0. At run time the measured redistribution is used and no assumption is made.

| N | E_h at a_lin (worst case) | Amplitude at which G-level binds |
|---|---|---|
| 1 | 3.2e-6 m (no junctions: only R2) | 31.7 mm (effectively unconstrained) |
| 4 | 1.7e-4 m | 4.47 mm |
| 16 | 2.1e-4 m | 3.82 mm |
| 32 | 2.2e-4 m | 3.73 mm |

N = 1's level row cannot be confounded by motion: with no junctions, h̄ follows from ⟨V_b⟩ up to R2.

### 5.3 Level drift (W5)

  |h̄_wk − h̄_wk−1| ≤ E_h,wk + E_h,wk−1 + |⟨V_b⟩_wk − ⟨V_b⟩_wk−1| / (2·A_t + L·min W)

That is: the mean level may move only as far as the motion and the book drift explain. A book drift is scored separately (section 3.6). If W5 fails, the level row is IR-drift.

## 6. Periods, ε and the diagnostics

### 6.1 What the periods now do

T_ref sets the window length: M·T_ref makes I_s small. T_ref and ε also enter:
- the comparability rule (2ε, a declared design rule on the reference models);
- diagnostic D2.

**No validity condition and no scored allowance depends on T_ref or ε.**

### 6.2 The leakage lemma, corrected (retained only to explain why integer-period windows keep I_s small)

*Lemma.* Let a be of bounded variation on [0, W], with ω = 2π/T. Then:

  |(1/W)·∫₀^W a(t)·cos(ωt + φ) dt| ≤ (T/(πW))·(|a(W)| + TV_[0,W](a))

If a ≥ 0 and is non-increasing, this becomes (T/(πW))·a(0).

*Proof.*
1. Let S(t) = ∫₀^t cos(ωs + φ) ds, so S(0) = 0 and |S| ≤ 2/ω.
2. Integrating by parts (Stieltjes): ∫₀^W a·cos = a(W)·S(W) − ∫₀^W S da.
3. So |∫| ≤ (2/ω)·(|a(W)| + TV(a)).
4. If a is non-increasing, TV(a) = a(0) − a(W), so |a(W)| + TV(a) = a(0).
5. Divide by W, using 2/(ωW) = T/(πW). ∎

Draft 2 claimed max(a(0), a(W)) for any monotone a. That is wrong for a non-decreasing envelope, where the bound is 2·a(W) − a(0).

**The multi-mode sum.** For x = Σ_m a_m(t)·cos(ω_m·t + φ_m), the lemma gives |⟨x⟩| ≤ Σ_m (T_m/(πW))·(|a_m(W)| + TV(a_m)). This is λ times the **sum of the modal amplitudes**, not λ times the maximum of the instantaneous bracket as draft 2 stated.

**A conservative multi-mode bound was investigated** (an energy bound, Cauchy–Schwarz). The reference modes are S-orthonormal, and Σ_m q_m² ≤ 2E/(ρg) caps every modal amplitude by the oscillation energy. A bound needs TV(a_m) for each mode, but Manning friction is non-proportional and transfers energy between modes, so individual envelopes need not be monotone. A bound on TV(a_m) from the friction power can be written, but it is not tight enough to be useful, and its own derivation rests on linearisation. **It is not used.** This is why the scored quantities were reformulated rather than the bound repaired.

### 6.3 ε reclassified as a tolerance

| Part | Value | Classification |
|---|---|---|
| level | 0.253 % | computed: the lumped model re-solved at h_eq ± 2 mm |
| amplitude | 1 % | **scaling estimate**: O(a/y_hyd) with coefficient 1, not derived. A nonlinear period correction is not derived in draft 3, because nothing scored needs it |
| time step | 0.0007–0.0017 % | **unbounded estimate**: (ωΔt)²/12 of a generic one-step scheme |
| friction | 0.004–0.005 % | computed under linearisation at a_lin |
| sum | 1.26 % → declared 1.5 % | linear sum, rounded up to the next 0.5 % |

**Why the time-step term is unbounded.** SWMM's EXTRAN step is not a standard one-step scheme:
- the link momentum is backward Euler;
- node continuity is trapezoidal in time (dynwave.c line 674);
- the two are coupled by Picard iteration, up to 8 trials, with under-relaxation ω = 0.5 (dynwave.c lines 61 and 705), stopped by HEAD_TOLERANCE.

Its phase error has not been analysed. The diagnostic NONE-dt0.5 reports the sensitivity of every scored quantity to the step.

**Does the fundamental's ε bound the longest period of the discrete system?**
- **For the reference network: yes, by construction.** Its modes are the generalised eigenvectors of (K, S), so the fundamental is the smallest non-zero eigenvalue, i.e. the longest period. ε covers the listed perturbations of that eigenvalue.
- **For SWMM's actual discrete system: not established.** Its node areas follow the flow class and the iteration, and its time stepping is the one above. These model-form differences are not bounded a priori. Draft 2's leakage premise needed this, and could not have it. Draft 3 does not need it.

### 6.4 The diagnostics: what each can and cannot detect

| Diagnostic | Detects | Cannot detect |
|---|---|---|
| **D1** linearity (a_max vs a_lin) | amplitudes beyond 1 % of A/W | anything about the modal content |
| **D2** period of T1 − T2 within ε of T_ref | a fundamental that is not the reference one | **any other mode**: it is not validation of the modal system |
| **D3** shifted windows (8 shifts of T_ref/8) | a mean that depends on the phase of the fundamental, at 45° resolution | a component whose period divides T_ref/8 (at N = 32, mode 8 is about 55 s); cancellation between components; variation slower than a window |
| **D4** momentum residual | a mean head difference that E4 does not explain (limiter, flow reversal, non-convergence) | its cause, beyond the arm comparison |
| **D5** physical-profile sensitivity | how far the physical volume could differ under each surface class | the true inter-node surface |
| **D6** modal projection (energy per reference mode) | how the recorded motion distributes over the reference modes | SWMM's own modes |

**None of D1–D6 gates a scored row.** D2 and D3 flags are reported beside the scores. Draft 2's IR-basis sub-class is retired, because no scored row depends on these assumptions any more.

## 7. Design constants

| Constant | Value | Role in draft 3 | Justification |
|---|---|---|---|
| closureRel, equilibriumAbsM | 0.001, 2 mm | criteria | PV-C1 and PV-TF1, unchanged |
| β | 0.1 | each gate: an allowance may use at most a tenth of the quantity it protects | unchanged principle (PV-TF1 draft 2) |
| headToleranceM | 1.5 mm | uniformity tier boundary; G-uniformity scale | SWMM's convergence tolerance: a mean head difference below it is not distinguishable from the stopping rule |
| M | 8 | window length | keeps I_s small (section 6.2). Not a validity parameter. Retained |
| K | 3 | windows | two stationarity tests (w1→w2, w2→w3), so a monotone drift and a one-off step can be told apart. Retained |
| ε, linFrac, shifts | 1.5 %, 1 %, 8 | diagnostic tolerances only | section 6 |

## 8. The experiment (retained)

- **Matrix:** 4 N × {NONE primary, BOTH paired}, scored; 4 N × {dt 0.5 s, MIN_SURFAREA 0.1, getter 420}, unscored. 20 runs. **Not authorised.**
- **Duration:** 48 h, a fixed maximum.
- **Raw output:** hybrid.
  - Every step is checked for the full run.
  - Full resolution is kept for the scored and shifted windows and the step before them, for ± one T_ref around any trip, and for the configuration and hashes.
  - The full record is archived outside git with checksums.
- **Feasibility.** The a-priori worst cases in sections 3.4, 4.6 and 5.2 replace draft 2's leakage-based allowances. The tightest is G-uniformity, at about 2.7 mm of node amplitude. Draft 2's N = 1 constraint (0.56 mm, from the 800 m² bracket) no longer exists, because the books no longer use the bracket.
  - Run 1 (BOTH, in motion) left tank level differences of 1.8–2.7 mm at 11.5 h (post-run README B3). This is feasibility information only, not a prediction for NONE or for 48 h.

## 9. Expected interpretation of each hypothesis

"Offset" means ⟨V_b⟩_w3 − 180 outside 0.18 m³ with G-books met.

| Hypothesis | Supported if | Contradicted if | Cannot be judged if |
|---|---|---|---|
| **P1** open outfall explains T2-C | NONE closes at N = 4, 16, 32 (and N = 1); seal flux 0 | an offset at any N with seal flux 0: the closed representation does not conserve | G-books fails (IR-definition) |
| **P2a** link storage at end-node areas | offset of T2-C's sign at N = 1 and 4, smaller at 16 and 32, each successive difference beyond the combined C_fn and D3 spreads | no offset at N = 1 and 4 | N = 4 used for a fill-time attribution (not permitted) |
| **P2b** junction minimum area | no offset at N = 1; an offset from N = 16 to 32 within the J2 bound (1.8 / 8.9 / 18.3 m³), smaller in msa0.1 | offsets that do not respond to msa0.1, or that exceed the J2 bound | msa0.1 diagnostic invalid |
| **P3** F1 excluded | guards < 0.9 D | a guard exceeded: invalid setup | — |
| **P4** limiter | \|Δ_N\| beyond C_fn,BOTH + C_fn,NONE + both D3 spreads, and/or a D4 residual under BOTH absent under NONE | — ("no detectable difference" is not equivalence) | either arm's books IR-definition |
| **Imbalance** | not scorable (section 4.3): a mean head difference E4 does not explain appears as R_U > 0.15 mm (IR-reference), and is reported with its residual profile. Under NONE it is read alongside the BOTH residual (P4) | — (the uniformity row cannot Fail) | G-uniformity fails (IR-motion); Froude or depth fails (IR-reference) |
| **Drift** | stationarity Failed, or W5 fails | — | — |

**Outcome classes, never merged:**

| Class | Meaning |
|---|---|
| **IR-motion** | the recorded motion is too large for that row's allowance: the physical oscillation had not decayed enough |
| **IR-drift** | the mean level was still moving beyond what the motion and the book drift explain |
| **IR-redistribution** | the measured junction redistribution and remainder exceed the level allowance |
| **IR-reference** | the uniformity row, where a condition of the source correspondence (Froude ≤ 0.5, depth) fails or the residual R_U exceeds 0.15 mm. Covers both a persistent imbalance and a SWMM departure from E4, not separated |
| **IR-definition** | the closure would depend on the choice of representation volume, or a depth lies outside [0.1·D, 0.9·D] (G-depth) |
| **Failed** | a genuine representation-volume closure, stationarity or level violation with its gates met. Uniformity has no Failed status (section 4.3) |

IR-imbalance (draft 3) is retired.

**Throughout:**
- NONE and BOTH are separate findings.
- Every statement is limited to the representation volume, this configuration and the end state.
- T2-C's registered Failed rows stay Failed.

## 10. What run 1 does and does not tell us (unchanged in substance)

**Still applicable:**
- the F10 source facts;
- F11's mode structure, which is evidence that the motion is the lumped seiche and that E4's terms are the relevant ones;
- the stepping, V1–V4, the guards, the seal, getter-420 equality and R4, carried by construction and re-checked;
- that 12 h is too short for the instantaneous definition;
- the feasibility note in section 8.

**Not usable:**
- any closure, level, uniformity, drift or D4-type value from run 1 (BOTH, instantaneous, in motion);
- the limiter's effect;
- any N trend;
- run 1's decay rates as a prediction for NONE;
- whether the draft-3 gates will be met at 48 h.

Run 1 stands as recorded: 19 Passed and 8 Insufficient reference data.

## 11. Status of each conclusion

| Conclusion | Status | Basis |
|---|---|---|
| V_in = 180 m³, h_eq, T_ref of the reference network | **mathematically bounded** (exact, from declared inputs) | E1, E9, E10; derive.mjs |
| The fundamental is the longest period of the reference network | **mathematically bounded** | generalised eigenproblem (K, S) |
| SWMM's longest period is within ε of T_ref | **assumed, not needed** | model form unbounded; D2 checks the T1 − T2 fundamental only |
| Representation-volume reading differs from trapezoidal or midpoint by ≤ C_fn | **mathematically bounded** under G-depth | quadrature lemma, 3.4; W′ over each segment's recorded range at each step |
| W′ is bounded on the recorded range | **checked** at run time (G-depth, [0.1·D, 0.9·D], max\|W′\| 2.667); otherwise no allowance is computed | 3.4 |
| A conserving representation gives \|⟨V_b⟩ − V_in\| ≤ C_fn at any phase or modal content | **mathematically bounded** | 3.5 |
| The closure row tests the physical volume in motion | **not claimed**; physical volume shown untestable at this criterion | 3.2; D5 |
| Monotone surface between nodes (R3') | **not verifiable; no longer used** | 3.2 |
| Envelope class: \|η − η_lin\| ≤ 2·a_env | **mathematically bounded** (attained) | 3.2(a) |
| Mean head difference = P_s if the motion obeys E4's backward-Euler form | **mathematically bounded** (exact identity) | 4.2 |
| U ≤ τ_U + R_U | **mathematically bounded** (identity; no assumption) | 4.3 |
| The uniformity row can Fail | **no**: U ≤ ½·Σ\|M_s\| identically; an imbalance appears as IR-reference | 4.3 |
| SWMM's link update is E4's backward-Euler form at Fr ≤ 0.5, wet ends, not full, zero offsets | **fact from source**, with stated exceptions (lines 255–258, 265, 266, 280–281) | dwflow.c lines 192–240, 331–335 |
| Those conditions hold over the scored windows | **checked** at every segment and step (G-reference (a), (b)) | 4.5 |
| Departures of SWMM's discretisation from E4 | **measured** (r_s, R_U) and **gated** (R_U ≤ 0.15 mm); no longer assumed. Whether 0.15 mm is attainable is **unknown** | 4.4, 4.5 |
| Level identity E7 and the R2 bound | **mathematically bounded** under G-depth | 5.1 |
| The level allowance is independent of E4 and of the residual | **mathematically bounded** (measured redistribution in the exact identity) | 5.2 |
| E4 as a model of water at mm/s (Manning) | **assumed** | declared reference model (F11) |
| Leakage lemma (non-increasing or BV envelope) | **mathematically bounded**; **not used for scoring** | 6.2 |
| Multi-mode leakage bound | **not established**; not used | 6.2 |
| ε components | level and friction **computed**; amplitude a **scaling estimate**; time step an **unbounded estimate**; ε a **tolerance** | 6.3 |
| D3 detects multi-mode leakage | **empirically diagnosed**, with stated blind spots; not a bound | 6.4 |
| Comparability of N = 4, 16, 32 (reference models within 2ε) | **design rule** on the reference models; SWMM's modes **not validated** | segmentationInterpretation |
| A-priori feasibility (sections 3.4, 4.6, 5.2), assuming r_s = 0 | **worst-case calculation**, not a prediction; whether 48 h suffices is **unknown** | derived.json `budgets` |
| Limiter effect detectable via Δ_N and D4 | **empirically diagnosed** | P4 |

## 12. Conditions under which the revised reference is not justified

1. **If the reviewer does not accept the representation volume as the closure reference (R3'').** Then no closure in motion is testable at this criterion (3.2). The books could only be scored at rest, which run 1 shows is not reached in a practical time. Say so; do not force it.
2. **If E4 is not accepted as the reference link model for the motion allowance.** Then the uniformity row has no independent allowance and would have to be reported only. Since draft 3a the level row does not use E4 and is unaffected.
3. **If the reviewer requires a uniformity row that can Fail.** With the residual in the bound it cannot (section 4.3). The alternative is to score R_U itself as a numerical row against a predeclared tolerance (a SWMM-against-E4 consistency test), which would make "Failed" mean that SWMM's mean heads depart from E4, not that the water is physically unbalanced. Draft 3a does not do this; it is put to the reviewer (REVIEW-REQUEST T7).
4. **If a gate is not met at 48 h.** Then the row is Insufficient reference data in its sub-class. That is a result.

Open points for the technical reviewer are in [`REVIEW-REQUEST.md`](REVIEW-REQUEST.md).
