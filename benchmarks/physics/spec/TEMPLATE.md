# Benchmark specification template

Each benchmark has one `<ID>.json` holding the fields below. `run.mjs` refuses a spec in either of two cases:
- a field is missing, or a parameter has no unit;
- its criteria hash does not match its latest `criteriaRevisions` entry.

| Field | Content |
|---|---|
| `id`, `title` | e.g. `PV-U1`, "Uniform open-channel flow" |
| `category` | reference / solver / convergence / conservation / integration / validation / selftest |
| `process` | the physical process tested |
| `module`, `executor` | the benchmark script (relative to `benchmarks/physics/`); `node` or `browser` |
| `dependsOn` | other specs it reuses (optional) |
| `equations` | the governing equations, as text |
| `initialConditions`, `boundaryConditions` | as text, with values |
| `geometry` | dimensions and materials |
| `parameters` | `{ name: { value, unit } }`: every number the case uses |
| `solver` | engine, routing, step, surcharge, grid, options |
| `reference` | `module`, `functions`, published `sources`, `independence` (why it does not share the solver's code or assumptions), `crossCheck` (its second method) |
| `outputs` | the quantities scored |
| `criteria` | absolute and relative per output, conservation and steady-state limits: **the hashed object** |
| `criteriaNotes` | why each criterion is what it is |
| `conservation` | the mass or volume check |
| `resolution` | grid, segments, step |
| `assumptions`, `limitations` | lists; every known way the case can mislead |
| `validRange` | the conditions it covers, and nothing beyond |
| `scoring` | how rows are scored (automated) |
| `criteriaRevisions` | `[{ revision, date, hash, why }]`; a new criteria object needs a new entry, and the old results stay as they were |
| `definitionRevisions` | `[{ date, why }]`: any change to the setup after registration (optional, but required when it happens) |

**Error types.** Every scored row is exactly one of:
- **numerical:** the solver against an exact solution of the same equations;
- **physical-model:** the equations against physics they omit;
- **accounting:** volume books and continuity.

**Statuses.** Passed, Failed, Qualified, Unsupported, Not independently validated, Numerically unstable, Insufficient
reference data, Invalid setup.

**Pre-registration.** Run `node benchmarks/physics/run.mjs --hash` and write the hash into the first revision entry
**before the first run**.

**Narrative.** Milestone 1 keeps each benchmark's narrative in the spec's text fields and in `../README.md`, rather than
in a separate `<ID>.md` as `docs/specs/physics-verification.md` §2.2 proposed. That is one file fewer per benchmark;
it can be split out later.
