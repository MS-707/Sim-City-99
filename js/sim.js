/* ============ SimCity 99 — simulation core ============ */
"use strict";

// ---- shared constants ----
const TW = 64, TH = 32, HW = TW / 2, HH = TH / 2; // iso tile metrics
let MAP = 80;                                      // current map edge, MAP x MAP tiles (M11)
const MAP_SIZES = [64, 80, 128];                   // sizes offered by the splash picker
// The whole codebase indexes tiles as i = y * MAP + x against this one global.
// It is only ever changed here, at city creation / load time, so every array
// and every indexing site stays consistent with the city that owns the world.
function setMapSize(n) { MAP = n; }

const TERR = { GRASS: 0, WATER: 1, FOREST: 2 };

const OV = {
  NONE: 0, ROAD: 1, WIRE: 2, ZR: 3, ZC: 4, ZI: 5, PARK: 6,
  POLICE: 7, FIRESTA: 8, COAL: 9, SOLAR: 10, RUBBLE: 11,
  MAYOR: 12, STADIUM: 13, SCHOOL: 14, HOSPITAL: 15,
  // M19: two new generators join coal/solar. GAS is a big fossil peaker
  // (high output, coal-level smog); WIND is a clean low-output farm.
  GAS: 16, WIND: 17,
  // M26: a WIREROAD is a single tile that is simultaneously a ROAD (for
  // access/traffic/rendering/wear/pollution) AND a POWER CONDUCTOR. It is
  // created ONLY by crossing an existing road with a wire (or an existing
  // wire with a road) — never any other way. It lets power lines cross roads
  // without routing around the street grid.
  WIREROAD: 18,
  // M24: a SECOND utility network — water. PIPE is the strict analog of WIRE
  // (a flooded conductor of "water" laid FLAT in the street), WATERTOWER and
  // PUMP are the two providers. They append after WIREROAD=18 and NEVER
  // renumber 0..18 (v9 pins these ids in over[]). Because they are all >= ZR,
  // the power flood + every "developed zone" idiom MUST exclude them (see
  // isWaterOv + the recomputePower/startDisaster guards) — a pipe must never
  // conduct electricity.
  PIPE: 19, WATERTOWER: 20, PUMP: 21,
  // M28: arcologies & wonder landmarks — large SELF-POWERED mega-structures that
  // continue the contiguous id run after PUMP=21 (over[] is a Uint8Array, so
  // 22..28 round-trip for free with NO save change). Arcologies 22..25 house a
  // big fixed pop/jobs; landmarks 26..28 stamp land value. Keeping arcos in the
  // 22..25 block and landmarks in 26..28 makes isArco/isLandmark/isMega cheap
  // range tests that can never mislabel an existing 0..21 type.
  PLYMOUTH: 22, FOREST: 23, DARCO: 24, LAUNCH: 25,
  STATUE: 26, EIFFEL: 27, PYRAMID: 28,
};

// M25: RAIL — a THIRD network, but on a SEPARATE PLANE (city.rail, a Uint8Array)
// rather than in over[]. This is the load-bearing decision: over[] byte values
// never change, so no OV id / >= OV.ZR / conducts() / road-predicate site sees a
// new value. A city with rail produces the EXACT same over[]/power/access/traffic
// (before diversion)/pollution/land-value maps as the identical city with the
// rail plane zeroed — rail only ADDS the ridership diversion on top.
//   TRACK   surface rail (visible; can share a tile with a road = a grade crossing)
//   SUB     subway (invisible except in the transit overlay + vents; runs under anything)
//   STATION 1x1 rider magnet + network node + upkeep unit; bridges surface<->subway
const RL = { NONE: 0, TRACK: 1, SUB: 2, STATION: 3 };

// footprint (w,h) per overlay type
const OV_SIZE = {
  [OV.POLICE]: 2, [OV.FIRESTA]: 2, [OV.COAL]: 2, [OV.SOLAR]: 2,
  [OV.STADIUM]: 2, [OV.SCHOOL]: 2, [OV.HOSPITAL]: 2,
  [OV.GAS]: 2, [OV.WIND]: 2, // M19
  [OV.PUMP]: 2,              // M24: the pump is a 2x2 station (tower is 1x1)
  // M28: arcologies & landmarks are LARGE footprints (all > 2), driven by the
  // same anc[] anchor pattern the 2x2 civics use — every footprint tile stores
  // anc = the min-corner index, and census/render/power key on anc === i.
  [OV.PLYMOUTH]: 3, [OV.FOREST]: 3, [OV.DARCO]: 4, [OV.LAUNCH]: 4,
  [OV.STATUE]: 3, [OV.EIFFEL]: 3, [OV.PYRAMID]: 4,
};
const sizeOf = (t) => OV_SIZE[t] || 1;

// M19: which overlay types are power generators (participate in the supply
// sum, upkeep, aging and the budget power mix — and are never counted as a
// power CONSUMER by the demand scan). One predicate used everywhere so the
// four generator types stay perfectly in sync.
const isPlant = (t) => t === OV.COAL || t === OV.SOLAR || t === OV.GAS || t === OV.WIND;

// M24: the water-network overlays. isWaterOv is the ANTI-CROSSTALK predicate —
// used at every recomputePower conducts()/demand/brownout/y2k site so a pipe,
// tower or pump never carries electricity nor counts as a power consumer.
// isWaterSrc is the two providers (a tower/pump that seeds the water flood).
const isWaterOv = (t) => t === OV.PIPE || t === OV.WATERTOWER || t === OV.PUMP;
const isWaterSrc = (t) => t === OV.WATERTOWER || t === OV.PUMP;

// M28: mega-structure predicates — the SINGLE source of truth each, mirroring
// isPlant/isWaterOv. isArco (22..25) are the pop/jobs carriers counted once per
// anchor in recomputeDemand. isLandmark (26..28) are the land-value stampers.
// isMega spans BOTH (arco+landmark) and is the POWER-ISLAND guard appended to
// every recomputePower "t >= OV.ZR" idiom (conducts/seed/demand/brownout/y2k):
// a mega footprint is always internally lit, never draws grid demand, and never
// conducts/bridges power across itself. Every predicate returns false for all
// existing 0..21 types, so a city that places none is byte-identical to pre-M28.
const isArco = (t) => t >= OV.PLYMOUTH && t <= OV.LAUNCH;
const isLandmark = (t) => t >= OV.STATUE && t <= OV.PYRAMID;
const isMega = (t) => t >= OV.PLYMOUTH && t <= OV.PYRAMID;

// population / jobs per developed zone level (index 0 unused)
const RES_POP = [0, 8, 24, 56];
const COM_JOB = [0, 6, 18, 40];
const IND_JOB = [0, 8, 22, 48];

// M28: fixed population / jobs each arcology houses. Counted EXACTLY ONCE per
// structure in recomputeDemand (keyed anc === i), so a 4x4 Launch Arco adds its
// 3000 once, never ×16. Jobs all land in the industrial (iJobs) bucket. These
// magnitudes are balance knobs; the Launch Arco alone can push a city up a tier.
const ARCO_POP = { [OV.PLYMOUTH]: 900, [OV.FOREST]: 600, [OV.DARCO]: 2400, [OV.LAUNCH]: 3000 };
const ARCO_JOB = { [OV.PLYMOUTH]: 300, [OV.FOREST]: 200, [OV.DARCO]: 800, [OV.LAUNCH]: 1000 };
// M28: manhattan radius each wonder landmark radiates civic-pride land value.
// stampLandmarkPride() peaks the potency via a base-1.5 falloff, max-combined
// across landmarks, into the derived landmarkCov array (rebuilt every pass).
const LANDMARK_R = { [OV.STATUE]: 14, [OV.EIFFEL]: 16, [OV.PYRAMID]: 18 };

// ---- districts (M21) ----
// A metadata paint layer, fully orthogonal to OV.*. DIST_MAX matches the fixed
// palette so a district id (1..DIST_MAX) always has a color; a district's `col`
// is an INDEX into DISTRICT_COLS, not a color string — tiny to serialize,
// deterministic, and every viewer (map label, minimap, legend) paints from the
// same table with zero conversion. 12 saturated, mutually distinct Win95-ish
// hues so neighbors never read as the same neighborhood.
const DIST_MAX = 12;
const DISTRICT_COLS = [
  "#e04040", "#e08a2a", "#d8c828", "#7cc030",
  "#30b060", "#28b0b8", "#3878d8", "#5848c8",
  "#9848c0", "#d84898", "#a86840", "#8890a0",
];

/* ---- power plant capacity & aging (M19) ----
   POWER_CAP is the NAMEPLATE (young, full-health) output each generator adds
   to the grid supply. Gas is the biggest single plant (well above coal), wind
   the smallest (well below solar). The wind figure already folds in a real
   wind farm's ~35% capacity factor — an 80-cap "farm" stands in for a much
   larger installed nameplate — so the grid contribution is a fixed, fully
   deterministic 80 (no per-tick RNG, so determinism is preserved).

   Aging: every plant records the calendar year it was built (plantYear[],
   keyed by anchor tile, serialized in save v8). Its EFFECTIVE contribution
   follows a documented curve of AGE = currentYear - buildYear:
       age <= 30            -> 100% of nameplate   (prime years)
       30 < age < 45        -> linear decay        (1 - 0.5*(age-30)/15)
       age >= 45            -> 50% of nameplate     (end-of-life floor)
   The curve is applied in recomputePower's supply sum, so a young plant is
   worth full nameplate and an ancient one measurably less. Bulldozing and
   rebuilding resets the build year (fresh nameplate). From PLANT_WARN_AGE on,
   a "the old plant is failing — rebuild it" notice hits the ticker. */
const POWER_CAP = { [OV.COAL]: 300, [OV.SOLAR]: 120, [OV.GAS]: 450, [OV.WIND]: 80 };

/* ---- water network capacity & reach (M24) ----
   WATER_CAP is the number of SERVED consumer tiles each energized provider can
   support: the always-on tower is the smaller/pricier-per-tile gravity fallback
   (buildable anywhere, needs no power), the coast-only pump is the cheap-per-tile
   workhorse (needs POWER + a water neighbour). WATER_REACH is the manhattan
   radius the pipe/source coverage stamp reaches, so a building near the mains
   taps in WITHOUT a pipe on its own lot (the SC2000 coverage model). All are
   first-pass balance knobs: single named constants, none touch the save format. */
const WATER_CAP = { [OV.WATERTOWER]: 150, [OV.PUMP]: 400 };
const WATER_REACH = 3;

/* ---- rail / transit tuning (M25) ----
   RAIL_STATION_R  manhattan catchment radius of a live station's ridership
                   draw (cheaper than police's 12; scaled by transit funding).
   RAIL_MAX_SHARE  a station diverts at most this fraction of a served zone's
                   road trips — an arterial near a line COOLS but never fully
                   empties (the cap the compose constraint pins at <= 0.60). */
const RAIL_STATION_R = 7;
const RAIL_MAX_SHARE = 0.60;
const WATER_LABEL = { [OV.WATERTOWER]: "water tower", [OV.PUMP]: "water pump" };
const PLANT_PRIME_AGE = 30;   // full nameplate through this age
const PLANT_EOL_AGE   = 45;   // decayed to the floor by here
const PLANT_MIN_FACTOR = 0.5; // end-of-life output = 50% of nameplate
const PLANT_WARN_AGE  = 40;   // start nagging the mayor to rebuild

function plantAgeFactor(age) {
  if (age <= PLANT_PRIME_AGE) return 1;
  if (age >= PLANT_EOL_AGE) return PLANT_MIN_FACTOR;
  return 1 - (1 - PLANT_MIN_FACTOR) * (age - PLANT_PRIME_AGE) / (PLANT_EOL_AGE - PLANT_PRIME_AGE);
}

// human-readable plant names for the query panel and the aging ticker notice
const PLANT_LABEL = {
  [OV.COAL]: "coal plant", [OV.SOLAR]: "solar array",
  [OV.GAS]: "gas plant", [OV.WIND]: "wind farm",
};

const COST = {
  bulldoze: 1, road: 10, wire: 5, zr: 100, zc: 100, zi: 100,
  park: 50, tree: 25, waterfill: 50,
  police: 500, firesta: 500, coal: 3000, solar: 5000,
  gas: 4500, wind: 2500, // M19
  pipe: 8, watertower: 500, pump: 2000, // M24: water network
  rail: 20, subway: 45, station: 300, // M25: rail network (station is the pricey node)
  school: 400, hospital: 600,
  mayor: 0, stadium: 500, // milestone rewards — gifts (or nearly so)
  // M28: arcologies (endgame vertical growth) + wonder landmarks (prestige).
  plymouth: 15000, forest: 12000, darco: 60000, launch: 100000,
  statue: 8000, eiffel: 12000, pyramid: 20000,
};

// ---- city milestones (M2) ----
// rank ladder; a city is TIERS[k] once pop >= TIERS[k].pop (monotonic ratchet)
const TIERS = [
  { name: "Settlement", pop: 0 },
  { name: "Village",    pop: 100 },
  { name: "Town",       pop: 400 },
  { name: "City",       pop: 1500 },
  { name: "Metropolis", pop: 5000 },
];

// reward tools gated behind a minimum tier (index into TIERS)
// M25: mass transit is gated behind Town (tier 2) — the city "grows into" rail,
// matching the mayor/stadium reward-unlock pacing. place() already refuses a
// tool with TOOL_TIER>tier as {ok:false,reason:"locked"}, and the toolbar dims it.
// M28: arcologies stagger their unlocks up the ladder — Plymouth/Forest at City
// (tier 3), the endgame Darco/Launch at Metropolis (tier 4). place() already
// returns {ok:false,reason:"locked"} when TOOL_TIER[tool] > city.tier, and the
// toolbar dims the button with a padlock via minTier. Landmarks stay ungated.
const TOOL_TIER = { mayor: 2, stadium: 3, rail: 2, subway: 2, station: 2, // Town / City
  plymouth: 3, forest: 3, darco: 4, launch: 4 }; // M28: City / Metropolis

/* ---- city ordinances (M22) ----
   Citywide policy booleans the mayor toggles from the #dlg-ordinances panel.
   An ordinance is NOT a placed tile — it is a scalar policy whose effect is
   FOLDED into passes that already run (recomputeMaps/Traffic/Demand + fireTick)
   via the pop-INDEPENDENT cache city.ordMods, rebuilt only on toggle/load by
   recomputeOrdinances(). With nothing enacted every mul is 1 and every additive
   0, so the sim is byte-identical to the pre-M22 baseline.

   Each entry declares:
     minTier   index into TIERS gating BOTH the enact validator and the effect
               fold (a hand-edited save that flips a locked flag applies nothing
               until the monotonic tier ratchet legitimately reaches it — same
               sticky-reward idiom as TOOL_TIER).
     champion  the advisor key (M23) that recommends it — ordinances are policy,
               not real departments, so the champion IS the advisor, no mapping.
     cost/revenue  optional c=>§ functions read at rollover with LIVE pop/comJobs/
               resTiles so the monthly figure scales with the city.
     mods      the static scalars folded into ordMods: muls (pollMul/trafficMul)
               multiply, additives (crimeCut/fireBurn/demR/demC/demI) sum.
   Adding a 7th ordinance is a one-row change — dialog, advisors and budget all
   iterate this registry. */
const ORDINANCES = [
  { id: "watch", name: "Neighborhood Watch", icon: "👁️", champion: "safety", minTier: 1,
    blurb: "Block captains with walkie-talkies — cuts street crime.",
    cost: (c) => Math.round(c.pop * 0.03), mods: { crimeCut: 14 } },
  { id: "recycle", name: "Citywide Recycling", icon: "♻️", champion: "environment", minTier: 1,
    blurb: "Curbside blue bins curb industrial & roadway pollution.",
    cost: (c) => Math.round(c.pop * 0.045), mods: { pollMul: 0.72 } },
  { id: "nostalgiaTax", name: "Arcade & Nostalgia Tax", icon: "🕹️", champion: "finance", minTier: 1,
    blurb: "Sin-tax on arcades & Beanie Babies: revenue, but dents commercial demand.",
    revenue: (c) => Math.round(c.comJobs * 0.9), mods: { demC: -0.06 } },
  { id: "curfew", name: "Teen Curfew", icon: "🌙", champion: "safety", minTier: 2,
    blurb: "Quiet streets after dark — safer, but the mall & arcade nightlife suffers.",
    cost: (c) => Math.round(c.pop * 0.03), mods: { crimeCut: 18, demC: -0.06 } },
  { id: "carpool", name: "Carpool Incentive", icon: "🚗", champion: "transport", minTier: 2,
    blurb: "Diamond lanes & rideshare boards ease road congestion citywide.",
    cost: (c) => Math.round(c.pop * 0.025), mods: { trafficMul: 0.80 } },
  { id: "smoke", name: "Smoke-Detector Mandate", icon: "🚨", champion: "safety", minTier: 2,
    blurb: "Fires are caught early — they burn out faster.",
    cost: (c) => Math.round(c.resTiles * 1.5), mods: { fireBurn: 1 } },
];
const ORD = (id) => ORDINANCES.find((o) => o.id === id);
// identity effect cache — the shape city.ordMods always takes; folded muls
// default to 1 (no change), additives to 0. recomputeOrdinances rebuilds from
// this, so nothing-enacted === pre-M22 arithmetic exactly.
function identityOrdMods() {
  return { pollMul: 1, trafficMul: 1, crimeCut: 0, fireBurn: 0, demR: 0, demC: 0, demI: 0 };
}

function tierForPop(pop) {
  let k = 0;
  for (let t = 1; t < TIERS.length; t++) if (pop >= TIERS[t].pop) k = t;
  return k;
}

/* ---- municipal bonds & credit rating (M13) ----
   One instrument: a §5,000 general-obligation bond amortized over 12 monthly
   rollovers (collectBudget charges the debt service — see the comments there
   for the exact amortization formula). Borrowing cap: the city may float at
   most BOND_MAX = 4 concurrent bonds, at any rating — the market refuses a
   5th issue outright.

   Credit rating: an ordinal 5-grade scale, best to worst
       AAA > AA > A > B > C
   recomputed ON DEMAND (a pure function of city state, evaluated whenever
   the budget dialog renders or a bond is issued — no month rollover needed).
   Documented threshold rules, as penalty points starting from 0:
       funds <  0            +2   (treasury underwater)
       0 <= funds < 2000     +1   (dangerously thin cushion)
       +1 per active bond         (debt load)
       grade = RATINGS[min(points, 4)]
   Each grade maps to the APR offered on NEW bonds (rateOffered). Bonds that
   are already issued keep the rate stamped on them at issue time forever. */
const BOND_PRINCIPAL = 5000;
const BOND_TERM = 12;   // months
const BOND_MAX = 4;     // concurrent-bond borrowing cap (any rating)
const RATINGS = [
  { grade: "AAA", rate: 0.05 },
  { grade: "AA",  rate: 0.07 },
  { grade: "A",   rate: 0.10 },
  { grade: "B",   rate: 0.14 },
  { grade: "C",   rate: 0.20 },
];

function creditRating(c) {
  let p = 0;
  if (c.funds < 0) p += 2;
  else if (c.funds < 2000) p += 1;
  p += c.bonds.length;
  const k = Math.min(p, RATINGS.length - 1);
  return { grade: RATINGS[k].grade, rateOffered: RATINGS[k].rate, level: k };
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

/* ---- seasons (M12) ----
   The season is a pure function of the calendar month — identical every year,
   never serialized. Dec/Jan/Feb = winter, then three-month blocks. A fresh
   city (January 1997) therefore boots straight into winter. */
function seasonOf(month) {
  return month === 11 || month <= 1 ? "winter"
       : month <= 4 ? "spring"
       : month <= 7 ? "summer" : "autumn";
}

/* ---- time capsule events (M7) ----
   One declarative timeline drives every dated event: on each month rollover
   tick() calls eventsTick(), which compares each entry's (year, month) to the
   sim date and fires it exactly once (tracked in city.firedEvents). Entries
   whose date is already behind us when a city is created or loaded are marked
   fired silently — no retro headlines. Deleting an entry from this table
   removes that event entirely.
   Effect specs (declarative, consumed by fireEvent / recompute*):
     { type:'funds', amount:±n }                      one-time treasury change
     { type:'demandR'|'demandC'|'demandI',
       add:±x, months:n|null }                        demand shift (null = forever)
     { type:'powerDemand', mult:x, months:n }         power-draw multiplier
     { type:'y2k', months:n }                         grid flicker + panic wires
   paper:true also publishes a newspaper edition through the M2 #dlg-news
   queue; resolve:{...} is announced the month the effect's timer runs out. */
const EVENTS = [
  { id: "heatwave-97", year: 1997, month: 5,
    headline: "🌡️ RECORD HEAT WAVE BAKES THE CITY — EVERY AC ON FULL BLAST",
    effect: { type: "powerDemand", mult: 1.25, months: 3 } },
  { id: "asian-flu-97", year: 1997, month: 10,
    headline: "📉 ASIAN MARKET FLU BITES THE CITY TREASURY — A §1,500 BATH ON THE BAHT",
    effect: { type: "funds", amount: -1500 } },
  { id: "dotcom-boom-98", year: 1998, month: 5, paper: true,
    headline: "🌐 DOT-COM GOLD RUSH HITS MAIN STREET!",
    sub: "Every storefront wants a website; commercial space 'hotter than a Pentium II'",
    body: "Venture capitalists in khakis were spotted downtown waving term sheets " +
      "at anyone with a modem. Analysts expect the boom in commercial demand to " +
      "last into the next millennium. \"We put an 'e' in front of the deli,\" " +
      "said one shopkeeper. \"It's worth forty million now.\"",
    effect: { type: "demandC", add: 0.3, months: null } },
  { id: "euro-99", year: 1999, month: 0,
    headline: "💶 EURO LAUNCHES ACROSS THE POND — CITY EXPORTERS EYE NEW MARKETS",
    effect: { type: "demandI", add: 0.08, months: 3 } },
  { id: "y2k-panic-99", year: 1999, month: 11, paper: true,
    headline: "🖥️ MILLENNIUM BUG PANIC! WILL CITY COMPUTERS SURVIVE NEW YEAR'S?",
    sub: "Experts split on whether the grid dies at midnight or merely civilization",
    body: "With the odometer about to roll over to 2000, city technicians admit " +
      "the mainframe still thinks in two digits. Lights are flickering, pagers " +
      "are shrieking, and the hardware store is sold out of candles, beans and " +
      "blank VHS tapes. The mayor urges calm, from a bunker.",
    effect: { type: "y2k", months: 1 },
    resolve: { paper: true,
      headline: "🎉 Y2K: COMPUTERS FINE, CITY HALL'S TAMAGOTCHI UNAFFECTED",
      sub: "Midnight passes; the only casualty is a VCR blinking 12:00 forever",
      body: "The new millennium arrived and the city's computers greeted it with " +
        "a cheerful beep. Power is stable, the treasury still knows what year it " +
        "is, and the emergency bean reserves will feed the council for a decade. " +
        "\"We were never worried,\" said officials, emerging from the bunker." } },
];

/* ---- City Hall records & citizen complaints (M17) ----
   Yearly records: city.records = [{year, pop, taxes, net, disasters}], one
   entry per COMPLETED calendar year, finalized on the Dec→Jan rollover; the
   in-progress year lives in city.recCur (same shape minus pop, which is
   sampled live). Both are maintained by the sim itself — updateRecords() on
   each month rollover plus a disaster counter bump in startDisaster() — and
   both are serialized (save v6; older saves load with an empty almanac).

   Citizen complaints: scanComplaints() runs on month rollovers only and emits
   at most one structured complaint ({complaint:true, kind, name, x, y, text})
   into the ticker queue. Documented qualifying thresholds (COMPLAINT_T):
     crime      city.crime[i]   >= COMPLAINT_T.crime
     poll       city.poll[i]    >= COMPLAINT_T.poll
     traffic    (over[i]===OV.ROAD || over[i]===OV.WIREROAD) && city.traffic[i] >= COMPLAINT_T.traffic
     unpowered  over[i] in {ZR,ZC,ZI} && lvl[i] > 0 && !powered[i]
     rubble     over[i]===OV.RUBBLE
   Deterministic backstop: while any qualifying tile persists, a complaint is
   guaranteed within COMPLAINT_EVERY (= 3, well under 8) consecutive rollovers
   — the scan is one bounded pass over the map, no retry loops. */
const COMPLAINT_T = { crime: 100, poll: 100, traffic: 170 };
const COMPLAINT_EVERY = 3; // guaranteed-complaint window, in month rollovers

// 90s-flavored citizen name pool: 16 x 12 combinations, all distinct
const CITIZEN_FIRST = [
  "Todd", "Brandi", "Chad", "Tiffany", "Dylan", "Misty", "Kurt", "Shania",
  "Corey", "Tanya", "Lance", "Daria", "Skeeter", "Roberta", "Biff", "Winona",
];
const CITIZEN_LAST = [
  "Grunge", "McDial", "Pagerman", "Van Winkle", "Modemski", "Bublitz",
  "Frisbee", "Tamagucci", "Rollerblad", "Winslow", "Zima", "Flannelli",
];

// problem-specific complaint copy — every line carries the citizen's name
const COMPLAINT_TEXT = {
  crime: (n) => `📠 Angry fax from ${n}: hoodlums swiped the hubcaps off the Geo AND the garden gnome. Crime is out of control!`,
  poll: (n) => `📠 Angry fax from ${n}: the smog on this block could chew through a Discman. Do something about the pollution!`,
  traffic: (n) => `📠 Angry fax from ${n}: gridlock so bad the Macarena played twice before the light changed. Fix this road!`,
  unpowered: (n) => `📠 Angry fax from ${n}: still no power — the Tamagotchi is dead and the VCR won't even blink 12:00!`,
  rubble: (n) => `📠 Angry fax from ${n}: the rubble next door is still there! Clean it up before property values go full Titanic.`,
};

// panicked wire chatter while the Y2K effect is active (Dec 1999 only)
const Y2K_LINES = [
  "🖥️ Y2K watch: mainframe insists the year is 19100. Officials 'looking into it.'",
  "📟 Y2K watch: citizens stockpile canned beans, batteries and AOL trial CDs.",
  "💡 Y2K watch: streetlights flicker downtown. Utility blames two-digit gremlins.",
  "🏧 Y2K watch: ATM dispenses Monopoly money. Bank calls it 'forward compatible.'",
];

// ---- deterministic-ish PRNG (so terrain can be reseeded) ----
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ========================= M27: NEIGHBORING CITIES ========================= */
// Four WORLD-fixed map edges: 0=N (y==0), 1=E (x==MAP-1), 2=S (y==MAP-1), 3=W
// (x==0). This order is world-fixed and NEVER reads cam.r, so rotation can only
// move the on-screen label — the region MODEL is rotation-invariant by
// construction. Every effect (power trade, § trade, commuter demand) is GATED on
// an OPEN border connection, so an island city contributes a literal +0 to
// supply, budget net, and per-tile demand — the pre-M27 byte-identity guarantee.
const EDGE_SALT = [0x9E3779B1, 0x85EBCA77, 0xC2B2AE3D, 0x27D4EB2F];
const NEIGHBOR_NAMES = [
  "Ludlow", "Fort Ramsey", "New Boccaccio", "Cedar Junction", "Aberdeen",
  "Portsworth", "Elk Hollow", "Verona Falls", "Grimsby", "Onondaga",
  "Blackwater", "Saint Cloud", "Harmony", "Duskerton", "Millbrook", "Rio Verde",
];
// Per-seed personalities. sellLo/sellHi bound the neighbor's §/MW sell price;
// commLo/commHi bound its commuter strength (scaled demand units). pref is the
// deal the neighbor LIKES (1=you sell to them, 2=you buy from them) — drives the
// deterministic disposition nudge on a successful Propose.
const ARCHETYPES = [
  { key: "industrial", label: "Industrial town", sellLo: 8,  sellHi: 14, commLo: 4,  commHi: 10, pref: 1,
    blurb: "A hungry factory town — it will always buy your surplus power." },
  { key: "suburb",     label: "Bedroom suburb",  sellLo: 10, sellHi: 18, commLo: 30, commHi: 60, pref: 2,
    blurb: "A wealthy bedroom community that floods your shops with commuters." },
  { key: "metropolis", label: "Metropolis",      sellLo: 6,  sellHi: 11, commLo: 15, commHi: 35, pref: 2,
    blurb: "A big neighbor with cheap power to sell and a steady stream of workers." },
  { key: "agrarian",   label: "Farm county",     sellLo: 12, sellHi: 20, commLo: 2,  commHi: 8,  pref: 1,
    blurb: "A quiet farm county — low activity, but it pays well for juice." },
];
// integer in the inclusive band [lo, hi], pulled from one rng() draw.
function intBand(rng, lo, hi) { return lo + ((rng() * (hi - lo + 1)) | 0); }
// PURE function of seed: identical seed => identical 4-neighbor array, all
// integer fields => exact reproduction. Called in the ctor AND deserialize;
// NEVER serialized (same policy as district centroids / ordMods / watered[]).
// Draw order per edge is FIXED: name, archetype, priceSell, priceBuy, commuter,
// disposition0 — reordering would change every seed's region, so it is frozen.
function computeNeighbors(seed) {
  const out = [];
  for (let e = 0; e < 4; e++) {
    const rng = mulberry32((seed ^ EDGE_SALT[e]) | 0);
    const name = NEIGHBOR_NAMES[(rng() * NEIGHBOR_NAMES.length) | 0];
    const arche = ARCHETYPES[(rng() * ARCHETYPES.length) | 0];
    const priceSell = intBand(rng, arche.sellLo, arche.sellHi);
    const priceBuy = priceSell + intBand(rng, 2, 6);
    const commuter = intBand(rng, arche.commLo, arche.commHi);
    const disposition0 = 20 + ((rng() * 60) | 0);
    out.push({ name, archetype: arche.key, label: arche.label, blurb: arche.blurb,
      pref: arche.pref, priceSell, priceBuy, commuter, disposition0 });
  }
  return out;
}

class City {
  constructor(seed, size = 80) {
    this.size = size;
    setMapSize(size);        // FIRST: every array below is sized from MAP
    const n = MAP * MAP;
    this.terr    = new Uint8Array(n);
    this.over    = new Uint8Array(n);   // OV.*
    this.lvl     = new Uint8Array(n);   // zone development level 0..3
    this.varnt   = new Uint8Array(n);   // sprite variant
    this.anc     = new Int32Array(n).fill(-1); // anchor index for multi-tile
    this.powered = new Uint8Array(n);
    // M24: DERIVED water state, all rebuilt by recomputeWater() (never
    // serialized — exactly like powered[]/access[]). watered[] is the graded
    // coverage/pressure stamp (0 = dry, up to 255 right on the mains);
    // _waterReach is the BFS reached-tile scratch, allocated once & .fill(0)
    // reused each pass (no per-tick GC, like _trafficLoad).
    this.watered = new Uint8Array(n);
    this._waterReach = new Uint8Array(n);
    this.waterSupply = 0; this.waterDemand = 0; this.waterPressure = 1;
    // M25: RAIL — the ONE new serialized field (rail[]). Everything else here is
    // DERIVED and rebuilt on load like access/traffic/coverage: railNet (flood
    // component id, -1=none), stationLive (1 iff a powered station on a >=2-station
    // component), railCov (0..255 ridership catchment). railRiders (trips/mo
    // diverted, for UI), railDirty (mirrors powerDirty), metroOpened (one-time
    // ticker gate) are all ephemeral scalars.
    this.rail        = new Uint8Array(n); // RL.* — the SEPARATE rail plane
    this.railNet     = new Int32Array(n).fill(-1);
    this.stationLive = new Uint8Array(n);
    this.railCov     = new Uint8Array(n);
    this.railRiders  = 0;
    this.railDirty   = false;
    this.metroOpened = false;
    this.access  = new Uint8Array(n);   // 1 = road within reach
    this.fire    = new Uint8Array(n);   // burning ticks remaining
    this.unpow   = new Uint8Array(n);   // consecutive unpowered growth passes
    this.poll    = new Uint8Array(n);   // pollution 0..255
    this.landv   = new Uint8Array(n);   // land value 0..255
    this.crime   = new Uint8Array(n);   // crime 0..255
    this.polCov  = new Uint8Array(n);   // police coverage
    this.fireCov = new Uint8Array(n);   // fire dept coverage
    this.eduCov  = new Uint8Array(n);   // school (education) coverage
    this.medCov  = new Uint8Array(n);   // hospital (health) coverage
    // M28: wonder-landmark civic-pride land-value stamp. DERIVED — rebuilt from
    // over[] by stampLandmarkPride() every recomputeMaps and NEVER serialized
    // (same policy as polCov/watered/railCov), so bulldozing a landmark fully
    // reverts its land-value halo on the next pass with zero bookkeeping.
    this.landmarkCov = new Uint8Array(n);
    this.traffic = new Uint8Array(n);   // road congestion 0..255 (roads only)
    // M19: build year of the power plant anchored at each tile (0 = no plant
    // here). Only meaningful at anchor tiles; drives the aging capacity curve.
    // Serialized in save v8.
    this.plantYear = new Int32Array(n);
    this.warnedPlants = {};             // anchors already nagged near end-of-life (ephemeral)
    // M21: district metadata layer, fully orthogonal to over[]/lvl[]/anc[].
    // district[i] = per-tile id (0 = unassigned, 1..DIST_MAX). districts[] =
    // metadata [{id, name, col}] where col indexes DISTRICT_COLS. distRev is
    // ephemeral (like terrRev): bumped on every paint/edit, keys the render
    // label-centroid cache; never serialized. NONE of these feed the sim update
    // path — tick()/recompute*/growthPass never read them, so seed determinism
    // is byte-identical whether or not any tiles are districted.
    this.district = new Uint8Array(n);
    this.districts = [];
    this.distRev = 0;

    this.funds = 20000;
    this.taxRate = 7;               // percent
    // M23: per-department funding levels, 0..100 (% of full funding).
    // A fresh city funds everything at 100%. Serialized in save v7.
    this.funding = { police: 100, fire: 100, roads: 100, edu: 100, health: 100, transit: 100 };
    this.roadWear = new Uint8Array(n); // M23: road wear 0..255 (save v7)
    this.month = 0; this.year = 1997;
    this.tickCount = 0;
    this.pop = 0; this.jobs = 0;
    this.comJobs = 0; this.resTiles = 0; // M22: cached counts for ordinance §
    this.demand = { r: 0.4, c: 0.1, i: 0.5 };
    this.powerDemand = 0; this.powerSupply = 0;
    this.history = { pop: [], funds: [] };
    this.lastBudget = { taxes: 0, roads: 0, power: 0, services: 0, water: 0, debt: 0, net: 0,
      trade: 0, // M27: regional power-trade line
      ord: 0, ordCost: 0, ordRev: 0, // M22: ordinance budget line
      dept: { police: 0, fire: 0, roads: 0, edu: 0, health: 0, water: 0, transit: 0 } }; // M24 water / M25 transit upkeep
    this.bonds = [];                // municipal bonds (M13): {principal, rate, term, remaining, monthly, balance}
    this.disastersEnabled = true;
    this.disaster = null;           // {kind:'tornado'|'ufo', x, y, ticks}
    this.powerDirty = true;
    this.terrRev = 0;               // bumped whenever terrain pixels change (render cache key)
    this.devRev = 0;                // bumped on build/doze/ignite (night-layer cache key, G2)
    this.messages = [];             // ticker event queue
    this.cityName = "Llamaville";
    this.tier = 0;                  // index into TIERS, only ever rises
    // M22: enacted-ordinance flags (id->true only when on; absent = off) plus
    // the DERIVED effect cache. ordinances is serialized (save v9); ordMods is
    // rebuilt by recomputeOrdinances() on toggle/load and NEVER serialized.
    this.ordinances = {};
    this.ordMods = identityOrdMods();
    this.announcedTier = 0;         // highest tier already announced (newspaper)
    this.newsQueue = [];            // pending newspaper editions (tier indices or event editions)
    this.firedEvents = [];          // time-capsule event ids already fired/passed (M7)
    this.activeMods = [];           // live event modifiers with remaining-month timers
    // scenario mode (M9): active scenario id, result latches, best metric sample
    this.scenarioId = null;
    this.scnWon = false; this.scnLost = false;
    this.scnBest = 9999;            // running best (lowest) scenario metric
    // City Hall records (M17): completed years + in-progress accumulator
    this.records = [];              // [{year, pop, taxes, net, disasters}]
    this.recCur = { year: this.year, taxes: 0, net: 0, disasters: 0 };
    this.sinceComplaint = 0;        // rollovers since the last citizen complaint

    this.generateTerrain(seed ?? ((Math.random() * 1e9) | 0));

    // M27: neighboring cities & regional connections. neighbors is a PURE
    // function of this.seed (set by generateTerrain just above) — recomputed on
    // load, never serialized. deals + disp are the ONLY serialized region state;
    // conn[] (border scan) + commuterBias[] (per-tile demand bump) are DERIVED
    // and rebuilt by updateConnections()/recomputeRegion() in the tick + load
    // cascades. Defaults (all deals none, disp = seed-derived initial) make an
    // untouched city behave byte-identically to pre-M27.
    this.neighbors = computeNeighbors(this.seed);
    this.deals = [0, 0, 0, 0].map(() => ({ mode: 0, mw: 0, commute: false }));
    this.disp = new Int32Array(4);
    for (let e = 0; e < 4; e++) this.disp[e] = this.neighbors[e].disposition0;
    this.conn = [0, 0, 0, 0].map(() => ({ road: false, wire: false, rail: false }));
    this.commuterBias = new Float32Array(n);
  }

  idx(x, y) { return y * MAP + x; }
  inMap(x, y) { return x >= 0 && y >= 0 && x < MAP && y < MAP; }

  // ---------- terrain generation ----------
  generateTerrain(seed) {
    this.seed = seed;
    const rnd = mulberry32(seed);
    // coarse random grid, bilinear-interpolated => smooth heightmap
    // coarse-grid resolution scales with map size so terrain features keep a
    // constant absolute scale; MAP = 80 yields C = 9, the pre-M11 constant,
    // so a given seed still generates the exact same classic-size map.
    const C = Math.round(MAP / 10) + 1, cell = MAP / (C - 1);
    const g = [];
    for (let i = 0; i < C * C; i++) g.push(rnd());
    const hAt = (x, y) => {
      const gx = Math.min(x / cell, C - 1.001), gy = Math.min(y / cell, C - 1.001);
      const x0 = gx | 0, y0 = gy | 0, fx = gx - x0, fy = gy - y0;
      const sm = (t) => t * t * (3 - 2 * t);
      const a = g[y0 * C + x0], b = g[y0 * C + x0 + 1];
      const c = g[(y0 + 1) * C + x0], d = g[(y0 + 1) * C + x0 + 1];
      return a + (b - a) * sm(fx) + (c - a) * sm(fy) + (a - b - c + d) * sm(fx) * sm(fy);
    };
    for (let y = 0; y < MAP; y++) for (let x = 0; x < MAP; x++) {
      const h = hAt(x, y) + (rnd() - 0.5) * 0.14;
      const i = this.idx(x, y);
      if (h < 0.34) this.terr[i] = TERR.WATER;
      else if (h > 0.62 && rnd() < 0.75) this.terr[i] = TERR.FOREST;
      else this.terr[i] = TERR.GRASS;
      if (this.terr[i] === TERR.FOREST) this.varnt[i] = (rnd() * 3) | 0;
      if (this.terr[i] === TERR.GRASS) this.varnt[i] = (rnd() * 4) | 0;
    }
  }

  // ---------- building / bulldozing ----------
  canPlace(tool, x, y) {
    if (tool === "waterfill") {
      // only bare grass or rubble may be flooded; anything else refuses
      if (!this.inMap(x, y)) return false;
      const i = this.idx(x, y);
      if (this.terr[i] !== TERR.GRASS) return false;
      return this.over[i] === OV.NONE || this.over[i] === OV.RUBBLE;
    }
    // M25: rail-plane tools validate against city.rail, NEVER over[] — dispatched
    // here (before the over[] footprint loop) exactly like the waterfill early-out.
    // toolOverlay() returns OV.NONE for these, so the generic loop would wrongly
    // refuse a station on empty land etc.
    if (tool === "rail" || tool === "subway" || tool === "station") {
      if (!this.inMap(x, y)) return false;
      const i = this.idx(x, y);
      if (this.rail[i] !== RL.NONE) return false;         // one rail feature per tile
      if (tool === "subway") return true;                 // tunnels under ANY over[]/terr (incl. water)
      if (tool === "station")                             // 1x1 magnet: empty, non-water land only
        return this.over[i] === OV.NONE && this.terr[i] !== TERR.WATER;
      // surface rail (TRACK): bare ground, or a grade crossing on a road; water OK (a bridge)
      return this.over[i] === OV.NONE || this.over[i] === OV.ROAD || this.over[i] === OV.WIREROAD;
    }
    const s = sizeOf(toolOverlay(tool));
    for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) {
      const X = x + dx, Y = y + dy;
      if (!this.inMap(X, Y)) return false;
      const i = this.idx(X, Y);
      if (tool === "bulldoze") continue;
      // M26: a wire may cross an existing road, and a road may cross an
      // existing wire — both make a WIREROAD crossing. Every OTHER occupied
      // tile (zones, buildings, plants, existing crossing, rubble) still refuses.
      if (tool === "wire" && this.over[i] === OV.ROAD) continue;
      if (tool === "road" && this.over[i] === OV.WIRE) continue;
      if (this.over[i] !== OV.NONE) return false;
      if (this.terr[i] === TERR.WATER) {
        // only roads & wires may bridge water
        if (tool !== "road" && tool !== "wire") return false;
      }
      if (this.terr[i] === TERR.FOREST && (tool === "tree")) return false;
    }
    // M24: a water PUMP is a hard terrain gate — the 2x2 footprint (all land +
    // empty, enforced above) must have >=1 orthogonal TERR.WATER neighbour, else
    // it can't be built at all (a dry pump would be useless). The always-buildable
    // tower is the landlocked fallback so water is never un-buildable on a map.
    if (tool === "pump") {
      let adj = false;
      for (let dy = 0; dy < 2 && !adj; dy++) for (let dx = 0; dx < 2 && !adj; dx++) {
        const X = x + dx, Y = y + dy;
        for (const [nx, ny] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const NX = X + nx, NY = Y + ny;
          if (this.inMap(NX, NY) && this.terr[this.idx(NX, NY)] === TERR.WATER) { adj = true; break; }
        }
      }
      if (!adj) return false;
    }
    return true;
  }

  toolCost(tool, x, y) {
    let c = COST[tool] ?? 0;
    if ((tool === "road" || tool === "wire" || tool === "rail") && this.inMap(x, y) &&
        this.terr[this.idx(x, y)] === TERR.WATER) c *= 5; // bridges cost more (surface rail spans water too)
    return c;
  }

  place(tool, x, y) {
    if (tool === "bulldoze") return this.bulldoze(x, y);
    if ((TOOL_TIER[tool] || 0) > this.tier) return { ok: false, reason: "locked" };
    if (!this.canPlace(tool, x, y)) return { ok: false, reason: "blocked" };
    const cost = this.toolCost(tool, x, y);
    if (this.funds < cost) return { ok: false, reason: "funds" };
    // M25: rail-plane tools write city.rail (never over[]). 1x1, no anc bookkeeping.
    // A rail build sets railDirty (NOT powerDirty) — the power grid is unchanged.
    if (tool === "rail" || tool === "subway" || tool === "station") {
      const i = this.idx(x, y);
      this.rail[i] = tool === "rail" ? RL.TRACK : tool === "subway" ? RL.SUB : RL.STATION;
      this.funds -= cost;
      this.railDirty = true;
      this.devRev++;
      if (tool === "station")
        return { ok: true, cost, hint: "🚉 Station built — link it to another by rail to open the line." };
      return { ok: true, cost };
    }
    const type = toolOverlay(tool);
    if (tool === "tree") {
      const i = this.idx(x, y);
      this.terr[i] = TERR.FOREST; this.varnt[i] = (Math.random() * 3) | 0;
      this.funds -= cost;
      this.terrRev++;
      return { ok: true, cost };
    }
    if (tool === "waterfill") {
      const i = this.idx(x, y);
      this.terr[i] = TERR.WATER; this.over[i] = OV.NONE; // clears rubble
      this.lvl[i] = 0; this.anc[i] = -1; this.varnt[i] = 0;
      if (this.rail[i] !== RL.NONE) { this.rail[i] = RL.NONE; this.railDirty = true; } // M25: flooding leaves no ghost line
      this.funds -= cost;
      this.powerDirty = true; // water blocks conduction & road access
      this.terrRev++;
      return { ok: true, cost };
    }
    const s = sizeOf(type);
    const a = this.idx(x, y);
    for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) {
      const i = this.idx(x + dx, y + dy);
      // M26: crossing a wire over an existing road (or a road over an existing
      // wire) fuses the two into a single WIREROAD tile that both conducts and
      // carries traffic. anc stays -1 / lvl 0 exactly like a plain road/wire.
      let put = type;
      if (tool === "wire" && this.over[i] === OV.ROAD) put = OV.WIREROAD;
      else if (tool === "road" && this.over[i] === OV.WIRE) put = OV.WIREROAD;
      this.over[i] = put; this.lvl[i] = 0; this.anc[i] = a;
      this.varnt[i] = (Math.random() * 5) | 0;
      this.plantYear[i] = 0;
      if (this.terr[i] === TERR.FOREST) { this.terr[i] = TERR.GRASS; this.terrRev++; }
    }
    // M19: a freshly built plant is brand new — stamp its build year so it
    // starts at full nameplate capacity and ages from here.
    if (isPlant(type)) { this.plantYear[a] = this.year; delete this.warnedPlants[a]; }
    this.funds -= cost;
    this.powerDirty = true;
    this.devRev++;
    return { ok: true, cost };
  }

  bulldoze(x, y) {
    if (!this.inMap(x, y)) return { ok: false, reason: "blocked" };
    let i = this.idx(x, y);
    // M25 PEEL RULE: rail is always removed LAST. When something still sits on
    // over[] (a zone, road, building), the normal path below razes THAT and
    // leaves any subway/track beneath intact; only once over[] is bare does a
    // bulldoze clear the exposed rail feature. So razing a zone over a subway is
    // a two-step removal (zone first, tunnel second), and a grade crossing keeps
    // its ROAD/WIREROAD over[] value while its TRACK is peeled separately.
    if (this.over[i] === OV.NONE && this.rail[i] !== RL.NONE) {
      if (this.funds < COST.bulldoze) return { ok: false, reason: "funds" };
      this.rail[i] = RL.NONE;
      this.funds -= COST.bulldoze;
      this.railDirty = true;
      this.devRev++;
      return { ok: true, cost: COST.bulldoze };
    }
    if (this.over[i] === OV.NONE && this.terr[i] !== TERR.FOREST)
      return { ok: false, reason: "nothing" };
    if (this.funds < COST.bulldoze) return { ok: false, reason: "funds" };
    if (this.over[i] === OV.NONE) { // clear forest
      this.terr[i] = TERR.GRASS;
      this.funds -= COST.bulldoze;
      this.terrRev++;
      return { ok: true, cost: COST.bulldoze };
    }
    // remove the whole multi-tile building
    const a = this.anc[i] >= 0 ? this.anc[i] : i;
    const ax = a % MAP, ay = (a / MAP) | 0;
    const s = sizeOf(this.over[a]);
    for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) {
      const j = this.idx(ax + dx, ay + dy);
      this.over[j] = OV.NONE; this.lvl[j] = 0; this.anc[j] = -1;
      this.fire[j] = 0; this.unpow[j] = 0;
      this.plantYear[j] = 0; // M19: demolishing a plant clears its build year
    }
    delete this.warnedPlants[a];
    this.funds -= COST.bulldoze;
    this.powerDirty = true;
    this.devRev++;
    return { ok: true, cost: COST.bulldoze };
  }

  // ---------- power network ----------
  recomputePower() {
    // M27: refresh the border-scan connection state FIRST so power trade (and
    // the commuter pass that runs right after) read the current border layout.
    this.updateConnections();
    this.powered.fill(0);
    let supply = 0;
    const q = [];
    // M26: OV.WIREROAD (a road+wire crossing) satisfies this predicate, so it
    // conducts and is flooded exactly like a plain wire — the whole point.
    // M24 ANTI-CROSSTALK: the water overlays (PIPE/WATERTOWER/PUMP) are all
    // non-NONE/non-ROAD/non-RUBBLE, so without this exclusion they would WRONGLY
    // conduct electricity like a wire. A pipe carries water, never power.
    const conducts = (i) => this.over[i] !== OV.NONE && this.over[i] !== OV.ROAD
      && this.over[i] !== OV.RUBBLE && !isWaterOv(this.over[i]) && !isMega(this.over[i]); // M28: a mega footprint never routes power THROUGH itself (an arco can't bridge a wire across)
    for (let i = 0; i < this.over.length; i++) {
      if (isPlant(this.over[i]) && this.anc[i] === i) {
        // M19: a plant contributes its AGED effective capacity, not its raw
        // nameplate — full through age 30, decaying to 50% by age 45.
        supply += this.plantEffectiveCap(i);
      }
      if (isPlant(this.over[i])) {
        this.powered[i] = 1; q.push(i);
      }
      // M28: a mega-structure is a power ISLAND — always internally lit, but it
      // is NOT pushed to the flood queue, so it powers itself yet seeds NO
      // neighbor (conducts() also excludes it, so the flood can't enter it).
      if (isMega(this.over[i])) this.powered[i] = 1;
    }
    while (q.length) {
      const i = q.pop();
      const x = i % MAP, y = (i / MAP) | 0;
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const X = x + dx, Y = y + dy;
        if (!this.inMap(X, Y)) continue;
        const j = this.idx(X, Y);
        if (!this.powered[j] && conducts(j)) { this.powered[j] = 1; q.push(j); }
      }
    }
    // demand = number of developed/zoned consumer tiles that got power
    let demand = 0;
    for (let i = 0; i < this.over.length; i++) {
      const t = this.over[i];
      if (this.powered[i] && t >= OV.ZR && t !== OV.WIRE && t !== OV.RUBBLE
          && t !== OV.WIREROAD && !isPlant(t) && !isWaterOv(t) && !isMega(t)) demand++; // M26: crossing is not a consumer; M24: water infra never draws power; M28: a self-powered mega adds ZERO net demand
    }
    // event modifiers can inflate the draw (e.g. the '97 heat wave)
    let pdMult = 1;
    for (const m of this.activeMods)
      if (m.type === "powerDemand" && m.mult) pdMult *= m.mult;
    if (pdMult !== 1) demand = Math.round(demand * pdMult);
    // M27: fold in regional power trade BEFORE the supply/demand comparison — a
    // SELL lowers available supply (can induce brownouts), a BUY raises it
    // (relieves them), reusing the existing brownout branch below unchanged. With
    // no open-wire connection or all deals none, the delta is literally 0.
    supply = Math.max(0, supply + this.powerTradeDelta(supply, demand));
    this.powerSupply = supply; this.powerDemand = demand;
    if (demand > supply && supply > 0) {
      // brownout: cut power to a fraction of consumers
      const cutRatio = 1 - supply / demand;
      for (let i = 0; i < this.powered.length; i++) {
        const t = this.over[i];
        if (this.powered[i] && t >= OV.ZR && t !== OV.WIREROAD && !isPlant(t) &&
            !isWaterOv(t) && !isMega(t) && Math.random() < cutRatio) this.powered[i] = 0; // M26: crossing isn't a consumer to brown out; M24: water infra isn't a consumer; M28: a power island can't be browned out
      }
      this.pushMsg("⚡ BROWNOUTS reported — the grid is over capacity! Build more power plants.");
    } else if (supply === 0 && demand === 0) {
      this.powered.fill(0);
      // M28: the "empty grid" cleanup must NOT extinguish self-powered islands —
      // an arco/landmark on a plant-less map stays lit. No-op with no mega present
      // (isMega false everywhere), so the pre-M28 baseline is byte-identical.
      for (let i = 0; i < this.over.length; i++) if (isMega(this.over[i])) this.powered[i] = 1;
    }
    // Y2K bug (Dec '99): systems flicker at random, grid capacity be damned
    if (this.y2kActive()) {
      for (let i = 0; i < this.powered.length; i++) {
        const t = this.over[i];
        if (this.powered[i] && t >= OV.ZR && t !== OV.RUBBLE &&
            t !== OV.WIREROAD && !isPlant(t) && !isWaterOv(t) && !isMega(t) && Math.random() < 0.3)
          this.powered[i] = 0; // M26: crossing isn't a consumer; M24: water infra isn't a consumer; M28: a power island doesn't flicker
      }
    }
    // M24: a water PUMP is excluded from conducts() above, so it never CARRIES
    // the grid (no crosstalk — a pump can't bridge power to a zone), but it
    // still needs electricity to run its motor. Energize a pump anchor as a
    // terminal RECEIVER — a non-propagating read that does NOT re-enter the
    // flood — when any tile orthogonally touching its 2x2 footprint is on the
    // powered grid and is itself a real conductor (not another pump). So a pump
    // genuinely needs a WIRE run to it: a lone/coastal pump with no wire stays
    // unpowered (and therefore dry). Runs last so brownout/y2k cuts (which skip
    // water infra) can't perturb it; recomputeWater then reads powered[anchor].
    for (let i = 0; i < this.over.length; i++) {
      if (this.over[i] !== OV.PUMP || this.anc[i] !== i) continue;
      const s = sizeOf(OV.PUMP), ax = i % MAP, ay = (i / MAP) | 0;
      let fed = false;
      for (let dy = 0; dy < s && !fed; dy++) for (let dx = 0; dx < s && !fed; dx++) {
        const fx = ax + dx, fy = ay + dy;
        for (const [nx, ny] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const X = fx + nx, Y = fy + ny;
          if (!this.inMap(X, Y)) continue;
          const j = this.idx(X, Y);
          if (this.powered[j] && !isWaterOv(this.over[j]) && !isMega(this.over[j])) { fed = true; break; } // M28: a self-powered mega island must not feed a pump (it never bridges the grid)
        }
      }
      this.powered[i] = fed ? 1 : 0;
    }
    this.powerDirty = false;
  }

  /* ---------- water network (M24) ----------
     A second utility, a strict analog of recomputePower: seed the energized
     providers, flood their capacity through the PIPE network (4-connected),
     then STAMP a graded coverage radius so zones near the mains are served
     without a pipe on every lot (the SC2000 coverage model). Pure/deterministic
     — no Math.random anywhere — so save→load→recompute reproduces watered[]
     bit-for-bit from over[]. MUST run AFTER recomputePower(): a PUMP is
     energized only when this.powered[anchor] is already fresh, so a pump
     genuinely needs BOTH a wire (for power) AND water terrain adjacency. A
     WATERTOWER is gravity-fed and ignores power entirely (works in a blackout). */
  recomputeWater() {
    const n = this.over.length;
    this.watered.fill(0);
    this._waterReach.fill(0);
    let supply = 0;
    const q = [];
    // 1. seed energized source footprints (tower always on; pump needs power)
    for (let i = 0; i < n; i++) {
      if (!isWaterSrc(this.over[i]) || this.anc[i] !== i) continue;
      const t = this.over[i];
      const energized = t === OV.WATERTOWER || (t === OV.PUMP && this.powered[i]);
      if (!energized) continue;
      supply += WATER_CAP[t];
      const s = sizeOf(t), ax = i % MAP, ay = (i / MAP) | 0;
      for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) {
        const j = this.idx(ax + dx, ay + dy);
        if (!this._waterReach[j]) { this._waterReach[j] = 1; q.push(j); }
      }
    }
    // 2. flood 4-connected through PIPE tiles (identical shape to the power flood)
    while (q.length) {
      const i = q.pop();
      const x = i % MAP, y = (i / MAP) | 0;
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const X = x + dx, Y = y + dy;
        if (!this.inMap(X, Y)) continue;
        const j = this.idx(X, Y);
        if (!this._waterReach[j] && this.over[j] === OV.PIPE) { this._waterReach[j] = 1; q.push(j); }
      }
    }
    // 3. graded manhattan coverage stamp (stampCoverage shape, max-combine):
    // every reached tile serves lots within WATER_REACH, brightest on the mains
    const R = WATER_REACH;
    for (let i = 0; i < n; i++) {
      if (!this._waterReach[i]) continue;
      const x = i % MAP, y = (i / MAP) | 0;
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        const d = Math.abs(dx) + Math.abs(dy);
        if (d > R) continue;
        const X = x + dx, Y = y + dy;
        if (!this.inMap(X, Y)) continue;
        const j = this.idx(X, Y);
        const v = Math.min(255, (R - d) * 40);
        if (v > this.watered[j]) this.watered[j] = v;
      }
    }
    // 4. demand = served consumer tiles; pressure is a deterministic scalar
    let demand = 0;
    for (let i = 0; i < n; i++) {
      const t = this.over[i];
      if ((t === OV.ZR || t === OV.ZC || t === OV.ZI) && this.lvl[i] >= 1 && this.watered[i] > 0) demand++;
    }
    this.waterSupply = supply;
    this.waterDemand = demand;
    this.waterPressure = supply >= demand ? 1 : (demand ? supply / demand : 1);
    if (demand > supply)
      this.pushMsg("💧 LOW WATER PRESSURE — mains over capacity; build another tower or pump.");
  }

  /* ---- plant aging (M19) ----
     Effective grid contribution of the plant anchored at tile `a`: its
     nameplate scaled by the age curve (plantAgeFactor). A plant with no
     recorded build year (0 sentinel — e.g. a pre-M19 save, defensively) is
     treated as brand new (current year), i.e. full nameplate. */
  plantEffectiveCap(a) {
    const t = this.over[a];
    if (!isPlant(t)) return 0;
    const by = this.plantYear[a] || this.year;
    const age = Math.max(0, this.year - by);
    return Math.round(POWER_CAP[t] * plantAgeFactor(age));
  }

  // Live per-type effective capacity feeding the grid, summed across every
  // plant of each type (used by the budget power-mix breakdown, M19-4). The
  // four values sum to powerSupply. A type with no plants reports 0.
  powerMix() {
    const mix = { coal: 0, solar: 0, gas: 0, wind: 0 };
    for (let i = 0; i < this.over.length; i++) {
      const t = this.over[i];
      if (this.anc[i] !== i || !isPlant(t)) continue;
      const cap = this.plantEffectiveCap(i);
      if (t === OV.COAL) mix.coal += cap;
      else if (t === OV.SOLAR) mix.solar += cap;
      else if (t === OV.GAS) mix.gas += cap;
      else if (t === OV.WIND) mix.wind += cap;
    }
    return mix;
  }

  /* ---- end-of-life rebuild notice (M19) ----
     Runs once per month rollover. A plant that has aged past PLANT_WARN_AGE
     is failing — its output is decaying toward the 50% floor — so the ticker
     nags the mayor to bulldoze and rebuild it. Each plant is nagged at most
     once (warnedPlants, keyed by anchor); rebuilding clears the flag so a
     fresh plant can nag again decades later. */
  plantAgingTick() {
    for (let i = 0; i < this.over.length; i++) {
      const t = this.over[i];
      if (this.anc[i] !== i || !isPlant(t)) continue;
      const by = this.plantYear[i] || this.year;
      const age = this.year - by;
      if (age >= PLANT_WARN_AGE) {
        if (!this.warnedPlants[i]) {
          this.warnedPlants[i] = true;
          const nm = PLANT_LABEL[t] || "power plant";
          this.pushMsg(`🏚️ The old ${nm} at (${i % MAP}, ${(i / MAP) | 0}) is failing — ` +
            `output is fading with age. Bulldoze and rebuild it to restore full power.`);
        }
      } else if (this.warnedPlants[i]) {
        delete this.warnedPlants[i]; // clock wound back / rebuilt: reset the nag
      }
    }
  }

  // ---------- road access (multi-source BFS, depth 3) ----------
  recomputeAccess() {
    this.access.fill(0);
    let q = [];
    for (let i = 0; i < this.over.length; i++)
      if (this.over[i] === OV.ROAD || this.over[i] === OV.WIREROAD) { this.access[i] = 4; q.push(i); } // M26: crossing seeds access like a road
    for (let d = 3; d >= 1 && q.length; d--) {
      const next = [];
      for (const i of q) {
        const x = i % MAP, y = (i / MAP) | 0;
        for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const X = x + dx, Y = y + dy;
          if (!this.inMap(X, Y)) continue;
          const j = this.idx(X, Y);
          if (this.access[j] === 0 && this.terr[j] !== TERR.WATER) {
            this.access[j] = d; next.push(j);
          }
        }
      }
      q = next;
    }
  }

  /* ---------- rail / transit network (M25) ----------
     Deterministic, no RNG. MUST run AFTER recomputePower() (it READS powered[]
     without editing it) and BEFORE recomputeTraffic() (which consumes railCov).
     Rebuilds every derived rail field from the rail[] plane:
       1. one O(n) ascending-index 4-connectivity flood-fill (explicit Int32
          stack, never Set/Map order) assigns component ids to rail!=NONE cells;
          TRACK/SUB/STATION all conduct, so a STATION fuses an adjacent surface
          segment with an adjacent subway segment — that is how stations "link
          modes." Per-component STATION count is tallied.
       2. a station is LIVE iff it is powered by ADJACENCY (powered[i] || a
          powered 4-neighbor — NOT the over[] flood, which never powers a plane
          station) AND its component holds >= 2 stations.
       3. catchment stamp (stampCoverage's body, gated on stationLive) scaled by
          transit funding f: f<=0 stamps nothing (a real monotonic lever).
       4. one-time "Metro is open" ticker, gated by metroOpened so it fires once
          and never on load (recomputeRail(true) suppresses the message). */
  recomputeRail(silent) {
    const n = this.over.length;
    this.railNet.fill(-1);
    this.stationLive.fill(0);
    this.railCov.fill(0);
    // 1. component flood-fill (ascending scan; STATION count per component)
    const comp = [];                                    // comp[id] = station count
    const stack = this._railStack || (this._railStack = new Int32Array(n));
    let cid = 0;
    for (let s = 0; s < n; s++) {
      if (this.rail[s] === RL.NONE || this.railNet[s] !== -1) continue;
      let sp = 0, stations = 0;
      stack[sp++] = s; this.railNet[s] = cid;
      while (sp > 0) {
        const i = stack[--sp];
        if (this.rail[i] === RL.STATION) stations++;
        const x = i % MAP, y = (i / MAP) | 0;
        for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const X = x + dx, Y = y + dy;
          if (!this.inMap(X, Y)) continue;
          const j = this.idx(X, Y);
          if (this.rail[j] !== RL.NONE && this.railNet[j] === -1) {
            this.railNet[j] = cid; stack[sp++] = j;
          }
        }
      }
      comp[cid++] = stations;
    }
    // 2. station power by ADJACENCY, on a >=2-station component
    let anyLive = false;
    for (let i = 0; i < n; i++) {
      if (this.rail[i] !== RL.STATION) continue;
      let powHere = this.powered[i] === 1;
      if (!powHere) {
        const x = i % MAP, y = (i / MAP) | 0;
        for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const X = x + dx, Y = y + dy;
          if (this.inMap(X, Y) && this.powered[this.idx(X, Y)]) { powHere = true; break; }
        }
      }
      if (powHere && comp[this.railNet[i]] >= 2) { this.stationLive[i] = 1; anyLive = true; }
    }
    // 3. ridership catchment (stampCoverage shape, gated on stationLive, scaled
    //    by transit funding). f<=0 => zero coverage AND (via deptCosts) zero upkeep.
    const f = this.funding.transit / 100;
    if (anyLive && f > 0) {
      const R = Math.round(RAIL_STATION_R * (0.4 + 0.6 * f));
      for (let i = 0; i < n; i++) {
        if (!this.stationLive[i]) continue;
        const x = i % MAP, y = (i / MAP) | 0;
        for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
          const d = Math.abs(dx) + Math.abs(dy);
          if (d > R) continue;
          const X = x + dx, Y = y + dy;
          if (!this.inMap(X, Y)) continue;
          const j = this.idx(X, Y);
          this.railCov[j] = Math.max(this.railCov[j], Math.min(255, Math.round((R - d) * 18 * f)));
        }
      }
    }
    // 4. one-time "Metro is open" milestone
    if (!this.metroOpened && anyLive) {
      this.metroOpened = true;
      if (!silent)
        this.pushMsg("🚇 The Metro is open, Mayor! Commuters leave the car at home.");
    }
  }

  // ---------- traffic ----------
  // nearest road tile within manhattan distance 3 (matches access BFS reach)
  nearestRoad(i) {
    const x = i % MAP, y = (i / MAP) | 0;
    for (let r = 1; r <= 3; r++) {
      for (let dy = -r; dy <= r; dy++) {
        const dx = r - Math.abs(dy);
        for (const sx of dx === 0 ? [0] : [-dx, dx]) {
          const X = x + sx, Y = y + dy;
          if (!this.inMap(X, Y)) continue;
          const j = Y * MAP + X;
          if (this.over[j] === OV.ROAD || this.over[j] === OV.WIREROAD) return j; // M26: crossing counts as road
        }
      }
    }
    return -1;
  }

  // max congestion on any road within 2 tiles — what a zone "feels"
  trafficNear(i) {
    const x = i % MAP, y = (i / MAP) | 0;
    let m = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const X = x + dx, Y = y + dy;
      if (!this.inMap(X, Y)) continue;
      const j = Y * MAP + X;
      if ((this.over[j] === OV.ROAD || this.over[j] === OV.WIREROAD) && this.traffic[j] > m) m = this.traffic[j]; // M26
    }
    return m;
  }

  // each developed zone emits trips onto its serving road, then the trips
  // random-walk a short way along the road network (commutes / deliveries).
  recomputeTraffic() {
    const n = MAP * MAP;
    const load = this._trafficLoad || (this._trafficLoad = new Float32Array(n));
    load.fill(0);
    this.railRiders = 0; // M25: trips/mo diverted onto rail this pass (UI only)
    for (let i = 0; i < n; i++) {
      const t = this.over[i];
      if ((t !== OV.ZR && t !== OV.ZC && t !== OV.ZI) || this.lvl[i] === 0) continue;
      // M22: Carpool Incentive scales trips at the SOURCE (trafficMul), so fewer
      // trips deposit everywhere the random walk lands — no 2nd pass. 1 when off.
      const baseTrips = (4 + this.lvl[i] * 9) * this.ordMods.trafficMul; // busier at higher development
      // M25: a served zone diverts up to min(RAIL_MAX_SHARE, railCov/255) of its
      // trips onto rail — capped, never zeroing. This scales a DETERMINISTIC map
      // (railCov) BEFORE the reservoir walk, so the sole RNG (the walk) is
      // untouched and two runs from the same seed + same rail edits are identical.
      const share = this.railCov[i] ? Math.min(RAIL_MAX_SHARE, this.railCov[i] / 255) : 0;
      const trips = baseTrips * (1 - share);
      this.railRiders += baseTrips * share;
      let cur = this.nearestRoad(i);
      if (cur < 0) continue;
      let prev = -1;
      for (let step = 0; step < 10; step++) {
        load[cur] += trips;
        const x = cur % MAP, y = (cur / MAP) | 0;
        let nxt = -1, cnt = 0;
        for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const X = x + dx, Y = y + dy;
          if (!this.inMap(X, Y)) continue;
          const j = Y * MAP + X;
          if ((this.over[j] !== OV.ROAD && this.over[j] !== OV.WIREROAD) || j === prev) continue; // M26: trips walk through crossings
          cnt++;
          if (Math.random() * cnt < 1) nxt = j;  // reservoir pick
        }
        if (nxt < 0) break;
        prev = cur; cur = nxt;
      }
    }
    // blend toward the new load so congestion is stable; roads only.
    // winter (M12): snow keeps drivers home — the effective load every road
    // carries is scaled DOWN by 0.72, so measured congestion drops ~28%
    // through Dec–Feb and recovers by itself in March. Applied after the
    // per-tile clamp so even saturated arterials visibly clear up.
    const seasonMul = seasonOf(this.month) === "winter" ? 0.72 : 1;
    for (let i = 0; i < n; i++) {
      // M23 road-wear capacity penalty: worn pavement carries traffic worse —
      // the load a road effectively carries is scaled by (1 + wear/255 * 0.6),
      // i.e. a fully worn road congests as if it hauled 60% more trips.
      // wear = 0 gives a factor of exactly 1: the legacy arithmetic untouched.
      const wearMul = 1 + this.roadWear[i] / 255 * 0.6;
      this.traffic[i] = (this.over[i] === OV.ROAD || this.over[i] === OV.WIREROAD) // M26: crossing carries traffic
        ? Math.min(255, this.traffic[i] * 0.5 + Math.min(255, load[i] * wearMul) * seasonMul * 0.5)
        : 0;
    }
  }

  /* ---- road wear (M23) ----
     Runs exactly once per month rollover. With F = funding.roads (0..100),
     every road tile's wear counter (city.roadWear, 0..255, serialized in
     save v7) moves by the documented delta
         Δ = round(18 * (100 - F) / 100) - round(10 * F / 100)
     clamped to [0, 255]:
         F = 100 → Δ = 0 - 10 = -10   full funding: crews out-repair all wear;
                                      wear pins at 0 and roads behave exactly
                                      as they did pre-M23 (no penalty at all)
         F = 50  → Δ = 9 - 5  = +4    strictly between the extremes
         F = 0   → Δ = 18 - 0 = +18   no crews: a fresh road saturates to 255
                                      in ceil(255 / 18) = 15 rollovers
     Consequences (both measurable):
       1. capacity penalty — recomputeTraffic scales each road's carried load
          by (1 + wear/255 * 0.6); see the comment there.
       2. crumble — while F is EXACTLY 0, a road tile already at wear 255 has
          a 35% chance per rollover to decay to OV.RUBBLE. Documented horizon:
          at 0% funding the first crumbled roads appear within ~20 month
          rollovers (15 to saturate + a few 35% draws). At any F > 0 roads
          never crumble, and wear itself repairs whenever Δ < 0. */
  roadWearTick() {
    const F = this.funding.roads;
    const delta = Math.round(18 * (100 - F) / 100) - Math.round(10 * F / 100);
    let crumbled = 0;
    for (let i = 0; i < this.over.length; i++) {
      if (this.over[i] !== OV.ROAD && this.over[i] !== OV.WIREROAD) { this.roadWear[i] = 0; continue; } // M26: a crossing wears like a road (may crumble to rubble, removing both)
      this.roadWear[i] = Math.max(0, Math.min(255, this.roadWear[i] + delta));
      if (F === 0 && this.roadWear[i] >= 255 && Math.random() < 0.35) {
        this.over[i] = OV.RUBBLE; this.lvl[i] = 0; this.anc[i] = -1;
        this.roadWear[i] = 0;
        crumbled++;
      }
    }
    if (crumbled) {
      this.powerDirty = true;
      this.pushMsg(`🕳️ ${crumbled} stretch${crumbled === 1 ? "" : "es"} of ` +
        `unmaintained road crumble${crumbled === 1 ? "s" : ""} into rubble! ` +
        `Public works begs the mayor for a budget.`);
    }
  }

  // ---------- pollution / land value / crime / coverage ----------
  recomputeMaps() {
    const n = MAP * MAP;
    const src = new Float32Array(n);
    // M19: fossil-plant smog scales with the grid LOAD FACTOR — how hard the
    // plants are actually being driven — not a flat constant. A coal plant
    // feeding a hungry grid burns more fuel and smokes more than an idle one.
    // load = powerDemand / powerSupply, clamped to [0,1]; both are set by the
    // preceding recomputePower(). An idle plant still emits a small floor.
    const load = this.powerSupply > 0
      ? Math.max(0, Math.min(1, this.powerDemand / this.powerSupply)) : 0;
    const coalSmog = 40 + 120 * load; // idle 40 → full-load 160
    const gasSmog  = 30 + 90 * load;  // moderate: idle 30 → full-load 120 (below coal)
    // M22: Citywide Recycling scales the two CURBSIDE waste sources (industry &
    // roads) by ordMods.pollMul — combustion smog from the plants is untouched
    // (recycling is waste, not fuel). pollMul === 1 when off => arithmetic
    // identical to pre-M22.
    const pm = this.ordMods.pollMul;
    for (let i = 0; i < n; i++) {
      const t = this.over[i];
      if (t === OV.ZI) src[i] += (30 + this.lvl[i] * 35) * pm;
      if (t === OV.COAL) src[i] += coalSmog;
      if (t === OV.GAS) src[i] += gasSmog;   // gas smokes; solar & wind stay clean
      if (t === OV.ROAD || t === OV.WIREROAD) src[i] += 8 * pm; // M26: crossing pollutes like a road
      if (this.fire[i]) src[i] += 100;
    }
    this.diffuse(src, this.poll, 3, 0.24);

    // land value: water/forest/park proximity is good, pollution is bad
    const lv = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      if (this.terr[i] === TERR.WATER) lv[i] = 60;
      else if (this.terr[i] === TERR.FOREST) lv[i] = 40;
      if (this.over[i] === OV.PARK) lv[i] = 90;
      if (this.over[i] === OV.MAYOR) lv[i] = 130;    // the mayor's manicured lawns
      if (this.over[i] === OV.STADIUM) lv[i] = 110;  // stadium pride (all 4 tiles)
      if (isLandmark(this.over[i])) lv[i] = 120;     // M28: the wonder's own lot is premium (all footprint tiles)
    }
    const lvOut = new Uint8Array(n);
    this.diffuse(lv, lvOut, 4, 0.3);

    // congested roads drag down nearby land value (noise, fumes, gridlock)
    const tr = new Float32Array(n);
    for (let i = 0; i < n; i++) if (this.traffic[i]) tr[i] = this.traffic[i];
    const trOut = new Uint8Array(n);
    this.diffuse(tr, trOut, 2, 0.35);

    // police / fire / education / health coverage — each department's stamp
    // is scaled by its OWN funding level only (M23), so cutting one budget
    // never perturbs the other three coverage arrays
    this.stampCoverage(OV.POLICE, this.polCov, 12, this.funding.police / 100);
    this.stampCoverage(OV.FIRESTA, this.fireCov, 12, this.funding.fire / 100);
    this.stampCoverage(OV.SCHOOL, this.eduCov, 14, this.funding.edu / 100);
    this.stampCoverage(OV.HOSPITAL, this.medCov, 14, this.funding.health / 100);
    // M28: wonder-landmark civic pride — a wide-radius land-value stamp rebuilt
    // fresh from over[] every pass, so removal fully reverts on the next call.
    this.stampLandmarkPride();

    for (let i = 0; i < n; i++) {
      let v = 40 + lvOut[i] - this.poll[i] * 0.7 - trOut[i] * 0.4  // traffic penalty
            + this.eduCov[i] * 0.1 + this.medCov[i] * 0.1          // good schools sell houses
            + this.landmarkCov[i] * 0.6;                           // M28: wonder-landmark pride
      this.landv[i] = Math.max(0, Math.min(255, v));
    }

    // crime: density beats coverage
    for (let i = 0; i < n; i++) {
      const t = this.over[i];
      const density = (t === OV.ZR || t === OV.ZC) ? this.lvl[i] * 40 : (t === OV.ZI ? this.lvl[i] * 20 : 0);
      // M22: Neighborhood Watch / Teen Curfew add a flat crimeCut, behaving like
      // extra police coverage; the existing [0,255] clamp bounds it (0 when off).
      const v = density - this.polCov[i] - this.landv[i] * 0.2 - this.ordMods.crimeCut;
      this.crime[i] = Math.max(0, Math.min(255, v));
    }
  }

  diffuse(src, out, passes, rate) {
    let a = src, b = new Float32Array(src.length);
    for (let p = 0; p < passes; p++) {
      for (let y = 0; y < MAP; y++) for (let x = 0; x < MAP; x++) {
        const i = y * MAP + x;
        let sum = a[i], cnt = 1;
        if (x > 0)       { sum += a[i - 1];   cnt++; }
        if (x < MAP - 1) { sum += a[i + 1];   cnt++; }
        if (y > 0)       { sum += a[i - MAP]; cnt++; }
        if (y < MAP - 1) { sum += a[i + MAP]; cnt++; }
        b[i] = a[i] * (1 - rate) + (sum / cnt) * rate;
      }
      [a, b] = [b, a];
    }
    for (let i = 0; i < out.length; i++) out[i] = Math.max(0, Math.min(255, a[i]));
  }

  /* Service effectiveness scales with department funding (M23).
     Documented formula, with f = funding / 100 (0..1):
         R      = round(radius * (0.4 + 0.6 * f))        effective radius
         val(d) = round((R - d) * 18 * f)                potency at manhattan d
     stamped for d <= R around each POWERED anchor, max-combined, clamped 255.
     At f = 1 this reduces to the legacy v6 stamp exactly — (radius - d) * 18
     over the full radii 12/12/14/14 — so default play is unchanged. Potency
     scales linearly with f, so coverage is strictly monotone in funding
     (100% > 50% > 25% wherever any station reaches). Documented floor at 0%:
     f = 0 stamps nothing at all — the coverage array is all zeros. */
  stampCoverage(type, out, radius, f = 1) {
    out.fill(0);
    if (f <= 0) return; // 0% funding: the documented floor — zero coverage
    const R = Math.round(radius * (0.4 + 0.6 * f));
    for (let i = 0; i < this.over.length; i++) {
      if (this.over[i] !== type || this.anc[i] !== i) continue;
      if (!this.powered[i]) continue; // stations need power
      const x = i % MAP, y = (i / MAP) | 0;
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        const X = x + dx, Y = y + dy;
        if (!this.inMap(X, Y)) continue;
        const d = Math.abs(dx) + Math.abs(dy);
        if (d > R) continue;
        const j = this.idx(X, Y);
        out[j] = Math.max(out[j], Math.min(255, Math.round((R - d) * 18 * f)));
      }
    }
  }

  /* M28: wonder-landmark "civic pride" land-value stamp. Mirrors stampCoverage's
     body but keyed on the landmark anchors (isLandmark && anc === i) with the
     per-type radius LANDMARK_R and a base-1.5 falloff, max-combined across all
     landmarks into the DERIVED landmarkCov array. Because it .fill(0)s and
     rebuilds purely from the current over[] every recomputeMaps, bulldozing a
     landmark (which clears its over[] tiles) makes the next recomputeMaps
     produce a landv array byte-identical to before the landmark existed — a
     full revert with zero persisted bookkeeping. Needs no power (a monument
     radiates pride whether the grid is up or not). */
  stampLandmarkPride() {
    const out = this.landmarkCov;
    out.fill(0);
    for (let i = 0; i < this.over.length; i++) {
      const t = this.over[i];
      if (!isLandmark(t) || this.anc[i] !== i) continue;
      const R = LANDMARK_R[t];
      const x = i % MAP, y = (i / MAP) | 0;
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        const X = x + dx, Y = y + dy;
        if (!this.inMap(X, Y)) continue;
        const d = Math.abs(dx) + Math.abs(dy);
        if (d > R) continue;
        const j = this.idx(X, Y);
        out[j] = Math.max(out[j], Math.min(255, Math.round((R - d) * 1.5)));
      }
    }
  }

  // ---------- demand ----------
  recomputeDemand() {
    let pop = 0, cJobs = 0, iJobs = 0, stadiums = 0, schools = 0, hospitals = 0, resTiles = 0;
    for (let i = 0; i < this.over.length; i++) {
      if (this.over[i] === OV.ZR) { pop += RES_POP[this.lvl[i]]; resTiles++; }
      else if (this.over[i] === OV.ZC) cJobs += COM_JOB[this.lvl[i]];
      else if (this.over[i] === OV.ZI) iJobs += IND_JOB[this.lvl[i]];
      else if (this.over[i] === OV.STADIUM && this.anc[i] === i) stadiums++;
      else if (this.over[i] === OV.SCHOOL && this.anc[i] === i && this.powered[i]) schools++;
      else if (this.over[i] === OV.HOSPITAL && this.anc[i] === i && this.powered[i]) hospitals++;
      // M28: an arcology contributes its fixed pop/jobs EXACTLY ONCE per anchor
      // (keyed anc === i), so a 4x4 Launch Arco adds its 3000 once, never ×16.
      // this.pop then feeds tierForPop + growth unchanged — an arco genuinely
      // pushes the city up the tier ladder. Jobs go in the industrial bucket.
      else if (isArco(this.over[i]) && this.anc[i] === i) { pop += ARCO_POP[this.over[i]]; iJobs += ARCO_JOB[this.over[i]]; }
    }
    this.pop = pop; this.jobs = cJobs + iJobs;
    // M22: cache the live counts the ordinance §-functions read (nostalgiaTax
    // revenue scales with comJobs, smoke-detector cost with resTiles). Runs every
    // tick before the monthly collectBudget, so figures are current at rollover.
    this.comJobs = cJobs; this.resTiles = resTiles;
    const taxMod = (7 - this.taxRate) * 0.05;         // low taxes juice demand
    const stadMod = Math.min(2, stadiums) * 0.06;     // a stadium makes people move in
    // good schools & hospitals attract families (and the workers follow)
    const svcMod = Math.min(3, schools) * 0.05 + Math.min(3, hospitals) * 0.05;
    // time-capsule event modifiers shift demand additively while active (M7)
    let evR = 0, evC = 0, evI = 0;
    for (const m of this.activeMods) {
      if (m.type === "demandR") evR += m.add || 0;
      else if (m.type === "demandC") evC += m.add || 0;
      else if (m.type === "demandI") evI += m.add || 0;
    }
    const jobsAvail = this.jobs + 40 - pop * 0.62;    // 40 = external commuters
    // M22: ordinance demand deltas fold into the SAME additive slot as the
    // time-capsule event mods (evR/evC/evI), so they compose and clamp
    // identically through clampD [-1,1]. All zero when nothing is enacted.
    const om = this.ordMods;
    this.demand.r = clampD(jobsAvail / 220 + taxMod + stadMod + svcMod + evR + om.demR);
    this.demand.c = clampD((pop * 0.28 - cJobs) / 160 + taxMod * 0.6 + svcMod * 0.5 + evC + om.demC);
    this.demand.i = clampD((pop * 0.42 - iJobs) / 180 + 0.28 + taxMod * 0.4 + svcMod * 0.5 + evI + om.demI);
    function clampD(v) { return Math.max(-1, Math.min(1, v)); }
  }

  // ---------- city ordinances (M22) ----------
  /* Rebuild the pop-INDEPENDENT effect cache from the enacted flags. Starts at
     identity, folds each enacted-AND-unlocked ordinance's mods (muls multiply,
     additives sum), then floors the muls defensively at 0.5 so no stack of
     policies can drive a field to zero. Called ONLY on toggle and on load — the
     per-tick passes just read the cached scalars. The this.tier>=minTier gate
     here mirrors the enact validator: a locked-but-set flag contributes nothing
     until the tier ratchet legitimately reaches it. */
  recomputeOrdinances() {
    const m = identityOrdMods();
    for (const o of ORDINANCES) {
      if (!this.ordinances[o.id] || this.tier < o.minTier) continue;
      const d = o.mods || {};
      if (d.pollMul != null) m.pollMul *= d.pollMul;
      if (d.trafficMul != null) m.trafficMul *= d.trafficMul;
      if (d.crimeCut != null) m.crimeCut += d.crimeCut;
      if (d.fireBurn != null) m.fireBurn += d.fireBurn;
      if (d.demR != null) m.demR += d.demR;
      if (d.demC != null) m.demC += d.demC;
      if (d.demI != null) m.demI += d.demI;
    }
    m.pollMul = Math.max(0.5, m.pollMul);
    m.trafficMul = Math.max(0.5, m.trafficMul);
    this.ordMods = m;
  }

  /* Enact/repeal an ordinance. Validates the tier unlock (refuses at tier<minTier,
     returning false so the UI can play the denied cue), sets/deletes the flag,
     and rebuilds ordMods. Unknown ids are refused. Does NOT itself recompute the
     maps — the caller refreshes overlays so a toggle reacts even while paused. */
  enactOrdinance(id, on) {
    const o = ORD(id);
    if (!o) return false;
    if (on && this.tier < o.minTier) return false;
    if (on) this.ordinances[id] = true;
    else delete this.ordinances[id];
    this.recomputeOrdinances();
    return true;
  }

  /* O(1) over the 6-entry registry: sum the LIVE monthly cost/revenue of every
     enacted-AND-unlocked ordinance, using cached pop/comJobs/resTiles so the
     figures scale with the city. net === rev - cost exactly. Routed into the
     monthly budget via lastBudget.ord (see collectBudget) and shown live in the
     ordinances dialog + the budget table. */
  ordinanceBudget() {
    let cost = 0, rev = 0;
    for (const o of ORDINANCES) {
      if (!this.ordinances[o.id] || this.tier < o.minTier) continue;
      if (o.cost) cost += o.cost(this);
      if (o.revenue) rev += o.revenue(this);
    }
    return { cost, rev, net: rev - cost };
  }

  /* ---------- M27: neighboring cities & regional connections ---------- */
  // Rebuild conn[] by scanning ONLY the four border lines (O(MAP)). World-edge
  // indexed (0=N,1=E,2=S,3=W); never reads cam.r. A corner tile legitimately
  // feeds two edges. wire=any WIRE/WIREROAD on the border; road=any ROAD/WIREROAD;
  // rail=any TRACK/STATION on that border.
  updateConnections() {
    for (let e = 0; e < 4; e++) { const c = this.conn[e]; c.road = c.wire = c.rail = false; }
    const scan = (e, i) => {
      const o = this.over[i], r = this.rail[i], c = this.conn[e];
      if (o === OV.WIRE || o === OV.WIREROAD) c.wire = true;
      if (o === OV.ROAD || o === OV.WIREROAD) c.road = true;
      if (r === RL.TRACK || r === RL.STATION) c.rail = true;
    };
    for (let x = 0; x < MAP; x++) { scan(0, x); scan(2, (MAP - 1) * MAP + x); }
    for (let y = 0; y < MAP; y++) { scan(3, y * MAP); scan(1, y * MAP + (MAP - 1)); }
  }

  // Net supply change from open power deals. A BUY imports power (raises supply);
  // a SELL exports it (lowers available supply). Gated on an open border wire, so
  // this is exactly 0 when no wire reaches the border or all deals are none.
  // Net supply delta from open power deals, given this recompute's plant supply
  // and own demand. Buys are firm imports (+mw). Sells can only EXPORT your own
  // generation SURPLUS — you cannot sell power you don't make: sold =
  // min(committed sell, max(0, plantSupply - demand)). This bounds the deal to
  // deliverable surplus, so a plantless city exports nothing and overselling can
  // never brown your own city out for free. Stashes sold/commit for the budget
  // so § revenue is paid only for MW actually exported.
  powerTradeDelta(plantSupply, demand) {
    let buys = 0, sellCommit = 0;
    for (let e = 0; e < 4; e++) {
      if (!this.conn[e].wire) continue;
      const dl = this.deals[e];
      if (dl.mode === 2) buys += dl.mw;         // buy → firm import
      else if (dl.mode === 1) sellCommit += dl.mw; // sell → committed export
    }
    const sold = Math.min(sellCommit, Math.max(0, plantSupply - demand));
    this._tradeSold = sold; this._tradeSellCommit = sellCommit;
    return buys - sold;
  }

  // Monthly § from open power deals: selling earns priceSell/MW (+) — but ONLY
  // for MW actually exported (capped to surplus in powerTradeDelta), scaled by
  // sold/committed so overselling never yields phantom income. Buying costs
  // priceBuy/MW (−, firm). Gated on an open border wire → exactly 0 with no deal.
  powerTradeBudget() {
    const sellScale = this._tradeSellCommit > 0 ? this._tradeSold / this._tradeSellCommit : 0;
    let s = 0;
    for (let e = 0; e < 4; e++) {
      if (!this.conn[e].wire) continue;
      const dl = this.deals[e], nb = this.neighbors[e];
      if (dl.mode === 1) s += dl.mw * nb.priceSell * sellScale; // paid for exported surplus only
      else if (dl.mode === 2) s -= dl.mw * nb.priceBuy;
    }
    return Math.round(s);
  }

  // Rebuild the per-tile commuter demand bump. EXACTLY 0.0 everywhere when no
  // commute link is open, so growthPass's `dem + commuterBias[i]` is a bit-
  // identical `+0.0` no-op and draws the same Math.random sequence as pre-M27.
  // An open highway/rail link stamps neighbors[e].commuter*0.01 with a linear
  // falloff over K=8 tiles inward from that edge, raising near-border growth.
  recomputeRegion() {
    this.commuterBias.fill(0);
    const K = 8;
    for (let e = 0; e < 4; e++) {
      const dl = this.deals[e];
      if (!dl.commute || !(this.conn[e].road || this.conn[e].rail)) continue;
      const amp = this.neighbors[e].commuter * 0.01;
      for (let y = 0; y < MAP; y++) for (let x = 0; x < MAP; x++) {
        const d = e === 0 ? y : e === 1 ? (MAP - 1 - x) : e === 2 ? (MAP - 1 - y) : x;
        if (d >= K) continue;
        this.commuterBias[y * MAP + x] += amp * (K - d) / K;
      }
    }
  }

  // Deterministic deal negotiation (NO Math.random). Accepts iff a power deal's
  // mw is within the disposition-derived cap AND the required connection is open;
  // on accept writes deals[e] and nudges disp toward the neighbor's preferred
  // deal (+2 match / −1 else, clamped 0..100). Returns true on accept.
  dealCap(e) { return 50 + this.disp[e] * 4; }
  proposeDeal(e, mode, mw, commute) {
    mw = Math.max(0, mw | 0);
    const powerOk = mode === 0 || (mw <= this.dealCap(e) && this.conn[e].wire);
    if (!powerOk) return false;
    const commuteOk = !commute || this.conn[e].road || this.conn[e].rail;
    if (!commuteOk) return false;
    this.deals[e] = { mode, mw: mode === 0 ? 0 : mw, commute: !!commute };
    if (mode === 1 || mode === 2)
      this.disp[e] = Math.max(0, Math.min(100, this.disp[e] + (mode === this.neighbors[e].pref ? 2 : -1)));
    return true;
  }

  // ---------- growth ----------
  growthPass() {
    const n = MAP * MAP;
    const tries = 340;
    for (let t = 0; t < tries; t++) {
      const i = (Math.random() * n) | 0;
      const ov = this.over[i];
      if (ov !== OV.ZR && ov !== OV.ZC && ov !== OV.ZI) continue;
      if (this.fire[i]) continue;
      // M27: commuterBias is exactly 0.0 where no commute link is open, so this
      // is a bit-identical `+0.0` no-op vs pre-M27; an open link raises effective
      // demand within K tiles of the connected edge → higher near-border growth.
      let dem = (ov === OV.ZR ? this.demand.r : ov === OV.ZC ? this.demand.c : this.demand.i) + this.commuterBias[i];
      const powered = this.powered[i], road = this.access[i] > 0;

      if (!powered) {
        this.unpow[i] = Math.min(250, this.unpow[i] + 1);
        if (this.lvl[i] > 0 && this.unpow[i] > 6 && Math.random() < 0.35) this.lvl[i]--;
        continue;
      }
      this.unpow[i] = 0;

      // congestion on the serving roads (city.traffic) dampens growth
      const cong = this.trafficNear(i) / 255;

      if (this.lvl[i] === 0) {
        if (road && dem > 0 && Math.random() < dem * 0.85 * (1 - cong * 0.7)) {
          this.lvl[i] = 1; this.varnt[i] = (Math.random() * 5) | 0;
        }
      } else if (dem > 0.15 && this.lvl[i] < 3) {
        // upgrading needs decent conditions
        let fit = this.landv[i] / 255;
        if (ov === OV.ZI) fit = 0.75; // industry doesn't care about views
        if (ov === OV.ZR) fit -= this.crime[i] / 400;
        fit *= 1 - cong * 0.75;       // nobody moves up on a gridlocked block
        // schools & hospitals raise the growth cap: coverage speeds upgrades…
        const svc = (this.eduCov[i] + this.medCov[i]) / 510; // 0..1
        fit *= 0.7 + svc * 1.1;
        // M24: water gates DENSITY. A strained system (low pressure) damps EVERY
        // upgrade citywide without ever forcing anyone down; full pressure is a
        // no-op (0.55 + 0.45*1 = 1). The gate below is UPGRADE-ONLY — it never
        // decrements lvl, so a pre-M24 save (waterPressure defaults to 1, all
        // watered[]===0) keeps every loaded skyline and only pauses lots trying
        // to rise above level 1 until the player lays pipe from a tower/pump.
        fit *= 0.55 + 0.45 * this.waterPressure;
        // …and top-tier development flat-out requires a school OR hospital in reach
        if (this.lvl[i] >= 1 && !this.watered[i]) {
          // M24: no water → hard-capped at level 1 (a shack has a well; density needs mains)
        } else if (this.lvl[i] === 2 && this.eduCov[i] < 8 && this.medCov[i] < 8) {
          // capped at level 2 — nobody builds towers without services
        } else if (this.lvl[i] === 2 && this.waterPressure < 0.9) {
          // M24: strained mains → no level-3 towers until pressure recovers
        } else if (road && Math.random() < dem * fit * 0.42) {
          this.lvl[i]++; this.varnt[i] = (Math.random() * 5) | 0;
        }
      } else if (dem < -0.25 && this.lvl[i] > 0 && Math.random() < -dem * 0.3) {
        this.lvl[i]--;
      }

      // gridlock actively drives tenants away
      if (this.lvl[i] > 1 && cong > 0.8 && Math.random() < 0.07) this.lvl[i]--;
    }
  }

  // ---------- fire ----------
  fireTick() {
    const burning = [];
    for (let i = 0; i < this.fire.length; i++) if (this.fire[i]) burning.push(i);
    for (const i of burning) {
      const cov = this.fireCov[i];
      // M22: Smoke-Detector Mandate adds fireBurn to the decrement (same shape as
      // the coverage bonus) so fires burn out faster; 0 when off, floored at 0.
      this.fire[i] = Math.max(0, this.fire[i] - 1 - (cov > 40 ? 2 : 0) - this.ordMods.fireBurn);
      if (this.fire[i] === 0) {
        // burnt out -> rubble (or scorched earth)
        if (this.over[i] !== OV.NONE) {
          const a = this.anc[i] >= 0 ? this.anc[i] : i;
          const ax = a % MAP, ay = (a / MAP) | 0, s = sizeOf(this.over[a]);
          for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) {
            const j = this.idx(ax + dx, ay + dy);
            this.over[j] = OV.RUBBLE; this.lvl[j] = 0; this.anc[j] = -1;
          }
          this.powerDirty = true;
        } else if (this.terr[i] === TERR.FOREST) {
          this.terr[i] = TERR.GRASS; this.terrRev++;
        }
        continue;
      }
      // spread
      const x = i % MAP, y = (i / MAP) | 0;
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const X = x + dx, Y = y + dy;
        if (!this.inMap(X, Y)) continue;
        const j = this.idx(X, Y);
        if (this.fire[j]) continue;
        const flammable = (this.over[j] !== OV.NONE && this.over[j] !== OV.ROAD &&
                           this.over[j] !== OV.WIREROAD && // M26: crossing is a road, non-flammable
                           this.over[j] !== OV.PIPE &&      // M24: a buried pipe doesn't burn (towers/pumps do)
                           this.over[j] !== OV.RUBBLE) || this.terr[j] === TERR.FOREST;
        if (!flammable) continue;
        const chance = 0.09 * (1 - this.fireCov[j] / 300);
        if (Math.random() < chance) this.fire[j] = 8 + ((Math.random() * 6) | 0);
      }
    }
  }

  ignite(x, y) {
    if (!this.inMap(x, y)) return;
    const i = this.idx(x, y);
    const flammable = (this.over[i] !== OV.NONE && this.over[i] !== OV.ROAD &&
                       this.over[i] !== OV.WIREROAD && // M26: crossing is a road, non-flammable
                       this.over[i] !== OV.PIPE &&      // M24: a buried pipe doesn't burn (towers/pumps do)
                       this.over[i] !== OV.RUBBLE) || this.terr[i] === TERR.FOREST;
    if (flammable) { this.fire[i] = 10 + ((Math.random() * 8) | 0); this.devRev++; }
  }

  startDisaster(kind) {
    // City Hall records (M17): every disaster — menu, random misfortune or
    // scenario script — funnels through here, so count it against the year
    // in progress. recCur.year === this.year at every call site (the only
    // window where they differ is inside the rollover tick itself, before
    // updateRecords() runs, and nothing starts disasters there).
    this.recCur.disasters++;
    if (kind === "fire") {
      // torch a random developed tile
      const cand = [];
      for (let i = 0; i < this.over.length; i++)
        if (this.over[i] >= OV.ZR && this.over[i] !== OV.RUBBLE &&
            this.over[i] !== OV.WIREROAD && // M26: crossing is a road, not flammable
            this.over[i] !== OV.PIPE) cand.push(i); // M24: a buried pipe isn't a fire candidate (towers/pumps, like plants, are)
      const i = cand.length ? cand[(Math.random() * cand.length) | 0]
                            : (Math.random() * this.over.length) | 0;
      this.ignite(i % MAP, (i / MAP) | 0);
      this.pushMsg("🔥 FIRE breaks out downtown! Firefighters scramble.");
      return;
    }
    this.disaster = {
      kind,
      x: 5 + Math.random() * (MAP - 10),
      y: 5 + Math.random() * (MAP - 10),
      vx: Math.random() - 0.5, vy: Math.random() - 0.5,
      ticks: kind === "ufo" ? 70 : 90,
    };
    this.pushMsg(kind === "ufo"
      ? "👽 UNIDENTIFIED FLYING OBJECT over the city! (Roswell was 50 years ago... coincidence?)"
      : "🌪️ TORNADO WARNING! A twister is tearing through town!");
  }

  disasterTick() {
    const d = this.disaster;
    if (!d) return;
    d.ticks--;
    d.vx += (Math.random() - 0.5) * 0.4; d.vy += (Math.random() - 0.5) * 0.4;
    const sp = Math.hypot(d.vx, d.vy) || 1;
    d.vx = d.vx / sp * 0.8; d.vy = d.vy / sp * 0.8;
    d.x = Math.max(1, Math.min(MAP - 2, d.x + d.vx));
    d.y = Math.max(1, Math.min(MAP - 2, d.y + d.vy));
    const cx = d.x | 0, cy = d.y | 0;
    if (d.kind === "tornado") {
      // destroy what's underneath
      for (const [dx, dy] of [[0,0],[1,0],[0,1]]) {
        const X = cx + dx, Y = cy + dy;
        if (!this.inMap(X, Y)) continue;
        const i = this.idx(X, Y);
        if (this.over[i] !== OV.NONE && Math.random() < 0.5) {
          const a = this.anc[i] >= 0 ? this.anc[i] : i;
          const ax = a % MAP, ay = (a / MAP) | 0, s = sizeOf(this.over[a]);
          for (let ddy = 0; ddy < s; ddy++) for (let ddx = 0; ddx < s; ddx++) {
            const j = this.idx(ax + ddx, ay + ddy);
            this.over[j] = OV.RUBBLE; this.lvl[j] = 0; this.anc[j] = -1;
          }
          this.powerDirty = true;
        } else if (this.terr[i] === TERR.FOREST && Math.random() < 0.4) {
          this.terr[i] = TERR.GRASS; this.terrRev++;
        }
      }
    } else if (d.kind === "ufo") {
      // the saucer zaps things with fire
      if (Math.random() < 0.35) this.ignite(cx, cy);
    }
    if (d.ticks <= 0) {
      this.disaster = null;
      this.pushMsg(d.kind === "ufo" ? "👽 The saucer departs. The truth is out there."
                                    : "🌪️ The tornado dissipates. Assess the damage, Mayor.");
    }
  }

  // ---------- municipal bonds (M13) ----------
  // Sells one §BOND_PRINCIPAL general-obligation bond at the rate the city's
  // current credit rating commands (see creditRating above). The principal
  // lands in the treasury immediately; repayment is a fixed amortized payment
  // per month rollover, precomputed here by the standard annuity formula:
  //     m       = rate / 12                       (monthly interest rate)
  //     monthly = round(principal * m / (1 - (1 + m)^-term))
  // Refused outright at the BOND_MAX concurrent-bond cap.
  issueBond(amount = BOND_PRINCIPAL) {
    if (this.bonds.length >= BOND_MAX) return { ok: false, reason: "limit" };
    const rate = creditRating(this).rateOffered;
    const m = rate / 12;
    const monthly = Math.round(amount * m / (1 - Math.pow(1 + m, -BOND_TERM)));
    this.bonds.push({ principal: amount, rate, term: BOND_TERM,
                      remaining: BOND_TERM, monthly, balance: amount });
    this.funds += amount;
    this.pushMsg(`📜 City raises §${amount.toLocaleString()} on the municipal market ` +
      `at ${(rate * 100).toFixed(1)}% — debt service §${monthly}/mo for ${BOND_TERM} months.`);
    return { ok: true, rate, monthly };
  }

  // Early payoff (M13): a bond may be retired at any time for its remaining
  // balance plus a flat 2% early-payoff fee:
  //     cost = balance + round(balance * 0.02)
  // Refused outright (no partial payment) if the treasury can't cover cost.
  payoffBond(k) {
    const b = this.bonds[k];
    if (!b) return { ok: false, reason: "none" };
    const fee = Math.round(b.balance * 0.02);
    const cost = b.balance + fee;
    if (this.funds < cost) return { ok: false, reason: "funds", cost, fee };
    this.funds -= cost;
    this.bonds.splice(k, 1);
    this.pushMsg(`🏦 Debt cleared early — §${cost.toLocaleString()} handed to the ` +
      `holders of the §${b.principal.toLocaleString()} issue (incl. §${fee.toLocaleString()} fee).`);
    return { ok: true, cost, fee };
  }

  /* ---- per-department upkeep (M23) ----
     Replaces the old flat upkeep (all service anchors lumped at §25 apiece,
     roads*0.4 + wires*0.15). Each department's monthly charge is its legacy
     full-funding cost scaled by its own funding level and rounded ONCE
     (Math.round, half-up) — the documented formula:
         police = round(policeStations * 25 * funding.police / 100)
         fire   = round(fireStations   * 25 * funding.fire   / 100)
         edu    = round(schools        * 25 * funding.edu    / 100)
         health = round(hospitals      * 25 * funding.health / 100)
         roads  = round((roadTiles * 0.4 + wireTiles * 0.15) * funding.roads / 100)
     Invariants: all departments at 100% reproduce the legacy totals exactly
     (stations * 25 summed; road line = round(roads*0.4 + wires*0.15)); a
     department at 0% charges exactly §0; 50% charges exactly half the raw
     (pre-round) legacy figure, rounded once by the formula above.
     Used by collectBudget() for the real monthly charge and by the budget
     dialog for its live per-department projection. */
  deptCosts() {
    let roads = 0, wires = 0, police = 0, fireSt = 0, schools = 0,
        hospitals = 0, plants = 0, towers = 0, pumps = 0, pipeTiles = 0,
        surface = 0, subway = 0, stations = 0; // M25 rail-plane tallies
    for (let i = 0; i < this.over.length; i++) {
      const t = this.over[i];
      // M25: rail rides a separate plane — tally it alongside the over[] scan
      if (this.rail[i] === RL.TRACK) surface++;
      else if (this.rail[i] === RL.SUB) subway++;
      else if (this.rail[i] === RL.STATION) stations++;
      if (t === OV.ROAD || t === OV.WIREROAD) roads++; // M26: a crossing is counted as road infrastructure
      else if (t === OV.WIRE) wires++;
      else if (t === OV.PIPE) pipeTiles++;                              // M24
      else if (t === OV.WATERTOWER && this.anc[i] === i) towers++;      // M24
      else if (t === OV.PUMP && this.anc[i] === i) pumps++;             // M24
      else if (t === OV.POLICE && this.anc[i] === i) police++;
      else if (t === OV.FIRESTA && this.anc[i] === i) fireSt++;
      else if (t === OV.SCHOOL && this.anc[i] === i) schools++;
      else if (t === OV.HOSPITAL && this.anc[i] === i) hospitals++;
      else if (isPlant(t) && this.anc[i] === i) plants++;
    }
    const f = this.funding;
    return {
      police: Math.round(police * 25 * f.police / 100),
      fire:   Math.round(fireSt * 25 * f.fire / 100),
      edu:    Math.round(schools * 25 * f.edu / 100),
      health: Math.round(hospitals * 25 * f.health / 100),
      roads:  Math.round((roads * 0.4 + wires * 0.15) * f.roads / 100),
      plants: plants * 40,
      // M24: flat water-network upkeep (no funding slider — mirrors "plants*40").
      water:  Math.round(towers * 15 + pumps * 40 + pipeTiles * 0.15),
      // M25: transit upkeep, scaled by funding.transit. Because recomputeRail
      // ALSO scales catchment by f.transit, cutting Transit funding shrinks
      // ridership AND cost monotonically — a genuine tradeoff (police/fire idiom).
      transit: Math.round((surface * 0.3 + subway * 0.5 + stations * 20) * f.transit / 100),
    };
  }

  // ---------- budget (monthly) ----------
  collectBudget() {
    const dc = this.deptCosts(); // per-department charges (M23) — formula above
    const taxes = Math.round(this.pop * this.taxRate * 0.28 + this.jobs * this.taxRate * 0.18);
    const roadCost = dc.roads;
    const serviceCost = dc.police + dc.fire + dc.edu + dc.health;
    const plantCost = dc.plants;
    const waterCost = dc.water; // M24: flat water-network upkeep
    const transitCost = dc.transit; // M25: rail/subway/station upkeep (funding-scaled)
    // ---- debt service (M13) ----
    // Each active bond charges one payment per month rollover. The payment is
    // the fixed amortized `monthly` stamped at issue (annuity formula — see
    // issueBond):  monthly = round(principal * m / (1 - (1+m)^-term)),
    // m = rate/12. Each month splits into interest = round(balance * m) plus
    // principal (monthly - interest), which reduces balance; the FINAL month
    // instead charges exactly balance + interest so the loan always clears to
    // §0 with no residual. Total repaid over the full term is therefore
    // principal + interest ≈ monthly * term (±§1/month rounding), which
    // strictly exceeds principal. remaining decrements once per rollover; at
    // 0 the bond retires and a payoff notice hits the ticker exactly once.
    let debt = 0;
    for (let k = this.bonds.length - 1; k >= 0; k--) {
      const b = this.bonds[k];
      const interest = Math.round(b.balance * (b.rate / 12));
      const pay = b.remaining <= 1 ? b.balance + interest : b.monthly;
      b.balance = b.remaining <= 1 ? 0 : Math.max(0, b.balance - (pay - interest));
      debt += pay;
      b.remaining--;
      if (b.remaining <= 0) {
        this.bonds.splice(k, 1);
        this.pushMsg(`🎉 Bond paid off! The §${b.principal.toLocaleString()} issue is ` +
          `fully repaid — the ledger sighs with relief.`);
      }
    }
    // M22: ordinance costs/revenue — O(1) over the registry with the live
    // pop/comJobs/resTiles cached by recomputeDemand (run earlier this tick).
    const ob = this.ordinanceBudget();
    // M27: monthly regional power-trade balance (sell earns +, buy costs −),
    // gated on an open border wire so it is 0 when no power deal is live.
    const trade = this.powerTradeBudget();
    const net = taxes - roadCost - serviceCost - plantCost - waterCost - transitCost - debt + ob.net + trade;
    this.funds += net;
    this.lastBudget = { taxes, roads: roadCost, power: plantCost, services: serviceCost,
      water: waterCost, transit: transitCost, debt, net, // M24 water / M25 transit upkeep lines
      trade, // M27: regional power-trade line
      // M22: the ordinance line (net = revenue - cost) charged this month
      ord: ob.net, ordCost: ob.cost, ordRev: ob.rev,
      // M23: the per-department breakdown actually charged this month
      dept: { police: dc.police, fire: dc.fire, roads: dc.roads,
              edu: dc.edu, health: dc.health, water: dc.water, transit: dc.transit } };
    if (this.funds < 0) this.pushMsg("💸 The city is BROKE. Raise taxes or cut back, Mayor!");
    this.history.pop.push(this.pop);
    this.history.funds.push(this.funds);
    if (this.history.pop.length > 240) { this.history.pop.shift(); this.history.funds.shift(); }
  }

  // ---------- City Hall records (M17) ----------
  // Called exactly once per month rollover, right after collectBudget(): the
  // budget just collected belongs to the month that just COMPLETED, i.e. to
  // year Y = (month === 0 ? year - 1 : year) — which is always recCur.year.
  // On the Dec→Jan rollover the accumulator is finalized into records[] with
  // the end-of-year population sampled right here, and a fresh one opens.
  updateRecords() {
    this.recCur.taxes += this.lastBudget.taxes;
    this.recCur.net += this.lastBudget.net;
    if (this.month === 0) {
      this.records.push({
        year: this.recCur.year, pop: this.pop,
        taxes: this.recCur.taxes, net: this.recCur.net,
        disasters: this.recCur.disasters,
      });
      this.recCur = { year: this.year, taxes: 0, net: 0, disasters: 0 };
    }
  }

  // ---------- citizen complaints (M17) ----------
  // Month-rollover only, never per tick/frame. One bounded pass over the map
  // picks the most severe qualifying tile (thresholds: COMPLAINT_T, see the
  // block comment up top); if anything qualifies and it has been at least
  // COMPLAINT_EVERY rollovers since the last complaint, a structured item
  // {complaint:true, kind, name, x, y, text} joins the ticker queue. A city
  // with zero qualifying tiles never complains at all.
  scanComplaints() {
    if (++this.sinceComplaint < COMPLAINT_EVERY) return;
    let best = -1, bestKind = null, bestScore = 0;
    for (let i = 0; i < this.over.length; i++) {
      const t = this.over[i];
      let kind = null, score = 0;
      if (t === OV.RUBBLE) { kind = "rubble"; score = 130; }
      else if ((t === OV.ROAD || t === OV.WIREROAD) && this.traffic[i] >= COMPLAINT_T.traffic) { // M26: crossing can jam like a road
        kind = "traffic"; score = 60 + this.traffic[i] - COMPLAINT_T.traffic;
      } else if ((t === OV.ZR || t === OV.ZC || t === OV.ZI) &&
                 this.lvl[i] > 0 && !this.powered[i]) {
        kind = "unpowered"; score = 150;
      }
      if (this.crime[i] >= COMPLAINT_T.crime && 40 + this.crime[i] - COMPLAINT_T.crime > score) {
        kind = "crime"; score = 40 + this.crime[i] - COMPLAINT_T.crime;
      }
      if (this.poll[i] >= COMPLAINT_T.poll && 40 + this.poll[i] - COMPLAINT_T.poll > score) {
        kind = "poll"; score = 40 + this.poll[i] - COMPLAINT_T.poll;
      }
      if (kind && score > bestScore) { best = i; bestKind = kind; bestScore = score; }
    }
    if (best < 0) return;
    this.sinceComplaint = 0;
    const name = CITIZEN_FIRST[(Math.random() * CITIZEN_FIRST.length) | 0] + " " +
                 CITIZEN_LAST[(Math.random() * CITIZEN_LAST.length) | 0];
    this.pushMsg({
      complaint: true, kind: bestKind, name,
      x: best % MAP, y: (best / MAP) | 0,
      text: COMPLAINT_TEXT[bestKind](name),
    });
  }

  // ---------- time capsule events (M7) ----------
  y2kActive() { return this.activeMods.some((m) => m.type === "y2k"); }

  // called on every month rollover: expire modifiers first, then fire due events
  eventsTick() {
    // count down temporary modifiers; announce resolutions on expiry
    let powerChanged = false;
    for (let k = this.activeMods.length - 1; k >= 0; k--) {
      const m = this.activeMods[k];
      if (m.remaining == null) continue;              // permanent modifier
      if (--m.remaining > 0) continue;
      this.activeMods.splice(k, 1);
      if (m.type === "powerDemand" || m.type === "y2k") powerChanged = true;
      const ev = EVENTS.find((e) => e.id === m.id);
      if (ev && ev.resolve) this.announceEvent(ev.resolve);
    }
    if (powerChanged) { this.powerDirty = true; this.recomputePower(); }

    // fire events whose date has arrived, exactly once each; anything whose
    // date is already behind us (loaded save, jumped clock) passes silently
    for (const ev of EVENTS) {
      if (this.firedEvents.includes(ev.id)) continue;
      if (ev.year > this.year || (ev.year === this.year && ev.month > this.month))
        continue;                                     // still in the future
      this.firedEvents.push(ev.id);
      if (ev.year === this.year && ev.month === this.month) this.fireEvent(ev);
    }
  }

  fireEvent(ev) {
    this.announceEvent(ev);
    const ef = ev.effect;
    if (!ef) return;
    if (ef.type === "funds") { this.funds += ef.amount; return; }
    const mod = { id: ev.id, type: ef.type, remaining: ef.months ?? null };
    if (ef.add != null) mod.add = ef.add;
    if (ef.mult != null) mod.mult = ef.mult;
    this.activeMods.push(mod);
    if (ef.type === "powerDemand" || ef.type === "y2k") {
      this.powerDirty = true; this.recomputePower(); // effect visible at once
    }
  }

  // every event hits the ticker; paper:true editions also queue for #dlg-news
  announceEvent(ed) {
    this.pushMsg(ed.headline);
    if (ed.paper)
      this.newsQueue.push({ headline: ed.headline, sub: ed.sub || "", body: ed.body || "" });
  }

  // events dated before "now" (fresh or loaded city) never retro-fire
  markPassedEvents() {
    for (const ev of EVENTS) {
      const past = ev.year < this.year ||
                   (ev.year === this.year && ev.month <= this.month);
      if (past && !this.firedEvents.includes(ev.id)) this.firedEvents.push(ev.id);
    }
  }

  // ---------- master tick ----------
  tick() {
    this.tickCount++;
    // Y2K chaos (Dec 1999): the grid flickers and the wires hum with panic
    if (this.y2kActive()) {
      if (this.tickCount % 3 === 0) this.powerDirty = true; // flicker pulse
      if (this.tickCount % 8 === 0)
        this.pushMsg(Y2K_LINES[(Math.random() * Y2K_LINES.length) | 0]);
    }
    // M25: capture the refresh decision BEFORE recomputePower() clears powerDirty.
    // Stations read powered[], so recomputeRail runs AFTER power and BEFORE
    // traffic; a pure rail build sets only railDirty (power unchanged) and reads
    // the still-valid powered[]. recomputeTraffic reads railCov read-only.
    const doPower = this.powerDirty || this.tickCount % 10 === 0;
    if (doPower) {
      this.recomputePower();
      this.recomputeAccess();
      this.recomputeWater(); // M24: AFTER power — a pump reads fresh powered[]
      this.recomputeRegion(); // M27: refresh commuterBias from fresh conn[]/deals (updateConnections ran inside recomputePower)
    }
    if (doPower || this.railDirty) { this.recomputeRail(); this.railDirty = false; }
    if (this.tickCount % 5 === 0) this.recomputeTraffic();
    if (this.tickCount % 14 === 0) this.recomputeMaps();
    this.recomputeDemand();

    // milestone check — promote to the highest qualifying rank, exactly once
    const nt = tierForPop(this.pop);
    if (nt > this.tier) {
      this.tier = nt;
      // M22: a tier rise can unlock a tier-gated ordinance — refresh the effect
      // cache so its bonus applies the moment the ratchet reaches it (matching
      // the budget, which already reads the live tier). A no-op that rebuilds
      // identity mods when nothing tier-eligible is enacted, so no-ordinance
      // ticks stay byte-identical.
      this.recomputeOrdinances();
      if (nt > this.announcedTier) {
        this.announcedTier = nt;
        this.newsQueue.push(nt);
        this.pushMsg(`🏆 ${this.cityName} has grown into a ${TIERS[nt].name.toUpperCase()}! The papers are all over it.`);
      }
    }

    this.growthPass();
    if (this.tickCount % 2 === 0) this.fireTick();
    this.disasterTick();

    // random misfortune
    if (this.disastersEnabled && Math.random() < 0.0009 && this.pop > 200) {
      this.startDisaster(Math.random() < 0.75 ? "fire" : (Math.random() < 0.6 ? "tornado" : "ufo"));
    }

    // a month passes every 24 ticks
    if (this.tickCount % 24 === 0) {
      this.month++;
      if (this.month >= 12) { this.month = 0; this.year++; }
      this.eventsTick();
      this.roadWearTick();    // road wear & crumble (M23) — rollover only
      this.plantAgingTick();  // power plant aging notices (M19) — rollover only
      this.collectBudget();
      this.updateRecords();   // City Hall records (M17) — rollover only
      this.scanComplaints();  // citizen complaints (M17) — rollover only
      // news chopper (M18): the spawn DECISION runs here and ONLY here —
      // once per month rollover, alongside the other amortized scans. The
      // per-rollover probability (CHOPPER_CHANCE) and the congestion gate
      // are documented at chopperMonthTick / chopperTrySpawn in render.js.
      if (typeof chopperMonthTick === "function") chopperMonthTick(this);
      // scenario win/lose check (M9) — monthly only, never per-tick
      if (this.scenarioId && typeof scenarioMonthTick === "function")
        scenarioMonthTick(this);
      return true; // month rolled over
    }
    return false;
  }

  pushMsg(m) { this.messages.push(m); }

  // ---------- districts (M21) ----------
  // Paint a district id onto ANY land/water tile. O(1). Never charges funds and
  // never touches over[]/lvl[]/anc[] — a district co-exists with whatever
  // zone/road/plant occupies the tile. Neighborhoods deliberately SURVIVE
  // bulldoze/rezoning (an administrative boundary, like SC2K); only the eraser
  // swatch (id 0) or deleteDistrict clears a tile. A same-id repaint is a no-op
  // and does NOT bump distRev, so drag-paint over an already-painted swath is free.
  paintDistrict(x, y, id) {
    if (!this.inMap(x, y)) return;
    const i = y * MAP + x;
    if (this.district[i] === id) return;
    this.district[i] = id;
    this.distRev++;
  }

  // Allocate the smallest unused id in 1..DIST_MAX (delete+create never leaks
  // an id and nothing extra needs serializing). Returns the new id, or 0 when
  // the palette/id space is exhausted (caller shows the denied path).
  newDistrict(name) {
    if (this.districts.length >= DIST_MAX) return 0;
    let id = 0;
    for (let k = 1; k <= DIST_MAX; k++) {
      if (!this.districts.some((d) => d.id === k)) { id = k; break; }
    }
    if (!id) return 0;
    const col = (id - 1) % DISTRICT_COLS.length;
    const nm = String(name == null ? "" : name).trim().slice(0, 24) || `District ${id}`;
    this.districts.push({ id, name: nm, col });
    this.distRev++;
    return id;
  }

  renameDistrict(id, name) {
    const d = this.districts.find((d) => d.id === id);
    if (!d) return;
    const nm = String(name == null ? "" : name).trim().slice(0, 24);
    if (nm) d.name = nm;
    this.distRev++;
  }

  recolorDistrict(id) {
    const d = this.districts.find((d) => d.id === id);
    if (!d) return;
    d.col = (d.col + 1) % DISTRICT_COLS.length;
    this.distRev++;
  }

  deleteDistrict(id) {
    const idx = this.districts.findIndex((d) => d.id === id);
    if (idx < 0) return;
    for (let i = 0; i < this.district.length; i++)
      if (this.district[i] === id) this.district[i] = 0;
    this.districts.splice(idx, 1);
    this.distRev++;
  }

  // Pure read-only aggregator over the EXISTING sim maps (landv/poll/crime/
  // traffic/powered/coverage, over/lvl). Called ONLY on dialog open, never in
  // tick(): mutates nothing and calls no recompute*. avg land value is the mean
  // of city.landv over exactly the district's tiles (the "integrate with the
  // land-value map" requirement); pop/jobs are Σ RES_POP/COM_JOB/IND_JOB over
  // developed zone tiles — the same tables growthPass uses.
  districtStats(id) {
    let tiles = 0, developed = 0, pop = 0, jobs = 0, poweredDev = 0;
    let sumLv = 0, sumPoll = 0, sumCrime = 0;
    let sumEdu = 0, sumMed = 0, sumPol = 0, sumFire = 0;
    let sumTraffic = 0, roadTiles = 0;
    let zr = 0, zc = 0, zi = 0;
    for (let i = 0; i < this.district.length; i++) {
      if (this.district[i] !== id) continue;
      tiles++;
      const ov = this.over[i], lv = this.lvl[i];
      sumLv += this.landv[i]; sumPoll += this.poll[i]; sumCrime += this.crime[i];
      sumEdu += this.eduCov[i]; sumMed += this.medCov[i];
      sumPol += this.polCov[i]; sumFire += this.fireCov[i];
      if (ov === OV.ROAD || ov === OV.WIREROAD) { sumTraffic += this.traffic[i]; roadTiles++; }
      if (ov === OV.ZR) { zr++; if (lv > 0) { pop += RES_POP[lv]; developed++; if (this.powered[i]) poweredDev++; } }
      else if (ov === OV.ZC) { zc++; if (lv > 0) { jobs += COM_JOB[lv]; developed++; if (this.powered[i]) poweredDev++; } }
      else if (ov === OV.ZI) { zi++; if (lv > 0) { jobs += IND_JOB[lv]; developed++; if (this.powered[i]) poweredDev++; } }
    }
    const avg = (s) => (tiles ? Math.round(s / tiles) : 0);
    let dominant = "None";
    if (zr || zc || zi) {
      dominant = (zr >= zc && zr >= zi) ? "Residential"
        : (zc >= zi) ? "Commercial" : "Industrial";
    }
    return {
      tiles, developed, pop, jobs,
      landv: avg(sumLv), poll: avg(sumPoll), crime: avg(sumCrime),
      edu: avg(sumEdu), med: avg(sumMed), pol: avg(sumPol), fire: avg(sumFire),
      traffic: roadTiles ? Math.round(sumTraffic / roadTiles) : 0,
      powered: developed ? Math.round((poweredDev / developed) * 100) : 0,
      dominant,
    };
  }

  // ---------- save / load ----------
  serialize() {
    return JSON.stringify({
      v: 10, size: this.size, seed: this.seed, cityName: this.cityName,
      funds: this.funds, taxRate: this.taxRate,
      // M23 (save v7): per-department funding levels + road wear counters
      funding: this.funding,
      roadWear: Array.from(this.roadWear),
      // M19 (save v8): per-anchor power-plant build years, for the aging curve
      plantYear: Array.from(this.plantYear),
      bonds: this.bonds,
      month: this.month, year: this.year, tickCount: this.tickCount,
      disastersEnabled: this.disastersEnabled,
      tier: this.tier, announcedTier: this.announcedTier,
      firedEvents: this.firedEvents, activeMods: this.activeMods,
      scenarioId: this.scenarioId, scnWon: this.scnWon,
      scnLost: this.scnLost, scnBest: this.scnBest,
      // City Hall records (M17, save v6): completed years + live YTD accum
      records: this.records, recCur: this.recCur,
      terr: Array.from(this.terr), over: Array.from(this.over),
      lvl: Array.from(this.lvl), varnt: Array.from(this.varnt),
      anc: Array.from(this.anc),
      // M25 (still save v9): the rail plane is the SOLE new authored transit
      // state — the physical network (surface track / subway / stations) lives
      // entirely in it. railNet/stationLive/railCov/railRiders and the funding.
      // transit lever ride along (funding is serialized wholesale below); all
      // are DERIVED and rebuilt on load. A v9-from-before-M25 save simply lacks
      // this field and loads with rail all-zero (zero behavioral drift).
      rail: Array.from(this.rail),
      // M21 (save v9): the per-tile district layer (mostly zeros, same idiom/
      // footprint as over/lvl/roadWear) plus the tiny district metadata list.
      // distRev + all districtStats are derived and NOT serialized (same policy
      // as landv/crime/traffic) — they reproduce exactly from the restored tiles.
      district: Array.from(this.district),
      districts: this.districts,
      // M22 (still save v9): the enacted-ordinance boolean map — a small flat
      // id->true object. ordMods and the § figures are DERIVED and never saved.
      // A v9 save from before M22 simply lacks this field and loads all-off.
      ordinances: this.ordinances,
      // M27 (save v10): the ONLY authored region state — per-edge deal
      // {mode,mw,commute} + current negotiated disposition. neighbors (names/
      // archetypes/prices/commuter/initial disposition) is a PURE function of
      // seed and is recomputed on load, NOT serialized; conn[]/commuterBias[] are
      // DERIVED and rebuilt in the load cascade. A v9-or-earlier save lacks these
      // two fields → all deals none + seed-derived disp → the loaded city
      // simulates byte-identically to pre-M27.
      deals: this.deals.map((d) => ({ mode: d.mode, mw: d.mw, commute: d.commute })),
      disp: Array.from(this.disp),
      history: this.history,
    });
  }

  static deserialize(json) {
    const d = JSON.parse(json);
    // v<=3 saves predate the size field: they are always 80x80, but infer from
    // the raw array length anyway so any well-formed save loads consistently.
    const size = d.size ||
      (Array.isArray(d.terr) ? Math.round(Math.sqrt(d.terr.length)) : 80) || 80;
    const c = new City(d.seed, size);
    c.cityName = d.cityName; c.funds = d.funds; c.taxRate = d.taxRate;
    c.month = d.month; c.year = d.year; c.tickCount = d.tickCount;
    c.disastersEnabled = d.disastersEnabled;
    c.terr.set(d.terr); c.over.set(d.over); c.lvl.set(d.lvl);
    c.varnt.set(d.varnt); c.anc.set(d.anc);
    // M23 (save v7): department funding + road wear. A v6-or-earlier save has
    // neither field: every department loads at the 100% default and all roads
    // load pristine (wear 0) — the city keeps playing exactly as before.
    // M25: funding.transit joins the default map — a legacy save with no transit
    // key loads at 100% (zero behavioral drift) since funding is merged wholesale.
    c.funding = Object.assign({ police: 100, fire: 100, roads: 100, edu: 100, health: 100, transit: 100 },
      (d.funding && typeof d.funding === "object") ? d.funding : {});
    if (Array.isArray(d.roadWear)) c.roadWear.set(d.roadWear);
    // M19 (save v8): restore per-anchor plant build years. A v7-or-earlier
    // save has no plantYear field: default every existing plant's build year
    // to the loaded/current year, so it loads at full nameplate capacity and
    // begins aging from the moment of load (no phantom decay on old cities).
    if (Array.isArray(d.plantYear)) c.plantYear.set(d.plantYear);
    else {
      for (let i = 0; i < c.over.length; i++)
        if (isPlant(c.over[i]) && c.anc[i] === i) c.plantYear[i] = c.year;
    }
    // M21 (save v9): restore the district layer + metadata. A v8-or-earlier
    // save has neither field: the ctor's all-zero district[] and empty
    // districts[] stand, so the city loads with no neighborhoods assigned and
    // plays identically. distRev starts 0 (ephemeral); the first label draw
    // rebuilds the centroid cache. Guards are defensive Array.isArray checks —
    // no hard v===9 test — so any older save force-loads cleanly.
    if (Array.isArray(d.district)) c.district.set(d.district);
    c.districts = Array.isArray(d.districts)
      ? d.districts.map((o) => Object.assign({}, o)) : [];
    // M25: restore the rail plane (the sole authored transit field). A save with
    // no rail field leaves the ctor's all-zero rail[] — railCov stays all-zero,
    // recomputeTraffic's share is always 0, and traffic behaves exactly as before.
    // railNet/stationLive/railCov are DERIVED — rebuilt by recomputeRail below.
    if (Array.isArray(d.rail)) c.rail.set(d.rail);
    // M27 (save v10): overlay the authored deal + disposition state. Defensive
    // Array.isArray guards (NO hard v===10 test, matching every prior milestone):
    // a v9-or-earlier save has neither field, so the ctor's default deals (all
    // none) and seed-derived disp stand → powerTradeDelta()/powerTradeBudget()=0
    // and commuterBias all-zero → the loaded city plays byte-identically to
    // pre-M27. neighbors[] was already rebuilt from d.seed by the ctor above.
    if (Array.isArray(d.deals))
      for (let e = 0; e < 4 && e < d.deals.length; e++) {
        const s = d.deals[e]; if (!s) continue;
        c.deals[e] = { mode: s.mode | 0, mw: Math.max(0, s.mw | 0), commute: !!s.commute };
      }
    if (Array.isArray(d.disp)) for (let e = 0; e < 4 && e < d.disp.length; e++) c.disp[e] = d.disp[e] | 0;
    // M22 (still save v9): restore the enacted-ordinance map. A v9-from-before-
    // M22 save (or any pre-v9 save) has no ordinances field => {} => everything
    // off => ordMods identity => the city plays byte-identically to pre-M22.
    // Unknown/removed ids survive harmlessly (recomputeOrdinances/ordinanceBudget
    // iterate the registry and read this.ordinances[id], never the reverse).
    c.ordinances = (d.ordinances && typeof d.ordinances === "object")
      ? Object.assign({}, d.ordinances) : {};
    c.history = d.history || { pop: [], funds: [] };
    // time-capsule events (M7): restore fired ids + live modifiers with their
    // remaining timers; a pre-M7 (v<=2) save simply has neither field, and
    // markPassedEvents() quietly retires anything the calendar already passed
    // so loading an old city never retro-fires 1997 headlines.
    // municipal bonds (M13, save v5): restore each bond's full amortization
    // state. A v4-or-earlier save simply has no bonds field and loads
    // debt-free; the credit rating is never serialized — it's a pure function
    // of funds + bonds, recomputed on demand (see creditRating).
    c.bonds = Array.isArray(d.bonds)
      ? d.bonds.map((b) => Object.assign({}, b)) : [];
    c.firedEvents = Array.isArray(d.firedEvents) ? d.firedEvents.slice() : [];
    c.activeMods = Array.isArray(d.activeMods)
      ? d.activeMods.map((m) => Object.assign({}, m)) : [];
    c.markPassedEvents();
    c.powerDirty = true;
    // M22: restore the tier (pure data, safe to set early) and rebuild ordMods
    // BEFORE the recompute cascade — those passes read this.ordMods, and the
    // ordinance unlock gate reads this.tier, so both must be warm first. Legacy
    // saves with no numeric tier keep tier=0 here (their empty ordinances map
    // yields identity regardless), and the post-cascade line below infers the
    // real rank from the now-computed population.
    if (typeof d.tier === "number") c.tier = d.tier;
    c.recomputeOrdinances();
    c.recomputePower(); c.recomputeAccess();
    // M24: rebuild the DERIVED water state from the loaded over[] (PIPE/WATERTOWER/
    // PUMP ride in over[]/anc[] — no new serialized array). Runs after
    // recomputePower so a loaded pump reads fresh powered[]. A pre-M24 save has
    // no 19..21 tiles, so this yields watered[] all-zero + waterPressure=1
    // (supply 0/demand 0 → the demand?…:1 branch); because the density gate is
    // UPGRADE-ONLY and never decrements lvl, every existing skyline loads intact.
    c.recomputeWater();
    // M27: rebuild the DERIVED region state (border-scan conn[] + per-tile
    // commuterBias[]) from the loaded over[]/rail[] + restored deals. conn[] was
    // already refreshed inside recomputePower above; recomputeRegion needs it +
    // the deals to stamp commuterBias. Runs before recomputeTraffic since
    // commuterBias feeds growth, not traffic.
    c.updateConnections();
    c.recomputeRegion();
    // M25: rebuild the DERIVED rail state from the loaded rail[] plane, AFTER
    // recomputePower (a station reads fresh powered[]) and BEFORE recomputeTraffic
    // (which consumes railCov for the diversion). silent=true so a loaded open
    // line never re-fires the "Metro is open" ticker; the metroOpened flag it
    // sets carries forward. railDirty is cleared afterward (nothing pending).
    c.recomputeRail(true);
    c.railDirty = false;
    c.recomputeTraffic();
    c.recomputeMaps(); c.recomputeDemand();
    // milestone state: restore, or (legacy v1 save) infer rank from population
    // so loading never fires a promotion newspaper
    c.tier = typeof d.tier === "number" ? d.tier : tierForPop(c.pop);
    c.announcedTier = typeof d.announcedTier === "number" ? d.announcedTier : c.tier;
    c.newsQueue = [];
    // scenario mode (M9): restore the id, progress and latches so a loaded
    // winner never re-celebrates (the newsQueue reset above can't defeat the
    // latch — scenarioMonthTick only fires on a false→true transition).
    // Saves without these fields (free play / pre-M9) load as plain free play.
    c.scenarioId = d.scenarioId || null;
    c.scnWon = !!d.scnWon; c.scnLost = !!d.scnLost;
    c.scnBest = typeof d.scnBest === "number" ? d.scnBest : 9999;
    // City Hall records (M17, save v6): restore completed years plus the
    // in-progress year-to-date accumulator. A v5-or-earlier save has neither
    // field: it loads with an empty almanac and a fresh accumulator opened at
    // the loaded date, so recording simply resumes from the moment of load.
    c.records = Array.isArray(d.records)
      ? d.records.map((r) => Object.assign({}, r)) : [];
    c.recCur = d.recCur && typeof d.recCur === "object"
      ? Object.assign({}, d.recCur)
      : { year: c.year, taxes: 0, net: 0, disasters: 0 };
    return c;
  }
}

// map tool id -> overlay type
function toolOverlay(tool) {
  return ({
    road: OV.ROAD, wire: OV.WIRE, zr: OV.ZR, zc: OV.ZC, zi: OV.ZI,
    park: OV.PARK, police: OV.POLICE, firesta: OV.FIRESTA,
    coal: OV.COAL, solar: OV.SOLAR, gas: OV.GAS, wind: OV.WIND,
    pipe: OV.PIPE, watertower: OV.WATERTOWER, pump: OV.PUMP, // M24
    school: OV.SCHOOL, hospital: OV.HOSPITAL,
    mayor: OV.MAYOR, stadium: OV.STADIUM,
    // M28: arcologies + wonder landmarks
    plymouth: OV.PLYMOUTH, forest: OV.FOREST, darco: OV.DARCO, launch: OV.LAUNCH,
    statue: OV.STATUE, eiffel: OV.EIFFEL, pyramid: OV.PYRAMID,
  })[tool] ?? OV.NONE;
}
