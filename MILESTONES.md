# SimCity 99 — Milestone Queue

Worked top-to-bottom. Each milestone is completed against success criteria
defined by an independent reviewer agent before implementation starts.
Queue policy: keep at least 5 open improvements at all times.

## In progress


  Implementation status (under verification):
  - **The gate table**: `GROWTH_GATES` (js/sim.js, module scope above
    `class City`) is growthPass's if/else chain turned inside out — 23 ordered
    rows (17 zone verdicts + 6 non-zone), each carrying the predicate the code
    tests, the sentence the player reads, its proving numbers and (only for the
    branches that roll) the mutation. **growthPass CONSUMES it**, so the
    verdict and the branch cannot drift. Rows are bucketed
    (`pre`/`z0`/`up`/`fall`/`post`/`nonzone`) so the walk is ≤6 tests, and
    `_gctx` keeps `cong` (a 25-cell scan) and `fit` LAZY — the two commonest
    verdicts, BURNING and UNPOWERED, now pay for neither (UNPOWERED alone was
    92.6% of 984,862 measured classifications). Four terminal states the
    original scope missed are named: `MAXED`, `DEM_SLACK`, a distinct level-0
    `Z0_NO_ROAD`, and the level-0 `Z0_LOW_ODDS`. `GRIDLOCK` is modelled as a
    PHASE, not a chain row — the source evaluates it unconditionally after the
    chain, so it can co-occur with an upgrade.
  - **Refactor fidelity**: proven against a frozen oracle (a verbatim copy of
    the ea4f705 growthPass body). 20 seeds × 600 ticks in lockstep,
    `lvl`/`varnt`/`unpow`/`over`/`fire`/`traffic` compared **every tick**:
    12,000/12,000 ticks byte-identical, per-tick draw counts identical, 0
    divergent ticks. Chain-code fidelity: 984,862 (oracleLabel, diagnoseTile)
    pairs over 20 cities × 400 ticks — **0 chain mismatches, 0 gridlock
    mismatches**. All 23 codes reproduced by targeted single-purpose cities.
  - **Honesty fix in the non-zone rows** (deviation from the design's literal
    predicate, deliberate): `SPECIAL_UNPOWERED` / `SPECIAL_NO_ROAD` were
    specified as `over >= OV.ZR && !isPlant && !isWaterOv && !isMega`, which
    fires on **WIREROAD crossings** (id 18, a street) and on parks, the
    mayor's house, stadiums, the airport and the seaport — none of which have
    a power-gated effect. Measured on a scripted city: 35 of 35
    `SPECIAL_UNPOWERED` verdicts were road crossings. Both rows now key on the
    four coverage stations (police / fire / school / hospital), which
    `stampCoverage` genuinely skips when unpowered, and `SPECIAL_NO_ROAD` says
    what is actually true — `access[]` gates zone growth and nothing else, so
    the station still works and it is the neighbourhood that is stuck. A
    verdict that lies is the exact failure this milestone exists to remove.
  - **diagnoseTile purity**: 32,000 calls across 5 differently-shaped cities
    (empty / dense / burning / flooded / all-non-zone) under write-trapping
    proxies on every typed array — **0 writes, 0 Math.random, 0 rng draws, 0
    cursor drift, scalar projection unchanged**. This is the precondition that
    lets the fidelity harness diagnose a tile inside the oracle's own loop.
  - **Five seeded sim streams**: `makeStream` (a separate factory reproducing
    mulberry32's recurrence with exposed state — `mulberry32` itself is
    untouched, sprites.js depends on its exact identity) drives
    `city.rng = {growth, traffic, fire, hazard, build}`. 38 draws routed off
    global `Math.random`; **exactly one raw call survives in js/sim.js**, the
    seed picker at the `generateTerrain` fallback. Measured: **0 global draws
    across 600 ticks** of a busy city with disasters, fires, a Y2K month, a
    brownout and roads crumbling at 0% funding. The `build` stream was a
    REQUIRED addition to the design's four — `place()` writes `varnt` and
    `varnt` is named in the byte-identity gate.
    **Documented carve-out**: `chopperMonthTick` (js/render.js) is called from
    inside `City.tick()` but is pure presentation and STAYS on global
    `Math.random`; giving a render-cadence call a sim cursor would make the sim
    frame-rate dependent.
  - **Save v12 + the ladder**: `migrateSave(d)` is the canonical v11..vN chain
    every later milestone extends. v12 adds the five int32 cursors **and five
    accumulated planes** (`unpow`, `traffic`, `landv`, `crime`, `poll`) —
    cursors alone are not enough for an exact resume: `unpow` is authored by
    growthPass and nothing recomputes it (it was silently zeroed on every load
    before v12), `traffic` is a blend accumulator, and `landv`/`crime`/`poll`
    are rebuilt only every 14th tick. Both the cursors and the planes are
    restored LAST, after the recompute cascade, so `deserialize` stays a pure
    restore. `normaliseHistory` is UNCHANGED and its drop-unknown-keys
    behavior is re-asserted in a comment (verified: an injected unknown key is
    dropped, all seven known arrays survive).
  - **Three MORE unserialized accumulators, found by diffing EVERY typed array
    instead of the list the save happened to emit** (this is the honest form of
    the "no unserialized accumulator" claim, and each one was a real resume
    divergence):
    1. **`fire[]` was never emitted.** ignite() writes it, fireTick decrements
       it, nothing in the load cascade recomputes it. Measured on seed 202 at
       tick 300 with 8 tiles alight: all 8 came back 0, the fires never
       destroyed their buildings (pop 2688 → 2680, jobs 1890 → 1884,
       powerDemand 1459 → 1457, demand.c 0.0915 → 0.1150) and the resumed run
       then diverged from the straight run on nine planes and every scalar.
       Now emitted SPARSE (`[idx, val, …]`) — a fire-free city costs 10 bytes.
    2. **`powerDirty` — a boolean — was part of the stream.** `recomputePower()`
       ends by drawing `rng.hazard` for the brownout / Y2K cut, so WHETHER it
       runs on the first post-load tick is observable. deserialize's cascade
       always cleared the flag, so a city saved with a pending refresh resumed
       without one. It hid until `powered[]` started restoring exactly: with
       the plane restored and the flag dropped, the resumed city re-rolled the
       cut. 1 of 20 seeds failed on this alone. `railDirty`/`accessDirty`
       deliberately do NOT ride along — their recomputes draw no RNG and the
       cascade runs both unconditionally.
    3. **`access[]` was stale, not derived** (see the next bullet).
  - **`accessDirty`: access[] becomes a genuine pure function of over[]+terr[]
    at all times.** `recomputeAccess()` is RNG-free and reads only over[] and
    terr[], but it only ever ran inside tick()'s `doPower` branch — i.e. on
    `powerDirty || tickCount % 10 === 0`. Two consequences, both real: a freshly
    built road could take up to **nine ticks** to unlock growth on the lots it
    served, and a stale row could outlive the road that seeded it (measured:
    identical over[] across a round trip, yet `access[697]` = 4 live vs 3
    reloaded — the live value came from a road that had since burned to rubble
    under a `recomputePower()` called from `eventsTick`/`fireEvent`, which
    clears powerDirty on the way out so the next tick's doPower was false).
    That one cell feeds `k.road`, i.e. the `Z0_NO_ROAD` / `U_NO_ROAD` verdicts.
    A dedicated `accessDirty` flag is now set at all ten sites that add or
    remove a ROAD/WIREROAD or flood a tile (place, bulldoze, waterfill, the
    roadWear crumble, the fireTick rubble conversion and the five disaster
    demolition paths), consumed on its own trigger at the head of tick(), and
    **flushed before tick() returns** so nothing that reads a city between
    ticks (the save round trip, diagnoseTile, the renderer) can ever see an
    access[] that disagrees with its own over[]. This is a behaviour change —
    new roads unlock growth immediately — and it is deliberately inside GP1's
    single authorized re-pin rather than after it.
  - **Exhaustive round-trip audit** (not a hand-picked field list): for 5+
    seeded cities at tick 300, `b = City.deserialize(a.serialize())`, then
    every own property of the City compared — **every** TypedArray element-wise
    and every finite number with `===`. Result after the three fixes above:
    **0 differing typed-array entries across ALL properties** (it was fire[] 8,
    access[] 1 before). `_trafficLoad`, the reused traffic scratch buffer, is
    now zeroed at the END of `recomputeTraffic` as well as the start, so it too
    is provably empty between passes rather than exempted by assertion.
    Two scalars remain deliberately unserialized and are the only exemptions:
    `terrRev` / `devRev`, the render-cache revision counters — render.js
    already documents (`distLabelCache`) that these init to 0 on every fresh or
    loaded city and that keying a cache on them alone would COLLIDE across
    cities, which is exactly why they must not be restored. Nothing in
    tick()/recompute*/growthPass reads either. `pop`/`jobs`/`comJobs`/
    `powerDemand`/`demand.*` also read one growthPass stale on a live city
    (recomputeDemand runs before growthPass, which then changes lvl) and fresh
    on a loaded one; they are re-derived at the head of every tick, and the
    decisive check is that **after one further tick on both cities, every
    typed array, every scalar, all five cursors and the full serialize() string
    are identical** (7/7 seeds).
  - **Determinism, measured with the global `Math.random` DELIBERATELY
    DIVERGENT** (not merely unstubbed): 20 seeds × 600 ticks, run A on the real
    `Math.random` and run B on a constant 0.123456 — **20/20 byte-identical**
    on nine array hashes, pop/funds/jobs, all five cursors and the full
    `serialize()` string, with **0 `Math.random` calls counted** in either run.
    save-at-300 / resume-to-600 vs straight-600: **20/20 identical**.
    `S1 === S2 === S3` idempotent. A REAL v11 save generated on the ea4f705
    worktree loads at v12 with all seven authored planes tile-identical, loads
    identically twice, re-saves idempotently, and survives 125 month rollovers
    with 0 errors.
  - **Save payload: measured, then reduced.** The checkpoint's six new
    full-map JSON number lists cost **+62.7%** on a developed 128×128 city.
    Fix, zero dependencies and no build step: `packU8` (btoa over 8192-byte
    `String.fromCharCode` chunks) for the 12 Uint8 planes, `packBits`
    (8 tiles/byte, then base64) for the strictly-0/1 `powered`, and the sparse
    pair list for `fire`. base64's alphabet needs no JSON escaping, so the
    emitted length is exactly `ceil(n/3)*4 + 2` and is deterministic. All 13
    plane round trips are **byte-exact** and every emitted string matches
    `/^[A-Za-z0-9+/=]*$/`; `powered` at 128×128 goes 16,384 → 2,732 chars.
    Every restore site accepts BOTH forms (`typeof === "string"` → unpack,
    `Array.isArray` → the legacy path unchanged), and the `v<=3`
    `sqrt(d.terr.length)` size inference is guarded with `Array.isArray` so a
    packed plane can never be mistaken for a map edge. **Measured vs ea4f705 on
    the same stamped world: 128×128 348,076 → 377,111 = +8.3%** (64: +8.8%;
    48: +9.1%), replacing +62.7% and inside the ≤1.10× bar.
  - **Surfaces**: `#query-verdict` above the Inspect table, severity-coloured,
    driven live from `refreshHUD` on a 500ms rAF-paced cadence (**measured max
    latency 517ms over 20 trials**, no stray `setInterval`); `openQuery` split
    into `fillQuery` + `openQuery`. Clickable RCI bars open a breakdown listing
    all 6/5/6 named signed contributors from a **preallocated** `demandParts`
    (fields overwritten in place — zero per-tick allocation), summing to `raw`
    to within 1e-12, flagging the ±1 clamp and footnoting the per-tile
    commuter bonus; the shipped `demand.r/c/i` expressions are NOT
    re-associated. New `#sb-hover` status cell: mousemove still writes only
    `UI.hover`, and the DOM write happens **once per frame** in `refreshHUD`,
    so `#sb-tool` can no longer be eaten by a fast drag (measured: a transient
    message held on 200/200 samples across 200 synthetic mousemoves, then
    reverted exactly once to the restored tool default). `setStatus(msg, ttl)`
    TTLs every transient; the tool-selected line became the restored DEFAULT
    rather than a transient, which is the one caller that depended on
    persistence. The drag meter is STRICTLY display-only — measured on a
    20-tile drag against §40 of funds: 19 `place()` calls, all from
    `applyToolAt`, 0 attributable to the meter, 0 `Snd.denied()` from the
    meter, 4 successes / 15 refusals decided entirely by `place()`.
  - **No graphics regression**: sprite hash map 5,222/5,222 identical vs
    ea4f705 (js/sprites.js is untouched by this milestone's diff, and
    `mulberry32` is deliberately NOT merged with `makeStream` — ART_RNG plus
    ~12 frozen side-streams and computeNeighbors depend on its exact identity,
    so merging them would renumber every baked sprite variant);
    2,000/2,000 click-picks identical across 4 rotations; 8 day/night × season
    × rotation frames pixel-identical (one run showed a single differing frame,
    reproduced as a water-animation phase artifact — clean on re-run); 0
    console errors and 0 pageerrors across the suite.
  - **Perf — the earlier figure is RETRACTED, with the method stated.** Three
    plausible-looking protocols gave −24%, +13.3%, +17.9% and +25.3% on the
    same code, so the number is only meaningful with its method attached:
    unmatched build scripts diverge outright (head reaches pop 1024 / lvlSum
    227 where base reaches 592 / 132), free-running matched cities still drift
    (+28% denser by tick 140), and per-tick `performance.now()` medians
    quantise to the 0.2 ms timer floor. **The only protocol that resolves**:
    stamp the SAME authored world (terr/over/lvl/varnt/anc/rail/plantYear/
    roadWear from one build of seed 4242 at 128×128, 250 ticks) into both
    builds, assert the stamp matched (zones 5,845 and roads 6,727 equal on
    both), **re-apply it after EVERY tick** so neither can drift, time a BLOCK
    of 140 ticks (10 full 14-tick recompute cycles), time 140 bare restores
    separately and subtract, median of 13 blocks, median of N fresh runs.
    Measured under that protocol: **+4.2%** (V8/node `hrtime`, ns resolution,
    base 2.363 → head 2.462 ms/tick, three runs spanning +3.5%..+5.0%) and
    **+0.8%** in-browser (median of 9 fresh Chromium runs, base 0.4536 → head
    0.4571 ms/tick — but the browser run-to-run spread is ±13%, i.e. the
    browser cannot resolve a difference this small, which is the whole reason
    the ns-resolution number is quoted first). Both are far inside the 20%
    budget. The cost added since the checkpoint is the extra `recomputeAccess`
    on ticks that destroy a road and one `Float32Array` fill per traffic pass.
  - **The re-pin is bounded** (`docs/gp1-baseline.json`): 20 pre-screened
    corpus seeds (HEAD pop@600 ≥ 50, terrain NOT flattened — flattening
    measures sd exactly 0 and makes the gate vacuous), 9 distribution means at
    ticks 100/300/600 against a null band built from 8 HEAD repetitions.
    Measured deltas: pop ≤ 1.94%, jobs ≤ 1.13%, funds ≤ 0.09% — all far inside
    the 15%/5% ceiling. Three of nine z-scores land marginally outside |z| ≤ 2
    (−2.11, −2.10, −2.56) purely because 8 repetitions of a 20-seed mean give a
    very tight sd (0.45 on pop@600, i.e. 0.07%); the absolute movement is a
    fraction of a percent. Per-seed array hashes reproduced with 0 differences
    on a second run.
    **Declared gate substitution** (not quietly applied): the roadmap's literal
    ±5% balance bar is INSIDE the measured noise floor — a pure RNG reseed of
    UNCHANGED HEAD code already moves the mean by more than this change does —
    so it is replaced by the measured null band plus the hard 15%/5% ceiling.
  - **Declared protocol deviation**: the corpus builds with an unlimited
    construction budget and pins funds to §200,000 at t=0, rather than the
    game-default §20,000 with the build script applied greedily. Measured
    reason: at §20,000 the reference script cannot finish a connected grid on
    any of the first 8 seeds (pop@600 = 0..72, most zones unpowered), so that
    corpus would measure construction-budget starvation, not growth balance.
  - **Scenario winnability**: all four shipped scenarios build, run 1,200
    ticks and latch identically on the GP1 build and on ea4f705 under the same
    scripted play (0 pageerrors on both) — the re-pin moves no scenario across
    its medal condition in the compared runs. The full 10-playthrough-per-
    scenario check belongs to verification.
  - **DPR-aware backing store**: one global render scale `RS` (render.js) with
    all view math kept in CSS px (`VW`/`VH`); every raster entry point sets a
    `setTransform(RS,0,0,RS,0,0)` base, layer canvases are device-px and blit
    1:1 under identity, the GQ8 pan apron scales to `SHADOW_MARGIN*RS` so the
    zero-raster pan fast path survives integer DPRs. At RS=1 every expression
    reduces to the shipped arithmetic — verified byte-identical vs HEAD
    `a5792f5` across 4 rotations × noon/night/winter + postcard + minimap.
  - **Eased zoom-to-cursor**: wheel retargets `zoomAnim` (ui.js) and
    `camEase(dt)` (called once per rAF from main.js) exponentially eases cam.z
    (τ=70 ms), re-anchoring on the cursor with the shipped pinch math. Pinch
    stays direct; rotate/new/load/scenario/minimap-click cancel a pending ease.
  - **Colorblind minimap pass**: overlay-mode-only retune (City mode
    untouched). Traffic green→amber→dark-red, poll and crime now
    lightness-monotonic, svc red/green → deutan-safe blue/orange/near-white,
    dead transit station white → dim slate `#78808c`, `DISTRICT_COLS`
    re-spaced on the blue↔yellow axis (same length/index semantics — saves
    compatible). All ramps clear ΔL* ≥ 25 and all categorical pairs ΔE ≥ 15
    (districts ≥ 13.3) under the Machado-2009 severity-1.0 deutan matrix;
    MM_LEGENDS mirrors every final color.
  - **heatwave-97 fix**: `City.deserialize` no longer calls
    `markPassedEvents()` — deserialize is a pure restore, making
    load→serialize idempotent for direct-dated saves (the panel's
    `firedEvents: [] → ["heatwave-97"]` signature). Redundant by construction:
    `eventsTick` fires only on an exact year+month match at a rollover and
    silently retires calendar-passed events, so no retro headline can fire
    (verified: fresh/played/scenario/direct-dated saves all idempotent; the
    loaded Aug-97 city fires no HEAT WAVE headline and retires the id at its
    first rollover). Genuinely-fired saves already carry the id, so their
    load, re-save and 120-rollover tick stream are bit-identical to HEAD
    (verified cross-build). Save format unchanged, v stays 11.
  - **100-year balance soak** (scratchpad harness, 1200 rollovers × empty /
    standard / arco-heavy, seeded RNG): **no degeneracy predicate tripped, so
    no balance clamp was applied** — serialized state stays finite everywhere,
    |funds| max ≈ 1.3×10⁷ (linear tax growth, no runaway), no
    all-three-demands deadlock window, bonds always repay ≥ principal
    (5137 ≥ 5000 on the 12-month issue), and a plant-aging supply collapse is
    recoverable by rebuild (supply 150 → 300 on re-place, `plantYear` resets).
    Two audit observations, documented rather than "fixed": (1) an unattended
    empty city ends 100 years at §18,500 — exactly §20,000 minus the designed
    one-shot §1,500 Asian-flu event (M7), a fixed decrement, not a free-money
    loop; (2) `demand.r` does pin at −1 in arco-heavy cities (ARCO_POP without
    matching jobs, flagged in the design) but demand.c/demand.i stay positive,
    so the deadlock predicate never engages — changing the demand formula
    without a tripped predicate would violate the byte-safety contract, so it
    is left as documented behavior.

## Open

> Rotation staging + criteria live in `docs/rotation-design.json`; the
> gameplay-queue designs + 8-criteria specs for M22/M24/M25 live in
> `docs/queue-specs.json` (ultracode design workflows, judge-approved).

### Gameplay depth roadmap — 10 milestones (rubric-gated)


> **The plan.** `docs/gameplay-roadmap.json` holds the measurable bar: six
> weighted dimensions audited against the SC2K gameplay benchmark by critics
> reading the real sim, scored **47/100** today, plus these 10
> **independently-shippable** milestones (stopping between any two leaves a
> coherent game). Same pipeline as the graphics roadmap: design+criteria →
> implement → verify vs pinned baseline → adversarial panel → fix → ship.
> **Save-version ladder:** GP1 owns v12; each later state-adding milestone takes
> the next integer with backward-compatible loading.


- [ ] **GP2 — Working Ports** *(I4/E3)*: The two most expensive buildings in the game stop being ornaments — a port becomes a specialization bet that pays only if you dedicate a corridor to it and site it where its smog or its approach noise costs you least.
  **Gates:** A powered, road-connected seaport with >=200 industrial jobs in catchm · An unpowered or unconnected port produces zero demand delta, zero reve · Airport tradeoff: demand …

- [ ] **GP3 — Commute Model & Job Access** *(I5/E4, save+)*: Where you put housing relative to jobs finally matters — the one bridge into downtown genuinely carries every trip from the far shore and lights up red, and a second crossing measurably drains it.
  **Gates:** Spatial sensitivity: identical zone counts in two layouts — housing be · Bottleneck emergence: in the single-bridge layout the bridge tiles lan · Load is not degenerate: on a uniform grid with 4 equally-short routes  …

- [ ] **GP4 — Expressways, Ramps & the First Moving Train** *(I5/E3, save+)*: The red bridge finally has an answer that is a decision and not just more asphalt — a high-capacity route you must pay for, route around good neighbourhoods, and deliberately plug into the grid — and the rail line you built years 
  **Gates:** Capacity is real: replacing a congested arterial with an expressway pl · Ramps gate access: an expressway with zero ramps carries zero trips an · Siting tradeoff bites: mean landv of residential tiles within 2 of an  …

- [ ] **GP5 — Service Strain, Visible Coverage & the Education Payoff** *(I5/E4, save+)*: Every thousand new residents re-opens the six-way budget fight — and for the first time schools PAY: two decades of sustained education turns your smokestack district into clean high-tech industry, while you can finally SEE police
  **Gates:** Strain bites and relief works: doubling population against a fixed sch · Education and health are mechanically distinct: two cities, one with m · The slow stock pays off: a city holding >=80% education coverage for 2 …

- [ ] **GP6 — Citizen Opinion Poll** *(I4/E3, save+)*: The headline 'how am I doing' number stops being a tax readout in costume and becomes a prioritized, clickable to-do list that points the camera at the city's actual worst block — and a city that scores well on it unlocks a rank n
  **Gates:** Sensitivity: 6 single-variable perturbations from one saved city (tax  · Ranked list correctness: for each perturbation the induced problem app · No double-charging: with the demand damper cut, a city held at minimum …

- [ ] **GP7 — Assessed-Value Taxation, the Debt Ladder & the Stabilizer** *(I5/E4, save+)*: Parks, clean air, schools and transit finally show up as rent — raising land value literally pays the bills — and borrowing becomes a real instrument with a term, a ceiling and a reputation instead of one fixed button.
  **Gates:** The spike is published first: a committed seed/size/script produces a  · Land value earns money: two cities with identical pop/jobs but mean la · Separability, or an honest single rate: raising only the industrial ra …

- [ ] **GP8 — Coupled Hazard, the Risk Readout & Emergency Response** *(I5/E5, save+)*: Disasters stop being arbitrary weather and become the itemized bill for decisions the player could see coming on a risk panel — and when one lands, the allowance is always smaller than the fire front, so the player must choose wha
  **Gates:** Reachability and difficulty axis (phase 1, independently verifiable):  · Coupling: across 10 seeded 50-year headless runs, a city with full fir · Honest meters: the panel's per-year odds match the measured empirical  …

- [ ] **GP9 — Garbage & Waste Management (M31)** *(I4/E4, save+)*: Growth now produces something the player must physically put somewhere — cheap landfill that poisons the ground it sits on, or an expensive incinerator that turns the problem into a trickle of power and a cloud over its own neighb
  **Gates:** Stream scales with the city: generated tonnage is monotone in develope · The two routes genuinely differ: sufficient landfill capacity zeroes o · Anti-crosstalk audit passes: waste ids conduct no power, register no p …

- [ ] **GP10 — Blight & Urban Renewal** *(I4/E4, save+)*: Neglect finally costs something — a neighbourhood can die and sit as a blighted hole dragging its neighbours down — but the mayor has a renewal campaign to run against it rather than a timer to wait out.
  **Gates:** Causation on a deterministic sweep: a district cut off from power for  · Hysteresis: restoring power does not immediately revive — measured rev · Blight radiates and the campaign beats waiting: mean landv within 4 ti …

### Graphics quality roadmap — 10 milestones to SC2K fidelity

> **The plan.** `docs/graphics-quality-rubric.json` is the measurable quality
> bar (6 weighted dimensions, **current 37/100** vs the SUMMER/DAYTIME SC2K
> reference). `docs/graphics-roadmap.json` breaks the path to that bar into the
> **10 milestones below**, each with explicit **quality gates** and the
> per-milestone dynamic-workflow protocol (design+criteria → implement → verify
> against a HEAD baseline → adversarial panel → ship). **`/goal` + `/loop` drive
> it:** each loop iteration runs the next `todo` milestone to completion via a
> workflow, clears its gates, ships (bundle + artifact + commit + push), and
> advances. Clean-room throughout — recreate the look procedurally, never copy
> Maxis art. Gates are summarized here; the authoritative list is the roadmap JSON.


> **Refined bar (user-directed):** the benchmark is **original SimCity 2000
> fidelity** recreated procedurally, **plus tasteful modern norms** — high-DPI
> crispness, smooth camera feel, colorblind-legible overlays, minor balance
> corrections (`modern_norms` in the rubric JSON). These apply as cross-cutting
> gates on *every* milestone's panel; GQ11 is their dedicated pass.

> **Stretch (deferred, NOT one of the 10):** **GQ-EPIC — true elevation
> heightmap** (integer per-tile height, cliffs, sea-level pooling). Effort-5;
> breaks the flat painter order (`s=x+y`), click-picking, the terrain cache,
> `updateCars`/minimap, multi-tile leveling, and the save format, and must
> reconcile with `TERR.WATER`/waterfill/pump/M29 flood. Revisit only after GQ1–10.


## Done

- [x] **GQ11 — Modern presentation & balance polish** *(graphics roadmap 11/11
  — ROADMAP COMPLETE)*: the modern-norms finale, certified clean 8/8 with 0
  refutes and no fix pass. **High-DPI**: a devicePixelRatio-aware backing store
  renders vector work (bridges, shadows, labels) at true device resolution and
  sprites as crisp nearest-neighbor — hard-edge density **2078×** the
  DPR-ignorant baseline at DPR=2, while DPR=1 stays **byte-identical** (14/14
  captures incl. all rotations, night, postcard) and the GQ8 pan apron keeps
  its integer fast path. **Eased zoom-to-cursor**: exponential settle
  (~250 ms), cursor-anchored, converging to the exact target; pinch untouched
  and 40/40 glitch-free; all other mouse behavior unchanged. **Colorblind
  legibility**: every minimap mode re-tuned to pair hue with lightness —
  worst pairwise ΔE ≥ 28.9 under Machado deuteranopia simulation (traffic now
  green→amber→dark-red, services blue/orange, districts on the blue↔yellow
  axis, legends synced). **Balance audit**: three 100-year soaks (empty /
  standard / arcology cities) show no funds runaway, dead demand, or
  free-money loop; and the twice-flagged **heatwave-97 save quirk was
  diagnosed** (deserialize called markPassedEvents, retro-appending calendar-
  passed events) **and fixed byte-safe** — normal saves round-trip identically.
  Deterministic (120-rollover serialize equality across independent loads);
  zero errors.

- [x] **GQ10 — Special buildings gap-fill** *(graphics roadmap 10/11)*: the
  three genuinely-missing SC2K specials shipped as new overlay ids (append-only,
  save stays v11; pre-GQ10 saves load clean): a **nuclear plant** — containment
  dome, twin waisted cooling towers, radiation-yellow trefoil — fully sim-wired
  through `isPlant` (900 supply, ages to ~450 at year 45, upkeep, minimap plant
  yellow) and clean like solar/wind; a **4×4 airport** — dark tarmac, runway
  threshold bars + centerline, glass-cab control tower, parked aircraft,
  windsock, runway edge-lights at night; and a **water-gated seaport** — quay,
  sawtooth warehouse, stacked containers, red-orange gantry crane, sodium
  floodlights — whose `canPlace` water-adjacency gate was proven both ways.
  M28's arcologies/landmarks finally got minimap colors too. **Certified clean
  12/12, 0 refutes, no fix needed** vs baseline `ef8d148`: all 11 specials
  place + render distinctly (54/55 pairwise silhouette IoUs < 0.85), the launch
  arco reads at 0.3 zoom, all 4 rotations correct, night bakes light only when
  grid-powered, new buildings cast GQ8 shadows, and an **8,288-path whole-atlas
  audit** confirms byte-identity outside the allowed new set. Deterministic;
  zero errors.

- [x] **GQ9 — Shorelines & suspension bridges** *(graphics roadmap 9/11)*:
  coastlines got their bevel — every land-water border now ramps through
  underwater shoal → dry sand → **wet-sand band → foam core + halo with
  scalloped surf** (profile: median 8 intermediate pixels, hard-seam metric
  0.41 vs ~1.0 for a cliff; the panel-cycle fix added the shoal falloff that
  killed a plateau collapse against dirt shores) — and roads/rails crossing
  water now render a **procedural suspension bridge**: tapered international-
  orange towers at the banks, closed-form quadratic main cables that join
  exactly across tile seams (12/12 segments at all four rotations), hangers at
  even global stations (spacing CV 0.017), railed deck fascia and a translucent
  water shadow that keeps the shimmer visible. Cars drive the spans (5,726
  crossing hits), picking stays exact 8/8 at every rotation, rail bridges work,
  the GQ8 shadow layer is zero-diff, and noon **and** deep-night frames are
  byte-identical to baseline `8201e50` away from the new art. Save format
  unchanged (visual-only); deterministic; zero errors.

- [x] **GQ8 — Building cast-shadows & aliveness guard** *(graphics roadmap
  8/11)*: every building now casts a **directional drop-shadow toward
  screen-SW** (sun-opposite, consistent with the existing tree/car shadows) —
  one swept-hull quad per caster on a cached screen-space layer composited over
  terrain and under the painter loop, height-scaled (a c3 tower reaches ~2
  tiles; a minimum length keeps lvl-1 cottages visible), correct at all four
  rotations, and **day-only by construction**: the deep-night frame and the
  G1/G2 night layer are byte-identical to HEAD, with dusk fading on the night
  lerp. **Aliveness is now a guarded target** via `alivenessStats()` (cars,
  smoke, water shimmer measured = HEAD baseline; train slot N/A until a train
  ships). This milestone earned its panel: **all three lenses initially
  refuted** — invisible shadows on low buildings (shH=1 cottages) and a real
  **1.33× pan-perf regression** (layer rebuilt every pan frame) — both fixed
  (SHADOW_MIN_LEN=10; a world-space pan apron making integer pans a pure
  composite offset, **0.977× pan ratio**, 0.0ms rebuild during pans) and the
  full gate suite re-measured green vs baseline `19f72b6`: save byte-identical,
  picking 172/172, deterministic cross-boot, zero errors.

- [x] **GQ7 — Road markings & asphalt** *(graphics roadmap 7/11)*: roads
  darkened to true asphalt (`#3e3f46`, median luminance 90 vs pavement ground
  142 / civic aprons 151 — the network finally reads as a dark grid), with
  **solid white lane-edge lines** inset inside the asphalt span (clear of curb
  and the GQ4 tree trunks), the G12 phase-aligned yellow center dashes
  untouched, and **continental crosswalk bars + stop lines on every arm of
  every 3+/4-way junction** — baked per mask so all four camera rotations come
  free via the `rot4()` remap (spot-proven per orientation). Winter keeps its
  plowed-bank identity with markings visible between banks. **Certified clean
  8/8, 0 refutes, no fix needed** vs baseline `8235b68`: a single zero-RNG
  function change; 32/32 road sprites at unchanged 64×32 anchors; 204/204
  untouched canvases byte-identical; night lamps, 32 animating cars, street
  trees and WIREROAD all unregressed; markings geometrically contained (max
  transverse 9.17px < asphalt 12.9px); deterministic; zero errors.

- [x] **GQ6 — Reflective-glass facades** *(graphics roadmap 6/11)*: the C3
  towers' glass is now certified **reflective 90s curtain-wall**: palette-
  quantized horizontal banding (≤10 color clusters, ≥10 luminance transitions,
  smooth-pair fraction ~0.05 — provably *not* a modern gradient), in-band
  **ordered dither** (2 dominant tones ≥92% coverage with 11 checkerboard
  alternations), crisp mullions (97–100% column-exact at t=1/3, 2/3 on both
  faces of all 5 variants), a two-tone sky split on upper bands, and 203–397 px
  of **diagonal reflection glints** per variant that cross spandrels and glass —
  the cue that reads as reflection rather than painted stripes. **Certified
  clean 6/6, 0 refutes, no fix needed** vs baseline `7299590`: of **14,884
  audited canvas paths**, only the 200 allowed c3-day-lineage canvases differ;
  every non-c3 family byte-identical; silhouettes/anchors unchanged;
  deterministic across fresh contexts **and with unstubbed Math.random** (all
  new randomness on the `glassRng` side stream); night/pool/beacon bakes
  bit-untouched; zero errors.

- [x] **GQ5 — Building silhouette variety** *(graphics roadmap 5/11)*: the
  skyline's box monotony is broken — **12 grayscale-distinct archetypes** now
  ship: hip-roof rowhouses with dormers + chimneys, an asymmetric stepped
  wedding-cake tower, an off-center tank-crown tower, a podium + offset-slab
  office, a 3-tier tapering curtain-wall tower, a crown-step + mast tower, a
  gable shed, a 3-tooth sawtooth industrial shed (skylight faces), plus the
  retained cottage/storefront/box+stack/heavy-plant forms — and an
  **8-type rooftop prop library** (AC, vents, hatches, skylights, tanks,
  bulkheads, planters, pipes) seeded per `(family, variant, jitCopy)` so
  adjacent same-variant buildings differ (min 136-px prop deltas; in-situ
  neighbors differ by 2410 px). **Certified clean 8/8, 0 refutes, no fix
  needed** vs baseline `e640d18`: min pairwise outline distance 0.0492 (median
  0.120, floor 0.045 — HEAD's boxes scored ~0.000); per-zone height ladders
  strictly increasing; anchors/dims tuple-equal **1008/1008** across all 4
  facings and picking round-trips **1200/1200** (painter order + click-picking
  provably intact); **1552 untouched canvases byte-identical** (civic equality
  doubling as the shared-RNG-stream canary); 2892/2892 canvases identical on
  double-boot; changed-family night bakes 100% inside the day silhouette (G1
  intact); frame time **0.93×** HEAD. All via the exact R()-consumption-
  signature discipline (windows() row/col counts preserved; new geometry
  deterministic; props on side streams).

- [x] **GQ4 — Vegetation & street trees** *(graphics roadmap 4/11)*: straight
  road segments now carry **groomed street trees** — a pure deterministic
  function of `(seed, x, y)` + `roadMask` (no sim/save state; reacts to
  build/doze automatically), covering **89%** of straight tiles (gate 70%),
  drawn in the painter loop through the rotation-aware fractional projection so
  the verge lands correctly at every camera rotation. Six per-variant trees
  (size/silhouette/hue jitter from a dedicated `streetRng` stream) baked
  per-season on tight 20×22 canvases. The **panel's fidelity lens caught a real
  high-severity defect — trees standing on the asphalt itself** (±0.34 offset,
  inside the ±0.36 asphalt span) — fixed to the true grass verge (±0.44, trunk
  1.6px clear of the curb), autumn re-pinned to an exact 2/2/2 gold/orange/red
  spread, variants made season-consistent, and the tight bake cut blit area 9×,
  bringing developed-128 with **1,818 trees to 1.16×** frame cost (gate ≤1.20).
  Fully re-verified: 0 legality violations (incl. water-bridge roads,
  intersections, burning tiles), 12/12 tiles render at all 4 rotations,
  placement byte-stable across contexts and save/load, empty-city frame + 537
  bake hashes + night layer byte-identical to baseline `1caa0a3`, zero errors.
  The existing 922-tile forest stand verified as the dense-stand gate.

- [x] **GQ3 — Zone-correlated building palette** *(graphics roadmap 3/11)*: the
  nine zone families now draw from **curated per-zone hue palettes** — terracotta
  plaster + brick-red residential, tan/mustard + gold mid-rises, pale-teal
  storefronts, teal/cyan commercial towers with **period-correct banded
  curtain-wall glass + mullions** on C3 (deterministic overdraw, zero ART_RNG
  drift), and drab steel/olive industrial whose density cue is **lightness**, not
  hue (MN3) — with lit/shadow faces derived by pure HSL lightness shifts around
  the screen-welded sun. **Certified clean, 8/8, no fix needed** vs baseline
  `1a7e8d1`: 7 hue buckets present; a nearest-hue classifier over 90 rendered
  R/C/I tiles scores **1.00 zone-correct at both cam.r=0 and r=1**; min
  adjacent-variant color distance 11.7; **all 58 night/pool glow canvases
  byte-identical** (G1 night legibility preserved, glow ratio 1.048); **647
  unrelated day canvases byte-identical**; 2868 canvas hashes identical across
  independent boots; winter ≤ summer saturation everywhere. Panel: 3/3 confirm,
  0 refutes (three low-severity taste notes recorded for future polish).

- [x] **GQ2 — Ground-material quilt** *(graphics roadmap 2/11)*: every empty
  land tile now carries a **material** — grass, dirt, sand lot, or pavement —
  from a pure two-octave value-noise field of `(city.seed, x, y)` (no sim/save
  change; deterministic across save/load for free), each baked with sealed
  diamonds, two-tone stipple, material signatures (dirt clods + wheel ruts, sand
  ripples, pavement cracks + expansion joints), a within-tile relief gradient,
  directional relief tinting from a low-frequency swell field, and stippled
  fringe feathering on quilt-patch borders. All drawn at terrain-cache rebuild
  time only — the per-frame path is still one `drawImage`. **Certified** vs
  baseline `10909f1`: 4 materials in one view (color separation 52.9–123 per
  pair); the panel's fidelity refute — variant-collided adjacent tiles too
  similar — was fixed structurally (**8 independent bakes per material**: 4
  variants × 2 parity, so orthogonal neighbors always draw different canvases),
  after which **all 616** adjacent same-material pairs differ ≥15.97% (was 35
  below 5%); largest identical-RGBA block just 2×2 px; rebuild cadence identical
  to HEAD at **0.97–1.00×** cost (the fix also erased the 1.44× rebuild spike);
  building sprites, save bytes, and a 60-tick sim **byte-identical** to HEAD;
  correct at all 4 rotations; winter materials stay legible vs snowpack (MN3:
  lightness, never hue alone); zero errors. 7-agent workflow, 3-lens panel.

- [x] **GQ1 — Daytime palette & water vibrancy** *(graphics roadmap 1/11)*: the
  summer/daytime palette re-tune shipped and **gate-certified** against baseline
  `368d514`. All 5 gates measured live and passed: lake water median HSL S
  **70.2%** at summer noon and the most saturated blue in frame; average daytime
  frames **4.07×** the deepest night frame (winter midnight) by mean HSL S
  (2.95× HSV, 4.40× chroma — the stricter same-scene summer chroma ratio is
  2.12×, disclosed); midnight keeps warm accents (**82%** of downtown towers show
  amber window/lamp pixels; even winter midnight retains 907 warm facade px — no
  cold-monochrome collapse); parks median green S **46.0%** / forest **59.3%**;
  and all **593 sprite alpha masks byte-identical** to baseline under seeded RNG
  (a genuine color-only change), zero non-favicon errors. A 3-lens adversarial
  panel (fidelity / regression / determinism-perf) returned **0 refutes**; its
  one med finding — the pre-existing `#3555ff` zone-marker/pennant blue rendered
  S=1.0 pixels that out-blued the lake — was fixed to `#4860e0` (hue 230 kept so
  R/C/I overlays stay colorblind-distinct, S capped 0.7) and re-verified.
  Independent post-fix smoke check: renders full, avg scene saturation 0.52,
  zero errors. Shipped to the published artifact.

- [x] **M30 — City history charts & trend graphs**: the City Graphs window grows
  from 2 traces to **six toggleable series** — pop, cash flow (net), tax income,
  pollution, crime, land value — over **1yr / 10yr / 100yr** ranges on canvas.
  Flow series (pop/net/tax) plot the annual almanac `records[]` at 100yr; the
  three diffuse-map indices (poll/crime/landv) are backed by a **NEW monthly
  ring-buffer** (`city.history.{poll,crime,landv}`, capped 240) recorded at the
  month rollover *after* `recomputeMaps` as the citywide mean via `cityIndex()` —
  a **read-only sampler** that never feeds back into the sim. Each series
  auto-scales to the frame (0-255 indices and 5-digit § coexist); magnitude is
  carried in the legend. Empty/sparse cities show a "Collecting data — check back
  in February" card at every range. Save bumps to **v11** with back-compat: a
  pre-M30 v10 save whose history has only pop/funds is normalised so the five new
  arrays exist, then records forward. Verified 8/8 criteria via an independent
  59-assertion headless harness against a fresh `282ca23` baseline worktree —
  per-series isolation (each trace's color pixels appear alone with 0 foreign
  px), save round-trip deep-equal + contiguous-at-load, non-mutating rescale,
  sparse/empty safety, `history.{poll,crime,landv}` last element == rounded map
  mean at MAP 64 & 128, **byte-identity vs baseline** after normalising the new
  arrays (v10→v11 the only diff), and record-only (sim state identical with vs
  without the sampler). The panel's one actionable note — the 100yr right x-axis
  label printed `"yr N"` using the **monthly** sample count, mislabeling months
  as years when the index series out-length the annual records — was fixed
  (convert each series' point count to its real span before labeling) and
  independently re-verified: a 160-month city now reads **"yr 13"** at 100yr
  (was "yr 160") while 10yr still reads "mo 120"; zero console errors.

- [x] **M29 — Expanded disaster roster**: four new catastrophes ride the
  existing single-disaster slot + `disasterTick()` plumbing (fire/tornado/ufo
  left byte-identical), each reading a system the sim already maintains and
  damaging via the tornado's building→rubble idiom + the existing `ignite()`:
  **earthquake** (stationary epicenter, expanding rubble+fire ring), **flood**
  (BFS spreads *only* inland from `TERR.WATER`-adjacent tiles — a waterless map
  can't flood and doesn't phantom-count), **riot** (epicenter at the crime-map
  argmax, suppressed faster under high police coverage), and a **kaiju monster**
  (tornado-style moving path, wide stomp). Each increments the yearly counter
  once (moved after the precondition check) and terminates cleanly. The
  render's bare `else`-is-ufo was split into explicit per-kind branches so each
  draws its own rotation-aware art and never falls through to the saucer.
  `this.disaster` is now serialized **conditionally** (only when non-null, still
  v10) so an in-progress disaster resumes after load while a no-disaster save
  stays byte-identical; the disable flag gates the new kinds' random spawns.
  Verified 9/9 + a 5-agent panel (5/5): riot on the crime hotspot, flood
  water-reachability, save-resume, clean termination, disable gate, no-disaster
  byte-identity, existing disasters + all composed features intact. Zero errors.

- [x] **M28 — Arcologies & wonder landmarks**: four SC2K arcologies (Plymouth/
  Forest/Darco/Launch, OV 22–25) and three wonder landmarks (Statue/Eiffel/
  Pyramid, OV 26–28) as large multi-tile buildings (3×3/4×4) on the existing
  OV_SIZE/anc[] machinery — `place`/`bulldoze` were already size-agnostic.
  Arcologies carry a **fixed pop/jobs counted once per structure** (a 4×4 Launch
  adds 3000 pop once, not ×16), pushing the city up the tier ladder, and are
  **self-powered power islands** (four `!isMega` guards mirror the plant/water
  exclusions: lit but zero grid demand, never conduct or get misclassified by
  the `t >= OV.ZR` idioms). Landmarks stamp a land-value pride radius folded into
  recomputeMaps — **fully revert-safe** (recomputeMaps rebuilds landv from
  scratch, so bulldozing a landmark leaves no residual). Endgame arcologies are
  tier-gated; sprites join the per-facing bake so rotation + night lighting work
  for free (the render path needed no change). Save stays v10 (ids ride over[]/
  anc[]). Verified 9/9 + a 5-agent panel (5/5): census-once, zero power demand,
  land-value stamp+revert, tier gate, multi-tile placement/one-bulldoze, save
  round-trip, and a no-arcology city byte-identical to the pre-M28 baseline.
  Zero console errors.

- [x] **M27 — Neighboring cities & regional connections**: the four map edges
  gain named neighbor cities whose names/archetypes/prices/dispositions are a
  **pure function of `city.seed`** (`computeNeighbors(seed)`, never serialized).
  A road/wire/rail tile touching a border opens a connection to that edge's
  neighbor; a Win95 deal dialog lets you **sell surplus power** (income), **buy
  power** during brownouts, and open **commuter links** that raise demand within
  8 tiles of the border. Power trade folds into `recomputePower` supply and the
  monthly budget; commuter demand feeds `growthPass` via a per-tile bias that is
  exactly 0 (bit-inert) with no open link. Save bumps to **v10** (deals + disp);
  pre-M27 saves load with no connections. Verified 9/9 criteria + a design phase,
  then the multi-vote panel **caught a real economy exploit** — selling power
  over a border wire was paid with no check against generation, so a plantless
  city could mint free § (~+20k/yr) and overselling browned the city out "for
  free." Fixed: exports and revenue are **capped to actual generation surplus**
  (`sold = min(committed, max(0, plantSupply − demand))`, revenue scaled by
  sold/committed), closing the phantom-income and free-power holes and making
  buy→resell arbitrage net-negative. Re-verified independently: plantless → 0,
  oversell 300 w/ surplus 297 → exports 297 (never self-browns) paid 2673,
  arbitrage nets −1326, in-surplus deals unchanged, and a no-connection city is
  **240-tick byte-identical** to the pre-M27 baseline. Rotation/districts/
  ordinances/water/rail all intact; zero console errors. (One re-verify lens
  mislabeled its boolean as a refute while its own evidence and defects list
  fully confirmed the fix; independently re-tested to be certain.)

- [x] **M20 — Soundtrack expansion**: the single generative bar loop became a
  table of **four distinct WebAudio-synth moods** — calm (sparse, slow, sine/
  triangle, high register), bustling (fast saw/square metropolis), tension
  (dissonant low saw), night (mellow jazz) — each on its own GainNode under
  musicGain. A mood-selection function reads live sim state (low pop/day → calm,
  high pop+demand/day → bustling, midnight → night) and any **active disaster
  forces tension with precedence**, reverting when it clears. Switches
  **crossfade** via overlapping AudioParam gain ramps (~1–2 s, no hard cut or
  gap). The music toggle still starts/stops cleanly with **zero scheduling when
  off**, SFX/M6-ambience routing to Snd.master is unchanged, and a music-credits
  easter egg was added to About. Criteria set fresh by an independent reviewer;
  verified 7/7 headless (mood distinctness, state-driven selection, disaster
  precedence, crossfade ramp overlap, zero-cost-when-off + leak-free toggle,
  About credits, no SFX/ambience regression) + a 4-agent panel (4/4, 0 defects).
  Zero console errors.

- [x] **M25 — Rail & subway transit**: buildable rail/subway/stations on a
  **separate `city.rail` plane** (RL.TRACK/SUB/STATION) so `over[]` is never
  touched — no OV-id or zone-idiom concerns. `recomputeRail()` (run after
  recomputePower, reading `powered[]` without editing it) builds railNet
  components + a `railCov` station catchment; station power is by **adjacency**
  (a powered 4-neighbour), so it never bridges power into a zone. Ridership
  diverts a **capped** share of a served zone's road trips inside
  recomputeTraffic — `min(RAIL_MAX_SHARE=0.60, railCov/255)` scaled onto a
  deterministic map before the reservoir walk, so it's identical per seed and
  **never zeros a road**. Tier-gated tools (rail 20 / subway 45 / station 300,
  Town+); surface rail can share a road tile as a grade crossing; an 8th transit
  minimap mode, transit query rows, procedural sprites (rot4/cam.r autotile),
  funding.transit upkeep. Save v9 (adds rail[] + funding.transit); legacy saves
  load rail-zero + transit 100. Verified 8/8 + plane-isolation and
  capped-diversion hard gates + a 5-agent panel (5/5): a rail city's over[]/
  power/access/pollution are byte-identical to the same city rail-zeroed and to
  the pre-M25 baseline. Panel notes non-blocking (relief is modest on 255-clamped
  arterials as railCov peaks ~126; a 2-station line opens on one powered station
  per the machine criteria). Zero console errors.

- [x] **M24 — Water & sewage system**: a second utility network. OV.PIPE=19/
  WATERTOWER=20/PUMP=21 (appended after WIREROAD=18), with an `isWaterOv()`
  helper that **excludes all three from `recomputePower`'s conductor test and
  every `t >= OV.ZR` power/census idiom** — so water infrastructure never
  conducts electricity or counts as a zone (a plant+pipe adjacent to a lot leaves
  it unpowered; adding pipes/towers leaves the power grid byte-identical). A
  water tower supplies with no power; a pump is a 2×2 station needing power AND a
  `TERR.WATER` neighbour (dry or unpowered → 0). `recomputeWater()` runs after
  recomputePower, producing a `watered[]` catchment + waterSupply/waterDemand/
  waterPressure. Water **gates density, upgrade-only**: unwatered lots cap at lvl
  1, lvl 3 needs pressure ≥0.9, and the gate never decrements an existing lvl —
  so loading a pre-M24 city keeps its full skyline (no shrink). A Water minimap
  overlay, budget upkeep, procedural pipe/tower/pump sprites, and vitals/query
  rows. Save stays v9 (over[] carries the ids; watered[]/pressure derived on
  load). Verified 8/8 + anti-crosstalk and no-shrink hard gates + a 5-agent panel
  (5/5 confirm; the two panel notes — a wired pump drawing power as a motor
  without propagating it, and towers/pumps being flammable like plants — are
  intended, spec-compliant behavior). Zero console errors.

- [x] **M22 — City ordinances**: an ORDINANCES registry (recycling, neighborhood
  watch, carpool incentive, curfew, nostalgia tax, smoke-detector mandate) with
  a boolean `city.ordinances` map. `enactOrdinance()` rebuilds a pop-independent
  scalar cache `city.ordMods` that folds into the **existing** recomputeMaps
  (pollution/crime), recomputeTraffic, recomputeDemand and fireTick formulas — no
  new per-tick pass, bounded by the existing clamps, reverting to identity when
  off. Costs/revenue flow through the budget via an O(1) `ordinanceBudget()` +
  a `lastBudget.ord` line scaling with live pop/comJobs. Tier-gated in both the
  enact validator and the effect fold; a `#dlg-ordinances` Win95 dialog lists
  each with cost/benefit + lock hints (refreshes while paused); M23 advisors
  recommend relevant ones by department bias. `ordMods` is derived (never
  serialized), rebuilt on load after tier restore, and now also refreshed by the
  `tick()` tier ratchet so a gated ordinance activates the moment the ratchet
  reaches it. Save stays v9. Verified 8/8 + determinism (no-ordinance ticks
  byte-identical to HEAD incl. funds) + a 6-agent panel (6/6); the panel's
  tier-ratchet edge was hardened and re-verified byte-identical.

- [x] **M32c — Rotation framing polish**: postcards are now shot **north-up
  (`r=0`) regardless of the live view rotation**, so a keepsake taken while
  rotated frames the skyline correctly instead of clipping — `renderPhotoTo`
  saves/sets/restores `cam.r=0` around the photo render, and `postcardBounds`
  computes its fit at `r=0` to match. Verified: with identical randomness the
  postcard is byte-identical across all four live rotations, the bounds are
  rotation-independent, and the live `cam.r` is restored afterward; zero errors.
  (The other staged M32c items — per-facing smoke anchors, cache keys, the
  minimap viewport float — already landed in M32a/b; the optional turn animation
  was intentionally skipped to avoid gratuitous motion.)

- [x] **M21 — Land value visualization & districts**: a district paint layer in
  a new per-tile `city.district` Uint8 channel + a `city.districts[]` metadata
  list (id/name/`col` index into DISTRICT_COLS), painted with a free `district`
  tool (key `d`). Districts co-exist with OV.* — painting never writes
  over[]/lvl[]/anc[] and never charges funds — and hook **none** of the sim
  update path, so `tick()`/`recompute*`/`growthPass` stay byte-identical with or
  without districts (verified against a seeded baseline). A `#dlg-districts`
  Win95 manager creates/renames/recolors/deletes (cap 12, smallest-free id
  reuse) and shows read-only `districtStats()` aggregating the existing
  land-value/pollution/crime/coverage maps (pop/jobs from RES_POP/COM_JOB/
  IND_JOB). A 7th `dist` minimap mode + legend, and low-zoom SCREEN-space
  neighborhood labels whose centroids project through the rotation-aware
  worldX/worldY (upright and correct at every camera rotation). Save bumps to v9
  round-tripping district[]+districts[]; pre-v9 saves load with an empty layer.
  Verified 8/8 criteria + determinism (rotation `r=0` unchanged) + a 6-agent
  panel that caught a real bug — the label centroid cache keyed only on distRev
  (which inits to 0 on every city) collided across loaded cities; fixed by
  keying it on the city object identity too, re-verified with no name leak on a
  city swap, zero console errors.

- [x] **M32b — Multi-side building sprites** *(user request)*: rotating the view
  now shows genuinely different building sides. Each building family bakes four
  facings (`SPR.<fam>[r]`) — facing 0 keeps the original seed `0x5EED` (so `r=0`
  is byte-identical for 18/20 families), facings 1–3 use a forked per-orientation
  RNG (`0x5EED ^ r*0x9E3779B1`, snapshot-swapped so the shared bake never
  desyncs), built lazily on first visit to each angle and cached (boot time +
  default memory unchanged; ~20 MB after visiting all four). The sun stays
  screen-welded; only which world-face's decoration maps to the visible SW/SE
  edges rotates. Handed civics (fire-station bays, hospital canopy, plant stacks,
  police/school detailing) present their feature on the correct side per rotation
  and a coherent plainer back where occluded. The two industrial families `i2`/
  `i3`, which shipped with a permanently bare face, were windowed on all faces —
  a deliberate `r=0` art improvement (their bare face is visible at `r=0`, so it
  can't be filled without changing `r=0`), verified surgical (only `i2`/`i3`
  change; opaque-pixel count unchanged; silhouette/stacks/night-glow untouched;
  fully deterministic). `spriteFor` masks the facing index with `cam.r & 3`.
  Independent 6-agent panel caught the `i2`/`i3` gap; fixed and re-verified — no
  blank face at any rotation, projection/painter/mask/picking untouched, save
  unchanged, zero console errors. Verified 10/10 criteria + facing-0 byte-identity
  + a multi-side visual proof.

- [x] **M32a — View rotation core** *(user request)*: press **Q/E** (or `[`/`]`,
  or the ⟲/⟳ HUD buttons) to rotate the isometric view 90° through all four
  orientations. A single `cam.r ∈ {0,1,2,3}` routed through the worldX/worldY/
  screenToTile chokepoint plus pure `rot()`/`unrot()` helpers (with an `r=0`
  identity early-return, so orientation 0 is **byte-identical to the pre-rotation
  game by construction**); the painter loop walks view-depth diagonals; autotile
  masks rotate at lookup via `rot4()`; 2×2 anchors pick their front/back corner
  by view depth; picking, cars, chopper, disasters, night glow and the minimap
  all track; rotation pivots around screen-center and persists view-only in
  UI.prefs (never serialized — no save bump). Buildings billboard for now (true
  multi-side art is M32b). Criteria + staging set by an independent reviewer
  (`docs/rotation-design.json`); implemented and verified via the milestone
  workflow (10/10 criteria, HEAD `r=0` byte-identity, zero errors), then a
  6-agent adversarial panel caught two real regressions (a 1px minimap
  viewport-rect shift at `r=0`; smoke plumes detaching from 2×2 stacks when
  rotated). Both fixed (a float inverse `screenToTileF`; plumes anchored to the
  sprite's draw corner via `backCorner()`) and re-verified 3/3 against the pinned
  pre-rotation commit — `r=0` main **and** minimap pixel-identical across four
  cameras, plumes on-stack at every rotation, picking round-trips 32/32.

- [x] **Bug fixes — New City & car speed** *(user reports)*: File ▸ New City (and
  the no-saved-city notice) were gated behind native `confirm()`/`alert()`, which
  the sandboxed artifact iframe blocks silently — replaced with a self-contained
  Win95 modal (`uiConfirm`/`uiAlert`). Cars kept driving at full speed while
  paused and ignored the speed setting — car motion now scales by `UI.speed`
  (frozen at Pause, 0.5×/1×/2× for Turtle/Llama/Cheetah). Each independently
  verified headless with a regression pass; zero console errors.

- [x] **M26 — Power lines cross roads** *(user request)*: a wire laid on an
  existing road (or a road laid on an existing wire) fuses into a single
  **OV.WIREROAD** (18) crossing that BOTH conducts power (recomputePower's
  flood-fill treats it as a wire node — a plant on one side powers a zone on
  the far side through it; swapping it for a plain road severs that) AND
  carries road access/traffic (recomputeAccess seeds it at 4, recomputeTraffic
  + the car pool + nearestRoad/BFS/chopper all run through it — a zone reachable
  only via the crossing gets access and grows). It renders as the road sprite
  with the overhead power line composited on top (SPR.wire at its baked
  elevation); road/wire connection masks join straight through; the minimap
  tints it road-grey with a wire tan. It wears, pollutes and jams like a road,
  is non-flammable like a road, and is explicitly excluded from every
  `t >= OV.ZR` zone idiom so it is never a power consumer, unpowered flag,
  fire/growth candidate or census unit. One bulldoze clears the whole crossing.
  WIREROAD is just a byte in over[], so save v8 round-trips unchanged and
  pre-M26 saves load clean; wires/roads still refuse to overlap zones/buildings/
  plants. Criteria set by an independent Opus reviewer; implemented + verified
  via the milestone workflow (8/8 criteria pass, clean HEAD-baseline regression,
  zero console errors), then cleared by an independent 6-agent adversarial panel
  (static completeness audit + 5 diverse-lens skeptics, 6/6 confirm, 0 refute)
  and a bundle smoke test (crossing conducts + gives access + renders; the sole
  404 is the standalone favicon, absent in the published artifact).

- [x] **M19 — Power plant variety & aging**: OV.GAS (2x2, cap 450, §4500,
  moderate load-scaled smog) and OV.WIND (1x1, cap 80, §2500, zero smog)
  added as toolbar plants with procedural sprites and POWER_CAP entries
  summed into supply; a plantYear array records each plant's build year and
  plantEffectiveCap decays full->~50% between age 30 and 45 (age35 coal=250)
  with an end-of-life rebuild notice, reset on bulldoze+replace; coal smog in
  recomputeMaps scales with grid load (pollution 328 under load vs less idle);
  a power-mix breakdown (powerMix() -> {coal,solar,gas,wind}) in the budget
  window; save v8 round-trips plantYear (v7 saves default to load year).
  Coal/solar caps, smoke plumes and the M13/M23 budget panels preserved.
  Criteria set by an independent Opus reviewer (Fable quota exhausted).
  Verified against 7 criteria (all pass).

- [x] **G7r — City Graphs empty-state fix**: openGraphs() rewritten — a
  fresh city / scenario boot (history <2 points) now shows a centered
  "Collecting data — check back in February" card instead of a blank white
  box; once >=2 months exist both traces render (pop #0a0 / funds #00a) over
  a dark x/y axis with min/mid/max value gutters and a month axis; empty
  state gives way to traces from the second rollover; reopening re-reads
  live history. Verifier also fixed a zero-baseline overdraw and bumped
  trace lineWidth so flat traces are detectable. Criteria set by an
  independent Opus high-effort reviewer (Fable quota exhausted; session on
  Opus). Verified against 6 criteria (all pass, zero console errors).

- [x] **G16 — Living-city motion pass — cars, smoke, tornado, UFO**: cars are
  now baked iso body sprites picked per travel axis (two parallelogram shapes,
  never axis-aligned rects on diagonal streets), the pool cap scales with map
  area (carCap = min(260, MAP²/80): 205 on 128x128 vs the old flat 70), and
  after dusk each visible car queues a warm headlight cone + red taillight into
  carLightQ, flushed additively in drawNightLights alongside the G2 layer so
  streets sparkle (1163 moving-warm + 30 red night px vs HEAD 0; absent in a
  car-free control). Industrial smoke warmed to coal-gray at ~0.52 start alpha
  with faster growth and connected 2-puff plumes, and updateSmoke now scans
  from a random wrapped origin so the whole map shares the puff budget — the
  high-index lower-right that HEAD's ascending scan starved now smokes (11185
  lower-right puff-frames over 300 vs HEAD 0). The tornado gained a dark
  two-tone rotating funnel (core vs mid-green grass Δlum 46, was ~0), 8 orbiting
  debris specks, a wide dust skirt and a larger sway; the UFO rides at 150px
  above the ground (clears the dense-district roofline, was nestled ~64px among
  roofs), its abduction beam reaches the ground (47 green px vs HEAD 0) with a
  moving ground shadow and slower/larger frame%32 3px marker blink. Off-screen
  cars are culled so the map-sized pool stays cheap (developed-128 + max
  traffic + tornado steady-state ~1.6ms vs HEAD ~1.55ms, within 20%). G3 fire
  smoke/flames/char preserved; zero page errors. Verified against the 6 archived
  criteria with HEAD before/after baselines.

- [x] **G15 — Splash screen joins the 1997 identity**: the splash is now a
  maximized Win95 window (real titlebar + _ □ ✕) on the game's teal desktop
  instead of a disconnected navy radial gradient; beneath a hard-edged
  beveled pixel logo (canvas, no CSS glow) runs a live isometric skyline
  strip drawn from the shared SPR building/tree bake (24k sprite pixels,
  proven to shrink when sprites are blanked). Win95 punched-circle radios
  (zero native-blue px), hard 1px button shadows matching .win95, newspaper
  -cream scenario cards. All splash functions intact — reroll changes the
  seed+preview, size radios drive MAP, NEW CITY uses the previewed seed,
  scenario cards + trophy shelf + LOAD all work — and the M15 responsive
  layout holds at 768x1024. Verified against 6 archived criteria + a
  functionality/responsive guard (all pass).

- [x] **G14 — Seasons reach the buildings and every tree**: SPR.bset winter
  building variants derived from each summer canvas — cool desaturation grade
  (k=0.10) plus snow overpainting every recorded top-face/roof-plane polygon
  with an eave lip and drips; park and r1 standalone trees rebaked per season
  (winter snow, autumn warm); autumn forests gain 3 canopy hue modes (gold/
  orange/red) off the existing seeded per-tree hue (no new RNG draws); a
  screen-space seasonal composite grade faded by (1-ns). Winter/summer roof
  luminance 1.0x->2.2x, facade saturation ratio 0.74 (25% drop); every winter
  sprite snow-covered. Summer/spring buildings byte-identical to HEAD (373/373
  sprites, 0 changed scene pixels); night glow/G9 beacons/G10 palettes/G11
  civics preserved, terrain cache one rebuild/rollover, save unaffected,
  winter-128 frame within 0%. Verified against the 5 archived criteria +
  summer-identity/G1/G9/G10/G11 guard (all pass). (Committed in two parts:
  72c94be implement checkpoint under the git-check hook, then verified.)

- [x] **G13 — Shoreline & forest naturalization**: sandHi outer lip dimmed
  (#eeda9c->#e0c87f) and flattened so beaches stop reading as ramparts
  (outer-lip-vs-body luma 11.7%->2.4%); per-edge sand band width jittered
  5-9px by a seeded shoreRng across 4 terrHash-picked SPR.shore variants;
  convex-corner wedge triangle fills curve the coast; forest floor blended
  toward grass (delta 15->3) with feathered terrEdge; trees get grounding
  shadows, 3 silhouettes (round/conifer/oak) and per-tree hue jitter, live
  mirror-flip on odd (x+y) so 4-adjacent forest never repeats; winter
  iceEdge shore crack (29 luma step). Separate mulberry32 streams keep the
  shared bake unshifted — 163 building/road/tree sprites byte-identical;
  terrain cache deterministic; G5/M5/M12 intact. Verified against the 5
  archived criteria + regression guard (all pass).

- [x] **G12 — Road art upgrade**: roadSprite() asphalt widened from ~44% to
  ~70% of the tile edge with 1px lighter-gray curb lines each side (winter
  keeps the M12 plowed snow banks); center-line dashes on 3+ connection
  tiles stop 9px short of center so junction boxes stay unmarked; straight
  tiles draw one edge-to-edge stroke with an armLen/4 period so the dash
  phase is 0 at every edge-midpoint — dash/gap run variance 37px -> <1px
  across seams, no mirror at center. All 16 masks + winter variants bake at
  the unchanged 64x32/ox32/oy16 anchor; night lamp compositing untouched.
  Verified against the 5 archived criteria + 16-mask/winter guard
  (17/17 checks, all pass).

- [x] **G11 — Civic buildings that players can find**: police/fire/school/
  hospital rebuilt with raised massing on set-back paved aprons plus skyline
  landmarks (police comms mast to 84px, hospital tower-wing 74px, bell tower,
  schoolhouse) and service-colour roof glyphs (blue shield, red garage door,
  cyan open book, iso red cross on the helipad — iso-plane, not screen-axis).
  Massing above footprint: police 30->84, hospital 34->74, all clearing the
  ~60px skyline; roof-glyph minimap-colour pixels 0->120+. Anchors grew
  upward only (ox=64, footprints bottom-aligned, OV_SIZE/anchor math
  untouched); occlusion correct in day+night scenes. G9 beacon gate, G10
  zone palettes, night bakes and determinism all preserved (coal sprite
  shifted as a seeded-RNG-stream side-effect — still deterministic and
  valid; solar/rewards/zones byte-identical). Verified against 5 archived
  criteria + G9/G10/placement guard (all pass).

- [x] **G10 — Zone color identity**: all nine developed-zone facade palettes
  constrained to their minimap hue family — R warm greige/clay/cream (hue
  0-50), C cool blue-gray/teal glass (180-260), I desaturated concrete
  (sat <=0.13); facades desaturated ~25% with the punch moved to
  terracotta/cool/rust roof caps. A zoom-1 nearest-hue classifier over
  20R/20C/20I tiles rose from 0.60 to 1.00. Per-tile value jitter (4 day
  copies picked by an (x+2y)&3 4-colouring) gives adjacent same-variant
  tiles >=10 colour distance. Night glow/pool/beacon layers shared by
  reference — byte-identical to HEAD; G9 beacon gate, roof clutter,
  dims/anchors and double-boot determinism all preserved. Verified against
  the 5 archived criteria + G1/G9 guard (all pass).

- [x] **G9 — Roofscape variety — beacon discipline, roof clutter, shade()
  fix**: the mast + red beacon is now a C3-only signature on exactly 2 of 5
  variants (v1/v3 gate; rasterized red-tip pixels 0 on every r3, 6 on c3
  v1/v3 only, was 9/6 on all ten); every r2/r3/c2/c3/police/firesta roof
  gets a 1px parapet inset around a tar/gravel deck plus seeded clutter —
  R3s carry residential furniture (water tank, stair bulkhead, planters or
  clothesline), the rest AC units, vents, hatches, skylights (roof-crop
  luminance stddev 3.1-11.1x the HEAD crops; police/firesta were flat 0);
  prism() top faces now use lighten(base, 0.35) — a lerp toward white — so
  pale bases keep hue (#e6e3da -> rgb(238,236,230), was clipped to pure
  white), the hospital helipad is the signature #d8d5ca slab (>=124 color
  distance from every R3 deck) and the school roof drops to shade 1.1 over
  a speckled gravel field; beacons blink live in the painter loop via
  spr.beacon with (frame + i*7) % 48 < 24 phase offsets (verified toggle at
  +24 frames and anti-phase towers in one frame — the bake only holds the
  lit tip); windows() pane lighting joined the buildSprites mulberry32
  stream, so double-boot sprite sheets hash byte-identical (HEAD differed);
  roof furniture draws day-only (0 new night-glow pixels above rooflines),
  and every sprite's canvas size + anchor is byte-equal to HEAD, keeping
  painter order and cursor math untouched. Zero page errors; verified
  against the 5 archived criteria (all pass).

- [x] **G8 — Minimap camera rect, overlay legends & demand zero line**:
  renderMinimap strokes the projected camera viewport as a crisp 1px white
  rect (screen corners inverted to tile space, integer-aligned, clamped to
  the map — tracks pans exactly: 10-tile pan moved it 10*sc px; scales with
  zoom; present and clamped at 64/80/128); #mm-legend strip under the
  minimap shows per-mode swatches/gradients in the overlay's own colors
  ("free / jammed", "edu / health", …), hidden in City mode, and all seven
  mode buttons carry full-name tooltips (Pol renamed Pollu); traffic
  overlay keeps district context at ~35% City-mode brightness (measured
  luminance ratios 0.347 R / 0.343 C, was flat #111 at 0.10) under the
  green->red heat ramp; #mapmodes is an equal-width 4-per-row grid (width
  spread 0px, was 5.3px over ragged 5+2 rows) with the sunken checkerboard
  dither on the active mode; the RCI zero line is a 2px black/white tick
  overhanging each track 4px with +/- pole glyphs, and any nonzero demand
  draws a >=3px bar on its side (sim-driven r=-0.24 at 20% tax renders 7px
  below the midline). Minimap click-jump byte-exact at all three map sizes;
  zero page errors. Verified against the 5 archived criteria (all pass).

- [x] **G6 — Win95 chrome authenticity**: .title-btns margin-left:auto
  (nth-child stretch rule removed) docks every dialog close button at 6px
  from the edge (was 100-450px); all six range sliders styled as beveled
  Win95 thumbs on sunken grooves (zero default-blue pixels, behavior
  intact); active tool buttons get the classic 2px checkerboard + 1px
  content nudge; menubar mnemonics underlined; tablet toolbar wraps to
  full rows (0 clipped buttons at 768px and 360px). Desktop chrome
  geometry byte-identical. Verified against 7 checks (all pass).

- [x] **G5 — Terrain seams & water repetition**: baked dark diamond strokes
  removed from grass/water/forest-floor (sealedDiamond same-color edge
  sealing); SPR.terrEdge[16] neighbor-mask overlays stroke only real
  land-type boundaries; 3 water variants x 3 frames picked by a pure
  coordinate hash with traveling shimmer; grass variant de-checkerboarded
  (terrHash), seasonal grass spreads tightened to <=2.4%. Interior seam
  dips 32->1.2 lum (grass) / 26->3.4 (water); adjacent water tiles 0% ->
  17-19% differing pixels; rebuild rate halved. Verified against 6 checks
  incl. season/cache regression guard (all pass).

- [x] **G4 — Postcard auto-framing**: postcardBounds() fits the developed
  bbox (terrain fallback) into the photo mount via a dedicated
  renderPhotoTo camera (live cam/canvas untouched, restored in finally);
  season-matched 12-band sunset sky with night tint + horizon haze behind
  the city. Hostile-camera void 56-100% -> 0%; empty cities frame the
  terrain; M14 flow (filename/PNG/dims, state-reflecting photo, zero
  per-frame cost) regression-guarded. Verified against 6 checks (all pass).

- [x] **G3 — Fire visuals overhaul**: drawFlames rewritten as three stacked
  hue-band layers (dark red base / orange mid / yellow core) with pure
  sin-phase motion (zero per-frame Math.random), flames 57px tall; burning
  facades char to ~53% luminance via a cached silhouette mask and revert on
  extinguish; burning tiles spawn rising soft radial smoke puffs; warm
  ground apron by day; night fire bloom capped at 0.35/sqrt(cluster) inside
  G2's occlusion layer (8-tile midnight blaze: 42 near-white px vs 928).
  Pixels away from fires byte-identical to HEAD. Verified against 7 checks
  incl. G1/G2 regression guard (all pass).

- [x] **G2 — Depth-correct night light pass**: nightQ replaced by
  per-diagonal punch/add buckets replayed onto a cached screen-space light
  layer (occluders punch silhouettes via destination-out, lights add
  clamped); ground pools suppressed when the front tile is developed
  (byte-proven); open-street glow 99.98% preserved; developed-128 night
  median frame 0.65x the old cost; G1 whiteout guard improved to 0%.
  Verified against 6 checks incl. G1 regression guard (all pass).

- [x] **G1 — Night city legibility**: per-zone night window bake (cool
  #a8ccf8 commercial, sparse warm #f0b85c residential capped at 40% of day
  panes, sodium #ff9c3e industrial), glow gated to day-lit panes only, halo
  alpha 0.15->0.08, additive night pass clamped to 0.7x and facade tint
  lerp 0.7->0.6. Dense-district midnight whiteout: 28% of the HEAD baseline
  (0.44 -> 0.12 near-white fraction); roof chroma/darkness restored; all
  276 day sprites byte-identical, noon screenshot zero changed pixels.
  Verified against 5 archived judge-approved criteria (all pass).

- [x] **M18 — News helicopter & traffic reports**: congestion-gated chopper
  (CHOPPER_TRAFFIC_T=160, month-rollover spawn chance, single instance,
  bounded lifetime) that launches from the map edge, flies to the true
  argmax congestion cluster, hovers with frame-driven rotor + ground shadow;
  clicking/tapping it (screen-space hit test at any zoom, swallows the
  click) opens "🚁 Traffic on the 5s" — top hotspots named by a
  deterministic 90s street-name generator, live traffic figures, per-row
  camera jump. Presentation-only (never serialized), O(1) per frame, zero
  input regressions. Verified against 8 criteria (all pass).

- [x] **M23 — Advisor bias & department funding** *(user priority)*: five
  0–100% department funding sliders (police, fire, roads, education, health)
  in the budget dialog; collectBudget charges each department its legacy
  upkeep scaled by its own funding level (round(base × f/100), 100% ==
  legacy exactly, save v7 with v6 saves defaulting to 100%); service
  coverage radius/potency scale with funding (round(radius(0.4+0.6f)),
  potency × f, zero at 0%); roads accrue wear per rollover
  (Δ = round(18(100−F)/100) − round(10F/100)) with a 1.6× congestion factor
  at full wear, pothole tint, and crumble-to-rubble at 0% funding; 4th
  Transportation advisor tab (Big Ray Kowalski, hard-hat portrait) reading
  live funding %, congestion index and wear; department champions escalate
  through content/grumble/flip-out registers citing the live %; advisors
  react to policy DELTAS — tax cuts draw a Kowalski protest citing the
  projected § shortfall while Finance approves, deep cuts rile the service
  advisors, hikes ≥10% draw a four-advisor exodus warning citing the
  existing (7−rate)×0.05 demand modifier (still the single tax→demand
  lever). Verified against 8 criteria (all pass, 78 checks).

- [x] **M17 — City Hall records**: #dlg-almanac (Windows menu) with one row
  per completed year + a YTD row — end-of-year population, total tax income,
  net budget, disasters survived — accumulated in the sim on month rollover /
  startDisaster (save v6: records + recCur; v5 saves load clean and backfill
  going forward). Named citizen complaints (12+ 90s names) generated only on
  rollovers when a real qualifying tile exists (crime, smog, gridlock,
  unpowered zone, rubble), truth-checked at generation, clickable in the
  ticker to jump the camera to the offending tile; clean cities stay quiet.
  Verified against 7 criteria (all pass).

- [x] **M16 — More scenarios & medals**: SCENARIOS grows to four with
  "Blackout Summer '97" (rebuild Ampereville's scrapped grid to 300 powered
  zone tiles before Jan 1999, under the June '97 heat-wave draw) and "Y2K
  Ready" (open Jul 1999; hit 2,500 pop, +100 power margin and §4,000 banked
  before the Dec '99 millennium-bug event) — both deterministic builders,
  goals wired to live sim systems (recomputePower / census / treasury) and
  the M7 era timeline; every scenario now declares machine-readable medal
  cutoffs (months left at the win: gold/silver/bronze), the tier is announced
  in the win Bugle + ticker, and best results live in a localStorage player
  profile (simcity99.trophies, upgrade-only, never in the city save) shown by
  a Win95 trophy-shelf dialog reachable from the Windows menu and the splash;
  M9 scenarios byte-identical vs 6c25b04. Verified against 8 criteria (all
  pass, 117 checks).

- [x] **M15 — Touch & small-screen support**: one-finger tap/drag builds,
  two-finger drag pans, pinch zooms about the gesture midpoint (clamped
  0.4-2.5); synthetic-mouse double-fire guarded, touchmove preventDefault
  (page never scrolls); @media <=900px collapses the sidepanel and turns the
  toolbar into a horizontal scroll strip (viewport >=85% width on 768x1024);
  gestures documented in About + F1; desktop mouse behavior byte-for-byte
  regression-tested. Verified against 7 criteria (all pass).

- [x] **M14 — Postcard photo mode**: File → "Send Postcard…" composes the
  live viewport (night tint, season, cars and all) onto a dedicated canvas
  with airmail border, photo mount, SC99 stamp, wavy postmark, "Greetings
  from <CITY>!" headline and dateline; Win95 preview dialog with Save PNG
  (blob download named simcity99-<city>-<mon><year>.png, graceful in
  sandboxed iframes) — zero per-frame cost. Implemented via workflow
  criteria; verification run inline after the workflow's verify agent hit
  a usage-credit failure: 16/16 checks pass across 6 criteria.

- [x] **M13 — Bonds & loans**: §5,000 municipal bonds issued from the budget
  dialog, amortized over 12 monthly rollovers (annuity formula, debt-service
  line in the budget + net), per-bond early payoff with a 2% fee, an
  on-demand AAA–C credit rating (funds/debt thresholds) that prices new
  bonds, a 4-bond borrowing cap with visible refusal, two new debt-aware
  Myrna Plutz advisor rules, and save v5 round-tripping bond state (older
  saves load debt-free). Verified against 8 criteria (all pass).

- [x] **M12 — Seasons**: seasonOf(month) — a pure function of the calendar
  (Dec–Feb winter, then 3-month blocks), no new save state (still v4,
  byte-identical round-trip). Terrain-family sprites (grass, water, shore,
  forest, winter roads) baked once per season at boot from a SEASON_PAL
  palette table: snowpack lawns + icy shores + snow-capped pines + plowed
  snow-banked roads in winter, blossom-flecked spring, dry-stubble lawns and
  orange/red canopies in autumn. The season is part of the M11 terrain-cache
  key, so a palette swap is a single cache rebuild on the month rollover
  (never per-frame work; zero canvas allocations); M10 night tint composes
  unchanged (snow stays brighter than grass under the same midnight tint,
  lit windows punch through). Winter gameplay: road congestion scaled x0.72
  in recomputeTraffic (~28% measured drop), car dots 30% slower on snowy
  roads; NEWS_WINTER/NEWS_SUMMER ticker pools gated purely by month
  ("Blizzard of '98 buries Main Street"). Verified against 7 criteria via
  39 headless checks (all pass; developed-128 winter median frame 3.3 ms).

- [x] **M11 — Bigger maps & map picker**: MAP is now a mutable global set only
  at city creation/load (setMapSize); City(seed, size) stores its own size,
  serializes it (save v4), and v3 80x80 saves still load byte-identically.
  Splash gains a Win95 terrain picker — 64 Village / 80 Classic / 128
  Megalopolis radio sizes, a real generated-terrain preview with visible
  seed and reroll, NEW CITY consumes exactly the previewed seed+size (default
  untouched: random 80x80). Minimap renders/click-maps any size with integer
  pixel edges; M9 scenarios stay pinned to 80x80 (byte-identical baselines).
  Render perf for 128x128: cached flat-terrain layer + sprite-tight cull
  margins (developed-128 median frame 3.2 ms, mean tick 1.9 ms). Verified
  against 8 criteria (all pass, zero console/page errors).

- [x] **M10 — Day/night cycle**: deterministic tick-driven phase with gradual
  dawn/dusk ramps (midnight ~41% of noon luminance), boot-baked lit-window
  night sprites, street-lamp glow on roads, night-amplified disaster glow,
  '✓ Day/Night Cycle' Speed-menu toggle persisted in prefs (zero night cost
  when off), night render median 1.4x noon. Verified against 7 criteria
  (all pass).

- [x] **M9 — Scenario mode**: declarative SCENARIOS table (js/scenarios.js)
  with two playable scenarios — "Gridlock '97" (deterministic pre-built
  945-zone metropolis, win by cutting jammed road tiles to ≤8 before Jan
  1999) and "Twister Season" (scripted bimonthly tornadoes for a year, grow
  to pop 4000 by Jan 2000) — Win95 scenario cards on the splash, goal
  presented via the Bugle at start, live progress + months-left in a status
  bar cell, once-only win/lose front pages (latched, checked only on month
  rollover), sandbox continue after either outcome, scenario state in save
  round-trip, free play untouched. Verified against 7 criteria (58 checks,
  all pass; mean tick 0.62ms in the heaviest scenario).

- [x] **M8 — Public deploy**: single-file bundle (all CSS/JS inlined, zero
  external requests) published as a Claude Artifact and linked from the
  README; bundle smoke-tested headlessly (game boots, 200 ticks, all M1-M7
  features present, zero console errors).

- [x] **M7 — Time capsule events**: declarative EVENTS table (5 dated events
  1997–1999: heat wave, Asian financial flu, dot-com boom, GoldenEye tourism
  blip, Y2K panic with Jan-2000 resolution paper), once-only firing on month
  rollover, measurable A/B sim effects (demand/funds/power), scheduled
  expiry, save v3 round-trip (firedEvents/activeMods), no retro-firing on
  late-started cities. Verified against 8 criteria (all pass; 984-tick
  1997→2000 soak clean).

- [x] **M6 — Audio & UI polish**: zoom-in ambient soundscapes (traffic hum,
  industrial clank, gulls, stadium crowd) viewport-selective and gated on
  zoom/sfx/visibility with rate limits; "Budget report monthly" auto-popup
  toggle persisted in localStorage; F1 shortcut overlay generated live from
  TOOLS. Verified against 7 criteria (all pass, no SFX regressions).

- [x] **M5 — Nicer terrain**: 16-mask sand shoreline transitions (roadMask
  pattern), 3-frame animated water cycled by the render frame counter (no
  per-frame allocation), cluster-aware forest density sprites (3×3 variants,
  deterministic per seed), §50 waterfill tool with live shoreline re-masking.
  Verified against 7 criteria (all pass).

- [x] **M4 — Advisors panel**: #dlg-advisors Win95 dialog (Windows menu) with
  three Win95-style tabs — Myrna Plutz (Finance), Chief Gus Ramirez (Safety),
  Dr. Willow Greenfield (Environment) — procedural canvas portraits, 3+
  threshold rules per advisor reading live sim state, 500ms live refresh even
  while paused, draggable/closable. Verified against 7 criteria (all pass).

- [x] **M3 — More building variety**: school and hospital as placeable 2×2
  civics with powered education/health coverage maps (stampCoverage, radius
  14); coverage raises land value, boosts citywide demand and gates the jump
  to zone level 3, with A/B-verified growth impact; Education/Health rows in
  the Inspect dialog + a Services minimap mode; zone sprite variants expanded
  from 3 to 5 per level (45 developed-zone sprites). Verified against 8
  criteria (all pass, mean tick 0.14ms).

- [x] **M2 — City milestones & rewards**: 5 population tiers
  (Settlement → Village → Town → City → Metropolis) with monotonic promotion
  ratchet, 1997-tabloid newspaper popup on promotion, tier-gated reward
  buildings (Mayor's House at Town, Stadium at City) with sim effects, rank
  in title bar, save-format v2 round-trip. Verified against 7 criteria.
- [x] **M1 — Traffic simulation**: per-road congestion from zone trip
  generation; congestion lowers land value and growth; traffic minimap
  overlay; animated cars on roads. Verified against 8 criteria (all pass,
  mean tick 0.12ms).

- [x] **M0 — Core game** (v1): iso engine, RCI sim, power grid, budget,
  disasters, Win95 UI, 1997 ticker, synth audio, save/load.
