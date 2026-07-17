/* ============ SimCity 99 — UI: toolbar, menus, input, ticker ============ */
"use strict";

const UI = {
  tool: "road",
  hover: null,           // {x, y} tile under mouse
  mapMode: "all",
  speed: 1,              // 0 pause, 1 normal, 2 fast, 0.5 slow
  painting: false,
  panning: false,
  lastMouse: null,
};

const TOOLS = [
  { id: "query",    name: "Inspect",   key: "0", icon: "🔍" },
  { id: "bulldoze", name: "Bulldoze",  key: "1", icon: "🚜" },
  { id: "road",     name: "Road",      key: "2", icon: null, spr: () => SPR.road[5] },
  { id: "wire",     name: "Power Ln",  key: "3", icon: null, spr: () => SPR.wire[5] },
  { id: "zr",       name: "Residntl",  key: "4", icon: null, spr: () => SPR.r1[0] },
  { id: "zc",       name: "Commercl",  key: "5", icon: null, spr: () => SPR.c3[0] },
  { id: "zi",       name: "Industrl",  key: "6", icon: null, spr: () => SPR.i2[0] },
  { id: "park",     name: "Park",      key: "7", icon: null, spr: () => SPR.park },
  { id: "tree",     name: "Trees",     key: "8", icon: null, spr: () => SPR.forest[0] },
  { id: "police",   name: "Police",    key: "9", icon: null, spr: () => SPR.police },
  { id: "firesta",  name: "Fire Dept", key: "-", icon: null, spr: () => SPR.firesta },
  { id: "school",   name: "School",    key: "s", icon: null, spr: () => SPR.school },
  { id: "hospital", name: "Hospital",  key: "h", icon: null, spr: () => SPR.hospital },
  { id: "coal",     name: "Coal Pwr",  key: "=", icon: null, spr: () => SPR.coal },
  { id: "solar",    name: "Solar Pwr", key: "+", icon: null, spr: () => SPR.solar },
  // milestone rewards — locked until the city earns its rank
  { id: "mayor",    name: "Mayor Hse", key: "m", icon: null, spr: () => SPR.mayor,
    minTier: TOOL_TIER.mayor },
  { id: "stadium",  name: "Stadium",   key: "b", icon: null, spr: () => SPR.stadium,
    minTier: TOOL_TIER.stadium },
];

/* --------- 1997 newswire --------- */
const NEWS_1997 = {
  0:  ["📼 Blockbuster reports record VHS rentals. Be kind, rewind.",
       "💾 Rumor: a computer will beat the world chess champion this year. Experts skeptical.",
       "📟 Pager sales through the roof. What could possibly replace them?"],
  1:  ["🐑 Scientists announce Dolly, the first cloned sheep. Llamas reportedly nervous.",
       "🎮 Local arcade installs second Time Crisis machine to fight queues."],
  2:  ["☄️ Comet Hale-Bopp dazzles in the night sky. Best viewing from unlit suburbs.",
       "📀 New 'DVD' format launches. Analysts: rewinding may become obsolete."],
  3:  ["📈 Something called a 'dot com' is up 40% this quarter. What's a dot com?",
       "🖥️ City hall upgrades to Windows 95. Productivity plummets during Solitaire hours."],
  4:  ["♟️ Deep Blue defeats Kasparov! Machines: 1, Humanity: 0.",
       "📱 Cellular phones now fit in a (large) pocket, cost only a fortune."],
  5:  ["🥚 Tamagotchi craze sweeps schools. Teachers confiscate 4,000 virtual pets.",
       "🎬 Some movie about a big boat is filming. Studio fears it will flop."],
  6:  ["🚀 Mars Pathfinder lands! Sojourner rover sends back first photos.",
       "👽 Roswell marks 50 years since the 'weather balloon' incident.",
       "🇬🇧 Britain hands Hong Kong back to China after 156 years."],
  7:  ["🌐 The 'World Wide Web' now has over one million sites. Fad, say experts.",
       "💿 AOL mails its 500 millionth free trial CD. Landfills rejoice."],
  8:  ["📚 A book about a boy wizard is quietly published in Britain.",
       "🚗 New York bans something called 'road rage'. Enforcement unclear."],
  9:  ["🎮 A plumber in 3D?! Local kids line up around the block for N64s.",
       "💻 Steve Jobs returns to Apple. Analysts: company doomed anyway."],
  10: ["📉 Asian markets wobble; mayor advised not to invest city funds in baht.",
       "🕹️ GoldenEye 007 declared 'reason friendships end' by local youth."],
  11: ["🚢 Titanic opens in theaters. Bring tissues, and maybe a bigger door.",
       "🎄 Beanie Babies shortage declared civic emergency by local collectors."],
};

const NEWS_GENERIC = [
  "📞 Dial-up subscriptions up 300%. Please stay off the phone, Mom.",
  "🖨️ City prints budget on dot-matrix. Perforated edges everywhere.",
  "📺 Must-see TV night causes citywide productivity dip.",
  "🧢 Frosted tips officially the mayor's worst decision this term.",
  "💾 Y2K? The city's computers say we have plenty of time. Plenty.",
  "🛼 Rollerblade lanes proposed downtown. Skateboarders object.",
  "📼 Video store late fees now 3% of municipal revenue.",
];

/* ================= init ================= */
function uiInit() {
  buildToolbar();
  bindMenus();
  bindCanvas();
  bindKeys();
  bindDialogs();
  bindMinimap();
  setTool("road");
}

function toolLocked(t) {
  return (t.minTier || 0) > (city ? city.tier : 0);
}

function buildToolbar() {
  const tb = document.getElementById("toolbar");
  tb.innerHTML = "";
  for (const t of TOOLS) {
    const locked = toolLocked(t);
    const b = document.createElement("div");
    b.className = "toolbtn" + (locked ? " locked" : "");
    b.dataset.tool = t.id;
    const ic = document.createElement("canvas");
    ic.width = 40; ic.height = 34;
    const g = ic.getContext("2d");
    if (t.spr) {
      const s = t.spr();
      const sc = Math.min(38 / s.c.width, 32 / s.c.height);
      g.imageSmoothingEnabled = false;
      g.drawImage(s.c, 20 - s.c.width * sc / 2, 17 - s.c.height * sc / 2,
                  s.c.width * sc, s.c.height * sc);
    } else {
      g.font = "22px serif"; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(t.icon, 20, 18);
    }
    if (locked) { // grey veil + padlock
      g.fillStyle = "rgba(192,192,192,.62)"; g.fillRect(0, 0, 40, 34);
      g.font = "16px serif"; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText("🔒", 20, 17);
    }
    b.appendChild(ic);
    const lbl = document.createElement("span");
    lbl.textContent = t.name;
    b.appendChild(lbl);
    const cost = COST[t.id];
    if (locked) {
      const c = document.createElement("span");
      c.className = "cost"; c.textContent = "🔒 " + TIERS[t.minTier].name;
      b.appendChild(c);
    } else if (cost) {
      const c = document.createElement("span");
      c.className = "cost"; c.textContent = "§" + cost;
      b.appendChild(c);
    } else if (t.minTier) {
      const c = document.createElement("span");
      c.className = "cost"; c.textContent = "FREE";
      b.appendChild(c);
    }
    b.title = locked
      ? `${t.name} — unlocked at ${TIERS[t.minTier].name} rank`
      : `${t.name} (${t.key})${cost ? " — §" + cost : ""}`;
    b.addEventListener("click", () => { Snd.click(); setTool(t.id); });
    b.classList.toggle("active", !locked && t.id === UI.tool);
    tb.appendChild(b);
  }
}

function setTool(id) {
  const t = TOOLS.find(t => t.id === id);
  if (t && toolLocked(t)) { // locked reward: refuse (clicks AND hotkeys)
    Snd.denied();
    setStatus(`🔒 ${t.name} unlocks at ${TIERS[t.minTier].name} rank.`);
    return;
  }
  UI.tool = id;
  document.querySelectorAll(".toolbtn").forEach(b =>
    b.classList.toggle("active", b.dataset.tool === id));
  const cost = COST[id];
  setStatus(`${t.name} selected${cost ? ` — §${cost} each` : ""}`);
}

function setStatus(msg) { document.getElementById("sb-tool").textContent = msg; }

/* ================= menus ================= */
const MENUS = {
  file: () => [
    ["New City", () => { if (confirm("Start a new city? Unsaved progress is lost.")) newCity(); }],
    ["Save City", saveCity],
    ["Load City", loadCity],
    "-",
    ["About SimCity 99", () => showDlg("dlg-about")],
  ],
  speed: () => [
    [`${UI.speed === 0 ? "● " : ""}Pause (space)`, () => setSpeed(0)],
    [`${UI.speed === 0.5 ? "● " : ""}Turtle`, () => setSpeed(0.5)],
    [`${UI.speed === 1 ? "● " : ""}Llama`, () => setSpeed(1)],
    [`${UI.speed === 2 ? "● " : ""}Cheetah`, () => setSpeed(2)],
  ],
  disasters: () => [
    ["Start Fire 🔥", () => { city.startDisaster("fire"); Snd.siren(); }],
    ["Tornado 🌪️", () => { city.startDisaster("tornado"); Snd.boom(); }],
    ["UFO Visit 👽", () => { city.startDisaster("ufo"); Snd.ufo(); }],
    "-",
    [`${city.disastersEnabled ? "✓ " : ""}Random Disasters`,
      () => { city.disastersEnabled = !city.disastersEnabled; }],
  ],
  windows: () => [
    ["Budget…", openBudget],
    ["Graphs…", openGraphs],
    ["Advisors…", openAdvisors],
  ],
  sound: () => [
    [`${Snd.sfxOn ? "✓ " : ""}Sound Effects`, () => Snd.toggleSfx()],
    [`${Snd.musicOn ? "✓ " : ""}Music`, () => Snd.toggleMusic()],
  ],
  help: () => [
    ["About…", () => showDlg("dlg-about")],
  ],
};

function bindMenus() {
  const drop = document.getElementById("menudrop");
  let openMenu = null;
  document.querySelectorAll(".menu").forEach(m => {
    m.addEventListener("click", (e) => {
      e.stopPropagation();
      if (openMenu === m.dataset.menu) { closeDrop(); return; }
      openMenu = m.dataset.menu;
      document.querySelectorAll(".menu").forEach(x => x.classList.toggle("open", x === m));
      drop.innerHTML = "";
      for (const item of MENUS[openMenu]()) {
        if (item === "-") {
          const s = document.createElement("div"); s.className = "msep";
          drop.appendChild(s); continue;
        }
        const d = document.createElement("div");
        d.className = "mitem"; d.textContent = item[0];
        d.addEventListener("click", () => { Snd.click(); item[1](); closeDrop(); });
        drop.appendChild(d);
      }
      const r = m.getBoundingClientRect();
      const host = document.getElementById("win-main").getBoundingClientRect();
      drop.style.left = (r.left - host.left) + "px";
      drop.style.top = (r.bottom - host.top) + "px";
      drop.classList.remove("hidden");
    });
  });
  const closeDrop = () => {
    openMenu = null;
    drop.classList.add("hidden");
    document.querySelectorAll(".menu").forEach(x => x.classList.remove("open"));
  };
  document.addEventListener("click", closeDrop);
}

function setSpeed(s) {
  UI.speed = s;
  const label = s === 0 ? "⏸ Paused" : s === 0.5 ? "▶ Turtle" : s === 1 ? "▶ Llama" : "▶▶ Cheetah";
  document.getElementById("sb-speed").textContent = label;
}

/* ================= canvas input ================= */
function bindCanvas() {
  const c = document.getElementById("game");

  c.addEventListener("contextmenu", e => e.preventDefault());

  c.addEventListener("mousedown", (e) => {
    Snd.ensure();
    if (e.button === 2 || e.button === 1) {
      UI.panning = true; UI.lastMouse = { x: e.clientX, y: e.clientY };
      return;
    }
    if (e.button === 0) {
      UI.painting = true;
      applyToolAt(e);
    }
  });

  window.addEventListener("mousemove", (e) => {
    const r = c.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX < r.right &&
                   e.clientY >= r.top && e.clientY < r.bottom;
    if (UI.panning && UI.lastMouse) {
      cam.x -= (e.clientX - UI.lastMouse.x) / cam.z;
      cam.y -= (e.clientY - UI.lastMouse.y) / cam.z;
      clampCam();
      UI.lastMouse = { x: e.clientX, y: e.clientY };
      return;
    }
    if (!inside) { UI.hover = null; return; }
    UI.hover = screenToTile(e.clientX - r.left, e.clientY - r.top);
    if (UI.painting) applyToolAt(e);
  });

  window.addEventListener("mouseup", () => {
    UI.painting = false; UI.panning = false; UI.lastMouse = null;
  });

  c.addEventListener("wheel", (e) => {
    e.preventDefault();
    const f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    cam.z = Math.max(0.4, Math.min(2.5, cam.z * f));
    clampCam();
  }, { passive: false });
}

function clampCam() {
  const pad = 200;
  cam.x = Math.max(-MAP * HW - pad, Math.min(MAP * HW + pad, cam.x));
  cam.y = Math.max(-pad, Math.min(MAP * TH + pad, cam.y));
}

let lastPaint = -1;
function applyToolAt(e) {
  const c = document.getElementById("game");
  const r = c.getBoundingClientRect();
  const { x, y } = screenToTile(e.clientX - r.left, e.clientY - r.top);
  if (!city.inMap(x, y)) return;
  const i = y * MAP + x;
  if (i === lastPaint && UI.tool !== "query") return;
  lastPaint = i;

  if (UI.tool === "query") { openQuery(x, y); return; }

  const res = city.place(UI.tool, x, y);
  if (res.ok) {
    switch (UI.tool) {
      case "bulldoze": Snd.bulldoze(); break;
      case "road": Snd.place(); break;
      case "wire": Snd.wire(); break;
      case "zr": case "zc": case "zi": Snd.zone(); break;
      default: Snd.place(); Snd.cash();
    }
  } else if (res.reason === "funds") {
    Snd.denied(); setStatus("⛔ Not enough funds!");
  } else if (res.reason === "locked") {
    Snd.denied(); setStatus("🔒 That reward isn't unlocked yet.");
  }
}

function bindKeys() {
  window.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT") return;
    if (e.code === "Space") { e.preventDefault(); setSpeed(UI.speed === 0 ? 1 : 0); return; }
    const t = TOOLS.find(t => t.key === e.key);
    if (t) { setTool(t.id); return; }
    const pan = 40 / cam.z;
    if (e.key === "ArrowLeft") cam.x -= pan;
    if (e.key === "ArrowRight") cam.x += pan;
    if (e.key === "ArrowUp") cam.y -= pan;
    if (e.key === "ArrowDown") cam.y += pan;
    clampCam();
  });
}

function bindMinimap() {
  document.querySelectorAll(".mm").forEach(b => {
    b.addEventListener("click", () => {
      UI.mapMode = b.dataset.mode;
      document.querySelectorAll(".mm").forEach(x => x.classList.toggle("active", x === b));
    });
  });
  const mm = document.getElementById("minimap");
  mm.addEventListener("click", (e) => {
    const r = mm.getBoundingClientRect();
    const tx = (e.clientX - r.left) / r.width * MAP;
    const ty = (e.clientY - r.top) / r.height * MAP;
    cam.x = worldX(tx, ty); cam.y = worldY(tx, ty);
    clampCam();
  });
}

/* ================= dialogs ================= */
function showDlg(id) { document.getElementById(id).classList.remove("hidden"); }
function hideDlg(id) { document.getElementById(id).classList.add("hidden"); }

function bindDialogs() {
  document.querySelectorAll(".dlg").forEach(d => {
    d.querySelectorAll(".dlg-close").forEach(b =>
      b.addEventListener("click", () => d.classList.add("hidden")));
    // draggable titlebar
    const tb = d.querySelector(".titlebar");
    let drag = null;
    tb.addEventListener("mousedown", (e) => {
      const r = d.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      e.preventDefault();
    });
    window.addEventListener("mousemove", (e) => {
      if (!drag) return;
      d.style.left = (e.clientX - drag.dx + d.offsetWidth / 2) + "px";
      d.style.top = (e.clientY - drag.dy + d.offsetHeight / 2) + "px";
    });
    window.addEventListener("mouseup", () => drag = null);
  });

  const slider = document.getElementById("tax-slider");
  slider.addEventListener("input", () => {
    city.taxRate = +slider.value;
    document.getElementById("tax-label").textContent = slider.value + "%";
    fillBudgetTable();
  });
}

function openBudget() {
  document.getElementById("tax-slider").value = city.taxRate;
  document.getElementById("tax-label").textContent = city.taxRate + "%";
  fillBudgetTable();
  showDlg("dlg-budget");
}

function fillBudgetTable() {
  const b = city.lastBudget;
  const f = (n) => (n < 0 ? "-§" : "§") + Math.abs(n).toLocaleString();
  document.getElementById("budget-table").innerHTML = `
    <tr><td>Tax revenue</td><td>${f(b.taxes)}</td></tr>
    <tr><td>Roads &amp; wires</td><td>${f(-b.roads)}</td></tr>
    <tr><td>Police &amp; fire</td><td>${f(-b.services)}</td></tr>
    <tr><td>Power plants</td><td>${f(-b.power)}</td></tr>
    <tr class="total"><td>Net (monthly)</td><td>${f(b.net)}</td></tr>
    <tr><td>Treasury</td><td>${f(Math.round(city.funds))}</td></tr>`;
}

function openGraphs() {
  const cv = document.getElementById("graph-canvas");
  const g = cv.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, cv.height);
  const plot = (data, color, maxOverride) => {
    if (data.length < 2) return;
    const max = maxOverride ?? Math.max(...data.map(Math.abs), 1);
    g.strokeStyle = color; g.lineWidth = 1.5;
    g.beginPath();
    data.forEach((v, k) => {
      const x = k / (data.length - 1) * (cv.width - 10) + 5;
      const y = cv.height - 10 - (v / max) * (cv.height - 25);
      k ? g.lineTo(x, y) : g.moveTo(x, y);
    });
    g.stroke();
  };
  g.strokeStyle = "#ddd";
  for (let k = 1; k < 4; k++) {
    g.beginPath(); g.moveTo(0, cv.height / 4 * k); g.lineTo(cv.width, cv.height / 4 * k); g.stroke();
  }
  plot(city.history.pop, "#0a0");
  plot(city.history.funds, "#00a");
  showDlg("dlg-graphs");
}

function openQuery(x, y) {
  const i = y * MAP + x;
  const terrName = ["Grass", "Water", "Forest"][city.terr[i]];
  const ovName = ["—", "Road", "Power line", "Residential", "Commercial", "Industrial",
    "Park", "Police station", "Fire station", "Coal plant", "Solar plant", "Rubble",
    "Mayor's House", "Stadium", "School", "Hospital"][city.over[i]];
  document.getElementById("query-table").innerHTML = `
    <tr><td>Tile</td><td>${x}, ${y}</td></tr>
    <tr><td>Terrain</td><td>${terrName}</td></tr>
    <tr><td>Zone/Building</td><td>${ovName}${city.lvl[i] ? " (level " + city.lvl[i] + ")" : ""}</td></tr>
    <tr><td>Powered</td><td>${city.powered[i] ? "⚡ yes" : "no"}</td></tr>
    <tr><td>Road access</td><td>${city.access[i] ? "yes" : "no"}</td></tr>
    <tr><td>Land value</td><td>${city.landv[i]}</td></tr>
    <tr><td>Traffic</td><td>${city.over[i] === OV.ROAD ? city.traffic[i] : "—"}</td></tr>
    <tr><td>Pollution</td><td>${city.poll[i]}</td></tr>
    <tr><td>Crime</td><td>${city.crime[i]}</td></tr>
    <tr><td>Education</td><td>${city.eduCov[i]}</td></tr>
    <tr><td>Health</td><td>${city.medCov[i]}</td></tr>`;
  showDlg("dlg-query");
}

/* ================= milestone newspaper ================= */
const NP_SUBHEADS = [
  null, null,
  "Mayor's mansion approved; hedge budget triples overnight",
  "Council greenlights stadium; scalpers already outside",
  "Skyline visible from THREE counties, claims tourism board",
];

function showNewspaper(k) {
  const t = TIERS[k];
  document.getElementById("np-date").textContent =
    `${MONTHS[city.month]} ${city.year} — Pop. ${city.pop.toLocaleString()}`;
  document.getElementById("np-headline").textContent =
    `${city.cityName.toUpperCase()} IS NOW A ${t.name.toUpperCase()}!`;
  const unlocks = TOOLS.filter(x => x.minTier === k).map(x => x.name);
  document.getElementById("np-sub").textContent = unlocks.length
    ? `City hall unlocks: ${unlocks.join(", ")} — check your toolbar, Mayor!`
    : (NP_SUBHEADS[k] || "Experts stunned; property values 'through the roof'");
  document.getElementById("np-body").textContent =
    `Sources at city hall confirm that as of ${MONTHS[city.month]} ${city.year}, ` +
    `${city.cityName} officially ranks as a ${t.name} (${TIERS[k].pop.toLocaleString()}+ residents). ` +
    `Locals celebrated by waiting for a dial tone. "We always believed," said one ` +
    `resident, clutching a Tamagotchi. The mayor's office promises this changes nothing, ` +
    `except everything.`;
  showDlg("dlg-news");
  Snd.fanfare();
}

// called every frame from the main loop: pop pending editions one at a time
function newsFrame() {
  if (!city || !city.newsQueue || !city.newsQueue.length) return;
  const dlg = document.getElementById("dlg-news");
  if (!dlg.classList.contains("hidden")) return; // wait for current one to be read
  showNewspaper(city.newsQueue.shift());
}

/* ================= ticker ================= */
const ticker = { queue: [], x: 0, current: "Welcome to 1997, Mayor. The city awaits." };

function tickerFeed() {
  // city messages take priority
  if (city.messages.length) return city.messages.shift();
  const monthNews = NEWS_1997[city.month] || [];
  const pool = city.year === 1997 && monthNews.length && Math.random() < 0.6
    ? monthNews : NEWS_GENERIC;
  return pool[(Math.random() * pool.length) | 0];
}

function tickerFrame() {
  const el = document.getElementById("ticker-text");
  const host = document.getElementById("ticker");
  ticker.x -= 1.2;
  if (ticker.x < -el.offsetWidth - 40) {
    ticker.current = tickerFeed();
    ticker.x = host.offsetWidth + 10;
  }
  el.textContent = ticker.current;
  el.style.transform = `translateX(${ticker.x}px)`;
}

/* ================= HUD refresh ================= */
let uiTierShown = -1; // toolbar's last-built tier; rebuild on promotion / load

function refreshHUD() {
  if (city.tier !== uiTierShown) { uiTierShown = city.tier; buildToolbar(); }
  document.getElementById("sb-funds").textContent =
    "§ " + Math.round(city.funds).toLocaleString();
  document.getElementById("sb-date").textContent = `${MONTHS[city.month]} ${city.year}`;
  document.getElementById("sb-pop").textContent = "Pop: " + city.pop.toLocaleString();
  document.getElementById("v-pop").textContent = city.pop.toLocaleString();
  document.getElementById("v-jobs").textContent = city.jobs.toLocaleString();
  document.getElementById("v-power").textContent =
    `${city.powerDemand}/${city.powerSupply}`;
  const approval = Math.max(5, Math.min(98,
    70 - city.taxRate * 2.4 + (city.demand.r > 0 ? 10 : -8) | 0));
  document.getElementById("v-approval").textContent = city.pop ? approval + "%" : "—";
  document.getElementById("city-title").textContent =
    `SimCity 99 — ${city.cityName} [${TIERS[city.tier].name}], ${MONTHS[city.month]} ${city.year}`;

  const setBar = (id, v) => {
    const el = document.getElementById(id);
    const half = 29; // px from midline
    const h = Math.abs(v) * half;
    el.style.height = h + "px";
    if (v >= 0) { el.style.bottom = "50%"; el.style.top = "auto"; }
    else { el.style.top = "50%"; el.style.bottom = "auto"; }
  };
  setBar("rci-r", city.demand.r);
  setBar("rci-c", city.demand.c);
  setBar("rci-i", city.demand.i);
}

/* ================= save / load / new ================= */
const SAVE_KEY = "simcity99.save";

function saveCity() {
  try {
    localStorage.setItem(SAVE_KEY, city.serialize());
    setStatus("💾 City saved to browser storage.");
    city.pushMsg("💾 City saved. (No floppy disk required.)");
    Snd.cash();
  } catch (e) { setStatus("Save failed: " + e.message); }
}

function loadCity() {
  const json = localStorage.getItem(SAVE_KEY);
  if (!json) { setStatus("No saved city found."); Snd.denied(); return false; }
  try {
    city = City.deserialize(json);
    setStatus("City loaded. Welcome back, Mayor.");
    return true;
  } catch (e) { setStatus("Load failed: " + e.message); return false; }
}

function newCity() {
  city = new City();
  const names = ["Llamaville", "Port Modem", "Beanieburg", "Dialup Falls",
    "Pixel Heights", "Cassette Creek", "Winsock City", "Grungetown"];
  city.cityName = names[(Math.random() * names.length) | 0];
  cam.x = 0; cam.y = MAP * HH; cam.z = 1;
  city.pushMsg(`🏗️ ${city.cityName} founded, January 1997. Taxes low, hopes high.`);
}
