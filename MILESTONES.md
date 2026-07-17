# SimCity 99 — Milestone Queue

Worked top-to-bottom. Each milestone is completed against success criteria
defined by an independent reviewer agent before implementation starts.
Queue policy: keep at least 5 open improvements at all times.

## In progress

- [ ] **M3 — More building variety**: school and hospital as placeable civics
  with sim effects (education/health boost growth caps); more sprite variants
  per zone level. (Stadium already exists as the M2 City-tier reward.)

## Open

- [ ] **M4 — Advisors panel**: Win95 dialog with tabbed advisors (Finance,
  Safety, Environment) giving live, rule-based advice from sim state.
- [ ] **M5 — Nicer terrain**: shoreline edge tiles (beach transitions), water
  animation, tree autoclustering; bulldoze-to-waterfill tool.
- [ ] **M6 — Audio & UI polish**: per-building ambient sounds when zoomed in,
  budget window monthly auto-popup toggle, keyboard shortcut overlay (F1).
- [ ] **M7 — Time capsule events**: dated 1997→1999 in-game events that affect
  the sim (dot-com boom C demand spike, Y2K panic mini-event on Dec 1999).
- [ ] **M8 — Public deploy**: publish a playable build as a shareable web page
  and link it from the README.

## Done

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
