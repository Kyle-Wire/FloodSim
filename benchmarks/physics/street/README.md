# Street sandbox (PV-SS1 … PV-SS9)

Made-up street cases whose answers are known before the model runs: by hand arithmetic, a closed form, or a second
calculation that shares nothing with the solver. Registered 17 Nov 2026 at Kyle's instruction, as its own family of
the physics suite.

**Status: registered, not yet run.** The criteria hashes are in each spec and in
`../spec/REGISTRATION-2026-11-17.sha256`. This page is rewritten with the results once the cases have run.

This family did not go through the three-review process `../milestone2/` sets for PVM2 tests, and it does not touch
PVM2's held items (PV-TF1-R2, PV-RV1, production wiring). Its results are sandbox results. Nothing here is called
validated.

```
node benchmarks/physics/street/score.mjs --expect        every hand answer; reads no result
node benchmarks/physics/street/exec-cpu.mjs --spec PV-SS1   run a spec's cases on the CPU solver → street/raw/<stamp>/
node benchmarks/physics/run.mjs --only PV-SS1,PV-SS2     score the latest raw files → ../results/<run-id>/
```
