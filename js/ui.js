/* ============ SimCity 99 — UI: toolbar, menus, input, ticker ============ */
"use strict";

const UI = {
  tool: "road",
  hover: null,           // {x, y} tile under mouse
  mapMode: "all",
  curDistrict: 0,        // M21: active district brush (0 = eraser / unassigned)
  speed: 1,              // 0 pause, 1 normal, 2 fast, 0.5 slow
  painting: false,
  panning: false,
  lastMouse: null,
  // M30: City Graphs series toggles + active time range. Keyed by history key
  // (pop/net/tax/poll/crime/landv) so a series' descriptor maps 1:1 to its
  // ring-buffer array. `idx` flags the 0-255 diffuse-map indices (which have no
  // annual record store, so at 100yr they draw only their monthly tail).
  graphSeries: {
    pop:   { on: true, color: "#00aa00", key: "pop",   label: "Population" },
    net:   { on: true, color: "#0000cc", key: "net",   label: "Cash flow" },
    tax:   { on: true, color: "#cc6600", key: "tax",   label: "Tax income" },
    poll:  { on: true, color: "#cc0000", key: "poll",  label: "Pollution", idx: true },
    crime: { on: true, color: "#9900cc", key: "crime", label: "Crime",     idx: true },
    landv: { on: true, color: "#00aaaa", key: "landv", label: "Land value", idx: true },
  },
  graphRange: "10yr",   // "1yr" | "10yr" | "100yr"
  // GP1a: the open Tile Info target ({x, y, at}) — null whenever the dialog is
  // hidden, which is what keeps diagnoseTile off the frame budget when closed.
  query: null,
  rciAt: -1,            // GP1a: last Demand Breakdown re-render (performance.now)
  // GP1a: drag-cost PREVIEW. Accumulated strictly AFTER city.place() returns,
  // from its {ok, reason, cost} — never before it, never as a guard. It warns
  // about a shortfall; the refusal itself is still place()'s existing path.
  drag: { active: false, until: 0, count: 0, spent: 0, short: 0, blocked: 0 },
  // GP1a: transient status message + its expiry (see setStatus)
  status: null,
};

/* --------- user preferences (localStorage, separate from the save) --------- */
const PREFS_KEY = "simcity99.prefs";

function loadPrefs() {
  let p = {};
  try { p = JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch (e) {}
  return Object.assign({ autoBudget: false, dayNight: true, viewRot: 0 }, p);
}
function savePrefs() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(UI.prefs)); } catch (e) {}
}
UI.prefs = loadPrefs();
cam.r = (UI.prefs.viewRot | 0) & 3; // M32a: resume at the player's last view rotation

const TOOLS = [
  { id: "query",    name: "Inspect",   key: "0", icon: "🔍" },
  { id: "bulldoze", name: "Bulldoze",  key: "1", icon: "🚜" },
  // M21: free metadata paint tool — no COST entry, no tier lock. Paints the
  // district layer, never the OV building layer.
  { id: "district", name: "Distrct",   key: "d", icon: "🏘️" },
  { id: "road",     name: "Road",      key: "2", icon: null, spr: () => SPR.road[5] },
  { id: "wire",     name: "Power Ln",  key: "3", icon: null, spr: () => SPR.wire[5] },
  { id: "zr",       name: "Residntl",  key: "4", icon: null, spr: () => SPR.r1[0] },
  { id: "zc",       name: "Commercl",  key: "5", icon: null, spr: () => SPR.c3[0] },
  { id: "zi",       name: "Industrl",  key: "6", icon: null, spr: () => SPR.i2[0] },
  { id: "park",     name: "Park",      key: "7", icon: null, spr: () => SPR.park },
  { id: "tree",     name: "Trees",     key: "8", icon: null, spr: () => SPR.forest[1][0] },
  { id: "waterfill", name: "Waterfill", key: "w", icon: null, spr: () => SPR.water[0][0] },
  { id: "police",   name: "Police",    key: "9", icon: null, spr: () => SPR.police },
  { id: "firesta",  name: "Fire Dept", key: "-", icon: null, spr: () => SPR.firesta },
  { id: "school",   name: "School",    key: "s", icon: null, spr: () => SPR.school },
  { id: "hospital", name: "Hospital",  key: "h", icon: null, spr: () => SPR.hospital },
  { id: "coal",     name: "Coal Pwr",  key: "=", icon: null, spr: () => SPR.coal },
  { id: "solar",    name: "Solar Pwr", key: "+", icon: null, spr: () => SPR.solar },
  { id: "gas",      name: "Gas Pwr",   key: "g", icon: null, spr: () => SPR.gas },
  { id: "wind",     name: "Wind Pwr",  key: "i", icon: null, spr: () => SPR.wind },
  // M24: water network — a contiguous trio right after the power plants. Keys
  // p/t/u are free. Cost chips render automatically from COST.
  { id: "pipe",       name: "Water Pipe", key: "p", icon: null, spr: () => SPR.pipe[5] },
  { id: "watertower", name: "Watr Twr",   key: "t", icon: null, spr: () => SPR.watertower },
  { id: "pump",       name: "Watr Pump",  key: "u", icon: null, spr: () => SPR.pump },
  // M25: mass transit — gated behind Town (TOOL_TIER.rail/subway/station=2), so
  // the buttons dim with a padlock until the city ranks up. Keys r/k/n are free
  // (r/u/t from the design collide with rotate/pump/water-tower, so they moved).
  { id: "rail",    name: "Railway",  key: "r", icon: null, spr: () => SPR.rail[5],   minTier: TOOL_TIER.rail },
  { id: "subway",  name: "Subway",   key: "k", icon: null, spr: () => SPR.subwayIcon, minTier: TOOL_TIER.subway },
  { id: "station", name: "Station",  key: "n", icon: null, spr: () => SPR.station,    minTier: TOOL_TIER.station },
  // milestone rewards — locked until the city earns its rank
  { id: "mayor",    name: "Mayor Hse", key: "m", icon: null, spr: () => SPR.mayor,
    minTier: TOOL_TIER.mayor },
  { id: "stadium",  name: "Stadium",   key: "b", icon: null, spr: () => SPR.stadium,
    minTier: TOOL_TIER.stadium },
  // M28: arcologies (self-powered mega-housing that keeps a maxed city growing)
  // gate up the tier ladder via TOOL_TIER — Plymouth/Forest at City, the endgame
  // Darco/Launch at Metropolis; the buttons dim with a padlock until unlocked.
  // Wonder landmarks are ungated prestige objects that pump land value. Keys
  // a/f/j/l/y/v/x are all free (q/e are reserved for view rotation).
  { id: "plymouth", name: "Plymouth",  key: "a", icon: null, spr: () => SPR.plymouth, minTier: TOOL_TIER.plymouth },
  { id: "forest",   name: "Forest Arc", key: "f", icon: null, spr: () => SPR.forestArc, minTier: TOOL_TIER.forest },
  { id: "darco",    name: "Darco Arc",  key: "j", icon: null, spr: () => SPR.darco,    minTier: TOOL_TIER.darco },
  { id: "launch",   name: "Launch Arc", key: "l", icon: null, spr: () => SPR.launch,   minTier: TOOL_TIER.launch },
  { id: "statue",   name: "Statue",    key: "y", icon: null, spr: () => SPR.statue },
  { id: "eiffel",   name: "Eiffel",    key: "v", icon: null, spr: () => SPR.eiffel },
  { id: "pyramid",  name: "Pyramid",   key: "x", icon: null, spr: () => SPR.pyramid },
  // GQ10: special-buildings gap-fill — the endgame nuclear plant plus the
  // airport/seaport civic pair, tier-gated via TOOL_TIER like the arcos.
  // Keys o/c/z are free (q/e are reserved for view rotation). Cost chips,
  // padlock dimming, the shortcuts overlay and the build-cost dialog all
  // derive from TOOLS/COST automatically.
  { id: "nuke",    name: "Nuclear",  key: "o", icon: null, spr: () => SPR.nuke,    minTier: TOOL_TIER.nuke },
  { id: "airport", name: "Airport",  key: "c", icon: null, spr: () => SPR.airport, minTier: TOOL_TIER.airport },
  { id: "seaport", name: "Seaport",  key: "z", icon: null, spr: () => SPR.seaport, minTier: TOOL_TIER.seaport },
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

/* --------- seasonal wires (M12): month-gated, same pattern as NEWS_1997 ---- */
const NEWS_WINTER = [
  "❄️ Blizzard of '98 buries Main Street; plows out in force by dawn.",
  "🚜 Snow plows on double shifts — mayor praised for 'gritty' road response.",
  "⛄ Record snowman on Elm St. sports authentic frosted-tips wig.",
  "🏒 Pond hockey league declares itself 'the real NHL'. Zamboni pending.",
  "🧣 Mitten sales up 900%. Pager-compatible gloves still in beta.",
  "❄️ Salt trucks roll at 5 AM. Please move your Geo Metro, citizens.",
];

const NEWS_SUMMER = [
  "☀️ Heat index soars; city pools declare a two-hour Macarena moratorium.",
  "🍦 Ice cream truck gridlock downtown. Officials call it 'a good problem'.",
  "🏖️ Beach traffic backs up to the highway. Bring a Game Boy and patience.",
  "💦 Slip'N Slide championship ends in seventeen friendly lawsuits.",
  "🌽 County fair opens: butter sculpture of the mayor 'uncannily accurate'.",
  "🎆 Fireworks stand sells out; raccoons reportedly hoarding sparklers.",
];

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
  bindDistricts();
  bindMinimap();
  bindTicker();
  pickerInit();
  bindRCI();
  setTool("road");
}

// GP1a: the RCI meter is now a button into its own decomposition
function bindRCI() {
  const r = document.getElementById("rci");
  if (!r) return;
  r.title = "What is driving demand? (click)";
  r.addEventListener("click", () => { Snd.click(); openRCI(); });
}

/* ================= splash map picker (M11) ================= */
// Free-play map selection: size (64 / 80 / 128) + a real previewed terrain
// for a concrete seed. NEW CITY consumes exactly what the preview shows;
// untouched, the picker holds the classic 80x80 with a random seed.
const PICKER = { seed: (Math.random() * 1e9) | 0, size: 80, terr: null };

function pickerPreview() {
  const cvp = document.getElementById("picker-canvas");
  if (!cvp) return;
  const prevMap = MAP;
  // real terrain: the same City(seed, size) path NEW CITY takes
  const c = new City(PICKER.seed, PICKER.size);
  setMapSize(prevMap);            // peeking at a preview never resizes the world
  PICKER.terr = c.terr;
  const g = cvp.getContext("2d");
  const n = PICKER.size, sc = cvp.width / n;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x;
    const t = c.terr[i];
    g.fillStyle = t === TERR.WATER ? "#136"
      : t === TERR.FOREST ? "#0a3a12"
      : (c.varnt[i] % 2 ? "#215425" : "#1c4a1c");
    g.fillRect(x * sc, y * sc, sc, sc);
  }
  const lbl = document.getElementById("picker-seed");
  lbl.textContent = `Seed ${PICKER.seed} · ${n}×${n}`;
  lbl.dataset.seed = PICKER.seed;
}

function pickerReroll() {
  let s = (Math.random() * 1e9) | 0;
  while (s === PICKER.seed) s = (Math.random() * 1e9) | 0;
  PICKER.seed = s;
  pickerPreview();
}

function pickerInit() {
  if (!document.getElementById("map-picker")) return;
  document.querySelectorAll('input[name="mapsize"]').forEach(r => {
    r.addEventListener("change", () => {
      PICKER.size = +r.value;
      pickerPreview();
    });
  });
  document.getElementById("btn-reroll").addEventListener("click", () => {
    Snd.ensure(); Snd.click();
    pickerReroll();
  });
  pickerPreview();
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
  // M21: first pick of the district tool opens the manager (discoverability),
  // since a costless metadata tool has no obvious feedback until it has a brush.
  if (id === "district" && city && city.districts.length === 0) openDistricts();
}

/* GP1a: a status message now carries a TTL. refreshHUD restores the idle tool
   line once it expires, so a message is never left stale — and because the live
   tile readout moved to its OWN cell (#sb-hover), a mouse sweep can no longer
   eat a message the player has not read yet. Existing call sites are unchanged
   (they all take the 6s default). */
function setStatus(msg, ttl = 6000) {
  document.getElementById("sb-tool").textContent = msg;
  UI.status = ttl > 0 ? { text: msg, until: performance.now() + ttl } : null;
}

// what #sb-tool falls back to with nothing to say
function idleStatusLine() {
  const t = typeof TOOLS !== "undefined" ? TOOLS.find(t => t.id === UI.tool) : null;
  const cost = COST[UI.tool];
  return t ? `${t.name}${cost ? ` — §${cost} each` : ""}` : "Ready, Mayor.";
}

/* ================= menus ================= */
const MENUS = {
  file: () => [
    ["New City", () => uiConfirm("Start a new city? Unsaved progress is lost.", newCity)],
    ["Save City", saveCity],
    ["Load City", loadCity],
    "-",
    ["Send Postcard… 📮", openPostcard],
    "-",
    ["About SimCity 99", () => showDlg("dlg-about")],
  ],
  speed: () => [
    [`${UI.speed === 0 ? "● " : ""}Pause (space)`, () => setSpeed(0)],
    [`${UI.speed === 0.5 ? "● " : ""}Turtle`, () => setSpeed(0.5)],
    [`${UI.speed === 1 ? "● " : ""}Llama`, () => setSpeed(1)],
    [`${UI.speed === 2 ? "● " : ""}Cheetah`, () => setSpeed(2)],
    "-",
    [`${UI.prefs.dayNight ? "✓ " : ""}Day/Night Cycle`,
      () => { UI.prefs.dayNight = !UI.prefs.dayNight; savePrefs(); }],
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
    ["Regional Deals… 🌐", openRegion],
    ["City Ordinances… 📋", openOrdinances],
    ["Districts… 🏘️", openDistricts],
    [`${UI.prefs.autoBudget ? "✓ " : ""}Budget Report Monthly`,
      () => { UI.prefs.autoBudget = !UI.prefs.autoBudget; savePrefs(); }],
    ["Graphs…", openGraphs],
    ["City Hall Records… 📜", openAlmanac],
    ["Advisors…", openAdvisors],
    ["Trophy Shelf… 🏆", openTrophies],
    "-",
    ["Keyboard Shortcuts… (F1)", openShortcuts],
  ],
  sound: () => [
    [`${Snd.sfxOn ? "✓ " : ""}Sound Effects`, () => Snd.toggleSfx()],
    [`${Snd.musicOn ? "✓ " : ""}Music`, () => Snd.toggleMusic()],
  ],
  help: () => [
    ["Keyboard Shortcuts… (F1)", openShortcuts],
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
      // news chopper (M18): a click that hits the airborne chopper opens the
      // traffic report and is fully swallowed — no tool fires, no paint drag
      // starts. chopperHitTest short-circuits to false with no chopper up.
      const r = c.getBoundingClientRect();
      if (chopperHitTest(e.clientX - r.left, e.clientY - r.top)) {
        Snd.click();
        openTrafficReport();
        return;
      }
      UI.painting = true;
      dragMeterReset();
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
    dragMeterEnd(); // totals stay readable for DRAG_TTL, then clear themselves
  });

  // GQ11: eased zoom-to-cursor. The wheel no longer writes cam.z directly —
  // it retargets zoomAnim and camEase() (one call per rAF from main.js loop)
  // exponentially eases cam.z there, re-anchoring each step on the cursor
  // point with the exact pinch math below. Successive wheel steps compound
  // against the pending target so fast scrolls still cover the same range.
  c.addEventListener("wheel", (e) => {
    e.preventDefault();
    const f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const r = c.getBoundingClientRect();
    const base = zoomAnim.active ? zoomAnim.target : cam.z;
    zoomAnim.target = Math.max(0.4, Math.min(2.5, base * f));
    zoomAnim.ax = e.clientX - r.left - VW / 2; // CSS px from canvas center
    zoomAnim.ay = e.clientY - r.top - VH / 2;
    zoomAnim.active = true;
  }, { passive: false });

  /* --- touch input (M15): one finger builds, two fingers pan / pinch-zoom.
     preventDefault on touchstart keeps the browser from replaying the tap as
     synthetic mouse events (no double-build) and from scrolling the page.
     A lone finger starts as a pending "tap" that builds nothing yet: if it
     moves it becomes a paint drag, if it lifts it builds its tile, and if a
     second finger lands (fingers rarely touch down in the same event) the
     whole touch is promoted to a camera gesture that never builds. --- */
  const TAP_SLOP = 8; // px of finger jitter still counting as a tap
  const touch = { mode: null, sx: 0, sy: 0, lastMid: null, lastDist: 1 };
  const pinchOf = (e) => {
    const a = e.touches[0], b = e.touches[1];
    return {
      mid: { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 },
      dist: Math.max(1, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)),
    };
  };

  c.addEventListener("touchstart", (e) => {
    e.preventDefault();
    Snd.ensure();
    if (e.touches.length >= 2) {
      const { mid, dist } = pinchOf(e);
      touch.mode = "gesture"; touch.lastMid = mid; touch.lastDist = dist;
      zoomAnim.active = false; // GQ11: pinch is DIRECT — a pending wheel ease would fight it
      UI.hover = null;
    } else if (touch.mode === null) {
      const t = e.touches[0];
      const r = c.getBoundingClientRect();
      touch.sx = t.clientX; touch.sy = t.clientY;
      // news chopper (M18): same screen-space hit test as the mouse path.
      // A finger landing on the chopper claims the touch for the traffic
      // report — it can never paint, and touchend opens the dialog.
      touch.mode = chopperHitTest(t.clientX - r.left, t.clientY - r.top)
        ? "choppertap" : "tap";
      UI.hover = touch.mode === "tap"
        ? screenToTile(t.clientX - r.left, t.clientY - r.top) : null;
      if (touch.mode === "tap") dragMeterReset(); // GP1a: a finger drag meters too
    }
  }, { passive: false });

  c.addEventListener("touchmove", (e) => {
    e.preventDefault();
    if (touch.mode === "gesture" && e.touches.length >= 2) {
      const { mid, dist } = pinchOf(e);
      const r = c.getBoundingClientRect();
      // pinch: rescale about the gesture midpoint so the tile under it stays put
      const z2 = Math.max(0.4, Math.min(2.5, cam.z * (dist / touch.lastDist)));
      const sx = mid.x - r.left - VW / 2; // GQ11: CSS px (DPR backing store)
      const sy = mid.y - r.top - VH / 2;
      cam.x += sx / cam.z - sx / z2;
      cam.y += sy / cam.z - sy / z2;
      cam.z = z2;
      // two-finger pan: same sign convention as the mouse pan
      cam.x -= (mid.x - touch.lastMid.x) / cam.z;
      cam.y -= (mid.y - touch.lastMid.y) / cam.z;
      clampCam();
      touch.lastMid = mid; touch.lastDist = dist;
    } else if ((touch.mode === "tap" || touch.mode === "paint") &&
               e.touches.length === 1) {
      const t = e.touches[0];
      if (touch.mode === "tap") {
        if (Math.hypot(t.clientX - touch.sx, t.clientY - touch.sy) < TAP_SLOP) return;
        touch.mode = "paint";
        // the drag's very first tile — where the finger went down
        applyToolAt({ clientX: touch.sx, clientY: touch.sy });
      }
      const r = c.getBoundingClientRect();
      UI.hover = screenToTile(t.clientX - r.left, t.clientY - r.top);
      applyToolAt(t); // a Touch carries clientX/clientY — same mapping as the mouse
    }
  }, { passive: false });

  const touchDone = (e) => {
    if (e.cancelable) e.preventDefault(); // swallow the synthetic click too
    if (touch.mode === "tap" && e.type === "touchend")
      applyToolAt({ clientX: touch.sx, clientY: touch.sy }); // a clean tap builds
    // a tap that landed on the chopper (M18) opens the report, builds nothing
    if (touch.mode === "choppertap" && e.type === "touchend") {
      Snd.click();
      openTrafficReport();
    }
    // a gesture keeps its claim until every finger lifts — no accidental builds
    if (e.touches.length === 0) { touch.mode = null; UI.hover = null; dragMeterEnd(); }
  };
  c.addEventListener("touchend", touchDone, { passive: false });
  c.addEventListener("touchcancel", touchDone, { passive: false });
}

function clampCam() {
  const pad = 200;
  cam.x = Math.max(-MAP * HW - pad, Math.min(MAP * HW + pad, cam.x));
  cam.y = Math.max(-pad, Math.min(MAP * TH + pad, cam.y));
}

/* --------- GQ11: eased zoom-to-cursor --------- */
// Wheel zoom retargets this and camEase() glides cam.z toward it, cursor-
// anchored, ~150-250 ms settle. Presentation-only: mutates cam alone, zero
// RNG, and the sim never reads cam. Pinch stays direct (already continuous);
// every camera reset (rotate, new/load city, scenario start, minimap click)
// cancels a pending ease so a stale anchor can never drag the view.
const zoomAnim = { target: 1, ax: 0, ay: 0, active: false };

function camEase(dt) {
  if (!zoomAnim.active) return;
  const k = 1 - Math.exp(-dt / 70); // tau = 70 ms
  let z2 = cam.z + (zoomAnim.target - cam.z) * k;
  if (Math.abs(zoomAnim.target - z2) < 0.002) { z2 = zoomAnim.target; zoomAnim.active = false; }
  // exact shipped pinch anchor math: the world point under the cursor stays put
  cam.x += zoomAnim.ax / cam.z - zoomAnim.ax / z2;
  cam.y += zoomAnim.ay / cam.z - zoomAnim.ay / z2;
  cam.z = z2;
  clampCam();
}

// M32a: 90° view rotation. dir=+1 rotates CCW (Q), dir=-1 CW (E). Pivots in
// place: capture the tile under screen-center FIRST, advance cam.r, then
// recenter the camera on that same tile's new projected position so the view
// spins around what the player is looking at rather than jumping. Snap only.
function rotateView(dir) {
  zoomAnim.active = false; // GQ11: rotation stays snap-only (M32 contract)
  const ctr = screenToTile(VW / 2, VH / 2); // GQ11: CSS-px center (DPR store)
  cam.r = (cam.r + dir + 4) & 3;
  cam.x = worldX(ctr.x, ctr.y);
  cam.y = worldY(ctr.x, ctr.y);
  clampCam();
  UI.prefs.viewRot = cam.r; savePrefs();
}

/* GP1a: the drag-cost meter. `active` opens on mousedown/touchstart and the
   counters accumulate ONLY from what city.place() already returned, so this is
   a pure observer: no projection, no pre-check, no early return. The refusal a
   player hits is still place()'s own {ok:false, reason:"funds"} + Snd.denied(). */
function dragMeterReset() {
  UI.drag.active = true; UI.drag.until = 0;
  UI.drag.count = 0; UI.drag.spent = 0; UI.drag.short = 0; UI.drag.blocked = 0;
}
/* The totals describe ONE drag on ONE city. They linger just long enough to be
   read (DRAG_TTL after the button comes up) and are wiped outright by New/Load
   City — a status bar must never advertise a spend against a city that no
   longer exists. */
const DRAG_TTL = 5000;
function dragMeterEnd() {
  if (!UI.drag.active) return;
  UI.drag.active = false;
  UI.drag.until = (UI.drag.count || UI.drag.blocked) ? performance.now() + DRAG_TTL : 0;
}
function dragMeterClear() {
  UI.drag.active = false; UI.drag.until = 0;
  UI.drag.count = 0; UI.drag.spent = 0; UI.drag.short = 0; UI.drag.blocked = 0;
}
function dragMeterNote(res, tool, x, y) {
  if (!UI.drag.active) return;
  if (res.ok) {
    UI.drag.count++;
    UI.drag.spent += res.cost != null ? res.cost : city.toolCost(tool, x, y);
  } else if (res.reason === "funds") {
    UI.drag.blocked++;
    UI.drag.short += res.cost != null ? res.cost : city.toolCost(tool, x, y);
  }
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

  // M21: district paint — bypass place()/canPlace()/toolCost() entirely so it
  // never writes OV.NONE and never charges funds. Sits after the lastPaint
  // dedupe above (drag swaths dedupe for free) and returns before city.place.
  if (UI.tool === "district") { city.paintDistrict(x, y, UI.curDistrict); Snd.zone(); return; }

  const res = city.place(UI.tool, x, y);
  dragMeterNote(res, UI.tool, x, y); // strictly AFTER place(): observe, never gate
  if (res.ok) {
    switch (UI.tool) {
      case "bulldoze": Snd.bulldoze(); break;
      case "road": Snd.place(); break;
      case "wire": Snd.wire(); break;
      case "zr": case "zc": case "zi": Snd.zone(); break;
      default: Snd.place(); Snd.cash();
    }
    if (res.hint) setStatus(res.hint); // M25: "link the station" feedback
  } else if (res.reason === "funds") {
    Snd.denied(); setStatus("⛔ Not enough funds!");
  } else if (res.reason === "locked") {
    Snd.denied(); setStatus("🔒 That reward isn't unlocked yet.");
  } else if (res.reason === "blocked" && UI.tool === "pump") {
    // M24: the commonest pump refusal is the water-adjacency gate
    Snd.denied(); setStatus("💧 Pumps must sit next to water.");
  }
}

function bindKeys() {
  window.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT") return;
    if (e.key === "F1") { // toggle the shortcuts overlay
      e.preventDefault();
      const d = document.getElementById("dlg-shortcuts");
      if (d.classList.contains("hidden")) openShortcuts();
      else hideDlg("dlg-shortcuts");
      return;
    }
    if (e.key === "Escape") { // close any open dialog
      document.querySelectorAll(".dlg").forEach(d => d.classList.add("hidden"));
      return;
    }
    if (e.code === "Space") { e.preventDefault(); setSpeed(UI.speed === 0 ? 1 : 0); return; }
    // M32a: view rotation — intercept BEFORE the TOOLS.find lookup so rotate
    // keys never select a tool. Q/[ = CCW, E/] = CW.
    if (e.key === "q" || e.key === "Q" || e.key === "[") { rotateView(1); return; }
    if (e.key === "e" || e.key === "E" || e.key === "]") { rotateView(-1); return; }
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

// G8: one-line legend per overlay mode — swatches/gradients echo the exact
// colors renderMinimap paints, so the strip explains what the map shows
const MM_LEGENDS = {
  power:   '<i class="sw" style="background:#ff0"></i>plant <i class="sw" style="background:#f80"></i>powered <i class="sw" style="background:#334"></i>dark',
  // GQ11: gradients/swatches mirror the retuned deutan-safe overlay ramps
  // (render.js MM_POLL/MM_CRIME/MM_TRAFFIC + the blue/orange svc pair)
  poll:    '<i class="grad" style="background:linear-gradient(90deg,#131,#966e24,#ffbe32)"></i>clean / foul',
  value:   '<i class="grad" style="background:linear-gradient(90deg,#1e283c,#6adabb)"></i>cheap / prime',
  crime:   '<i class="grad" style="background:linear-gradient(90deg,#121,#8c285a,#ff60be)"></i>safe / lawless',
  traffic: '<i class="grad" style="background:linear-gradient(90deg,#46dc3c,#eba028,#8c101c)"></i>free / jammed',
  svc:     '<i class="sw" style="background:#288cfa"></i>edu <i class="sw" style="background:#fc8c32"></i>health <i class="sw" style="background:#fcf0fa"></i>both',
  // M24: water network — providers, dry pipe, and a served-pressure gradient
  water:   '<i class="sw" style="background:#0cf"></i>tower/pump <i class="sw" style="background:#234"></i>dry pipe <i class="grad" style="background:linear-gradient(90deg,#146078,#28c8f0)"></i>served',
  // M25: rail network — track, subway, live/dead station, and the ridership
  // catchment. GQ11: the dead-station slate joins the strip (G8 contract).
  transit: '<i class="sw" style="background:#6cf"></i>track <i class="sw" style="background:#55f"></i>subway <i class="sw" style="background:#2ff"></i>station <i class="sw" style="background:#78808c"></i>no svc <i class="grad" style="background:linear-gradient(90deg,#16305a,#3c78c8)"></i>catchment',
  // M21: static fallback string (satisfies "MM_LEGENDS.dist is a non-empty
  // string"); updateMapLegend swaps in live per-district swatches when any exist.
  dist:    '<i class="sw" style="background:#e84448"></i>neighborhoods — paint with the 🏘️ tool',
};

function updateMapLegend(mode) {
  const el = document.getElementById("mm-legend");
  if (mode === "all") { el.classList.add("hidden"); return; }
  if (mode === "dist") {
    // build live swatches from DISTRICT_COLS via DOM nodes so user names are
    // inserted as text (never HTML) — safe against name injection
    el.innerHTML = "";
    if (city && city.districts.length) {
      for (const d of city.districts) {
        const sw = document.createElement("i");
        sw.className = "sw"; sw.style.background = DISTRICT_COLS[d.col];
        el.appendChild(sw);
        el.appendChild(document.createTextNode(d.name + " "));
      }
    } else {
      el.innerHTML = MM_LEGENDS.dist;
    }
    el.classList.remove("hidden");
    return;
  }
  el.innerHTML = MM_LEGENDS[mode];
  el.classList.remove("hidden");
}

function bindMinimap() {
  document.querySelectorAll(".mm").forEach(b => {
    b.addEventListener("click", () => {
      UI.mapMode = b.dataset.mode;
      document.querySelectorAll(".mm").forEach(x => x.classList.toggle("active", x === b));
      updateMapLegend(b.dataset.mode);
    });
  });
  // M32a: HUD rotate buttons
  const rccw = document.getElementById("rot-ccw");
  const rcw = document.getElementById("rot-cw");
  if (rccw) rccw.addEventListener("click", () => { Snd.click(); rotateView(1); });
  if (rcw) rcw.addEventListener("click", () => { Snd.click(); rotateView(-1); });
  const mm = document.getElementById("minimap");
  mm.addEventListener("click", (e) => {
    const r = mm.getBoundingClientRect();
    const tx = (e.clientX - r.left) / r.width * MAP;
    const ty = (e.clientY - r.top) / r.height * MAP;
    zoomAnim.active = false; // GQ11: recenter cancels a pending cursor-zoom
    cam.x = worldX(tx, ty); cam.y = worldY(tx, ty);
    clampCam();
  });
}

/* ================= dialogs ================= */
function showDlg(id) { document.getElementById(id).classList.remove("hidden"); }
function hideDlg(id) { document.getElementById(id).classList.add("hidden"); }

/* Self-contained Win95 modal (native confirm/alert/prompt are blocked in the
   sandboxed artifact iframe). Builds the same .dlg chrome the static dialogs
   use, plus a click-swallowing backdrop, so it reads as modal in-game. */
let uiModalOpen = false;
function uiModal(title, message, buttons) {
  if (uiModalOpen) return; // guard against stacking two modals
  uiModalOpen = true;
  const desktop = document.getElementById("desktop") || document.body;

  const backdrop = document.createElement("div");
  backdrop.style.cssText =
    "position:absolute;inset:0;z-index:9000;background:rgba(0,0,0,0.35);";

  const dlg = document.createElement("div");
  dlg.className = "win95 dlg";
  dlg.style.zIndex = "9001";

  const bar = document.createElement("div");
  bar.className = "titlebar";
  const ttl = document.createElement("span");
  ttl.textContent = title;
  const tbtns = document.createElement("span");
  tbtns.className = "title-btns";
  const closeX = document.createElement("span");
  closeX.className = "tbtn dlg-close";
  closeX.textContent = "✕";
  tbtns.appendChild(closeX);
  bar.appendChild(ttl); bar.appendChild(tbtns);

  const body = document.createElement("div");
  body.className = "dlg-body";
  body.textContent = message;

  const btnRow = document.createElement("div");
  btnRow.className = "dlg-buttons";

  function close() {
    if (!uiModalOpen) return;
    uiModalOpen = false;
    document.removeEventListener("keydown", onKey, true);
    backdrop.remove();
    dlg.remove();
  }
  function onKey(e) { if (e.key === "Escape") { e.preventDefault(); close(); } }

  let focusTarget = null;
  for (const b of buttons) {
    const el = document.createElement("button");
    el.className = "btn95";
    el.textContent = b.label;
    el.addEventListener("click", () => { close(); if (b.action) b.action(); });
    btnRow.appendChild(el);
    if (b.focus) focusTarget = el;
  }
  if (!focusTarget && btnRow.firstChild) focusTarget = btnRow.firstChild;

  closeX.addEventListener("click", close);
  backdrop.addEventListener("click", close);

  dlg.appendChild(bar); dlg.appendChild(body); dlg.appendChild(btnRow);
  desktop.appendChild(backdrop);
  desktop.appendChild(dlg);
  document.addEventListener("keydown", onKey, true);
  if (focusTarget) focusTarget.focus();
}

function uiConfirm(message, onOk, opts) {
  const title = (opts && opts.title) || "SimCity 99";
  uiModal(title, message, [
    { label: "OK", action: onOk, focus: true },
    { label: "Cancel" },
  ]);
}

function uiAlert(message, onOk) {
  uiModal("SimCity 99", message, [
    { label: "OK", action: onOk, focus: true },
  ]);
}

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

  // M20: About dialog music-credits easter egg — clicking the ♪ reveals the
  // generative-soundtrack credits (and plays a little fanfare).
  const musicNote = document.getElementById("about-music-note");
  if (musicNote) {
    musicNote.addEventListener("click", () => {
      const credits = document.getElementById("about-credits");
      if (credits) credits.classList.remove("hidden");
      Snd.fanfare();
    });
  }

  const slider = document.getElementById("tax-slider");
  slider.addEventListener("input", () => {
    city.taxRate = +slider.value;
    document.getElementById("tax-label").textContent = slider.value + "%";
    fillBudgetTable();
  });

  // M23: five per-department funding sliders — each drives city.funding
  // live (no reopen needed): % label + budget table refresh on every input
  document.querySelectorAll(".fund-slider").forEach((s) => {
    s.addEventListener("input", () => {
      city.funding[s.dataset.dept] = +s.value;
      document.getElementById("fund-label-" + s.dataset.dept).textContent = s.value + "%";
      // M25: transit funding scales the ridership catchment, so rebuild rail (and
      // traffic) live — the served-zone relief reacts even while paused.
      if (s.dataset.dept === "transit" && city) { city.railDirty = true; city.recomputeRail(true); city.railDirty = false; city.recomputeTraffic(); }
      fillBudgetTable();
    });
  });

  // M22: ordinance checkboxes — delegated on #ord-list so the handler survives
  // every fillOrdList() re-render. On toggle: enactOrdinance rebuilds ordMods,
  // then recomputeMaps/Traffic/Demand react so crime/pollution/traffic overlays
  // and demand update within a frame EVEN WHILE PAUSED; the row cells + footer
  // refresh, and any open budget dialog picks up the new ordinance line.
  document.getElementById("ord-list").addEventListener("change", (e) => {
    const cb = e.target.closest(".ord-check");
    if (!cb) return;
    Snd.ensure();
    const id = cb.dataset.id;
    const ok = city.enactOrdinance(id, cb.checked);
    if (!ok) { Snd.denied(); cb.checked = false; fillOrdList(); return; }
    Snd.click();
    city.recomputeMaps(); city.recomputeTraffic(); city.recomputeDemand();
    fillOrdList();
    if (!document.getElementById("dlg-budget").classList.contains("hidden")) fillBudgetTable();
  });

  // M27: regional-deal dialog — delegated on #region-list so handlers survive
  // every fillRegion() re-render. Segmented Sell/Buy/None just repaints the row's
  // active button (no model change until Propose); Propose commits deterministically.
  const regionList = document.getElementById("region-list");
  regionList.addEventListener("click", (ev) => {
    const seg = ev.target.closest(".rg-seg");
    if (seg && !seg.disabled) {
      Snd.ensure();
      const box = seg.parentElement;
      box.querySelectorAll(".rg-seg").forEach((b) => b.classList.remove("on"));
      seg.classList.add("on");
      return;
    }
    const prop = ev.target.closest(".rg-propose");
    if (prop && !prop.disabled) { Snd.ensure(); regionApply(prop.closest(".region-panel")); }
  });

  // M13: issue-bond button — refusal at the cap is handled by issueBond()
  document.getElementById("btn-issue-bond").addEventListener("click", () => {
    Snd.ensure();
    const res = city.issueBond();
    fillBondPanel(); fillBudgetTable();
    if (res.ok) { Snd.cash(); setBondNote(""); }
    else {
      Snd.denied();
      const msg = `⛔ Credit limit reached — the market refuses more than ${BOND_MAX} concurrent bonds.`;
      setBondNote(msg);
      city.pushMsg(msg);
    }
  });
}

function openBudget() {
  document.getElementById("tax-slider").value = city.taxRate;
  document.getElementById("tax-label").textContent = city.taxRate + "%";
  for (const dept of ["police", "fire", "roads", "edu", "health", "transit"]) { // M23 / M25 transit
    document.getElementById("fund-" + dept).value = city.funding[dept];
    document.getElementById("fund-label-" + dept).textContent = city.funding[dept] + "%";
  }
  fillBudgetTable();
  fillPowerMix();
  fillBondPanel();
  setBondNote("");
  showDlg("dlg-budget");
}

/* --------- power-mix breakdown (M19) ---------
   A pie plus a labeled legend of each generator type's LIVE effective
   capacity (city.powerMix(), which folds in plant aging and sums to
   powerSupply). Types with more/larger plants take a bigger slice; a type
   with no plants shows a 0 slice. Rebuilt whenever the budget dialog opens. */
const POWERMIX_TYPES = [
  { key: "coal",  label: "Coal",  col: "#6b6b73" },
  { key: "gas",   label: "Gas",   col: "#c9853b" },
  { key: "solar", label: "Solar", col: "#2f74c0" },
  { key: "wind",  label: "Wind",  col: "#5fb56a" },
  { key: "nuke",  label: "Nuclear", col: "#d8c433" }, // GQ10: keeps the pie summing to powerSupply
];
function fillPowerMix() {
  const mix = city.powerMix();
  const total = POWERMIX_TYPES.reduce((s, t) => s + mix[t.key], 0);
  const cv = document.getElementById("powermix-pie");
  if (cv) {
    const g = cv.getContext("2d");
    g.clearRect(0, 0, cv.width, cv.height);
    const cx = cv.width / 2, cy = cv.height / 2, r = Math.min(cx, cy) - 3;
    if (total <= 0) {
      g.fillStyle = "#b8b8b8";
      g.beginPath(); g.arc(cx, cy, r, 0, 7); g.fill();
      g.strokeStyle = "#808080"; g.lineWidth = 1; g.stroke();
      g.fillStyle = "#404040"; g.font = "9px Tahoma, sans-serif";
      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText("no plants", cx, cy);
    } else {
      let a0 = -Math.PI / 2;
      for (const t of POWERMIX_TYPES) {
        if (mix[t.key] <= 0) continue;
        const a1 = a0 + (mix[t.key] / total) * Math.PI * 2;
        g.fillStyle = t.col;
        g.beginPath(); g.moveTo(cx, cy);
        g.arc(cx, cy, r, a0, a1); g.closePath(); g.fill();
        a0 = a1;
      }
      g.strokeStyle = "#303030"; g.lineWidth = 1;
      g.beginPath(); g.arc(cx, cy, r, 0, 7); g.stroke();
    }
  }
  const rows = POWERMIX_TYPES.map((t) => {
    const mw = mix[t.key];
    const pct = total > 0 ? Math.round(mw / total * 100) : 0;
    return `<tr><td><i class="sw" style="background:${t.col}"></i>${t.label}</td>` +
           `<td>${mw} MW (${pct}%)</td></tr>`;
  }).join("");
  document.getElementById("powermix-legend").innerHTML =
    rows + `<tr class="total"><td>Total supply</td><td>${total} MW</td></tr>`;
}

function fillBudgetTable() {
  const b = city.lastBudget;
  // M23: per-department lines — funding level + charge, projected LIVE from
  // city.deptCosts() (same documented formula collectBudget charges with),
  // so dragging a funding slider updates the table without reopening
  const dc = city.deptCosts();
  const fd = city.funding;
  const f = (n) => (n < 0 ? "-§" : "§") + Math.abs(n).toLocaleString();
  document.getElementById("budget-table").innerHTML = `
    <tr><td>Tax revenue</td><td>${f(b.taxes)}</td></tr>
    <tr><td>Roads &amp; wires (${fd.roads}%)</td><td>${f(-dc.roads)}</td></tr>
    <tr><td>Police (${fd.police}%)</td><td>${f(-dc.police)}</td></tr>
    <tr><td>Fire (${fd.fire}%)</td><td>${f(-dc.fire)}</td></tr>
    <tr><td>Education (${fd.edu}%)</td><td>${f(-dc.edu)}</td></tr>
    <tr><td>Health (${fd.health}%)</td><td>${f(-dc.health)}</td></tr>
    <tr><td>Power plants</td><td>${f(-dc.plants)}</td></tr>
    <tr><td>Water system</td><td>${f(-dc.water)}</td></tr>
    <tr><td>Transit (${fd.transit}%)</td><td>${f(-dc.transit)}</td></tr>
    <tr><td>City ordinances</td><td>${f(city.ordinanceBudget().net)}</td></tr>
    <tr><td>Regional power trade</td><td>${f(city.lastBudget.trade || 0)}</td></tr>
    <tr><td>Ports &amp; terminals</td><td>${f(city.portsBudget().net)}</td></tr>
    <tr><td>Bond payments</td><td>${f(-(b.debt || 0))}</td></tr>
    <tr class="total"><td>Net (monthly)</td><td>${f(b.net)}</td></tr>
    <tr><td>Treasury</td><td>${f(Math.round(city.funds))}</td></tr>`;
}

/* ================= City Ordinances (M22) ================= */
// One row per ORDINANCES entry, generated from the registry exactly like the
// toolbar is from TOOLS. Whole row is a <label> (full tap target); locked rows
// (city.tier<minTier) are disabled with an unlock hint, same idiom as a locked
// tool. Rebuilt on open and after every toggle so the live §/mo cells + footer
// net track the current pop/comJobs — even while the sim is paused.
function openOrdinances() { fillOrdList(); showDlg("dlg-ordinances"); }

function fillOrdList() {
  const list = document.getElementById("ord-list");
  const money = (n) => (n < 0 ? "-§" : "§") + Math.abs(n).toLocaleString();
  list.innerHTML = "";
  for (const o of ORDINANCES) {
    const locked = city.tier < o.minTier;
    const on = !!city.ordinances[o.id];
    const row = document.createElement("label");
    row.className = "ord-row" + (locked ? " locked" : "") + (on ? " on" : "");
    // per-month figure: revenue shows as +, cost as - ; 0 for locked rows
    let cell;
    if (locked) {
      cell = `<span class="ord-cost locked">🔒 Unlocks at ${TIERS[o.minTier].name}</span>`;
    } else if (o.revenue) {
      cell = `<span class="ord-cost rev">+${money(o.revenue(city))}/mo</span>`;
    } else {
      cell = `<span class="ord-cost">−${money(o.cost ? o.cost(city) : 0)}/mo</span>`;
    }
    row.innerHTML =
      `<input type="checkbox" class="ord-check"${on ? " checked" : ""}` +
      `${locked ? " disabled" : ""} data-id="${o.id}">` +
      `<span class="ord-icon">${o.icon}</span>` +
      `<span class="ord-text"><b>${o.name}</b><small>${o.blurb}</small></span>` +
      cell;
    list.appendChild(row);
  }
  const ob = city.ordinanceBudget();
  document.getElementById("ord-footer").innerHTML =
    `Net effect on budget: <b>${(ob.net < 0 ? "-§" : "+§")}` +
    `${Math.abs(ob.net).toLocaleString()}/mo</b>`;
}

/* ================= Regional Deals (M27) ================= */
// World-fixed edge labels (0=N,1=E,2=S,3=W) — display only; the model never
// reads cam.r. Rebuilt on open and after every Propose (same on-demand pattern
// as the budget/ordinance dialogs), so the live disposition bar, connection
// lamps and § figures track the current border layout even while paused.
const REGION_EDGE_NAMES = ["North", "East", "South", "West"];
function openRegion() { city.updateConnections(); fillRegion(); showDlg("dlg-region"); }

function fillRegion() {
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const list = document.getElementById("region-list");
  city.updateConnections();
  let html = "";
  for (let e = 0; e < 4; e++) {
    const nb = city.neighbors[e], dl = city.deals[e], cn = city.conn[e];
    const disp = city.disp[e], cap = city.dealCap(e);
    const commuteOpen = cn.road || cn.rail;
    const lamp = (on, icon, name) =>
      `<span class="rg-lamp ${on ? "on" : "off"}">${icon} ${name}</span>`;
    const seg = (mode, label, dis) =>
      `<button class="rg-seg${dl.mode === mode ? " on" : ""}" data-mode="${mode}"${dis ? " disabled" : ""}>${label}</button>`;
    html +=
      `<div class="region-panel" data-edge="${e}">` +
        `<div class="rg-head"><b>${esc(nb.name)}</b>` +
          `<span class="rg-arche">${esc(nb.label)} · ${REGION_EDGE_NAMES[e]} edge</span></div>` +
        `<div class="rg-blurb">${esc(nb.blurb)}</div>` +
        `<div class="rg-prices">Sells power for <b>§${nb.priceSell}/MW</b>, buys at <b>§${nb.priceBuy}/MW</b></div>` +
        `<div class="rg-disp"><span>Relations</span>` +
          `<div class="rg-bar"><i style="width:${disp}%"></i></div><span class="rg-dispnum">${disp}</span></div>` +
        `<div class="rg-conns">${lamp(cn.road, "🛣️", "Road")}${lamp(cn.wire, "⚡", "Wire")}${lamp(cn.rail, "🚉", "Rail")}</div>` +
        `<div class="rg-controls">` +
          `<div class="rg-segbox">${seg(0, "None")}${seg(1, "Sell", !cn.wire)}${seg(2, "Buy", !cn.wire)}</div>` +
          `<label class="rg-mwlbl">MW <input type="number" class="rg-mw" min="0" max="${cap}" ` +
            `value="${dl.mw}"${!cn.wire ? " disabled" : ""}></label>` +
          `<span class="rg-cap">cap ${cap}</span>` +
          `<label class="rg-commlbl"><input type="checkbox" class="rg-commute"${dl.commute ? " checked" : ""}` +
            `${commuteOpen ? "" : " disabled"}> Commuter link</label>` +
          `<button class="btn95 rg-propose"${(!cn.wire && !commuteOpen) ? " disabled" : ""}>Propose</button>` +
        `</div>` +
        `<div class="rg-note"></div>` +
      `</div>`;
  }
  list.innerHTML = html;
}

// Commit the panel's edited controls through city.proposeDeal (deterministic).
// Mirrors the funding-slider live-refresh: on any change write the deal, mark
// power dirty, recompute power + region, and refresh an open budget dialog.
function regionApply(panel) {
  const e = +panel.dataset.edge;
  const segOn = panel.querySelector(".rg-seg.on");
  const mode = segOn ? +segOn.dataset.mode : city.deals[e].mode;
  const mwEl = panel.querySelector(".rg-mw");
  const mw = mwEl ? Math.max(0, mwEl.value | 0) : 0;
  const commute = panel.querySelector(".rg-commute").checked;
  const note = panel.querySelector(".rg-note");
  const ok = city.proposeDeal(e, mode, mw, commute);
  if (!ok) {
    Snd.denied();
    note.textContent = mode !== 0 && !city.conn[e].wire
      ? "Refused — run a power line to this edge first."
      : `Refused — ${mw} MW exceeds the ${city.dealCap(e)} MW cap. Improve relations first.`;
    note.className = "rg-note bad";
    return;
  }
  Snd.click();
  const nb = city.neighbors[e];
  note.textContent = mode === 0 ? "Deal cancelled." :
    mode === 1 ? `Selling ${mw} MW to ${nb.name} for §${mw * nb.priceSell}/mo.` :
    `Buying ${mw} MW from ${nb.name} for §${mw * nb.priceBuy}/mo.`;
  note.className = "rg-note good";
  city.powerDirty = true;
  city.recomputePower();
  city.recomputeRegion();
  fillRegion();
  if (!document.getElementById("dlg-budget").classList.contains("hidden")) fillBudgetTable();
}

/* ================= District Manager (M21) ================= */
// Auto-suggested 1997 neighborhood names, cycled off the existing ST_NAMES
// flavor pool so a fresh district gets instant period character.
const DIST_SUFFIX = ["Heights", "Flats", "Village", "Quarter", "Gardens",
  "Hollow", "Row", "Commons", "Yards", "Terrace", "Point", "Park"];
function suggestDistrictName() {
  const n = city.districts.length;
  return ST_NAMES[n % ST_NAMES.length] + " " + DIST_SUFFIX[n % DIST_SUFFIX.length];
}

// centroid (mean tile) of a district over district[] — used by the Jump button.
// Read-only, O(n); the map-label path keeps its own distRev-cached version.
function districtCentroid(id) {
  let sx = 0, sy = 0, n = 0;
  for (let y = 0; y < MAP; y++) for (let x = 0; x < MAP; x++) {
    if (city.district[y * MAP + x] === id) { sx += x; sy += y; n++; }
  }
  return n ? { x: sx / n, y: sy / n } : null;
}

function openDistricts() { fillDistricts(); showDlg("dlg-districts"); }

// Rebuilt from live state on every open (same on-demand pattern as
// openBudget/openQuery) — never a per-frame or per-tick cost.
function fillDistricts() {
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  // per-district tile counts in one pass
  const cnt = {};
  for (let i = 0; i < city.district.length; i++) {
    const d = city.district[i]; if (d) cnt[d] = (cnt[d] || 0) + 1;
  }
  const list = document.getElementById("dist-list");
  let html = `<div class="dist-row${UI.curDistrict === 0 ? " sel" : ""}" data-id="0">` +
    `<i class="dist-sw" style="background:transparent;border-style:dashed"></i>` +
    `(none / eraser)</div>`;
  for (const d of city.districts) {
    html += `<div class="dist-row${UI.curDistrict === d.id ? " sel" : ""}" data-id="${d.id}">` +
      `<i class="dist-sw" style="background:${DISTRICT_COLS[d.col]}"></i>` +
      `${esc(d.name)} <span class="dim">(${cnt[d.id] || 0} tiles)</span></div>`;
  }
  list.innerHTML = html;
  list.querySelectorAll(".dist-row").forEach((row) => {
    row.addEventListener("click", () => {
      UI.curDistrict = +row.dataset.id;
      Snd.click();
      fillDistricts();
    });
  });
  // button enable/disable states
  const has = UI.curDistrict > 0;
  document.getElementById("dist-new").disabled = city.districts.length >= DIST_MAX;
  for (const b of ["dist-rename", "dist-color", "dist-delete", "dist-jump"])
    document.getElementById(b).disabled = !has;
  // stats panel
  fillDistrictStats();
}

function fillDistrictStats() {
  const tbl = document.getElementById("dist-stats-table");
  if (UI.curDistrict === 0) {
    tbl.innerHTML = `<tr><td class="dim" colspan="2">Eraser selected — paint tiles ` +
      `to clear their district, or pick a neighborhood above to see its report.</td></tr>`;
    return;
  }
  const d = city.districts.find((x) => x.id === UI.curDistrict);
  if (!d) { tbl.innerHTML = ""; return; }
  const s = city.districtStats(UI.curDistrict);
  // land-value mini-bar (0..255 -> % width), echoing the "value" minimap ramp
  const lvPct = Math.round((s.landv / 255) * 100);
  const bar = `<div class="dist-bar"><span style="width:${lvPct}%"></span></div>`;
  const quip = s.tiles === 0 ? "An empty neighborhood — go paint some tiles."
    : s.landv >= 170 ? "Prime real estate, Mayor. The tax base loves you."
    : s.landv <= 60 ? "Rough around the edges. Parks and safety would lift it."
    : "A solid, workaday neighborhood.";
  tbl.innerHTML =
    `<tr><td>Tiles</td><td>${s.tiles} (${s.developed} developed)</td></tr>` +
    `<tr><td>Population</td><td>${s.pop.toLocaleString()}</td></tr>` +
    `<tr><td>Jobs</td><td>${s.jobs.toLocaleString()}</td></tr>` +
    `<tr><td>Dominant zone</td><td>${s.dominant}</td></tr>` +
    `<tr><td>Avg land value</td><td>${bar}${s.landv}</td></tr>` +
    `<tr><td>Avg pollution</td><td>${s.poll}</td></tr>` +
    `<tr><td>Avg crime</td><td>${s.crime}</td></tr>` +
    `<tr><td>Avg traffic</td><td>${s.traffic}</td></tr>` +
    `<tr><td>Powered</td><td>${s.powered}%</td></tr>` +
    `<tr class="total"><td colspan="2" class="dim">${quip}</td></tr>`;
}

function bindDistricts() {
  const dlg = document.getElementById("dlg-districts");
  if (!dlg) return;
  document.getElementById("dist-new").addEventListener("click", () => {
    const inp = document.getElementById("dist-name");
    const name = (inp.value || "").trim() || suggestDistrictName();
    const id = city.newDistrict(name);
    if (!id) { Snd.denied(); setStatus(`⛔ District cap reached (${DIST_MAX}).`); return; }
    Snd.cash(); UI.curDistrict = id; inp.value = "";
    setTool("district");
    fillDistricts();
  });
  document.getElementById("dist-rename").addEventListener("click", () => {
    if (!UI.curDistrict) return;
    const inp = document.getElementById("dist-name");
    const name = (inp.value || "").trim();
    if (!name) { Snd.denied(); setStatus("⛔ Type a name first."); return; }
    city.renameDistrict(UI.curDistrict, name); inp.value = "";
    Snd.click(); fillDistricts();
  });
  document.getElementById("dist-color").addEventListener("click", () => {
    if (!UI.curDistrict) return;
    city.recolorDistrict(UI.curDistrict); Snd.click(); fillDistricts();
  });
  document.getElementById("dist-erase").addEventListener("click", () => {
    UI.curDistrict = 0; Snd.click(); setTool("district"); fillDistricts();
  });
  document.getElementById("dist-delete").addEventListener("click", () => {
    if (!UI.curDistrict) return;
    const id = UI.curDistrict;
    uiConfirm("Delete this district? Its tiles are cleared (buildings stay).", () => {
      city.deleteDistrict(id); UI.curDistrict = 0; Snd.bulldoze(); fillDistricts();
    });
  });
  document.getElementById("dist-jump").addEventListener("click", () => {
    if (!UI.curDistrict) return;
    const c = districtCentroid(UI.curDistrict);
    if (!c) { Snd.denied(); setStatus("⛔ That district has no tiles yet."); return; }
    cam.x = worldX(c.x, c.y); cam.y = worldY(c.x, c.y); clampCam(); Snd.click();
  });
  document.getElementById("dist-paint").addEventListener("click", () => {
    setTool("district"); hideDlg("dlg-districts"); Snd.click();
  });
}

/* --------- municipal bonds panel (M13) --------- */
function setBondNote(msg) { document.getElementById("bond-note").textContent = msg; }

function fillBondPanel() {
  const r = creditRating(city);            // recomputed on demand (pure fn)
  const pct = (x) => (x * 100).toFixed(1) + "%";
  document.getElementById("bond-rating").textContent =
    `Credit rating: ${r.grade} — new bonds offered at ${pct(r.rateOffered)} APR`;
  const tbl = document.getElementById("bond-table");
  if (!city.bonds.length) {
    tbl.innerHTML = `<tr><td>No active bonds — the city is debt-free.</td></tr>`;
  } else {
    tbl.innerHTML = city.bonds.map((b, k) =>
      `<tr><td>§${b.principal.toLocaleString()} @ ${pct(b.rate)}</td>` +
      `<td>${b.remaining} mo left</td>` +
      `<td>§${b.balance.toLocaleString()} owed</td>` +
      `<td><button class="btn95 tiny bond-payoff" data-bond="${k}">Pay Off</button></td></tr>`
    ).join("");
    tbl.querySelectorAll(".bond-payoff").forEach((btn) =>
      btn.addEventListener("click", () => {
        const res = city.payoffBond(+btn.dataset.bond);
        fillBondPanel(); fillBudgetTable();
        if (res.ok) {
          Snd.cash();
          setBondNote(`🏦 Bond retired early — §${res.cost.toLocaleString()} paid ` +
            `(incl. §${res.fee.toLocaleString()} fee).`);
        } else {
          Snd.denied();
          const msg = "⛔ The treasury can't cover that early payoff — request refused.";
          setBondNote(msg);
          city.pushMsg(msg);
        }
      }));
  }
  // at the borrowing cap the issue control visibly refuses (class + note);
  // it stays clickable so the refusal path can announce itself
  const atCap = city.bonds.length >= BOND_MAX;
  const btn = document.getElementById("btn-issue-bond");
  btn.classList.toggle("refused", atCap);
  btn.textContent = atCap
    ? `Bond limit reached (${BOND_MAX} max)`
    : `Issue §${BOND_PRINCIPAL.toLocaleString()} Bond @ ${pct(r.rateOffered)}`;
}

/* --------- City Hall records almanac (M17) --------- */
// Rows are rebuilt from live city state each time the dialog opens — never
// in the frame loop. One row per completed year (city.records) plus the
// current year-to-date row from the live accumulator (city.recCur), whose
// population cell is the live city.pop.
function buildAlmanacRows() {
  const f = (n) => (n < 0 ? "-§" : "§") + Math.abs(n).toLocaleString();
  const row = (r, ytd) =>
    `<tr${ytd ? ' class="alm-ytd"' : ""}><td>${r.year}${ytd ? "* (to date)" : ""}</td>` +
    `<td>${r.pop.toLocaleString()}</td><td>${f(r.taxes)}</td>` +
    `<td>${f(r.net)}</td><td>${r.disasters}</td></tr>`;
  document.getElementById("almanac-table").innerHTML =
    `<tr><th>Year</th><th>Population</th><th>Tax Income</th>` +
    `<th>Net Budget</th><th>Disasters Survived</th></tr>` +
    city.records.map((r) => row(r, false)).join("") +
    row(Object.assign({ pop: city.pop }, city.recCur), true);
}

function openAlmanac() {
  buildAlmanacRows();
  showDlg("dlg-almanac");
}

function openShortcuts() {
  // rows are rebuilt from the live TOOLS array every time — never hand-listed
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const rows = TOOLS.map(t =>
    `<tr><td class="kbd">${esc(t.key)}</td><td>${esc(t.name)}</td></tr>`).join("");
  document.getElementById("shortcuts-table").innerHTML = rows + `
    <tr class="ksep"><td colspan="2">— Controls —</td></tr>
    <tr><td class="kbd">Space</td><td>Pause / resume the sim</td></tr>
    <tr><td class="kbd">Arrow keys</td><td>Pan the map</td></tr>
    <tr><td class="kbd">Q / E</td><td>Rotate the view 90° (also [ / ])</td></tr>
    <tr><td class="kbd">Mouse wheel</td><td>Zoom in / out</td></tr>
    <tr><td class="kbd">Right / middle drag</td><td>Pan the map</td></tr>
    <tr><td class="kbd">Esc</td><td>Close dialogs</td></tr>
    <tr><td class="kbd">F1</td><td>Toggle this window</td></tr>
    <tr><td class="kbd">Click ticker</td><td>Jump to a citizen complaint's trouble spot</td></tr>
    <tr class="ksep"><td colspan="2">— Touch —</td></tr>
    <tr><td class="kbd">Tap / one-finger drag</td><td>Build with the selected tool</td></tr>
    <tr><td class="kbd">Two-finger drag</td><td>Pan the map</td></tr>
    <tr><td class="kbd">Pinch</td><td>Zoom in / out</td></tr>`;
  showDlg("dlg-shortcuts");
}

/* --------- City Graphs (G7r) ---------
   History fills one point per month rollover (collectBudget), so a fresh city
   — and every scenario at boot — opens with < 2 points and used to draw a
   blank white box. Now the sub-2-point case shows a period-flavored "Collecting
   data" card, and once two months exist both series plot over a labeled frame:
   a dark x/y axis, faint quarter gridlines, a min/max value scale down each
   side (green = population on the left, blue = funds on the right) and a month
   axis along the bottom. Each open re-reads city.history, so the plot always
   reflects the current run. */
// Plot frame: left/right value gutters, a thin top and a month-label bottom.
const GR = { PL: 40, PR: 40, PT: 10, PB: 18, PAD: 3 };
// Compact value formatter for the axis gutters (e.g. 20000 -> "20k").
function graphNum(v) {
  v = Math.round(v);
  const a = Math.abs(v);
  if (a >= 10000) return Math.round(v / 1000) + "k";
  if (a >= 1000) return (v / 1000).toFixed(1) + "k";
  return String(v);
}
// M30: pure selector — return a FRESH array of the points to plot for one
// series at one range. It never mutates city.history or city.records.
//   1yr  → last 12 monthly samples of the ring-buffer array
//   10yr → last 120 monthly samples
//   100yr→ the annual almanac (records[]) for pop/net/tax; the diffuse-map
//          indices have no annual store, so they fall back to their full
//          monthly tail and simply render sparse over the wide domain.
function seriesData(desc, range) {
  const h = city.history || {};
  if (range === "100yr") {
    const recs = city.records || [];
    if (desc.key === "pop") return recs.map((r) => r.pop);
    if (desc.key === "net") return recs.map((r) => r.net);
    if (desc.key === "tax") return recs.map((r) => r.taxes);
    return (h[desc.key] || []).slice();          // index series: monthly tail
  }
  const n = range === "1yr" ? 12 : 120;
  const a = h[desc.key] || [];
  return a.slice(Math.max(0, a.length - n));
}

function openGraphs() {
  bindGraphControls();                            // idempotent one-time wiring
  const cv = document.getElementById("graph-canvas");
  const g = cv.getContext("2d");
  const W = cv.width, H = cv.height;
  g.fillStyle = "#fff"; g.fillRect(0, 0, W, H);

  const x0 = GR.PL, x1 = W - GR.PR, y0 = GR.PT, y1 = H - GR.PB;
  const top = y0 + GR.PAD, bot = y1 - GR.PAD; // 0 sits a few px above the axis

  // faint quarter gridlines (kept from the original, boxed into the plot area)
  g.strokeStyle = "#ddd"; g.lineWidth = 1;
  for (let k = 0; k <= 4; k++) {
    const gy = Math.round(y0 + (y1 - y0) * k / 4) + 0.5;
    g.beginPath(); g.moveTo(x0, gy); g.lineTo(x1, gy); g.stroke();
  }
  for (let k = 1; k < 4; k++) {
    const gx = Math.round(x0 + (x1 - x0) * k / 4) + 0.5;
    g.beginPath(); g.moveTo(gx, y0); g.lineTo(gx, y1); g.stroke();
  }

  const range = UI.graphRange;
  // sync the control widgets to the UI state so a programmatic toggle reflects
  syncGraphControls();
  // gather each enabled series' windowed data for the active range
  const enabled = Object.keys(UI.graphSeries)
    .map((id) => ({ id, desc: UI.graphSeries[id] }))
    .filter((s) => s.desc.on)
    .map((s) => ({ id: s.id, desc: s.desc, data: seriesData(s.desc, range) }));
  const maxLen = enabled.reduce((m, s) => Math.max(m, s.data.length), 0);

  // --- empty / low-data state: the ACTIVE range yields too few points to plot
  if (maxLen < 2) {
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillStyle = "#444"; g.font = "bold 13px 'MS Sans Serif',Arial,sans-serif";
    g.fillText("Collecting data —", W / 2, H / 2 - 9);
    g.fillStyle = "#555"; g.font = "11px 'MS Sans Serif',Arial,sans-serif";
    g.fillText("check back in February", W / 2, H / 2 + 9);
    drawGraphLegend(enabled);
    showDlg("dlg-graphs");
    return;
  }

  // trace one series over its own auto-scale-to-frame so 0-255 indices and
  // 5-digit § values coexist. A series with <2 points in this range is skipped
  // (never divides by zero) but still contributes its latest value to legend.
  const plot = (data, color) => {
    if (data.length < 2) return;
    const max = Math.max(...data.map(Math.abs), 1);
    const px = (k) => x0 + 2 + k / (data.length - 1) * (x1 - x0 - 4);
    const py = (v) => Math.max(top, Math.min(bot, bot - (v / max) * (bot - top)));
    g.strokeStyle = color; g.lineWidth = 2; g.beginPath();
    data.forEach((v, k) => (k ? g.lineTo(px(k), py(v)) : g.moveTo(px(k), py(v))));
    g.stroke();
    if (data.length <= 60) { // vertex dots when sparse enough to read
      g.fillStyle = color;
      data.forEach((v, k) => { g.beginPath(); g.arc(px(k), py(v), 2, 0, 7); g.fill(); });
    }
  };
  enabled.forEach((s) => plot(s.data, s.desc.color));

  // strong axes on top of the traces (dark, clearly beyond the #ddd gridlines)
  g.strokeStyle = "#333"; g.lineWidth = 1;
  g.beginPath();
  g.moveTo(x0 + 0.5, y0); g.lineTo(x0 + 0.5, y1);        // y-axis
  g.moveTo(x0, y1 + 0.5); g.lineTo(x1, y1 + 0.5);        // x-axis
  g.stroke();

  // x-axis label along the bottom: the active range + its point span. Each
  // series auto-scales to the frame, so per-series magnitudes live in the
  // legend (below the canvas) rather than a single shared gutter.
  const unit = range === "100yr" ? "yr" : "mo";
  g.fillStyle = "#333"; g.font = "bold 9px 'MS Sans Serif',Arial,sans-serif";
  g.textBaseline = "top";
  g.textAlign = "left"; g.fillText(unit + " 1", x0, y1 + 4);
  g.textAlign = "center";
  g.fillText(range === "100yr" ? "years" : "months", (x0 + x1) / 2, y1 + 4);
  // right-edge span label. At 100yr the annual series (pop/net/tax) store one
  // point per YEAR while the index series (poll/crime/landv) fall back to their
  // MONTHLY tail — so convert each series' point count to its real span before
  // taking the max, else a long monthly index series would caption months as
  // "yr N". 1yr/10yr are uniformly monthly, so maxLen is already in months.
  let spanLabel;
  if (range === "100yr") {
    const yrs = enabled.reduce((m, s) =>
      Math.max(m, s.desc.idx ? s.data.length / 12 : s.data.length), 0);
    spanLabel = "yr " + Math.max(1, Math.round(yrs));
  } else {
    spanLabel = unit + " " + maxLen;
  }
  g.textAlign = "right"; g.fillText(spanLabel, x1, y1 + 4);

  drawGraphLegend(enabled);
  showDlg("dlg-graphs");
}

// M30: render the legend swatches below the canvas, each showing the series'
// latest value in the active range (§ for the flow series, raw index for the
// 0-255 diffuse-map series). Reads only the windowed data already fetched.
function drawGraphLegend(enabled) {
  const el = document.getElementById("graph-legend");
  if (!el) return;
  el.innerHTML = enabled.map((s) => {
    const v = s.data.length ? s.data[s.data.length - 1] : null;
    const val = v == null ? "—"
      : s.desc.idx ? String(Math.round(v))
      : (v < 0 ? "-§" : "§") + graphNum(Math.abs(v));
    return `<span style="color:${s.desc.color}">■ ${s.desc.label}: ${val}</span>`;
  }).join("");
}

// M30: mirror UI.graphSeries.*.on / UI.graphRange onto the checkbox+radio
// widgets (so a programmatic toggle followed by openGraphs() shows correctly).
function syncGraphControls() {
  document.querySelectorAll(".graph-series").forEach((cb) => {
    const d = UI.graphSeries[cb.dataset.series];
    if (d) cb.checked = !!d.on;
  });
  document.querySelectorAll(".graph-range").forEach((r) => {
    r.checked = (r.value === UI.graphRange);
  });
}

// M30: wire the series checkboxes and range radios exactly once. A change sets
// the UI flag (no history touched) and redraws via openGraphs().
let _graphControlsBound = false;
function bindGraphControls() {
  if (_graphControlsBound) return;
  const strip = document.getElementById("graph-series-strip");
  const rstrip = document.getElementById("graph-range-strip");
  if (!strip || !rstrip) return;               // DOM not ready yet — retry next open
  strip.addEventListener("change", (e) => {
    const cb = e.target.closest(".graph-series"); if (!cb) return;
    const d = UI.graphSeries[cb.dataset.series]; if (!d) return;
    d.on = cb.checked;
    openGraphs();
  });
  rstrip.addEventListener("change", (e) => {
    const r = e.target.closest(".graph-range"); if (!r || !r.checked) return;
    UI.graphRange = r.value;
    openGraphs();
  });
  _graphControlsBound = true;
}

// overlay id -> display name (indices are over[] byte values, never renumbered)
const OV_NAMES = ["—", "Road", "Power line", "Residential", "Commercial", "Industrial",
  "Park", "Police station", "Fire station", "Coal plant", "Solar plant", "Rubble",
  "Mayor's House", "Stadium", "School", "Hospital", "Gas plant", "Wind farm",
  "Road + power line", // M26: index 18 = WIREROAD crossing
  "Water pipe", "Water tower", "Water pump", // M24: indices 19/20/21
  // M28: indices 22..28 — arcologies then wonder landmarks
  "Plymouth Arcology", "Forest Arcology", "Darco Arcology", "Launch Arcology",
  "Statue of Liberty", "Eiffel Tower", "Great Pyramid",
  // GQ10: indices 29..31 (the plant age/output row keys on isPlant and is
  // automatic for the nuke)
  "Nuclear plant", "Airport", "Seaport"];

const htmlEsc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/* GP1a: the query dialog is now LIVE. openQuery pins the tile; refreshHUD
   re-renders it every 500 ms while the dialog is visible and clears UI.query
   the moment it closes, so diagnoseTile is never called against a hidden box. */
function openQuery(x, y) {
  UI.query = { x, y, at: 0 };
  renderQuery();
  showDlg("dlg-query");
}

/* GP1a: paint the verdict block. A null verdict (bare grass, water, forest,
   road, wire, pipe, park, rubble…) renders NO box at all. */
function renderVerdict(i) {
  const box = document.getElementById("query-verdict");
  if (!box) return;
  const v = city.diagnoseTile(i);
  if (!v) { box.className = "hidden"; box.innerHTML = ""; return; }
  const head = { crit: "⛔", warn: "⚠️", ok: "✅" }[v.severity] || "";
  const chips = v.evidence.map(e =>
    `<span class="qv-chip">${htmlEsc(e[0])} <b>${htmlEsc(e[1])}</b></span>`).join("");
  box.className = v.severity;
  box.innerHTML =
    `<div class="qv-head">${head} ${htmlEsc(GATE_LABEL[v.code] || v.code)}</div>` +
    `<div class="qv-text">${htmlEsc(v.text)}</div>` +
    `<div class="qv-chips">${chips}</div>`;
}

function renderQuery() {
  if (!UI.query) return;
  // a New/Load City under an open dialog can change MAP: drop the pin rather
  // than read off the end of the new city's arrays
  if (!city.inMap(UI.query.x, UI.query.y)) { UI.query = null; hideDlg("dlg-query"); return; }
  UI.query.at = performance.now();
  // A live re-render must never move the frame the player is reading. The .dlg
  // is centred on its left/top (translate(-50%,-50%)), so ANY size change walks
  // the box — and the OK button with it. Pin the current top-left across the
  // re-render, in the same viewport coordinates the titlebar drag already uses.
  const dlgEl = document.getElementById("dlg-query");
  const pin = dlgEl && !dlgEl.classList.contains("hidden") ? dlgEl.getBoundingClientRect() : null;
  const x = UI.query.x, y = UI.query.y;
  const i = y * MAP + x;
  const terrName = ["Grass", "Water", "Forest"][city.terr[i]];
  const ovName = OV_NAMES[city.over[i]];
  renderVerdict(i);
  // M19: for a power-plant anchor, surface its age and aged output vs nameplate
  let plantRow = "";
  if (isPlant(city.over[i]) && city.anc[i] === i) {
    const a = i, by = city.plantYear[a] || city.year, age = Math.max(0, city.year - by);
    const eff = city.plantEffectiveCap(a), nameplate = POWER_CAP[city.over[a]];
    plantRow = `<tr><td>Plant age</td><td>${age} yr (built ${by})</td></tr>` +
      `<tr><td>Output</td><td>${eff} / ${nameplate} MW${eff < nameplate ? " (aging)" : ""}</td></tr>`;
  }
  // M24: for a water-provider anchor, surface its capacity + whether it is
  // energized (a tower is always on; a pump needs power at its anchor)
  let waterProvRow = "";
  if (isWaterSrc(city.over[i]) && city.anc[i] === i) {
    const t = city.over[i], energized = t === OV.WATERTOWER || city.powered[i];
    waterProvRow = `<tr><td>Water supply</td><td>${energized
      ? "💧 " + WATER_CAP[t] + " tiles" : (t === OV.PUMP ? "off (needs power)" : "off")}</td></tr>`;
  }
  // M28: for a mega-structure anchor, surface what it houses. An arcology shows
  // its fixed residents + jobs (self-powered); a landmark shows its pride radius.
  let megaRow = "";
  if (isMega(city.over[i]) && city.anc[i] === i) {
    const t = city.over[i];
    if (isArco(t))
      megaRow = `<tr><td>Residents</td><td>🏙️ ${ARCO_POP[t].toLocaleString()} (self-powered)</td></tr>` +
        `<tr><td>Jobs</td><td>${ARCO_JOB[t].toLocaleString()}</td></tr>`;
    else
      megaRow = `<tr><td>Landmark</td><td>🗽 pride radius ${LANDMARK_R[t]}</td></tr>`;
  }
  // GP2: for a port anchor, surface the whole economy in the player's terms —
  // read ONCE from city.portRecord(i), the same pure record the sim, the budget
  // and the gate table consume, so the panel can never disagree with them. The
  // § figures are the LIVE MONTHLY RATE, not a stored "earned last month":
  // lastBudget is not serialized, and persisting a per-port earned figure is
  // the one thing that would force a save-format change.
  let portRow = "";
  if (isPort(city.over[i]) && city.anc[i] === i) {
    const r = city.portRecord(i);
    const conn = r.road && r.rail ? "road + rail" : r.rail ? "rail only" : r.road ? "road" : "NONE";
    portRow = `<tr><td>Connection</td><td>${conn}</td></tr>`;
    portRow += r.t === OV.SEAPORT
      ? `<tr><td>Jobs served</td><td>${r.jobs} industrial (radius ${PORT_R[r.t]})</td></tr>` +
        `<tr><td>Freight</td><td>${r.working ? "🚢 §" + r.rev + "/mo" : "§0 (idle)"}</td></tr>`
      : `<tr><td>Passengers</td><td>${r.working ? r.pax + "/mo" : "0 (idle)"}</td></tr>` +
        `<tr><td>Tourism</td><td>${r.working ? "✈️ §" + r.rev + "/mo" : "§0 (idle)"}</td></tr>` +
        `<tr><td>Approach</td><td>runs east-west</td></tr>`;
    portRow += `<tr><td>Upkeep</td><td>${r.working ? "§" + r.cost + "/mo" : "§0 (idle)"}</td></tr>` +
      `<tr><td>Status</td><td>${r.working ? "working"
        : !r.powered ? "no power" : "no road or rail"}</td></tr>`;
  }
  // M25: transit rows. A rail tile names its feature; a station also shows its
  // line number, station count, open/needs-2/no-power status, and diverted trips.
  // A "Transit access" row on ANY tile surfaces railCov so the player learns why
  // a nearby zone is (or isn't) relieved.
  let transitRow = "";
  if (city.rail[i] !== RL.NONE) {
    const kind = city.rail[i] === RL.TRACK ? "Surface rail"
      : city.rail[i] === RL.SUB ? "Subway" : "Station";
    transitRow = `<tr><td>Transit</td><td>${kind}</td></tr>`;
    if (city.rail[i] === RL.STATION) {
      const net = city.railNet[i];
      let stations = 0;
      for (let k = 0; k < city.rail.length; k++)
        if (city.rail[k] === RL.STATION && city.railNet[k] === net) stations++;
      const status = city.stationLive[i] ? "open"
        : stations < 2 ? "needs 2 stations" : "no power";
      transitRow += `<tr><td>Line</td><td>#${net + 1} (${stations} station${stations === 1 ? "" : "s"})</td></tr>` +
        `<tr><td>Status</td><td>${status}</td></tr>` +
        `<tr><td>Riders</td><td>~${Math.round(city.railRiders)} trips/mo off roads</td></tr>`;
    }
  }
  const transitAccessRow = `<tr><td>Transit access</td><td>${city.railCov[i]}</td></tr>`;
  document.getElementById("query-table").innerHTML = `
    <tr><td>Tile</td><td>${x}, ${y}</td></tr>
    <tr><td>Terrain</td><td>${terrName}</td></tr>
    <tr><td>Zone/Building</td><td>${ovName}${city.lvl[i] ? " (level " + city.lvl[i] + ")" : ""}</td></tr>
    ${plantRow}
    ${waterProvRow}
    ${megaRow}
    ${portRow}
    ${transitRow}
    <tr><td>Powered</td><td>${city.powered[i] ? "⚡ yes" : "no"}</td></tr>
    ${transitAccessRow}
    <tr><td>Water</td><td>${city.watered[i] ? "💧 yes" : "no"}</td></tr>
    <tr><td>Road access</td><td>${city.access[i] ? "yes" : "no"}</td></tr>
    <tr><td>Land value</td><td>${city.landv[i]}</td></tr>
    <tr><td>Traffic</td><td>${(city.over[i] === OV.ROAD || city.over[i] === OV.WIREROAD) ? city.traffic[i] : "—"}</td></tr>
    <tr><td>Pollution</td><td>${city.poll[i]}</td></tr>
    <tr><td>Crime</td><td>${city.crime[i]}</td></tr>
    <tr><td>Education</td><td>${city.eduCov[i]}</td></tr>
    <tr><td>Health</td><td>${city.medCov[i]}</td></tr>`;

  if (pin) {
    const now = dlgEl.getBoundingClientRect();
    if (now.width !== pin.width || now.height !== pin.height) {
      dlgEl.style.left = (pin.left + now.width / 2) + "px";
      dlgEl.style.top = (pin.top + now.height / 2) + "px";
    }
  }
}

/* --------- GP1a: RCI decomposition --------- */
function openRCI() { UI.rciAt = -1; renderRCI(); showDlg("dlg-rci"); }

function renderRCI() {
  UI.rciAt = performance.now();
  const sgn = (v) => (v >= 0 ? "+" : "") + v.toFixed(3);
  document.getElementById("rci-breakdown").innerHTML = city.demandBreakdown().map(b =>
    `<div class="rci-bd"><h4>${htmlEsc(b.label)} — ${sgn(b.value)}</h4><table>` +
    b.parts.map(p =>
      `<tr><td>${htmlEsc(p[0])}</td><td class="${p[1] >= 0 ? "pos" : "neg"}">${sgn(p[1])}</td></tr>`).join("") +
    `<tr class="total"><td>Sum</td><td>${sgn(b.raw)}</td></tr></table>` +
    (b.clamped ? `<div class="clamped">⚠️ pinned by the −1…+1 clamp — more of the same changes nothing</div>` : "") +
    `</div>`).join("");
}

/* --------- "Traffic on the 5s" chopper report (M18) --------- */
// Deterministic 90s intersection namer: a PURE function of tile coords —
// two cross streets joined by " & " (e.g. "5th & Grunge Ave"). The same
// (x, y) yields the same string on every call and every page reload; there
// is no Math.random (and no other state) anywhere in it.
const ST_ORD = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th",
  "9th", "10th", "11th", "12th", "13th", "14th", "15th", "16th"];
const ST_NAMES = ["Grunge", "Modem", "Pager", "Tamagotchi", "Frisbee", "Zima",
  "Flannel", "Dialup", "Beanie", "Cassette", "Winsock", "Macarena",
  "Slacker", "Discman", "Hubcap", "Pog"];
const ST_SUFFIX = ["St", "Ave", "Blvd", "Dr", "Pkwy", "Ln"];
function streetNameFor(x, y) {
  const a = ST_ORD[x % ST_ORD.length];
  const b = ST_NAMES[(y * 5 + x * 3) % ST_NAMES.length] + " " +
            ST_SUFFIX[(x + y * 2) % ST_SUFFIX.length];
  return a + " & " + b;
}

// Report inclusion rule (documented): every ROAD tile whose LIVE congestion
// city.traffic[i] >= TRAFFIC_REPORT_MIN qualifies; the report lists the
// worst TRAFFIC_REPORT_N of them, sorted non-increasing by congestion — so
// whenever >= 3 tiles qualify at least 3 rows show, and row #1 always
// carries the map-maximum traffic value. Rows are rebuilt from live city
// state on every open (this full scan runs at open time only, never in the
// frame loop), each carrying data-x/data-y plus a Jump button that centers
// the camera on its hotspot.
const TRAFFIC_REPORT_MIN = 80; // congestion worth reading on air
const TRAFFIC_REPORT_N = 5;    // rows shown, at most

function openTrafficReport() {
  const cand = [];
  for (let i = 0; i < city.over.length; i++)
    if ((city.over[i] === OV.ROAD || city.over[i] === OV.WIREROAD) && city.traffic[i] >= TRAFFIC_REPORT_MIN) // M26
      cand.push(i);
  cand.sort((a, b) => city.traffic[b] - city.traffic[a]);
  const top = cand.slice(0, TRAFFIC_REPORT_N);
  const tbl = document.getElementById("traffic-table");
  tbl.innerHTML = top.length
    ? `<tr><th>#</th><th>Intersection</th><th>Congestion</th><th></th></tr>` +
      top.map((i, k) => {
        const x = i % MAP, y = (i / MAP) | 0;
        return `<tr data-x="${x}" data-y="${y}"><td>${k + 1}</td>` +
          `<td>${streetNameFor(x, y)}</td><td>${city.traffic[i]}</td>` +
          `<td><button class="btn95 tiny traffic-jump" data-x="${x}" data-y="${y}">` +
          `Jump</button></td></tr>`;
      }).join("")
    : `<tr><td>Light traffic citywide — Chip has nothing to report. Back to you!</td></tr>`;
  tbl.querySelectorAll(".traffic-jump").forEach((b) =>
    b.addEventListener("click", () => {
      Snd.click();
      cam.x = worldX(+b.dataset.x, +b.dataset.y);
      cam.y = worldY(+b.dataset.x, +b.dataset.y);
      clampCam();
      setStatus(`🚁 Chip pans the camera to ${streetNameFor(+b.dataset.x, +b.dataset.y)}.`);
    }));
  showDlg("dlg-traffic");
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
  const unlocks = TOOLS.filter(x => x.minTier === k).map(x => x.name)
    // M22: newly unlocked ordinances share the promotion headline's unlock line
    .concat(ORDINANCES.filter(o => o.minTier === k).map(o => o.name + " ordinance"));
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

// M7 time-capsule events: dated editions reuse the same Bugle front page
function showEventPaper(ed) {
  document.getElementById("np-date").textContent =
    `${MONTHS[city.month]} ${city.year} — Pop. ${city.pop.toLocaleString()}`;
  document.getElementById("np-headline").textContent = ed.headline;
  document.getElementById("np-sub").textContent = ed.sub || "";
  document.getElementById("np-body").textContent = ed.body || "";
  showDlg("dlg-news");
  Snd.fanfare();
}

// called every frame from the main loop: pop pending editions one at a time.
// queue entries are tier indices (M2 promotions) or event editions (M7).
function newsFrame() {
  if (!city || !city.newsQueue || !city.newsQueue.length) return;
  const dlg = document.getElementById("dlg-news");
  if (!dlg.classList.contains("hidden")) return; // wait for current one to be read
  const ed = city.newsQueue.shift();
  if (typeof ed === "number") showNewspaper(ed);
  else showEventPaper(ed);
}

/* ================= ticker ================= */
// A crawl item is either a plain string (news wires, civic notices) or a
// structured citizen complaint {complaint:true, kind, name, x, y, text} from
// scanComplaints() (M17). Complaints crawl with a pointer cursor + underline
// (the #ticker.complaint class) and clicking the ticker while one is active
// jumps the camera to the offending tile; plain items are never clickable.
const ticker = { queue: [], x: 0, current: "Welcome to 1997, Mayor. The city awaits." };

function tickerText(item) { return typeof item === "string" ? item : item.text; }
function tickerIsComplaint(item) {
  return !!(item && typeof item === "object" && item.complaint);
}

function bindTicker() {
  document.getElementById("ticker").addEventListener("click", () => {
    const c = ticker.current;
    if (!tickerIsComplaint(c)) return;   // plain wires aren't clickable
    cam.x = worldX(c.x, c.y);
    cam.y = worldY(c.x, c.y);
    clampCam();
    setStatus(`📠 Jumped to ${c.name}'s trouble spot (${c.x}, ${c.y}).`);
  });
}

function tickerFeed() {
  // while paused the crawl keeps moving but never consumes city.messages —
  // a paused mayor shouldn't miss queued civic notices (M13)
  if (UI.speed === 0)
    return NEWS_GENERIC[(Math.random() * NEWS_GENERIC.length) | 0];
  // city messages take priority
  if (city.messages.length) return city.messages.shift();
  // seasonal wires (M12): winter / summer color, gated purely by the month
  const season = seasonOf(city.month);
  if (season === "winter" && Math.random() < 0.35)
    return NEWS_WINTER[(Math.random() * NEWS_WINTER.length) | 0];
  if (season === "summer" && Math.random() < 0.35)
    return NEWS_SUMMER[(Math.random() * NEWS_SUMMER.length) | 0];
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
  host.classList.toggle("complaint", tickerIsComplaint(ticker.current));
  el.textContent = tickerText(ticker.current);
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
  document.getElementById("v-water").textContent =
    `${city.waterSupply}/${city.waterDemand}`; // M24: supply/demand tiles
  const approval = Math.max(5, Math.min(98,
    70 - city.taxRate * 2.4 + (city.demand.r > 0 ? 10 : -8) | 0));
  document.getElementById("v-approval").textContent = city.pop ? approval + "%" : "—";
  document.getElementById("city-title").textContent =
    `SimCity 99 — ${city.cityName} [${TIERS[city.tier].name}], ${MONTHS[city.month]} ${city.year}`;

  const setBar = (id, v) => {
    const el = document.getElementById(id);
    const half = 29; // px from midline
    // G8: any nonzero demand draws at least a 3px bar on its side of the
    // zero line — a whisper of demand no longer renders as a blank track
    const h = v === 0 ? 0 : Math.max(3, Math.abs(v) * half);
    el.style.height = h + "px";
    if (v >= 0) { el.style.bottom = "50%"; el.style.top = "auto"; }
    else { el.style.top = "50%"; el.style.bottom = "auto"; }
  };
  setBar("rci-r", city.demand.r);
  setBar("rci-c", city.demand.c);
  setBar("rci-i", city.demand.i);

  gp1aHUD();

  // scenario progress cell (M9) — hidden & empty in free play
  if (typeof scenarioHUD === "function") scenarioHUD();
}

/* ================= GP1a HUD: hover readout, drag meter, live dialogs =======
   All four surfaces ride the ONE refreshHUD call main.js already makes per rAF
   — no timers, nothing that could leak across newCity/loadCity. Every read is
   gated so a closed dialog and a parked mouse cost exactly zero diagnoseTile
   calls, and the hover verdict is memoized per (tile, tickCount) so a per-pixel
   mousemove pays at most ONE walk per sim tick. */
let hoverMemo = { key: "", text: "", city: null };

function hoverReadout() {
  const h = UI.hover;
  // nothing to read: drop the memo too, so the pointer leaving the map never
  // leaves this closure holding the last City's typed arrays alive
  if (!h || !city.inMap(h.x, h.y)) {
    if (hoverMemo.city) hoverMemo = { key: "", text: "", city: null };
    return "";
  }
  const i = h.y * MAP + h.x;
  const key = i + ":" + city.tickCount;
  // the city identity is part of the key: New/Load City can land on the same
  // tickCount and must never serve a verdict computed against the old world
  if (hoverMemo.key === key && hoverMemo.city === city) return hoverMemo.text;
  const ov = city.over[i];
  const what = ov ? OV_NAMES[ov] : ["Grass", "Water", "Forest"][city.terr[i]];
  const lvl = city.lvl[i] ? ` L${city.lvl[i]}` : "";
  const v = city.diagnoseTile(i);
  const mark = v ? ({ crit: "⛔", warn: "⚠️", ok: "✅" }[v.severity] || "") + " " + (GATE_LABEL[v.code] || v.code) : "";
  const text = `(${h.x}, ${h.y}) ${what}${lvl}${mark ? " — " + mark : ""}`;
  hoverMemo = { key, text, city };
  return text;
}

function gp1aHUD() {
  const now = performance.now();

  // 1. transient status TTL — restore the idle line once a message has expired
  if (UI.status && now >= UI.status.until) {
    UI.status = null;
    document.getElementById("sb-tool").textContent = idleStatusLine();
  }

  // 2. drag-cost preview — expires so it can never describe a finished drag on
  //    a city that has since been replaced
  const d = UI.drag;
  if (!d.active && d.until && now >= d.until) dragMeterClear();
  const dTxt = d.count || d.blocked
    ? `Drag ${d.count} tile${d.count === 1 ? "" : "s"} §${Math.round(d.spent).toLocaleString()}` +
      (d.short ? ` ⚠ §${Math.round(d.short).toLocaleString()} short` : "")
    : "";
  const dEl = document.getElementById("sb-drag");
  if (dEl && dEl.textContent !== dTxt) dEl.textContent = dTxt;

  // 3. live tile readout in its OWN cell (never #sb-tool). While the drag meter
  //    is up it stands down: the running total is the story mid-drag, and two
  //    mouse-driven cells at once would squeeze the message field on a narrow
  //    screen. At most ONE of the two ever occupies the bar.
  const hv = dTxt ? "" : hoverReadout();
  const hEl = document.getElementById("sb-hover");
  if (hEl && hEl.textContent !== hv) hEl.textContent = hv;

  // 4. the two live dialogs, each gated on its own visibility
  const q = document.getElementById("dlg-query");
  if (q && !q.classList.contains("hidden")) {
    if (UI.query && now - UI.query.at >= 500) renderQuery();
  } else if (UI.query) {
    UI.query = null; // closed: stop diagnosing entirely
  }
  const r = document.getElementById("dlg-rci");
  if (r && !r.classList.contains("hidden")) {
    if (UI.rciAt < 0 || now - UI.rciAt >= 500) renderRCI();
  } else if (UI.rciAt >= 0) {
    UI.rciAt = -1;
  }
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
    chopperClear(); // the chopper (M18) is never saved — no stale flyovers
    dragMeterClear(); // GP1a: last city's drag totals mean nothing here
    zoomAnim.active = false; // GQ11: never ease toward a stale pre-load anchor
    clampCam(); // a save may be a different map size than the last camera spot (M11)
    setStatus("City loaded. Welcome back, Mayor.");
    return true;
  } catch (e) { setStatus("Load failed: " + e.message); return false; }
}

function newCity() {
  // consume exactly the seed + size the splash picker is previewing (M11)
  city = new City(PICKER.seed, PICKER.size);
  chopperClear(); // presentation state (M18) never crosses into a new city
  dragMeterClear(); // GP1a: never advertise a spend from the city just replaced
  const names = ["Llamaville", "Port Modem", "Beanieburg", "Dialup Falls",
    "Pixel Heights", "Cassette Creek", "Winsock City", "Grungetown"];
  city.cityName = names[(Math.random() * names.length) | 0];
  zoomAnim.active = false; // GQ11: fresh city, fresh camera — no stale ease
  cam.x = 0; cam.y = MAP * HH; cam.z = 1; cam.r = 0; // M32a: reset view rotation
  UI.prefs.viewRot = 0; savePrefs();
  city.pushMsg(`🏗️ ${city.cityName} founded, January 1997. Taxes low, hopes high.`);
  PICKER.seed = (Math.random() * 1e9) | 0; // the next city gets a fresh roll
  pickerPreview();
}
