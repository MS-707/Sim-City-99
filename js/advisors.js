/* ============ SimCity 99 — advisors panel (M4) ============ */
"use strict";

/* --------- citywide aggregates --------- */
function advAvg(arr) {
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  return s / arr.length;
}

function advRoadTraffic() { // mean congestion on road tiles (whole map if roadless)
  let s = 0, n = 0;
  for (let i = 0; i < city.over.length; i++)
    if (city.over[i] === OV.ROAD || city.over[i] === OV.WIREROAD) { s += city.traffic[i]; n++; } // M26
  return n ? s / n : advAvg(city.traffic);
}

function advParkCount() {
  let n = 0;
  for (let i = 0; i < city.over.length; i++) if (city.over[i] === OV.PARK) n++;
  return n;
}

function advRoadStats() { // road wear / decay aggregates (M23)
  let roads = 0, worn = 0, wearSum = 0, rubble = 0;
  for (let i = 0; i < city.over.length; i++) {
    if (city.over[i] === OV.ROAD || city.over[i] === OV.WIREROAD) { // M26: crossings wear like roads
      roads++; wearSum += city.roadWear[i];
      if (city.roadWear[i] >= 128) worn++;      // past the pothole line
    } else if (city.over[i] === OV.RUBBLE) rubble++;
  }
  return { roads, worn, rubble, meanWear: roads ? wearSum / roads : 0 };
}

/* --------- M23: department champions & severity registers ---------
   Documented department → champion advisor mapping (each champion carries
   that department's funding line in its own panel, and no one else's):
       police → safety      (Chief Gus Ramirez)
       fire   → safety      (Chief Gus Ramirez)
       roads  → transport   (Big Ray Kowalski)
       edu    → finance     (Myrna Plutz — schools live in her ledger)
       health → environment (Dr. Willow Greenfield — community wellbeing)
   Three severity registers keyed to the live funding percentage f:
       f >= 80   content     — calm line, no exclamation marks, no alarm words
       40..79    grumbling   — pointed complaint
       f <  40   flipping out — urgent markup: '!' plus an ALL-CAPS alarm word
   Every register cites the live percentage verbatim ("<f>%"). */
const DEPT_CHAMPION = { police: "safety", fire: "safety", roads: "transport",
                        edu: "finance", health: "environment", transit: "transport" };
const DEPT_LINES = {
  police: {
    ok: (f) => "Police funding sits at " + f + "% — precincts humming, radios " +
      "crackling, donut supply lines secure.",
    grumble: (f) => "Police funding down at " + f + "%? My patrols are stretched " +
      "thin — half the units are sharing one pager, Mayor.",
    mad: (f) => "Police at " + f + "% funding is a full-blown CRISIS! Precincts " +
      "are going dark and the hoodlums know it — restore my budget NOW!",
  },
  fire: {
    ok: (f) => "Fire department funding holds at " + f + "% — trucks polished, " +
      "hydrants tested, response times snappy.",
    grumble: (f) => "Fire funding at " + f + "%? We're patching hoses with duct " +
      "tape and hope. One bad VCR fire and we're in trouble.",
    mad: (f) => "Fire funding at " + f + "% is an EMERGENCY! Half the trucks " +
      "won't start — the whole city is one spark from a blaze, Mayor!",
  },
  roads: {
    ok: (f) => "Roads funding sits at " + f + "% — my crews are out there every " +
      "morning, thermos in hand, keeping the asphalt smooth as a fresh zamboni pass.",
    grumble: (f) => "Roads funding down at " + f + "%? My crews are rationing " +
      "asphalt and the potholes are winning, Mayor. Kowalski does not approve.",
    mad: (f) => "Roads at " + f + "% funding?! This is SABOTAGE of the public " +
      "works! The pavement is crumbling under our tires — fund my crews NOW, Mayor!",
  },
  edu: {
    ok: (f) => "Education funding stands at " + f + "% — the schools balance " +
      "their books, and an educated citizen is a taxpaying citizen, dear.",
    grumble: (f) => "Education funding cut to " + f + "%? The schools are " +
      "photocopying textbooks and the PTA is faxing me hourly, Mayor.",
    mad: (f) => "Education at " + f + "% funding is a SCANDAL! Schools are " +
      "closing classrooms — an uneducated city is a poor city, Mayor. Fix it!",
  },
  health: {
    ok: (f) => "Health funding rests at " + f + "% — the hospitals are calm, " +
      "the healing crystals purely decorative, man.",
    grumble: (f) => "Health funding down at " + f + "%? Hospital wait times are " +
      "longer than a Phish set, man. The community vibe is suffering.",
    mad: (f) => "Health at " + f + "% funding is a public health DISASTER! " +
      "Hospitals are turning folks away — this is seriously bad karma, Mayor!",
  },
  // M25: Big Ray also runs the trains — transit funding rides his transport panel
  transit: {
    ok: (f) => "Transit funding runs at " + f + "% — the trains are on time and " +
      "the ridership catchment pulls cars right off my arterials. Beautiful.",
    grumble: (f) => "Transit down at " + f + "%? Fewer riders means more of 'em back " +
      "in the Geo, clogging my roads. Fund the rails, Mayor.",
    mad: (f) => "Transit at " + f + "% funding is a MELTDOWN! The lines are empty and " +
      "every commuter is back on my pavement — restore the transit budget NOW!",
  },
};

function deptFundingLine(dept) {
  const f = city.funding[dept];
  const t = DEPT_LINES[dept];
  return f >= 80 ? t.ok(f) : f >= 40 ? t.grumble(f) : t.mad(f);
}

/* --------- M22: ordinance advocacy (biased on purpose) ---------
   Each advisor over-sells the ordinances it champions, IGNORING the cross-
   department cost — Finance pushes the Nostalgia Tax even as it kneecaps
   commercial demand; Safety pushes the Curfew ignoring the same commerce hit.
   For each championed, UNLOCKED ordinance: if already enacted, a short self-
   congratulatory line; else, only when the advisor's live metric crosses a
   threshold, one recommend line citing the number and pointing at the panel.
   Recs self-suppress once enacted (no nag loop) and ride the existing 500ms
   advisor cadence — never a per-tick cost. All aggregates are ones already
   computed (advAvg/advRoadTraffic), so no new map scan. */
const ORD_ADVICE = {
  watch: {
    metric: () => advAvg(city.crime), threshold: 45,
    rec: (v) => "Crime index is running " + Math.round(v) + " out there — enact " +
      "Neighborhood Watch in the Ordinances panel and my block captains will " +
      "have the streets quiet by sundown, Mayor.",
    yes: "Neighborhood Watch is paying off — every porch light's a patrol now. " +
      "Best ordinance you ever signed.",
  },
  curfew: {
    metric: () => advAvg(city.crime), threshold: 45,
    rec: (v) => "With crime at " + Math.round(v) + ", a Teen Curfew would clear " +
      "the streets after dark. Sign it in the Ordinances panel — nightlife can wait.",
    yes: "Teen Curfew's got the streets calm as a snowed-in Sunday. Textbook, Mayor.",
  },
  recycle: {
    metric: () => advAvg(city.poll), threshold: 45,
    rec: (v) => "Pollution's hovering around " + Math.round(v) + ", man. Roll out " +
      "Citywide Recycling from the Ordinances panel — blue bins, cleaner air, good karma.",
    yes: "Citywide Recycling is working, man — the air's fresher and the land " +
      "values thank you. Very groovy.",
  },
  carpool: {
    metric: () => advRoadTraffic(), threshold: 70,
    rec: (v) => "Congestion index " + Math.round(v) + " — enact the Carpool " +
      "Incentive in the Ordinances panel and I'll get half those cars off my " +
      "roads with diamond lanes, Mayor.",
    yes: "Carpool Incentive's thinned the traffic nicely — the mains breathe " +
      "again. My crews approve.",
  },
  nostalgiaTax: {
    metric: () => city.funds, threshold: 800, below: true,
    rec: (v) => "Treasury's down to §" + Math.round(v).toLocaleString() + ", dear. " +
      "The Arcade & Nostalgia Tax in the Ordinances panel is free money off every " +
      "arcade and Beanie Baby — sign it.",
    yes: "The Arcade & Nostalgia Tax is padding the ledger nicely — every quarter " +
      "in every claw machine, ours. I printed the receipt twice.",
  },
  smoke: {
    metric: () => advAvg(city.fireCov), threshold: 48, below: true,
    rec: (v) => "Fire coverage is thin (" + Math.round(v) + "/255). The Smoke-" +
      "Detector Mandate in the Ordinances panel catches blazes early — sign it " +
      "before a VCR takes out a block, Mayor.",
    yes: "Smoke-Detector Mandate means fires burn out fast now — trucks barely " +
      "break a sweat. Good call, Mayor.",
  },
};
function adviseOrdinances(champion) {
  const out = [];
  for (const o of ORDINANCES) {
    if (o.champion !== champion || city.tier < o.minTier) continue;
    const a = ORD_ADVICE[o.id];
    if (!a) continue;
    if (city.ordinances[o.id]) { out.push(a.yes); continue; }
    const v = a.metric();
    const crosses = a.below ? v < a.threshold : v >= a.threshold;
    if (crosses) out.push(a.rec(v));
  }
  return out;
}

/* --------- rule engines: each rule picks one line by threshold --------- */
function adviseFinance() {
  const out = [];
  const f = Math.round(city.funds);
  if (f < 500)
    out.push("The treasury is emptier than a Blockbuster on new-release night — §" +
      f.toLocaleString() + " left. We can't even cover the AOL trial hours, Mayor!");
  else if (f >= 100000)
    out.push("§" + f.toLocaleString() + " in the vault! We're rolling in it. " +
      "Maybe invest in one of those 'dot com' things — I hear they only go up.");
  else
    out.push("Treasury holds §" + f.toLocaleString() + ". The books balance... barely. " +
      "I keep them on a floppy disk labeled TAXES.XLS.");
  if (city.taxRate >= 15)
    out.push("A " + city.taxRate + "% tax rate?! Citizens are crankier than a Tamagotchi " +
      "left alone all weekend. Cut it before they revolt.");
  else if (city.taxRate <= 3)
    out.push("Taxes at " + city.taxRate + "% won't even cover city hall's dial-up bill. " +
      "Nudge the rate up a little, dear.");
  else
    out.push("The tax rate of " + city.taxRate + "% looks reasonable. Citizens grumble, " +
      "but grumbling is very 1997.");
  const net = Math.round(city.lastBudget.net);
  if (net < 0)
    out.push("We're bleeding §" + Math.abs(net).toLocaleString() + " a month! Keep this up " +
      "and we'll be paying staff in Beanie Babies.");
  else if (net > 0)
    out.push("Monthly surplus of §" + net.toLocaleString() + ". I printed the ledger on the " +
      "dot-matrix twice, just to admire it.");
  else
    out.push("We break exactly even each month. Suspiciously tidy — like a rigged game " +
      "of Minesweeper.");
  // ---- M13: debt awareness — two rules (debt load, credit rating) ----
  const bonds = city.bonds || [];
  const debtSvc = Math.round(city.lastBudget.debt || 0);
  const owed = bonds.reduce((s, b) => s + b.balance, 0);
  // "drowning" = borrowed to the cap, or servicing debt with a treasury underwater
  const drowning = bonds.length >= BOND_MAX || (bonds.length > 0 && city.funds < 0);
  if (bonds.length === 0)
    out.push("Zero bond debt on the books. We owe Wall Street nothing — exactly how " +
      "I like my spreadsheets: empty and smug.");
  else if (drowning)
    out.push("Mayor, we're DROWNING in debt — §" + owed.toLocaleString() + " owed across " +
      bonds.length + " bond" + (bonds.length === 1 ? "" : "s") + ", §" +
      debtSvc.toLocaleString() + " a month in payments. The repo man drives a Geo Metro.");
  else
    out.push("We're carrying " + bonds.length + " bond" + (bonds.length === 1 ? "" : "s") +
      " — §" + owed.toLocaleString() + " outstanding, §" + debtSvc.toLocaleString() +
      " a month in debt service. Manageable, as long as nobody buys another stadium.");
  const cr = creditRating(city);
  if (cr.level === 0)
    out.push("Our credit rating is a spotless AAA — lenders offer their very best " +
      (cr.rateOffered * 100).toFixed(1) + "% interest. I framed the letter next to the fax.");
  else if (cr.level <= 2)
    out.push("Our credit rating has slipped to " + cr.grade + " — new bonds now cost " +
      (cr.rateOffered * 100).toFixed(1) + "% interest. Tidy the books before it gets worse.");
  else
    out.push("The agencies rate us " + cr.grade + " — junk territory! New borrowing costs " +
      (cr.rateOffered * 100).toFixed(1) + "% interest. Pay something off before they " +
      "repossess the dot-matrix printer.");
  out.push(deptFundingLine("edu")); // M23: Myrna champions the education budget
  out.push(...adviseOrdinances("finance")); // M22: pushes the Nostalgia Tax
  return out;
}

function adviseSafety() {
  const out = [];
  const crime = advAvg(city.crime);
  if (crime >= 100)
    out.push("Crime wave! It's like a GoldenEye deathmatch out there. " +
      "We need more stations, pronto.");
  else if (crime >= 40)
    out.push("Crime is creeping up. Too much MTV, not enough hall monitors, " +
      "if you ask me.");
  else
    out.push("Streets are quiet — quietest since the great pog confiscation of '95.");
  if (advAvg(city.polCov) < 64)
    out.push("Police coverage is thin. Half the city can't even reach the precinct " +
      "by pager. Build more police stations.");
  else
    out.push("Patrols cover the city nicely. The donut budget, however, is another story.");
  if (advAvg(city.fireCov) < 64)
    out.push("Fire coverage is weak. One bad VCR fire and whole blocks go up. " +
      "We need more fire houses.");
  else
    out.push("Fire crews are well placed — response faster than a 56k handshake.");
  /* GP8a: the Chief's first CIVIL DEFENSE lines. One hazardReport() per advisor
     fill — the panel is opened on demand, never per frame, exactly like the
     ordinance lines below. The Chief quotes the ruler rather than a second
     opinion: the same band, the same named driver, the same words the Civil
     Defense panel prints, because they are the same computation. */
  {
    const hz = city.hazardReport();
    const worst = hz.rows[0];
    out.push("Civil Defense puts our worst exposure at " + worst.label.toLowerCase() +
      " — " + worst.bandName.toLowerCase() + " band, driven by " + worst.topDriver.label +
      ". Open Civil Defense and I'll show you the block, Mayor.");
    if (!city.disastersEnabled)
      out.push("Random disasters are switched off, so the published odds are all " +
        "zero. The exposure is still real — turn them back on and the city " +
        "collects on it.");
    else
      out.push("Across all seven kinds we're looking at about " +
        (hz.pYearAgg * 100).toFixed(1) + "% odds of SOMETHING in a given year. " +
        "That number is the same for every city in the region — what's ours to " +
        "change is how much is standing in the way.");
    const fireRow = hz.rows.find((r) => r.id === "fire");
    if (fireRow && fireRow.band >= 2)
      out.push("The fire row alone reads " + fireRow.bandName.toLowerCase() +
        ". " + fireRow.topDriver.blurb.charAt(0).toUpperCase() +
        fireRow.topDriver.blurb.slice(1) + ". Fix that before anything else.");
  }
  // M23: the Chief champions BOTH uniformed budgets — police and fire
  out.push(deptFundingLine("police"));
  out.push(deptFundingLine("fire"));
  out.push(...adviseOrdinances("safety")); // M22: pushes Watch / Curfew / Smoke
  return out;
}

function adviseEnvironment() {
  const out = [];
  const poll = advAvg(city.poll);
  if (poll >= 120)
    out.push("The smog is thicker than an X-Files plot. Move industry out of town " +
      "or bury the city in trees!");
  else if (poll >= 40)
    out.push("Air quality is middling — I can smell the coal plant over my patchouli. " +
      "Consider solar, man.");
  else
    out.push("The air is crisp and clean. Very Lilith Fair. Keep it that way.");
  const parks = advParkCount();
  if (parks === 0)
    out.push("Not a single park?! Even a mall food court has more greenery. " +
      "Plant some green space, man.");
  else if (parks < 25)
    out.push("We have " + parks + " park tile" + (parks === 1 ? "" : "s") + ". A start, " +
      "but the city could use more green between the strip malls.");
  else
    out.push(parks + " park tiles! Groovy — property values love a picnic blanket.");
  const traffic = advRoadTraffic();
  if (traffic >= 120)
    out.push("Total gridlock! Commuters have heard the same Chumbawamba single " +
      "forty times. Lay more roads.");
  else if (traffic >= 40)
    out.push("Traffic is building up. More road capacity now, before road rage " +
      "becomes a lifestyle.");
  else
    out.push("Roads flow free, like a Sunday morning paper route.");
  out.push(deptFundingLine("health")); // M23: Dr. Greenfield champions health
  out.push(...adviseOrdinances("environment")); // M22: pushes Recycling
  return out;
}

/* M23: Transportation / Public Works — Big Ray Kowalski. Every line carries a
   live number: the roads funding %, the mean road congestion index, and the
   road wear / decay state. */
function adviseTransport() {
  const out = [];
  out.push(deptFundingLine("roads"));  // champion line — cites funding.roads %
  const t = Math.round(advRoadTraffic());
  if (t >= 120)
    out.push("Congestion index " + t + " — that's GRIDLOCK, Mayor! My guys can't " +
      "even get the cones out there. Lay more road before the horns unionize!");
  else if (t >= 40)
    out.push("Congestion index " + t + " on the mains. Drivers are drumming the " +
      "wheel to Chumbawamba — add capacity before it becomes a mosh pit.");
  else
    out.push("Congestion index " + t + " — traffic rolls smoother than a fresh " +
      "coat of blacktop. My crews take a little pride in that.");
  const rs = advRoadStats();
  if (rs.roads === 0)
    out.push("Zero road tiles on the map. My crews are playing euchre in the " +
      "depot — pave something and we'll be there by dawn.");
  else if (rs.worn > 0 || rs.rubble > 0)
    out.push(rs.worn + " of " + rs.roads + " road tiles are worn past the " +
      "pothole line (mean wear " + Math.round(rs.meanWear) + "/255)" +
      (rs.rubble ? ", and " + rs.rubble + " tiles of rubble need clearing" : "") +
      ". Fund the crews or lose the pavement, Mayor!");
  else
    out.push("All " + rs.roads + " road tiles in good repair — mean wear " +
      Math.round(rs.meanWear) + "/255. The pavement gods smile upon us.");
  out.push(deptFundingLine("transit")); // M25: Big Ray also champions the transit budget
  const riders = Math.round(city.railRiders);
  if (riders > 0)
    out.push("The Metro is pulling ~" + riders.toLocaleString() + " trips/month off " +
      "the roads. Every one of those is a car NOT idling on my blacktop, Mayor.");
  // GP3b: three-band commute commentary — pure reads of the citywide scalars
  // (avgCommute / strandedShare / commutePct), no RNG, no writes.
  if (city.strandedShare >= 0.01)
    out.push(Math.round(city.strandedShare * 100) + "% of commuters are STRANDED — " +
      "the only route to a job blows the commute budget. Build another crossing " +
      "to the job side, Mayor, or they'll stay home watching Jerry Springer.");
  else if (city.avgCommute > 16)
    out.push("The average commute runs " + city.avgCommute + " hops — folks finish " +
      "a whole Alanis album before they clock in. Bring jobs closer or open a " +
      "metro shortcut.");
  else
    out.push("Commutes average " + city.avgCommute + " hops" +
      (city.commutePct >= 0 ? " and " + city.commutePct + "% of residents live within " +
      "reach of real jobs" : "") + " — smooth sailing on the morning drive.");
  out.push(...adviseOrdinances("transport")); // M22: pushes Carpool Incentive
  return out;
}

const ADVISOR_RULES = {
  finance: adviseFinance,
  safety: adviseSafety,
  environment: adviseEnvironment,
  transport: adviseTransport,
};

/* --------- M23: policy-DELTA bias ---------
   Advisors react to CHANGES, not levels. A snapshot of taxRate (+ funding)
   is kept per city object; every refresh diffs live state against it and, on
   a change, pushes department-biased reaction lines that persist for
   ADV_REACT_TTL refreshes (~5s at the 500ms cadence) or until the next
   change replaces them. A freshly created or LOADED city merely seeds the
   snapshot — no reaction fires until the mayor actually moves the slider.
   Reaction rules (old rate O → new rate N):
     cut (N < O)      Transportation protests, citing the projected §/month
                      revenue loss city.taxTake(O) − city.taxTake(N) — the money
                      that pays the road crews; Finance APPROVES the cut.
     deep cut (N ≤ 3) Safety and Environment protest too (service advisors).
     hike to N ≥ 10   ALL four advisors — Finance included — warn of resident
                      exodus, each citing the demand modifier the sim already
                      applies: taxModFor(N) (recomputeDemand's single tax→demand
                      lever; advisors cite it, never add a second penalty).
     mild hike        Finance alone welcomes the extra revenue.
   GP7a: both figures are now DELEGATED to the sim's single definitions rather
   than re-typed here. The projection therefore INCLUDES the GP5b clean-industry
   premium, which the old hand-written copy silently dropped — MEASURED on a
   clean-industry city: the advisor quoted 13,204 against the charged 14,459, a
   divergence of exactly cleanTax = 1,255 (a dirty city read 12,904 both ways).
   advTaxesAt KEEPS its rate argument: it is called at BOTH the old and the new
   rate to price the delta, so a delegation that ignored the argument would make
   `loss` identically 0 and print "a projected §0 a month gone". */
const ADV_REACT_TTL = 10;
let advSnap = null;                 // { cityRef, taxRate, funding }
let advReact = null, advReactTTL = 0;

function advTaxesAt(rate) {         // projected monthly tax take AT A GIVEN rate
  return city.taxTake(rate);
}

function advCheckDeltas() {
  if (!advSnap || advSnap.cityRef !== city) {
    // new or freshly loaded city: seed the snapshot silently — steady state
    // (however low the rate already is) draws no reaction until a change
    advSnap = { cityRef: city, taxRate: city.taxRate,
                funding: Object.assign({}, city.funding) };
    advReact = null; advReactTTL = 0;
    return;
  }
  const O = advSnap.taxRate, N = city.taxRate;
  if (N !== O) {
    const r = { finance: [], safety: [], environment: [], transport: [] };
    const loss = Math.abs(advTaxesAt(O) - advTaxesAt(N));
    const taxMod = taxModFor(N).toFixed(2);
    if (N < O) {
      r.transport.push("Whoa whoa WHOA — taxes cut from " + O + "% to " + N +
        "%?! That's a projected §" + loss.toLocaleString() + " a month gone " +
        "from the budget that pays my road crews. Potholes don't fill " +
        "themselves, Mayor!");
      r.finance.push("Trimming the rate from " + O + "% to " + N + "% — I " +
        "approve, dear. A lighter tax bill juices demand, and the ledger can " +
        "absorb a lean month or two.");
      if (N <= 3) {
        r.safety.push("A cut all the way to " + N + "%?! You can't run " +
          "precincts and fire houses on §" + loss.toLocaleString() +
          " less a month. The hoodlums read the paper too, Mayor!");
        r.environment.push("Slashing taxes to " + N + "%? That projected §" +
          loss.toLocaleString() + " monthly shortfall comes straight out of " +
          "parks and clean air, man. Deeply un-groovy!");
      }
    } else if (N >= 10) {
      r.finance.push("A hike to " + N + "%?! The demand model reads (7 − " + N +
        ") × 0.05 = " + taxMod + " residential demand — that's a moving-van " +
        "exodus, and even I love revenue less than I fear empty houses.");
      r.safety.push("Taxes at " + N + "% now? The demand gauge shows " + taxMod +
        " — folks are leaving town, and empty blocks are a looter's paradise!");
      r.environment.push("A " + N + "% tax rate drags residential demand by " +
        taxMod + ", man. People will migrate like it's a Dead tour — nobody " +
        "wants to live here at these prices!");
      r.transport.push("Rate jacked to " + N + "%? Demand modifier " + taxMod +
        " says residents bail — and my roads get to carry all those one-way " +
        "U-Hauls out of town!");
    } else {
      r.finance.push("Nudging the rate from " + O + "% to " + N + "% — a " +
        "projected §" + loss.toLocaleString() + " more a month for the " +
        "treasury. The dot-matrix purrs, dear.");
    }
    advReact = r; advReactTTL = ADV_REACT_TTL;
    advSnap.taxRate = N;
  }
  // keep the funding snapshot current (register lines above carry that bias)
  Object.assign(advSnap.funding, city.funding);
}

/* --------- rendering --------- */
function advRefresh() {
  if (!city) return;
  advCheckDeltas();
  const reacting = advReact;
  if (advReact && --advReactTTL <= 0) advReact = null; // reactions fade out
  for (const key in ADVISOR_RULES) {
    const ul = document.getElementById("adv-advice-" + key);
    ul.innerHTML = "";
    const lines = (reacting ? reacting[key] : []).concat(ADVISOR_RULES[key]());
    for (const line of lines) {
      const li = document.createElement("li");
      li.textContent = "💬 " + line;
      ul.appendChild(li);
    }
  }
}

function openAdvisors() {
  advRefresh();
  showDlg("dlg-advisors");
}

// live refresh (~2×/s) while the dialog is open — runs even when the sim is paused
let advLastRefresh = 0;
function advisorsFrame() {
  if (document.getElementById("dlg-advisors").classList.contains("hidden")) return;
  const now = performance.now();
  if (now - advLastRefresh < 500) return;
  advLastRefresh = now;
  advRefresh();
}

/* --------- tab strip --------- */
document.querySelectorAll("#adv-tabs .tab95").forEach(t => {
  t.addEventListener("click", () => {
    Snd.click();
    document.querySelectorAll("#adv-tabs .tab95").forEach(x =>
      x.classList.toggle("active", x === t));
    document.querySelectorAll(".adv-panel").forEach(p =>
      p.classList.toggle("hidden", p.dataset.adv !== t.dataset.adv));
    advRefresh();
  });
});

/* --------- procedural 90s portraits --------- */
function advDrawPortraits() {
  const px = (g, x, y, w, h, c) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
  // Myrna Plutz — beehive hair, cat-eye glasses, pearls
  let g = document.getElementById("adv-face-finance").getContext("2d");
  px(g, 0, 0, 48, 48, "#3f7f7f");                 // teal office backdrop
  px(g, 12, 4, 24, 12, "#b0b0c8");                // silver beehive
  px(g, 10, 8, 4, 10, "#b0b0c8"); px(g, 34, 8, 4, 10, "#b0b0c8");
  px(g, 14, 14, 20, 18, "#e8b890");               // face
  px(g, 15, 19, 8, 5, "#204080"); px(g, 25, 19, 8, 5, "#204080"); // cat-eye frames
  px(g, 17, 21, 4, 2, "#fff"); px(g, 27, 21, 4, 2, "#fff");       // lenses
  px(g, 23, 24, 2, 1, "#204080");                 // bridge
  px(g, 20, 29, 8, 2, "#a03030");                 // lipstick
  px(g, 12, 32, 24, 16, "#603080");               // purple blazer
  px(g, 18, 33, 3, 3, "#f0f0f0"); px(g, 24, 34, 3, 3, "#f0f0f0"); px(g, 29, 33, 3, 3, "#f0f0f0"); // pearls
  // Chief Gus Ramirez — police cap, mustache
  g = document.getElementById("adv-face-safety").getContext("2d");
  px(g, 0, 0, 48, 48, "#405060");                 // precinct grey-blue
  px(g, 12, 4, 24, 8, "#101840");                 // cap crown
  px(g, 10, 11, 28, 3, "#101840");                // cap brim
  px(g, 22, 6, 4, 4, "#e8c040");                  // badge
  px(g, 14, 14, 20, 18, "#c68a5a");               // face
  px(g, 17, 19, 4, 3, "#201810"); px(g, 27, 19, 4, 3, "#201810"); // eyes
  px(g, 16, 26, 16, 4, "#302018");                // mustache
  px(g, 12, 32, 24, 16, "#182858");               // uniform
  px(g, 15, 34, 4, 4, "#e8c040");                 // shield
  // Dr. Willow Greenfield — long hair, flower, round shades
  g = document.getElementById("adv-face-environment").getContext("2d");
  px(g, 0, 0, 48, 48, "#4a7a3a");                 // leafy backdrop
  px(g, 10, 6, 28, 30, "#7a4a20");                // long hair
  px(g, 15, 12, 18, 18, "#e0a878");               // face
  px(g, 17, 17, 5, 4, "#803090"); px(g, 26, 17, 5, 4, "#803090"); // round shades
  px(g, 22, 18, 4, 1, "#803090");                 // bridge
  px(g, 20, 26, 8, 2, "#904040");                 // smile
  px(g, 33, 8, 5, 5, "#e8e050"); px(g, 35, 10, 1, 1, "#c04080");  // daisy
  px(g, 12, 36, 24, 12, "#c8a060");               // hemp poncho
  px(g, 22, 38, 4, 8, "#308030");                 // peace-sign cord
  // Big Ray Kowalski — hard hat, five-o'clock shadow, hi-vis vest (M23)
  g = document.getElementById("adv-face-transport").getContext("2d");
  px(g, 0, 0, 48, 48, "#5a5148");                 // asphalt-lot backdrop
  px(g, 0, 40, 48, 8, "#3a3530");                 // fresh blacktop strip
  px(g, 2, 42, 8, 2, "#e8d040"); px(g, 20, 42, 8, 2, "#e8d040"); px(g, 38, 42, 8, 2, "#e8d040"); // lane paint
  px(g, 13, 3, 22, 9, "#f0b800");                 // hard hat crown
  px(g, 10, 11, 28, 3, "#f0b800");                // hard hat brim
  px(g, 21, 5, 6, 6, "#d09000");                  // hat ridge
  px(g, 14, 14, 20, 17, "#d89868");               // face
  px(g, 16, 18, 5, 3, "#181410"); px(g, 27, 18, 5, 3, "#181410"); // heavy brows/eyes
  px(g, 22, 22, 4, 3, "#c07850");                 // nose
  px(g, 16, 27, 16, 4, "#4a3a2c");                // five-o'clock shadow
  px(g, 19, 28, 10, 2, "#803838");                // grin under the stubble
  px(g, 12, 32, 24, 16, "#f07818");               // hi-vis orange vest
  px(g, 14, 33, 4, 15, "#e8e838"); px(g, 30, 33, 4, 15, "#e8e838"); // reflective stripes
  px(g, 21, 33, 6, 15, "#405060");                // work shirt under the vest
}
advDrawPortraits();
