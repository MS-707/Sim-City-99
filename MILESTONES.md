# SimCity 99 — Milestone Queue

Worked top-to-bottom. Each milestone is completed against success criteria
defined by an independent reviewer agent before implementation starts.
Queue policy: keep at least 5 open improvements at all times.

## In progress

- [ ] **G16 — Living-city motion pass** (graphics audit): orient car bodies
  along travel, scale the car pool with map size, headlight/taillight pixels,
  smoke/tornado/UFO polish. Criteria: docs/gfx-audit-slate.json.

## Open

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

- [ ] **G7r — City Graphs empty-state fix** *(judge-corrected replacement for
  rejected G7)*: the graphs dialog draws a blank white box until 2+ months of
  history exist (every fresh city); add axes, gridline labels, and a 'Collecting
  data — check back in February' empty state, and verify traces appear from the
  second month rollover onward.

## Done

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
