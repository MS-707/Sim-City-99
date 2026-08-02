# The crew — nine roles, partitioned by write set

## Doctrine

**Roles are partitioned by write set, never by domain vocabulary.**

The original viral prompt named seven subsystems drawn from domain words — water shaders,
cel+outline pipeline, physics, AI, characters, HUD+camera+audio, performance. All but HUD co-own
either the render pipeline or the simulation state. Water displacement and the outline pass
literally occupy ordered slots in *one* post stack, tuned against *one* composited image. That is
not a seam to be arbitrated; it is shared ownership of one artifact.

Two consequences follow, and both are load-bearing:

**1. The render pipeline has exactly one owner.** Displacement, toon/cel lighting, outlines, the
post stack and sky are a single write set held by `render-engineer`. Splitting them is the
original prompt's fatal error.

**2. There is no performance agent.** Performance is an invariant over everyone else's code. As a
peer agent it either does nothing all wave, or arrives at merge time and rewrites six agents' work
— invalidating every critic verdict already paid for. **Performance is a gate; every builder
carries a budget line.**

### Lost writes, not merge conflicts

On a shared filesystem, concurrent writers do not produce merge conflicts. They produce **lost
writes**: A reads a file, B writes it, A writes back its stale buffer. Git's conflict machinery
never engages because there was never a second commit. The failure is silent and surfaces rounds
later as a regression nobody can trace.

Therefore: **every builder works in its own git worktree**, and every capture is stamped with its
base sha. Worktrees protect *code* integrity; base-sha stamping protects *evidence* integrity.
They are different failure classes. Ship both.

---

## The nine roles

| Role | Owns (write set) | Budget line | Graded by |
|---|---|---|---|
| `architect` | The contract table + the walking skeleton | Skeleton boots < 2s | systems |
| `harness-engineer` | The entire harness, exclusively | Capture pass < 90s | systems, performance |
| `simulation-engineer` | Core loop, fixed timestep, physics, determinism | Sim step ≤ 4ms | systems, motion |
| `render-engineer` | **The whole render pipeline** — displacement, lighting, outlines, post stack, sky | ≤ 60% of frame budget, ≤ draw-call ceiling | visual, motion, performance |
| `content-engineer` | Procedural meshes, textures, audio synthesis, level data | Asset gen ≤ 1.5s at boot | visual, experience |
| `systems-engineer` | Game logic, AI, progression, state machines, save/load | Logic ≤ 2ms | systems, experience |
| `interface-engineer` | HUD, menus, settings, input mapping, accessibility surface | UI ≤ 1.5ms | visual, experience |
| `hardening-engineer` | Robustness, platform edges, min-spec, error recovery | Boot ≤ 4s on min spec | performance, experience |
| `integrator` | Merges, the composed frame, cross-subsystem defects | — | all seats |

---

## Every charter contains

Each `crew/<role>.md` is a subagent definition (YAML frontmatter + body) carrying:

- **Owned globs** (disjoint) and **forbidden globs**
- **Budget line** — the resource ceiling this role carries
- **Interfaces** exported and consumed
- **Acceptance check** — build green + isolation captures produced + lints pass, before handoff
- **Abort behavior** — on timeout, revert to stub; coordinator takes over
- **Evidence to produce** for the seats that grade it
- **Grading seats**, named
- **Worktree isolation + base-sha stamping** on every capture

**The ownership rule, verbatim in every charter:**

> Never edit a file you do not own. To change an interface, halt the wave, amend the contract
> table, resume.

---

## Role notes that matter

**`architect`** emits the `subsystem | owned globs | forbidden globs | public interface | budget
line | grading seat` table, then compiles the **walking skeleton**: everything stubbed, every
interface exporting its agreed signature, app boots, harness captures a gray frame. *Fan out never
happens from a document* — a compile-checked contract cannot be divergently interpreted; a prose
one always is.

**`harness-engineer`** is the sole owner of the harness and the only role whose output gates every
other role. It implements CAPTURE / DRIVE / MEASURE / LINT, plus:
- the **double-capture determinism self-test**, which refuses all visual verdicts until green
- the **anti-reward-hacking grep** — build fails if any code path branches on a
  headless/capture/screenshot flag
- the **held-out reserved capture subset**, never shown to builders, sampled only at gates
- **replay, telemetry, and offline audio rendering** — the three channels that carry a project
  past a vertical slice

The harness is **version-locked** during a convergence run. A changed instrument invalidates the
whole comparison series.

**`hardening-engineer`** owns what determines whether the thing ships at all: window resize, focus
loss, graphics-context loss, device change, boot time, error recovery, min-spec quality tiers —
and the accessibility floor (colorblind-safe verification, motion/shake toggle, remappable input,
text scale, audio-cue redundancy).

**`integrator`** holds merge order and conflict authority, and owns the **composed frame**.
Composed-frame findings **outrank** isolation findings when they conflict, because a defect that
exists only in the composite maps to no single owner. This is the film-mix problem: it needs one
engineer, not a committee of specialists each optimizing their own stem.

---

## Wave protocol

1. Contract table is current and the build is green.
2. Fan out **3–4 concurrent writers**, strictly disjoint globs, each in its own worktree.
3. Each writer runs to its acceptance check or its timeout.
4. `integrator` merges in declared order, then captures the **composed** frame set.
5. Automated gates run. Then `/forge:converge` convenes the seats.
6. Commit after every green iteration — a crash then loses only in-flight work.

Each wave **re-validates the contract**, so no agent drifts against a stale architecture.

### Builder brief template

```
ROLE:            <role>
MILESTONE:       <slice|alpha|content|beta|rc>
OWNED GLOBS:     <patterns>
FORBIDDEN GLOBS: everything else
BUDGET LINE:     <ms/frame | draws | MB>
RUBRIC ROWS:     <ids you are being graded against — statements only, no technique names>
CAPTURES DUE:    <moment ids from capture-spec.json>
ACCEPTANCE:      build green + captures produced + lints pass
TIMEOUT:         <n> — on expiry revert to stub and hand back
BASE SHA:        <sha> — stamp every capture with it
```

---

## Editor-in-the-loop engines (Unity)

The editor is a lockfile-enforced **singleton**, so verification cannot parallelize. The rule is
**parallel authoring, serialized verification**:

- Writers author text in parallel — assembly-scoped C#, shaders, UI markup, DSP code.
- A single **editor-operator lane** applies batched edits → one compile → one play-mode entry →
  capture → console read.
- Batch N edits into **one** compile and **one** verify. Never edit-verify per file.
- Order iterations **shader-first**: shader-only edits skip domain reload and run at near-web
  cadence, and most visual convergence is shader work.
- Scenes are defined in code from an empty-scene bootstrap. Agents never hand-edit binary or YAML
  scene serialization.
- "Editor unreachable" is a **first-class recoverable state**, not a crash.

See `../templates/adapters/unity.md` for the full adapter.
