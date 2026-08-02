# The council — five seats and the ship gate

Five read-only judges, each owning a disjoint slice of the rubric. Success is not claimable
without a unanimous council record.

## Why five, and why disjoint

A single critic is systematically blind along whichever axes its model is weak on, **and the
blindness is silent** — the loop converges confidently on the axes it can see and never mentions
the others. Five seats with disjoint jurisdictions convert a silent blind spot into an observable
disagreement.

Jurisdictions are disjoint so that no row is graded twice and no row is graded by nobody. A seat
that wants to raise something outside its jurisdiction uses the **unclassified channel** (below) —
it does not file a defect.

| Seat | File | Judges | Evidence it receives |
|---|---|---|---|
| VISUAL | `agents/council/visual.md` | Composition, value structure, contrast budget, edge density, colour harmony, silhouette readability, material read, art-direction coherence | Still frames, composed frames |
| MOTION | `agents/council/motion.md` | Temporal artifacts (crawl, shimmer, popping, seams), animation quality, transitions, camera behaviour | Contact sheets, temporal diff maps **only** |
| SYSTEMS | `agents/council/systems.md` | Correctness, determinism, crash-free rate, state integrity, save/load, regression on goldens | Replay traces, logs, ledger state |
| PERFORMANCE | `agents/council/performance.md` | Frametime p50/p95/p99, long-frame count, draw calls, memory, boot time, input-to-visible latency — **on `{{MIN_SPEC}}`** | Telemetry |
| EXPERIENCE | `agents/council/experience.md` | Content completeness, onboarding, difficulty curve, session-completion under scripted play, accessibility floor, settings/remapping, audio mix | Telemetry, replays, content manifest |

MOTION is **mandatory** whenever motion is in scope. PERFORMANCE never reports a mean FPS.

---

## Structural requirements

These are properties of the mechanism, not requests made of a model.

**Forked context, read-only allowlist.** Every seat runs with `context: fork` and a read-only tool
allowlist. Source-blindness is a structural fact, not an aspiration.

**What a seat never receives:** source code · technique names · the builder's rationale · prior
critique transcripts · the pass number. Withholding technique names is load-bearing — see the
technique-leak rule in `RUBRIC.md`.

**The verdict type has no approval verb.** A seat cannot emit "looks good", "approved", or an
overall impression, because the record has no field for one:

```json
{
  "seat": "visual",
  "row_verdicts": [
    { "row": "VIS-04", "verdict": "PASS", "evidence_ref": "evidence/pass-7/cam-02_t1440.png" }
  ],
  "defects": [
    {
      "id": "VIS-11",
      "rubric_row": "VIS-06",
      "severity": "MAJOR",
      "observed": "Foreground and midground share a value band; the character silhouette merges with the wall at 1/8 scale",
      "expected": "Character silhouette separable at 1/8 scale against every background in the moment set",
      "evidence_ref": "evidence/pass-7/cam-05_t0960.png"
    }
  ],
  "unclassified": []
}
```

This is what lets FORGE **delete** "be harsh" and "does not approve work to be polite". Behavior
becomes a property of the type. Drift lives in adjectives; there are none here.

**Every verdict cites evidence.** A row verdict without an `evidence_ref` pointing at a real
artifact is not a verdict and is discarded by the driver.

**Severity.**

| Severity | Meaning | Gates a loop? |
|---|---|---|
| BLOCKER | Artifact is broken, unshippable, or actively misleads | Yes — fixed first |
| MAJOR | A stated property is absent, unenforceable, or contradicted | Yes |
| MINOR | Polish | **Never** — batches to a polish milestone |

Each seat's severity ceiling is declared in its own file. A seat may not exceed it.

**The unclassified channel.** Bounded. A seat writes an observation outside its jurisdiction here.
On **second recurrence** the observation forces a rubric amendment, which must carry a reason and
the two findings that forced it. Amendments land **only at wave boundaries** — never mid-converge.
Without this a frozen rubric becomes either a lie (silently edited) or a straitjacket (genuine
defects unnameable).

---

## The ship gate

The rubric that must be hit to claim success. Every clause is arithmetic or a count. `/forge:ship`
computes it; no agent asserts it.

| # | Condition | Threshold |
|---|---|---|
| G1 | Unanimous PASS from all five seats on every row they own, each citing an evidence artifact id | 5/5 seats, 100% of applicable rows |
| G2 | Open BLOCKERs | **0** |
| G3 | Open MAJORs | ≤ 3, and none in `systems` or `performance` |
| G4 | Weighted attainment = Σ(weight of passing rows) ÷ Σ(weight of applicable rows) | **≥ 0.95** |
| G5 | Per-axis floor — no axis may be carried by another | visual ≥ 0.90 · motion ≥ 0.90 · systems ≥ **1.00** · performance ≥ **1.00** · experience ≥ 0.95 |
| G6 | Goldens show no regression on out-of-scope rows | 0 regressions |
| G7 | Determinism self-test | green |
| G8 | Held-out capture set evaluated at the gate; delta vs public set | ≤ 0.05 — **a widening overfit delta is itself a BLOCKER** |
| G9 | Crash-free rate over the replay suite, on `{{MIN_SPEC}}` | ≥ 0.995 |
| G10 | Human sign-off rows | signed — **the council cannot grant these** |

**G5 exists because a beautiful frame must not launder a failing system.** `systems` and
`performance` floors are 1.00: there is no such thing as an acceptable crash rate or a partially
met performance budget at gold.

**G8 is the anti-reward-hacking clause.** The reward is a PNG, not the artifact, and a fixed,
finite, *known* set of camera poses is an overfittable target. The held-out set is never shown to
builders and is sampled only here. If quality on the private set diverges from the public set, the
loop has been optimizing the instrument.

### G10 — what the council structurally cannot grant

Two rows require a human signature. The council must state in its output that it cannot sign them:

| Row | Question | Who signs |
|---|---|---|
| `HUM-01` | Is it fun? | Human, after playing an unassisted session |
| `HUM-02` | Does the art direction cohere across the full content set, not just the showcase moments? | Human, after reviewing the content sweep |

No amount of rubric machinery closes these. Any document claiming otherwise is lying.

---

## Resolution rules

**Disagreement between seats.** Jurisdictions are disjoint, so two seats cannot contradict each
other on the same row by construction. Where a *composed-frame* finding conflicts with an
*isolation* finding, the composed-frame finding **outranks** it, and it routes to the integrator —
composite defects map to no single owner.

**Budget exhaustion.** Status is written, the run continues, and honest attainment is reported
with failing rows named and open defect ids attached. Budget exhaustion is a first-class,
non-shameful outcome — it is the mechanism that makes an honest "this is at 78%" possible.

**Refusal.** `/forge:ship` refuses to emit a PASS record if any precondition is unmet, and prints
the attainment table instead. A refusal is a normal output, not an error.

**The naming rule.** No agent may claim *shipped*, *done*, or *complete* without a council record
id. Prose without a record id is deleted before emit.

---

## Convening the council

The council is convened by `/forge:ship` (full gate) and, per-pass, by `/forge:converge` (scoped to
the rows in play). Seats are **agents, not commands** — exposing a seat as a user command invites
exactly the failure it exists to prevent: someone running a critique with no rubric in scope.

Seats run in parallel. This is where concurrency belongs: critique is read-only against one frozen
build, and is embarrassingly parallel — unlike the write axis, which is maximally coupled.

---

## Dogfood pass — first council convening (`pass-1`)

All five seats convened on FORGE itself, against the design brief as the pinned rubric. Files
frozen for the duration; no edits were made while seats were reading.

**Result: FORGE fails its own ship gate.** G1 (unanimous PASS) fails; G2 (zero open BLOCKERs)
fails with 8. Row attainment 17/36 = **0.47**, against a 0.95 floor.

| Seat | Rows PASS / FAIL | Blockers | Majors | Minors |
|---|---|---|---|---|
| visual | 1 / 5 | 1 | 7 | 4 |
| motion | 3 / 4 | 1 | 7 | 2 |
| systems | 5 / 4 | 1 | 18 | 5 |
| performance | 6 / 1 | 1 | 4 | 3 |
| experience | 2 / 5 | 4 | 9 | 5 |
| **total** | **17 / 19** | **8** | **45** | **19** |

### Blockers — all open

| id | Finding |
|---|---|
| `EXP-04` | The Quickstart has no step for Phase 5 CONTENT or Phase 6 HARDEN. FORGE's only end-to-end procedure terminates at a vertical slice — the precise failure it was written to fix. |
| `EXP-03` | "Build the harness before anything else" is declared uneditable, yet Phase 1 precedes Phase 2, Phase 1's exit gate requires a harness capture, and Phase 2's entry requires Phase 1 green. Three mutually exclusive orderings, and the capture crosses a write set. |
| `EXP-02` | The three commands are the entire product surface and none exist. No plugin manifest, no install procedure. |
| `EXP-01` / `VIS-01` | The file map presents nine unwritten artifacts as shipped, with no status marker. Quickstart step 1 points at an absent path. |
| `PERF-01` | 13 of 50 rubric rows declare a mechanical instrument with a judge-only threshold. High-variance rows under hard axis floors flip between passes → reopen ids → trip the oscillation freeze. **The default rubric is a non-termination generator.** |
| `MOT-01` | `MOT-06`/`MOT-08` are motion-seat rows with `instrument: replay`, which the motion seat is forbidden to receive. Any project with a dynamic camera has an unsatisfiable exit predicate. |
| `SYS-01` | G1's 100%-PASS requirement makes G3, G4, G5 and the entire `meta` block unreachable branches. |
| *(unfiled, systems jurisdiction)* | `templates/rubric.yaml` is **not valid YAML** — `ScannerError` line 29. The `axis: x; seat: y` compact form is used on all 50 rows. Independently verified. |

### Defect classes, ranked by breadth

1. **Seat/instrument mismatch** — three of five seats are assigned rows whose evidence they are
   structurally denied (`MOT-01`, `SYS-10`/`11`/`12`, `VIS-03`). Fix belongs in `/forge:goal` as a
   validity check: a row's `instrument` must be in its `seat`'s evidence set.
2. **Partition table is not a partition** — it contains no globs, only domain vocabulary, in the
   file that indicts domain vocabulary (`SYS-06`). Camera and character animation are owned by
   nobody while being graded (`SYS-05`); settings/input/accessibility have three owners
   (`SYS-02`); quality tiers are owned outside the render pipeline that contains them (`SYS-03`).
3. **Gate arithmetic partly inert** — independently derived by `performance` and `systems`.
4. **Self-contradiction between doctrine and instance** — the technique-leak rule is violated by
   three rubric statements in the file that states it (`VIS-06`), and is unenforceable as written
   because lint rows must name techniques (`VIS-07`). The pass number is denied to seats and
   transmitted in every evidence path (`SYS-08`).
5. **Named-but-unbuilt mechanisms** — ledger status lifecycle (`MOT-07`), compaction defense
   absent from the protocol (`MOT-09`), run budget undefined (`MOT-10`, `PERF-04`),
   feel-by-shortlist unspecified (`EXP-12`), `{{ACCESSIBILITY_FLOOR}}` inert (`EXP-13`).

### Refuted: none

No seat finding was refuted on this pass.

### Honest statement of what remains open

All 72 defects are open. No remediation has been applied. The three mechanisms that survived
adversarial reading intact are the **no-approval-verb verdict type**, the **determinism and
base-sha discipline**, and **attainment as driver arithmetic** — each affirmed by the systems seat
with evidence references.

The provenance claims in `README.md` ("three multi-agent evaluation panels (18 agents)") are
**unfalsifiable from this repository** (`EXP-11`). FORGE's citation rule is scoped to seat verdicts
and completion claims, so this is not a literal violation — but the exemption exists only because
no shipped file extends the rule to its own documentation, and that number is the load-bearing
authority claim for every mechanism here. Either cite artifacts or delete the claim.
