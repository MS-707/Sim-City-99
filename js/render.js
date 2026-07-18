/* ============ SimCity 99 — isometric renderer ============ */
"use strict";

const cam = { x: 0, y: 0, z: 1 };   // world-space center + zoom
let cvs, ctx, frame = 0;
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

function renderInit(canvas) {
  cvs = canvas;
  ctx = canvas.getContext("2d");
  const fit = () => {
    const r = cvs.parentElement.getBoundingClientRect();
    cvs.width = Math.max(64, r.width | 0);
    cvs.height = Math.max(64, r.height | 0);
  };
  fit();
  window.addEventListener("resize", fit);
  cam.x = 0; cam.y = MAP * HH; // middle of the map
}

const worldX = (x, y) => (x - y) * HW;
const worldY = (x, y) => (x + y) * HH + HH;

/* ---------------- day/night cycle (M10) ---------------- */
// One in-game day spans the 24-tick month: hour = tickCount % 24, midnight on
// the month boundary, noon at hour 12. Both functions are pure in sim time —
// equal tickCount values always produce identical lighting, and the phase
// advances by itself as the sim ticks.
const NIGHT_TINT = "#0a1230";     // dusk wash color (screen-space overlay)
const NIGHT_MAX_ALPHA = 0.6;      // G1: lerp facades ~60% toward the tint at deepest
                                  // night instead of covering them — silhouettes,
                                  // roof diamonds and zone colors stay readable
const NIGHT_LIGHT_ALPHA = 0.7;    // G1: clamp on the additive night-light pass —
                                  // baked glows never blit at full alpha
const NIGHT_MAX_DRAWS = 700;      // per-frame cap on night-light sprite draws

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
  g.translate(cvs.width / 2, cvs.height / 2);
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
  if (x + 1 >= MAP || y + 1 >= MAP) return false;
  const i = (y + 1) * MAP + x + 1;
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
  ctx.translate(cvs.width / 2, cvs.height / 2);
  ctx.scale(cam.z, cam.z);
  ctx.translate(-cam.x, -cam.y);
}

function screenToTile(sx, sy) {
  const wx = (sx - cvs.width / 2) / cam.z + cam.x;
  const wy = (sy - cvs.height / 2) / cam.z + cam.y;
  const A = wx / HW, B = (wy - HH) / HH;
  return { x: Math.round((A + B) / 2), y: Math.round((B - A) / 2) };
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
  g.translate(cvs.width / 2, cvs.height / 2);
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
        if (sm) { const sh = S.shore[terrHash(x, y) % SHORE_VARIANTS][sm]; g.drawImage(sh.c, wx - sh.ox, wy - sh.oy); }
      } else {
        // G5: grass variant by scrambled (x, y) hash — open meadows mottle
        // organically instead of alternating with varnt's seeded stripes
        const gs = S.grass[terrHash(x, y) & 3];
        g.drawImage(gs.c, wx - gs.ox, wy - gs.oy);
        const bm = beachMask(city, i); // shore fringe on the land side of the seam
        if (bm) { const sh = S.shore[terrHash(x, y) % SHORE_VARIANTS][bm]; g.drawImage(sh.c, wx - sh.ox, wy - sh.oy); }
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
      if (city.terr[i] === TERR.WATER) continue;
      const em = terrEdgeMask(city, i);
      if (em) { const eg = SPR.terrEdge[em]; g.drawImage(eg.c, wx - eg.ox, wy - eg.oy); }
    }
  }
  L.key = key;
}

function renderFrame(city, uiState, clearBG) {
  frame++;
  const ns = nightStrength(city, uiState); // 0 ⇒ the whole night path is skipped
  nightDrawn = 0;
  if (clearBG) {
    // postcard photo pass (G4): transparent background — the composer lays
    // its sunset-sky gradient underneath, so past the map edge the photo
    // shows sky, never the void color
    ctx.clearRect(0, 0, cvs.width, cvs.height);
  } else {
    ctx.fillStyle = "#0a0a12";
    ctx.fillRect(0, 0, cvs.width, cvs.height);
  }

  // cull margins sized to the sprite extents: buildings reach ~64px sideways,
  // ~110px above and ~48px below their anchor tile's diamond center
  const minWX = cam.x - cvs.width / 2 / cam.z - 80;
  const maxWX = cam.x + cvs.width / 2 / cam.z + 80;
  const minWY = cam.y - cvs.height / 2 / cam.z - 64;
  const maxWY = cam.y + cvs.height / 2 / cam.z + 128;

  const blink = (frame / 24 | 0) % 2 === 0;
  // prebuilt water frame cycle — divisor 32 (G5): the water-driven terrain
  // rebuild lands at ~1.9x/second instead of 3.7x; per-tile (x + y) offsets
  // in buildTerrainLayer keep the shimmer lively between rebuilds
  const waterFrame = (frame / 32 | 0) % WATER_FRAMES;

  // flat terrain: one cached blit unless the camera / water / terrain moved —
  // or the season changed (M12): the palette swap costs exactly one rebuild
  const tKey = `${cam.x},${cam.y},${cam.z},${cvs.width},${cvs.height},` +
    `${waterFrame},${city.terrRev | 0},${city.seed},${MAP},${seasonOf(city.month)}`;
  if (terrLayer.key !== tKey)
    buildTerrainLayer(city, waterFrame, minWX, maxWX, minWY, maxWY, tKey);
  ctx.drawImage(terrLayer.cv, 0, 0);

  ctx.save();
  worldTransform();
  ctx.imageSmoothingEnabled = false;

  // G2: night lights accumulate on the punched layer during the loop, in
  // depth order — but only when the cache key moved; a static night frame
  // reuses the finished layer and pays one composite
  const nKey = ns > 0 ? `${cam.x},${cam.y},${cam.z},${cvs.width},${cvs.height},` +
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

  // painter's order: by (x + y), then x
  for (let s = 0; s <= (MAP - 1) * 2; s++) {
    for (let x = Math.max(0, s - MAP + 1); x <= Math.min(MAP - 1, s); x++) {
      const y = s - x;
      const i = y * MAP + x;
      const ov = city.over[i];
      const t = city.terr[i];
      if (ov === OV.NONE && !city.fire[i] && t !== TERR.FOREST) continue;
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
          if (spr) {
            ctx.drawImage(spr.c, wx - spr.ox, wy - spr.oy);
            // G3: burning buildings char — darkened while city.fire[i] is
            // set, reverting the moment the fire ends
            if (city.fire[i]) drawChar(spr, wx, wy);
            // G9: mast-bearing C3 towers blink their aircraft beacon live,
            // each tower phase-offset by its tile index — the baked red tip
            // is only the lit state, overdrawn dark on the off half-cycle
            if (spr.beacon) {
              ctx.fillStyle = (frame + i * 7) % 48 < 24 ? "#f33" : "#4a1a1a";
              ctx.fillRect(wx + spr.beacon.x, wy + spr.beacon.y, 3, 3);
            }
            // G2: buildings occlude glow behind them; flat roads/wires don't
            if (ng && ov !== OV.ROAD && ov !== OV.WIRE)
              nightPunch(spr, wx, wy);
          }
          // pothole tint (M23): unmaintained roads visibly darken with wear
          if (ov === OV.ROAD && city.roadWear[i] > 96) {
            ctx.globalAlpha = Math.min(0.38, (city.roadWear[i] - 96) / 400);
            ctx.fillStyle = "#181008";
            ctx.beginPath();
            ctx.moveTo(wx, wy - HH); ctx.lineTo(wx + HW, wy);
            ctx.lineTo(wx, wy + HH); ctx.lineTo(wx - HW, wy);
            ctx.closePath(); ctx.fill();
            ctx.globalAlpha = 1;
          }
          if (ng) {
            // night lights at this tile's own depth (G2): street lamps on
            // road tiles, prebaked lit-window glow on powered zones, plus
            // the ground pool — unless the tile in front blocks the spill
            if (ov === OV.ROAD) {
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
          if (x === ax + size - 1 && y === ay + size - 1) {
            const spr = spriteFor(city, a);
            const awx = worldX(ax, ay), awy = worldY(ax, ay);
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
            }
          }
        }
      }

      // fire on this tile
      if (city.fire[i]) {
        drawFlames(wx, wy, i);
        if (ng) nightAdd(SPR.fireGlow, wx, wy, fireGlowMul);
      }

      // blinking "no power" bolt on developed but unpowered zones / civics
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

  updateCars(city, ns);
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
    if (sea === "winter") { ctx.globalAlpha = 0.05 * gA; ctx.fillStyle = "#ccd8e2"; ctx.fillRect(0, 0, cvs.width, cvs.height); ctx.globalAlpha = 1; }
    else if (sea === "autumn") { ctx.globalAlpha = 0.035 * gA; ctx.fillStyle = "#cf9038"; ctx.fillRect(0, 0, cvs.width, cvs.height); ctx.globalAlpha = 1; }
  }

  // dusk tint: one screen-space fill over the whole scene — no per-tile work,
  // no pixel reads. Skipped entirely by day / with the cycle pref off.
  if (ns > 0) {
    ctx.globalAlpha = ns * NIGHT_MAX_ALPHA;
    ctx.fillStyle = NIGHT_TINT;
    ctx.fillRect(0, 0, cvs.width, cvs.height);
    ctx.globalAlpha = 1;
  }

  if (ns > 0) drawNightLights(city, ns);

  ctx.save();
  worldTransform();
  if (uiState.hover && uiState.tool !== "query") drawCursor(city, uiState);
  ctx.restore();
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
  const oCvs = cvs, oCtx = ctx, ox = cam.x, oy = cam.y, oz = cam.z;
  cvs = canvas;
  ctx = canvas.getContext("2d");
  cam.x = cx; cam.y = cy; cam.z = cz;
  try {
    renderFrame(city, uiState, true);
  } finally {
    cvs = oCvs; ctx = oCtx;
    cam.x = ox; cam.y = oy; cam.z = oz;
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
  ctx.drawImage(nightLayer.cv, 0, 0); // per-sprite alpha was clamped at draw
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
function updateCars(city, ns) {
  if (!carSprites.x) buildCarSprites();
  carLightQ.length = 0;
  const roads = [];
  let total = 0;
  for (let i = 0; i < city.over.length; i++)
    if (city.over[i] === OV.ROAD) { roads.push(i); total += city.traffic[i]; }

  // G16: cap scales with map area (carCap) instead of the flat 70
  const want = roads.length >= 8 ? Math.min(carCap(), 6 + (total / 45 | 0)) : 0;
  while (cars.length > want) cars.pop();
  for (let tries = 0; tries < 12 && cars.length < want && roads.length; tries++) {
    const i = roads[(Math.random() * roads.length) | 0];
    if (Math.random() * 160 > city.traffic[i] + 25) continue; // favor busy roads
    const x = i % MAP, y = (i / MAP) | 0;
    cars.push({ id: carSeq++, fx: x, fy: y, tx: x, ty: y, x, y, p: 1,
                spd: 0.1, col: carSeq % CAR_COLS.length });
  }

  for (let k = cars.length - 1; k >= 0; k--) {
    const c = cars[k];
    c.p += c.spd;
    if (c.p >= 1) {
      const px = c.fx, py = c.fy;
      c.fx = c.tx; c.fy = c.ty; c.p = 0;
      const i = c.fy * MAP + c.fx;
      if (city.over[i] !== OV.ROAD) { cars.splice(k, 1); continue; } // road got dozed
      const opts = [], back = [];
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const X = c.fx + dx, Y = c.fy + dy;
        if (X < 0 || Y < 0 || X >= MAP || Y >= MAP) continue;
        if (city.over[Y * MAP + X] !== OV.ROAD) continue;
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
    const wx = worldX(c.x, c.y), wy = worldY(c.x, c.y);
    // cull off-screen cars: the pool is map-sized (G16) but only visible cars
    // pay draw + night-light cost, so a busy 128 map stays cheap
    const sx = (wx - cam.x) * cam.z + cvs.width / 2;
    const sy = (wy - cam.y) * cam.z + cvs.height / 2;
    if (sx < -40 || sx > cvs.width + 40 || sy < -70 || sy > cvs.height + 50) continue;
    // G16: pick the body sprite for this car's travel axis so it points down
    // the road it's on — one of two iso shapes, never an axis-aligned rect.
    const tdx = c.tx - c.fx, tdy = c.ty - c.fy;
    const axis = tdx !== 0 ? "x" : "y";
    const spr = carSprites[axis][c.col];
    ctx.drawImage(spr.c, wx - spr.ox, wy - spr.oy);
    // G16: after dusk, queue this car's lights at its screen-forward heading —
    // headlight cone ahead, taillight behind — for the additive night pass.
    if (ns > 0 && (tdx || tdy)) {
      const rx = (tdx - tdy) * HW, ry = (tdx + tdy) * HH; // screen forward
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
        const x = i % MAP, y = (i / MAP) | 0;
        pushPlume(worldX(x, y) - 18, worldY(x, y) + HH - 78, Math.random() * 0.4 - 0.1);
      } else if (t === OV.GAS && city.anc[i] === i && Math.random() < 0.42) {
        // M19: gas plants smoke from their short stacks (coal-level smog)
        const x = i % MAP, y = (i / MAP) | 0;
        pushPlume(worldX(x, y) - 14, worldY(x, y) + HH - 62, Math.random() * 0.4 - 0.1);
      } else if (t === OV.ZI && city.lvl[i] === 3 && city.powered[i] && Math.random() < 0.28) {
        const x = i % MAP, y = (i / MAP) | 0;
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
function chopperMonthTick(c) {
  if (chopper) return;                          // at most one chopper airborne
  if (Math.random() >= CHOPPER_CHANCE) return;  // no flyover this month
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
    if (c.over[i] === OV.ROAD && c.traffic[i] > bestV) { bestV = c.traffic[i]; best = i; }
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
  const px = (worldX(chopper.x, chopper.y) - cam.x) * cam.z + cvs.width / 2;
  const py = (worldY(chopper.x, chopper.y) - CHOPPER_ALT - cam.y) * cam.z + cvs.height / 2;
  const r = CHOPPER_HIT_R * cam.z;
  return (sx - px) * (sx - px) + (sy - py) * (sy - py) <= r * r;
}

// canvas-relative screen point of the drawn body (tests + UI, not per-frame)
function chopperScreenXY() {
  if (!chopper) return null;
  return {
    x: (worldX(chopper.x, chopper.y) - cam.x) * cam.z + cvs.width / 2,
    y: (worldY(chopper.x, chopper.y) - CHOPPER_ALT - cam.y) * cam.z + cvs.height / 2,
  };
}

// O(1): is the chopper's body inside the viewport (small margin)? Feeds the
// ambience scheduler's rotor thump — never used for any map scan.
function chopperOnScreen() {
  if (!chopper) return false;
  const sx = (worldX(chopper.x, chopper.y) - cam.x) * cam.z + cvs.width / 2;
  const sy = (worldY(chopper.x, chopper.y) - CHOPPER_ALT - cam.y) * cam.z + cvs.height / 2;
  return sx >= -80 && sx <= cvs.width + 80 && sy >= -80 && sy <= cvs.height + 80;
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
  } else { // ufo
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
  }
}

function drawCursor(city, uiState) {
  const { x, y } = uiState.hover;
  if (!city.inMap(x, y)) return;
  const tool = uiState.tool;
  const s = tool === "bulldoze" || tool === "tree" ? 1 : sizeOf(toolOverlay(tool));
  const ok = tool === "bulldoze" ? true :
    city.canPlace(tool, x, y) && city.funds >= city.toolCost(tool, x, y);
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

/* ---------------- minimap ---------------- */
// default City-mode color of one tile — shared by the City view and the
// overlay modes that keep the district as dimmed context (G8)
function minimapCityCol(city, i) {
  if (city.fire[i]) return "#f80";
  const t = city.over[i];
  if (t === OV.ROAD) return "#888";
  if (t === OV.WIRE) return "#ba8";
  if (t === OV.ZR) return city.lvl[i] ? "#2d2" : "#141";
  if (t === OV.ZC) return city.lvl[i] ? "#46f" : "#114";
  if (t === OV.ZI) return city.lvl[i] ? "#dc2" : "#441";
  if (t === OV.PARK) return "#5c5";
  if (t === OV.POLICE) return "#88f";
  if (t === OV.FIRESTA) return "#f55";
  if (t === OV.COAL || t === OV.SOLAR || t === OV.GAS || t === OV.WIND) return "#ff0";
  if (t === OV.SCHOOL) return "#0cc";
  if (t === OV.HOSPITAL) return "#fcf";
  if (t === OV.MAYOR) return "#fd6";
  if (t === OV.STADIUM) return "#e5e";
  if (t === OV.RUBBLE) return "#654";
  return city.terr[i] === TERR.WATER ? "#136" : (city.terr[i] === TERR.FOREST ? "#0a3a12" : "#1c4a1c");
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
  for (let y = 0; y < MAP; y++) for (let x = 0; x < MAP; x++) {
    const i = y * MAP + x;
    let col = null;
    if (mode === "power") {
      if (isPlant(city.over[i])) col = "#ff0";
      else if (city.powered[i]) col = "#f80";
      else if (city.over[i] !== OV.NONE) col = "#334";
      else col = city.terr[i] === TERR.WATER ? "#013" : "#111";
    } else if (mode === "poll") {
      const v = city.poll[i];
      col = v > 4 ? `rgb(${Math.min(255, 60 + v * 2)},${Math.max(0, 120 - v)},40)` : (city.terr[i] === TERR.WATER ? "#013" : "#131");
    } else if (mode === "value") {
      const v = city.landv[i];
      col = `rgb(${30 + v * 0.3 | 0},${40 + v * 0.7 | 0},${60 + v * 0.5 | 0})`;
    } else if (mode === "traffic") {
      if (city.over[i] === OV.ROAD) {
        const v = city.traffic[i]; // green -> yellow -> red as congestion rises
        col = `rgb(${Math.min(255, 60 + v * 1.6) | 0},${Math.max(0, 200 - v * 1.4) | 0},40)`;
      } else col = minimapDim(minimapCityCol(city, i), 0.35); // G8: keep district context
    } else if (mode === "svc") {
      // education (green) + health (red) coverage
      const e = city.eduCov[i], h = city.medCov[i];
      if (e || h) col = `rgb(${Math.min(255, 40 + h * 0.8) | 0},${Math.min(255, 40 + e * 0.8) | 0},60)`;
      else col = city.terr[i] === TERR.WATER ? "#013" : "#111";
    } else if (mode === "crime") {
      const v = city.crime[i];
      col = v > 6 ? `rgb(${80 + v},20,${30 + v / 2})` : (city.terr[i] === TERR.WATER ? "#013" : "#121");
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
    for (const [sx, sy] of [[0, 0], [cvs.width, 0], [0, cvs.height], [cvs.width, cvs.height]]) {
      const wx = (sx - cvs.width / 2) / cam.z + cam.x;
      const wy = (sy - cvs.height / 2) / cam.z + cam.y;
      const a = wx / HW, b = (wy - HH) / HH;
      const tx = (a + b) / 2, ty = (b - a) / 2;
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
