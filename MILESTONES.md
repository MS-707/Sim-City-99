# SimCity 99 — Milestone Queue

Worked top-to-bottom. Each milestone is completed against success criteria
defined by an independent reviewer agent before implementation starts.
Queue policy: keep at least 5 open improvements at all times.

## In progress

- [ ] **GQ1 — Daytime palette & water vibrancy** *(graphics roadmap 1/10)* —
  running via dynamic workflow. Gates in `docs/graphics-roadmap.json`.

## Open

> Rotation staging + criteria live in `docs/rotation-design.json`; the
> gameplay-queue designs + 8-criteria specs for M22/M24/M25 live in
> `docs/queue-specs.json` (ultracode design workflows, judge-approved).

- [ ] **M31 — Garbage & waste management**: zones generate garbage by activity;
  dispose via a paint-style Landfill (scars land value/pollution as it
  saturates) or a tier-gated Waste-to-Energy incinerator (2×2, eats garbage,
  trickles power); a recycling ordinance cuts the stream; overflow becomes a
  growing pollution + complaint source.

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

- [ ] **GQ1 — Daytime palette & water vibrancy** *(palette)*: full summer/noon
  saturation + a night-lerp that never goes cold-monochrome + livelier water.
  **Gates:** water S≥60% & bluest in frame · day saturation ≥2× deepest night ·
  warm night accents present · parks S≥45% green · geometry byte-identical to HEAD.
- [ ] **GQ2 — Ground-material quilt** *(groundscape)*: noise-driven grass/dirt/
  sand/pavement with dithered per-tile variation + relief tone; no blank slabs.
  **Gates:** ≥4 materials/view w/ per-tile noise · no NxN flat block · varied at
  1.0 & 0.4 zoom · cache rebuilds only on season/size, frame within ~20% · deterministic.
- [ ] **GQ3 — Zone-correlated building palette** *(buildings)*: curated per-zone/
  density facade hues, lit/shadow by HSL shift. **Gates:** ≥6 hue buckets ·
  nearest-hue classifier ≥0.9 zone-correct · adjacent variants ≥10 color dist ·
  G1 night legibility preserved · deterministic.
- [ ] **GQ4 — Vegetation & street trees** *(groundscape)*: dense tree stands +
  street trees along ≥70% of straight roads (placement-only). **Gates:** ≥1
  multi-tile stand · ≥70% road-edge coverage · legal placement · perf within ~20% · deterministic.
- [ ] **GQ5 — Building silhouette variety** *(buildings)*: 3–4 non-prism massings
  + a 6+ rooftop prop library. **Gates:** ≥12 grayscale-distinct silhouettes ·
  levels 1–5 distinct · ≥6 seeded roof props · anchors unchanged (painter/picking
  intact vs HEAD) · deterministic.
- [ ] **GQ6 — Reflective-glass facades** *(buildings)*: period-correct
  banded/ordered-dither curtain-wall + mullions + reflection streaks (not a
  modern gradient). **Gates:** banding/dither measured (not smooth gradient) ·
  mullions present · C-high-density-gated · silhouette/anchor unchanged · deterministic.
- [ ] **GQ7 — Road markings & asphalt** *(transport)*: asphalt fill + dashed
  center-lines/lane-edges/crosswalks baked into all 16 masks, rotation-correct.
  **Gates:** markings on straights + crosswalks at junctions · correct across 4
  rotations · asphalt darker than lots · night lamps + cars unregressed · deterministic.
- [ ] **GQ8 — Building cast-shadows & aliveness guard** *(buildings)*: directional
  drop-shadows onto neighbor tiles + a regression guard on motion. **Gates:**
  shadow pixels sun-opposite · direction matches tree/car shadows · traffic/smoke/
  water/train ≥ HEAD baseline · shadows day-only (no night bleed) · deterministic.
- [ ] **GQ9 — Shorelines & suspension bridges** *(terrain-water + transport)*:
  beveled beach/foam ramps on every water border + auto-spanning bridges over
  flat water gaps. **Gates:** no hard 1px shoreline · foam/wet-sand band · bridge
  towers+cable+hangers+deck on road/rail-over-water · rotation-correct + picking
  intact · save unchanged.
- [ ] **GQ10 — Special buildings gap-fill** *(specials)*: surface/tune M28
  landmarks, then author airport group + a 2nd power plant + a seaport/marina.
  **Gates:** ≥8 special silhouettes (incl. hero readable at 0.3 zoom) · airport
  placeable · 2nd plant visually distinct + sim-wired · seaport on water · new
  ids save-round-trip.

> **Stretch (deferred, NOT one of the 10):** **GQ-EPIC — true elevation
> heightmap** (integer per-tile height, cliffs, sea-level pooling). Effort-5;
> breaks the flat painter order (`s=x+y`), click-picking, the terrain cache,
> `updateCars`/minimap, multi-tile leveling, and the save format, and must
> reconcile with `TERR.WATER`/waterfill/pump/M29 flood. Revisit only after GQ1–10.


## Done

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
