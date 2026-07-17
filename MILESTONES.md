# SimCity 99 — Milestone Queue

Worked top-to-bottom. Each milestone is completed against success criteria
defined by an independent reviewer agent before implementation starts.
Queue policy: keep at least 5 open improvements at all times.

## In progress

- [ ] **M16 — More scenarios & medals**: extend the M9 SCENARIOS table with
  2-3 more scripted challenges (e.g. "Blackout Summer": rebuild a grid after
  the '97 heat wave; "Y2K Ready": bunker the city before Dec 1999), plus
  bronze/silver/gold results by finish date and a trophy shelf dialog.

## Open

- [ ] **M17 — City Hall records**: a stats almanac dialog (yearly population,
  budget, disasters survived), plus named citizens ticker complaints tied to
  real tile problems (click to jump the camera there).
- [ ] **M18 — Helicopter & traffic copter reports**: a news chopper that
  flies over congestion hotspots at random intervals; clicking it opens a
  live "Traffic on the 5s" report naming the worst intersections.
- [ ] **M19 — Power plant variety & aging**: gas and wind plants, plants age
  and lose capacity after ~30 years with rebuild prompts, coal smog scales
  with load; power mix pie in the budget window.
- [ ] **M20 — Soundtrack expansion**: 3-4 distinct generative music moods
  (calm building, bustling metropolis, disaster tension, night jazz) that
  crossfade based on sim state; music credits easter egg in About.
- [ ] **M21 — Land value visualization & districts**: named districts painted
  by the player, per-district stats in a dialog, district names on the map at
  low zoom (SC2K-style neighborhood labels).

## Done

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
