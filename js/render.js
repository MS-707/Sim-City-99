/* ============ SimCity 99 — isometric renderer ============ */
"use strict";

const cam = { x: 0, y: 0, z: 1, r: 0 };   // world-space center + zoom + view rotation (M32a: r∈{0,1,2,3}, 90° CCW steps)
let cvs, ctx, frame = 0;
// GQ11: DPR-aware backing store. RS is the global render scale (device px per
// CSS px), VW/VH the viewport size in CSS px. Every raster entry point sets a
// setTransform(RS,0,0,RS,0,0) base transform and ALL view math downstream runs
// unchanged in CSS-pixel space — so at RS=1 every frame is byte-identical to
// the pre-GQ11 build by construction, while at DPR 2 vector work (shadows,
// bridge cables, labels, cursor, cars) rasterizes at true device resolution
// and the nearest-neighbor sprite upscale stays hard-edged.
let RS = 1, VW = 0, VH = 0;
const smoke = [];                    // {x, y, age, drift, fire}
const SMOKE_MAX = 200;               // shared puff budget (G16)
const cars = [];                     // {id, x, y, fx, fy, tx, ty, p, spd, col}
let carSeq = 0;
const CAR_COLS = ["#e34a4a", "#4a8fe3", "#e8e8ee", "#f2c53a", "#57c957", "#b06fe0"];

// G16: the car pool cap scales with map AREA — an 80x80 city fields ~80 cars,
// a 128x128 fields 200+, so a big map looks as busy as it is. Clamped so a
// 128 map can't spawn thousands. (HEAD used a flat Math.min(70, …) regardless
// of size, leaving large maps looking empty.)
const carCap = () => Math.min(260, Math.round(MAP * MAP / 80));

// G16: two iso-oriented car body sprites (one per road axis) baked once per
// color, plus a per-frame queue of night head/tail lights. Cars used to be
// axis-aligned 7x4/5x3 fillRects that read wrong on the diagonal streets and
// went dark at night; now each body is an iso parallelogram aligned to its
// travel axis, and after dusk it queues a warm headlight cone + red taillight
// that flush additively with the G2 night-light layer.
const carSprites = { x: null, y: null }; // carSprites[axis][colorIndex]
const carLightQ = [];                    // {x, y, fx, fy} world-space, per frame

// build the 6-color x 2-axis body sheet on first use (like drawChar's cache).
// A car is a small ground-plane quad (iso, so its long edge runs along the
// road's tile axis) with a raised body + glass cabin, so it reads as a little
// 3D vehicle pointing down the street rather than a flat rectangle.
function buildCarSprites() {
  const OX = 15, OY = 15, W = 30, H = 22;   // anchor = ground center
  const lighten = (hex) => {
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    const f = (v) => Math.min(255, v + 60);
    return `rgb(${f(r)},${f(g)},${f(b)})`;
  };
  const bake = (col, axis) => {
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const g = c.getContext("2d");
    // iso quad: length along the road tile axis (hl), width across it (hw)
    const hl = 0.30, hw = 0.14;
    const quad = (elev, scl) => {
      const L = hl * scl, Wd = hw * scl;
      const pts = axis === "x"
        ? [[L, Wd], [L, -Wd], [-L, -Wd], [-L, Wd]]   // long edge along +x
        : [[Wd, L], [-Wd, L], [-Wd, -L], [Wd, -L]];  // long edge along +y
      g.beginPath();
      for (let k = 0; k < 4; k++) {
        const dx = pts[k][0], dy = pts[k][1];
        const X = OX + (dx - dy) * HW, Y = OY + (dx + dy) * HH - elev;
        k ? g.lineTo(X, Y) : g.moveTo(X, Y);
      }
      g.closePath();
    };
    quad(0, 1.2); g.fillStyle = "rgba(8,8,14,0.5)"; g.fill();   // ground shadow
    quad(4, 1.0); g.fillStyle = col; g.fill();                  // raised body
    quad(6, 0.55); g.fillStyle = lighten(col); g.fill();        // cabin roof
    quad(6.5, 0.28); g.fillStyle = "rgba(210,235,255,0.85)"; g.fill(); // glass
    return { c, ox: OX, oy: OY };
  };
  carSprites.x = CAR_COLS.map((c) => bake(c, "x"));
  carSprites.y = CAR_COLS.map((c) => bake(c, "y"));
}

/* ---------------- GP4b: phase-driven metro trains ----------------
   Pure presentation, the cars/chopper pool policy: state lives HERE, is
   NEVER serialized, and resets on city identity change. The MODEL is fully
   deterministic and world-space — ZERO Math.random, ZERO city.rng/rngHash,
   ZERO city writes, and it NEVER reads cam (cam.r applies only at draw, the
   M32a discipline) — so two same-seed runs are pixel-identical and the sim
   stays byte-identical to a trainless build.
   Per TICK (memo key terrRev|devRev|tickCount — one O(n) ascending scan, a
   strictly cheaper class than updateCars' per-FRAME road scan): group rail
   tiles by city.railNet id and, for each net with >= 2 live stations, build
   a CLOSED EULER TOUR over the net's spanning tree — DFS from the net's
   LOWEST tile index (recomputeRail's ascending discipline), neighbors probed
   in fixed N,E,S,W order (railMask bit order), pushing the tile on entry and
   again after each child returns — out-and-back, so consecutive tour entries
   are always 4-adjacent and branches/dead-ends are handled with no RNG.
   riders = Σ railCov over the net's live station tiles (deterministic;
   reflects station count and transit funding), scaling speed and consist
   count per line.
   Per FRAME: trainClock advances by uiState.speed (speed 0 = frozen but
   still drawn — the updateCars pause idiom) and every unit resolves to a
   fractional world position bucketed by OWNER TILE into trainQ; the painter
   loop's RL.TRACK/RL.STATION slots draw their own tile's units, so occlusion
   (a building on a nearer s = u+v diagonal paints over the train) holds by
   construction. No nightAdd/nightPunch/carLightQ entries — the G1/G2 night
   layer stays byte-identical. */
const TRAIN_CARS = 3;        // units per consist: loco + 2 boxcars
const TRAIN_GAP = 0.62;      // spacing between consecutive units, tiles
const TRAIN_SPD0 = 0.035;    // base line speed, tiles/frame
const TRAIN_EXTRA = 900;     // riders threshold: a second train joins the line
const TRAIN_EXTRA2 = 2400;   // riders threshold: a third train
let trainClock = 0;                                     // Σ speed, frames
const trainMemo = { city: null, key: "", lines: [] };   // per-tick tour memo
const trainQ = new Map();                               // ownerTile -> units, per frame
let trainStats = { lines: 0, trains: 0, perLine: [] };  // aliveness slot (O(1) reads)

function computeTrains(city, speed) {
  const key = `${city.terrRev}|${city.devRev}|${city.tickCount}`;
  if (trainMemo.city !== city || trainMemo.key !== key) {
    if (trainMemo.city !== city) trainClock = 0; // newCity/loadCity: pool reset
    trainMemo.city = city; trainMemo.key = key;
    const lines = trainMemo.lines;
    lines.length = 0;
    const n = city.rail.length;
    // one ascending scan: per-net lowest tile, live-station count, ridership
    const low = [], live = [], riders = [];
    for (let i = 0; i < n; i++) {
      const net = city.railNet[i];
      if (net < 0) continue;
      if (low[net] === undefined) { low[net] = i; live[net] = 0; riders[net] = 0; }
      if (city.rail[i] === RL.STATION && city.stationLive[i]) {
        live[net]++; riders[net] += city.railCov[i];
      }
    }
    const seen = new Uint8Array(n); // rebuild-local; every rail tile is in one net
    for (let net = 0; net < low.length; net++) {
      if (low[net] === undefined || live[net] < 2) continue;
      // closed Euler tour: iterative DFS (explicit stack — a 128-map line can
      // run thousands of tiles), tile pushed on entry and after each child
      const tour = [low[net]];
      const stack = [low[net]], cur = [0];
      seen[low[net]] = 1;
      while (stack.length) {
        const c = stack[stack.length - 1];
        const k = cur[cur.length - 1]++;
        if (k >= 4) {
          stack.pop(); cur.pop();
          if (stack.length) tour.push(stack[stack.length - 1]);
          continue;
        }
        const x = c % MAP, y = (c / MAP) | 0;
        const X = k === 1 ? x + 1 : k === 3 ? x - 1 : x;  // N,E,S,W probe order
        const Y = k === 0 ? y - 1 : k === 2 ? y + 1 : y;
        if (X < 0 || Y < 0 || X >= MAP || Y >= MAP) continue;
        const j = Y * MAP + X;
        if (seen[j] || city.rail[j] === RL.NONE) continue;
        seen[j] = 1; tour.push(j);
        stack.push(j); cur.push(0);
      }
      tour.pop(); // drop the final root duplicate — the wrap seg closes the loop
      if (tour.length < 2) continue;
      const rid = riders[net];
      lines.push({
        tour, tourLen: tour.length, riders: rid, netIdx: net,
        // strictly increasing in riders up to the 1200 cap
        spd: TRAIN_SPD0 * (0.75 + 0.5 * Math.min(1, rid / 1200)),
        // 1..3 consists by ridership, never more than the tour can space out
        nTrains: Math.min(1 + (rid >= TRAIN_EXTRA ? 1 : 0) + (rid >= TRAIN_EXTRA2 ? 1 : 0),
                          Math.max(1, (tour.length / 8) | 0)),
      });
    }
    trainStats.lines = lines.length;
    trainStats.perLine = lines.map((l) => ({ riders: l.riders, spd: l.spd, nTrains: l.nTrains }));
  }
  // per frame: resolve every unit to a world position, bucketed by owner tile
  trainClock += speed;
  trainQ.clear();
  let heads = 0;
  for (const l of trainMemo.lines) {
    for (let t = 0; t < l.nTrains; t++) {
      const headPhase = (trainClock * l.spd + t * l.tourLen / l.nTrains) % l.tourLen;
      for (let u = 0; u < TRAIN_CARS; u++) {
        let ph = (headPhase - u * TRAIN_GAP) % l.tourLen;
        if (ph < 0) ph += l.tourLen;
        const seg = ph | 0;
        let f = ph - seg;
        const L = l.tourLen;
        const a = l.tour[seg], b = l.tour[(seg + 1) % L];
        if (city.rail[a] === RL.SUB && city.rail[b] === RL.SUB) continue; // underground
        // terminal fold remap (panel fix): at a dead-end stub the raw
        // interpolation drives the unit CENTER onto the last tile's center,
        // so the loco nose (hl 0.40) overhangs ~0.4 tile past the stub tip
        // onto bare terrain. b is a fold when the tour immediately bounces
        // back (next === a); a is a fold when we just bounced there
        // (prev === b) — wrap indices cover a root terminal. Compressing the
        // two fold segments to [0, 0.6] / [0.4, 1] keeps the center 0.4 tile
        // shy of the terminal center (nose stops exactly at the stub tip)
        // and eases in/out at 60% speed like a braking train. A continuous
        // monotone function of ph alone — zero state, zero RNG.
        const lo = l.tour[(seg - 1 + L) % L] === b ? 0.4 : 0;
        const hi = l.tour[(seg + 2) % L] === a ? 0.6 : 1;
        f = lo + (hi - lo) * f;
        const xa = a % MAP, ya = (a / MAP) | 0, xb = b % MAP, yb = (b / MAP) | 0;
        const owner = f < 0.5 ? a : b; // the tile whose painter slot draws it
        let q = trainQ.get(owner);
        if (!q) { q = []; trainQ.set(owner, q); }
        q.push({ x: xa + (xb - xa) * f, y: ya + (yb - ya) * f,
                 dx: xb - xa, dy: yb - ya, kind: u ? 1 : 0 });
        if (u === 0) heads++;
      }
    }
  }
  trainStats.trains = heads;
}

// draw the units owned by tile i, inside i's OWN painter slot (never
// post-loop like cars — that is what makes occlusion hold by construction).
// Fractional worldX/worldY projection (rot() is linear — the GQ4 street-tree
// / GQ9 bridge idiom) makes all 4 rotations free; the body-axis pick rotates
// the travel delta into view space exactly like the M32a car idiom.
function drawTrainsAt(city, i) {
  const q = trainQ.get(i);
  if (!q) return;
  for (let k = 0; k < q.length; k++) {
    const u = q[k];
    const wx = worldX(u.x, u.y), wy = worldY(u.x, u.y);
    const r0 = rot(0, 0, cam.r), r1 = rot(u.dx, u.dy, cam.r); // linear part only
    const spr = SPR.train[r1.u - r0.u !== 0 ? "x" : "y"][u.kind];
    ctx.drawImage(spr.c, wx - spr.ox, wy - spr.oy);
  }
}

function renderInit(canvas) {
  cvs = canvas;
  ctx = canvas.getContext("2d");
  const fit = () => {
    const r = cvs.parentElement.getBoundingClientRect();
    // GQ11: view math stays in CSS px (VW/VH); only the backing store scales
    // by the devicePixelRatio. #game is position:absolute inset:0, so layout
    // size is CSS-driven — no style.width/height writes needed. A cross-
    // monitor DPR change fires resize, re-running this fit.
    VW = Math.max(64, r.width | 0);
    VH = Math.max(64, r.height | 0);
    RS = Math.max(1, window.devicePixelRatio || 1);
    cvs.width = Math.round(VW * RS);
    cvs.height = Math.round(VH * RS);
    // pin the CSS box to the CSS-px size the backing store was derived from,
    // so device px map 1:1 even when the parent rect lands on a fraction
    cvs.style.width = VW + "px";
    cvs.style.height = VH + "px";
  };
  fit();
  window.addEventListener("resize", fit);
  cam.x = 0; cam.y = MAP * HH; // middle of the map
}

// ---- M32a view-rotation core ----
// rot() remaps a logical tile (x,y) into "view space" (u,v) for the active
// 90° camera rotation, BEFORE the fixed iso projection; unrot() is its exact
// inverse. r===0 is an arithmetic-free identity early-return, so the r=0 path
// is byte-identical to HEAD by construction. N = MAP (map is square). rot4()
// is the matching 4-bit cyclic rotate for autotile mask lookups. Its ROR
// direction (m>>r | m<<(4-r)) is DERIVED to agree with rot()/unrot(): a road
// arm toward world-N (mask bit0=NE screen edge at r=0) must select the sprite
// arm at the screen edge world-N projects to after rotation — empirically NW
// (sprite bit3) at r=1, which is exactly ROR. rol would send it to SE (wrong).
const rot = (x, y, r) => r === 0 ? { u: x, v: y }
  : r === 1 ? { u: y, v: MAP - 1 - x }
  : r === 2 ? { u: MAP - 1 - x, v: MAP - 1 - y }
  : { u: MAP - 1 - y, v: x };
const unrot = (u, v, r) => r === 0 ? { x: u, y: v }
  : r === 1 ? { x: MAP - 1 - v, y: u }
  : r === 2 ? { x: MAP - 1 - u, y: MAP - 1 - v }
  : { x: v, y: MAP - 1 - u };
const rot4 = (m, r) => r === 0 ? m : ((m >> r) | (m << (4 - r))) & 15;

const worldX = (x, y) => { const p = rot(x, y, cam.r); return (p.u - p.v) * HW; };
const worldY = (x, y) => { const p = rot(x, y, cam.r); return (p.u + p.v) * HH + HH; };

/* ---------------- day/night cycle (M10) ---------------- */
// One in-game day spans the 24-tick month: hour = tickCount % 24, midnight on
// the month boundary, noon at hour 12. Both functions are pure in sim time —
// equal tickCount values always produce identical lighting, and the phase
// advances by itself as the sim ticks.
const NIGHT_TINT = "#191826";     // GQ1: warmer, less-saturated slate dusk (S~0.19)
                                  // so warm facade/window accents survive the wash
                                  // and the day/night mean-S ratio clears 1.4
const NIGHT_MAX_ALPHA = 0.53;     // G1: lerp facades ~53% toward the tint at deepest
                                  // night instead of covering them — silhouettes,
                                  // roof diamonds and zone colors stay readable
const NIGHT_LIGHT_ALPHA = 0.7;    // G1: clamp on the additive night-light pass —
                                  // baked glows never blit at full alpha
const NIGHT_MAX_DRAWS = 700;      // per-frame cap on night-light sprite draws

/* ---- building cast-shadows (GQ8) ---- */
const SHADOW_ALPHA = 0.20;        // composite alpha of the whole shadow layer —
                                  // family-consistent with the G13 tree grounding
                                  // ellipse (0.16) and the car ground quad (0.5)
const SHADOW_LEN = 0.35;          // δ = SHADOW_LEN * effective art height (px);
                                  // screen reach per building = (−2δ, +δ), i.e.
                                  // a c3 tower (~90px) throws ~2 tiles screen-SW
const SHADOW_MIN_LEN = 10;        // floor on δ for anything that rises above the
                                  // tile's N corner: low art (lvl-1 cottages,
                                  // pumps, water towers) tops out barely 1–11px
                                  // above the N corner, so raw SHADOW_LEN·h would
                                  // round to nothing — every standing building
                                  // still throws a short, visible drop-shadow
                                  // while the tall ones keep their scaled reach
const SHADOW_NE_PAD = 176;        // extra cull margin toward screen-NE (+x, −y):
                                  // off-viewport buildings up-right of the view
                                  // still cast their shadow INTO it

/* ---- fire visuals (G3) ---- */
const FIRE_GLOW_CORE = 0.35;      // cap on the additive night fire-bloom core
                                  // alpha — per-glow alpha further scales by
                                  // 1/sqrt(burning-tile count) so multi-tile
                                  // blazes glow instead of whiting out
const FIRE_DAY_ALPHA = 0.33;      // low-alpha warm ground glow under a burning
                                  // tile — daytime fires read as heat, not
                                  // street clutter
const FIRE_CHAR_ALPHA = 0.52;     // char overlay strength: burning facades
                                  // drop to ~50% of their pristine luminance

/* ---- depth-correct night lights (G2) ----
   Night glow used to be queued during the tile loop and blitted in one
   additive pass AFTER the whole scene — so lamp halos, C3 lobby spill and
   I-yard floodlight pools floated on top of the towers that occlude them.
   Now the lights are drawn in depth order onto a screen-space light layer:
   the painter loop buckets, per (x + y) diagonal, the occluder silhouettes
   and the light sprites it meets — punches first (destination-out erases
   glow accumulated by the diagonals behind), then that diagonal's own
   lights (lighter). The bucketed ops replay onto the layer in ONE burst
   right after the loop (same depth order, but the canvas never ping-pongs
   between two render targets mid-scene), and the finished layer is
   composited once, additively, over the dusk tint — open streets keep
   their full glow while anything behind a building stays behind it.
   The layer is also CACHED like terrLayer: every light and every occluder
   silhouette is a pure function of (camera, sim state, night phase), never
   of the animation frame — so the punched layer is rebuilt only when its
   key moves (pan/zoom, sim tick, build/doze/ignite via city.devRev, dusk
   ramp) and every other frame reuses it in a single composite. */
const nightLayer = { cv: null, g: null, key: "" };
const punchQ = [], addQ = [];     // current diagonal's buckets — reused
const nightOps = [];              // whole-frame (mode, spr, wx, wy, am) replay list
let nightDrawn = 0;               // resets each rebuild, capped at NIGHT_MAX_DRAWS

function nightLayerCtx() {
  const L = nightLayer;
  if (!L.cv || L.cv.width !== cvs.width || L.cv.height !== cvs.height) {
    L.cv = document.createElement("canvas");
    L.cv.width = cvs.width; L.cv.height = cvs.height;
    L.g = L.cv.getContext("2d");
  }
  const g = L.g;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = "source-over";
  g.globalAlpha = 1;
  g.clearRect(0, 0, L.cv.width, L.cv.height);
  g.setTransform(RS, 0, 0, RS, 0, 0); // GQ11: DPR base — view math in CSS px
  g.translate(VW / 2, VH / 2);
  g.scale(cam.z, cam.z);
  g.translate(-cam.x, -cam.y);
  g.imageSmoothingEnabled = false;
  punchQ.length = 0; addQ.length = 0; nightOps.length = 0; nightDrawn = 0;
  return g;
}

// queue an occluder silhouette for this diagonal — a lamp or ground pool
// behind a tower can never brighten its walls or roof
function nightPunch(spr, wx, wy) {
  punchQ.push(spr, wx, wy);
}

// queue one light sprite at this diagonal's depth, capped like the old
// queue. am is a per-sprite alpha multiplier (G3: fire glow scales with
// cluster size); everything else draws at the default 1.
function nightAdd(spr, wx, wy, am = 1) {
  if (nightDrawn >= NIGHT_MAX_DRAWS) return;
  nightDrawn++;
  addQ.push(spr, wx, wy, am);
}

// close one diagonal's buckets: its punches (erasing glow from the
// diagonals behind) come before its own lights on the replay list
function flushNightDiag() {
  for (let k = 0; k < punchQ.length; k += 3)
    nightOps.push(0, punchQ[k], punchQ[k + 1], punchQ[k + 2], 1);
  for (let k = 0; k < addQ.length; k += 4)
    nightOps.push(1, addQ[k], addQ[k + 1], addQ[k + 2], addQ[k + 3]);
  punchQ.length = 0; addQ.length = 0;
}

// replay the whole frame's bucketed ops onto the light layer in depth
// order: destination-out for occluder silhouettes, lighter for lights —
// clamped (G1), never full alpha. Composite op / alpha switch only when
// they change between consecutive runs.
function drawNightLayer(g, ns) {
  let mode = -1, am = -1;
  for (let k = 0; k < nightOps.length; k += 5) {
    if (nightOps[k] !== mode || nightOps[k + 4] !== am) {
      mode = nightOps[k]; am = nightOps[k + 4];
      g.globalCompositeOperation = mode ? "lighter" : "destination-out";
      g.globalAlpha = mode ? ns * NIGHT_LIGHT_ALPHA * am : 1;
    }
    const s = nightOps[k + 1];
    g.drawImage(s.c, nightOps[k + 2] - s.ox, nightOps[k + 3] - s.oy);
  }
}

// G2: a baked ground-pool ellipse (C3 lobby spill, I-yard floodlight) is
// skipped when the tile in front — (x+1, y+1), the screen-nearer neighbor —
// carries a developed building that would physically block the spill.
// District-edge and low-density-neighbor tiles keep their pools.
function poolBlocked(city, x, y) {
  // M32a: the screen-nearer occluder is the tile whose VIEW image is at
  // (u+1,v+1). Derive the map-space delta from unrot's linear part so it can
  // never drift from rot()/unrot(): r0 (+1,+1) r1 (-1,+1) r2 (-1,-1) r3 (+1,-1).
  const d0 = unrot(0, 0, cam.r), d1 = unrot(1, 1, cam.r);
  const nx = x + (d1.x - d0.x), ny = y + (d1.y - d0.y);
  if (nx < 0 || nx >= MAP || ny < 0 || ny >= MAP) return false;
  const i = ny * MAP + nx;
  const ov = city.over[i];
  if (ov >= OV.ZR && ov <= OV.ZI) return city.lvl[i] > 0;
  return ov === OV.POLICE || ov === OV.FIRESTA || ov === OV.SCHOOL ||
         ov === OV.HOSPITAL || ov === OV.COAL || ov === OV.SOLAR ||
         ov === OV.GAS || ov === OV.WIND ||
         ov === OV.MAYOR || ov === OV.STADIUM;
}

function dayPhase(tickCount) {    // 0 = midnight … 0.5 = noon … → 1
  return (((tickCount % 24) + 24) % 24) / 24;
}

// 0 = full day, 1 = deepest night; linear dawn/dusk ramps between the noon
// plateau (hours 9–15) and the midnight plateau (hours 23–01). With the
// Speed-menu "Day/Night Cycle" pref off the phase is forced to full day and
// every night draw is skipped entirely.
function nightStrength(city, uiState) {
  if (uiState && uiState.prefs && uiState.prefs.dayNight === false) return 0;
  const d = Math.abs(dayPhase(city.tickCount) * 24 - 12); // hours from noon
  return Math.max(0, Math.min(1, (d - 3) / 8));
}

function worldTransform() {
  ctx.translate(VW / 2, VH / 2);
  ctx.scale(cam.z, cam.z);
  ctx.translate(-cam.x, -cam.y);
}

function screenToTile(sx, sy) {
  const wx = (sx - VW / 2) / cam.z + cam.x;
  const wy = (sy - VH / 2) / cam.z + cam.y;
  const A = wx / HW, B = (wy - HH) / HH;
  // recover FLOAT view coords, round IN VIEW SPACE, then un-rotate — rounding
  // before unrot is mandatory or diagonal-seam tiles mis-pick (M32a).
  const u = Math.round((A + B) / 2), v = Math.round((B - A) / 2);
  return unrot(u, v, cam.r);
}

// M32a: FLOAT (unrounded) inverse. The G8 minimap viewport rect needs sub-tile
// precision for its bounding box — rounding to whole tiles (screenToTile) shifts
// the camera box ~1px for off-centre cameras. unrot is linear, so it is exact on
// float u,v; at r=0 this reduces to the pre-rotation inline float inverse exactly,
// keeping the minimap byte-identical to HEAD at orientation 0.
function screenToTileF(sx, sy) {
  const wx = (sx - VW / 2) / cam.z + cam.x;
  const wy = (sy - VH / 2) / cam.z + cam.y;
  const A = wx / HW, B = (wy - HH) / HH;
  return unrot((A + B) / 2, (B - A) / 2, cam.r);
}

/* ---- flat-terrain layer cache (M11) ----
   Grass / water / shore diamonds are flat and tile the plane exactly, so
   they can be pre-composited once per (camera, water-frame, terrain-rev,
   season) into an offscreen canvas and blitted in one drawImage per frame.
   Forest sprites stay in the live pass — they rise above the diamond and
   must keep painter-order occlusion against buildings. Big developed maps
   (128x128) drop thousands of per-frame draw calls this way. The season
   (M12) is part of the cache key, so a palette swap is a cache event on the
   month rollover — never per-frame work — and reuses the same canvas. */
const terrLayer = { cv: null, g: null, key: "" };

function buildTerrainLayer(city, waterFrame, minWX, maxWX, minWY, maxWY, key) {
  const L = terrLayer;
  if (!L.cv || L.cv.width !== cvs.width || L.cv.height !== cvs.height) {
    L.cv = document.createElement("canvas");
    L.cv.width = cvs.width; L.cv.height = cvs.height;
    L.g = L.cv.getContext("2d");
  }
  const g = L.g;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, L.cv.width, L.cv.height);
  g.setTransform(RS, 0, 0, RS, 0, 0); // GQ11: DPR base — view math in CSS px
  g.translate(VW / 2, VH / 2);
  g.scale(cam.z, cam.z);
  g.translate(-cam.x, -cam.y);
  g.imageSmoothingEnabled = false;
  const S = SPR.season[seasonOf(city.month)]; // seasonal terrain art (M12)
  for (let s = 0; s <= (MAP - 1) * 2; s++) {
    for (let x = Math.max(0, s - MAP + 1); x <= Math.min(MAP - 1, s); x++) {
      const y = s - x;
      const wx = worldX(x, y), wy = worldY(x, y);
      if (wx < minWX || wx > maxWX || wy < minWY || wy > maxWY) continue;
      const i = y * MAP + x;
      if (city.terr[i] === TERR.WATER) {
        // G5: per-tile variant (scrambled hash) + per-tile frame offset
        // (x + y) — adjacent lake tiles never show the same pixels, and the
        // shimmer travels across the water instead of looping in lockstep.
        // Pure in (x, y, waterFrame): cache-safe, identical every rebuild.
        const w = S.water[terrHash(x, y) % WATER_VARIANTS][(waterFrame + x + y) % WATER_FRAMES];
        g.drawImage(w.c, wx - w.ox, wy - w.oy);
        const sm = shoreMask(city, i); // sand / rime ice on land-facing edges
        // G13: per-tile shore-width variant by the same scrambled hash used for
        // grass/water (cache-safe, deterministic) — coasts wander in width
        if (sm) { const sh = S.shore[terrHash(x, y) % SHORE_VARIANTS][rot4(sm, cam.r)]; g.drawImage(sh.c, wx - sh.ox, wy - sh.oy); }
      } else {
        // G5: variant by scrambled (x, y) hash — open meadows mottle
        // organically instead of alternating with varnt's seeded stripes.
        // GQ2: bare GRASS-terr tiles pick their material (grass / dirt /
        // sand lot / pavement) from the seed-pure quilt field; forest floors
        // stay grass. Each material has 8 bakes — 4 variants x 2 (x+y)
        // parities — and orthogonal neighbors always differ in parity, so
        // adjacent same-material tiles ALWAYS draw two independent canvases
        // with different fleck/grain layouts, even on a terrHash&3 collision
        // (parity is an index, not a transform: no per-tile save/restore).
        const mi = city.terr[i] === TERR.GRASS ? groundMat(city.seed, x, y) : 0;
        const gs = S.ground[mi][(terrHash(x, y) & 3) | (((x + y) & 1) << 2)];
        g.drawImage(gs.c, wx - gs.ox, wy - gs.oy);
        // GQ2: broad light/dark relief swells (logical-space gradient toward
        // the screen-NW light) — over the material, UNDER the beach fringe
        const rs = reliefShade(city.seed, x, y);
        if (rs) { const rt = SPR.reliefTint[rs > 0 ? 0 : 1]; g.drawImage(rt.c, wx - rt.ox, wy - rt.oy); }
        const bm = beachMask(city, i); // shore fringe on the land side of the seam
        if (bm) {
          const sh = S.shore[terrHash(x, y) % SHORE_VARIANTS][rot4(bm, cam.r)]; g.drawImage(sh.c, wx - sh.ox, wy - sh.oy);
          // GQ9 fix: wrack/berm seam OVER the beach — land-tile draw only,
          // so the water-side shelf ramp stays a clean monotone descent
          const dn = S.dune[rot4(bm, cam.r)];
          g.drawImage(dn.c, wx - dn.ox, wy - dn.oy);
        }
      }
    }
  }
  // G5: second sweep — conditional type-change edge strokes (grass/forest),
  // drawn after every fill so a neighbor's seam-sealing overdraw can't shave
  // them. Interior same-type seams get no stroke at all; this runs only on
  // the rare rebuild, never per frame.
  for (let s = 0; s <= (MAP - 1) * 2; s++) {
    for (let x = Math.max(0, s - MAP + 1); x <= Math.min(MAP - 1, s); x++) {
      const y = s - x;
      const wx = worldX(x, y), wy = worldY(x, y);
      if (wx < minWX || wx > maxWX || wy < minWY || wy > maxWY) continue;
      const i = y * MAP + x;
      if (city.terr[i] === TERR.WATER) {
        // GQ9 fix: near-shore depth falloff — water-tile draw only (the
        // land side never gets it, so beaches stay bright). Drawn in THIS
        // sweep, unclipped past the diamond, so the strips of consecutive
        // shore tiles join seamlessly and no later tile fill can shave them.
        const sm = shoreMask(city, i);
        if (sm) { const sl = S.shoal[rot4(sm, cam.r)]; g.drawImage(sl.c, wx - sl.ox, wy - sl.oy); }
        continue;
      }
      const em = terrEdgeMask(city, i);
      if (em) { const eg = SPR.terrEdge[rot4(em, cam.r)]; g.drawImage(eg.c, wx - eg.ox, wy - eg.oy); }
      // GQ2: stippled feather where the material quilt changes between two
      // bare GRASS-terr tiles — after terrEdge so neighbor overdraw can't
      // shave it; the mask rotates with rot4 exactly like terrEdge / shore
      if (city.terr[i] === TERR.GRASS) {
        const fm = matFringeMask(city, i);
        if (fm) { const fg = SPR.matFringe[rot4(fm, cam.r)]; g.drawImage(fg.c, wx - fg.ox, wy - fg.oy); }
      }
    }
  }
  L.key = key;
}

/* ---- building cast-shadow layer (GQ8) ----
   The screen-welded sun sits NE (the SW prism face is the darkest bake), so
   every shadow falls along screen-SW — the projection of view +v, per-unit
   delta (−HW, +HH) = (−2, +1)·16px. The iso footprint diamond's NW and SE
   edges are PARALLEL to that vector, so the swept hull of the diamond along
   D = (−2δ, +δ) is exactly the diamond with its S and W corners displaced by
   D: one 4-point polygon per building, no sheared-silhouette drawImage, no
   per-frame allocation. Square s×s footprints are rotation-invariant in view
   space, so the same formula holds at all 4 cam.r with zero per-rotation
   code. Quads fill OPAQUE black into a cached screen-space layer (terrLayer
   idiom) so overlapping shadows never double-darken; the single composite in
   renderFrame applies SHADOW_ALPHA once, faded by (1 − ns) so dusk melts the
   shadows linearly and deep night skips the branch entirely — the ns==1
   frame and the G1/G2 night layer stay byte-identical to a shadowless build.

   PAN APRON (C5): the quads live in WORLD space, so a camera pan never
   changes their content — only where the viewport window sits. The layer is
   therefore rastered SHADOW_MARGIN px larger than the viewport on every
   side, anchored at the camera it was built for (camX/camY), and the cache
   key excludes cam.x/cam.y: a pan whose screen delta is a whole number of
   device pixels inside the apron is serviced by compositing the SAME raster
   at an integer offset — zero raster work per pan frame. Only content
   changes (tick, devRev, season, zoom, rotation, resize), fractional-pixel
   deltas, or pans that leave the apron trigger a full re-anchor rebuild.
   An integer offset reproduces a fresh rebuild exactly: the world transform
   differs by a pure integer screen translation, so every pixel's rasterized
   coverage — AA edges included — is byte-identical. */
const SHADOW_MARGIN = 128;
const shadowLayer = { cv: null, g: null, key: "",
                      camX: NaN, camY: NaN,   // camera the raster is anchored at
                      viewX: NaN, viewY: NaN, // camera the offset was computed for
                      offX: 0, offY: 0 };     // device-px composite offset

// lazy cached effective art height (exact drawChar idiom: derive once, cache
// on the sprite record). One-time getImageData scan of spr.c for the topmost
// opaque row; subtracting HH removes the N-corner ground offset so flat art
// (roads, pipes) degenerates to ~0. Pure pixel read, zero RNG, runs once per
// unique sprite canvas — winter/facing variants are distinct records and
// cache independently.
function sprShadowH(spr) {
  if (spr.shH === undefined) {
    const w = spr.c.width, h = spr.c.height;
    const px = spr.c.getContext("2d").getImageData(0, 0, w, h).data;
    let top = h;
    outer: for (let yy = 0; yy < h; yy++)
      for (let xx = 0; xx < w; xx++)
        if (px[(yy * w + xx) * 4 + 3] > 0) { top = yy; break outer; }
    spr.shH = Math.max(0, spr.oy - top - HH);
  }
  return spr.shH;
}

// which over[] carriers throw a cast shadow: developed zones, the tall civic
// and utility structures, and the M28 mega-structures. Explicitly EXCLUDED:
// road/wire/crossing/pipe (flat), PARK and RUBBLE (low clutter), undeveloped
// zone markers, and forest / GQ4 street trees — those keep their existing
// baked G13/GQ4 grounding ellipses (direction-consistent, not replaced).
function castsShadow(city, i, ov) {
  if (ov >= OV.ZR && ov <= OV.ZI) return city.lvl[i] > 0;
  return ov === OV.POLICE || ov === OV.FIRESTA || ov === OV.SCHOOL ||
         ov === OV.HOSPITAL || ov === OV.COAL || ov === OV.SOLAR ||
         ov === OV.GAS || ov === OV.WIND || ov === OV.MAYOR ||
         ov === OV.STADIUM || ov === OV.WATERTOWER || ov === OV.PUMP ||
         isMega(ov) ||
         ov === OV.NUKE || ov === OV.AIRPORT || ov === OV.SEAPORT; // GQ10: new casters join the GQ8 set (anchor gate + sizeOf are size-agnostic)
}

// footprint diamond with its S and W corners displaced by D = (−2δ, +δ)
function fillShadowQuad(g, awx, awy, size, d) {
  g.beginPath();
  g.moveTo(awx, awy - HH);                                       // N
  g.lineTo(awx + size * HW, awy + (size - 1) * HH);              // E
  g.lineTo(awx - 2 * d, awy + (2 * size - 1) * HH + d);          // S'
  g.lineTo(awx - size * HW - 2 * d, awy + (size - 1) * HH + d);  // W'
  g.closePath();
  g.fill();
}

// mirrors buildTerrainLayer's idiom: reuse the offscreen canvas, set the
// world transform (anchored at the CURRENT camera, apron included), then ONE
// linear scan of the map (order-independent — opaque fills union). Position
// comes from backCorner(), the SAME screen-back corner the painter loop and
// smoke plumes draw from, so shadows stay welded to their sprite at every
// cam.r. A full raster runs only on a cache-key move (sim tick, build/doze
// via devRev, season, zoom, rotation, resize) or when a pan leaves the
// apron / lands on a fractional pixel; a plain integer-pixel pan just
// updates the composite offset — zero raster work.
function buildShadowLayer(city, minWX, maxWX, minWY, maxWY, key) {
  const L = shadowLayer;
  // GQ11: the apron is constant in CSS px, so the device-px apron is
  // SHADOW_MARGIN*RS — at RS=1 every expression below reduces to the shipped
  // arithmetic (a *1 multiply is an IEEE no-op), and at integer RS an
  // integer-CSS-px pan stays integer in device px, keeping the zero-raster
  // pan fast path alive at DPR 2.
  const M = Math.round(SHADOW_MARGIN * RS);
  const Lw = cvs.width + 2 * M, Lh = cvs.height + 2 * M;
  if (L.cv && L.cv.width === Lw && L.cv.height === Lh && L.key === key) {
    // same content, camera slid: reuse the raster while the slide is a whole
    // number of device pixels and the viewport stays inside the apron
    const dx = (L.camX - cam.x) * cam.z * RS, dy = (L.camY - cam.y) * cam.z * RS;
    const rdx = Math.round(dx), rdy = Math.round(dy);
    if (Math.abs(dx - rdx) < 1e-7 && Math.abs(dy - rdy) < 1e-7 &&
        Math.abs(rdx) <= M && Math.abs(rdy) <= M) {
      L.offX = rdx; L.offY = rdy;
      L.viewX = cam.x; L.viewY = cam.y;
      return;
    }
  }
  if (!L.cv || L.cv.width !== Lw || L.cv.height !== Lh) {
    L.cv = document.createElement("canvas");
    L.cv.width = Lw; L.cv.height = Lh;
    L.g = L.cv.getContext("2d");
  }
  const g = L.g;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, Lw, Lh);
  g.setTransform(RS, 0, 0, RS, Lw / 2, Lh / 2); // GQ11: DPR base, device-center origin
  g.scale(cam.z, cam.z);
  g.translate(-cam.x, -cam.y);
  g.fillStyle = "#000";
  // world-space bounds of the layer canvas (apron included), AA-padded —
  // quads are culled by their exact bbox so nothing that could touch the
  // raster is ever skipped, at any footprint size
  const wl = -Lw / 2 / (cam.z * RS) + cam.x - 2, wr = Lw / 2 / (cam.z * RS) + cam.x + 2;
  const wt = -Lh / 2 / (cam.z * RS) + cam.y - 2, wb = Lh / 2 / (cam.z * RS) + cam.y + 2;
  const N = MAP * MAP;
  for (let i = 0; i < N; i++) {
    const ov = city.over[i];
    let spr = null, size = 1;
    if (castsShadow(city, i, ov)) {
      // anchor gate: multi-tile footprints cast ONE shadow, from the anchor
      if (city.anc[i] !== -1 && city.anc[i] !== i) continue;
      size = sizeOf(ov);
      spr = spriteFor(city, i);
    } else if (city.rail[i] === RL.STATION) {
      spr = SPR.station; // M25 depot on the rail plane (1x1)
    }
    if (!spr) continue;
    const hs = sprShadowH(spr);
    if (hs < 1) continue; // art at or below the tile's N corner casts nothing
    const ax = i % MAP, ay = (i / MAP) | 0;
    const b = backCorner(ax, ay, size);
    const awx = worldX(b.x, b.y), awy = worldY(b.x, b.y);
    // low art still throws a short shadow (SHADOW_MIN_LEN floor)
    const d = Math.max(SHADOW_MIN_LEN, SHADOW_LEN * hs);
    if (awx + size * HW < wl || awx - size * HW - 2 * d > wr ||
        awy + (2 * size - 1) * HH + d < wt || awy - HH > wb) continue;
    fillShadowQuad(g, awx, awy, size, d);
  }
  L.key = key; L.camX = cam.x; L.camY = cam.y;
  L.viewX = cam.x; L.viewY = cam.y; L.offX = 0; L.offY = 0;
}

/* ---- GQ9: suspension bridges over water ----
   Visual-only, drawn LIVE in the painter loop at each bridge tile's own depth
   slot (painter order s = x + y and click-picking untouched); the shipped
   road/rail sprite stays the deck surface, so GQ7 lane paint is preserved.
   All geometry goes through fractional worldX/worldY (rot() is linear — the
   GQ4 street-tree idiom), so all 4 rotations come free. Every value is pure
   in (city state, cam): zero RNG, zero per-frame allocation beyond the O(1)
   memoized bridgeRun lookup. Deliberately NOT part of buildShadowLayer /
   castsShadow (roads/rails never cast there by design) and NO new
   nightAdd/nightPunch calls — the GQ8 shadow layer and G1/G2 night layer
   stay byte-identical; the existing road street lamp on bridge tiles stays. */
const BRIDGE_HT = 38;  // main-cable height above deck at the towers (saddle)
const BRIDGE_HS = 10;  // main-cable sag height above deck at mid-span

// world point at run fraction f (tiles along the run) and perp offset p
// (tiles across it): the perp of logical axis (ax, ay) is (ay, ax)
function bridgePt(run, f, p) {
  const bx = run.x0 + f * run.ax + p * run.ay;
  const by = run.y0 + f * run.ay + p * run.ax;
  return [worldX(bx, by), worldY(bx, by)];
}

// UNDER pass — beneath the deck sprite: translucent water shadow + slab fascia
function drawBridgeUnder(run, wx, wy) {
  // water shadow: the tile diamond offset (−6, +3) — translucent, so the
  // baked water shimmer stays visible under the span
  ctx.fillStyle = "rgba(4,18,34,.30)";
  ctx.beginPath();
  ctx.moveTo(wx - 6, wy - HH + 3); ctx.lineTo(wx + HW - 6, wy + 3);
  ctx.lineTo(wx - 6, wy + HH + 3); ctx.lineTo(wx - HW - 6, wy + 3);
  ctx.closePath(); ctx.fill();
  // deck fascia: 2px slab sides along both travel edges, at perp ±0.38 —
  // just outside the road bake's ±0.36 asphalt span so the slab edge shows
  ctx.strokeStyle = "#565a63"; ctx.lineWidth = 2;
  const f0 = run.d - 0.5, f1 = run.d + 0.5;
  for (const p of [-0.38, 0.38]) {
    const A = bridgePt(run, f0, p), B = bridgePt(run, f1, p);
    ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke();
  }
}

// OVER pass — above the deck sprite: railings, towers, main cables, hangers
function drawBridgeOver(run) {
  const L = run.L, d = run.d;
  const f0 = d - 0.5, f1 = d + 0.5;
  // railings at perp ±0.27: light top rail 3px above the deck plus a mid
  // rail, posts every ¼ tile. 1.3px width — a 1px diagonal stroke antialiases
  // to ~half coverage on the dark asphalt and the guard rail stops reading.
  ctx.strokeStyle = "#c9ccd4"; ctx.lineWidth = 1.3;
  ctx.beginPath();
  for (const p of [-0.27, 0.27]) {
    const A = bridgePt(run, f0, p), B = bridgePt(run, f1, p);
    ctx.moveTo(A[0], A[1] - 3); ctx.lineTo(B[0], B[1] - 3);
    ctx.moveTo(A[0], A[1] - 1.6); ctx.lineTo(B[0], B[1] - 1.6);
    for (let k = 0; k < 4; k++) {
      const Q = bridgePt(run, f0 + (k + 0.5) * 0.25, p);
      ctx.moveTo(Q[0], Q[1]); ctx.lineTo(Q[0], Q[1] - 3);
    }
  }
  ctx.stroke();
  if (L < 2) return; // single-tile span: deck + fascia + railing + shadow only
  // towers at both ends — variant 0 spans along view u, 1 along view v
  if (d === 0 || d === L - 1) {
    const tw = SPR.bridgeTower[(run.ax !== 0) === ((cam.r & 1) === 0) ? 0 : 1];
    const C = bridgePt(run, d, 0);
    ctx.drawImage(tw.c, C[0] - tw.ox, C[1] - tw.oy);
  }
  // main cables: global span parameter t = f/(L−1); h(t) = HS + (HT−HS)(2t−1)²
  // — every tile strokes its slice of the SAME closed-form world-space curve
  // (8 segments per side), so slices join exactly across tile seams
  const ch = (t) => BRIDGE_HS + (BRIDGE_HT - BRIDGE_HS) * (2 * t - 1) * (2 * t - 1);
  const cf = (v) => v < 0 ? 0 : v > L - 1 ? L - 1 : v;
  for (const p of [-0.26, 0.26]) {
    for (const [col, lw, dy] of [["#22242c", 1.6, 0], ["#484c58", 0.6, -0.8]]) {
      ctx.strokeStyle = col; ctx.lineWidth = lw;
      ctx.beginPath();
      for (let s8 = 0; s8 <= 8; s8++) {
        const f = cf(f0 + s8 / 8);
        const Q = bridgePt(run, f, p);
        const Y = Q[1] - ch(f / (L - 1)) + dy;
        s8 ? ctx.lineTo(Q[0], Y) : ctx.moveTo(Q[0], Y);
      }
      ctx.stroke();
    }
  }
  // hangers at even GLOBAL stations every ½ tile (t_k = ½k/(L−1)); the tile
  // owning f ∈ [d−½, d+½) draws station k — even spacing across seams by
  // construction. The towers own the two span ends.
  ctx.strokeStyle = "#33363e"; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let k = 2 * d - 1; k <= 2 * d + 1; k++) {
    const f = k / 2;
    if (f < f0 || f >= f1 || f <= 0 || f >= L - 1) continue;
    const hy = ch(f / (L - 1));
    for (const p of [-0.26, 0.26]) {
      const Q = bridgePt(run, f, p);
      ctx.moveTo(Q[0], Q[1] - hy);
      ctx.lineTo(Q[0], Q[1] - 3); // down to the rail top
    }
  }
  ctx.stroke();
}

function renderFrame(city, uiState, clearBG) {
  frame++;
  const ns = nightStrength(city, uiState); // 0 ⇒ the whole night path is skipped
  nightDrawn = 0;
  // GQ11: DPR base transform for the whole frame — every save/restore pair
  // below returns to it, so all view math stays in CSS px at any DPR
  ctx.setTransform(RS, 0, 0, RS, 0, 0);
  if (clearBG) {
    // postcard photo pass (G4): transparent background — the composer lays
    // its sunset-sky gradient underneath, so past the map edge the photo
    // shows sky, never the void color
    ctx.clearRect(0, 0, VW, VH);
  } else {
    ctx.fillStyle = "#0a0a12";
    ctx.fillRect(0, 0, VW, VH);
  }

  // cull margins sized to the sprite extents: buildings reach ~64px sideways,
  // ~110px above and ~48px below their anchor tile's diamond center
  const minWX = cam.x - VW / 2 / cam.z - 80;
  const maxWX = cam.x + VW / 2 / cam.z + 80;
  const minWY = cam.y - VH / 2 / cam.z - 64;
  const maxWY = cam.y + VH / 2 / cam.z + 128;

  const blink = (frame / 24 | 0) % 2 === 0;
  // prebuilt water frame cycle — divisor 32 (G5): the water-driven terrain
  // rebuild lands at ~1.9x/second instead of 3.7x; per-tile (x + y) offsets
  // in buildTerrainLayer keep the shimmer lively between rebuilds
  const waterFrame = (frame / 32 | 0) % WATER_FRAMES;

  // GP4b: sim speed hoisted once — computeTrains runs BEFORE the painter loop
  // so this frame's consists are already bucketed when the RL.TRACK/RL.STATION
  // tile slots draw; updateCars keeps its existing post-loop call site and
  // shares the hoisted value.
  const carSpeed = (uiState && uiState.speed != null) ? uiState.speed : 1;
  computeTrains(city, carSpeed);

  // flat terrain: one cached blit unless the camera / water / terrain moved —
  // or the season changed (M12): the palette swap costs exactly one rebuild
  const tKey = `${cam.x},${cam.y},${cam.z},${cam.r},${cvs.width},${cvs.height},${RS},` +
    `${waterFrame},${city.terrRev | 0},${city.seed},${MAP},${seasonOf(city.month)}`;
  if (terrLayer.key !== tKey)
    buildTerrainLayer(city, waterFrame, minWX, maxWX, minWY, maxWY, tKey);
  // GQ11: the layer is device-px sized — blit it 1:1 under identity (exactly
  // today's behavior at RS=1), then restore the DPR base transform
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(terrLayer.cv, 0, 0);
  ctx.restore();

  // GQ8: building cast-shadows — one cached screen-space composite OVER the
  // flat terrain, UNDER everything the painter loop draws. Faded by (1 − ns):
  // at deep night the branch is skipped entirely (no rebuild, no draw, no
  // RNG), so the ns==1 frame stays byte-identical to a shadowless build.
  // tickCount is in the key because organic zone growth (lvl 0→3) does NOT
  // bump devRev — the same discipline the nightLayer key uses; rebuild cost
  // is bounded to once per sim tick plus camera moves, the terrLayer class.
  // Billboard pref + season + cam.r are keyed because spriteFor's facing/
  // season pick changes the art heights the quads derive from.
  const shA = SHADOW_ALPHA * (1 - ns);
  if (shA > 0.01) {
    // cam.x/cam.y are NOT in the key: the quads are world-space, so a pure
    // pan reuses the raster via the scroll fast-path inside buildShadowLayer
    const sKey = `${cam.z},${cam.r},${cvs.width},${cvs.height},${RS},` +
      `${city.devRev},${city.tickCount},${city.seed},${MAP},${seasonOf(city.month)},` +
      `${(typeof UI !== "undefined" && UI.prefs && UI.prefs.billboard) ? 1 : 0}`;
    if (shadowLayer.key !== sKey ||
        shadowLayer.viewX !== cam.x || shadowLayer.viewY !== cam.y)
      buildShadowLayer(city, minWX, maxWX, minWY, maxWY, sKey);
    // GQ11: device-px layer, device-px offsets — composite under identity
    const shM = Math.round(SHADOW_MARGIN * RS);
    ctx.globalAlpha = shA;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(shadowLayer.cv,
      shadowLayer.offX - shM, shadowLayer.offY - shM);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  ctx.save();
  worldTransform();
  ctx.imageSmoothingEnabled = false;

  // G2: night lights accumulate on the punched layer during the loop, in
  // depth order — but only when the cache key moved; a static night frame
  // reuses the finished layer and pays one composite
  const nKey = ns > 0 ? `${cam.x},${cam.y},${cam.z},${cam.r},${cvs.width},${cvs.height},${RS},` +
    `${ns},${city.tickCount},${city.terrRev},${city.devRev},${city.seed},${MAP}` : "";
  const ng = ns > 0 && nightLayer.key !== nKey ? nightLayerCtx() : null;

  // G3: night fire bloom — one glow per burning tile stacks additively, so
  // per-glow alpha is scaled by 1/sqrt(burning-tile count) with the core
  // capped at FIRE_GLOW_CORE: an 8-tile blaze glows, it no longer whites
  // out. (The NIGHT_LIGHT_ALPHA divisor cancels the clamp drawNightLayer
  // applies to every add, making the drawn core exactly ns * cap / sqrt(n).)
  let fireGlowMul = 0;
  if (ng) {
    let nf = 0;
    for (let k = 0; k < city.fire.length; k++) if (city.fire[k]) nf++;
    if (nf) fireGlowMul = FIRE_GLOW_CORE / (NIGHT_LIGHT_ALPHA * Math.sqrt(nf));
  }

  // painter's order (M32a): by VIEW depth (u + v), then u. Projected screen
  // depth is monotonic in u+v, so this stays back-to-front under every camera
  // rotation. unrot each (u,v) back to logical (x,y) to fetch city data. At
  // r=0 unrot is the identity, so this is the exact HEAD walk (x=u, y=s-u).
  for (let s = 0; s <= (MAP - 1) * 2; s++) {
    for (let u = Math.max(0, s - MAP + 1); u <= Math.min(MAP - 1, s); u++) {
      const v = s - u;
      const p = unrot(u, v, cam.r);
      const x = p.x, y = p.y;
      const i = y * MAP + x;
      const ov = city.over[i];
      const t = city.terr[i];
      // M25: a bare tile still draws if it carries a rail feature (track/station,
      // or a subway vent while the transit overlay is on) — otherwise skip it.
      const rl = city.rail[i];
      const railVisible = rl === RL.TRACK || rl === RL.STATION ||
        (rl === RL.SUB && typeof UI !== "undefined" && UI.mapMode === "transit");
      if (ov === OV.NONE && !city.fire[i] && t !== TERR.FOREST && !railVisible) continue;
      const wx = worldX(x, y), wy = worldY(x, y);
      if (wx < minWX || wx > maxWX || wy < minWY || wy > maxWY) continue;

      // G3: a burning tile casts a warm glow onto its ground apron — drawn
      // under the building/trees so the char state stays legible, visible
      // by day as well as night (the additive bloom stacks on top after dark)
      if (city.fire[i]) drawFireGround(wx, wy);

      // forest rises above the flat layer — drawn live for correct occlusion
      if (t === TERR.FOREST && ov === OV.NONE) {
        const fs = forestSprite(city, i); // cluster-aware density
        // G13: mirror every other tile (checkerboard by x+y parity) around its
        // own center — a deterministic, cache-independent flip that guarantees
        // two 4-adjacent forest tiles never render an identical arrangement,
        // even when the position hash lands them on the same canopy variant
        if ((x + y) & 1) {
          ctx.save();
          ctx.translate(wx, 0); ctx.scale(-1, 1); ctx.translate(-wx, 0);
          ctx.drawImage(fs.c, wx - fs.ox, wy - fs.oy);
          ctx.restore();
        } else {
          ctx.drawImage(fs.c, wx - fs.ox, wy - fs.oy);
        }
        if (ng) nightPunch(fs, wx, wy); // trees shadow glow behind them
      }

      // overlay
      if (ov !== OV.NONE) {
        const size = sizeOf(ov);
        if (size === 1) {
          const spr = spriteFor(city, i);
          // GQ9: a road carried over open water is a suspension bridge — the
          // UNDER pass (water shadow + slab fascia) goes beneath the deck
          // sprite, the OVER pass (railings/towers/cables) above it, all in
          // this tile's own painter slot
          // GP4a: an expressway carried over water rides the same suspension
          // spans (bridgeRun's third carrier class — drawBridgeUnder/Over
          // reused verbatim): the xway water crossing IS the red-bridge answer.
          const roadBridge = (ov === OV.ROAD || ov === OV.WIREROAD || ov === OV.XWAY) &&
            t === TERR.WATER ? bridgeRun(city, i) : null;
          if (roadBridge) drawBridgeUnder(roadBridge, wx, wy);
          if (spr) {
            ctx.drawImage(spr.c, wx - spr.ox, wy - spr.oy);
            // M26: a WIREROAD draws the road footprint (spr, above) PLUS an
            // overhead power line. SPR.wire sprites are baked at elevation 20
            // so they draw above the diamond — the line hangs over the street.
            if (ov === OV.WIREROAD) {
              const ws = SPR.wire[rot4(wireMask(city, i), cam.r)];
              ctx.drawImage(ws.c, wx - ws.ox, wy - ws.oy);
            }
            if (roadBridge) drawBridgeOver(roadBridge);
            // G3: burning buildings char — darkened while city.fire[i] is
            // set, reverting the moment the fire ends
            if (city.fire[i]) drawChar(spr, wx, wy);
            // GP10a: the blight wash — a lot that has been failing for months
            // grimes over. FIRE DOMINATES (an `else`): a burning building must
            // keep the char as its single unambiguous read. Skipped at level 0
            // (nothing built to grime) and free at every rotation, since it is
            // a pure function of city.distress[i].
            else if (city.lvl[i] && city.distress[i])
              drawBlight(spr, wx, wy, distressBand(city.distress[i]));
            // G9: mast-bearing C3 towers blink their aircraft beacon live,
            // each tower phase-offset by its tile index — the baked red tip
            // is only the lit state, overdrawn dark on the off half-cycle
            if (spr.beacon) {
              ctx.fillStyle = (frame + i * 7) % 48 < 24 ? "#f33" : "#4a1a1a";
              ctx.fillRect(wx + spr.beacon.x, wy + spr.beacon.y, 3, 3);
            }
            // G2: buildings occlude glow behind them; flat roads/wires don't
            if (ng && ov !== OV.ROAD && ov !== OV.WIRE && ov !== OV.WIREROAD && ov !== OV.PIPE && !isXp(ov)) // M26: crossing is flat road+wire, doesn't punch; M24: a flat pipe doesn't punch either; GP4a: nor does the open expressway deck
              nightPunch(spr, wx, wy);
          }
          // pothole tint (M23): unmaintained roads visibly darken with wear
          if ((ov === OV.ROAD || ov === OV.WIREROAD) && city.roadWear[i] > 96) { // M26: crossing potholes like a road
            ctx.globalAlpha = Math.min(0.38, (city.roadWear[i] - 96) / 400);
            ctx.fillStyle = "#181008";
            ctx.beginPath();
            ctx.moveTo(wx, wy - HH); ctx.lineTo(wx + HW, wy);
            ctx.lineTo(wx, wy + HH); ctx.lineTo(wx - HW, wy);
            ctx.closePath(); ctx.fill();
            ctx.globalAlpha = 1;
          }
          // GQ4: street trees on straight road verges — placement is the pure
          // streetTreeInfo (seed + logical x,y + roadMask), position goes
          // through fractional worldX/worldY so the verge lands on the correct
          // screen side at every cam.r (M32) with no per-rotation code. Drawn
          // live like forests (the canopy rises above the flat plane) within
          // this tile's own painter depth, so nearer tiles still paint over
          // it. Deliberately NO nightPunch/nightAdd: the canopy is small and
          // the G1/G2 night-light layer stays byte-identical.
          if (ov === OV.ROAD || ov === OV.WIREROAD) {
            const st = streetTreeInfo(city, i);
            if (st) {
              const ts = SPR.season[seasonOf(city.month)].streetTree[st.variant];
              const tx = worldX(x + st.dx, y + st.dy), ty = worldY(x + st.dx, y + st.dy);
              ctx.drawImage(ts.c, tx - ts.ox, ty - ts.oy);
            }
          }
          if (ng) {
            // night lights at this tile's own depth (G2): street lamps on
            // road tiles, prebaked lit-window glow on powered zones, plus
            // the ground pool — unless the tile in front blocks the spill
            if (ov === OV.ROAD || ov === OV.WIREROAD || ov === OV.XWAY || ov === OV.RAMP) { // M26: crossing gets a street lamp like a road; GP4a: highway lighting rides the same additive lamp (night-layer key already includes devRev)
              nightAdd(SPR.lamp, wx, wy);
            } else if (spr && spr.night && city.powered[i] && !city.fire[i]) {
              // (burning buildings show fire, not tidy lit windows — G3)
              nightAdd(spr.night, wx, wy);
              if (spr.pool && !poolBlocked(city, x, y))
                nightAdd(spr.pool, wx, wy);
            }
          }
        } else {
          const a = city.anc[i];
          const ax = a % MAP, ay = (a / MAP) | 0;
          // M32a: anc stays the logical min-corner, but its SCREEN role rotates.
          // TRIGGER the draw on the argmax-view-depth footprint corner (front-
          // most, always in-footprint so in-map even at map edges); POSITION the
          // sprite from the argmin-view-depth (screen-back) corner. At r=0 these
          // are (ax+size-1,ay+size-1) and (ax,ay) — the exact HEAD behavior.
          let tcx = ax, tcy = ay, bcx = ax, bcy = ay, maxD = -Infinity, minD = Infinity;
          for (let cy = 0; cy < size; cy++) for (let cx = 0; cx < size; cx++) {
            const q = rot(ax + cx, ay + cy, cam.r), d = q.u + q.v;
            if (d > maxD) { maxD = d; tcx = ax + cx; tcy = ay + cy; }
            if (d < minD) { minD = d; bcx = ax + cx; bcy = ay + cy; }
          }
          if (x === tcx && y === tcy) {
            const spr = spriteFor(city, a);
            const awx = worldX(bcx, bcy), awy = worldY(bcx, bcy);
            if (spr) {
              ctx.drawImage(spr.c, awx - spr.ox, awy - spr.oy);
              // G3: any burning footprint tile chars the whole building
              let afire = false;
              for (let fy = 0; fy < size && !afire; fy++)
                for (let fx = 0; fx < size; fx++)
                  if (city.fire[(ay + fy) * MAP + ax + fx]) { afire = true; break; }
              if (afire) drawChar(spr, awx, awy);
              if (ng) {
                nightPunch(spr, awx, awy); // G2: civics occlude glow too
                if (spr.night && city.powered[a] && !afire)
                  nightAdd(spr.night, awx, awy);
              }
              // GP2 R2 fix (S4): port failure indicators draw HERE — after
              // the sprite, at the trigger corner's painter depth. The old
              // anchor-tile draw was occluded at cam.r 0/1/3: the anchor's
              // diagonal paints first, then the front-corner sprite drew
              // over the bolt, leaving a dark terminal nearly invisible by
              // day. The bolt is scaled 2x so it reads at 3x3/4x4 terminal
              // scale; nearest-neighbour scaling keeps the exact #ffd800.
              // Hover point is the anchor's own world tile, so it tracks
              // all 4 rotations for free. Zap keys on !powered, the noLink
              // badge on powered && !portWork (= unconnected) — mutually
              // exclusive, and both blink-gated like every other bolt.
              if (blink && isPort(ov)) {
                const zx = worldX(ax, ay), zy = worldY(ax, ay);
                if (!city.powered[a]) {
                  const sm = ctx.imageSmoothingEnabled;
                  ctx.imageSmoothingEnabled = false;
                  ctx.drawImage(SPR.zap.c,
                    zx - SPR.zap.ox * 2, zy - SPR.zap.oy * 2 - 4,
                    SPR.zap.c.width * 2, SPR.zap.c.height * 2);
                  ctx.imageSmoothingEnabled = sm;
                } else if (!city.portWork[a]) {
                  ctx.drawImage(SPR.noLink.c,
                    zx - SPR.noLink.ox, zy - SPR.noLink.oy - 4);
                }
              }
            }
          }
        }
      }

      // M25: rail plane — drawn AFTER over[] so surface track sits on top of the
      // street (a grade crossing) and never hides behind a tower. Subways are
      // invisible except a vent grate in the transit overlay; stations are a
      // depot sprite that lights up when live and shows a no-power bolt otherwise.
      if (rl === RL.TRACK) {
        // GQ9: surface track over water rides its own suspension bridge —
        // unless the tile already drew a road bridge (road wins on
        // grade-crossing bridges: one bridge, two decks)
        const railBridge = t === TERR.WATER &&
          ov !== OV.ROAD && ov !== OV.WIREROAD ? bridgeRun(city, i) : null;
        if (railBridge) drawBridgeUnder(railBridge, wx, wy);
        const rs = SPR.rail[rot4(railMask(city, i), cam.r)];
        ctx.drawImage(rs.c, wx - rs.ox, wy - rs.oy);
        // GP4b: the consist rides the deck — drawn after the rail sprite and
        // BEFORE drawBridgeOver, so bridge cables/towers paint over the train
        // (bridgeRun memo consumed read-only above, exactly as-is)
        drawTrainsAt(city, i);
        if (railBridge) drawBridgeOver(railBridge);
      } else if (rl === RL.STATION) {
        // GP4b fix (panel, gate 3): units owned by the station tile draw
        // BEFORE the depot sprite, so the full-tile depot cube occludes them
        // — the consist ducks behind the shed (tail still peeking over the
        // approach tile) instead of a loco slab painting across the facade.
        drawTrainsAt(city, i);
        const ss = SPR.station;
        ctx.drawImage(ss.c, wx - ss.ox, wy - ss.oy);
        if (ng) {
          nightPunch(ss, wx, wy);
          if (ss.night && city.stationLive[i]) nightAdd(ss.night, wx, wy);
        }
        // no-power bolt on an inert station (unpowered or unlinked)
        if (blink && !city.stationLive[i])
          ctx.drawImage(SPR.zap.c, wx - SPR.zap.ox, wy - SPR.zap.oy - 4);
      } else if (rl === RL.SUB && typeof UI !== "undefined" && UI.mapMode === "transit") {
        const vs = SPR.subwayVent;
        ctx.drawImage(vs.c, wx - vs.ox, wy - vs.oy);
      }

      // fire on this tile
      if (city.fire[i]) {
        drawFlames(wx, wy, i);
        if (ng) nightAdd(SPR.fireGlow, wx, wy, fireGlowMul);
      }

      // blinking "no power" bolt on developed but unpowered zones / civics.
      // GP2: a dark PORT terminal earns §0, adds no demand and moves no
      // freight, and the map says so as loudly as for a dark schoolhouse —
      // but the port bolt (and the powered-but-unconnected noLink badge)
      // draws in the multi-tile trigger block above, AFTER the sprite: an
      // anchor-tile draw here gets painted over by the front-corner sprite
      // at cam.r 0/1/3 (GP2 R2 S4 fix), because the anchor's diagonal
      // paints before the footprint's front corner.
      if (blink && !city.powered[i] &&
          ((ov >= OV.ZR && ov <= OV.ZI && city.lvl[i] > 0) ||
           ov === OV.POLICE || ov === OV.FIRESTA ||
           ov === OV.SCHOOL || ov === OV.HOSPITAL)) {
        if (city.anc[i] === -1 || city.anc[i] === i)
          ctx.drawImage(SPR.zap.c, wx - SPR.zap.ox, wy - SPR.zap.oy - 4);
      }
    }
    // G2: this diagonal is done — its night buckets join the replay list
    if (ng) flushNightDiag();
  }
  if (ng) { // one contiguous burst, depth order intact
    drawNightLayer(ng, ns);
    nightLayer.key = nKey;
  }

  updateCars(city, ns, carSpeed); // carSpeed hoisted pre-loop (GP4b)
  updateSmoke(city);
  drawDisaster(city);
  updateChopper(city); // news helicopter (M18) — O(1), presentation-only
  ctx.restore();

  // G14: mild seasonal daylight grade — winter cools/desaturates the scene,
  // autumn warms it, so buildings and terrain share one seasonal light. One
  // screen-space fill (O(1)); summer/spring are no-ops. Faded by (1 - ns) so
  // it vanishes at deep night, leaving the G1/G2 night path byte-identical.
  // Skipped in the postcard pass (clearBG), which lays its own season sky (G4).
  if (!clearBG && ns < 1) {
    const gA = 1 - ns, sea = seasonOf(city.month);
    if (sea === "winter") { ctx.globalAlpha = 0.05 * gA; ctx.fillStyle = "#ccd8e2"; ctx.fillRect(0, 0, VW, VH); ctx.globalAlpha = 1; }
    else if (sea === "autumn") { ctx.globalAlpha = 0.035 * gA; ctx.fillStyle = "#cf9038"; ctx.fillRect(0, 0, VW, VH); ctx.globalAlpha = 1; }
  }

  // dusk tint: one screen-space fill over the whole scene — no per-tile work,
  // no pixel reads. Skipped entirely by day / with the cycle pref off.
  if (ns > 0) {
    ctx.globalAlpha = ns * NIGHT_MAX_ALPHA;
    ctx.fillStyle = NIGHT_TINT;
    ctx.fillRect(0, 0, VW, VH);
    ctx.globalAlpha = 1;
  }

  if (ns > 0) drawNightLights(city, ns);

  ctx.save();
  worldTransform();
  // M21: live district wash under the cursor feedback, only while the tool is
  // active. Uses the same cull window the tile loop computed above.
  if (uiState.tool === "district") drawDistrictTint(city, minWX, maxWX, minWY, maxWY);
  if (uiState.hover && uiState.tool !== "query") drawCursor(city, uiState);
  ctx.restore();

  // M21: low-zoom neighborhood labels, drawn in SCREEN space (after the world
  // transform is restored) so text stays upright at every rotation.
  drawDistrictLabels(city);
  // M27: neighbor-city pennants at each WORLD map-edge midpoint. Positions are
  // world-fixed (never read cam.r for the MODEL) but PROJECTED through the same
  // worldX/worldY as tiles, so they ride the 90° rotation without special-casing.
  drawRegionLabels(city);
}

/* ---- postcard photo pass (G4) ---- */
// One frame of the world shot onto ANY canvas from a dedicated camera —
// without disturbing the live view. The render globals (cvs/ctx/cam) are
// swapped in, the frame draws with a transparent background (the postcard
// lays its sunset sky underneath), and a finally puts everything back
// exactly: the visible #game canvas and cam are never mutated. The
// terrain/night layer caches key on canvas size + camera, so they simply
// rebuild on the next live frame — a once-per-click cost, nothing per-frame.
function renderPhotoTo(canvas, city, uiState, cx, cy, cz) {
  const oCvs = cvs, oCtx = ctx, ox = cam.x, oy = cam.y, oz = cam.z, orr = cam.r;
  const oRS = RS, oVW = VW, oVH = VH; // GQ11: pin the photo pass to RS=1
  cvs = canvas;
  ctx = canvas.getContext("2d");
  // GQ11: the postcard canvas keeps its fixed attribute size — shoot at 1:1
  // so the photo is byte-identical at every display DPR.
  RS = 1; VW = canvas.width; VH = canvas.height;
  // M32c: shoot the postcard north-up regardless of the live view rotation, so
  // the photo is a stable keepsake and matches postcardBounds' r=0 framing.
  cam.x = cx; cam.y = cy; cam.z = cz; cam.r = 0;
  try {
    renderFrame(city, uiState, true);
  } finally {
    cvs = oCvs; ctx = oCtx;
    RS = oRS; VW = oVW; VH = oVH;
    cam.x = ox; cam.y = oy; cam.z = oz; cam.r = orr;
  }
}

// additive light pass over the dusk tint (G2): the per-tile light draws
// already happened in depth order inside the painter loop — here the
// finished, occlusion-punched layer is composited in ONE screen-space
// drawImage (replacing the old whole-queue post-scene blit), then the
// sky-borne disaster glows go on top: they hang above the skyline, so
// depth punching doesn't apply to them.
function drawNightLights(city, ns) {
  ctx.globalCompositeOperation = "lighter";
  // GQ11: device-px layer — 1:1 blit under identity, then back to the DPR base
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(nightLayer.cv, 0, 0); // per-sprite alpha was clamped at draw
  ctx.restore();
  // G16: moving car head/tail lights ride the same additive pass — queued this
  // frame by updateCars, they sparkle over the darkened streets
  if (carLightQ.length) {
    ctx.save();
    worldTransform();
    ctx.globalAlpha = 1;
    flushCarLights();
    ctx.restore();
  }
  const d = city.disaster;
  if (d) {
    ctx.save();
    worldTransform();
    ctx.globalAlpha = ns * NIGHT_LIGHT_ALPHA; // clamped (G1)
    const wx = worldX(d.x, d.y), wy = worldY(d.x, d.y);
    if (d.kind === "ufo") {
      // the abduction beam washes the ground green at night
      ctx.drawImage(SPR.ufoGlow.c, wx - SPR.ufoGlow.ox, wy - SPR.ufoGlow.oy - 16);
    } else if (d.kind === "tornado") {
      // lightning flicker around the funnel
      ctx.globalAlpha = ns * (0.35 + 0.65 * Math.abs(Math.sin(frame * 0.31)));
      ctx.drawImage(SPR.stormGlow.c, wx - SPR.stormGlow.ox, wy - SPR.stormGlow.oy - 24);
    } else if (d.kind === "riot") {
      // M29: the fires cast a warm restless glow over the neighborhood
      ctx.globalAlpha = ns * (0.4 + 0.4 * Math.abs(Math.sin(frame * 0.2)));
      const gr = ctx.createRadialGradient(wx, wy, 0, wx, wy, 46);
      gr.addColorStop(0, "rgba(255,150,40,0.9)"); gr.addColorStop(1, "rgba(255,120,20,0)");
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.ellipse(wx, wy, 46, 24, 0, 0, 7); ctx.fill();
    } else if (d.kind === "monster") {
      // M29: the kaiju's eye throws a lurid glow above the skyline
      ctx.globalAlpha = ns * 0.7;
      const gr = ctx.createRadialGradient(wx, wy - 40, 0, wx, wy - 40, 30);
      gr.addColorStop(0, "rgba(120,255,120,0.5)"); gr.addColorStop(1, "rgba(80,200,80,0)");
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.arc(wx, wy - 40, 30, 0, 7); ctx.fill();
    }
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
}

/* ---------------- fire visuals (G3) ---------------- */
// warm ground glow on the burning tile's apron: the prebaked fireGlow disc
// squashed to the ground plane at low alpha. Drawn inside the painter loop
// BEFORE the tile's own building, so it tints the apron, not the facade.
function drawFireGround(wx, wy) {
  ctx.globalAlpha = FIRE_DAY_ALPHA;
  ctx.drawImage(SPR.fireGlow.c, wx - 48, wy - 26, 96, 52);
  ctx.globalAlpha = 1;
}

// char overlay: the sprite's own silhouette refilled near-black, cached on
// the sprite object at first use. Drawn at FIRE_CHAR_ALPHA over the
// pristine sprite, the facade lands around half its normal luminance while
// the tile burns — and reverts the moment city.fire[i] clears, since the
// overlay simply stops being drawn.
function drawChar(spr, wx, wy) {
  if (!spr.char) {
    const c = document.createElement("canvas");
    c.width = spr.c.width; c.height = spr.c.height;
    const g = c.getContext("2d");
    g.drawImage(spr.c, 0, 0);
    g.globalCompositeOperation = "source-in";
    g.fillStyle = "#16100c";
    g.fillRect(0, 0, c.width, c.height);
    spr.char = c;
  }
  ctx.globalAlpha = FIRE_CHAR_ALPHA;
  ctx.drawImage(spr.char, wx - spr.ox, wy - spr.oy);
  ctx.globalAlpha = 1;
}

/* GP10a S4: the BLIGHT WASH — the drawChar idiom above, verbatim, with a rust
   grime colour instead of char-black and a per-band alpha instead of one
   constant. The sprite's own silhouette is refilled (source-in) into a canvas
   cached on the sprite object at first use and blitted over the PRISTINE
   sprite, so a lot that recovers simply stops being washed and reverts to the
   exact pixels it had before.

   WHY THIS AND NOT A NEW BAKE, which is the whole reason it is written this
   way: a new sprite bake would consume ART_RNG/R() draws and re-pin every
   frozen sprite anchor downstream of it. This path bakes nothing, draws no
   random numbers and is a pure function of distress[i] — so all four camera
   rotations are free (M32a/b) and the shipped sprite set is byte-unchanged.
   It is also DAY-LAYER ONLY: it never touches nightAdd/nightPunch or spr.night,
   so G1/G2 night legibility and the night-layer cache key are untouched.
   Three alphas, one per readout band — measured to differ from the unwashed
   sprite and from each other across the sprite bbox by well over the 2% bar,
   because the silhouette covers ~18% of the bbox on an r2. */
const BLIGHT_ALPHA = [0.16, 0.28, 0.42];
function drawBlight(spr, wx, wy, band) {
  if (!spr.blight) {
    const c = document.createElement("canvas");
    c.width = spr.c.width; c.height = spr.c.height;
    const g = c.getContext("2d");
    g.drawImage(spr.c, 0, 0);
    g.globalCompositeOperation = "source-in";
    g.fillStyle = "#6b4526";           // rust/sepia grime
    g.fillRect(0, 0, c.width, c.height);
    spr.blight = c;
  }
  ctx.globalAlpha = BLIGHT_ALPHA[band];
  ctx.drawImage(spr.blight, wx - spr.ox, wy - spr.oy);
  ctx.globalAlpha = 1;
}

// flames as three stacked hue bands — wide dark-red base, orange mid,
// yellow core — licking 40-70px above the tile base. Tongue heights and
// sway are pure sin phases of (frame, tile index): NO Math.random anywhere
// in the per-frame flame path, so consecutive frames differ only along the
// slowly-moving tongue edges instead of strobing.
const FLAME_BASE = "rgb(178,44,18)";  // dark red
const FLAME_MID = "rgb(255,132,24)";  // orange
const FLAME_CORE = "rgb(255,228,92)"; // yellow

function flameLayer(wx, wy, w, hMax, t, n, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(wx - w, wy + 3);
  for (let k = 0; k < n; k++) {
    const v0 = wx - w + 2 * w * k / n;
    const v1 = wx - w + 2 * w * (k + 1) / n;
    const h = hMax * (0.82 + 0.18 * Math.sin(t * 1.7 + k * 2.63));
    const tip = (v0 + v1) / 2 + Math.sin(t + k * 2.1) * 2.5;
    ctx.quadraticCurveTo((v0 + tip) / 2, wy - h * 0.55, tip, wy - h);
    ctx.quadraticCurveTo((v1 + tip) / 2, wy - h * 0.55, v1, wy + 3);
  }
  ctx.closePath();
  ctx.fill();
}

function drawFlames(wx, wy, i) {
  const t = frame * 0.045 + (i % 97) * 0.83; // per-tile phase offset
  flameLayer(wx, wy, 17, 52, t, 3, FLAME_BASE);
  flameLayer(wx, wy, 12, 38, t + 1.9, 3, FLAME_MID);
  flameLayer(wx, wy, 7, 24, t + 3.7, 2, FLAME_CORE);
}

/* ---------------- cars ---------------- */
// a cheap pool of cars that drive tile-to-tile along connected roads.
// pool size scales with total congestion (and now map area, G16) so busy
// cities look busy. `ns` is the night strength: when > 0 each car queues a
// headlight cone + taillight into carLightQ for the additive night pass.
function updateCars(city, ns, speed = 1) {
  if (!carSprites.x) buildCarSprites();
  carLightQ.length = 0;
  const roads = [];
  let total = 0;
  for (let i = 0; i < city.over.length; i++)
    if (city.over[i] === OV.ROAD || city.over[i] === OV.WIREROAD ||
        city.over[i] === OV.XWAY || city.over[i] === OV.RAMP) { roads.push(i); total += city.traffic[i]; } // M26: cars use crossings; GP4a: traffic dots ride the expressway (render-only aliveness)

  // G16: cap scales with map area (carCap) instead of the flat 70
  const want = roads.length >= 8 ? Math.min(carCap(), 6 + (total / 45 | 0)) : 0;
  while (cars.length > want) cars.pop();
  // paused sim (speed 0): keep + still draw existing cars, but don't spawn new
  // ones (they'd freeze mid-tile), and don't advance progress below.
  for (let tries = 0; speed > 0 && tries < 12 && cars.length < want && roads.length; tries++) {
    const i = roads[(Math.random() * roads.length) | 0];
    if (Math.random() * 160 > city.traffic[i] + 25) continue; // favor busy roads
    const x = i % MAP, y = (i / MAP) | 0;
    cars.push({ id: carSeq++, fx: x, fy: y, tx: x, ty: y, x, y, p: 1,
                spd: 0.1, col: carSeq % CAR_COLS.length });
  }

  for (let k = cars.length - 1; k >= 0; k--) {
    const c = cars[k];
    c.p += c.spd * speed;
    if (c.p >= 1) {
      const px = c.fx, py = c.fy;
      c.fx = c.tx; c.fy = c.ty; c.p = 0;
      const i = c.fy * MAP + c.fx;
      if (city.over[i] !== OV.ROAD && city.over[i] !== OV.WIREROAD &&
          city.over[i] !== OV.XWAY && city.over[i] !== OV.RAMP) { cars.splice(k, 1); continue; } // road/crossing/expressway got dozed (M26/GP4a)
      const opts = [], back = [];
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const X = c.fx + dx, Y = c.fy + dy;
        if (X < 0 || Y < 0 || X >= MAP || Y >= MAP) continue;
        const no = city.over[Y * MAP + X];
        if (no !== OV.ROAD && no !== OV.WIREROAD && no !== OV.XWAY && no !== OV.RAMP) continue; // M26: cars path through crossings; GP4a: and onto the expressway
        (X === px && Y === py ? back : opts).push([X, Y]);
      }
      const pool = opts.length ? opts : back; // dead end -> U-turn
      if (!pool.length) { cars.splice(k, 1); continue; }
      const [nx, ny] = pool[(Math.random() * pool.length) | 0];
      c.tx = nx; c.ty = ny;
      // congestion slows; winter (M12) slows everyone further on snowy roads
      const wMul = seasonOf(city.month) === "winter" ? 0.7 : 1;
      c.spd = Math.max(0.03, (0.13 - city.traffic[i] * 0.0004) * wMul);
    }
    c.x = c.fx + (c.tx - c.fx) * c.p;
    c.y = c.fy + (c.ty - c.fy) * c.p;
    // GP4a fix: cars on the elevated deck ride at DECK height — the xway
    // sprite is baked lifted 6px (XW_LIFT, sprites.js) but cars were drawn at
    // ground-plane coords, straddling the guardrail one body-height low
    // (panel defect). Lift interpolates from-tile -> to-tile (ramp = half
    // height) so a car climbs the ramp smoothly. Render-only aliveness.
    const lift = (X, Y) => {
      const o = city.over[Y * MAP + X];
      return o === OV.XWAY ? 6 : o === OV.RAMP ? 3 : 0;
    };
    const wx = worldX(c.x, c.y),
          wy = worldY(c.x, c.y) - (lift(c.fx, c.fy) * (1 - c.p) + lift(c.tx, c.ty) * c.p);
    // cull off-screen cars: the pool is map-sized (G16) but only visible cars
    // pay draw + night-light cost, so a busy 128 map stays cheap
    const sx = (wx - cam.x) * cam.z + VW / 2;
    const sy = (wy - cam.y) * cam.z + VH / 2;
    if (sx < -40 || sx > VW + 40 || sy < -70 || sy > VH + 50) continue;
    // G16: pick the body sprite for this car's travel axis so it points down
    // the road it's on — one of two iso shapes, never an axis-aligned rect.
    // M32a: rotate the tile travel delta into view space so the axis→body pick
    // and the headlight vector track the street's actual on-screen diagonal at
    // every camera rotation. At r=0 (du,dv)=(tdx,tdy), identical to HEAD.
    const rf = rot(c.fx, c.fy, cam.r), rt = rot(c.tx, c.ty, cam.r);
    const du = rt.u - rf.u, dv = rt.v - rf.v;
    const axis = du !== 0 ? "x" : "y";
    const spr = carSprites[axis][c.col];
    ctx.drawImage(spr.c, wx - spr.ox, wy - spr.oy);
    // G16: after dusk, queue this car's lights at its screen-forward heading —
    // headlight cone ahead, taillight behind — for the additive night pass.
    if (ns > 0 && (du || dv)) {
      const rx = (du - dv) * HW, ry = (du + dv) * HH; // screen forward
      const inv = 1 / (Math.hypot(rx, ry) || 1);
      carLightQ.push(wx, wy, rx * inv, ry * inv);
    }
  }
}

// G16: flush the frame's car lights onto the scene additively (called from
// drawNightLights, already in "lighter" mode over the dusk tint) — warm-white
// headlight cones and red taillights that move with the cars, so trafficked
// streets sparkle after dark. This is the per-frame companion to the cached
// G2 night-light layer (lamps/window glow): those are static within a sim
// tick and baked once; cars move every frame and can't be cached, so they
// ride in this same additive pass instead.
function flushCarLights() {
  for (let k = 0; k < carLightQ.length; k += 4) {
    const x = carLightQ[k], y = carLightQ[k + 1], fx = carLightQ[k + 2], fy = carLightQ[k + 3];
    const px = -fy, py = fx;                 // screen perpendicular
    const nose = x + fx * 5, noseY = y + fy * 5 - 3;
    const tipX = x + fx * 20, tipY = y + fy * 20 - 3;
    // soft wide cone
    ctx.fillStyle = "rgba(255,232,180,0.32)";
    ctx.beginPath();
    ctx.moveTo(nose, noseY);
    ctx.lineTo(tipX + px * 8, tipY + py * 8);
    ctx.lineTo(tipX - px * 8, tipY - py * 8);
    ctx.closePath(); ctx.fill();
    // bright warm core near the lamps
    const cX = x + fx * 11, cY = y + fy * 11 - 3;
    ctx.fillStyle = "rgba(255,245,215,0.85)";
    ctx.beginPath();
    ctx.moveTo(nose, noseY);
    ctx.lineTo(cX + px * 3, cY + py * 3);
    ctx.lineTo(cX - px * 3, cY - py * 3);
    ctx.closePath(); ctx.fill();
    // red taillights behind the car
    const bx = x - fx * 6, by = y - fy * 6 - 3;
    ctx.fillStyle = "rgba(255,32,32,1)";
    ctx.fillRect(bx + px * 2.5 - 1, by + py * 2.5 - 1, 3, 2);
    ctx.fillRect(bx - px * 2.5 - 2, by - py * 2.5 - 1, 3, 2);
  }
}

// G16: a 2-puff industrial plume — a lead puff and a younger trailing puff
// just below it — so a stack emits a connected rising column instead of one
// lone dot. Guards the shared budget.
// M32a: the screen-back (argmin view-depth) footprint corner a building's
// sprite is positioned from — the SAME corner the painter loop draws from
// (render.js ~488), so overlays pinned to a building (smoke plumes) stay on the
// sprite at every rotation instead of detaching by up to a tile. A 1x1 building
// returns its own tile, so its plume is unchanged at every r. At r=0 the min
// (u+v) corner is the anchor (ax,ay), so r=0 output is byte-identical to HEAD.
function backCorner(ax, ay, size) {
  let bx = ax, by = ay, minD = Infinity;
  for (let cy = 0; cy < size; cy++) for (let cx = 0; cx < size; cx++) {
    const q = rot(ax + cx, ay + cy, cam.r), d = q.u + q.v;
    if (d < minD) { minD = d; bx = ax + cx; by = ay + cy; }
  }
  return { x: bx, y: by };
}

function pushPlume(x, y, drift) {
  if (smoke.length >= SMOKE_MAX) return;
  smoke.push({ x, y, age: 0, drift });
  if (smoke.length < SMOKE_MAX)
    smoke.push({ x: x + drift * 4 - 2, y: y + 7, age: 6, drift: drift * 0.6 });
}

function updateSmoke(city) {
  // spawn from coal plants, big industry — and burning tiles (G3): each
  // fire feeds dark rising puffs into the shared pool.
  // G16: scan from a RANDOM origin and wrap so the whole map shares the puff
  // budget. HEAD scanned ascending from index 0 and broke at the cap, which
  // starved the high-index lower-right industry (it never got a turn); the
  // randomized start gives every district a fair share.
  if (frame % 6 === 0 && smoke.length < SMOKE_MAX) {
    const N = city.over.length;
    const start = (Math.random() * N) | 0;
    for (let s = 0; s < N; s++) {
      if (smoke.length >= SMOKE_MAX) break;
      const i = (start + s) % N;
      const t = city.over[i];
      if (city.fire[i]) {
        if (Math.random() < 0.2) {
          const x = i % MAP, y = (i / MAP) | 0;
          smoke.push({ x: worldX(x, y) + Math.random() * 18 - 9,
                       y: worldY(x, y) - 26 - Math.random() * 8,
                       age: 0, drift: Math.random() * 0.5 - 0.25, fire: true });
        }
      } else if (t === OV.COAL && city.anc[i] === i && Math.random() < 0.5) {
        // M32a: anchor the plume to the sprite's screen-back corner so it stays
        // on the stack when the view is rotated (the 2x2 sprite moves corners).
        const b = backCorner(i % MAP, (i / MAP) | 0, sizeOf(t));
        pushPlume(worldX(b.x, b.y) - 18, worldY(b.x, b.y) + HH - 78, Math.random() * 0.4 - 0.1);
      } else if (t === OV.GAS && city.anc[i] === i && Math.random() < 0.42) {
        // M19: gas plants smoke from their short stacks (coal-level smog)
        const b = backCorner(i % MAP, (i / MAP) | 0, sizeOf(t));
        pushPlume(worldX(b.x, b.y) - 14, worldY(b.x, b.y) + HH - 62, Math.random() * 0.4 - 0.1);
      } else if (t === OV.NUKE && city.anc[i] === i && Math.random() < 0.3) {
        // GQ10: steam wisps off the cooling-tower lip — live-pool Math.random
        // is the established aliveness pattern (never in a bake). The offset
        // targets the tall W tower's lip in the 3x3 sprite.
        const b = backCorner(i % MAP, (i / MAP) | 0, sizeOf(t));
        pushPlume(worldX(b.x, b.y) - 38, worldY(b.x, b.y) + HH - 62, Math.random() * 0.3 - 0.05);
      } else if (t === OV.SEAPORT && city.anc[i] === i && city.portWork[i] && Math.random() < 0.42) {
        // GP2: a WORKING seaport is the largest single point smog source in the
        // game (SEAPORT_SMOG x 9 tiles) — cranes, shunting diesels and ships at
        // idle. It has to look like it. Gated on the same portWork flag the
        // pollution loop reads, so a dark or cut-off terminal is clean AND
        // silent. Live-pool Math.random, never a bake (the COAL/NUKE pattern).
        const b = backCorner(i % MAP, (i / MAP) | 0, sizeOf(t));
        pushPlume(worldX(b.x, b.y) - 16, worldY(b.x, b.y) + HH - 56, Math.random() * 0.4 - 0.1);
      // GP5b: clean high-tech industry stops smoking — spawn-gated in map
      // space (never reads cam.r), so the drop is visible at every rotation
      // and the pool drains naturally as the last dirty plumes age out.
      } else if (t === OV.ZI && city.lvl[i] === 3 && city.powered[i] && !city.isCleanInd() && Math.random() < 0.28) {
        const x = i % MAP, y = (i / MAP) | 0; // ZI is 1x1 — its own tile at every r
        pushPlume(worldX(x, y) - 12, worldY(x, y) - 68, Math.random() * 0.3);
      }
    }
  }
  // soft-edged puffs (G3): prebaked radial-falloff sprites, scaled up and
  // faded out as they age — fire smoke is darker and rises faster; G16 grows
  // the warm-gray industrial puffs faster so plumes billow, not trickle.
  for (let k = smoke.length - 1; k >= 0; k--) {
    const p = smoke[k];
    const life = p.fire ? 80 : 90;
    p.age++; p.y -= p.fire ? 0.55 : 0.45; p.x += p.drift;
    if (p.age > life) { smoke.splice(k, 1); continue; }
    const s = p.fire ? SPR.puffFire : SPR.puff;
    const r = (p.fire ? 6 : 5) + p.age * (p.fire ? 0.14 : 0.16);
    ctx.globalAlpha = 1 - p.age / life;
    ctx.drawImage(s.c, p.x - r, p.y - r, r * 2, r * 2);
  }
  ctx.globalAlpha = 1;
}

/* ---------------- news helicopter (M18) ---------------- */
/* Action News 99's traffic chopper. PRESENTATION-ONLY state, exactly like
   the cars[] / smoke[] pools: it lives here in render.js, is NEVER
   serialized, and is cleared by newCity() / loadCity() / startScenario().

   CHOPPER_TRAFFIC_T — the congestion threshold on city.traffic (ROAD tiles
   only) that makes a hotspot newsworthy. 160 sits just under the citizen
   complaint bar (COMPLAINT_T.traffic = 170): the chopper shows up right as
   the faxes start. If no road tile reaches it, the chopper never launches.

   CHOPPER_CHANCE — probability, per MONTH ROLLOVER, that a qualifying city
   actually gets a flyover. Rolled only by chopperMonthTick(), which is
   invoked from tick()'s % 24 === 0 branch in sim.js and nowhere else.

   CHOPPER_LIFE — total flight time in FRAMES (rAF frames, the shared
   `frame` counter's unit). 600 frames ≈ 10 s at 60 fps: approach, a long
   hover over the hotspot, then automatic despawn — congestion does NOT
   need to clear for the chopper to leave.

   CHOPPER_ORBIT — the documented hover-orbit radius in TILES around the
   target: once on station the chopper circles the hotspot, never straying
   past this radius (it actually flies at 0.8 * CHOPPER_ORBIT).

   State is exposed for tests as the global `chopper`:
     null when grounded, else { x, y,      current position (tile coords)
                                tx, ty,    target road tile (the hotspot)
                                phase,     0 = approach, 1 = hover/orbit
                                ttl,       remaining life, frames
                                ang }      current orbit angle            */
const CHOPPER_TRAFFIC_T = 160; // spawn gate: max road congestion must reach this
const CHOPPER_CHANCE = 0.35;   // per-month-rollover spawn probability
const CHOPPER_LIFE = 600;      // flight lifetime, frames (~10 s at 60 fps)
const CHOPPER_ORBIT = 2;       // hover-orbit radius around the hotspot, tiles
const CHOPPER_ALT = 54;        // cruising altitude, px above the ground anchor
const CHOPPER_SPD = 0.18;      // approach speed, tiles per frame
const CHOPPER_HIT_R = 26;      // click hit radius, px at zoom 1 (scales w/ cam.z)
let chopper = null;

// Monthly spawn DECISION — called from tick()'s month-rollover branch in
// sim.js, and from no other sim/render/UI path. One CHOPPER_CHANCE roll per
// rollover; the congestion gate itself lives in chopperTrySpawn.
// GP1b: this roll sits ON the sim tick path (sim.js tick() calls it from the
// month-rollover branch), so it must not draw global Math.random. It is
// COSMETIC — a flyover changes no sim state — so it takes the stateless
// (seed, tickCount) hash rather than a cursor stream: retuning CHOPPER_CHANCE
// or adding a second flyover kind must never re-pin the whole simulation.
function chopperMonthTick(c) {
  if (chopper) return;                          // at most one chopper airborne
  if (c.rngHash(HZ.FX_CHOPPER, c.tickCount, 0) >= CHOPPER_CHANCE) return; // no flyover this month
  chopperTrySpawn(c);
}

// Documented, globally invokable spawner. Scans city.traffic once (spawn
// time only — never per frame) for the maximum-congestion ROAD tile; if that
// max is below CHOPPER_TRAFFIC_T (or the map has no roads at all) it spawns
// nothing and returns false. Otherwise the chopper launches from just off
// the nearest map edge, targeting the argmax tile itself — by construction
// a road tile at/above the threshold inside the top congestion cluster.
// Refused (false) while a chopper is already airborne.
function chopperTrySpawn(c) {
  c = c || city;
  if (chopper || !c) return false;
  let best = -1, bestV = -1;
  for (let i = 0; i < c.over.length; i++)
    if ((c.over[i] === OV.ROAD || c.over[i] === OV.WIREROAD) && c.traffic[i] > bestV) { bestV = c.traffic[i]; best = i; } // M26
  if (best < 0 || bestV < CHOPPER_TRAFFIC_T) return false;
  const tx = best % MAP, ty = (best / MAP) | 0;
  // launch point: 4 tiles beyond the nearest map edge (offscreen of the map)
  let sx = tx, sy = ty;
  const m = Math.min(tx, MAP - 1 - tx, ty, MAP - 1 - ty);
  if (m === tx) sx = -4;
  else if (m === MAP - 1 - tx) sx = MAP + 3;
  else if (m === ty) sy = -4;
  else sy = MAP + 3;
  chopper = { x: sx, y: sy, tx, ty, phase: 0, ttl: CHOPPER_LIFE, ang: 0 };
  return true;
}

// Grounds the chopper instantly. Called by newCity() / loadCity() /
// startScenario() so presentation state never outlives its city or map size.
function chopperClear() { chopper = null; }

// Screen-space hit test against the chopper's DRAWN BODY, i.e. at its
// altitude offset, not its ground shadow. (sx, sy) are canvas-relative
// pixels. The radius is CHOPPER_HIT_R scaled by cam.z, so the clickable
// area tracks the sprite at every zoom. Used by BOTH the mouse path and the
// M15 touch-tap path in bindCanvas (ui.js); with no chopper airborne it
// short-circuits to false and legacy input is untouched.
function chopperHitTest(sx, sy) {
  if (!chopper) return false;
  const px = (worldX(chopper.x, chopper.y) - cam.x) * cam.z + VW / 2;
  const py = (worldY(chopper.x, chopper.y) - CHOPPER_ALT - cam.y) * cam.z + VH / 2;
  const r = CHOPPER_HIT_R * cam.z;
  return (sx - px) * (sx - px) + (sy - py) * (sy - py) <= r * r;
}

// canvas-relative screen point of the drawn body (tests + UI, not per-frame)
function chopperScreenXY() {
  if (!chopper) return null;
  return {
    x: (worldX(chopper.x, chopper.y) - cam.x) * cam.z + VW / 2,
    y: (worldY(chopper.x, chopper.y) - CHOPPER_ALT - cam.y) * cam.z + VH / 2,
  };
}

// O(1): is the chopper's body inside the viewport (small margin)? Feeds the
// ambience scheduler's rotor thump — never used for any map scan.
function chopperOnScreen() {
  if (!chopper) return false;
  const sx = (worldX(chopper.x, chopper.y) - cam.x) * cam.z + VW / 2;
  const sy = (worldY(chopper.x, chopper.y) - CHOPPER_ALT - cam.y) * cam.z + VH / 2;
  return sx >= -80 && sx <= VW + 80 && sy >= -80 && sy <= VH + 80;
}

// Per-frame chopper update + draw. Strictly O(1) — one entity, no map scans,
// no allocations: arithmetic on the existing state object plus drawImage of
// sprites prebuilt once in buildSprites() (SPR.chop / chopRotor / chopShadow).
function updateChopper(city) {
  const ch = chopper;
  if (!ch) return;
  if (--ch.ttl <= 0) { chopper = null; return; } // lifetime up: despawn
  if (ch.phase === 0) {
    // approach: fly straight at the hotspot until the orbit ring is reached
    const dx = ch.tx - ch.x, dy = ch.ty - ch.y;
    const d = Math.hypot(dx, dy);
    if (d <= CHOPPER_ORBIT) {
      ch.phase = 1;
      ch.ang = Math.atan2(ch.y - ch.ty, ch.x - ch.tx);
    } else {
      ch.x += dx / d * CHOPPER_SPD;
      ch.y += dy / d * CHOPPER_SPD;
    }
  } else {
    // hover: circle the hotspot at 0.8 * CHOPPER_ORBIT, always moving
    ch.ang += 0.025;
    ch.x = ch.tx + Math.cos(ch.ang) * CHOPPER_ORBIT * 0.8;
    ch.y = ch.ty + Math.sin(ch.ang) * CHOPPER_ORBIT * 0.8;
  }
  const wx = worldX(ch.x, ch.y), wy = worldY(ch.x, ch.y);
  const bob = Math.sin(frame * 0.13) * 2;         // gentle altitude bobbing
  const by = wy - CHOPPER_ALT + bob;
  // soft ground shadow at the terrain anchor beneath the chopper
  ctx.drawImage(SPR.chopShadow.c, wx - SPR.chopShadow.ox, wy - SPR.chopShadow.oy);
  // fuselage (prebuilt once), then the rotor frame cycled by the shared
  // `frame` counter — 3 prebaked blur frames, new one every 3 frames
  ctx.drawImage(SPR.chop.c, wx - SPR.chop.ox, by - SPR.chop.oy);
  const rot = SPR.chopRotor[(frame / 3 | 0) % 3];
  ctx.drawImage(rot.c, wx - rot.ox, by - 15 - rot.oy);
}

// GQ8: aliveness instrumentation — an O(1) snapshot of every ambient-motion
// pool for the regression harness (traffic, smoke, night car lights, the
// chopper, animated water — and, since GP4b, the metro trains). Globally
// reachable as a bare name; never called per frame by the renderer itself.
// trainLines/trains read the trainStats snapshot computeTrains maintains:
// lines with >= 2 live stations, and consists queued last frame.
function alivenessStats() {
  return { cars: cars.length, carCap: carCap(), smoke: smoke.length,
           smokeMax: SMOKE_MAX, carLights: carLightQ.length / 4,
           chopper: !!chopper, waterFrames: WATER_FRAMES,
           trainLines: trainStats.lines, trains: trainStats.trains };
}

function drawDisaster(city) {
  const d = city.disaster;
  if (!d) return;
  const wx = worldX(d.x, d.y), wy = worldY(d.x, d.y);
  if (d.kind === "tornado") {
    // G16: a dark two-tone rotating funnel with a dust skirt, orbiting debris
    // and a wide slow sway — HEAD's seven faint gray ellipses were nearly
    // invisible over grass.
    const sway = Math.sin(frame * 0.05) * 11;              // wide, slow sway
    // wide low-alpha dust skirt kicked up at the base
    ctx.fillStyle = "rgba(150,140,120,0.24)";
    ctx.beginPath(); ctx.ellipse(wx, wy + 4, 36, 12, 0, 0, 7); ctx.fill();
    ctx.fillStyle = "rgba(120,112,96,0.16)";
    ctx.beginPath(); ctx.ellipse(wx, wy + 2, 48, 9, 0, 0, 7); ctx.fill();
    // funnel: stacked ellipses, dark core + lighter rotating rim, narrow at
    // the base and flaring toward the top
    for (let k = 0; k < 10; k++) {
      const fy = wy + 2 - k * 10;
      const r = 5 + k * 2.9;
      const cxk = wx + sway * (k / 10) + Math.cos(frame * 0.22 + k * 0.9) * (2 + k * 0.5);
      ctx.fillStyle = `rgba(34,32,40,${Math.min(0.95, 0.94 - k * 0.05)})`;
      ctx.beginPath(); ctx.ellipse(cxk, fy, r, r * 0.42, 0, 0, 7); ctx.fill();
      const rim = frame * 0.3 + k * 0.7;                   // sweeps around = spin
      ctx.fillStyle = `rgba(158,156,166,${0.5 - k * 0.028})`;
      ctx.beginPath(); ctx.ellipse(cxk + Math.cos(rim) * r * 0.55, fy, r * 0.34, r * 0.28, 0, 0, 7); ctx.fill();
    }
    // 8 dark debris specks orbiting the lower funnel
    for (let k = 0; k < 8; k++) {
      const a = frame * 0.17 + k * (Math.PI / 4);
      const rr = 20 + (k % 3) * 7;
      ctx.fillStyle = "#241f18";
      ctx.fillRect(wx + Math.cos(a) * rr, wy - 8 + Math.sin(a) * rr * 0.42, 3, 3);
    }
  } else if (d.kind === "ufo") {
    // G16: hoist the saucer above the skyline (~140px, HEAD sat at ~64px,
    // below the towers), run the abduction beam all the way to the ground with
    // a moving shadow, and slow/enlarge the marker blink (frame%32, 3px).
    const bob = Math.sin(frame * 0.08) * 5;
    const drift = Math.sin(frame * 0.05) * 6;              // lateral hover drift
    const sx = wx + drift, alt = 150, sy = wy - alt + bob; // saucer center
    // moving ground shadow ellipse (tracks the saucer's drift + bob)
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath(); ctx.ellipse(sx, wy + 2, 20 - bob * 0.4, 6, 0, 0, 7); ctx.fill();
    // abduction beam — gradient from the saucer down to the ground tile
    const gr = ctx.createLinearGradient(sx, sy, wx, wy);
    gr.addColorStop(0, "rgba(150,255,150,0.5)");
    gr.addColorStop(0.65, "rgba(125,255,145,0.24)");
    gr.addColorStop(1, "rgba(120,255,140,0.25)");
    ctx.fillStyle = gr;
    ctx.beginPath();
    ctx.moveTo(sx - 8, sy + 4); ctx.lineTo(sx + 8, sy + 4);
    ctx.lineTo(wx + 24, wy); ctx.lineTo(wx - 24, wy);
    ctx.closePath(); ctx.fill();
    // saucer body
    ctx.fillStyle = "#6c7686";
    ctx.beginPath(); ctx.ellipse(sx, sy + 3, 24, 6, 0, 0, Math.PI); ctx.fill();
    ctx.fillStyle = "#aab4c2";
    ctx.beginPath(); ctx.ellipse(sx, sy, 24, 8, 0, 0, 7); ctx.fill();
    ctx.fillStyle = "#d2dbe8";
    ctx.beginPath(); ctx.ellipse(sx, sy - 6, 11, 7, 0, Math.PI, 0); ctx.fill();
    for (let k = 0; k < 5; k++) {
      ctx.fillStyle = (frame + k * 6) % 32 < 16 ? "#ff5b5b" : "#ffe95b";
      ctx.beginPath(); ctx.arc(sx - 18 + k * 9, sy + 2, 3, 0, 7); ctx.fill();
    }
  } else if (d.kind === "quake") {
    // M29: expanding concentric ground-crack ripple rings centered on the
    // epicenter's projected screen point, radius keyed to d.r, plus jagged
    // crack spokes racing outward.
    ctx.strokeStyle = "rgba(92,72,56,0.7)";
    ctx.lineWidth = 2;
    for (let k = 0; k < 3; k++) {
      const rad = (d.r + k * 0.6) * HW * 0.9;
      if (rad <= 0) continue;
      ctx.globalAlpha = Math.max(0, 0.7 - k * 0.22);
      ctx.beginPath(); ctx.ellipse(wx, wy, rad, rad * 0.5, 0, 0, 7); ctx.stroke();
    }
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = "rgba(38,28,22,0.85)";
    const rr = d.r * HW * 0.9;
    for (let k = 0; k < 6; k++) {
      const a = k * (Math.PI / 3) + Math.sin(frame * 0.2) * 0.05;
      ctx.beginPath(); ctx.moveTo(wx, wy);
      ctx.lineTo(wx + Math.cos(a) * rr, wy + Math.sin(a) * rr * 0.5); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  } else if (d.kind === "flood") {
    // M29: translucent blue diamond over EACH flooded tile, projected through
    // worldX/worldY so the sheet rotates correctly under cam.r.
    ctx.fillStyle = "rgba(40,110,200,0.4)";
    for (const fi of d.flooded) {
      const fx = fi % MAP, fy = (fi / MAP) | 0;
      const fwx = worldX(fx, fy), fwy = worldY(fx, fy);
      ctx.beginPath();
      ctx.moveTo(fwx, fwy - HH); ctx.lineTo(fwx + HW, fwy);
      ctx.lineTo(fwx, fwy + HH); ctx.lineTo(fwx - HW, fwy);
      ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = "rgba(150,200,255,0.3)"; // shimmer on the leading edge
    for (const fi of (d.frontier || [])) {
      const fx = fi % MAP, fy = (fi / MAP) | 0;
      const fwx = worldX(fx, fy), fwy = worldY(fx, fy);
      ctx.beginPath();
      ctx.moveTo(fwx, fwy - HH); ctx.lineTo(fwx + HW, fwy);
      ctx.lineTo(fwx, fwy + HH); ctx.lineTo(fwx - HW, fwy);
      ctx.closePath(); ctx.fill();
    }
  } else if (d.kind === "riot") {
    // M29: flame/smoke plumes + small rioter figures ringing the epicenter's
    // projected point.
    for (let k = 0; k < 7; k++) {
      const a = k * (Math.PI * 2 / 7) + frame * 0.02;
      const rr = 10 + (k % 3) * 12;
      const px = wx + Math.cos(a) * rr, py = wy + Math.sin(a) * rr * 0.5;
      const fl = 6 + (Math.sin(frame * 0.3 + k) + 1) * 3;
      ctx.fillStyle = "rgba(255,140,30,0.75)";
      ctx.beginPath(); ctx.ellipse(px, py - fl * 0.5, 3, fl, 0, 0, 7); ctx.fill();
      ctx.fillStyle = "rgba(255,220,60,0.8)";
      ctx.beginPath(); ctx.ellipse(px, py - fl * 0.3, 1.6, fl * 0.5, 0, 0, 7); ctx.fill();
      ctx.fillStyle = "rgba(60,55,55,0.3)"; // smoke
      ctx.beginPath(); ctx.arc(px, py - fl - 6, 4, 0, 7); ctx.fill();
      ctx.fillStyle = "#20242c"; // rioter figure
      ctx.fillRect(px - 1, py, 2, 5);
    }
  } else if (d.kind === "monster") {
    // M29: a dark reptilian kaiju silhouette hoisted above the tile with a
    // stomp-dust skirt.
    ctx.fillStyle = "rgba(120,110,95,0.28)"; // stomp dust
    ctx.beginPath(); ctx.ellipse(wx, wy + 4, 34, 12, 0, 0, 7); ctx.fill();
    const bob = Math.sin(frame * 0.12) * 3;
    const bx = wx, by = wy - 40 + bob;
    ctx.fillStyle = "#243027";
    ctx.fillRect(bx - 11, by + 18, 8, 26); ctx.fillRect(bx + 3, by + 18, 8, 26); // legs
    ctx.beginPath(); // tail
    ctx.moveTo(bx + 6, by + 20); ctx.quadraticCurveTo(bx + 40, by + 30, bx + 46, by + 8);
    ctx.lineTo(bx + 40, by + 6); ctx.quadraticCurveTo(bx + 30, by + 22, bx + 4, by + 12);
    ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.ellipse(bx, by + 6, 15, 22, 0, 0, 7); ctx.fill(); // body
    ctx.fillStyle = "#3a4d3a"; // dorsal spikes
    for (let k = 0; k < 4; k++) {
      ctx.beginPath();
      ctx.moveTo(bx - 6 + k * 4, by - 12 + k * 6);
      ctx.lineTo(bx - 2 + k * 4, by - 20 + k * 6);
      ctx.lineTo(bx + 2 + k * 4, by - 12 + k * 6);
      ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = "#243027"; // head + snout
    ctx.beginPath(); ctx.ellipse(bx - 4, by - 20, 10, 9, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.moveTo(bx - 14, by - 22); ctx.lineTo(bx - 22, by - 18);
    ctx.lineTo(bx - 12, by - 16); ctx.closePath(); ctx.fill();
    ctx.fillStyle = (frame % 20 < 10) ? "#ff5b3b" : "#ffd23b"; // glowing eye
    ctx.beginPath(); ctx.arc(bx - 10, by - 22, 2, 0, 7); ctx.fill();
    ctx.fillStyle = "#243027"; // arms
    ctx.fillRect(bx - 14, by, 7, 4); ctx.fillRect(bx + 8, by, 7, 4);
  }
}

/* GP5a: service-placement coverage ghost. For the four coverage tools the
   cursor pass previews EXACTLY the tile set stampCoverage would write nonzero
   potency to (city.serviceGhost — the honesty contract), plus a dim over the
   existing same-type stations so overlap reads at a glance. All model reads
   are memoized on (city object, tool, hover x/y, dept funding, tickCount):
   hover moves and slider drags are event-rate, not frame-rate, so a static
   hover pays ZERO serviceGhost calls and ZERO over[] scans per frame. The
   bright ghost color is the dept ramp's top stop (pol/fire) or the svc-mode
   legend pair (edu/health). No RNG anywhere — the ghost draws zero jitter. */
const SVC_TOOL_TYPE = { police: OV.POLICE, firesta: OV.FIRESTA,
  school: OV.SCHOOL, hospital: OV.HOSPITAL };
const SVC_GHOST_COL = { police: "#7ddcff", fire: "#ffd07a",   // = ramp top stops
  edu: "#288cfa", health: "#fc8c32" };                        // = svc legend pair
let svcGhostCache = { city: null, tool: "", x: -1, y: -1, f: -1, tick: -1,
  tiles: null, rim: null, anchors: null,
  camR: -1, camZ: -1, lx: 0, ly: 0, lw: 0, lh: 0, has: false };
let svcGhostLayer = null; // one reused offscreen canvas — rebaked event-rate

function ghostDiamond(path, wx, wy) {
  path.moveTo(wx, wy - HH); path.lineTo(wx + HW, wy);
  path.lineTo(wx, wy + HH); path.lineTo(wx - HW, wy);
  path.closePath();
}

function drawServiceGhost(city, tool, x, y) {
  const type = SVC_TOOL_TYPE[tool];
  if (type === undefined) return;
  const def = SVC_DEF[type];
  const f = city.funding[def.dept];
  let c = svcGhostCache;
  if (c.city !== city || c.tool !== tool || c.x !== x || c.y !== y ||
      c.f !== f || c.tick !== city.tickCount) {
    // memo miss (hover moved / slider dragged / tick advanced): one O(R^2)
    // ghost replay + one over[] pass collecting the same-type anchors
    const tiles = city.serviceGhost(type, x, y);
    let dMax = -1;
    for (const j of tiles) {
      const d = Math.abs(j % MAP - x) + Math.abs(((j / MAP) | 0) - y);
      if (d > dMax) dMax = d;
    }
    // the rim derives from the SET, not an idealized diamond, so it outlines
    // the map-clipped reach honestly (edge placements included)
    const rim = tiles.filter(j =>
      Math.abs(j % MAP - x) + Math.abs(((j / MAP) | 0) - y) === dMax);
    const anchors = [];
    for (let i = 0; i < city.over.length; i++)
      if (city.over[i] === type && city.anc[i] === i) anchors.push(i);
    c = svcGhostCache = { city, tool, x, y, f, tick: city.tickCount,
      tiles, rim, anchors, camR: -1, camZ: -1, rs: -1,
      anchorPath: null, lx: 0, ly: 0, lw: 0, lh: 0, has: false };
  }
  if (c.camR !== cam.r || c.camZ !== cam.z || c.rs !== RS) {
    // Event-rate geometry bake (memo miss / rotation / zoom only — never on
    // a static-hover frame): per-tile (and even batched-Path2D) rasterizing
    // of ~300 alpha diamonds every frame was a measured 1.4-1.8x whole-frame
    // regression, so the R-bounded hover ghost (fill + rim) is pre-composited
    // into ONE small offscreen layer and blitted per frame, while the anchor
    // dims — which can lie anywhere on the map, so a layer around them would
    // be unbounded — stay a single cached Path2D filled per frame (sparse
    // footprints, viewport-clipped: negligible). World coords depend only on
    // cam.r; pan rides the ctx transform; the layer bakes at cam.z*RS device
    // scale so the blit is 1:1-crisp. source-over is associative, so the
    // pre-composited fill+rim blend pixel-identically.
    const s = sizeOf(type);
    // (a) existing same-type stations to dim, full footprint, rotation-aware
    const aP = new Path2D();
    for (const a of c.anchors) {
      const ax = a % MAP, ay = (a / MAP) | 0;
      for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++)
        ghostDiamond(aP, worldX(ax + dx, ay + dy), worldY(ax + dx, ay + dy));
    }
    c.anchorPath = aP;
    // (b) the ghost fill — exactly the tiles the stamp would write nonzero
    // to (tile diamonds never overlap, so one nonzero-winding fill of the
    // batched path covers the identical pixels). At funding 0 the set is
    // empty: only the footprint + dimmed stations render — an honest
    // "this stamps nothing" preview.
    const fP = new Path2D();
    let mnX = Infinity, mnY = Infinity, mxX = -Infinity, mxY = -Infinity;
    for (const j of c.tiles) {
      const wx = worldX(j % MAP, (j / MAP) | 0), wy = worldY(j % MAP, (j / MAP) | 0);
      ghostDiamond(fP, wx, wy);
      if (wx - HW < mnX) mnX = wx - HW; if (wx + HW > mxX) mxX = wx + HW;
      if (wy - HH < mnY) mnY = wy - HH; if (wy + HH > mxY) mxY = wy + HH;
    }
    // (c) the honest rim (per-subpath strokes are independent — one stroke
    // of the batch draws the same outlines as stroking each diamond)
    const rP = new Path2D();
    for (const j of c.rim)
      ghostDiamond(rP, worldX(j % MAP, (j / MAP) | 0), worldY(j % MAP, (j / MAP) | 0));
    c.camR = cam.r; c.camZ = cam.z; c.rs = RS;
    c.has = mnX < Infinity;
    if (c.has) {
      const pad = 2 / cam.z; // covers the 1.5/z rim stroke overhang + AA
      c.lx = mnX - pad; c.ly = mnY - pad;
      c.lw = mxX - mnX + 2 * pad; c.lh = mxY - mnY + 2 * pad;
      const sc = cam.z * RS;
      const pw = Math.max(1, Math.ceil(c.lw * sc)), ph = Math.max(1, Math.ceil(c.lh * sc));
      if (!svcGhostLayer) svcGhostLayer = document.createElement("canvas");
      if (svcGhostLayer.width !== pw) svcGhostLayer.width = pw;
      if (svcGhostLayer.height !== ph) svcGhostLayer.height = ph;
      const g = svcGhostLayer.getContext("2d");
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, pw, ph);
      g.setTransform(sc, 0, 0, sc, -c.lx * sc, -c.ly * sc);
      const colr = SVC_GHOST_COL[def.dept];
      g.fillStyle = colr;
      g.globalAlpha = 0.10;
      g.fill(fP);
      g.strokeStyle = colr;
      g.globalAlpha = 0.8;
      g.lineWidth = 1.5 / cam.z;
      g.stroke(rP);
      g.globalAlpha = 1;
    }
  }
  // (a) anchor dims, per frame from the cached batch (see bake comment)
  ctx.fillStyle = "rgba(10,12,20,0.45)";
  ctx.fill(c.anchorPath);
  if (c.has) {
    // (b)+(c) exact 1:1 device-scale blit (dest = source px / bake scale)
    // with smoothing off: nearest sampling is identical at 1:1 and cheaper
    // than bilinear on a software rasterizer
    const inv = 1 / (c.camZ * c.rs), sm = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(svcGhostLayer, 0, 0, svcGhostLayer.width, svcGhostLayer.height,
      c.lx, c.ly, svcGhostLayer.width * inv, svcGhostLayer.height * inv);
    ctx.imageSmoothingEnabled = sm;
  }
}

function drawCursor(city, uiState) {
  const { x, y } = uiState.hover;
  if (!city.inMap(x, y)) return;
  const tool = uiState.tool;
  const s = tool === "bulldoze" || tool === "tree" ? 1 : sizeOf(toolOverlay(tool));
  const ok = tool === "bulldoze" ? true :
    city.canPlace(tool, x, y) && city.funds >= city.toolCost(tool, x, y);
  // GP5a: coverage ghost UNDER the footprint cursor (no-op for other tools)
  drawServiceGhost(city, tool, x, y);
  ctx.strokeStyle = ok ? "rgba(80,255,120,.95)" : "rgba(255,70,70,.95)";
  ctx.fillStyle = ok ? "rgba(80,255,120,.16)" : "rgba(255,70,70,.16)";
  ctx.lineWidth = 2 / cam.z;
  for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) {
    const wx = worldX(x + dx, y + dy), wy = worldY(x + dx, y + dy);
    ctx.beginPath();
    ctx.moveTo(wx, wy - HH); ctx.lineTo(wx + HW, wy);
    ctx.lineTo(wx, wy + HH); ctx.lineTo(wx - HW, wy);
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }
}

/* ---------------- districts (M21) ---------------- */
// id -> palette hex lookup (index by district id). Built fresh per render pass
// off districts[] so it never goes stale after an add/delete/recolor.
function distColLookup(city) {
  const col = [];
  for (const d of city.districts) col[d.id] = DISTRICT_COLS[d.col];
  return col;
}

// Live paint feedback: wash each districted tile in its color at low alpha, in
// WORLD space, only while the district tool is active. Bounded to the same cull
// window the tile loop uses. Reads only district[]/districts — perturbs nothing.
function drawDistrictTint(city, minWX, maxWX, minWY, maxWY) {
  if (!city.districts.length) return;
  const col = distColLookup(city);
  ctx.globalAlpha = 0.16;
  for (let y = 0; y < MAP; y++) for (let x = 0; x < MAP; x++) {
    const id = city.district[y * MAP + x];
    if (!id) continue;
    const wx = worldX(x, y), wy = worldY(x, y);
    if (wx < minWX || wx > maxWX || wy < minWY || wy > maxWY) continue;
    ctx.fillStyle = col[id] || "#fff";
    ctx.beginPath();
    ctx.moveTo(wx, wy - HH); ctx.lineTo(wx + HW, wy);
    ctx.lineTo(wx, wy + HH); ctx.lineTo(wx - HW, wy);
    ctx.closePath(); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// SCREEN-space neighborhood labels at low zoom (SC2K style). Centroids are
// recomputed in ONE O(n) pass ONLY when a district edit bumped distRev — never
// per frame or per tick. Each centroid projects through the rotation-aware
// worldX/worldY, so labels sit correctly at every cam.r. Hidden when zoomed in
// (cam.z >= 0.7) so they never clutter detail work; skips districts < 6 tiles.
// M21: cache the per-district label centroids, recomputed only when the
// district layer changes. Keyed on the city OBJECT (not just distRev) because
// distRev inits to 0 on every fresh/loaded city and isn't bumped on load, so
// keying on distRev alone would collide across cities (load A then B, both at
// rev 0, would draw A's names on B). The city reference changes on new-game/
// load/scenario, forcing a recompute — same city-identity discipline the
// night-layer cache uses.
let distLabelCache = { city: null, rev: -1, cents: [] };
function drawDistrictLabels(city) {
  if (cam.z >= 0.7 || !city.districts.length) return;
  if (distLabelCache.city !== city || distLabelCache.rev !== (city.distRev | 0)) {
    const acc = {};
    for (let y = 0; y < MAP; y++) for (let x = 0; x < MAP; x++) {
      const id = city.district[y * MAP + x];
      if (!id) continue;
      const a = acc[id] || (acc[id] = { sx: 0, sy: 0, n: 0 });
      a.sx += x; a.sy += y; a.n++;
    }
    const cents = [];
    for (const d of city.districts) {
      const a = acc[d.id];
      if (a && a.n >= 6) cents.push({ name: d.name, cx: a.sx / a.n, cy: a.sy / a.n });
    }
    distLabelCache = { city, rev: city.distRev | 0, cents };
  }
  if (!distLabelCache.cents.length) return;
  // alpha ramps in as z drops below 0.7, full at/below 0.45
  const alpha = cam.z <= 0.45 ? 1 : Math.max(0, (0.7 - cam.z) / (0.7 - 0.45));
  ctx.save();
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.font = "bold 13px Tahoma, sans-serif";
  ctx.lineJoin = "round";
  if ("letterSpacing" in ctx) ctx.letterSpacing = "2px";
  for (const c of distLabelCache.cents) {
    const wx = worldX(c.cx, c.cy), wy = worldY(c.cx, c.cy);
    const sx = (wx - cam.x) * cam.z + VW / 2;
    const sy = (wy - cam.y) * cam.z + VH / 2;
    if (sx < -60 || sx > VW + 60 || sy < -30 || sy > VH + 30) continue;
    const label = c.name.toUpperCase();
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 3; ctx.strokeStyle = "rgba(10,12,20,0.85)";
    ctx.strokeText(label, sx, sy);
    ctx.fillStyle = "rgba(255,255,255,0.94)";
    ctx.fillText(label, sx, sy);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

// M27: draw a small pennant/label at each of the four world map-edge midpoints
// with the neighbor's name and a plug icon when any connection to it is open.
// The label ANCHOR is world-fixed (edge index 0=N,1=E,2=S,3=W never reads
// cam.r); worldX/worldY apply the live camera rotation so the pennant sits at
// the correct on-screen edge under every rotation. Text is drawn upright in
// screen space (like the district labels) so it never mirrors or flips.
function drawRegionLabels(city) {
  if (!city.neighbors || cam.z >= 0.9) return;
  ctx.save();
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.font = "bold 12px Tahoma, sans-serif";
  ctx.lineJoin = "round";
  for (let e = 0; e < 4; e++) {
    const nb = city.neighbors[e], cn = city.conn[e];
    const cx = e === 0 || e === 2 ? MAP / 2 : (e === 1 ? MAP + 0.5 : -1.5);
    const cy = e === 1 || e === 3 ? MAP / 2 : (e === 2 ? MAP + 0.5 : -1.5);
    const wx = worldX(cx, cy), wy = worldY(cx, cy);
    const sx = (wx - cam.x) * cam.z + VW / 2;
    const sy = (wy - cam.y) * cam.z + VH / 2;
    if (sx < -80 || sx > VW + 80 || sy < -30 || sy > VH + 30) continue;
    const open = cn.road || cn.wire || cn.rail;
    const label = (open ? "🔌 " : "") + nb.name;
    ctx.lineWidth = 3; ctx.strokeStyle = "rgba(10,12,20,0.85)";
    ctx.strokeText(label, sx, sy);
    ctx.fillStyle = open ? "rgba(210,255,200,0.96)" : "rgba(230,230,230,0.85)";
    ctx.fillText(label, sx, sy);
  }
  ctx.restore();
}

/* ---------------- minimap ---------------- */
// default City-mode color of one tile — shared by the City view and the
// overlay modes that keep the district as dimmed context (G8)
function minimapCityCol(city, i) {
  if (city.fire[i]) return "#f80";
  const t = city.over[i];
  if (t === OV.ROAD) return "#888";
  if (t === OV.WIREROAD) return "#9a8"; // M26: crossing — road grey with a wire-tan tint
  if (t === OV.WIRE) return "#ba8";
  if (t === OV.PIPE) return "#2ad"; // M24: water main — blue
  if (t === OV.WATERTOWER || t === OV.PUMP) return "#0cf"; // M24: water provider — bright cyan
  if (t === OV.ZR) return city.lvl[i] ? "#2d2" : "#141";
  if (t === OV.ZC) return city.lvl[i] ? "#46f" : "#114";
  if (t === OV.ZI) return city.lvl[i] ? "#dc2" : "#441";
  if (t === OV.PARK) return "#5c5";
  if (t === OV.POLICE) return "#88f";
  if (t === OV.FIRESTA) return "#f55";
  if (isPlant(t)) return "#ff0"; // GQ10: covers coal/solar/gas/wind (identical output) + the nuke
  if (t === OV.SCHOOL) return "#0cc";
  if (t === OV.HOSPITAL) return "#fcf";
  if (t === OV.MAYOR) return "#fd6";
  if (t === OV.STADIUM) return "#e5e";
  if (t === OV.RUBBLE) return "#654";
  if (t === OV.AIRPORT) return "#9ab"; // GQ10: tarmac slate
  if (t === OV.SEAPORT) return "#c52"; // GQ10: crane rust
  if (t === OV.XWAY) return "#b8bcc8"; // GP4a: pale concrete — brighter than road grey
  if (t === OV.RAMP) return "#98a0b0"; // GP4a: the exchange, a half-step dimmer
  // GQ10: surface the M28 gap — ids 22..28 used to fall through to the
  // terrain color and were invisible on the minimap.
  if (isArco(t)) return "#a7e";
  if (isLandmark(t)) return "#fff";
  return city.terr[i] === TERR.WATER ? "#136" : (city.terr[i] === TERR.FOREST ? "#0a3a12" : "#1c4a1c");
}

// GQ11: colorblind-legible overlay ramps. mmRamp is a tiny 3-stop linear
// interpolator; every retuned overlay ramp pairs its hue sweep with a
// MONOTONIC CIE-lightness channel, so the gradient survives a deuteranopia
// simulation (hue is never the sole channel). City-mode base colors
// (minimapCityCol) are deliberately untouched — only overlay modes retune.
const MM_TRAFFIC = [[70, 220, 60], [235, 160, 40], [140, 16, 28]];  // free → amber → dark jam
const MM_POLL = [[46, 66, 30], [150, 110, 36], [255, 190, 50]];     // clean olive → bright foul amber
const MM_CRIME = [[34, 18, 30], [140, 40, 90], [255, 96, 190]];     // safe dark → bright red-magenta
// GP3b: commute distance — near (bright green) → amber → far (dark red);
// lightness falls monotonically with hops (GQ11 contract, same slope as traffic)
const MM_COMMUTE = [[70, 220, 60], [235, 160, 40], [140, 16, 28]];
// GP5a: police / fire coverage ramps — both monotone-RISING CIE-L* (strong
// coverage = bright, per the GQ11 contract), hues distinct from every shipped
// ramp under a deutan simulation (fire's base is far redder than MM_POLL's
// olive so poll/fire can never confuse). Verified: L* strictly increasing,
// end-to-end dL* > 74, worst semantic-pair deutan dE 24.
const MM_POLCOV = [[16, 24, 52], [40, 110, 190], [125, 220, 255]];   // dark navy → bright cyan-blue
const MM_FIRECOV = [[50, 20, 12], [190, 95, 32], [255, 208, 122]];   // dark ember → bright amber-gold
/* GP7a S4: the five land-value wealth bands the "value" overlay paints, indexed
   by sim.js's landvBand() (edges 20/40/60/80 on landv). Blighted -> Gold,
   strictly rising in Rec.709 luminance (49.5 / 79.6 / 121.0 / 192.0 / 221.8 —
   steps 30.2 / 41.4 / 70.9 / 29.8, every one >= 25) and >= 50 apart in at least
   one channel between adjacent bands (51 / 50 / 78 / 149), so the ladder reads
   under deuteranopia as well as in colour.
   THE TWO ENDS ARE NOT THE MIDDLE'S HUE, and that is deliberate — measured, not
   taste. The first cut ran a single teal ramp from #1e283c to a pale #b8f5e0:
     - #1e283c against the water swatch #013 is CIEDE2000 8.9, so lakes and
       blighted districts merged into one dark mass at the shipped 2px/tile
       minimap scale. "value" is the only mode whose land base shares navy with
       water (poll #131 / crime #121 / power #111 separate by hue), so it is the
       only mode that had to solve it in luminance+hue. #3f2f22 is dead earth:
       dE 26.3 from water (30.0 simulated deuteranopic).
     - #b8f5e0 was a 24.9%-saturation pastel — the lone desaturated bright end
       in the overlay system (HSV saturation of each sibling ramp's BRIGHTEST
       anchor: MM_POLCOV 51.0 / MM_FIRECOV 52.2 / MM_CRIME 62.4 / MM_TRAFFIC
       72.7 / MM_POLL 80.4) and dE 10.3 from "prime", below this
       codebase's own categorical bar of 13 (js/sim.js district palette, worst
       pair 13.3). At the ~6px legend swatch prime and gold were not tellable
       apart. #ffe066 is 60.0% saturated, dE 33.1 from prime (25.7 deutan), and
       it is what the band is NAMED: a saturated VGA gold, not a mint wash.
   WORST PAIR AMONG ALL SIX DECLARED CATEGORIES (5 bands + water) IS NOW 19.4,
   over the 13 bar; it was 8.9. The middle three keep the shipped legend's teal
   exactly, so the ramp still reads as one ladder. */
const MM_VALUE_BANDS = ["#3f2f22", "#2b5a55", "#3d8c6e", "#6adabb", "#ffe066"];

/* GP8a S4: the four CIVIL DEFENSE exposure bands the "risk" overlay paints,
   indexed by sim.js's hazardTileBand() — the ONE band definition the Risk map,
   the FIRE_RISK_HIGH inspector row and the Civil Defense panel all share, so
   the map and the tile readout can never disagree.
   Strictly rising in Rec.709 luminance (52.2 / 108.8 / 164.9 / 220.6 — steps
   56.6 / 56.2 / 55.6, every one well over the 25 bar) and >= 50 apart in at
   least one channel between adjacent bands (68 / 177 / 184), so the ladder
   survives deuteranopia on luminance alone. Worst pair among all five declared
   categories (4 bands + the standard water swatch #013) is CIEDE2000 24.2, and
   24.1 under a simulated deuteranope — both far over this codebase's 13 bar.
   SEVERE IS DELIBERATELY NOT GOLD: the land-value ramp already owns #ffe066 at
   its top, and a mayor switching between "value" and "risk" must never read
   "prime real estate" as "about to burn". #ffd2e0 is a hot blown-out pink,
   dE 37.4 from the amber below it (29.5 deutan) and dE 30+ from every band of
   the value ramp. */
const RISK_BANDS = ["#243a2a", "#2f7e78", "#e0a028", "#ffd2e0"];

/* GP9a S4: the five GARBAGE bands the "garbage" overlay paints, indexed by
   sim.js's wasteBand() — the ONE band definition the map uses, whose edges are
   derived from the shipped WASTE_RATE table itself (trace / light / mid /
   heavy / peak, anchored to a level-1 shop, a level-1 factory, a level-3
   shopping tower and a level-3 factory) so a retune of the tonnage table cannot
   leave the ladder describing a rate scale that no longer exists.
   FIX PASS: those anchors are the RECALIBRATED ones. The first ladder was
   anchored to residential archetypes and put every level-1 tile in the bottom
   two bands, so on ten separately grown corpus cities the bright half of this
   ramp — #a08a52, #e39a5e, #f0e4c0 — painted ZERO pixels and the overlay read
   as a two-tone near-black stipple. The colours below are unchanged (their
   measured luminance/CIEDE2000 story still holds verbatim); what changed is
   which tiles reach them: a grown city now lights bands 0..2 (measured 906-1276
   developed tiles across seeds 4242/7/101/2024/555 at 600 and 1500 ticks, every
   one of them three-band) and the minimap carries 6 distinct pixel values,
   against 7 for `value` and 5 for `risk` on the same city.
   A refuse story that rises in brightness the way every GQ11 overlay does:
   compost green -> landfill mud -> dust -> tan -> ash.
   MEASURED. Rec.709 luminance strictly rising 31.1 / 80.2 / 138.6 / 165.2 /
   228.0 — steps 49.1 / 58.4 / 26.6 / 62.8, every one over the 25 bar — and
   >= 50 apart in at least one channel between adjacent bands (102 / 64 / 67 /
   98), so the ladder survives deuteranopia on luminance alone. Worst CIEDE2000
   pair among all SIX declared categories (5 bands + the standard water swatch
   #013) is 17.0 (mid vs heavy), over this codebase's 13 bar.
   NO BAND IS PURE #ffffff — deliberately. The rotation gate masks the UNION of
   pure-white pixels (the camera-viewport stroke drawn below); a white band
   would be eaten by that mask and the gate would pass on nothing.
   It also stays clear of the two bright neighbours a mayor switches between:
   dE 15.3 from the value ramp's #ffe066 gold and 26.9 from the risk ramp's
   #ffd2e0 severe. */
const MM_WASTE_BANDS = ["#14240f", "#7a4a12", "#a08a52", "#e39a5e", "#f0e4c0"];

/* GP10a S4: the BLIGHT overlay's four zone swatches — index 0 is the healthy
   zoned lot, indices 1..3 are sim.js's distressBand() shifted by one
   (strained / at risk / critical). Everything that is not a zoned tile takes
   the SAME two-value background the garbage branch established: `#013` water,
   `#111` empty land — so the map has exactly two background values and every
   other value on it means "a lot the mayor zoned is failing".
   THE HEALTHY SWATCH IS DELIBERATELY COOL and the three distress bands are
   deliberately warm: on this overlay any warm pixel is a grievance, which is
   the read a player should get before they parse the ladder at all.
   MEASURED. Rec.709 luminance strictly rising 56.2 / 96.0 / 146.4 / 220.3 —
   steps 39.8 / 50.4 / 73.9, every one over this codebase's 25 bar — and >= 50
   apart in at least one channel between adjacent bands (R 92, R 70, G 78), so
   the ladder survives deuteranopia on luminance alone. The water base sits
   40.3 luminance below the healthy swatch, so a zoned coastline still reads as
   coastline. NO BAND IS PURE #ffffff, deliberately: the rotation gate masks the
   union of pure-white pixels (the camera-viewport stroke), and a white band
   would be eaten by that mask. */
const MM_BLIGHT_BANDS = ["#2e3a44", "#8a5a20", "#d08a30", "#ffd8a0"];

/* GP8a: the Risk band buffer, memoised in MODULE scope — deliberately NOT a
   field on City. That is what makes GP8a's read-only proof structural: the
   milestone adds ZERO keys to the City object and ZERO keys to the save.
   `riskBuf` stays at module scope so a rotation gate can hash the BUFFER:
   hashing the minimap canvas is invalid, because the camera-viewport rect below
   routes four screen corners through the rotation-aware screenToTileF and
   therefore differs at every rotation.

   THE KEY IS EXACTLY buildTerrainLayer's KEY (terrRev|devRev|tickCount, ~140
   lines above) plus the city's own identity, and that is a CORRECTION, not a
   preference. The first cut keyed on the revision counters plus (tickCount/14),
   the recomputeMaps period, on the theory that the coverage planes cannot move
   faster than that. hazardTileScore also reads lvl[], and ORGANIC ZONE GROWTH
   moves lvl WITHOUT bumping devRev — MEASURED on the pinned reference city:
   0 devRev bumps against 135 lvl changes over 120 ticks, which left the painted
   map disagreeing with the tile inspector on 29 of those 120 ticks (tick 313,
   tile (30,27): the minimap pixel said High while openQuery on the same tile
   said Severe). That directly falsified the "so the map and the tile readout
   can never disagree" claim 40 lines above, so the stale window is gone: every
   input hazardTileScore reads is either mutated inside tick() (tickCount moves)
   or by place()/bulldoze()/waterfill (devRev or terrRev moves).
   The identity check is the trainMemo idiom (js/render.js:105): two City
   objects can agree on all three counters — a freshly loaded city resets
   terrRev/devRev to 0 — and without it one city could paint the other's bands.
   Cost of exactness: on a GROWING city the buffer is rebuilt once per repaint,
   because something relevant really has changed. That is the honest hit rate;
   an unchanged city (paused, or simply not growing this tick) still pays
   nothing. MEASURED on an 80x80: the bake costs ~0.63 ms (a repaint that bakes
   is 3.45 ms against 2.82 ms for one that does not, and 2.80 ms for the shipped
   "value" overlay) and it runs at the minimap's 4 Hz repaint cadence — never
   per frame, never per tick, and the census is never called from either. */
let riskBuf = null, riskKey = "", riskCity = null;
function riskBands(city) {
  /* terrRev|devRev|tickCount is buildTerrainLayer's key verbatim; the two extra
     terms cover the ONLY two ways the derived planes move with the clock
     STOPPED — a coverage-department funding commit and an ordinance toggle both
     call recomputeMaps() straight out of the dialog handler (js/ui.js:1023 and
     :1041) so the overlays react while paused. Without them the Risk map would
     be the one overlay that ignored the budget slider until the next tick. */
  const key = `${city.terrRev}|${city.devRev}|${city.tickCount}|` +
    `${city.funding.fire},${city.funding.police}|${Object.keys(city.ordinances).join(",")}`;
  if (riskBuf && riskCity === city && riskKey === key && riskBuf.length === city.over.length) return riskBuf;
  const n = city.over.length;
  if (!riskBuf || riskBuf.length !== n) riskBuf = new Uint8Array(n);
  for (let i = 0; i < n; i++) riskBuf[i] = hazardTileBand(city, i);
  riskKey = key; riskCity = city;
  return riskBuf;
}

function mmRamp(t, s) {
  const u = t <= 0 ? 0 : t >= 1 ? 1 : t;
  const k = u < 0.5 ? 0 : 1, f = (u - k * 0.5) * 2;
  const a = s[k], b = s[k + 1];
  return `rgb(${a[0] + (b[0] - a[0]) * f | 0},${a[1] + (b[1] - a[1]) * f | 0},${a[2] + (b[2] - a[2]) * f | 0})`;
}

// G8: scale a #rgb/#rrggbb color to a fraction of its brightness — overlay
// context tiles render at ~35% of their City-mode color instead of flat #111
function minimapDim(hex, f) {
  const [r, g, b] = hex.length === 4
    ? [parseInt(hex[1], 16) * 17, parseInt(hex[2], 16) * 17, parseInt(hex[3], 16) * 17]
    : [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  return `rgb(${r * f | 0},${g * f | 0},${b * f | 0})`;
}

function renderMinimap(city, mode) {
  const mm = document.getElementById("minimap");
  const g = mm.getContext("2d");
  const sc = mm.width / MAP;
  g.fillStyle = "#000"; g.fillRect(0, 0, mm.width, mm.height);
  // M21: id->color lookup precomputed ONCE (not an O(#districts) find() per
  // tile) for the "dist" mode; stays north-up like every other minimap mode.
  const distCol = mode === "dist" ? distColLookup(city) : null;
  // GP8a: the exposure band buffer, resolved ONCE per repaint off the module
  // memo above (never per tile, never per frame when nothing has changed).
  const riskB = mode === "risk" ? riskBands(city) : null;
  for (let y = 0; y < MAP; y++) for (let x = 0; x < MAP; x++) {
    const i = y * MAP + x;
    let col = null;
    if (mode === "power") {
      if (isPlant(city.over[i])) col = "#ff0";
      else if (city.powered[i]) col = "#f80";
      else if (city.over[i] !== OV.NONE) col = "#334";
      else col = city.terr[i] === TERR.WATER ? "#013" : "#111";
    } else if (mode === "poll") {
      // GQ11: clean → foul now RISES in lightness toward a bright smog amber
      // (the old ramp saturated at flat-lightness red, invisible to deutans)
      const v = city.poll[i];
      col = v > 4 ? mmRamp(Math.min(1, v / 160), MM_POLL) : (city.terr[i] === TERR.WATER ? "#013" : "#131");
    } else if (mode === "value") {
      /* GP7a S4: the continuous ramp retuned into FIVE NAMED WEALTH BANDS, so
         the overlay answers "which band is this block in" — the same question
         the LANDV_BAND inspector row and the assessed ledger are asked. The
         band edges come from sim.js's landvBand(), the ONE definition both the
         map and the tile readout use, so they can never disagree.
         Palette monotonic in Rec.709 luminance (49.5 / 79.6 / 121.0 / 192.0 /
         221.8) so the ramp survives deuteranopia, and it keeps the shipped
         legend's teal middle. Water takes the standard `#013` branch the
         poll/crime/svc/power modes already use — and MM_VALUE_BANDS[0] is a
         dead-earth brown, not navy, precisely so that this branch's two dark
         outcomes (lake, blighted lot) do not merge (see MM_VALUE_BANDS).
         A PURE FUNCTION OF city.landv / city.terr — no cam, no rot4, no
         screenToTile: this branch must stay rotation-invariant (G10(b)). */
      col = city.terr[i] === TERR.WATER ? "#013" : MM_VALUE_BANDS[landvBand(city.landv[i])];
    } else if (mode === "traffic") {
      if (city.over[i] === OV.ROAD || city.over[i] === OV.WIREROAD ||
          city.over[i] === OV.XWAY || city.over[i] === OV.RAMP) { // M26: crossing shows traffic; GP4a: an unused expressway samples the free-flow green — it reads as EMPTY
        // GQ11: bright green → amber → DARK red — lightness falls monotonically
        // with congestion, so free/jammed separate even where red≈green
        const v = city.traffic[i];
        col = mmRamp(Math.min(1, v / 200), MM_TRAFFIC);
      } else col = minimapDim(minimapCityCol(city, i), 0.35); // G8: keep district context
    } else if (mode === "svc") {
      // GQ11: education (blue) + health (orange) coverage — the old red/green
      // channel pair is the classic deutan blind spot; blue/orange sit on the
      // surviving axis and full double coverage reads near-white
      const e = city.eduCov[i], h = city.medCov[i];
      if (e || h) col = `rgb(${Math.min(255, 40 + h * 0.85) | 0},${Math.min(255, 40 + (e + h) * 0.4) | 0},${Math.min(255, 50 + e * 0.8) | 0})`;
      else col = city.terr[i] === TERR.WATER ? "#013" : "#111";
    } else if (mode === "crime") {
      // GQ11: dark base rising to a BRIGHT red-magenta — lawless blocks now
      // separate from safe ones by lightness, not hue alone
      const v = city.crime[i];
      col = v > 6 ? mmRamp(Math.min(1, v / 160), MM_CRIME) : (city.terr[i] === TERR.WATER ? "#013" : "#121");
    } else if (mode === "water") {
      // M24: providers bright, dry pipe dark, served tiles cyan scaled by the
      // citywide pressure, everything else dimmed City-mode district context
      if (isWaterSrc(city.over[i])) col = "#0cf";
      else if (city.over[i] === OV.PIPE && !city.watered[i]) col = "#234";
      else if (city.watered[i]) {
        const p = Math.max(0.35, city.waterPressure); // strained mains read darker
        col = `rgb(${20 * p | 0},${(120 + city.watered[i] * 0.5) * p | 0},${(150 + city.watered[i] * 0.4) * p | 0})`;
      } else col = minimapDim(minimapCityCol(city, i), 0.35);
    } else if (mode === "transit") {
      // M25: the invisible subway made visible — surface track steel-blue, subway
      // dim indigo, stations a white dot (cyan when live), zones tinted by railCov
      // so the catchment reads; everything else keeps dimmed City-mode context.
      const rl = city.rail[i];
      // GQ11: dead station drops from white to dim slate — live/dead now
      // separate by lightness (bright cyan vs mid gray), not hue
      if (rl === RL.STATION) col = city.stationLive[i] ? "#2ff" : "#78808c";
      else if (rl === RL.TRACK) col = "#6cf";
      else if (rl === RL.SUB) col = "#55f";
      else if (city.railCov[i]) {
        const v = city.railCov[i];
        col = `rgb(${20 + v * 0.3 | 0},${60 + v * 0.5 | 0},${90 + v * 0.4 | 0})`;
      } else col = minimapDim(minimapCityCol(city, i), 0.35);
    } else if (mode === "commute") {
      // GP3b: O(1) reads per tile (jobDist/jobAccess planes only — never a
      // nearestRoad probe here). Roads paint their hop distance to the nearest
      // job gate: slate = no route, yellow = a job gate itself, otherwise the
      // monotonic-lightness near→far ramp (GQ11). Developed ZR tiles read
      // their job-access health; everything else keeps dimmed City context.
      const t = city.over[i];
      if (t === OV.ROAD || t === OV.WIREROAD || t === OV.XWAY || t === OV.RAMP) { // GP4a: the expressway paints its commute distance too
        const d = city.jobDist[i];
        // GP4a: with any expressway on the map jobDist is in HALF-HOP units —
        // halve the displayed distance so near/far stays on one scale.
        col = d === 255 ? "#484850"
          : d === 0 ? "#ffe040"
          : mmRamp(Math.min(1, (city._xpAny ? d / 2 : d) / MAX_COMMUTE), MM_COMMUTE);
      } else if (t === OV.ZR && city.lvl[i]) {
        col = city.jobAccess[i] >= jaHealthy(city) ? "#25e8a8" : "#e08030";
      } else col = minimapDim(minimapCityCol(city, i), 0.35); // G8: keep district context
    } else if (mode === "pol") {
      // GP5a: police coverage — station anchors bright (unpowered drops to the
      // transit dead-slate idiom: lightness, not hue), covered tiles ride the
      // monotone-rising MM_POLCOV ramp scaled by the f=1 stamp max 216
      // ((R=12)*18), everything else keeps dimmed City-mode context (G8).
      // Reads planes only — north-up, never cam.r.
      if (city.over[i] === OV.POLICE) col = city.powered[i] ? "#fff" : "#78808c";
      else if (city.polCov[i]) col = mmRamp(Math.min(1, city.polCov[i] / 216), MM_POLCOV);
      else col = minimapDim(minimapCityCol(city, i), 0.35);
    } else if (mode === "fire") {
      // GP5a: fire coverage — identical shape on the fire plane/ramp
      if (city.over[i] === OV.FIRESTA) col = city.powered[i] ? "#fff" : "#78808c";
      else if (city.fireCov[i]) col = mmRamp(Math.min(1, city.fireCov[i] / 216), MM_FIRECOV);
      else col = minimapDim(minimapCityCol(city, i), 0.35);
    } else if (mode === "risk") {
      /* GP8a: disaster EXPOSURE, banded. Water takes the standard `#013` branch
         the poll/crime/svc/power modes already use; every land tile paints the
         band sim.js's hazardTileBand() puts it in, read straight out of the
         memoised buffer. Strictly north-up: nothing in this branch reads the camera at all. */
      col = city.terr[i] === TERR.WATER ? "#013" : RISK_BANDS[riskB[i]];
    } else if (mode === "garbage") {
      /* GP9a: the WASTE LEDGER made visible — tonnes/month per tile, banded.
         city.wasteRateAt(i) is an O(1) pure read of over[i]/lvl[i]/ordMods, so
         this branch allocates NO plane and memoises nothing — literally the
         `mode==="poll"` idiom, down to its two-outcome base: a tile that makes
         no garbage at all takes the standard `#013` water swatch or the neutral
         `#111` empty-land dark the power/svc branches already use, so the map
         has exactly TWO background values and every OTHER value on it is a
         band. (Both bases clear the 13 bar against band 0: dE 16.7 water,
         15.0 land.) Strictly north-up: nothing in this branch reads cam, rot4
         or screenToTile — it is a pure function of the sim planes (G10(b)). */
      const wb = wasteBand(city.wasteRateAt(i));
      col = wb < 0 ? (city.terr[i] === TERR.WATER ? "#013" : "#111") : MM_WASTE_BANDS[wb];
    } else if (mode === "blight") {
      /* GP10a: the DISTRESS LEDGER made visible — consecutive failing months
         per zoned lot, banded. A PURE PLANE READ of city.distress[i]: this
         branch allocates no buffer, memoises nothing and calls no sim method,
         so it is literally the `mode==="garbage"` idiom one step simpler.
         The zoned footprint is the subject (level 0 included — it is the
         denominator the ledger publishes its share against), and everything
         else takes the standard two-value background. Strictly north-up:
         nothing here reads cam, rot4 or screenToTile, so all four rotations
         paint the identical minimap (G10(b)). */
      const dn = city.distress[i];
      col = dn > 0 ? MM_BLIGHT_BANDS[1 + distressBand(dn)]
        : apxZone(city, i) ? MM_BLIGHT_BANDS[0]
        : (city.terr[i] === TERR.WATER ? "#013" : "#111");
    } else if (mode === "dist") {
      const dc = city.district[i];
      // districted tiles paint their palette color; everything else keeps the
      // dimmed City-mode context (same treatment as the traffic overlay)
      col = dc ? (distCol[dc] || "#fff") : minimapDim(minimapCityCol(city, i), 0.35);
    } else {
      // default city view
      col = minimapCityCol(city, i);
    }
    g.fillStyle = col;
    // integer pixel edges: every canvas pixel belongs wholly to one tile, so
    // fractional scales (e.g. 160/128) never blend neighbouring tile colors
    const px = Math.round(x * sc), py = Math.round(y * sc);
    g.fillRect(px, py, Math.round((x + 1) * sc) - px, Math.round((y + 1) * sc) - py);
  }

  // G8: projected camera-viewport rectangle — invert worldX/worldY for the
  // four screen corners to get their continuous tile coordinates, then stroke
  // the tile-space bounding box (clamped to the map) as a crisp 1px white
  // rect. Tracks every pan/zoom at every map size since sc = canvas / MAP.
  if (cvs) {
    let tx0 = Infinity, ty0 = Infinity, tx1 = -Infinity, ty1 = -Infinity;
    // M32a: route the four screen corners through the rotation-aware FLOAT
    // inverse (screenToTileF, not the rounding screenToTile) so the box bounds
    // the rotated visible region in tile space at every rotation AND stays
    // byte-identical to HEAD's float inverse at r=0.
    for (const [sx, sy] of [[0, 0], [VW, 0], [0, VH], [VW, VH]]) {
      const { x: tx, y: ty } = screenToTileF(sx, sy);
      tx0 = Math.min(tx0, tx); tx1 = Math.max(tx1, tx);
      ty0 = Math.min(ty0, ty); ty1 = Math.max(ty1, ty);
    }
    // integer-aligned stroke on the half-pixel grid: the 1px line stays
    // crisp full-intensity white instead of feathering across two columns
    const cl = (v) => Math.round(Math.max(0, Math.min(MAP, v)) * sc);
    const rx = Math.min(cl(tx0), mm.width - 2), ry = Math.min(cl(ty0), mm.height - 2);
    const rw = Math.max(1, cl(tx1) - rx - 1), rh = Math.max(1, cl(ty1) - ry - 1);
    g.strokeStyle = "#fff";
    g.lineWidth = 1;
    g.strokeRect(rx + 0.5, ry + 0.5, rw, rh);
  }
}
