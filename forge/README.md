# FORGE

A reusable, engine-parameterized build system for taking a project from nothing to **shippable** —
not to a demo, and not to a screenshot-optimized vertical slice.

FORGE is the distilled output of three multi-agent evaluation panels (18 agents) that dissected a
viral *"build me a AAA cel-shaded boat racing game in Three.js"* mega-prompt. Every mechanism here
is a panel finding, not a preference.

## The theory, in one paragraph

Verify against captured evidence, never against your assumption about what the code does. The
rubric is a **file**, written before the loop and frozen during it, and it is the critic's only
standard — that single artifact fixes termination, the honesty number, critic drift, and the fact
that a forked critic cannot see the coordinator's conversation. Determinism makes two rounds
comparable, so "fixed" and "regressed" mean something. The ledger makes the loop a **ratchet**
instead of a random walk. Everything else is consequence.

## Why the original prompt stops at a slice

Its stop rule — *"loop until the critic runs out of specific defects to name"* — is a property of
the judge's output distribution, not of the artifact. Two states emit an identical signal: the
artifact met the bar, or the critic ran out of ideas. And "be harsh" installs a floor on defect
production, so the same instruction also guarantees non-termination. Premature halt *or* infinite
loop, with nothing controlling which.

Meanwhile a slice fails by **looking** wrong, which a screenshot catches. A shipped product fails
by crashing on someone else's machine, being boring on level 4, or being unplayable for a
colorblind player. The original optimizes the one axis it can measure and is silent on every axis
that determines shipping.

## The three commands

| Command | Role |
|---|---|
| `/forge:goal` | Compiles the rubric from a style brief. Human-run, **before** the autonomous run. Marked `disable-model-invocation` so a builder can never rewrite its own grading standard. Its defining behavior is a **refusal**: it will not emit a rubric row lacking an observable test. |
| `/forge:converge` | The bounded fixpoint driver. Hard precondition refusals; never writes the rubric; re-reads rubric + ledger head every pass. |
| `/forge:ship` | Convenes the five-seat council against the ship gate and emits a signed record — or refuses, and prints the honest attainment table instead. |

Exactly three, because every enabled skill's name and description is charged against the system
prompt **on every turn** of a long run. Namespaced as a plugin because the bundled interval
scheduler round-trips the literal string `/loop <input>` through itself as a re-entry token —
shadowing it breaks *hours* into an unattended run, which is precisely the mode FORGE exists for.

**Nothing in FORGE is ever named `loop`.**

## File map

```
forge/
├── README.md                      you are here
├── PROMPT.md                      the master prompt — slots, phases, milestones, protocol
├── RUBRIC.md                      row schema, compilation, amendments, attainment arithmetic
├── COUNCIL.md                     the five seats and the ship gate
├── agents/
│   ├── CREW.md                    write-set doctrine, wave protocol, the nine roles
│   ├── crew/                      role charters (subagent definitions)
│   └── council/                   the five seats (subagent definitions)
├── templates/
│   ├── rubric.yaml                the default shippability rubric (~50 rows, 5 axes)
│   ├── capture-spec.json          determinism + the enumerated evidence set
│   ├── ledger.schema.json         the append-only defect record
│   ├── architecture-contract.md   the write-set partition table
│   ├── technique-ledger.md        technique → observable property
│   ├── non-goals.md               so a critic cannot invent axes forever
│   └── adapters/                  web.md · unity.md · unreal-deferred.md
├── skills/                        goal/ · converge/ · ship/
└── example/WORKED-EXAMPLE.md      one complete filled-in instance
```

## Quickstart

1. **Pick an adapter.** `templates/adapters/web.md` (Vite + Three.js + Playwright — lowest
   friction, sub-second reload, fully parallel headless) or `unity.md`. Unreal is deferred; the
   seam is documented and honest about why.
2. **Run `/forge:goal`.** Answer the slot interview. It will refuse to write any rubric row you
   cannot test. Expect that, and let it refuse — a rubric of unfalsifiable adjectives is worse
   than no rubric.
3. **Sign off the rubric.** Its git hash is recorded. From here it is frozen; amendments land only
   at wave boundaries and require the two findings that forced them.
4. **Build the walking skeleton.** Everything stubbed, interfaces exporting real signatures, app
   boots, harness captures a gray frame. Fan out from a green build, never from a document.
5. **Build the harness — before any feature work.** It is not done until the double-capture
   determinism self-test passes. Until then it refuses to emit visual verdicts.
6. **Run waves,** 3–4 writers on disjoint globs, each in its own worktree.
7. **Run `/forge:converge`** per subsystem per milestone. Automated gates run before any judge.
8. **Run `/forge:ship`** at RC. Expect refusals; read the attainment table.

## The milestone ladder

Gates measure counts, not screenshots.

| Milestone | Gate |
|---|---|
| prototype | Skeleton green; determinism self-test passes |
| vertical slice | `scope: slice` rows PASS |
| alpha | All systems present; zero open BLOCKERs |
| content complete | `{{CONTENT_SCOPE}}` met; onboarding present |
| beta | Feature freeze; MAJOR count ≤ ceiling; replay suite green |
| RC | Zero blockers; crash-free ≥ 0.995 and perf budget met **on min spec** |
| gold | Ship gate passed with a council record id + human sign-off |

## Honest limits

FORGE **cannot determine**:

- **Whether it is fun.** No rubric, telemetry channel or council seat closes this.
- **Art-direction cohesion at content scale** — the composed-frame problem multiplied by breadth.

Both have dedicated sign-off rows (`HUM-01`, `HUM-02`) that the council is structurally forbidden
from granting. Budget human time for them.

FORGE also cannot see **feel** through any evidence channel it builds. Feel is resolved by
parameter sweeps into a five-candidate shortlist that a human picks from — a bounded selection
problem, not an aesthetic judgment.

What FORGE *does* buy is narrower and worth stating plainly: when the human finally sits down to
play it, they are judging fun rather than tripping over bugs.

## Provenance

Design findings this implements, each from the evaluation panels:

- The rubric-as-file repair, and the four defects it closes at once
- Positive per-row affirmation as the exit predicate — "the critic ran quiet" is not an exit
- Write-set partitioning; lost writes vs merge conflicts; performance as a gate, never an agent
- Parallelism inverted onto the read-only critique axis
- The technique-leak rule — critics receive observable properties, never technique names
- Reward hacking: held-out capture set, headless-flag grep, harness version-lock
- The four slice→shippable additions: new evidence channels, content + hardening milestones,
  feel-by-shortlist, gates-as-counts
