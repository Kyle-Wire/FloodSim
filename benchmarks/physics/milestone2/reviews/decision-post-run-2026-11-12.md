# Technical review decision after the PV-TF1 run 1 post-run analysis (received 12 Nov 2026)

Filed as received, in substance. The response is the proposal in `../pv-tf1-r2/`.

**Decision**
- The post-run analysis and its findings (F10, F11) are accepted.
- Run 1 remains unchanged: 19 Passed, 8 Insufficient reference data. No status is to be revised.
- The original at-rest design is not suitable for further execution. The original run is not to be extended.

**Direction for a new PV-TF1 registration**
1. **Cycle-averaged equilibrium.** Propose an alternative to the instantaneous rest definition. Investigate:
   - averaging over integer numbers of independently calculated seiche periods;
   - cycle-averaged tank volumes and water surfaces;
   - cycle-averaged junction and conduit storage;
   - a separately defined maximum oscillation-amplitude bound;
   - a secular-drift condition across successive windows;
   - a mass-balance closure that stays independently testable.

   The definition must distinguish a bounded natural oscillation from a persistent hydraulic imbalance or continuing
   drift. The windows are based on the independently derived linear periods, and N = 1 keeps its separate
   rigid-column reference period. Tolerances are not to be fitted to run 1: they must be physically and numerically
   justified, derived in writing, and submitted for independent review.
2. **Remove the nominal-slope confounder.** The primary configuration uses NORMAL_FLOW_LIMITED NONE, with BOTH kept as a
   paired diagnostic to quantify the limiter's effect on fill-time storage. NONE and BOTH are not to be assumed
   equivalent.
3. **Segmentation interpretation.** N = 1 is a separate two-node dynamic system. N = 4, 16 and 32 form the primary
   comparison, with N = 1 kept as a separate reference case. They are not to be combined into one linear trend without
   showing that the dynamic systems are comparable.
4. **Integrity.**
   - Preserve the original registration and run 1's artifacts.
   - Do not revise run 1's criteria or statuses.
   - Do not modify production code or SWMM.
   - Do not start PV-RV1.
   - Do not run the revised experiment.
   - Do not hash, register or freeze the proposal before independent review.
5. **Deliverables:**
   1. a proposed revised registration;
   2. the derivation of the cycle-averaged reference;
   3. the tolerances and their independent justification;
   4. the paired NONE/BOTH matrix;
   5. the expected interpretation of each hypothesis;
   6. which run 1 findings remain applicable and which cannot be used to infer the outcome.

   If the cycle-averaged reference cannot be justified independently, say so.
