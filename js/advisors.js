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
    if (city.over[i] === OV.ROAD) { s += city.traffic[i]; n++; }
  return n ? s / n : advAvg(city.traffic);
}

function advParkCount() {
  let n = 0;
  for (let i = 0; i < city.over.length; i++) if (city.over[i] === OV.PARK) n++;
  return n;
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
  return out;
}

const ADVISOR_RULES = {
  finance: adviseFinance,
  safety: adviseSafety,
  environment: adviseEnvironment,
};

/* --------- rendering --------- */
function advRefresh() {
  if (!city) return;
  for (const key in ADVISOR_RULES) {
    const ul = document.getElementById("adv-advice-" + key);
    ul.innerHTML = "";
    for (const line of ADVISOR_RULES[key]()) {
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
}
advDrawPortraits();
