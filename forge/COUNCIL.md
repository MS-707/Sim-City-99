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
