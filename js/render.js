/* ============ SimCity 99 — isometric renderer ============ */
"use strict";

const cam = { x: 0, y: 0, z: 1, r: 0 };   // world-space center + zoom + view rotation (M32a: r∈{0,1,2,3}, 90° CCW steps)
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
  ctx.translate(cvs.width / 2, cvs.height / 2);
  ctx.scale(cam.z, cam.z);
  ctx.translate(-cam.x, -cam.y);
}

function screenToTile(sx, sy) {
  const wx = (sx - cvs.width / 2) / cam.z + cam.x;
  const wy = (sy - cvs.height / 2) / cam.z + cam.y;
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
  const wx = (sx - cvs.width / 2) / cam.z + cam.x;
  const wy = (sy - cvs.height / 2) / cam.z + cam.y;
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
        if (sm) {
          // GQ9 fix: depth falloff UNDER the shore bands — water-tile draw
          // only (the land-side beachMask draw below never gets it), so the
          // near-shore water plateau separates from every land material
          const sl = S.shoal[rot4(sm, cam.r)];
          if (!window.__noShoal) g.drawImage(sl.c, wx - sl.ox, wy - sl.oy);
          const sh = S.shore[terrHash(x, y) % SHORE_VARIANTS][rot4(sm, cam.r)]; g.drawImage(sh.c, wx - sh.ox, wy - sh.oy);
        }
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
      if (city.terr[i] === TERR.WATER) continue;
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
         isMega(ov);
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
  const Lw = cvs.width + 2 * SHADOW_MARGIN, Lh = cvs.height + 2 * SHADOW_MARGIN;
  if (L.cv && L.cv.width === Lw && L.cv.height === Lh && L.key === key) {
    // same content, camera slid: reuse the raster while the slide is a whole
    // number of device pixels and the viewport stays inside the apron
    const dx = (L.camX - cam.x) * cam.z, dy = (L.camY - cam.y) * cam.z;
    const rdx = Math.round(dx), rdy = Math.round(dy);
    if (Math.abs(dx - rdx) < 1e-7 && Math.abs(dy - rdy) < 1e-7 &&
        Math.abs(rdx) <= SHADOW_MARGIN && Math.abs(rdy) <= SHADOW_MARGIN) {
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
  g.translate(Lw / 2, Lh / 2);
  g.scale(cam.z, cam.z);
  g.translate(-cam.x, -cam.y);
  g.fillStyle = "#000";
  // world-space bounds of the layer canvas (apron included), AA-padded —
  // quads are culled by their exact bbox so nothing that could touch the
  // raster is ever skipped, at any footprint size
  const wl = -Lw / 2 / cam.z + cam.x - 2, wr = Lw / 2 / cam.z + cam.x + 2;
  const wt = -Lh / 2 / cam.z + cam.y - 2, wb = Lh / 2 / cam.z + cam.y + 2;
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
  const tKey = `${cam.x},${cam.y},${cam.z},${cam.r},${cvs.width},${cvs.height},` +
    `${waterFrame},${city.terrRev | 0},${city.seed},${MAP},${seasonOf(city.month)}`;
  if (terrLayer.key !== tKey)
    buildTerrainLayer(city, waterFrame, minWX, maxWX, minWY, maxWY, tKey);
  ctx.drawImage(terrLayer.cv, 0, 0);

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
    const sKey = `${cam.z},${cam.r},${cvs.width},${cvs.height},` +
      `${city.devRev},${city.tickCount},${city.seed},${MAP},${seasonOf(city.month)},` +
      `${(typeof UI !== "undefined" && UI.prefs && UI.prefs.billboard) ? 1 : 0}`;
    if (shadowLayer.key !== sKey ||
        shadowLayer.viewX !== cam.x || shadowLayer.viewY !== cam.y)
      buildShadowLayer(city, minWX, maxWX, minWY, maxWY, sKey);
    ctx.globalAlpha = shA;
    ctx.drawImage(shadowLayer.cv,
      shadowLayer.offX - SHADOW_MARGIN, shadowLayer.offY - SHADOW_MARGIN);
    ctx.globalAlpha = 1;
  }

  ctx.save();
  worldTransform();
  ctx.imageSmoothingEnabled = false;

  // G2: night lights accumulate on the punched layer during the loop, in
  // depth order — but only when the cache key moved; a static night frame
  // reuses the finished layer and pays one composite
  const nKey = ns > 0 ? `${cam.x},${cam.y},${cam.z},${cam.r},${cvs.width},${cvs.height},` +
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
          const roadBridge = (ov === OV.ROAD || ov === OV.WIREROAD) &&
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
            // G9: mast-bearing C3 towers blink their aircraft beacon live,
            // each tower phase-offset by its tile index — the baked red tip
            // is only the lit state, overdrawn dark on the off half-cycle
            if (spr.beacon) {
              ctx.fillStyle = (frame + i * 7) % 48 < 24 ? "#f33" : "#4a1a1a";
              ctx.fillRect(wx + spr.beacon.x, wy + spr.beacon.y, 3, 3);
            }
            // G2: buildings occlude glow behind them; flat roads/wires don't
            if (ng && ov !== OV.ROAD && ov !== OV.WIRE && ov !== OV.WIREROAD && ov !== OV.PIPE) // M26: crossing is flat road+wire, doesn't punch; M24: a flat pipe doesn't punch either
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
            if (ov === OV.ROAD || ov === OV.WIREROAD) { // M26: crossing gets a street lamp like a road
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
        if (railBridge) drawBridgeOver(railBridge);
      } else if (rl === RL.STATION) {
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

  const carSpeed = (uiState && uiState.speed != null) ? uiState.speed : 1;
  updateCars(city, ns, carSpeed);
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
  cvs = canvas;
  ctx = canvas.getContext("2d");
  // M32c: shoot the postcard north-up regardless of the live view rotation, so
  // the photo is a stable keepsake and matches postcardBounds' r=0 framing.
  cam.x = cx; cam.y = cy; cam.z = cz; cam.r = 0;
  try {
    renderFrame(city, uiState, true);
  } finally {
    cvs = oCvs; ctx = oCtx;
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
    if (city.over[i] === OV.ROAD || city.over[i] === OV.WIREROAD) { roads.push(i); total += city.traffic[i]; } // M26: cars use crossings

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
      if (city.over[i] !== OV.ROAD && city.over[i] !== OV.WIREROAD) { cars.splice(k, 1); continue; } // road/crossing got dozed (M26)
      const opts = [], back = [];
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const X = c.fx + dx, Y = c.fy + dy;
        if (X < 0 || Y < 0 || X >= MAP || Y >= MAP) continue;
        if (city.over[Y * MAP + X] !== OV.ROAD && city.over[Y * MAP + X] !== OV.WIREROAD) continue; // M26: cars path through crossings
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
      } else if (t === OV.ZI && city.lvl[i] === 3 && city.powered[i] && Math.random() < 0.28) {
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

// GQ8: aliveness instrumentation — an O(1) snapshot of every ambient-motion
// pool for the regression harness (traffic, smoke, night car lights, the
// chopper, animated water). Globally reachable as a bare name; never called
// per frame by the renderer itself. (No animated train exists yet — the rail
// bakes are static track — so there is deliberately no train slot to report.)
function alivenessStats() {
  return { cars: cars.length, carCap: carCap(), smoke: smoke.length,
           smokeMax: SMOKE_MAX, carLights: carLightQ.length / 4,
           chopper: !!chopper, waterFrames: WATER_FRAMES };
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
    const sx = (wx - cam.x) * cam.z + cvs.width / 2;
    const sy = (wy - cam.y) * cam.z + cvs.height / 2;
    if (sx < -60 || sx > cvs.width + 60 || sy < -30 || sy > cvs.height + 30) continue;
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
    const sx = (wx - cam.x) * cam.z + cvs.width / 2;
    const sy = (wy - cam.y) * cam.z + cvs.height / 2;
    if (sx < -80 || sx > cvs.width + 80 || sy < -30 || sy > cvs.height + 30) continue;
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
  // M21: id->color lookup precomputed ONCE (not an O(#districts) find() per
  // tile) for the "dist" mode; stays north-up like every other minimap mode.
  const distCol = mode === "dist" ? distColLookup(city) : null;
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
      if (city.over[i] === OV.ROAD || city.over[i] === OV.WIREROAD) { // M26: crossing shows traffic
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
      if (rl === RL.STATION) col = city.stationLive[i] ? "#2ff" : "#fff";
      else if (rl === RL.TRACK) col = "#6cf";
      else if (rl === RL.SUB) col = "#55f";
      else if (city.railCov[i]) {
        const v = city.railCov[i];
        col = `rgb(${20 + v * 0.3 | 0},${60 + v * 0.5 | 0},${90 + v * 0.4 | 0})`;
      } else col = minimapDim(minimapCityCol(city, i), 0.35);
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
    for (const [sx, sy] of [[0, 0], [cvs.width, 0], [0, cvs.height], [cvs.width, cvs.height]]) {
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
