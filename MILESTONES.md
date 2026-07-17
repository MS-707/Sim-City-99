# SimCity 99 — Milestone Queue

Worked top-to-bottom. Each milestone is completed against success criteria
defined by an independent reviewer agent before implementation starts.
Queue policy: keep at least 5 open improvements at all times.

## In progress

- [ ] **G3 — Fire that reads as fire** (graphics audit): layered smooth-phase
  flames (no per-frame random strobing), 2-3x taller with three hue bands,
  char/darken burning facades, rising smoke puffs, capped night fire bloom.
  Criteria: docs/gfx-audit-slate.json.
- [ ] **M19 — Power plant variety & aging**: gas and wind plants, plants age
  and lose capacity after ~30 years with rebuild prompts, coal smog scales
  with load; power mix pie in the budget window.
- [ ] **M20 — Soundtrack expansion**: 3-4 distinct generative music moods
  (calm building, bustling metropolis, disaster tension, night jazz) that
  crossfade based on sim state; music credits easter egg in About.
- [ ] **M21 — Land value visualization & districts**: named districts painted
  by the player, per-district stats in a dialog, district names on the map at
  low zoom (SC2K-style neighborhood labels).
- [ ] **M22 — Ordinances**: city ordinances dialog (curfew, recycling,
  carpool incentive, arcade tax) with monthly costs/benefits wired into the
  sim, unlocked by tier; advisors recommend relevant ordinances.

### Graphics & UI audit slate (judge-approved, ultracode audit)

- [ ] **G1 — Night city legibility — per-zone window bake & tamed glow**: Rework the boot-baked night window layer in js/sprites.js windows(): per-zone lighting character (cool blue-white panes for C, sparse ~30-40% warm panes for R, sodium-orange for I), skip panes dark in…
  (5 judge-approved criteria in docs/gfx-audit-slate.json)
- [ ] **G2 — Depth-correct night light pass**: Fix the painter-order violation where drawNightLights() (js/render.js:229) blits the whole nightQ additively after the full scene, letting street-lamp halos, C3 lobby spill and I2/I3 floodlight pools…
  (5 judge-approved criteria in docs/gfx-audit-slate.json)
- [ ] **G3 — Fire that reads as fire — layered flames, char state, capped night bloom**: Overhaul drawFlames()/fire glow in js/render.js: replace per-frame Math.random() strobing with smooth sin-phase animation, layer each flame (dark red-orange base, brighter inner, yellow core) 2-3x tal…
  (6 judge-approved criteria in docs/gfx-audit-slate.json)
- [ ] **G4 — Postcard auto-framing — no more black void**: Before rendering the M14 postcard snapshot, compute the bounding box of developed (fallback: terrain) tiles and center+scale the postcard camera so the city fills the photo mount; fill any offscreen a…
  (5 judge-approved criteria in docs/gfx-audit-slate.json)
- [ ] **G5 — Terrain seam & water repetition fix**: Kill the 'tiled bathroom floor' look: stroke tile edges only where terrain type changes (land/water, grass/forest) and fade same-type interior strokes to <= 0.05 alpha so lakes and meadows read as con…
  (5 judge-approved criteria in docs/gfx-audit-slate.json)
- [ ] **G6 — Win95 chrome authenticity fixes**: Fix the broken/anachronistic chrome: replace the css/style.css:47 nth-child flex rule so every dialog close button docks flush right (or add .title-btns { margin-left: auto }); style range inputs as W…
  (6 judge-approved criteria in docs/gfx-audit-slate.json)
- [ ] **G8 — Minimap camera rect, overlay legends & demand-meter zero line**: Make the map's information layer trustworthy: stroke the projected camera-viewport rectangle on the minimap every frame in renderMinimap() (js/render.js ~399); show a one-line legend strip under the m…
  (5 judge-approved criteria in docs/gfx-audit-slate.json)
- [ ] **G9 — Roofscape variety — beacon discipline, roof clutter, shade() fix**: Break the identical-red-beacon monotony and the empty-roof problem in js/sprites.js: make the mast+red-tip a C3-only signature on 2 of 5 variants; give R3 variants residential roof furniture (water ta…
  (5 judge-approved criteria in docs/gfx-audit-slate.json)
- [ ] **G10 — Zone color identity — R/C/I readable from the main view**: End the hue lottery: constrain each zone's procedural palette to its minimap hue family (R warm brick/cream/terracotta, C cool glass blues/teals/grays, I desaturated ochre/rust/concrete), drop facade…
  (5 judge-approved criteria in docs/gfx-audit-slate.json)
- [ ] **G11 — Civic buildings that players can find**: Give the 2x2 civics skyline presence and identity: raise police/hospital massing to ~50-60px (or add landmark elements clearing the 68px skyline — police comms mast cluster, hospital tower wing behind…
  (5 judge-approved criteria in docs/gfx-audit-slate.json)
- [ ] **G12 — Road art upgrade — width, curbs, junctions, dash continuity**: Rework roadSprite() in js/sprites.js: widen asphalt from the 0.28-0.72 arm quad to ~0.6-0.7 of the edge with a 1px lighter curb line each side; stop center-line dashes at ~60% of the way to center on…
  (5 judge-approved criteria in docs/gfx-audit-slate.json)
- [ ] **G13 — Shoreline & forest naturalization**: Soften the coast and the forests: flatten the beach band (drop/dim the sandHi outer-lip highlight), jitter band width per edge with seeded noise, and add corner wedge fills so the coast curves instead…
  (5 judge-approved criteria in docs/gfx-audit-slate.json)
- [ ] **G14 — Seasons reach the buildings and every tree**: Stop the city floating on the snow: bake a winter variant per zone/civic sprite overpainting top faces (and tinyHouse roof planes) with pal.snowCap plus an eave drip line — the seasonal bake loop and…
  (5 judge-approved criteria in docs/gfx-audit-slate.json)
- [ ] **G15 — Splash screen joins the 1997 identity**: Rebuild the splash as the same game: stage it on the teal Win95 desktop (or inside a maximized Win95 window), render a procedural isometric skyline strip from the actual sprite set beneath the logo, r…
  (6 judge-approved criteria in docs/gfx-audit-slate.json)
- [ ] **G16 — Living-city motion pass — cars, smoke, tornado, UFO**: One js/render.js effects iteration: orient car bodies along their travel axis (two iso-direction shapes), scale the 70-car pool cap with map size, and queue warm headlight cones + red taillight pixels…
  (6 judge-approved criteria in docs/gfx-audit-slate.json)
- [ ] **G7r — City Graphs empty-state fix** *(judge-corrected replacement for
  rejected G7)*: the graphs dialog draws a blank white box until 2+ months of
  history exist (every fresh city); add axes, gridline labels, and a 'Collecting
  data — check back in February' empty state, and verify traces appear from the
  second month rollover onward.

## Done

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
