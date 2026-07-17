/* ============ SimCity 99 — scenario mode (M9) + medals (M16) ============ */
"use strict";

/* One declarative table drives everything scenario-shaped. Each entry:
     id           unique string id
     title        era-flavored name (shown on the splash card)
     description  card blurb / newspaper copy
     goal         human-readable goal text, shown at start and on the card
     funds        starting treasury the scenario opens with
     deadline     {year, month} — miss it with the goal unmet and you lose
     pressure     optional ongoing-pressure spec (scripted disasters)
     medals       machine-readable medal cutoffs (M16), in months left on the
                  clock at the moment the win latches:
                      monthsLeft >= medals.gold    → 🥇 gold
                      monthsLeft >= medals.silver  → 🥈 silver
                      anything else (a win is a win) → 🥉 bronze
     build()      returns a deterministic pre-built City (fixed seed +
                  scripted roads/zones/plants; cosmetic varnt may differ)
     sample(c)    optional monthly metric sampler (updates c.scnBest)
     winCheck(c)  true when the goal is met (evaluated on month rollover)
     progressText(c)  live "current / target · time left" for the status bar
     win / lose   Bugle front pages for the two outcomes
   Win/lose evaluation happens ONLY in scenarioMonthTick, called from the
   month-rollover branch of City.tick() — nothing scenario-ish runs per-tick. */

// jammed road tiles: congestion at/above 100 on a road
function scnCongested(c) {
  let n = 0;
  for (let i = 0; i < c.traffic.length; i++)
    if (c.over[i] === OV.ROAD && c.traffic[i] >= 100) n++;
  return n;
}

function scnMonthsLeft(c, sc) {
  if (!sc.deadline) return 0;
  return Math.max(0, (sc.deadline.year - c.year) * 12 + (sc.deadline.month - c.month));
}

function scnDeadlinePassed(c, sc) {
  return !!sc.deadline && (c.year > sc.deadline.year ||
    (c.year === sc.deadline.year && c.month >= sc.deadline.month));
}

// powered zone tiles — the live grid metric Blackout Summer's goal counts
function scnPoweredZones(c) {
  let n = 0;
  for (let i = 0; i < c.over.length; i++) {
    const t = c.over[i];
    if ((t === OV.ZR || t === OV.ZC || t === OV.ZI) && c.powered[i]) n++;
  }
  return n;
}

/* Shared scripted-town builder. Deterministic by construction: fixed City
   seed, the district is flattened to grass tile-by-tile, and every place()
   call happens in a fixed order. place() only uses Math.random for the
   cosmetic sprite variant, so terr/over/lvl/anc are identical every run.
   Layout: a row of coal plants on top, a wire bus below them, a wire spine
   down the middle column (crossing the road rows through a one-tile gap),
   road rows every 4th row, zones in between — every zone within reach of
   both power and a road. */
function scnBuildTown(o) {
  const c = new City(o.seed, 80); // scenarios stay pinned to the classic 80x80 map (M11)
  c.cityName = o.name;
  c.funds = 9e9;                        // construction budget; caller sets real funds
  const wx = ((o.x0 + o.x1) / 2) | 0;   // wire-spine column
  for (let y = o.y0 - 5; y <= o.y1 + 1; y++) for (let x = o.x0 - 1; x <= o.x1 + 1; x++) {
    if (!c.inMap(x, y)) continue;
    const i = y * MAP + x;
    if (c.terr[i] !== TERR.GRASS) { c.terr[i] = TERR.GRASS; c.varnt[i] = (x + y) % 4; }
  }
  for (let k = 0; k < o.plants; k++) c.place("coal", o.x0 + 1 + k * 4, o.y0 - 5);
  for (let x = o.x0; x <= o.x1; x++) c.place("wire", x, o.y0 - 3); // bus under plants
  c.place("wire", wx, o.y0 - 2);
  c.place("wire", wx, o.y0 - 1);
  for (let y = o.y0; y <= o.y1; y++) for (let x = o.x0; x <= o.x1; x++) {
    if (x === wx) { c.place("wire", x, y); continue; }             // spine
    if ((y - o.y0) % 4 === 0) { c.place("road", x, y); continue; } // arterial rows
    const kind = o.kindAt(x, y);
    c.place(kind, x, y);
    const i = y * MAP + x;
    if (c.over[i] === toolOverlay(kind)) c.lvl[i] = o.lvlAt(x, y);
  }
  return c;
}

const SCENARIOS = [
  {
    id: "gridlock-97",
    title: "Gridlock '97",
    description: "Llamalock boomed before anyone thought about road capacity. " +
      "Now every commute is measured in full cassette albums and the horn " +
      "section never, ever stops.",
    goal: "Get the city moving: cut jammed road tiles to 8 or fewer before Jan 1999.",
    funds: 10000,
    deadline: { year: 1999, month: 0 },
    winTarget: 8,
    medals: { gold: 12, silver: 6 }, // months left at the win: ≥12 🥇, ≥6 🥈, else 🥉
    build() {
      return scnBuildTown({
        seed: 971104, name: "Llamalock",
        x0: 14, y0: 14, x1: 49, y1: 49, plants: 5,
        kindAt: (x, y) => ["zr", "zc", "zi"][(((x / 4) | 0) + ((y / 4) | 0)) % 3],
        lvlAt: (x, y) => 2 + ((x + y) % 2),
      });
    },
    // scnBest = lowest jam count ever observed (win latches, so best-ever is
    // exactly "the goal held at some sampled moment")
    sample(c) { c.scnBest = Math.min(c.scnBest, scnCongested(c)); },
    winCheck(c) { return c.scnBest <= this.winTarget || scnCongested(c) <= this.winTarget; },
    progressText(c) {
      return `🚦 Jams: ${scnCongested(c)} / max ${this.winTarget} · ${scnMonthsLeft(c, this)}mo left`;
    },
    win: {
      headline: "🏆 GRIDLOCK BUSTED! LLAMALOCK MOVES AGAIN",
      sub: "Scenario complete — traffic thins to a trickle; commuters weep tears of joy",
      body: "City engineers confirm the Great Jam of 1997 is officially over. " +
        "Horns fell silent at rush hour for the first time since the Macarena " +
        "charted, and one driver reportedly made it across town before side B " +
        "ended. \"We can see the asphalt,\" marveled the transit chief. The " +
        "mayor keeps the office, the keys to the city, and bragging rights " +
        "forever. The city now plays on in sandbox mode.",
    },
    lose: {
      headline: "🚗 BUMPER TO BUMPER FOREVER — THE '97 JAM OUTLASTS ITS DEADLINE",
      sub: "Time expires with the roads still choked; council shrugs, honking resumes",
      body: "January 1999 arrived and Llamalock's arteries remain a parking lot. " +
        "The council's traffic task force has been disbanded, its members last " +
        "seen abandoning their cars on Route 9. It is not the ending anyone " +
        "wanted, but the city is still yours, Mayor: keep bulldozing, keep " +
        "building, and maybe one day the horns will stop on their own.",
    },
  },
  {
    id: "twister-season",
    title: "Twister Season",
    description: "Twisterton sits square in Tornado Alley, and 1997's storm " +
      "chasers say this season will be one for the VHS collection. Grow the " +
      "town anyway — between funnel clouds.",
    goal: "Grow the population to 4000 or more by Jan 2000, despite the tornadoes.",
    funds: 15000,
    deadline: { year: 2000, month: 0 },
    pressure: { type: "tornado", everyMonths: 2, months: 12 },
    winTarget: 4000,
    medals: { gold: 18, silver: 9 }, // months left at the win: ≥18 🥇, ≥9 🥈, else 🥉
    build() {
      return scnBuildTown({
        seed: 51996, name: "Twisterton",
        x0: 24, y0: 26, x1: 55, y1: 49, plants: 3,
        kindAt: (x, y) => ["zr", "zr", "zc", "zi"][(x + y) % 4],
        lvlAt: (x, y) => ((x * 3 + y) % 3 === 0 ? 0 : 1),
      });
    },
    winCheck(c) { return c.pop >= this.winTarget; },
    progressText(c) {
      return `👥 Pop: ${c.pop} / ${this.winTarget} · ${scnMonthsLeft(c, this)}mo left`;
    },
    win: {
      headline: "🏆 TWISTERTON STANDS TALL — POPULATION GOAL SMASHED MID-STORM",
      sub: "Scenario complete — four thousand souls and counting call the Alley home",
      body: "Against every funnel cloud the season could throw, Twisterton hit " +
        "its growth target with time on the clock. New arrivals cite \"cheap " +
        "land, sturdy basements, and unbeatable cloud-watching.\" The weather " +
        "service has named the next twister after the mayor, as an honor. " +
        "The city now plays on in sandbox mode.",
    },
    lose: {
      headline: "🌪️ SEASON ENDS IN HEARTBREAK — GROWTH TARGET BLOWN AWAY",
      sub: "The millennium arrives with Twisterton still under the mark",
      body: "January 2000 rolled in and the census came up short. The storm " +
        "chasers have packed their camcorders and moved on, leaving quiet " +
        "streets and empty lots. Still, the town survives, and it remains " +
        "yours to rebuild at your own pace, Mayor — the next census is " +
        "whenever you say it is.",
    },
  },
  /* ---- M16 scenarios ---- */
  {
    id: "blackout-summer-97",
    title: "Blackout Summer '97",
    description: "Ampereville's bankrupt utility hauled every last generator " +
      "to the scrapyard in January, and forecasters promise a record heat " +
      "wave by June. A whole city sits dark with AC season on the way.",
    goal: "Relight the grid: get 300 or more zone tiles powered before Jan 1999.",
    funds: 9000,
    deadline: { year: 1999, month: 0 },
    winTarget: 300,
    medals: { gold: 12, silver: 6 }, // months left at the win: ≥12 🥇, ≥6 🥈, else 🥉
    build() {
      const c = scnBuildTown({
        seed: 970601, name: "Ampereville",
        x0: 20, y0: 20, x1: 51, y1: 47, plants: 5,
        kindAt: (x, y) => ["zr", "zc", "zr", "zi"][(((x / 3) | 0) + y) % 4],
        lvlAt: (x, y) => 1 + ((x * 2 + y) % 3 === 0 ? 1 : 0),
      });
      // the utility's collapse: every plant is already scrap when the mayor
      // arrives — flattened to rubble in fixed index order (deterministic)
      for (let i = 0; i < c.over.length; i++)
        if (c.over[i] === OV.COAL) { c.over[i] = OV.RUBBLE; c.lvl[i] = 0; c.anc[i] = -1; }
      c.powerDirty = true;
      return c;
    },
    // live grid state: recomputePower decides what counts, so plants + wires
    // (and bulldozers) move this number the moment the network changes
    winCheck(c) { return scnPoweredZones(c) >= this.winTarget; },
    progressText(c) {
      return `⚡ Lit zones: ${scnPoweredZones(c)} / ${this.winTarget} · ${scnMonthsLeft(c, this)}mo left`;
    },
    win: {
      headline: "🏆 THE LIGHTS ARE ON! AMPEREVILLE HUMS AGAIN",
      sub: "Scenario complete — the grid roars back; every AC unit spins up at once",
      body: "Two summers after the scrapyard fiasco, city crews threw the big " +
        "switch and three hundred blocks lit up like a Lite-Brite. Fridges " +
        "hummed, dial tones returned, and the ice-cube futures market " +
        "collapsed by lunchtime. \"We missed beige computing,\" admitted one " +
        "resident, rebooting fondly. The city now plays on in sandbox mode.",
    },
    lose: {
      headline: "🕯️ STILL DARK — AMPEREVILLE MISSES ITS RECONNECTION DEADLINE",
      sub: "January 1999 arrives by candlelight; the utility commission is not amused",
      body: "The deadline came and went and the city's grid remains a rumor. " +
        "Residents have grown fond of board games and suspicious of toasters. " +
        "The candle lobby is now the largest donor at city hall. The town is " +
        "still yours, Mayor — keep stringing wire, and one day the streetlights " +
        "will remember their purpose.",
    },
  },
  {
    id: "y2k-ready",
    title: "Y2K Ready",
    description: "July 1999: Modemwood's mainframe still thinks in two digits " +
      "and the millennium is six months out. Build a town strong enough to " +
      "shrug off whatever midnight brings — the consultants bill hourly.",
    goal: "Be ready before Jan 2000: 2,500 population, a power margin of +100, and §4,000 banked.",
    funds: 6000,
    deadline: { year: 2000, month: 0 },
    needPop: 2500, needMargin: 100, needFunds: 4000,
    medals: { gold: 4, silver: 2 }, // months left at the win: ≥4 🥇, ≥2 🥈, else 🥉
    build() {
      const c = scnBuildTown({
        seed: 990704, name: "Modemwood",
        x0: 26, y0: 24, x1: 53, y1: 45, plants: 3,
        kindAt: (x, y) => ["zr", "zc", "zr", "zr", "zi"][(x + y * 2) % 5],
        lvlAt: () => 1,
      });
      c.year = 1999; c.month = 6;  // the scenario opens mid-1999…
      c.markPassedEvents();        // …so '97–'98 headlines never retro-fire
      return c;
    },
    // readiness reads three live systems at once: the census (recomputeDemand),
    // the grid margin (recomputePower), and the treasury (collectBudget)
    winCheck(c) {
      return c.pop >= this.needPop &&
        (c.powerSupply - c.powerDemand) >= this.needMargin &&
        c.funds >= this.needFunds;
    },
    progressText(c) {
      const margin = c.powerSupply - c.powerDemand;
      return `🖥️ Pop ${c.pop}/${this.needPop} · ⚡${margin >= 0 ? "+" : ""}${margin}` +
        `/${this.needMargin} · §${Math.round(c.funds).toLocaleString()}` +
        `/${this.needFunds.toLocaleString()} · ${scnMonthsLeft(c, this)}mo left`;
    },
    win: {
      headline: "🏆 MODEMWOOD IS Y2K READY — BRING ON THE MILLENNIUM",
      sub: "Scenario complete — big town, fat treasury, and watts to spare at midnight",
      body: "Auditors emerged blinking from city hall to confirm it: the census " +
        "is booming, the grid has headroom, and the rainy-day fund could buy " +
        "every bean in the county. When the ball drops, Modemwood will be the " +
        "only town partying instead of panicking. \"01/01/00 looks great on " +
        "us,\" beamed the mayor. The city now plays on in sandbox mode.",
    },
    lose: {
      headline: "🖥️ 19100 PROBLEMS — MODEMWOOD GREETS Y2K UNPREPARED",
      sub: "Midnight strikes with the checklist unfinished; the beans are rationed",
      body: "The odometer rolled and Modemwood wasn't ready: too few residents, " +
        "too little headroom, too thin a treasury. The mainframe now insists " +
        "the year is 19100 and, frankly, nobody can prove it wrong. Still, the " +
        "sun rose on schedule — the town is yours to fortify at leisure, " +
        "Mayor, and the next millennium is a comfortable 1,000 years off.",
    },
  },
];

/* ---- medals & the trophy shelf (M16) ----
   A win earns bronze / silver / gold decided by the per-scenario `medals`
   cutoffs above (months left at the moment the win latches). The best result
   per scenario lives in the PLAYER PROFILE, not the city save: stored under
   its own localStorage key (a sibling of simcity99.prefs), never serialized
   into simcity99.save, so medals survive page reloads AND deleted cities.
   Merging is upgrade-only — a later, worse win never downgrades the shelf. */
const TROPHY_KEY = "simcity99.trophies";
const MEDAL_RANK = { bronze: 1, silver: 2, gold: 3 };
const MEDAL_ICON = { bronze: "🥉", silver: "🥈", gold: "🥇" };

function medalForFinish(sc, monthsLeft) {
  const m = sc.medals || { gold: 12, silver: 6 };
  return monthsLeft >= m.gold ? "gold" : monthsLeft >= m.silver ? "silver" : "bronze";
}

function loadTrophies() {
  let t = {};
  try { t = JSON.parse(localStorage.getItem(TROPHY_KEY)) || {}; } catch (e) {}
  return t;
}

// upgrade-only merge; returns true when the shelf actually changed
function recordTrophy(id, medal, finish, monthsLeft) {
  const t = loadTrophies();
  const prev = t[id];
  if (prev && MEDAL_RANK[prev.medal] >= MEDAL_RANK[medal]) return false;
  t[id] = { medal, finish, monthsLeft };
  try { localStorage.setItem(TROPHY_KEY, JSON.stringify(t)); } catch (e) {}
  return true;
}

/* Win95 trophy-shelf dialog: one row per SCENARIOS entry, best medal + finish
   date, or an empty slot. Reachable from the Windows menu and the splash. */
function openTrophies() {
  const t = loadTrophies();
  document.getElementById("trophy-table").innerHTML = SCENARIOS.map((sc) => {
    const r = t[sc.id];
    return r
      ? `<tr><td>${MEDAL_ICON[r.medal]}</td><td>${sc.title}</td>` +
        `<td>${r.medal.toUpperCase()}</td><td>won ${r.finish}</td></tr>`
      : `<tr class="unwon"><td>▫</td><td>${sc.title}</td>` +
        `<td colspan="2">— no medal yet —</td></tr>`;
  }).join("");
  showDlg("dlg-trophies");
}

/* ---- scenario lifecycle ---- */
function startScenario(id) {
  const sc = SCENARIOS.find(s => s.id === id);
  if (!sc) return false;
  city = sc.build();
  city.scenarioId = sc.id;
  city.scnWon = false; city.scnLost = false; city.scnBest = 9999;
  city.funds = sc.funds;
  city.recomputePower(); city.recomputeAccess(); city.recomputeDemand();
  city.tier = tierForPop(city.pop);
  // pre-ranked towns: suppress promotion front pages so the Bugle stays on story
  city.announcedTier = TIERS.length - 1;
  cam.x = 0; cam.y = MAP * HH; cam.z = 1;
  city.newsQueue.push({
    headline: `📜 ${sc.title.toUpperCase()} — NEW MAYOR TAKES THE JOB NOBODY WANTED`,
    sub: sc.goal,
    body: `${sc.description} City hall's terms are simple, Mayor: ${sc.goal} ` +
      `The treasury opens at §${sc.funds.toLocaleString()}. Good luck — the ` +
      `whole town is watching (and honking).`,
  });
  city.pushMsg(`📜 Scenario started: ${sc.title} — ${sc.goal}`);
  return true;
}

// called from the month-rollover branch of City.tick() only (M9): cheap,
// amortized, and inert once the scenario is decided (sandbox mode)
function scenarioMonthTick(c) {
  const sc = SCENARIOS.find(s => s.id === c.scenarioId);
  if (!sc || c.scnWon || c.scnLost) return;
  if (sc.pressure && sc.pressure.type === "tornado") {
    const elapsed = (c.year - 1997) * 12 + c.month;
    if (elapsed > 0 && elapsed <= sc.pressure.months &&
        elapsed % sc.pressure.everyMonths === 0 && !c.disaster) {
      c.startDisaster("tornado");
      c.pushMsg("🌪️ Twister season delivers, right on schedule. Take cover!");
    }
  }
  if (sc.sample) sc.sample(c);
  if (sc.winCheck(c)) {
    c.scnWon = true; // latch: the celebration fires exactly once, ever
    // medal (M16): tier from the documented per-scenario cutoffs, announced in
    // the win edition + ticker, and shelved (upgrade-only) in the profile
    const left = scnMonthsLeft(c, sc);
    const medal = medalForFinish(sc, left);
    const finish = `${MONTHS[c.month]} ${c.year}`;
    recordTrophy(sc.id, medal, finish, left);
    const ed = Object.assign({}, sc.win);
    ed.sub = `${ed.sub} · ${MEDAL_ICON[medal]} ${medal.toUpperCase()} MEDAL ` +
      `— finished ${finish} with ${left}mo to spare`;
    c.newsQueue.unshift(ed); // outranks other editions
    c.pushMsg(`🏆 SCENARIO COMPLETE — ${sc.title}! ${MEDAL_ICON[medal]} ` +
      `${medal.toUpperCase()} medal earned. The city plays on in sandbox mode.`);
  } else if (scnDeadlinePassed(c, sc)) {
    c.scnLost = true; // latch: the bad news also prints exactly once
    c.newsQueue.unshift(Object.assign({}, sc.lose));
    c.pushMsg(`⏰ ${sc.title} — the deadline passed with the goal unmet. Keep building, Mayor.`);
  }
}

/* ---- live progress surface (status bar cell, refreshed by refreshHUD) ---- */
function scenarioHUD() {
  const el = document.getElementById("sb-scenario");
  if (!el) return;
  const sc = city && city.scenarioId
    ? SCENARIOS.find(s => s.id === city.scenarioId) : null;
  if (!sc) { // free play: hidden and textually empty
    if (el.textContent) el.textContent = "";
    el.classList.add("hidden");
    return;
  }
  el.classList.remove("hidden");
  const flag = city.scnWon ? "🏆 WON · " : city.scnLost ? "📉 FAILED · " : "";
  el.textContent = flag + sc.progressText(city);
}

/* ---- splash-screen scenario cards ---- */
function buildScenarioCards() {
  const inner = document.querySelector("#splash .splash-inner");
  if (!inner || document.getElementById("scenario-row")) return;
  const head = document.createElement("div");
  head.className = "scn-head";
  head.textContent = "— SCENARIOS —";
  const row = document.createElement("div");
  row.id = "scenario-row";
  for (const sc of SCENARIOS) {
    const b = document.createElement("button");
    b.className = "btn95 scn-card";
    b.id = "btn-scenario-" + sc.id;
    b.title = `${sc.title} — ${sc.description}`;
    const t = document.createElement("span");
    t.className = "scn-title"; t.textContent = sc.title;
    const d = document.createElement("span");
    d.className = "scn-desc"; d.textContent = sc.description;
    const g = document.createElement("span");
    g.className = "scn-goal"; g.textContent = "🎯 " + sc.goal;
    b.append(t, d, g);
    b.addEventListener("click", () => {
      Snd.ensure(); Snd.cash();
      if (startScenario(sc.id)) startGame();
    });
    row.appendChild(b);
  }
  const foot = inner.querySelector(".splash-foot");
  inner.insertBefore(head, foot);
  inner.insertBefore(row, foot);
  // trophy-shelf affordance (M16): the profile's medals, viewable pre-game
  const shelf = document.createElement("button");
  shelf.id = "btn-trophies-splash";
  shelf.className = "btn95";
  shelf.textContent = "🏆 TROPHY SHELF";
  shelf.addEventListener("click", () => { Snd.ensure(); Snd.click(); openTrophies(); });
  inner.insertBefore(shelf, foot);
}
