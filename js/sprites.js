/* ============ SimCity 99 — procedural isometric sprite factory ============
   Every sprite is drawn onto an offscreen canvas at boot. No image files.
   Sprite = { c: canvas, ox, oy } where (ox, oy) is the pixel at the CENTER
   of the anchor tile's diamond. */
"use strict";

const SPR = {};

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, ((n >> 16) & 255) * f) | 0;
  const g = Math.min(255, ((n >> 8) & 255) * f) | 0;
  const b = Math.min(255, (n & 255) * f) | 0;
  return `rgb(${r},${g},${b})`;
}

// G9: lerp a color toward white. shade(base, 1.3) multiplies channels and
// clips pale bases (e.g. the hospital's #e6e3da) to pure white — a 35%
// lerp brightens every base the same perceptual step while keeping its hue.
function lighten(hex, t) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgb(${r + (255 - r) * t | 0},${g + (255 - g) * t | 0},${b + (255 - b) * t | 0})`;
}

// GQ3: HSL face derivation for the zone-family prisms. shade() multiplies RGB
// channels, which drags saturated hues toward black/grey; the curated zone
// palettes keep their hue identity by shifting HSL *lightness* only — the lit
// top and the two shadow faces stay in the family's hue band.
function hexToHsl(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  let h = 0, s = 0;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = (mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
  }
  return [h, s, l];
}
function hslStr(h, s, l) {
  return `hsl(${h},${(s * 100).toFixed(1)}%,${(l * 100).toFixed(1)}%)`;
}
// same hue/sat, lightness shifted by dl and clamped to [0.06, 0.88] — the top
// clamp keeps pale faces below valueJitterCopy's 255 ceiling (G10 distance)
function faceL(hex, dl) {
  const [h, s, l] = hexToHsl(hex);
  return hslStr(h, s, Math.max(0.06, Math.min(0.88, l + dl)));
}
// GQ3 prism opts for the nine zone families: lit top (unless a roof cap
// overrides it) + HSL-darkened shadow faces. The sun stays SCREEN-welded —
// SW face darkest, SE face lighter — exactly like prism()'s shade() defaults,
// so M32a/b face logic is untouched. Civic/landmark prisms keep shade().
function zoneFaces(base, topHex) {
  return {
    top: topHex || faceL(base, 0.14),
    left: faceL(base, -0.13),
    right: faceL(base, -0.05),
  };
}

// G13: nudge a hex color warmer (k>0) or cooler (k<0) for per-tree canopy hue
// jitter — k in ~[-1,1]. Keeps the leaf family, just breaks the flat "every
// tree the same green" look.
function nudgeHue(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  r = Math.max(0, Math.min(255, (r + 24 * k) | 0));
  b = Math.max(0, Math.min(255, (b - 16 * k) | 0));
  return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

// G9: sprite baking must be byte-identical across boots — windows() pane
// lighting draws from this stream, which buildSprites points at its seeded
// mulberry32 before any sprite bakes. Never Math.random in a bake path.
let ART_RNG = Math.random;

function mkSprite(w, h, extraTop, draw) {
  const cw = (w + h) * HW, ch = extraTop + (w + h) * HH;
  const c = document.createElement("canvas");
  c.width = cw; c.height = ch;
  const g = c.getContext("2d");
  const ox = h * HW, oy = extraTop + HH;
  // G14: prism()/tinyHouse() record their top-face / roof-plane polygons on
  // SNOWSPEC during the draw, so makeWinter() can overpaint them with snow.
  // Non-building sprites simply record nothing. Save/restore keeps it re-entrant.
  const prevSnow = SNOWSPEC; SNOWSPEC = [];
  draw(g, ox, oy, w, h);
  const spr = { c, ox, oy, snowSpec: SNOWSPEC };
  SNOWSPEC = prevSnow;
  return spr;
}

// footprint corner points for a w x h building at local anchor-center (ox, oy)
function corners(ox, oy, w, h) {
  return {
    N: [ox, oy - HH],
    E: [ox + w * HW, oy + (w - 1) * HH],
    S: [ox + (w - h) * HW, oy + (w + h - 1) * HH],
    W: [ox - h * HW, oy + (h - 1) * HH],
  };
}

function poly(g, pts, fill, stroke) {
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.closePath();
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1; g.stroke(); }
}

const up = (p, ht) => [p[0], p[1] - ht];

// solid iso prism from precomputed footprint corners
function prismFrom(g, cn, ht, base, opts = {}) {
  const { N, E, S, W } = cn;
  const topC = opts.top || lighten(base, 0.35); // G9: pale tops keep hue
  const leftC = opts.left || shade(base, 0.72);
  const rightC = opts.right || shade(base, 0.92);
  poly(g, [up(W, ht), up(S, ht), S, W], leftC);           // SW face
  poly(g, [up(S, ht), up(E, ht), E, S], rightC);          // SE face
  poly(g, [up(N, ht), up(E, ht), up(S, ht), up(W, ht)], topC, shade(base, 0.55));
  if (SNOWSPEC) { // G14: record the top face + its front eaves for the winter cap
    const tN = up(N, ht), tE = up(E, ht), tS = up(S, ht), tW = up(W, ht);
    SNOWSPEC.push({ pts: [tN, tE, tS, tW], eaves: [[tW, tS], [tS, tE]] });
  }
  return { N, E, S, W };
}
// solid iso prism: top + two visible faces
function prism(g, ox, oy, w, h, ht, base, opts = {}) {
  return prismFrom(g, corners(ox, oy, w, h), ht, base, opts);
}
// G11: footprint corners drawn back toward the footprint centre by factor k
// (< 1) so a civic prism sits set back on its lot and a paved apron ring shows
function insetCorners(ox, oy, w, h, k) {
  const { N, E, S, W } = corners(ox, oy, w, h);
  const cx = (N[0] + E[0] + S[0] + W[0]) / 4, cy = (N[1] + E[1] + S[1] + W[1]) / 4;
  const ins = (p) => [cx + (p[0] - cx) * k, cy + (p[1] - cy) * k];
  return { N: ins(N), E: ins(E), S: ins(S), W: ins(W) };
}

// rows x cols of window parallelograms on a face whose bottom edge runs p0->p1.
// While GLOWG is set (the boot-time night bake in withNight), day-lit panes
// are also stamped onto the glow layer in the zone's own light color (G1).
let GLOWG = null;
// G2: ground-spill pools (C3 lobby light, I-yard floodlights) bake onto their
// OWN layer, separate from the window glow, so the renderer can suppress a
// pool per tile when the tile in front carries a developed building.
let POOLG = null, poolBaked = false;
// G14: while an array, prism()/tinyHouse() record their top-face / roof-plane
// geometry here so makeWinter() can overpaint them with pal.snowCap — the
// winter building variant is derived from the summer bake, so summer stays
// byte-identical and the winter windows/clutter match summer exactly.
let SNOWSPEC = null;
// per-zone night lighting character (G1): each zone family lights up in its
// own color so districts stay readable after dark
const GLOW_WARM = "#f0b85c";   // warm amber — residential evening light
const GLOW_COOL = "#a8ccf8";   // cool blue-white — commercial office glass
const GLOW_SODIUM = "#ff9c3e"; // sodium orange — industrial yard shifts

function windows(g, p0, p1, ht, rows, cols, lit = 0.5, color = "#ffe9a0", dark = "#20242c",
                 glow = GLOW_WARM, glowFrac = 1) {
  const topPad = 6, botPad = 4;
  const usable = ht - topPad - botPad;
  let dayLit = 0, nightLit = 0; // G1: running quota keeps night ≤ glowFrac of day-lit
  for (let r = 0; r < rows; r++) {
    const y0 = botPad + (r + 0.15) / rows * usable;
    const y1 = botPad + (r + 0.7) / rows * usable;
    for (let c = 0; c < cols; c++) {
      const u0 = (c + 0.25) / cols, u1 = (c + 0.75) / cols;
      const ax = p0[0] + (p1[0] - p0[0]) * u0, ay = p0[1] + (p1[1] - p0[1]) * u0;
      const bx = p0[0] + (p1[0] - p0[0]) * u1, by = p0[1] + (p1[1] - p0[1]) * u1;
      const isLit = ART_RNG() < lit; // G9: seeded — bakes are boot-identical
      g.fillStyle = isLit ? color : dark;
      g.beginPath();
      g.moveTo(ax, ay - y1); g.lineTo(bx, by - y1);
      g.lineTo(bx, by - y0); g.lineTo(ax, ay - y0);
      g.closePath(); g.fill();
      if (GLOWG && isLit) {
        // G1: only panes lit in the day sprite may glow at night; glowFrac
        // caps the lit fraction (sparse ~40% for residential) and the pane is
        // slightly inset so the light reads as crisp windows in the dark
        dayLit++;
        if (nightLit + 1 <= glowFrac * dayLit) {
          nightLit++;
          const ix = (bx - ax) * 0.1, iy = (by - ay) * 0.1, sy = (y1 - y0) * 0.1;
          GLOWG.fillStyle = glow;
          GLOWG.beginPath();
          GLOWG.moveTo(ax + ix, ay + iy - y1 + sy); GLOWG.lineTo(bx - ix, by - iy - y1 + sy);
          GLOWG.lineTo(bx - ix, by - iy - y0 - sy); GLOWG.lineTo(ax + ix, ay + iy - y0 - sy);
          GLOWG.closePath(); GLOWG.fill();
        }
      }
    }
  }
}

// G2: pool-ellipse stamp for the boot-time night bake — draws on the pool
// layer (not the window-glow layer) so it stays individually suppressible.
function groundPool(x, y, rx, ry, color) {
  if (!POOLG) return;
  POOLG.fillStyle = color;
  POOLG.beginPath(); POOLG.ellipse(x, y, rx, ry, 0, 0, 7); POOLG.fill();
  poolBaked = true;
}

// build a sprite plus a prebaked night variant (M10/G1): the draw callback
// runs once with GLOWG set, so windows() bakes its day-lit panes, in the
// zone's light color, into a glow layer; a cheap 8-tap stamp adds a faint
// halo. Ground pools land on a second layer (G2) that becomes spr.pool —
// queued separately so an occluded pool can be skipped per tile. All of
// this happens at boot inside buildSprites — renderFrame only ever *looks
// up* spr.night / spr.pool.
function withNight(w, h, extraTop, draw) {
  const cw = (w + h) * HW, ch = extraTop + (w + h) * HH;
  const glow = document.createElement("canvas");
  glow.width = cw; glow.height = ch;
  const pool = document.createElement("canvas");
  pool.width = cw; pool.height = ch;
  GLOWG = glow.getContext("2d");
  POOLG = pool.getContext("2d");
  poolBaked = false;
  const spr = mkSprite(w, h, extraTop, draw);
  GLOWG = null; POOLG = null;
  const haloed = (src) => {
    const c = document.createElement("canvas");
    c.width = cw; c.height = ch;
    const g = c.getContext("2d");
    g.globalAlpha = 0.08; // faint halo around every lit pane (G1: tamed bloom)
    for (const [dx, dy] of [[-2, 0], [2, 0], [0, -2], [0, 2], [-1, -1], [1, -1], [-1, 1], [1, 1]])
      g.drawImage(src, dx, dy);
    g.globalAlpha = 1;
    g.drawImage(src, 0, 0);
    return { c, ox: spr.ox, oy: spr.oy };
  };
  spr.night = haloed(glow);
  if (poolBaked) spr.pool = haloed(pool);
  return spr;
}

/* ---- seasonal building variants (G14) ----
   Buildings used to bake once and float on the winter snow. mkSprite() records
   each building's top-face and roof-plane polygons (via prism()/tinyHouse())
   onto spr.snowSpec; makeWinter() then derives a snow-capped, cool-graded
   winter copy from the finished summer canvas — so the winter windows/clutter
   are pixel-for-pixel the summer building, just under snow, and the summer bake
   itself is untouched (byte-identical to HEAD). */

// snow blanket over one captured top-face / roof plane, with a brighter eave
// lip and a few hanging drips along the front edges. The roof snow is a near-
// neutral bright white (R~=G~=B) rather than pal.snowCap's cool tint: near
// white the HSL saturation of even a slight blue cast reads high, and roof
// snow is part of criterion 2's changed region — a neutral white keeps the
// winter facade saturation measurably BELOW summer.
const ROOF_SNOW = "#eeeff1", ROOF_SNOW_HI = "#f4f5f6", ROOF_SNOW_LO = "#e6e8ea";
function paintSnow(g, sp) {
  poly(g, sp.pts, ROOF_SNOW);
  if (sp.eaves) for (const [a, b] of sp.eaves) {
    g.strokeStyle = ROOF_SNOW_HI; g.lineWidth = 2.6; g.lineCap = "round";
    g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
    g.fillStyle = ROOF_SNOW_LO;
    for (let k = 1; k <= 3; k++) {
      const t = k / 4, dx = a[0] + (b[0] - a[0]) * t, dy = a[1] + (b[1] - a[1]) * t;
      g.beginPath(); g.moveTo(dx - 2, dy - 1); g.lineTo(dx + 2, dy - 1); g.lineTo(dx, dy + 4); g.closePath(); g.fill();
    }
    g.lineCap = "butt";
  }
}

// pull a building's whole facade ~10% toward its own luminance — the winter
// grade that makes buildings visibly participate in the season, reducing
// facade saturation (G14 criterion 2). A pure desaturation (no hue shift) so
// it never adds blue saturation to the many near-neutral concrete/cream
// facades; the cool cast comes from the mild screen-space grade in render.js.
// Roof snow paints on top afterward, unmuted.
function applyCoolGrade(g, c) {
  const im = g.getImageData(0, 0, c.width, c.height), d = im.data, k = 0.10;
  for (let p = 0; p < d.length; p += 4) {
    if (d[p + 3] === 0) continue;
    const r = d[p], gr = d[p + 1], b = d[p + 2];
    const L = 0.299 * r + 0.587 * gr + 0.114 * b;
    d[p]     = Math.max(0, Math.min(255, r + (L - r) * k));
    d[p + 1] = Math.max(0, Math.min(255, gr + (L - gr) * k));
    d[p + 2] = Math.max(0, Math.min(255, b + (L - b) * k));
  }
  g.putImageData(im, 0, 0);
}

// derive a snow-capped winter variant from a baked summer building sprite: a
// cool-graded copy of the day canvas with snow (paintSnow) overpainting every
// recorded top face + tinyHouse roof plane. Night glow / pool / beacon are
// shared by reference (winter lit windows == summer's), so G1/G2/G9 are intact.
function makeWinter(base) {
  const c = document.createElement("canvas");
  c.width = base.c.width; c.height = base.c.height;
  const g = c.getContext("2d");
  g.drawImage(base.c, 0, 0);
  applyCoolGrade(g, c);
  if (base.snowSpec) for (const sp of base.snowSpec) paintSnow(g, sp);
  const w = { c, ox: base.ox, oy: base.oy };
  if (base.night) w.night = base.night;
  if (base.pool) w.pool = base.pool;
  if (base.beacon) w.beacon = base.beacon;
  return w;
}

/* ---- per-tile value jitter (G10) ----
   So identical adjacent towers never render as pixel-twins, every developed
   building sprite carries a small pool of value-shifted day copies. The
   renderer (spriteFor -> zone) picks one per tile by a 4-colouring of (x, y)
   that guarantees orthogonal neighbours land on different shifts. Only the
   DAY canvas is recoloured; the night-glow/pool layers are shared by
   reference so the per-zone glow colours (G1) are untouched. */
const JIT_DELTAS = [-11, -4, 4, 11]; // additive; min pairwise gap 7 -> >= 12 colour distance
function valueJitterCopy(src, delta) {
  const c = document.createElement("canvas");
  c.width = src.width; c.height = src.height;
  const g = c.getContext("2d");
  g.drawImage(src, 0, 0);
  const im = g.getImageData(0, 0, c.width, c.height), d = im.data;
  for (let p = 0; p < d.length; p += 4) {
    if (d[p + 3] === 0) continue; // leave transparent pixels alone
    d[p]     = Math.max(0, Math.min(255, d[p]     + delta));
    d[p + 1] = Math.max(0, Math.min(255, d[p + 1] + delta));
    d[p + 2] = Math.max(0, Math.min(255, d[p + 2] + delta));
  }
  g.putImageData(im, 0, 0);
  return c;
}
function withJitter(base, deck) {
  base.jit = JIT_DELTAS.map((delta, jk) => {
    const copy = { c: valueJitterCopy(base.c, delta), ox: base.ox, oy: base.oy };
    if (deck) {
      // GQ5: seeded per-jit-copy roof props, drawn on the DAY canvas only —
      // the night/pool/beacon layers stay shared by ref (G1: props are dark
      // after dusk) and the renderer's jit[(x+2*y)&3] pick guarantees
      // orthogonal same-variant neighbours land on different prop layouts.
      // pr is pure in (BR, family, variant, copy) — zero per-frame cost, no
      // shared-stream draws. Winter jit copies get NO deck (snowed-over).
      const pr = mulberry32((0x9F0F ^ (deck.BR * 0x9E3779B1) ^ (deck.fam * 0x85EBCA77) ^
                             (deck.v * 193) ^ (jk * 7919)) >>> 0);
      const g = copy.c.getContext("2d");
      const n = 4 + (pr() * 2 | 0);
      for (let p = 0; p < n; p++) {
        const kind = (pr() * ROOF_PROPS.length) | 0;
        ROOF_PROPS[kind](g, deck.cx + (pr() * 2 - 1) * deck.spread,
                         deck.cy + (pr() * 2 - 1) * deck.spread * 0.5);
      }
    }
    if (base.night) copy.night = base.night; // share glow/pool/beacon by ref
    if (base.pool) copy.pool = base.pool;
    if (base.beacon) copy.beacon = base.beacon;
    return copy;
  });
  return base;
}

/* ---- seasonal terrain palettes (M12) ----
   Terrain-family sprites (grass, water, shore, forest, road banks) are baked
   once per season at boot — the same draw code runs four times with a palette
   parameter. The renderer just looks up SPR.season[seasonOf(city.month)]. */
/* G5: every season's 4 grass fills sit within ~2% lightness of each other —
   open grass mottles organically instead of checkerboarding; the variant is
   picked by a scrambled (x, y) hash in buildTerrainLayer, not by varnt. */
const SEASON_PAL = {
  // G13: `floor` now sits within ~6 luminance of the season's grass so forest
  // tiles stop reading as hard dark diamonds; `sandHi` is dimmed to within a
  // few % of `sand` so the beach no longer reads as a raised rampart; `iceEdge`
  // (winter only) is a dark shore crack that keeps the frozen coastline legible
  summer: {
    grass: ["#3fa53a", "#3ba23c", "#43a83c", "#3f9f38"],
    fleckA: "rgba(255,255,255,.08)", fleckB: "rgba(0,60,0,.15)",
    floor: "#3ea23b", leafLo: "#1a7a26", leafHi: "#2bb03a", snowCap: null,
    waterTop: "#1c66cc", waterBot: "#195cb8",
    waterDith: "#2a72d6", waterCrest: "rgba(130,185,255,.22)",
    wave: "rgba(210,235,255,.35)", glint: "rgba(220,240,255,.5)",
    sand: "#dcc37a", sandHi: "#e0c87f", foam: "rgba(255,255,255,.32)", iceEdge: null,
    // GQ9 shoreline bevel: damp strip / surf ridge / underwater sand tint —
    // pure palette keys (zero RNG), consumed only by the shore bake
    sandWet: "#b99e5e", foamBand: "rgba(240,250,255,.55)", shelf: "rgba(215,195,140,.30)",
    berm: "rgba(58,62,48,.62)",
    // GQ9 fix (CR1 per-profile floor): near-shore depth falloff tone — the
    // water deepens to this navy just past the shelf, so the waterside
    // plateau separates from EVERY GQ2 land material (dirt ~110 luma
    // collided with crest-lit water ~116 before)
    shoalDeep: "#0b2848",
    // GQ2 ground-material quilt: warm packed dirt, dull grey-gold sand LOT
    // (distinct from the brighter shore sand #dcc37a), aged concrete pavement.
    // 4 tones each, within a few % lightness — mottle, never checkerboard.
    dirt: ["#8a6b42", "#86673f", "#8e6f45", "#886a41"],
    dirtFleckA: "rgba(240,220,180,.14)", dirtFleckB: "rgba(52,34,12,.20)",
    sandLot: ["#cbb26a", "#c7ae66", "#cfb66e", "#c9b068"],
    sandFleckA: "rgba(255,250,230,.16)", sandFleckB: "rgba(120,98,48,.18)",
    pave: ["#8f9095", "#8b8c91", "#939499", "#8d8e93"],
    paveFleckA: "rgba(230,232,238,.10)", paveFleckB: "rgba(24,26,32,.16)",
    paveCrack: "rgba(34,34,40,.35)",
  },
  spring: { // fresh greens, blossom flecks in the grass
    grass: ["#55ac4b", "#52a94e", "#57ae51", "#53a74d"],
    fleckA: "rgba(255,215,235,.4)", fleckB: "rgba(0,70,0,.15)",
    // GQ1 fix: spring canopy measured median S=.448, a hair under the 45%
    // daytime-foliage bar (leafHi was #4fb453 at S=.40). Both tones lifted in
    // the same fresh-green hue band: leafLo .53→.59, leafHi .40→.52.
    floor: "#53a74b", leafLo: "#259032", leafHi: "#3cbe44", snowCap: null,
    waterTop: "#2a6bb5", waterBot: "#2561a7",
    // GQ1 fix: dither + crest were summer/winter-only; spring gets the same
    // treatment in its own softer blue family (cross-season consistency)
    waterDith: "#3a7ac2", waterCrest: "rgba(160,205,255,.24)",
    wave: "rgba(210,235,255,.35)", glint: "rgba(220,240,255,.5)",
    sand: "#dcc37a", sandHi: "#e0c87f", foam: "rgba(255,255,255,.32)", iceEdge: null,
    sandWet: "#b39a5c", foamBand: "rgba(240,250,255,.55)", shelf: "rgba(215,195,140,.30)", berm: "rgba(58,62,48,.62)", shoalDeep: "#102f52", // GQ9
    // GQ2: same material families in spring's wetter, slightly cooler cast
    dirt: ["#7f6440", "#7b603d", "#836843", "#7d623e"],
    dirtFleckA: "rgba(235,215,175,.14)", dirtFleckB: "rgba(46,30,12,.20)",
    sandLot: ["#c4ad68", "#c0a964", "#c8b16c", "#c2ab66"],
    sandFleckA: "rgba(255,250,230,.16)", sandFleckB: "rgba(115,94,46,.18)",
    pave: ["#8c8f94", "#888b90", "#909398", "#8a8d92"],
    paveFleckA: "rgba(228,231,238,.10)", paveFleckB: "rgba(24,26,32,.16)",
    paveCrack: "rgba(34,34,40,.35)",
  },
  autumn: { // dry stubble lawns, orange/red canopies
    grass: ["#9c9a48", "#98944a", "#9e9a4b", "#999545"],
    fleckA: "rgba(230,180,90,.3)", fleckB: "rgba(90,60,10,.2)",
    floor: "#97934a", leafLo: "#b0541e", leafHi: "#d2691e", snowCap: null,
    // G14: 3 canopy hue pairs — yellow-gold ~45deg, orange ~25deg, deep red
    // ~9deg — picked per tree by drawTree from the seeded hue value, so an
    // autumn stand shows mixed fall color instead of one flat orange. Both the
    // base and crown of each pair sit in the same 10deg band so the histogram
    // shows three separated modes (valleys at ~15 and ~35deg).
    leafSets: [["#c4931c", "#e8bb2c"], ["#a8511a", "#d2691e"], ["#8e1a0f", "#b92214"]],
    waterTop: "#255fa3", waterBot: "#215595",
    // GQ1 fix: dither + crest for autumn too — the lake keeps its 256-color
    // stipple year-round instead of flattening in spring/autumn
    waterDith: "#336cb0", waterCrest: "rgba(150,195,250,.22)",
    wave: "rgba(210,235,255,.3)", glint: "rgba(220,240,255,.45)",
    sand: "#d8bd74", sandHi: "#dcc17b", foam: "rgba(255,255,255,.30)", iceEdge: null,
    sandWet: "#b0985a", foamBand: "rgba(240,250,255,.50)", shelf: "rgba(210,190,135,.30)", berm: "rgba(54,58,44,.62)", shoalDeep: "#0d2a4a", // GQ9
    // GQ2: same material families in autumn's drier, warmer cast
    dirt: ["#8f6f43", "#8b6b40", "#937346", "#8d6d41"],
    dirtFleckA: "rgba(235,205,150,.15)", dirtFleckB: "rgba(56,36,12,.20)",
    sandLot: ["#c9ae62", "#c5aa5e", "#cdb266", "#c7ac60"],
    sandFleckA: "rgba(250,240,210,.16)", sandFleckB: "rgba(118,94,42,.18)",
    pave: ["#90908c", "#8c8c88", "#949490", "#8e8e8a"],
    paveFleckA: "rgba(232,232,226,.10)", paveFleckB: "rgba(26,26,30,.16)",
    paveCrack: "rgba(36,34,38,.35)",
  },
  winter: { // snowed-under lawns, pine canopies with snow caps, icy shores
    grass: ["#e9edf3", "#e6eaf1", "#eceff5", "#e5e9f0"],
    fleckA: "rgba(255,255,255,.5)", fleckB: "rgba(165,182,210,.35)",
    floor: "#e3e8f0", leafLo: "#2c5a34", leafHi: "#38703f", snowCap: "#eef2f7",
    waterTop: "#6a9ed6", waterBot: "#6398cf",
    waterDith: "#7aabde", waterCrest: "rgba(210,235,255,.35)",
    wave: "rgba(255,255,255,.4)", glint: "rgba(240,248,255,.7)",
    sand: "#c9d6e4", sandHi: "#e8eef5", foam: "rgba(255,255,255,.5)", iceEdge: "#7fa0bf",
    // GQ9 winter: ice-shelf shades — the frozen-coast identity (iceEdge crack)
    // is kept; these bands read as rime, not summer surf
    sandWet: "#a9bccd", foamBand: "rgba(240,250,255,.62)", shelf: "rgba(200,215,230,.30)",
    berm: "rgba(150,165,180,.40)",
    // GQ9 fix: winter's falloff stays in the icy family (dark water under
    // the rime shelf, never a summer navy) so the frozen-coast identity holds
    shoalDeep: "#3e6da0",
    // GQ2: snow-dusted materials, separable from the #e9edf3 snowpack by
    // BOTH lightness and hue (colorblind norm MN3): warm grey-brown dirt,
    // buff sand lot, plowed blue-grey pavement
    dirt: ["#c9bfae", "#c5bbaa", "#cdc3b2", "#c7bdac"],
    dirtFleckA: "rgba(255,255,255,.40)", dirtFleckB: "rgba(96,80,58,.28)",
    sandLot: ["#d8d2c2", "#d4cebe", "#dcd6c6", "#d6d0c0"],
    sandFleckA: "rgba(255,255,255,.45)", sandFleckB: "rgba(140,128,100,.25)",
    pave: ["#aeb4bd", "#aab0b9", "#b2b8c1", "#acb2bb"],
    paveFleckA: "rgba(240,244,250,.35)", paveFleckB: "rgba(58,64,74,.25)",
    paveCrack: "rgba(58,64,74,.45)",
  },
};

// G13: `sil` selects a canopy silhouette (0 round, 1 conifer, 2 wide oak),
// `hue` jitters the leaf color per tree, and `ground` drops a grounding shadow
// ellipse so forest trees stop floating. Defaults reproduce the pre-G13 round
// tree exactly, so standalone park/mayor/stadium trees are unchanged.
function drawTree(g, x, y, s, tint = 1, pal = null, sil = 0, hue = 0, ground = false) {
  let lo = pal ? pal.leafLo : "#1a7a26", hi = pal ? pal.leafHi : "#2bb03a";
  if (pal && pal.leafSets) { // autumn: 3 discrete canopy hue pairs (G14)
    const set = pal.leafSets[hue < -0.27 ? 2 : hue < 0.27 ? 1 : 0]; // red / orange / gold
    lo = set[0]; hi = set[1];
  } else if (hue) { lo = nudgeHue(lo, hue); hi = nudgeHue(hi, hue); }
  if (ground) { // G13: soft grounding shadow beneath the trunk base
    g.fillStyle = "rgba(0,0,0,.16)";
    g.beginPath(); g.ellipse(x, y + s * 0.06, s * 0.5, s * 0.17, 0, 0, 7); g.fill();
  }
  g.strokeStyle = "#5d4123"; g.lineWidth = 2;
  g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - s * 0.8); g.stroke();
  if (sil === 1) { // conifer: stacked triangular skirts, pointed crown
    g.fillStyle = shade(lo, tint);
    for (let t = 0; t < 3; t++) {
      const cy = y - s * (0.55 + t * 0.42), hw = s * (0.6 - t * 0.14);
      g.beginPath(); g.moveTo(x, cy - s * 0.5); g.lineTo(x + hw, cy); g.lineTo(x - hw, cy); g.closePath(); g.fill();
    }
    g.fillStyle = shade(hi, tint);
    g.beginPath(); g.moveTo(x, y - s * 1.72); g.lineTo(x + s * 0.22, y - s * 1.32); g.lineTo(x - s * 0.22, y - s * 1.32); g.closePath(); g.fill();
    if (pal && pal.snowCap) {
      g.fillStyle = pal.snowCap;
      g.beginPath(); g.moveTo(x, y - s * 1.72); g.lineTo(x + s * 0.16, y - s * 1.42); g.lineTo(x - s * 0.16, y - s * 1.42); g.closePath(); g.fill();
    }
  } else if (sil === 2) { // wide oak: broad low canopy, two shoulder lobes
    g.fillStyle = shade(lo, tint);
    g.beginPath(); g.ellipse(x, y - s * 0.95, s * 0.78, s * 0.58, 0, 0, 7); g.fill();
    g.fillStyle = shade(hi, tint);
    g.beginPath(); g.ellipse(x - s * 0.28, y - s * 1.12, s * 0.44, s * 0.38, 0, 0, 7); g.fill();
    g.beginPath(); g.ellipse(x + s * 0.3, y - s * 1.02, s * 0.4, s * 0.34, 0, 0, 7); g.fill();
    if (pal && pal.snowCap) {
      g.fillStyle = pal.snowCap;
      g.beginPath(); g.ellipse(x - s * 0.08, y - s * 1.32, s * 0.5, s * 0.24, 0, 0, 7); g.fill();
    }
  } else { // round (pre-G13 default)
    g.fillStyle = shade(lo, tint);
    g.beginPath(); g.ellipse(x, y - s * 1.1, s * 0.55, s * 0.65, 0, 0, 7); g.fill();
    g.fillStyle = shade(hi, tint);
    g.beginPath(); g.ellipse(x - s * 0.15, y - s * 1.3, s * 0.4, s * 0.45, 0, 0, 7); g.fill();
    if (pal && pal.snowCap) { // winter: fresh snow load on the crown
      g.fillStyle = pal.snowCap;
      g.beginPath(); g.ellipse(x - s * 0.1, y - s * 1.42, s * 0.42, s * 0.28, 0, 0, 7); g.fill();
    }
  }
}

function tinyHouse(g, cx, cy, s, wall, roof, snow = false) {
  // little iso cottage: body + pitched roof, footprint ~s wide
  const hw = s / 2, hh = s / 4, ht = s * 0.42;
  const N = [cx, cy - hh], E = [cx + hw, cy], S = [cx, cy + hh], W = [cx - hw, cy];
  poly(g, [up(W, ht), up(S, ht), S, W], shade(wall, 0.7));
  poly(g, [up(S, ht), up(E, ht), E, S], shade(wall, 0.95));
  // roof ridge runs W->E raised
  const ridge = ht + s * 0.34;
  const rgR = [cx + hw * 0.1, cy - ridge], rgL = [cx - hw * 0.1, cy - ridge];
  poly(g, [up(W, ht), up(N, ht), up(E, ht), rgR, rgL], shade(roof, 1.05));
  poly(g, [up(W, ht), up(S, ht), up(E, ht), rgR, rgL], shade(roof, 0.75));
  // door
  g.fillStyle = "#3a2a18";
  g.fillRect(cx + hw * 0.25, cy + hh * 0.2 - ht, s * 0.13, ht * 0.6);
  // G14: both pitched roof planes carry snow — captured for the derived winter
  // variant (mayor) and, when `snow` is set, painted directly (rebaked r1)
  const back = { pts: [up(W, ht), up(N, ht), up(E, ht), rgR, rgL] };
  const front = { pts: [up(W, ht), up(S, ht), up(E, ht), rgR, rgL], eaves: [[up(W, ht), up(S, ht)], [up(S, ht), up(E, ht)]] };
  if (SNOWSPEC) { SNOWSPEC.push(back); SNOWSPEC.push(front); }
  if (snow) { paintSnow(g, back); paintSnow(g, front); }
}

function stack(g, x, y, ht, w, stripes = false) {
  g.fillStyle = "#6f6f78"; g.fillRect(x - w / 2, y - ht, w, ht);
  g.fillStyle = "#8b8b94"; g.fillRect(x - w / 2, y - ht, w * 0.4, ht);
  if (stripes) {
    g.fillStyle = "#c0392b";
    g.fillRect(x - w / 2, y - ht, w, 4);
    g.fillRect(x - w / 2, y - ht + 8, w, 4);
  }
  g.fillStyle = "#3c3c44"; g.fillRect(x - w / 2 - 1, y - ht - 2, w + 2, 3);
}

/* ---- roofscape furniture (G9) ----
   Shared roof treatment for mid/high-rise sprites: a darker tar/gravel
   field inset behind a 1px parapet line, then a few seeded clutter pieces.
   Everything draws on the DAY context only — nothing here touches GLOWG or
   POOLG, so new roof furniture stays dark in the night bake (G1). */

// parapet inset + roof field: fills the top-face diamond scaled to 82%
// around its center and strokes the 1px parapet line; returns the top-face
// center so callers can arrange furniture on the deck
function roofDeckFrom(g, cn, ht, field, line) {
  const { N, E, S, W } = cn;
  const cx = (N[0] + E[0] + S[0] + W[0]) / 4;
  const cy = (N[1] + E[1] + S[1] + W[1]) / 4 - ht;
  const ins = (p) => [cx + (p[0] - cx) * 0.82, cy + (p[1] - ht - cy) * 0.82];
  poly(g, [ins(N), ins(E), ins(S), ins(W)], field, line);
  return [cx, cy];
}
function roofDeck(g, ox, oy, w, h, ht, field, line) {
  return roofDeckFrom(g, corners(ox, oy, w, h), ht, field, line);
}

/* ---- civic apron + roof-plane glyphs (G11) ----
   Service civics sit set back on a paved plaza. civicApron() paves the full
   footprint (pavement, never grass — distinct from a zoned tile's grass lot);
   the building prism is then drawn on insetCorners on top, leaving a concrete
   apron ring. Roof glyphs (shield / garage door / book / cross / H) are drawn
   in the roof plane via isoGlyph so their edges run parallel to the 2:1 tile
   diamond instead of the screen axes. */
const PAVE = "#9a978f", PAVE_LO = "#83817a", CURB = "#6f6d67";
function civicApron(g, ox, oy, w, h) {
  const { N, E, S, W } = corners(ox, oy, w, h);
  poly(g, [N, E, S, W], PAVE);
  const cx = (N[0] + E[0] + S[0] + W[0]) / 4, cy = (N[1] + E[1] + S[1] + W[1]) / 4;
  const ins = (p, k) => [cx + (p[0] - cx) * k, cy + (p[1] - cy) * k];
  // curb line just inside the lot edge, then two expansion joints toward front
  poly(g, [ins(N, 0.985), ins(E, 0.985), ins(S, 0.985), ins(W, 0.985)], null, CURB);
  g.strokeStyle = PAVE_LO; g.lineWidth = 1;
  for (const t of [0.34, 0.6]) {
    g.beginPath();
    g.moveTo(W[0] + (S[0] - W[0]) * t, W[1] + (S[1] - W[1]) * t);
    g.lineTo(N[0] + (E[0] - N[0]) * t, N[1] + (E[1] - N[1]) * t);
    g.stroke();
    g.beginPath();
    g.moveTo(W[0] + (N[0] - W[0]) * t, W[1] + (N[1] - W[1]) * t);
    g.lineTo(S[0] + (E[0] - S[0]) * t, S[1] + (E[1] - S[1]) * t);
    g.stroke();
  }
}
// iso roof basis: eu steps one tile-axis (slope +1/2), ev the other (slope
// -1/2). ~2px per roof unit — a glyph spanning ~7 units reads ~14px on screen.
const RUV_U = [2, 1], RUV_V = [-2, 1];
const ruv = (rc, u, v) => [rc[0] + u * RUV_U[0] + v * RUV_V[0], rc[1] + u * RUV_U[1] + v * RUV_V[1]];
// filled parallelogram spanning [u0,u1]x[v0,v1] in the roof plane
function isoQuad(g, rc, u0, u1, v0, v1, fill, stroke) {
  poly(g, [ruv(rc, u0, v0), ruv(rc, u1, v0), ruv(rc, u1, v1), ruv(rc, u0, v1)], fill, stroke);
}
// a roof-plane "+" made of two bars along the two tile axes (arm half-length a,
// bar half-width wd) — its edges track the diamond, not the screen axes
function isoCross(g, rc, a, wd, fill, stroke) {
  isoQuad(g, rc, -a, a, -wd, wd, fill, stroke);
  isoQuad(g, rc, -wd, wd, -a, a, fill, stroke);
}
// roof-plane "H" (helipad marking): two posts along one tile axis + a crossbar
function isoH(g, rc, a, b, wd, fill) {
  isoQuad(g, rc, -a, -a + 2 * wd, -b, b, fill);   // left post
  isoQuad(g, rc, a - 2 * wd, a, -b, b, fill);     // right post
  isoQuad(g, rc, -a, a, -wd, wd, fill);           // crossbar
}

/* ---- civic landmark furniture (G11) ---- */
// police communications mast: a lattice tower + dish + whip antennas that
// clears the tower skyline, giving the precinct a findable silhouette
function commsMast(g, bx, by) {
  const top = by - 44;
  g.strokeStyle = "#3c4048"; g.lineWidth = 2;
  g.beginPath(); g.moveTo(bx - 5, by); g.lineTo(bx - 1, top); g.stroke();
  g.beginPath(); g.moveTo(bx + 5, by); g.lineTo(bx + 1, top); g.stroke();
  g.strokeStyle = "#5a5f68"; g.lineWidth = 1;
  for (let k = 0; k < 6; k++) {
    const t0 = k / 6, t1 = (k + 1) / 6;
    const y0 = by + (top - by) * t0, y1 = by + (top - by) * t1;
    g.beginPath(); g.moveTo(bx - 5 + 4 * t0, y0); g.lineTo(bx + 5 - 4 * t1, y1); g.stroke();
    g.beginPath(); g.moveTo(bx + 5 - 4 * t0, y0); g.lineTo(bx - 5 + 4 * t1, y1); g.stroke();
  }
  g.fillStyle = "#c8ccd2"; // microwave dish
  g.beginPath(); g.ellipse(bx + 6, by - 22, 4, 5, -0.3, 0, 7); g.fill();
  g.strokeStyle = "#8a8f98"; g.lineWidth = 1; g.stroke();
  g.strokeStyle = "#2b2e34"; g.lineWidth = 1; // whip antennas
  g.beginPath(); g.moveTo(bx - 2, top + 4); g.lineTo(bx - 7, top - 8); g.stroke();
  g.beginPath(); g.moveTo(bx + 2, top + 4); g.lineTo(bx + 6, top - 6); g.stroke();
  g.fillStyle = "#e8524a"; g.fillRect(bx - 1, top - 3, 2, 3); // air-safety tip
}
// blue police shield roof glyph (minimap #88f family) with a white star
function policeShield(g, sx, sy) {
  poly(g, [[sx - 8, sy - 8], [sx + 8, sy - 8], [sx + 8, sy + 2], [sx, sy + 11], [sx - 8, sy + 2]], "#e7ecf7");
  poly(g, [[sx - 6, sy - 6], [sx + 6, sy - 6], [sx + 6, sy + 1.5], [sx, sy + 8.5], [sx - 6, sy + 1.5]], "#5f78ee"); // police-blue
  g.fillStyle = "#f2f5ff";
  g.beginPath();
  for (let k = 0; k < 5; k++) {
    const a = -Math.PI / 2 + k * 2 * Math.PI / 5, a2 = a + Math.PI / 5;
    g.lineTo(sx + Math.cos(a) * 4, sy - 1 + Math.sin(a) * 4);
    g.lineTo(sx + Math.cos(a2) * 1.7, sy - 1 + Math.sin(a2) * 1.7);
  }
  g.closePath(); g.fill();
}
// fire-station hose/training tower — the red-roofed landmark behind the bays
function fireTower(g, bx, by) {
  const top = by - 38;
  g.fillStyle = "#b7ad9a"; g.fillRect(bx - 6, top, 12, by - top);
  g.fillStyle = "#cdc4b2"; g.fillRect(bx - 6, top, 5, by - top);
  g.fillStyle = "#5c4030"; g.fillRect(bx - 4, top + 7, 3, 6); g.fillRect(bx + 2, top + 7, 3, 6);
  poly(g, [[bx - 8, top], [bx + 8, top], [bx, top - 11]], "#c0392b"); // red hip roof
  poly(g, [[bx, top], [bx + 8, top], [bx, top - 11]], "#8f2a20");
  g.strokeStyle = "#4a4a52"; g.lineWidth = 1; // finial pole
  g.beginPath(); g.moveTo(bx, top - 11); g.lineTo(bx, top - 19); g.stroke();
}
// bright-red roll-up garage-door roof emblem (fire minimap colour #f55)
function garageEmblem(g, ex, ey) {
  const rc = [ex, ey];
  isoQuad(g, rc, -5, 5, -3, 3, "#f24b4b", "#7a1512");
  g.strokeStyle = "#c73a34"; g.lineWidth = 1;
  for (const v of [-1, 1]) {
    const a = ruv(rc, -4.5, v), b = ruv(rc, 4.5, v);
    g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
  }
}
// cyan open-book roof glyph (school minimap colour #0cc family)
function schoolBook(g, bx, by) {
  poly(g, [[bx, by - 5], [bx - 9, by - 2], [bx - 9, by + 5], [bx, by + 2]], "#17c6c6", "#0a8f8f");
  poly(g, [[bx, by - 5], [bx + 9, by - 2], [bx + 9, by + 5], [bx, by + 2]], "#22d2d2", "#0a8f8f");
  g.strokeStyle = "#0a8f8f"; g.lineWidth = 1;
  g.beginPath(); g.moveTo(bx, by - 5); g.lineTo(bx, by + 2); g.stroke();
}

// seeded service clutter — AC units, spinning vents, access hatches,
// skylights — scattered around the deck center. sx widens the scatter for
// 2x2 roofs. Positions/kinds come from the caller's seeded RNG.
function roofClutter(g, cx, cy, n, R, sx = 1) {
  for (let k = 0; k < n; k++) {
    const px = cx + (R() * 26 - 13) * sx, py = cy + (R() * 10 - 5) * sx;
    const kind = (R() * 4) | 0;
    if (kind === 0) {          // AC unit on a shadow pad
      g.fillStyle = "#23262c"; g.fillRect(px - 5, py - 2, 10, 4);
      g.fillStyle = "#585c66"; g.fillRect(px - 5, py - 6, 10, 5);
      g.fillStyle = "#7e838e"; g.fillRect(px - 5, py - 7, 10, 2);
      g.fillStyle = "#2c2f36"; g.fillRect(px - 3, py - 5, 3, 2);
    } else if (kind === 1) {   // spinning vent
      g.fillStyle = "#23262c"; g.fillRect(px - 2, py, 5, 2);
      g.fillStyle = "#6c717c"; g.fillRect(px - 1, py - 4, 3, 4);
      g.fillStyle = "#9aa0ab";
      g.beginPath(); g.ellipse(px + 0.5, py - 5, 2.6, 1.7, 0, 0, 7); g.fill();
    } else if (kind === 2) {   // roof access hatch
      g.fillStyle = "#23262c"; g.fillRect(px - 4, py - 1, 8, 3);
      g.fillStyle = "#565a64"; g.fillRect(px - 4, py - 4, 8, 4);
      g.fillStyle = "#787c86"; g.fillRect(px - 4, py - 5, 8, 2);
    } else {                   // skylight
      g.fillStyle = "#1c2733"; g.fillRect(px - 5, py - 3, 9, 5);
      g.fillStyle = "#8fc3e0"; g.fillRect(px - 4, py - 2, 7, 3);
    }
  }
}

// residential roof furniture (G9): the R3 towers trade the old mast for a
// wooden water tank, a stair bulkhead, planters and a clothesline
function waterTank(g, x, y) {
  g.fillStyle = "#23262c"; g.fillRect(x - 5, y, 10, 2);       // shadow pad
  g.fillStyle = "#3c3630"; g.fillRect(x - 4, y - 2, 2, 3);    // legs
  g.fillRect(x + 2, y - 2, 2, 3);
  g.fillStyle = "#8a7a64"; g.fillRect(x - 4, y - 10, 8, 8);   // stave drum
  g.fillStyle = "#a5947c"; g.fillRect(x - 4, y - 10, 3, 8);
  g.fillStyle = "#54493c";                                    // conic cap
  g.beginPath(); g.moveTo(x - 5, y - 10); g.lineTo(x + 5, y - 10);
  g.lineTo(x, y - 14); g.closePath(); g.fill();
}

function bulkhead(g, x, y, base) {
  g.fillStyle = "#23262c"; g.fillRect(x - 5, y, 11, 2);       // shadow pad
  g.fillStyle = shade(base, 0.62); g.fillRect(x - 5, y - 8, 11, 8);
  g.fillStyle = shade(base, 0.9); g.fillRect(x - 5, y - 10, 11, 3);
  g.fillStyle = "#2e2a24"; g.fillRect(x - 1, y - 6, 4, 6);    // stair door
}

function clothesline(g, x, y, R) {
  g.strokeStyle = "#4a4a52"; g.lineWidth = 1;
  g.beginPath(); g.moveTo(x - 8, y); g.lineTo(x - 8, y - 7);
  g.moveTo(x + 8, y + 2); g.lineTo(x + 8, y - 5); g.stroke();
  g.strokeStyle = "#d8d8de";
  g.beginPath(); g.moveTo(x - 8, y - 7); g.lineTo(x + 8, y - 5); g.stroke();
  const cols = ["#cfe0ee", "#efe3c0", "#d6e8c2"]; // washing on the line
  for (let k = 0; k < 3; k++) {
    g.fillStyle = cols[(k + (R() * 3 | 0)) % 3];
    g.fillRect(x - 6 + k * 5, y - 6, 3, 4);
  }
}

function planter(g, x, y) {
  g.fillStyle = "#5c4630"; g.fillRect(x - 4, y - 2, 8, 3);
  g.fillStyle = "#3e8a3e"; g.fillRect(x - 4, y - 4, 8, 2);
  g.fillStyle = "#54a648"; g.fillRect(x - 3, y - 5, 3, 1); g.fillRect(x + 1, y - 5, 2, 1);
}

/* ---- GQ5: silhouette-variety massing helpers ----
   The zone-family remassings (r2/r3/c2/c3/i1/i2) share these. All geometry
   here is deterministic constants — ZERO RNG in any helper — so the shared
   0x5EED R()/ART_RNG stream signature of every family bake is untouched (the
   civic bakes downstream of the zone loops are the byte-identity canary). */

// lift a whole footprint corner set by ht (hoisted from the M28 mega block so
// the tiered zone massings can reuse it; pure, so the megas are unchanged)
const raise = (cn, ht) => ({ N: up(cn.N, ht), E: up(cn.E, ht), S: up(cn.S, ht), W: up(cn.W, ht) });

// hip/gable roof: two roof planes from the eave ring up(cn, ht) to a ridge
// segment along tile axis `axis` (0: ridge toward W-E, the tinyHouse
// orientation; 1: ridge toward N-S). Built from corner lerps on any corner
// set, so it is facing-agnostic (M32: tiers/roofs stay corner-symmetric).
// kR = ridge length as a fraction of the axis diagonal (kR -> 1 = gable).
// Both planes + the viewer-facing eaves register on SNOWSPEC (G14 snow caps).
function hipRoofFrom(g, cn, ht, rise, roofHi, roofLo, axis = 0, kR = 0.42) {
  const T = raise(cn, ht);
  const c = [(T.N[0] + T.E[0] + T.S[0] + T.W[0]) / 4,
             (T.N[1] + T.E[1] + T.S[1] + T.W[1]) / 4];
  const rp = (p) => [c[0] + (p[0] - c[0]) * kR, c[1] + (p[1] - c[1]) * kR - rise];
  let back, front;
  if (axis === 0) { // ridge along W->E: back (NE) plane lit, front in shade
    const rA = rp(T.W), rB = rp(T.E);
    back  = { pts: [T.W, T.N, T.E, rB, rA] };
    front = { pts: [T.W, T.S, T.E, rB, rA], eaves: [[T.W, T.S], [T.S, T.E]] };
    poly(g, back.pts, roofHi);
    poly(g, front.pts, roofLo);
  } else {          // ridge along N->S: W-side plane is the shadow side
    const rA = rp(T.N), rB = rp(T.S);
    back  = { pts: [T.N, T.W, T.S, rB, rA], eaves: [[T.W, T.S]] };
    front = { pts: [T.N, T.E, T.S, rB, rA], eaves: [[T.S, T.E]] };
    poly(g, back.pts, roofLo);
    poly(g, front.pts, roofHi);
  }
  g.strokeStyle = "rgba(20,12,8,.35)"; g.lineWidth = 1; // ridge shadow line
  g.beginPath(); g.moveTo(back.pts[3][0], back.pts[3][1]);
  g.lineTo(back.pts[4][0], back.pts[4][1]); g.stroke();
  if (SNOWSPEC) { SNOWSPEC.push(back); SNOWSPEC.push(front); }
}

// north-light sawtooth crown: split the top-face diamond into `teeth` strips
// along the NE->SW tile axis (corner lerps, like civicApron's joint lines);
// each tooth is a lit sloped plane (I_ROOF rust family) rising toward the
// viewer with a near-vertical dark glass skylight face dropping off its high
// edge. Every lit plane registers on SNOWSPEC so makeWinter caps the teeth.
function sawtoothRoof(g, cn, ht, teeth, rise, roofCol) {
  const T = raise(cn, ht);
  const a = (t) => [T.N[0] + (T.W[0] - T.N[0]) * t, T.N[1] + (T.W[1] - T.N[1]) * t];
  const b = (t) => [T.E[0] + (T.S[0] - T.E[0]) * t, T.E[1] + (T.S[1] - T.E[1]) * t];
  for (let k = 0; k < teeth; k++) {
    const f0 = k / teeth, f1 = (k + 1) / teeth;
    const lit = { pts: [up(a(f1), rise), up(b(f1), rise), b(f0), a(f0)] };
    poly(g, lit.pts, shade(roofCol, 1.04), shade(roofCol, 0.6));
    // near-vertical glass face on the high edge, facing the viewer (SW)
    poly(g, [a(f1), b(f1), up(b(f1), rise), up(a(f1), rise)], "#1c2733");
    const gA = a(f1), gB = b(f1);
    g.fillStyle = "#8fc3e0";
    for (const t of [0.16, 0.5, 0.84]) {
      const gx = gA[0] + (gB[0] - gA[0]) * t, gy = gA[1] + (gB[1] - gA[1]) * t;
      g.fillRect(gx - 4, gy - rise + 2, 8, rise - 4);
    }
    if (SNOWSPEC) SNOWSPEC.push(lit);
  }
}

// stacked setback tiers — the proven plymouth/darco idiom as a helper.
// tiers = [{k, ht, base, opts}] bottom-up; each prism is inset by k and
// raised by the cumulative height below it. Returns [{cn, top}] per tier
// (cn = the tier's RAISED base corner set) so callers can dress terraces.
function setbackTiers(g, ox, oy, w, h, tiers) {
  const out = []; let cum = 0;
  for (const t of tiers) {
    const cn = raise(insetCorners(ox, oy, w, h, t.k), cum);
    prismFrom(g, cn, t.ht, t.base, t.opts || {});
    cum += t.ht;
    out.push({ cn, top: cum });
  }
  return out;
}

/* ---- GQ5: standalone roof props ----
   Position-parameter re-draws of the roofClutter / waterTank / planter shapes
   with ZERO RNG inside — withJitter scatters these from a seeded side stream
   onto each value-jitter DAY copy, so orthogonal same-variant neighbours
   (which the renderer maps to different jit copies via (x+2*y)&3) always show
   different roof furniture. The seeded originals are NOT touched, so every
   civic/landmark bake that uses them stays byte-identical. */
const ROOF_PROPS = [
  (g, x, y) => { // AC unit on a shadow pad
    g.fillStyle = "#23262c"; g.fillRect(x - 5, y - 2, 10, 4);
    g.fillStyle = "#585c66"; g.fillRect(x - 5, y - 6, 10, 5);
    g.fillStyle = "#7e838e"; g.fillRect(x - 5, y - 7, 10, 2);
    g.fillStyle = "#2c2f36"; g.fillRect(x - 3, y - 5, 3, 2);
  },
  (g, x, y) => { // spinning vent
    g.fillStyle = "#23262c"; g.fillRect(x - 2, y, 5, 2);
    g.fillStyle = "#6c717c"; g.fillRect(x - 1, y - 4, 3, 4);
    g.fillStyle = "#9aa0ab";
    g.beginPath(); g.ellipse(x + 0.5, y - 5, 2.6, 1.7, 0, 0, 7); g.fill();
  },
  (g, x, y) => { // roof access hatch
    g.fillStyle = "#23262c"; g.fillRect(x - 4, y - 1, 8, 3);
    g.fillStyle = "#565a64"; g.fillRect(x - 4, y - 4, 8, 4);
    g.fillStyle = "#787c86"; g.fillRect(x - 4, y - 5, 8, 2);
  },
  (g, x, y) => { // skylight
    g.fillStyle = "#1c2733"; g.fillRect(x - 5, y - 3, 9, 5);
    g.fillStyle = "#8fc3e0"; g.fillRect(x - 4, y - 2, 7, 3);
  },
  (g, x, y) => { // small water tank
    g.fillStyle = "#23262c"; g.fillRect(x - 4, y, 8, 2);
    g.fillStyle = "#8a7a64"; g.fillRect(x - 3, y - 7, 6, 6);
    g.fillStyle = "#a5947c"; g.fillRect(x - 3, y - 7, 2, 6);
    g.fillStyle = "#54493c";
    g.beginPath(); g.moveTo(x - 4, y - 7); g.lineTo(x + 4, y - 7);
    g.lineTo(x, y - 10); g.closePath(); g.fill();
  },
  (g, x, y) => { // small stair bulkhead
    g.fillStyle = "#23262c"; g.fillRect(x - 4, y, 9, 2);
    g.fillStyle = "#4e4a44"; g.fillRect(x - 4, y - 6, 9, 6);
    g.fillStyle = "#6e6a62"; g.fillRect(x - 4, y - 8, 9, 3);
    g.fillStyle = "#2e2a24"; g.fillRect(x - 1, y - 4, 3, 4);
  },
  (g, x, y) => { // planter box
    g.fillStyle = "#5c4630"; g.fillRect(x - 4, y - 2, 8, 3);
    g.fillStyle = "#3e8a3e"; g.fillRect(x - 4, y - 4, 8, 2);
    g.fillStyle = "#54a648"; g.fillRect(x - 3, y - 5, 3, 1); g.fillRect(x + 1, y - 5, 2, 1);
  },
  (g, x, y) => { // pipe vent with rain cap
    g.fillStyle = "#23262c"; g.fillRect(x - 2, y, 4, 2);
    g.fillStyle = "#6c717c"; g.fillRect(x - 1, y - 6, 2, 6);
    g.fillStyle = "#8a8f98"; g.fillRect(x - 3, y - 8, 6, 2);
  },
];

// G5: scrambled coordinate hash for terrain variation (grass mottle, water
// variant). Pure in (x, y) — every boot and every frame agrees, so the
// terrain-layer cache stays deterministic and rebuild-free.
function terrHash(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

// GQ2: seed-folding coordinate hash for the ground-material quilt — the same
// integer mix as terrHash with city.seed folded in, normalized to [0, 1).
// Pure O(1) in (seed, gx, gy): every boot, frame and rotation agrees, and the
// seed is already serialized (save v11), so save/load determinism is free.
function hash01(seed, gx, gy) {
  let h = (gx * 374761393 + gy * 668265263 + Math.imul(seed | 0, 0x9E3779B1)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// GQ2: smoothstep-bilinear value noise on a lattice of spacing `cell` — the
// same shape as generateTerrain's hAt, but hash-based so any (x, y) is O(1)
// with no per-map state (buildTerrainLayer queries it only on the rare
// terrain-layer rebuild, never per frame).
function valNoise2(seed, x, y, cell) {
  const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
  let fx = x / cell - cx, fy = y / cell - cy;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = hash01(seed, cx, cy), b = hash01(seed, cx + 1, cy);
  const c = hash01(seed, cx, cy + 1), d = hash01(seed, cx + 1, cy + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

// GQ2: ground material for a bare GRASS-terr tile — 0 grass, 1 dirt, 2 sand
// lot, 3 pavement (index into fam.ground). A low-frequency quilt field
// (cell 7 → patches of ~5-12 tile extent) broken up by a cell-3 detail
// octave; the thresholds sit at the blend's ~8/21/79% quantiles, so an empty
// 128 map lands near grass 58%, dirt 21%, sand 13%, pave 8%. Pure in
// (seed, LOGICAL x, y) — quilt patches stay put under rotation (M32).
function groundMat(seed, x, y) {
  const v = 0.72 * valNoise2(seed, x, y, 7) + 0.28 * valNoise2(seed ^ 0x51AB, x, y, 3);
  return v < 0.255 ? 3 : v < 0.345 ? 2 : v < 0.645 ? 0 : 1;
}

// GQ2: directional relief from a lower-frequency field — the gradient of a
// cell-11 swell toward the fixed screen-NW light: +1 lit slope, -1 shaded,
// 0 flat. Broad light/dark swells sweep the plane so open ground never reads
// as one flat tone; pure in LOGICAL (x, y), so rotation-stable (M32).
function reliefShade(seed, x, y) {
  const s2 = seed ^ 0x7E11;
  const d = valNoise2(s2, x - 1, y - 1, 11) - valNoise2(s2, x + 1, y + 1, 11);
  return d > 0.045 ? 1 : d < -0.045 ? -1 : 0;
}

// G5: water bakes WATER_VARIANTS positional variants x WATER_FRAMES shimmer
// frames per season — buildTerrainLayer picks the variant by terrHash and
// offsets the frame by (x + y), so adjacent lake tiles never render alike.
const WATER_FRAMES = 3, WATER_VARIANTS = 3;
// G13: the shore band bakes SHORE_VARIANTS width-jittered variants per mask.
// buildTerrainLayer picks one by terrHash(x,y), so a straight coast draws a
// wandering sand width per tile instead of one uniform rampart — cache-safe
// and deterministic, exactly like the water variants above.
const SHORE_VARIANTS = 4;

// G5: opaque fill for flat terrain diamonds — the fill plus a 2px stroke in
// the SAME style straddling the edge, so adjacent tiles composite to full
// opacity across their shared seam. Without the old dark edge strokes, bare
// antialiased diamond edges would let the canvas background bleed through
// every interior seam as a faint grid.
function sealedDiamond(g, ox, oy, style) {
  diamondPath(g, ox, oy);
  g.fillStyle = style; g.fill();
  g.strokeStyle = style; g.lineWidth = 2; g.stroke();
}

function diamondPath(g, ox, oy) {
  g.beginPath();
  g.moveTo(ox, oy - HH); g.lineTo(ox + HW, oy);
  g.lineTo(ox, oy + HH); g.lineTo(ox - HW, oy);
  g.closePath();
}

/* =============================== build all =============================== */
function buildSprites() {
  const seeded = mulberry32(0x5EED);
  const R = () => seeded(); // stable art randomness
  ART_RNG = seeded; // G9: windows() pane lighting joins the seeded stream
  // G13: shore-width and forest hue/silhouette jitter draw from their own
  // seeded streams so they never shift the shared R()/ART_RNG sequence — the
  // building/window/roof bakes downstream stay byte-identical to pre-G13.
  const shoreRng = mulberry32(0x5A17);
  // GQ9 HARD RULE: every NEW shore jitter (wet-band widths, foam scallop
  // phases) draws ONLY from this dedicated stream — the 4 existing shoreRng
  // width calls per mask sprite stay first and in their exact order, so the
  // dry-sand widths are numerically unchanged and every non-shore bake stays
  // byte-identical (shore bakes still consume zero R()/ART_RNG/groundRng).
  const foamRng = mulberry32(0x0F0A);
  const forestRng = mulberry32(0x0F0E);
  // GQ2 HARD RULE: every NEW draw op in the terrain family (material tiles,
  // extra grass flecks, relief tints, matFringe feather) consumes ONLY this
  // side stream — the shared R()/ART_RNG call count and order are untouched,
  // so every downstream building/window/roof bake stays byte-identical.
  const groundRng = mulberry32(0x6D01);
  // GQ4 HARD RULE (same as GQ2): the street-tree bakes consume ONLY this side
  // stream — zero R()/ART_RNG/shoreRng/forestRng/groundRng calls — so every
  // existing bake (buildings, windows, roofs, terrain) stays byte-identical.
  const streetRng = mulberry32(0x57EE7);
  // GQ4 panel fix: roll the 6 street-tree variant parameters ONCE, up front,
  // so a given variant is the SAME tree (size/silhouette/tint) in all four
  // seasonal bakes — only the foliage palette changes with the season
  // (G12/G14), never the tree itself. Sizes 5.4-8.4px stay well below the
  // 10-14px forest canopies (groomed parkway scale) so canopies no longer
  // reach the centre-line dashes, and the hue centres are pinned one per
  // autumn leaf-set band (gold / orange / red at v%3 = 0/1/2, jitter +-0.15
  // stays inside the +-0.27 band edges) so an autumn street shows the same
  // mixed-colour canopy row as the forests instead of a monotone red run.
  const STREET_TREE_VAR = [];
  for (let v = 0; v < 6; v++) {
    STREET_TREE_VAR.push({
      s: 5.4 + (v % 3) * 1.1 + streetRng() * 0.8,
      sil: v < 4 ? 0 : 2,                       // round / occasional wide oak
      hue: [0.55, -0.05, -0.55][v % 3] + (streetRng() * 0.3 - 0.15),
      tint: 0.9 + streetRng() * 0.25,
    });
  }

  // ---- terrain families, baked once per season (M12) ----
  // The same draw code runs for each of the four palettes; renderFrame picks
  // SPR.season[seasonOf(city.month)]. Nothing is (re)built after boot.
  SPR.season = {};
  const TREES_PER_TIER = [2, 4, 7];  // sparse / medium / dense
  const TREE_SIZE_TIER = [10, 12, 14];
  for (const sk of ["winter", "spring", "summer", "autumn"]) {
    const P = SEASON_PAL[sk];
    const fam = { grass: [], water: [], shore: [], forest: [] };

    // grass (or snowpack, or dry stubble) — no edge stroke (G5): interior
    // same-type seams are invisible; type-change boundaries get their line
    // from the SPR.terrEdge overlays chosen per tile in buildTerrainLayer
    // GQ2: shared VERTICAL within-tile relief gradient — every ground bake
    // gets the same top-lit wash, so parity twins never disagree on relief
    const reliefGrad = (g, ox, oy) => {
      const gr = g.createLinearGradient(ox, oy - HH, ox, oy + HH);
      gr.addColorStop(0, "rgba(255,255,240,.05)");
      gr.addColorStop(1, "rgba(10,16,12,.06)");
      g.fillStyle = gr; g.fillRect(ox - HW, oy - HH, TW, TH);
    };
    // GQ2 fix (C2): pixel-snapped GRAIN — 2x1 flecks at INTEGER coords (no
    // antialiasing, so the full boosted alpha lands on single pixels) in the
    // material's own fleck tones. Every ground bake ends with its own grain
    // layout from groundRng; since orthogonal neighbors always differ in
    // (x+y)&1 parity and each parity is an independent bake, every adjacent
    // same-material pair differs at dozens of full-contrast positions —
    // fractional-coordinate stipple alone antialiased below the measurable
    // per-channel threshold on variant-hash collisions.
    const boostA = (rgba, f) => rgba.replace(/(\d*\.?\d+)\)\s*$/,
      (m, a) => Math.min(0.5, parseFloat(a) * f) + ")");
    const grain = (g, ox, oy, fa, fb) => {
      g.fillStyle = boostA(fa, 3);
      for (let k = 0; k < 32; k++)
        g.fillRect((ox - HW + groundRng() * (TW - 2)) | 0, (oy - HH + groundRng() * TH) | 0, 2, 1);
      g.fillStyle = boostA(fb, 3);
      for (let k = 0; k < 32; k++)
        g.fillRect((ox - HW + groundRng() * (TW - 2)) | 0, (oy - HH + groundRng() * TH) | 0, 2, 1);
    };
    for (let v = 0; v < 4; v++) {
      fam.grass.push(mkSprite(1, 1, 0, (g, ox, oy) => {
        sealedDiamond(g, ox, oy, P.grass[v]); // opaque seam, no bleed
        g.save(); diamondPath(g, ox, oy); g.clip();
        g.fillStyle = P.fleckA;
        for (let k = 0; k < 14; k++) g.fillRect(ox - HW + R() * TW, oy - HH + R() * TH, 2, 1);
        g.fillStyle = P.fleckB;
        for (let k = 0; k < 10; k++) g.fillRect(ox - HW + R() * TW, oy - HH + R() * TH, 2, 1);
        // GQ2: the same vertical relief wash the new materials get, plus 60
        // EXTRA 2px flecks appended AFTER the untouched R() flecks above —
        // all from groundRng, so the shared seeded stream never shifts and
        // open lawns reach the stipple density that keeps 4-adjacent lawn
        // tiles measurably distinct — then the pixel-snapped grain pass
        // that guarantees full-contrast per-tile differences (C2)
        reliefGrad(g, ox, oy);
        g.fillStyle = P.fleckA;
        for (let k = 0; k < 30; k++)
          g.fillRect(ox - HW + groundRng() * TW, oy - HH + groundRng() * TH, 2, 1);
        g.fillStyle = P.fleckB;
        for (let k = 0; k < 30; k++)
          g.fillRect(ox - HW + groundRng() * TW, oy - HH + groundRng() * TH, 2, 1);
        grain(g, ox, oy, P.fleckA, P.fleckB);
        g.restore();
      }));
    }

    // GQ2 fix (C2): parity-B grass — four MORE grass bakes, one per variant,
    // drawn ONLY from groundRng (zero R() calls, so the shared seeded stream
    // and every downstream building bake stay byte-identical to before).
    // buildTerrainLayer indexes fam.ground[mi][variant | parity<<2], so two
    // orthogonally-adjacent tiles ALWAYS pull different canvases with
    // independent fleck/grain layouts, even on a terrHash&3 collision.
    const grassAlt = [];
    for (let v = 0; v < 4; v++) {
      grassAlt.push(mkSprite(1, 1, 0, (g, ox, oy) => {
        sealedDiamond(g, ox, oy, P.grass[v]); // opaque seam, no bleed
        g.save(); diamondPath(g, ox, oy); g.clip();
        g.fillStyle = P.fleckA; // same density as parity A (24 + 60 flecks)
        for (let k = 0; k < 44; k++)
          g.fillRect(ox - HW + groundRng() * TW, oy - HH + groundRng() * TH, 2, 1);
        g.fillStyle = P.fleckB;
        for (let k = 0; k < 40; k++)
          g.fillRect(ox - HW + groundRng() * TW, oy - HH + groundRng() * TH, 2, 1);
        reliefGrad(g, ox, oy);
        grain(g, ox, oy, P.fleckA, P.fleckB);
        g.restore();
      }));
    }

    // GQ2: ground-material quilt tiles — dirt / sand lot / pavement, selected
    // per tile by groundMat(city.seed, x, y) in buildTerrainLayer. 4 variants
    // of a 1x1 sealed diamond each; every random draw pulls from groundRng.
    const matTile = (base, fa, fb, kind, crack) => mkSprite(1, 1, 0, (g, ox, oy) => {
      sealedDiamond(g, ox, oy, base); // opaque seam, no bleed
      g.save(); diamondPath(g, ox, oy); g.clip();
      reliefGrad(g, ox, oy); // (a) vertical within-tile relief
      // (b) dense two-tone stipple — no flat run survives, and adjacent
      // same-material tiles always differ by their relocated flecks
      g.fillStyle = fa;
      for (let k = 0; k < 40; k++)
        g.fillRect(ox - HW + groundRng() * TW, oy - HH + groundRng() * TH, 1 + (groundRng() < 0.6 ? 1 : 0), 1);
      g.fillStyle = fb;
      for (let k = 0; k < 36; k++)
        g.fillRect(ox - HW + groundRng() * TW, oy - HH + groundRng() * TH, 1 + (groundRng() < 0.6 ? 1 : 0), 1);
      // (c) material signature detail
      if (kind === 1) { // dirt: darker clod dashes + one faint wheel-rut pair
        g.fillStyle = fb;
        const nc = 4 + (groundRng() * 3 | 0);
        for (let k = 0; k < nc; k++)
          g.fillRect(ox - HW + 6 + groundRng() * (TW - 14), oy - HH + 3 + groundRng() * (TH - 6),
                     3 + groundRng() * 3, 1);
        g.strokeStyle = "rgba(40,26,10,.14)"; g.lineWidth = 1.3;
        const ry = oy - 3 + groundRng() * 6;
        // rut direction picked per BAKE (panel: the old per-tile mirror made
        // adjacent ruts herringbone; independent bakes track both ways)
        const rd = groundRng() < 0.5 ? 4 : -4;
        for (const off of [-2.5, 2.5]) {
          g.beginPath();
          g.moveTo(ox - HW + 8, ry + off + rd); g.lineTo(ox + HW - 8, ry + off - rd);
          g.stroke();
        }
      } else if (kind === 2) { // sand lot: light wind-ripple dashes
        g.strokeStyle = fa; g.lineWidth = 1;
        const nr = 3 + (groundRng() * 2 | 0);
        for (let k = 0; k < nr; k++) {
          const rx = ox - HW + 8 + groundRng() * (TW - 26), ryy = oy - HH + 4 + groundRng() * (TH - 8);
          g.beginPath(); g.moveTo(rx, ryy);
          g.bezierCurveTo(rx + 5, ryy - 1.5, rx + 9, ryy + 1.5, rx + 14, ryy);
          g.stroke();
        }
      } else { // pavement: hairline cracks + expansion joint + corner wear
        g.strokeStyle = crack; g.lineWidth = 1;
        for (let k = 0; k < 2; k++) {
          let px = ox - HW + 10 + groundRng() * (TW - 20), py = oy - HH + 4 + groundRng() * (TH - 8);
          g.beginPath(); g.moveTo(px, py);
          for (let sg = 0; sg < 3; sg++) {
            px += 3 + groundRng() * 5; py += groundRng() * 6 - 3;
            g.lineTo(px, py);
          }
          g.stroke();
        }
        // one 1px expansion joint parallel to a diamond edge: endpoints at
        // equal fractions along the two flanking edges are exactly parallel
        const N = [ox, oy - HH], E = [ox + HW, oy], S = [ox, oy + HH], W = [ox - HW, oy];
        const lp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        const ft = 0.3 + groundRng() * 0.4, ne = groundRng() < 0.5;
        const A = ne ? lp(N, W, ft) : lp(N, E, ft);
        const B = ne ? lp(E, S, ft) : lp(W, S, ft);
        g.strokeStyle = crack;
        g.beginPath(); g.moveTo(A[0], A[1]); g.lineTo(B[0], B[1]); g.stroke();
        g.fillStyle = fb; // corner wear patches at the E/W points
        g.beginPath(); g.ellipse(ox + HW - 5, oy, 4 + groundRng() * 2, 2.2, 0, 0, 7); g.fill();
        g.beginPath(); g.ellipse(ox - HW + 5, oy, 4 + groundRng() * 2, 2.2, 0, 0, 7); g.fill();
      }
      grain(g, ox, oy, fa, fb); // C2: full-contrast pixel-snapped grain last
      g.restore();
    });
    // GQ2 fix (C2): 8 bakes per material — entries 0-3 are (x+y)-even
    // parity, 4-7 are odd parity, each an INDEPENDENT groundRng bake, so
    // orthogonal neighbors never share a canvas: fam.ground[mi][v | par<<2]
    const dirtArr = [], sandLotArr = [], paveArr = [];
    for (let par = 0; par < 2; par++) {
      for (let v = 0; v < 4; v++) {
        dirtArr.push(matTile(P.dirt[v], P.dirtFleckA, P.dirtFleckB, 1, null));
        sandLotArr.push(matTile(P.sandLot[v], P.sandFleckA, P.sandFleckB, 2, null));
        paveArr.push(matTile(P.pave[v], P.paveFleckA, P.paveFleckB, 3, P.paveCrack));
      }
    }
    // index === groundMat; grass = [4 parity-A (R()-fleck) | 4 parity-B]
    fam.ground = [fam.grass.concat(grassAlt), dirtArr, sandLotArr, paveArr];

    // water: WATER_VARIANTS positional variants x WATER_FRAMES shimmer
    // frames (G5) — fam.water[v][f]. No edge stroke: an open lake reads as
    // one continuous surface. Wave/glint positions are pure arithmetic in
    // (k, f, v) so every boot builds pixel-identical frames and equal
    // (variant, frame) pairs always render identically.
    for (let v = 0; v < WATER_VARIANTS; v++) {
      const vfr = [];
      for (let f = 0; f < WATER_FRAMES; f++) {
        vfr.push(mkSprite(1, 1, 0, (g, ox, oy) => {
          const gr = g.createLinearGradient(ox, oy - HH, ox, oy + HH);
          gr.addColorStop(0, P.waterTop); gr.addColorStop(1, P.waterBot);
          sealedDiamond(g, ox, oy, gr); // opaque seam, no bleed
          g.save(); diamondPath(g, ox, oy); g.clip();
          // GQ1: two-tone ORDERED DITHER — a 256-color-era cobalt stipple laid
          // under the wave strokes. The second tone (P.waterDith) is dropped on
          // one phase of a 2x2 block-parity Bayer pattern; the phase term
          // (f+v)&1 is pure arithmetic (no RNG, no per-frame recompute), so
          // every boot bakes these SPR.season.*.water canvases byte-identical.
          if (P.waterDith) {
            g.fillStyle = P.waterDith;
            for (let py = -HH; py < HH; py += 2) {
              for (let px = -HW; px < HW; px += 2) {
                if ((((px >> 1) + (py >> 1)) & 1) === ((f + v) & 1)) continue;
                g.fillRect(ox + px, oy + py, 1, 1);
              }
            }
            // GQ1: SINE-SCROLL HIGHLIGHT — a brighter cobalt crest whose vertical
            // offset is A*sin(phase) with phase = f*2 + v*3 + k, a pure integer
            // function of (f, v, k). It scrolls across the WATER_FRAMES so the
            // surface glimmers, and Math.sin of integer args is byte-identical
            // every boot (determinism preserved, still one cached blit/frame).
            g.fillStyle = P.waterCrest;
            for (let k = 0; k < 3; k++) {
              const by = oy - HH + 8 + k * 8 + Math.round(3 * Math.sin(f * 2 + v * 3 + k));
              g.fillRect(ox - HW, by, TW, 2);
            }
          }
          g.strokeStyle = P.wave; g.lineWidth = 1;
          for (let k = 0; k < 4; k++) {
            const wy = oy - HH + 4 + k * 7 + ((k * 5 + f * 2 + v * 3) % 5);
            const wx = ox - HW + ((k * 13 + f * 11 + v * 19) % 40);
            g.beginPath(); g.moveTo(wx, wy);
            g.bezierCurveTo(wx + 8, wy - 2, wx + 14, wy + 2, wx + 22, wy); g.stroke();
          }
          g.fillStyle = P.glint; // shimmering glints (ice sparkle in winter)
          for (let k = 0; k < 3; k++) {
            g.fillRect(ox - HW + 4 + ((k * 23 + f * 17 + v * 29) % 54),
                       oy - HH + 3 + ((k * 11 + f * 7 + v * 5) % 26), 2, 1);
          }
          g.restore();
        }));
      }
      fam.water.push(vfr);
    }

    // shoreline bands (SHORE_VARIANTS x 16 masks; bit0=N bit1=E bit2=S bit3=W)
    // — sand in summer, icy shelf + ice-edge crack in winter. Drawn over a
    // water tile on its land-facing edges AND over a land tile on its
    // water-facing edges, so the treatment straddles the seam with no hard
    // line. G13: per-edge seeded width jitter (each variant differs), corner
    // wedge fills so the coast bevels around corners instead of pinching into
    // bowties at diagonal water contacts, a DIMMED dry lip (so the beach stops
    // reading as a rampart), and — in winter — a dark ice-edge crack instead.
    // GQ9: the band stack now forms a beveled RAMP instead of a cliff (summer
    // luma path grass → dry sand → wet sand → foam ridge → underwater shelf →
    // water). The sprite still draws from BOTH sides of every seam (shoreMask
    // on the water tile, beachMask on the land tile), so the water-tile draw
    // owns the waterward half of the stack and the land-tile draw the landward
    // half — the same bake serves both with no render.js change.
    for (let sv = 0; sv < SHORE_VARIANTS; sv++) {
      const svar = [];
      for (let m = 0; m < 16; m++) {
        svar.push(mkSprite(1, 1, 4, (g, ox, oy) => {
          if (!m) return; // open water / inland: no band
          const N = [ox, oy - HH], E = [ox + HW, oy], S = [ox, oy + HH], W = [ox - HW, oy];
          const cpts = [N, E, S, W];
          const edges = [[N, E], [E, S], [S, W], [W, N]]; // bit order N,E,S,W
          // per-edge sand width, 5..9px — jittered from the shore stream so
          // the four variants differ and adjacent coast tiles wander in width.
          // GQ9 HARD RULE: these 4 shoreRng calls stay FIRST and in order —
          // all new jitter below draws only from the dedicated foamRng.
          const wdt = [0, 0, 0, 0];
          for (let b = 0; b < 4; b++) wdt[b] = 5 + shoreRng() * 4;
          // GQ9: per-edge wet-band width, 2.5..3.5px (foam stream only)
          const wet = [0, 0, 0, 0];
          for (let b = 0; b < 4; b++) wet[b] = 2.5 + foamRng();
          // clip to a slightly expanded diamond so the band hugs both sides of the seam
          g.save();
          g.translate(ox, oy); g.scale((TW + 6) / TW, (TH + 3) / TH); g.translate(-ox, -oy);
          diamondPath(g, ox, oy);
          g.restore();
          g.save(); g.clip();
          const lerp = (P0, t) => [P0[0] + (ox - P0[0]) * t, P0[1] + (oy - P0[1]) * t];
          // every diamond edge sits 14.31px from the center, so lerp t = d/14.31
          // places a band exactly d px inward of the seam (perpendicular)
          const LT = (d) => d / 14.31;
          g.lineCap = "butt";
          // GQ9: corner wedge fill at a given inset scale — where BOTH edges
          // meeting at a diamond corner are shore edges, fill a triangle so the
          // band bevels around the corner (kills the 90-degree notch /
          // diagonal-contact bowtie). scale 1 reproduces the G13 sand wedge
          // exactly; the wet/foam bands reuse it scaled toward the corner.
          const wedges = (scale, style) => {
            g.fillStyle = style;
            for (let c = 0; c < 4; c++) {
              const eA = (c + 3) & 3, eB = c;               // the two edges at corner c
              if (!((m & (1 << eA)) && (m & (1 << eB)))) continue;
              const CP = cpts[c];
              const oA = edges[eA][0] === CP ? edges[eA][1] : edges[eA][0]; // far ends
              const oB = edges[eB][0] === CP ? edges[eB][1] : edges[eB][0];
              const fl = (Q0, Q1, t) => [Q0[0] + (Q1[0] - Q0[0]) * t, Q0[1] + (Q1[1] - Q0[1]) * t];
              const fA = fl(CP, oA, 0.34 * scale), fB = fl(CP, oB, 0.34 * scale);
              const apex = [CP[0] + (ox - CP[0]) * 0.5 * scale, CP[1] + (oy - CP[1]) * 0.5 * scale];
              g.beginPath(); g.moveTo(fA[0], fA[1]); g.lineTo(apex[0], apex[1]);
              g.lineTo(fB[0], fB[1]); g.closePath(); g.fill();
            }
          };
          // 1) main sand band per set edge, jittered width (unchanged widths)
          for (let b = 0; b < 4; b++) {
            if (!(m & (1 << b))) continue;
            const [P0, P1] = edges[b];
            g.strokeStyle = P.sand; g.lineWidth = wdt[b];
            g.beginPath(); g.moveTo(P0[0], P0[1]); g.lineTo(P1[0], P1[1]); g.stroke();
          }
          // 2) corner wedge fills (the existing G13 sand wedge)
          wedges(1, P.sand);
          // 2b) GQ9 underwater shelf ramp: fixed-depth translucent strokes
          // drawn AFTER the sand so they read (the design's lerp −0.06 spot is
          // fully overpainted by the 5-9px sand straddle). On the water-tile
          // draw they land waterward of the seam: a near-opaque damp-sand
          // plate caps the dry sand at ~2px past the seam (covering the
          // jittered sand edge so the underlying sand→water switch can't pop),
          // then shallow sand fades with depth — ~150 → 128 → 118 → 106 luma
          // over summer water — turning the old cliff into a measured ramp.
          // On the land-tile draw the same offsets feather the sand landward.
          // The ramp ends ~9px out, so open-water plateaus stay untinted.
          for (let b = 0; b < 4; b++) {
            if (!(m & (1 << b))) continue;
            const [P0, P1] = edges[b];
            const step = (dpx, wpx, style, ga) => {
              if (ga) g.globalAlpha = ga;
              g.strokeStyle = style; g.lineWidth = wpx;
              g.beginPath();
              g.moveTo(...lerp(P0, LT(dpx))); g.lineTo(...lerp(P1, LT(dpx)));
              g.stroke();
              g.globalAlpha = 1;
            };
            step(2.7, 3.0, P.sandWet, 0.85);          // damp waterline plate
            step(4.8, 1.8, P.sandWet, 0.52);
            step(6.3, 2.0, boostA(P.shelf, 0.8), 0);  // shallow shelf, ~.24
            step(7.8, 2.4, boostA(P.shelf, 0.55), 0); // deep shelf, ~.17
            // (the wrack/berm seam moved to the LAND-ONLY dune bake below —
            // shared here it also fell mid-ramp on the water side and broke
            // the shelf's monotone descent)
          }
          // 2c) GQ9 wet-sand band: the damp strip between dry sand and waterline
          for (let b = 0; b < 4; b++) {
            if (!(m & (1 << b))) continue;
            const [P0, P1] = edges[b];
            g.strokeStyle = P.sandWet; g.lineWidth = wet[b];
            g.beginPath(); g.moveTo(...lerp(P0, 0.05)); g.lineTo(...lerp(P1, 0.05)); g.stroke();
          }
          wedges(0.7, P.sandWet); // convex corners keep the full bevel
          // 3) outer lip: winter draws a DARK ice-edge crack on the seam so the
          // frozen coast stays legible against the snowpack; other seasons draw
          // a DIMMED dry highlight that no longer reads as a raised rampart
          for (let b = 0; b < 4; b++) {
            if (!(m & (1 << b))) continue;
            const [P0, P1] = edges[b];
            if (P.iceEdge) {
              g.strokeStyle = P.iceEdge; g.lineWidth = 2.2;
              g.beginPath(); g.moveTo(P0[0], P0[1]); g.lineTo(P1[0], P1[1]); g.stroke();
            } else {
              g.strokeStyle = P.sandHi; g.lineWidth = 2.2;
              g.beginPath(); g.moveTo(...lerp(P0, 0.10)); g.lineTo(...lerp(P1, 0.10)); g.stroke();
            }
          }
          // 4) GQ9 surf foam band (replaces the old 1.4px alpha-.32 stroke):
          // a soft halo under a bright core hugging the waterline, plus
          // foamRng-phased scallop bulges bowing toward the seam so the
          // waterline reads as surf. Kept within ~3px of the seam so the
          // shelf ramp beyond it stays a clean monotone descent.
          const foamHalo = boostA(P.foamBand, 0.35);
          for (let b = 0; b < 4; b++) {
            if (!(m & (1 << b))) continue;
            const [P0, P1] = edges[b];
            g.strokeStyle = foamHalo; g.lineWidth = 3.0;
            g.beginPath(); g.moveTo(...lerp(P0, 0.12)); g.lineTo(...lerp(P1, 0.12)); g.stroke();
            g.strokeStyle = P.foamBand; g.lineWidth = 2.4;
            g.beginPath(); g.moveTo(...lerp(P0, 0.12)); g.lineTo(...lerp(P1, 0.12)); g.stroke();
            const edgePt = (u) => [P0[0] + (P1[0] - P0[0]) * u, P0[1] + (P1[1] - P0[1]) * u];
            const nsc = 3 + (foamRng() < 0.5 ? 0 : 1);
            g.lineWidth = 1.5;
            for (let k = 0; k < nsc; k++) {
              const tc = (k + 0.2 + foamRng() * 0.6) / nsc; // phase along the edge
              const hs = 0.07 + foamRng() * 0.05;           // half-span
              const A = lerp(edgePt(tc - hs), 0.12), B = lerp(edgePt(tc + hs), 0.12);
              const CQ = lerp(edgePt(tc), 0.01);            // bows ~1.6px toward the seam
              g.beginPath(); g.moveTo(A[0], A[1]);
              g.quadraticCurveTo(CQ[0], CQ[1], B[0], B[1]); g.stroke();
            }
          }
          wedges(0.45, P.foamBand);
          g.restore();
        }));
      }
      fam.shore.push(svar);
    }

    // GQ9 fix (CR1 per-profile floor): water-side-only depth falloff, drawn
    // UNDER the shore bands on WATER tiles only (buildTerrainLayer) — the
    // land-side beachMask draw never sees it, so beaches stay bright. The
    // near-shore water deepens smoothly past the underwater shelf and
    // saturates to a distinctly darker plateau by ~9px from the seam. This
    // guarantees a wide luma corridor between the near-shore water and EVERY
    // GQ2 land material: before this, packed dirt (~110 luma) met crest-lit
    // open water (~116) with a plateau delta of ~1 and the bevel corridor
    // vanished even though the ramp itself was present. Baked with ZERO RNG
    // (no stream advances), so every other bake stays byte-identical; one
    // sprite per mask, season-tinted via P.shoalDeep.
    fam.shoal = [];
    for (let m = 0; m < 16; m++) {
      // hand-rolled padded sprite (not mkSprite): the band must NOT be
      // clipped to the tile diamond — the diamond's acute corners amputate
      // any normal-offset band into a mid-edge blob (per-tile "fangs").
      // Unclipped butt-capped strips from collinear shore edges abut exactly
      // (a stroke is a thin parallelogram: coverage is by edge-projection),
      // so the band is seamless along a run; it is drawn in the terrain
      // layer's SECOND sweep, after every tile fill, so the spill past the
      // diamond can never be overpainted by a later neighbor's water tile.
      const c = document.createElement("canvas");
      c.width = 104; c.height = 76;
      const g = c.getContext("2d");
      const ox = 52, oy = 38;
      if (m) {
        const N = [ox, oy - HH], E = [ox + HW, oy], S = [ox, oy + HH], W = [ox - HW, oy];
        const edges = [[N, E], [E, S], [S, W], [W, N]]; // bit order N,E,S,W
        g.lineCap = "butt";
        g.strokeStyle = P.shoalDeep;
        // parallel full-length strokes at increasing TRUE-perpendicular depth
        // (screen-space normal — the diamond is squashed, so center-lerp
        // distances are not perpendicular distances). Alphas accumulate
        // multiplicatively into a smooth ramp that levels off deep, then
        // tapers back toward open water so the band has no hard outer rim.
        const STEPS = [
          [4.0, 2.4, 0.08], [5.4, 2.4, 0.11], [6.8, 2.5, 0.15],
          [8.2, 2.6, 0.18], [9.6, 3.0, 0.24], [11.0, 3.0, 0.32],
          [12.5, 3.2, 0.36], [14.0, 3.8, 0.38],
          [16.5, 3.0, 0.14], [18.4, 2.6, 0.07],
        ];
        for (let b = 0; b < 4; b++) {
          if (!(m & (1 << b))) continue;
          const [P0, P1] = edges[b];
          const ex = P1[0] - P0[0], ey = P1[1] - P0[1];
          let nx = -ey, ny = ex;
          const nl = Math.hypot(nx, ny); nx /= nl; ny /= nl;
          // orient the normal inward (toward the tile center = waterward)
          if (nx * (ox - (P0[0] + P1[0]) / 2) + ny * (oy - (P0[1] + P1[1]) / 2) < 0) { nx = -nx; ny = -ny; }
          for (const [dp, wpx, a] of STEPS) {
            g.globalAlpha = a; g.lineWidth = wpx;
            g.beginPath();
            g.moveTo(P0[0] + nx * dp, P0[1] + ny * dp);
            g.lineTo(P1[0] + nx * dp, P1[1] + ny * dp);
            g.stroke();
          }
        }
        g.globalAlpha = 1;
      }
      fam.shoal.push({ c, ox, oy });
    }

    // GQ9 fix: LAND-side-only wrack/berm seam — the dark damp line where the
    // beach meets the ground, drawn over the beachMask edges of LAND tiles
    // only (buildTerrainLayer), so the beach steps DOWN through the ground
    // tone on the land half of the bevel without ever falling mid-ramp on the
    // water side. Zero RNG; season-tinted via the strengthened P.berm.
    fam.dune = [];
    for (let m = 0; m < 16; m++) {
      fam.dune.push(mkSprite(1, 1, 4, (g, ox, oy) => {
        if (!m) return;
        const N = [ox, oy - HH], E = [ox + HW, oy], S = [ox, oy + HH], W = [ox - HW, oy];
        const edges = [[N, E], [E, S], [S, W], [W, N]]; // bit order N,E,S,W
        diamondPath(g, ox, oy);
        g.save(); g.clip();
        g.lineCap = "round";
        g.strokeStyle = P.berm;
        // soft halo landward of the core so the seam feathers, not outlines
        const STEPS = [[5.2, 1.6, 0.40], [6.5, 2.4, 0.90]];
        for (let b = 0; b < 4; b++) {
          if (!(m & (1 << b))) continue;
          const [P0, P1] = edges[b];
          const ex = P1[0] - P0[0], ey = P1[1] - P0[1];
          let nx = -ey, ny = ex;
          const nl = Math.hypot(nx, ny); nx /= nl; ny /= nl;
          if (nx * (ox - (P0[0] + P1[0]) / 2) + ny * (oy - (P0[1] + P1[1]) / 2) < 0) { nx = -nx; ny = -ny; }
          for (const [dp, wpx, a] of STEPS) {
            g.globalAlpha = a; g.lineWidth = wpx;
            g.beginPath();
            g.moveTo(P0[0] + nx * dp, P0[1] + ny * dp);
            g.lineTo(P1[0] + nx * dp, P1[1] + ny * dp);
            g.stroke();
          }
        }
        g.globalAlpha = 1;
        g.restore();
      }));
    }

    // forest: 3 density tiers x 3 canopy-mix variants (tier picked by neighbor
    // count in forestSprite; variant picked by terrHash so adjacent stands
    // differ). G13: each tree gets a grounding shadow, one of three silhouettes
    // (round / conifer / oak) cycled across the stand, and per-tree hue jitter
    // — so forests stop reading as diamonds full of identical lollipops. The
    // three shared R() calls per tree (position/size/tint) match pre-G13
    // exactly; silhouette/hue draw from forestRng, leaving the building bakes
    // downstream byte-identical.
    for (let d = 0; d < 3; d++) {
      const tier = [];
      for (let v = 0; v < 3; v++) {
        tier.push(mkSprite(1, 1, 26, (g, ox, oy) => {
          sealedDiamond(g, ox, oy, P.floor); // floor blends with grass (G13)
          const n = TREES_PER_TIER[d] + (v % 2);
          for (let k = 0; k < n; k++) {
            const sil = (k + v + d) % 3;         // round / conifer / oak
            const hue = forestRng() * 1.6 - 0.8; // per-tree canopy hue jitter
            drawTree(g, ox - 14 + ((k * 9 + v * 7 + d * 3) % 28) + R() * 4,
                     oy + 7 - ((k * 5 + v * 3) % 11),
                     TREE_SIZE_TIER[d] + R() * 4, 0.85 + R() * 0.4, P, sil, hue, true);
          }
        }));
      }
      fam.forest.push(tier);
    }

    // GQ4: street trees — 6 groomed parkway variants per season, smaller than
    // the 10-14px forest canopies so they read as tended verge planting.
    // Mostly round crowns with the occasional wide oak (the conifer stays a
    // forest signature). Parameters come from STREET_TREE_VAR (rolled once
    // from the dedicated streetRng before the season loop) so the SAME tree
    // re-bakes in each season's palette; drawTree itself calls no RNG, so
    // seasons (winter snowCap, autumn leafSets via P) come free and every
    // other bake stays byte-identical. The trunk base sits exactly at the
    // sprite anchor (no +2 shift) so the render-side worldX/worldY verge
    // point IS the trunk base — the tree stands where the placement says.
    fam.streetTree = [];
    for (let v = 0; v < 6; v++) {
      const q = STREET_TREE_VAR[v];
      // Tight bake (panel perf headroom): the largest street tree spans
      // ~14px wide by ~15px above its base, so baking on the full 64x56
      // mkSprite tile canvas made every per-frame drawImage blit ~9x more
      // pixels than the tree covers. A 20x22 canvas with the trunk base
      // anchored at (10, 17) holds every variant (canopy top 1.75*s <= 14.7
      // above base, oak halfwidth 0.78*s <= 6.6, shadow 0.23*s <= 2 below)
      // with AA margin. Same { c, ox, oy } shape mkSprite returns; SNOWSPEC
      // is not involved (drawTree paints its snow cap directly from P).
      const c = document.createElement("canvas");
      c.width = 20; c.height = 22;
      drawTree(c.getContext("2d"), 10, 17, q.s, q.tint, P, q.sil, q.hue, true);
      fam.streetTree.push({ c, ox: 10, oy: 17 });
    }

    SPR.season[sk] = fam;
  }
  // legacy aliases — summer is the baseline art (toolbar icons, previews)
  SPR.grass = SPR.season.summer.grass;
  SPR.water = SPR.season.summer.water;
  SPR.shore = SPR.season.summer.shore;
  SPR.forest = SPR.season.summer.forest;

  // ---- type-change terrain edges (G5; 16 masks, bit0=N bit1=E bit2=S
  // bit3=W) ---- the ONLY place terrain seams are stroked. Interior tiles
  // bake no edge at all; buildTerrainLayer draws one of these overlays per
  // land tile on the edges whose neighbor is a different land type
  // (grass vs forest). G13: softened from the old hard black 5px line to a
  // low-alpha dusky-green feather — the forest floor now blends with grass
  // (delta <= 8), so the boundary reads as a soft tree-line shadow rather
  // than a hard dark diamond edge, while stands stay legible via their trees.
  // Season-independent.
  SPR.terrEdge = [];
  for (let m = 0; m < 16; m++) {
    SPR.terrEdge.push(mkSprite(1, 1, 0, (g, ox, oy) => {
      if (!m) return; // no differing neighbor: nothing drawn
      const N = [ox, oy - HH], E = [ox + HW, oy], S = [ox, oy + HH], W = [ox - HW, oy];
      const edges = [[N, E], [E, S], [S, W], [W, N]]; // bit order N,E,S,W
      g.save(); diamondPath(g, ox, oy); g.clip();
      g.strokeStyle = "rgba(32,56,38,.28)"; g.lineWidth = 3; g.lineCap = "butt";
      for (let b = 0; b < 4; b++) {
        if (!(m & (1 << b))) continue;
        const [P0, P1] = edges[b];
        g.beginPath(); g.moveTo(P0[0], P0[1]); g.lineTo(P1[0], P1[1]); g.stroke();
      }
      g.restore();
    }));
  }

  // GQ2: relief tint overlays — two season-independent 1x1 diamonds (fill +
  // clip only, low alpha, no sealedDiamond) drawn per land tile at terrain-
  // layer rebuild time when reliefShade(seed, x, y) != 0, so broad NW-lit
  // swells sweep the plane. ~10 groundRng alpha-jitter flecks keep the
  // overlay itself from being one flat wash. [0] = light, [1] = dark.
  SPR.reliefTint = [];
  for (const [tone, aBase] of [["255,250,230", 0.055], ["12,20,16", 0.065]]) {
    SPR.reliefTint.push(mkSprite(1, 1, 0, (g, ox, oy) => {
      g.save(); diamondPath(g, ox, oy); g.clip();
      g.fillStyle = `rgba(${tone},${aBase})`;
      g.fillRect(ox - HW, oy - HH, TW, TH);
      for (let k = 0; k < 10; k++) {
        g.fillStyle = `rgba(${tone},${(aBase * (0.5 + groundRng())).toFixed(3)})`;
        g.fillRect(ox - HW + groundRng() * TW, oy - HH + groundRng() * TH, 2, 1);
      }
      g.restore();
    }));
  }

  // GQ2: material-fringe feather (16 masks, bit order N,E,S,W like terrEdge)
  // — a STIPPLED band, not a stroke: ~14 jittered 1-2px dots scattered in a
  // ~4px band inside each set edge, softening quilt-patch boundaries without
  // a hard line. Season-independent; drawn with rot4(mask, cam.r) exactly
  // like terrEdge, only on GRASS-terr tiles whose neighbor material differs.
  SPR.matFringe = [];
  for (let m = 0; m < 16; m++) {
    SPR.matFringe.push(mkSprite(1, 1, 0, (g, ox, oy) => {
      if (!m) return; // no differing-material neighbor: nothing drawn
      const N = [ox, oy - HH], E = [ox + HW, oy], S = [ox, oy + HH], W = [ox - HW, oy];
      const edges = [[N, E], [E, S], [S, W], [W, N]]; // bit order N,E,S,W
      g.save(); diamondPath(g, ox, oy); g.clip();
      g.fillStyle = "rgba(30,26,18,.22)";
      for (let b = 0; b < 4; b++) {
        if (!(m & (1 << b))) continue;
        const [P0, P1] = edges[b];
        for (let k = 0; k < 14; k++) {
          const t = 0.06 + groundRng() * 0.88, q = groundRng() * 0.28;
          const ex = P0[0] + (P1[0] - P0[0]) * t, ey = P0[1] + (P1[1] - P0[1]) * t;
          g.fillRect(ex + (ox - ex) * q, ey + (oy - ey) * q, groundRng() < 0.4 ? 2 : 1, 1);
        }
      }
      g.restore();
    }));
  }

  SPR.rubble = mkSprite(1, 1, 0, (g, ox, oy) => {
    diamondPath(g, ox, oy);
    g.fillStyle = "#6e6a60"; g.fill();
    g.strokeStyle = "rgba(0,0,0,.3)"; g.stroke();
    g.save(); diamondPath(g, ox, oy); g.clip();
    for (let k = 0; k < 16; k++) {
      g.fillStyle = ["#87826f", "#55524a", "#9a4f3d"][k % 3];
      g.fillRect(ox - HW + R() * TW, oy - HH + R() * TH, 3, 2);
    }
    g.restore();
  });

  // ---- roads & wires (16 connection masks; bit0=N bit1=E bit2=S bit3=W) ----
  const EDGE = { // [p0, p1] of shared edge in local 1x1 coords (ox=32, oy=16)
    0: [[32, 0], [64, 16]],   // to (x, y-1): NE edge
    1: [[64, 16], [32, 32]],  // to (x+1, y): SE edge
    2: [[32, 32], [0, 16]],   // to (x, y+1): SW edge
    3: [[0, 16], [32, 0]],    // to (x-1, y): NW edge
  };
  SPR.road = []; SPR.roadWinter = []; SPR.wire = [];
  // winter roads (M12): same geometry, plowed asphalt with snow banks piled
  // along both edges of every arm — baked here, selected by spriteFor
  // GQ7: road markings & asphalt. Asphalt darkened to #3e3f46 (lum≈63) so the
  // network reads as a dark grid against GQ2 pavement (~144) / civic aprons
  // (~150); winter keeps the same fill (identity carried by the snow banks).
  // Solid white lane-edge lines (#dadbe0) inset at edge fractions .185/.815
  // (inside the ±12.88px asphalt span and clear of GQ4 trunks at 15.7px)
  // painted over curb/banks in both seasons: edge-to-edge on straights
  // (continuous across seams), stopping 10.2px short of centre on corners/
  // dead-ends, and omitted on junctions where the crosswalk + stop-line bars
  // carry the paint instead. G12 centre-line dash geometry untouched (edge-
  // anchored 4-4 rhythm, seam-phase invariant; the straight-tile stroke is
  // passed twice so dash edge pixels stay crisp on the darker fill).
  // Junctions (popcount(m)>=3) get a stop line + continental crosswalk bars
  // per arm, all within d<=15.4 / |t|<=9.8 so no paint leaks past the
  // asphalt quad. ZERO RNG calls — this bake must never touch
  // R()/ART_RNG/groundRng/streetRng or downstream bakes shift.
  const roadSprite = (m, snow) => mkSprite(1, 1, 0, (g, ox, oy) => {
    const C = [ox, oy];
    const asphalt = "#3e3f46", curb = "#93949c", line = "#d8c24a";
    const lanePaint = "#dadbe0";
    const AW0 = 0.14, AW1 = 0.86;              // asphalt spans ~72% of each edge
    const L0 = 0.185, L1 = 0.815;              // lane-edge paint inset fractions
    const armLen = Math.hypot(HW / 2, HH / 2); // centre → edge-midpoint distance
    const dash = armLen / 4;                   // 4-4 rhythm; a straight tile = 8 dashes
    const clearR = 9;                          // junction dashes stop this far from centre
    const straight = m === 5 || m === 10;      // 2 opposite arms => a through road
    const arms = (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);
    const junction = arms >= 3;                // 3-way/4-way => crosswalks + stop lines
    // arms + curbs (m===0 draws all four as an isolated patch)
    for (let b = 0; b < 4; b++) {
      if (!(m & (1 << b)) && m !== 0) continue;
      const [P0, P1] = EDGE[b];
      const mid = [(P0[0] + P1[0]) / 2, (P0[1] + P1[1]) / 2];
      const e1 = [P0[0] + (P1[0] - P0[0]) * AW0, P0[1] + (P1[1] - P0[1]) * AW0];
      const e2 = [P0[0] + (P1[0] - P0[0]) * AW1, P0[1] + (P1[1] - P0[1]) * AW1];
      const c1 = [C[0] + e1[0] - mid[0], C[1] + e1[1] - mid[1]];
      const c2 = [C[0] + e2[0] - mid[0], C[1] + e2[1] - mid[1]];
      poly(g, [e1, e2, c2, c1], asphalt);
      // solid lane-edge paint (GQ7). Straights run edge-to-edge (continuous
      // paint across tile seams); corners/dead-ends/isolated stubs stop
      // 10.2px short of centre so the turn reads as clean asphalt; junctions
      // get none at all — their crosswalk + stop-line bars carry the paint
      // (and the tile would otherwise wash out brighter than the pavement it
      // must contrast). In winter the paint goes down BEFORE the banks so
      // the plow line keeps its full snow pile; the inner sliver of paint
      // still shows between the banks.
      const paintLanes = () => {
        if (junction) return;
        g.strokeStyle = lanePaint; g.lineWidth = 1.7; g.lineCap = "butt";
        const lt = straight ? 1 : 1 - 10.2 / armLen;
        for (const f of [L0, L1]) {
          const eL = [P0[0] + (P1[0] - P0[0]) * f, P0[1] + (P1[1] - P0[1]) * f];
          const cL = [C[0] + eL[0] - mid[0], C[1] + eL[1] - mid[1]];
          g.beginPath(); g.moveTo(eL[0], eL[1]);
          g.lineTo(eL[0] + (cL[0] - eL[0]) * lt, eL[1] + (cL[1] - eL[1]) * lt);
          g.stroke();
        }
      };
      if (snow) { // plowed snow banks piled along both arm edges (M12)
        paintLanes();
        g.strokeStyle = "#e8edf3"; g.lineWidth = 2.6; g.lineCap = "round";
        g.beginPath(); g.moveTo(e1[0], e1[1]); g.lineTo(c1[0], c1[1]); g.stroke();
        g.beginPath(); g.moveTo(e2[0], e2[1]); g.lineTo(c2[0], c2[1]); g.stroke();
        g.lineCap = "butt";
      } else { // 1px curb line, lighter than asphalt, on each verge
        g.strokeStyle = curb; g.lineWidth = 1.2;
        g.beginPath(); g.moveTo(e1[0], e1[1]); g.lineTo(c1[0], c1[1]); g.stroke();
        g.beginPath(); g.moveTo(e2[0], e2[1]); g.lineTo(c2[0], c2[1]); g.stroke();
        paintLanes();
      }
    }
    // center pad keeps junction boxes solid asphalt
    poly(g, [[C[0] - 7, C[1] - 3.5], [C[0] + 7, C[1] - 3.5],
             [C[0] + 7, C[1] + 3.5], [C[0] - 7, C[1] + 3.5]], asphalt);
    // ---- center-line dashes (drawn last, over the asphalt) ----
    g.strokeStyle = line; g.lineWidth = 1.4; g.lineCap = "butt";
    g.setLineDash([dash, dash]); g.lineDashOffset = 0;
    if (straight) {
      // single edge-to-edge stroke: length 8*dash lands phase 0 at both edge-
      // midpoints, so the rhythm continues across seams with no mirror at center
      const bs = m === 5 ? [0, 2] : [1, 3];
      const mA = EDGE[bs[0]], mB = EDGE[bs[1]];
      const midA = [(mA[0][0] + mA[1][0]) / 2, (mA[0][1] + mA[1][1]) / 2];
      const midB = [(mB[0][0] + mB[1][0]) / 2, (mB[0][1] + mB[1][1]) / 2];
      g.beginPath();
      g.moveTo(midA[0], midA[1]); g.lineTo(C[0], C[1]); g.lineTo(midB[0], midB[1]);
      g.stroke(); g.stroke(); // double pass firms edge pixels over dark asphalt
    } else { // junctions / corners / dead-ends: dash from each edge inward but
      // stop clearR short of center; phase 0 at the edge aligns with neighbours
      for (let b = 0; b < 4; b++) {
        if (!(m & (1 << b))) continue;
        const [P0, P1] = EDGE[b];
        const mid = [(P0[0] + P1[0]) / 2, (P0[1] + P1[1]) / 2];
        const ux = (C[0] - mid[0]) / armLen, uy = (C[1] - mid[1]) / armLen;
        g.beginPath();
        g.moveTo(mid[0], mid[1]);
        g.lineTo(mid[0] + ux * (armLen - clearR), mid[1] + uy * (armLen - clearR));
        g.stroke();
      }
    }
    g.setLineDash([]); g.lineDashOffset = 0;
    // ---- junction stop lines + continental crosswalk bars (GQ7) ----
    // only 3-way/4-way junctions (popcount>=3); straights, corners, dead-ends
    // and isolated patches stay clean. All geometry sits at d<=15.4 from the
    // centre and |transverse|<=9.8, safely inside the asphalt quad.
    if (junction) {
      for (let b = 0; b < 4; b++) {
        if (!(m & (1 << b))) continue;
        const [P0, P1] = EDGE[b];
        const mid = [(P0[0] + P1[0]) / 2, (P0[1] + P1[1]) / 2];
        const ux = (C[0] - mid[0]) / armLen, uy = (C[1] - mid[1]) / armLen;
        const eLen = Math.hypot(P1[0] - P0[0], P1[1] - P0[1]);
        const tx = (P1[0] - P0[0]) / eLen, ty = (P1[1] - P0[1]) / eLen;
        const pt = (d) => [C[0] - ux * d, C[1] - uy * d]; // centre → edge
        // stop line: solid bar just outside the clearR dash stop
        const s = pt(10.2);
        g.strokeStyle = "#e6e7ec"; g.lineWidth = 1.8;
        g.beginPath();
        g.moveTo(s[0] - tx * 8.8, s[1] - ty * 8.8);
        g.lineTo(s[0] + tx * 8.8, s[1] + ty * 8.8);
        g.stroke();
        // crosswalk: four continental bars laid along the arm axis
        g.strokeStyle = "rgba(233,234,240,.95)"; g.lineWidth = 2.4;
        const w0 = pt(11.9), w1 = pt(15.4);
        for (const o of [-8, -3, 2, 7]) {
          g.beginPath();
          g.moveTo(w0[0] + tx * o, w0[1] + ty * o);
          g.lineTo(w1[0] + tx * o, w1[1] + ty * o);
          g.stroke();
        }
      }
    }
    g.setLineDash([]); g.lineDashOffset = 0;
  });
  for (let m = 0; m < 16; m++) {
    SPR.road.push(roadSprite(m, false));
    SPR.roadWinter.push(roadSprite(m, true));

    SPR.wire.push(mkSprite(1, 1, 20, (g, ox, oy) => {
      const poleTop = oy - 16;
      // pole
      g.strokeStyle = "#6b4a26"; g.lineWidth = 2;
      g.beginPath(); g.moveTo(ox, oy + 2); g.lineTo(ox, poleTop); g.stroke();
      g.beginPath(); g.moveTo(ox - 6, poleTop + 3); g.lineTo(ox + 6, poleTop + 3); g.stroke();
      // wires to connected edges
      g.strokeStyle = "#2b2b30"; g.lineWidth = 1;
      for (let b = 0; b < 4; b++) {
        if (!(m & (1 << b))) continue;
        const [P0, P1] = EDGE[b];
        const mid = [(P0[0] + P1[0]) / 2, (P0[1] + P1[1]) / 2];
        g.beginPath(); g.moveTo(ox, poleTop + 2);
        g.quadraticCurveTo((ox + mid[0]) / 2, poleTop + 6, mid[0], mid[1] - 16);
        g.stroke();
      }
    }));
  }

  // ---- water pipes (M24) — 16 connection masks, drawn FLAT at ground level ----
  // Blue-grey mains laid in the street, the strict visual analog of a wire but
  // flat (extraTop 0, like a road) rather than overhead. Autotiled by pipeMask.
  const pipeSprite = (m) => mkSprite(1, 1, 0, (g, ox, oy) => {
    const C = [ox, oy];
    // dark pipe arms toward each connected edge midpoint (m===0 = isolated hub)
    g.strokeStyle = "#31627f"; g.lineWidth = 3.6; g.lineCap = "round";
    for (let b = 0; b < 4; b++) {
      if (!(m & (1 << b))) continue;
      const [P0, P1] = EDGE[b];
      const mid = [(P0[0] + P1[0]) / 2, (P0[1] + P1[1]) / 2];
      g.beginPath(); g.moveTo(C[0], C[1]); g.lineTo(mid[0], mid[1]); g.stroke();
    }
    // lighter highlight ridge on top of each arm
    g.strokeStyle = "#6fb4da"; g.lineWidth = 1.2;
    for (let b = 0; b < 4; b++) {
      if (!(m & (1 << b))) continue;
      const [P0, P1] = EDGE[b];
      const mid = [(P0[0] + P1[0]) / 2, (P0[1] + P1[1]) / 2];
      g.beginPath(); g.moveTo(C[0], C[1]); g.lineTo(mid[0], mid[1]); g.stroke();
    }
    // access-hatch hub at the junction
    g.fillStyle = "#274f68";
    g.beginPath(); g.arc(C[0], C[1], m === 0 ? 4.5 : 3.2, 0, 7); g.fill();
    g.fillStyle = "#6fb4da";
    g.beginPath(); g.arc(C[0] - 0.8, C[1] - 0.8, 1.4, 0, 7); g.fill();
  });
  SPR.pipe = [];
  for (let m = 0; m < 16; m++) SPR.pipe.push(pipeSprite(m));

  // ---- water tower (M24) — a 1x1 silver/blue tank on braced legs ----
  SPR.watertower = mkSprite(1, 1, 30, (g, ox, oy) => {
    const cx = ox, baseY = oy + 5, topY = baseY - 26; // tank-bottom elevation
    g.fillStyle = "rgba(0,0,0,.18)";                  // ground shadow
    g.beginPath(); g.ellipse(cx, baseY, 14, 6, 0, 0, 7); g.fill();
    g.strokeStyle = "#6b7379"; g.lineWidth = 1;       // cross-braces (behind legs)
    g.beginPath(); g.moveTo(cx - 9, baseY - 4); g.lineTo(cx + 9, baseY - 12); g.stroke();
    g.beginPath(); g.moveTo(cx + 9, baseY - 4); g.lineTo(cx - 9, baseY - 12); g.stroke();
    g.strokeStyle = "#949ca3"; g.lineWidth = 2;       // four splayed legs
    for (const dx of [-9, -4, 4, 9]) {
      g.beginPath(); g.moveTo(cx + dx * 0.42, topY + 9); g.lineTo(cx + dx, baseY); g.stroke();
    }
    // cylindrical tank: bottom cap, body, blue band, domed top cap, highlight
    g.fillStyle = "#97a6b0"; g.beginPath(); g.ellipse(cx, topY + 11, 12, 5, 0, 0, 7); g.fill();
    g.fillStyle = "#aab6bf"; g.fillRect(cx - 12, topY, 24, 11);
    g.fillStyle = "#31627f"; g.fillRect(cx - 12, topY + 3, 24, 3.4); // blue band
    g.fillStyle = "#c9d4dc"; g.beginPath(); g.ellipse(cx, topY, 12, 5.2, 0, 0, 7); g.fill();
    g.fillStyle = "#e6edf2"; g.beginPath(); g.ellipse(cx - 3.5, topY - 1, 4.5, 2, 0, 0, 7); g.fill();
  });

  // ---- water pump (M24) — a 2x2 coastal pumping station ----
  SPR.pump = mkSprite(2, 2, 32, (g, ox, oy) => {
    const cn = corners(ox, oy, 2, 2);
    poly(g, [cn.N, cn.E, cn.S, cn.W], "#6d747a", "rgba(0,0,0,.28)"); // concrete pad
    const hc = insetCorners(ox, oy, 2, 2, 0.62);                     // pump housing
    prismFrom(g, hc, 15, "#59707e");
    const tN = up(hc.N, 15), tS = up(hc.S, 15);
    const rx = (tN[0] + tS[0]) / 2, ry = (tN[1] + tS[1]) / 2;
    // blue pump cylinder squatting on the roof
    g.fillStyle = "#2a5570"; g.beginPath(); g.ellipse(rx, ry + 3, 11, 5, 0, 0, 7); g.fill();
    g.fillStyle = "#31627f"; g.fillRect(rx - 11, ry - 5, 22, 8);
    g.fillStyle = "#4a86ac"; g.beginPath(); g.ellipse(rx, ry - 5, 11, 5, 0, 0, 7); g.fill();
    g.fillStyle = "#7fc2e4"; g.beginPath(); g.ellipse(rx - 3.5, ry - 6, 3.2, 1.5, 0, 0, 7); g.fill();
    // fat intake main running off the SW (water-facing) corner
    g.strokeStyle = "#274f68"; g.lineWidth = 4.5; g.lineCap = "round";
    g.beginPath(); g.moveTo(rx, ry + 2); g.lineTo(hc.W[0] - 7, hc.W[1] + 7); g.stroke();
    g.strokeStyle = "#6fb4da"; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(rx, ry + 2); g.lineTo(hc.W[0] - 7, hc.W[1] + 7); g.stroke();
  });

  // ---- rail / transit (M25) — a SEPARATE plane, drawn on top of over[] ----
  // Surface track: 16 connection masks (bit0=N bit1=E bit2=S bit3=W), built like
  // SPR.road/SPR.wire over the same EDGE arms but drawing two parallel steel rails
  // + sleeper-tie hatching, baked slightly raised (extraTop 8) so a grade crossing
  // reads clearly over the street beneath it. Autotiled by railMask (render.js).
  const railSprite = (m) => mkSprite(1, 1, 8, (g, ox, oy) => {
    const C = [ox, oy];
    const railCol = "#9aa2ac", railHi = "#c8d0d8", tie = "#5a4632";
    const armLen = Math.hypot(HW / 2, HH / 2);
    const gauge = 3.2; // half the rail spacing, perpendicular to each arm
    for (let b = 0; b < 4; b++) {
      if (!(m & (1 << b)) && m !== 0) continue;
      const [P0, P1] = EDGE[b];
      const mid = [(P0[0] + P1[0]) / 2, (P0[1] + P1[1]) / 2];
      const dx = C[0] - mid[0], dy = C[1] - mid[1];
      const L = Math.hypot(dx, dy) || 1;
      const ux = dx / L, uy = dy / L;      // unit vector mid -> center
      const px = -uy, py = ux;             // perpendicular (for the two rails)
      // sleeper ties: short cross-hatches strung along the arm
      g.strokeStyle = tie; g.lineWidth = 2.2; g.lineCap = "butt";
      for (let s = 0.16; s <= 0.92; s += 0.24) {
        const cx = mid[0] + dx * s, cy = mid[1] + dy * s;
        g.beginPath();
        g.moveTo(cx + px * (gauge + 1.6), cy + py * (gauge + 1.6));
        g.lineTo(cx - px * (gauge + 1.6), cy - py * (gauge + 1.6));
        g.stroke();
      }
      // two steel rails
      g.lineCap = "round";
      for (const off of [gauge, -gauge]) {
        g.strokeStyle = railCol; g.lineWidth = 1.6;
        g.beginPath();
        g.moveTo(mid[0] + px * off, mid[1] + py * off);
        g.lineTo(C[0] + px * off, C[1] + py * off);
        g.stroke();
        g.strokeStyle = railHi; g.lineWidth = 0.7;
        g.beginPath();
        g.moveTo(mid[0] + px * off, mid[1] + py * off);
        g.lineTo(C[0] + px * off, C[1] + py * off);
        g.stroke();
      }
    }
    g.lineCap = "butt";
  });
  SPR.rail = [];
  for (let m = 0; m < 16; m++) SPR.rail.push(railSprite(m));

  // Subway toolbar icon (a tunnel mouth) — the buried plane is invisible on the
  // map, so this only ever appears on the toolbtn (SPR.subwayIcon).
  SPR.subwayIcon = mkSprite(1, 1, 8, (g, ox, oy) => {
    g.fillStyle = "#3a3f48";
    g.beginPath();
    g.moveTo(ox - 12, oy + 6);
    g.arc(ox, oy + 6, 12, Math.PI, 0);
    g.closePath(); g.fill();
    g.fillStyle = "#15181d";
    g.beginPath();
    g.moveTo(ox - 7, oy + 6);
    g.arc(ox, oy + 6, 7, Math.PI, 0);
    g.closePath(); g.fill();
    g.fillStyle = "#e8c23a"; g.font = "bold 9px Tahoma, sans-serif";
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText("M", ox, oy + 1);
  });

  // Subway vent grate — a small sidewalk grille drawn ONLY in the transit overlay
  // so the invisible tunnels have a visible trace (SPR.subwayVent).
  SPR.subwayVent = mkSprite(1, 1, 0, (g, ox, oy) => {
    g.fillStyle = "#4b5560";
    g.beginPath();
    g.moveTo(ox, oy - 4); g.lineTo(ox + 8, oy); g.lineTo(ox, oy + 4); g.lineTo(ox - 8, oy);
    g.closePath(); g.fill();
    g.strokeStyle = "#20262c"; g.lineWidth = 0.8;
    for (let k = -2; k <= 2; k++) {
      g.beginPath();
      g.moveTo(ox + k * 2.6, oy - 2.6); g.lineTo(ox + k * 2.6 + 3, oy + 1);
      g.stroke();
    }
  });

  // Station — a 1x1 brick depot with a platform canopy and a "T" placard. Baked
  // through withNight so a live (powered) station shows lit windows after dark.
  SPR.station = withNight(1, 1, 26, (g, ox, oy) => {
    const cn = corners(ox, oy, 1, 1);
    poly(g, [cn.N, cn.E, cn.S, cn.W], "#7a7f88", "rgba(0,0,0,.25)"); // paved apron
    const hc = insetCorners(ox, oy, 1, 1, 0.62);
    prismFrom(g, hc, 16, "#9a4a3a"); // brick depot body
    // platform canopy: a pale flat roof cantilevered over the apron
    const tN = up(hc.N, 16), tE = up(hc.E, 16), tS = up(hc.S, 16), tW = up(hc.W, 16);
    poly(g, [tN, tE, tS, tW], "#c9ced6", "#8a9098");
    // lit windows on the two visible faces (glow bakes for the night layer)
    windows(g, hc.W, hc.S, 16, 1, 2, 0.7, "#ffe9a0", "#20242c", GLOW_COOL);
    windows(g, hc.S, hc.E, 16, 1, 2, 0.7, "#ffe9a0", "#20242c", GLOW_COOL);
    // "T" placard on the canopy
    const cx = (tN[0] + tS[0]) / 2, cy = (tN[1] + tS[1]) / 2;
    g.fillStyle = "#1c5faa"; g.beginPath(); g.arc(cx, cy - 3, 5.5, 0, 7); g.fill();
    g.fillStyle = "#fff"; g.font = "bold 8px Tahoma, sans-serif";
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText("T", cx, cy - 3);
  });

  // ---- GP4a: expressway & ramp (16 connection masks, road bit order) ----
  // ZERO RNG calls (the roadSprite contract): these bakes are appended AFTER
  // every existing bake and never touch R()/ART_RNG/groundRng, so no
  // downstream sprite's draw stream shifts (the C6 sprite-manifest identity).
  // The deck rides 6px above the ground diamond entirely inside this 1x1
  // painter slot (the rail extraTop idiom: extraTop 12, deck drawn at EDGE
  // coords +6, ground at +12). Distinctness vs SPR.road at a glance: raised
  // elevation with piers + fascia, PALE concrete slab framing DARK
  // carriageways (the road's value scheme inverted), a continuous jersey
  // median instead of dashes, and no crosswalks/curbs anywhere.
  const XW_LIFT = 6;   // deck height above the ground diamond, px
  const xwaySprite = (m, snow) => mkSprite(1, 1, 12, (g, ox, oy) => {
    const C = [ox, oy - XW_LIFT];                     // deck-level tile centre
    const deckC = "#6f727c", laneC = "#34353c", medianC = "#c9cad0",
          railC = "#9ea2ac", edgeC = "#d8c24a", pierC = "#565962", skirtC = "#4c4f58";
    const D0 = 0.10, D1 = 0.90;                       // deck spans ~80% of each edge
    const arms = [];
    for (let b = 0; b < 4; b++) if ((m & (1 << b)) || m === 0) arms.push(b);
    const geom = (b) => {
      const [P0, P1] = EDGE[b];
      const mid = [(P0[0] + P1[0]) / 2, (P0[1] + P1[1]) / 2 + XW_LIFT];
      const pt = (f) => [P0[0] + (P1[0] - P0[0]) * f, P0[1] + (P1[1] - P0[1]) * f + XW_LIFT];
      const cOf = (p) => [C[0] + p[0] - mid[0], C[1] + p[1] - mid[1]];
      return { pt, cOf };
    };
    // pass A0: ground shadow — each arm's deck quad projected straight down
    // XW_LIFT onto the ground plane, so grass visibly runs UNDER the slab.
    // This (plus the mid-arm piers below) is what makes "elevated" read:
    // edge-pinned piers were 100% occluded by the neighbouring tile drawn
    // later in painter order (panel defect), so the shadow + piers now live
    // in the tile INTERIOR where no neighbour's slab can cover them.
    for (const b of arms) {
      const { pt, cOf } = geom(b);
      const sh = (p) => [p[0], p[1] + XW_LIFT];
      const e1 = pt(0.16), e2 = pt(0.84);
      poly(g, [sh(e1), sh(e2), sh(cOf(e2)), sh(cOf(e1))], "rgba(14,20,14,0.30)");
    }
    // pass A: fascia skirts and the concrete slab of every open arm
    for (const b of arms) {
      const { pt, cOf } = geom(b);
      const e1 = pt(D0), e2 = pt(D1), c1 = cOf(e1), c2 = cOf(e2);
      poly(g, [e1, c1, [c1[0], c1[1] + 2.5], [e1[0], e1[1] + 2.5]], skirtC); // slab fascia
      poly(g, [e2, c2, [c2[0], c2[1] + 2.5], [e2[0], e2[1] + 2.5]], skirtC);
      poly(g, [e1, e2, c2, c1], deckC);
    }
    // junction pad keeps the interchange box solid concrete — CLIPPED to the
    // union of the arm slabs so its axis-aligned corners can never poke past
    // the deck as floating grey triangles at elbows/dead ends (panel defect)
    g.save(); g.beginPath();
    for (const b of arms) {
      const { pt, cOf } = geom(b);
      const e1 = pt(D0), e2 = pt(D1), c1 = cOf(e1), c2 = cOf(e2);
      g.moveTo(e1[0], e1[1]); g.lineTo(e2[0], e2[1]);
      g.lineTo(c2[0], c2[1]); g.lineTo(c1[0], c1[1]); g.closePath();
    }
    g.clip();
    poly(g, [[C[0] - 7, C[1] - 3.5], [C[0] + 7, C[1] - 3.5],
             [C[0] + 7, C[1] + 3.5], [C[0] - 7, C[1] + 3.5]], deckC);
    g.restore();
    // pass A2: support piers on each arm's screen-FRONT deck side (whichever
    // side sits lower on screen), at mid-arm params clear of the shared edge:
    // drawn after the slab, hanging from the fascia to the ground shadow, so
    // painter order can never hide them behind the next tile's deck.
    g.strokeStyle = pierC; g.lineWidth = 2.6; g.lineCap = "butt";
    for (const b of arms) {
      const { pt, cOf } = geom(b);
      const sideY = (f) => { const e = pt(f), cc = cOf(e); return (e[1] + cc[1]) / 2; };
      const f = sideY(0.14) > sideY(0.86) ? 0.14 : 0.86;   // front side
      const e = pt(f), cc = cOf(e);
      for (const u of [0.30, 0.62]) {                      // two piers per arm
        const px = e[0] + (cc[0] - e[0]) * u, py = e[1] + (cc[1] - e[1]) * u;
        g.beginPath(); g.moveTo(px, py + 2); g.lineTo(px, py + XW_LIFT + 1); g.stroke();
      }
    }
    // pass B: carriageways, median, edge lines and guard rails per arm.
    // Carriageways narrowed 0.22-0.46/0.54-0.78 -> 0.25-0.45/0.55-0.75 so the
    // PALE slab genuinely frames the dark lanes (the stated value inversion
    // vs SPR.road, which previously read as a dark ribbon with thin edges).
    for (const b of arms) {
      const { pt, cOf } = geom(b);
      const q = (f0, f1, col) => { const a = pt(f0), z = pt(f1); poly(g, [a, z, cOf(z), cOf(a)], col); };
      q(0.25, 0.45, laneC); q(0.55, 0.75, laneC);     // two dark carriageways
      q(0.47, 0.53, medianC);                          // continuous jersey median
      g.strokeStyle = edgeC; g.lineWidth = 1.2; g.lineCap = "butt";
      for (const f of [0.20, 0.80]) {                  // solid yellow edge lines
        const p = pt(f), cc = cOf(p);
        g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(cc[0], cc[1]); g.stroke();
      }
      const e1 = pt(D0), e2 = pt(D1), c1 = cOf(e1), c2 = cOf(e2);
      if (snow) {                                      // winter: snow piles on the
        g.strokeStyle = "#e8edf3"; g.lineWidth = 2.4;  // rails, deck stays plowed
        g.lineCap = "round";
      } else {
        g.strokeStyle = railC; g.lineWidth = 1.2;      // guard rails
      }
      g.beginPath(); g.moveTo(e1[0], e1[1]); g.lineTo(c1[0], c1[1]); g.stroke();
      g.beginPath(); g.moveTo(e2[0], e2[1]); g.lineTo(c2[0], c2[1]); g.stroke();
      g.lineCap = "butt";
    }
  });
  // The RAMP keys on BOTH neighbor classes (panel fix — was xway-mask only,
  // which sprouted dead-end asphalt stubs into open grass): index =
  // wedgeMask | apronMask<<4. A rising wedge (ground edge -> 6px-raised edge,
  // side skirts, 3 white chevrons) toward each true-XWAY arm; a ground-level
  // asphalt apron (roadSprite arm geometry) ONLY toward arms that actually
  // hold street-class tiles (ROAD/WIREROAD/RAMP). An isolated ramp draws the
  // centre pad + a stub wedge toward the first apron-free arm. `snow` bakes
  // the winter variant (snow banks on apron verges + wedge skirts) so the
  // ramp finally participates in G12/G14 like every other road-class overlay.
  const rampSprite = (wm, am, snow) => mkSprite(1, 1, 12, (g, ox, oy) => {
    const C = [ox, oy];                                // ground-level tile centre
    const asphalt = "#3e3f46", curb = "#93949c", deckC = "#6f727c",
          skirtC = "#4c4f58", chevC = "#e6e7ec", snowC = "#e8edf3";
    const A0 = 0.14, A1 = 0.86;
    let wedge = wm;
    if (!wedge) {                                      // no xway yet: stub wedge
      for (let b = 0; b < 4 && !wedge; b++) if (!(am & (1 << b))) wedge = 1 << b;
      if (!wedge) wedge = 1;
    }
    const apG = (b) => {                               // ground-level arm geometry
      const [P0, P1] = EDGE[b];
      const mid = [(P0[0] + P1[0]) / 2, (P0[1] + P1[1]) / 2 + XW_LIFT + 6];
      const pt = (f) => [P0[0] + (P1[0] - P0[0]) * f, P0[1] + (P1[1] - P0[1]) * f + XW_LIFT + 6];
      const cOf = (p) => [C[0] + p[0] - mid[0], C[1] + p[1] - mid[1]];
      return { pt, cOf };
    };
    const apronArms = [];
    for (let b = 0; b < 4; b++)
      if (!(wedge & (1 << b)) && (am & (1 << b))) apronArms.push(b);
    for (const b of apronArms) {                       // ground apron arms
      const { pt, cOf } = apG(b);
      const e1 = pt(A0), e2 = pt(A1), c1 = cOf(e1), c2 = cOf(e2);
      poly(g, [e1, e2, c2, c1], asphalt);
      if (snow) {                                      // winter: plowed banks on
        g.strokeStyle = snowC; g.lineWidth = 2.6;      // both verges (M12 roads)
        g.lineCap = "round";
      } else {
        g.strokeStyle = curb; g.lineWidth = 1.2; g.lineCap = "butt";
      }
      g.beginPath(); g.moveTo(e1[0], e1[1]); g.lineTo(c1[0], c1[1]); g.stroke();
      g.beginPath(); g.moveTo(e2[0], e2[1]); g.lineTo(c2[0], c2[1]); g.stroke();
      g.lineCap = "butt";
    }
    // centre pad, CLIPPED to the union of apron quads + wedge plates + a small
    // iso diamond, so its axis-aligned corners never escape the silhouette
    g.save(); g.beginPath();
    for (const b of apronArms) {
      const { pt, cOf } = apG(b);
      const e1 = pt(A0), e2 = pt(A1), c1 = cOf(e1), c2 = cOf(e2);
      g.moveTo(e1[0], e1[1]); g.lineTo(e2[0], e2[1]);
      g.lineTo(c2[0], c2[1]); g.lineTo(c1[0], c1[1]); g.closePath();
    }
    for (let b = 0; b < 4; b++) {
      if (!(wedge & (1 << b))) continue;
      const { pt, cOf } = apG(b);
      const e1 = pt(0.10), e2 = pt(0.90), c1 = cOf(e1), c2 = cOf(e2);
      g.moveTo(e1[0], e1[1]); g.lineTo(e2[0], e2[1]);
      g.lineTo(c2[0], c2[1]); g.lineTo(c1[0], c1[1]); g.closePath();
    }
    g.moveTo(C[0] - 7, C[1]); g.lineTo(C[0], C[1] - 3.5);
    g.lineTo(C[0] + 7, C[1]); g.lineTo(C[0], C[1] + 3.5); g.closePath();
    g.clip();
    poly(g, [[C[0] - 7, C[1] - 3.5], [C[0] + 7, C[1] - 3.5],
             [C[0] + 7, C[1] + 3.5], [C[0] - 7, C[1] + 3.5]], asphalt);
    g.restore();
    for (let b = 0; b < 4; b++) {                      // rising wedge arms
      if (!(wedge & (1 << b))) continue;
      const [P0, P1] = EDGE[b];
      const mid = [(P0[0] + P1[0]) / 2, (P0[1] + P1[1]) / 2 + XW_LIFT + 6];
      const eR = (f) => [P0[0] + (P1[0] - P0[0]) * f,       // raised edge (meets
                         P0[1] + (P1[1] - P0[1]) * f + 6];  // the xway deck)
      const cG = (f) => { const e = [P0[0] + (P1[0] - P0[0]) * f, P0[1] + (P1[1] - P0[1]) * f + XW_LIFT + 6];
                          return [C[0] + e[0] - mid[0], C[1] + e[1] - mid[1]]; };
      const e1 = eR(0.10), e2 = eR(0.90), c1 = cG(0.10), c2 = cG(0.90);
      poly(g, [e1, [e1[0], e1[1] + XW_LIFT], c1], skirtC); // side skirts to ground
      poly(g, [e2, [e2[0], e2[1] + XW_LIFT], c2], skirtC);
      poly(g, [e1, e2, c2, c1], deckC);                    // the sloping deck
      if (snow) {                                          // winter: snow piled
        g.strokeStyle = snowC; g.lineWidth = 2.0;          // along both wedge
        g.lineCap = "round";                               // side rails
        g.beginPath(); g.moveTo(e1[0], e1[1]); g.lineTo(c1[0], c1[1]); g.stroke();
        g.beginPath(); g.moveTo(e2[0], e2[1]); g.lineTo(c2[0], c2[1]); g.stroke();
        g.lineCap = "butt";
      }
      g.strokeStyle = chevC; g.lineWidth = 1.4; g.lineCap = "butt";
      for (const u of [0.30, 0.55, 0.80]) {                // 3 chevrons up the slope
        const p1 = [e1[0] + (c1[0] - e1[0]) * u, e1[1] + (c1[1] - e1[1]) * u];
        const p2 = [e2[0] + (c2[0] - e2[0]) * u, e2[1] + (c2[1] - e2[1]) * u];
        const pm = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
        g.beginPath();
        g.moveTo(p1[0] * 0.78 + pm[0] * 0.22, p1[1] * 0.78 + pm[1] * 0.22 + 1);
        g.lineTo(pm[0], pm[1] - 1.2);
        g.lineTo(p2[0] * 0.78 + pm[0] * 0.22, p2[1] * 0.78 + pm[1] * 0.22 + 1);
        g.stroke();
      }
    }
  });
  SPR.xway = []; SPR.xwayWinter = [];
  for (let m = 0; m < 16; m++) {
    SPR.xway.push(xwaySprite(m, false));
    SPR.xwayWinter.push(xwaySprite(m, true));
  }
  // ramp: 256 (wedgeMask | apronMask<<4) combos x 2 seasons — tiny flat
  // bakes, still ZERO RNG and still appended after every existing bake, so
  // the C6 sprite-manifest identity holds unchanged.
  SPR.ramp = []; SPR.rampWinter = [];
  for (let k = 0; k < 256; k++) {
    SPR.ramp.push(rampSprite(k & 15, k >> 4, false));
    SPR.rampWinter.push(rampSprite(k & 15, k >> 4, true));
  }

  // ---- undeveloped zone markers ----
  // GQ1 fix: the C marker was #3555ff (HSL S=1.00) — the only pixels in an
  // ordinary daytime frame bluer than the lake, falsifying Gate 1's "water is
  // the most saturated blue" superlative whenever an unzoned commercial tile
  // was on screen. #4860e0 keeps the exact hue (230deg) and near-identical
  // lightness so R/C/I overlays stay colorblind-distinct, but caps S at ~0.71,
  // safely under the summer water's 0.776 max.
  const zoneDef = [["zoneR", "#22c522", "R"], ["zoneC", "#4860e0", "C"], ["zoneI", "#e6c619", "I"]];
  for (const [key, col, letter] of zoneDef) {
    SPR[key] = mkSprite(1, 1, 0, (g, ox, oy) => {
      diamondPath(g, ox, oy);
      g.fillStyle = "rgba(30,40,30,.25)"; g.fill();
      g.save();
      g.translate(ox, oy); g.scale(1, 0.5); g.rotate(Math.PI / 4);
      g.strokeStyle = col; g.lineWidth = 2.4;
      g.strokeRect(-30, -30, 60, 60);
      g.restore();
      g.fillStyle = col; g.font = "bold 11px Tahoma, sans-serif";
      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(letter, ox, oy + 1);
    });
  }

  // ---- developed buildings, baked once PER VIEW ORIENTATION (M32b) ----
  // buildSprites bakes only facing 0 at boot (below); spriteFor() lazily bakes
  // facings 1..3 on first visit to that camera rotation and caches them in
  // SPR.facings[r], so a rotation shows genuinely different building sides.
  // Each facing is an independent bake of every developed building + its
  // seasonal (summer/winter/autumn) variants, returned as one bset.
  function bakeBuildingSet(BR) {
    // DETERMINISM (M32b): facing 0 keeps the shared 0x5EED stream so its
    // spritesheet is byte-identical to HEAD; facings 1..3 draw from an
    // INDEPENDENT forked seed, so bake order can never desync facing 0 and a
    // lazy facing never touches the shared ART_RNG (snapshot-swap idiom).
    const fseed = BR === 0 ? seeded : mulberry32((0x5EED ^ (BR * 0x9E3779B1)) >>> 0);
    const R = BR === 0 ? (() => seeded()) : (() => fseed());
    const facingPrev = ART_RNG; ART_RNG = fseed;

    // World-face feature router (M32b). The sun stays SCREEN-welded (SW face
    // shade .72, SE face shade .92 — done by prism()); only WHICH world face's
    // decoration lands on the two visible screen edges rotates. A handed
    // feature authored on the r=0 screen SE edge (S->E) is world face FE_PX; on
    // the SW edge (W->S) it is FE_PY. At bake rotation BR the SE edge shows
    // world face BR and the SW edge shows (BR+1)&3, so a feature on face f draws
    // on SE when f===BR, on SW when f===(BR+1)&3, else it is on an occluded back
    // face and is skipped (the intended plainer back). At BR=0 this reproduces
    // the HEAD placement exactly (S->E for FE_PX, W->S for FE_PY).
    const FE_PX = 0, FE_PY = 1;
    const onFace = (f, cn, draw) => {
      if (f === BR) draw(cn.S, cn.E);
      else if (f === ((BR + 1) & 3)) draw(cn.W, cn.S);
    };

    let park, police, firesta, coal, solar, gas, wind, school, hospital, mayor, stadium, bset;
    // M28: arcology + wonder-landmark mega-structures (large self-powered
    // footprints). forestArc (not "forest") avoids clobbering SPR.forest terrain.
    let plymouth, forestArc, darco, launch, statue, eiffel, pyramid;
    // GQ10: special-buildings gap-fill (nuclear plant, airport, seaport)
    let nuke, airport, seaport;
    const r1 = [], r2 = [], r3 = [], c1 = [], c2 = [], c3 = [], i1 = [], i2 = [], i3 = [];

  // ---- park ----
  // G14: parameterized by season so the park's two standalone trees recolor
  // with the year (snow caps in winter, fall hues in autumn) — the isolated-
  // tree case the seasonal recolor used to miss. `sk` null/summer/spring is the
  // pre-G14 summer bake, byte-for-byte (drawTree pal stays null, lawn stays
  // green, the flower confetti draws with the same seeded R() sequence).
  const parkDraw = (sk) => (g, ox, oy) => {
    const P = (sk && sk !== "summer" && sk !== "spring") ? SEASON_PAL[sk] : null;
    // GQ1 fix: park lawn was #4bb844 (HSL S=.460 — 1pt over the 45% gate bar);
    // #42be3a keeps the hue/lightness but lifts S to .533 for real margin,
    // still under the summer canopy's .57-.61 so lawns don't out-green trees
    const lawn = sk === "winter" ? "#e4e9f1" : sk === "autumn" ? "#9c9850" : "#42be3a";
    diamondPath(g, ox, oy);
    g.fillStyle = lawn; g.fill();
    g.strokeStyle = "rgba(0,0,0,.2)"; g.stroke();
    g.fillStyle = sk === "winter" ? "#cfe0ee" : "#8fd3f0"; // pond (iced over in winter)
    g.beginPath(); g.ellipse(ox + 8, oy + 4, 9, 4.5, 0, 0, 7); g.fill();
    g.strokeStyle = "#7ba7c2"; g.stroke();
    drawTree(g, ox - 14, oy + 2, 12, 1.05, P, 0, sk === "autumn" ? -0.5 : 0);
    drawTree(g, ox - 2, oy - 4, 10, 0.9, P, 0, sk === "autumn" ? 0.5 : 0);
    if (!P || sk === "spring") for (let k = 0; k < 8; k++) { // no flower beds under snow / stubble
      g.fillStyle = ["#ff5d5d", "#ffd34e", "#ff8ee0"][k % 3];
      g.fillRect(ox - 20 + R() * 40, oy - 4 + R() * 12, 2, 2);
    }
  };
  park = mkSprite(1, 1, 22, parkDraw("summer"));

  /* ---- residential (5 variants per level) ---- */
  const NV = 5; // zone sprite variants per level
  // GQ3: zone-correlated building palette — curated CONSTANTS + deterministic
  // fills only. This milestone adds ZERO random draws; any future per-variant
  // jitter must fork a side mulberry32 stream (GQ2 rule), never touch the
  // shared 0x5EED ART_RNG or reorder windows() calls.
  // Residential = warm terracotta/tan/brick. r1 terracotta plaster (hue 16-26),
  // r2 tan/mustard (hue 38-45 HARD BUDGET: <=45 keeps >=12deg margin to the
  // olive I classifier boundary), r3 brick-red (hue 8-18). The punch stays in
  // the terracotta roofs; R_ROOF are the saturated roof caps.
  const houseWalls = ["#c07b5d", "#bf8869", "#c07154", "#c4906e", "#bf714a"];
  const houseRoofs = ["#8b4b3f", "#9a5d4e", "#855242", "#996750", "#7a4b3a"];
  const r2Base = ["#c2a051", "#c49845", "#c0a65d", "#c69739", "#c5ad63"];
  const r3Base = ["#b3614d", "#b05545", "#b36d56", "#ab533f", "#bb7458"];
  const R_ROOF = ["#b0563c", "#a94f38", "#b5603f", "#a24a34", "#b56945"];
  // G14: r1 (cottages + a standalone tree) parameterized by season — winter
  // snows the pitched roofs and the tree, autumn turns the tree. sk null/
  // summer/spring reproduce the pre-G14 bake exactly (no snow, green lawn,
  // pal-less tree), so summer stays byte-identical.
  const r1Draw = (v, sk) => (g, ox, oy) => {
    const P = (sk && sk !== "summer" && sk !== "spring") ? SEASON_PAL[sk] : null;
    const snow = sk === "winter";
    const lawn = sk === "winter" ? "#e6ebf2" : sk === "autumn" ? "#9c9850" : "#4dae46";
    diamondPath(g, ox, oy);
    g.fillStyle = lawn; g.fill(); g.strokeStyle = "rgba(0,0,0,.18)"; g.stroke();
    tinyHouse(g, ox - 10, oy + 2, 22, houseWalls[v], houseRoofs[v], snow);
    tinyHouse(g, ox + 12, oy - 2, 18, houseWalls[(v + 1) % NV], houseRoofs[(v + 1) % NV], snow);
    drawTree(g, ox + 22, oy + 6, 8, 1, P, 0, sk === "autumn" ? 0.3 : 0);
  };
  for (let v = 0; v < NV; v++) {
    r1.push(withJitter(mkSprite(1, 1, 30, r1Draw(v, "summer"))));
    // GQ5 (A2): v0,2,4 remass as a HIP-ROOF ROWHOUSE; v1,3 keep the flat
    // parapet box. STREAM RULE: the windows(3,2)+windows(3,3)+roofClutter(2)
    // sequence below is preserved with identical rows/cols/counts at every
    // variant — only geometry args change, so the shared 0x5EED stream (and
    // every civic bake after the zone loops) is untouched.
    const r2hip = (v % 2) === 0, r2HT = r2hip ? 26 : 36;
    r2.push(withJitter(withNight(1, 1, 46, (g, ox, oy) => {
      const base = r2Base[v];
      // GQ3: lit/shadow faces by HSL lightness shift keep the mustard hue;
      // the warm identity comes from the terracotta coping / hip cap below.
      const cn = prism(g, ox, oy, 1, 1, r2HT, base, zoneFaces(base));
      const { W, S, E } = cn;
      windows(g, up(W, 0), up(S, 0), r2HT, 3, 2, 0.55, "#ffe9a0", "#20242c", GLOW_WARM, 0.4);
      windows(g, up(S, 0), up(E, 0), r2HT, 3, 3, 0.55, "#ffe9a0", "#20242c", GLOW_WARM, 0.4);
      // G9: tar deck behind a 1px parapet, dressed with seeded service gear.
      // On hip variants the pitched crown OVERPAINTS this whole deck — the
      // draws still run so the R()/ART_RNG consumption matches the flat bake.
      const [cx, cy] = roofDeck(g, ox, oy, 1, 1, r2HT, "#26282d", "rgba(14,12,10,.9)");
      // sun-catching coping cap along the two back parapet edges (G9 kept —
      // its bright pale pixels carry the roof's luminance variety)
      g.strokeStyle = lighten(base, 0.85); g.lineWidth = 2.2;
      g.beginPath();
      g.moveTo(cx - HW * 0.82, cy); g.lineTo(cx, cy - HH * 0.82);
      g.lineTo(cx + HW * 0.82, cy); g.stroke();
      g.fillStyle = "#4c4c52"; g.fillRect(cx - 8, cy - 3, 8, 5); // roof AC
      g.fillStyle = "#686870"; g.fillRect(cx - 8, cy - 4, 8, 2);
      g.fillStyle = "#1c2733"; g.fillRect(cx + 5, cy + 4, 9, 5); // skylight
      g.fillStyle = "#9fd3ef"; g.fillRect(cx + 6, cy + 5, 7, 3);
      roofClutter(g, cx + 2, cy - 2, 2, R);
      if (r2hip) {
        // terracotta hip crown in the r1 house-roof family (SNOWSPEC-
        // registered by hipRoofFrom), a brick chimney at the E ridge end,
        // and a dormer pair riding ONE world face (M32b onFace routing)
        hipRoofFrom(g, cn, r2HT, 22, shade(houseRoofs[v], 1.05), shade(houseRoofs[v], 0.72), 0, 0.55);
        const ry = cy - 22;
        g.fillStyle = "#7a4a38"; g.fillRect(ox + 5, ry - 6, 6, 10);
        g.fillStyle = "#94604a"; g.fillRect(ox + 5, ry - 6, 2, 10);
        g.fillStyle = "#3c3236"; g.fillRect(ox + 4, ry - 8, 8, 2);
        onFace(FE_PX, cn, (p0, p1) => {
          for (const t of [0.3, 0.62]) {
            const dx = p0[0] + (p1[0] - p0[0]) * t, dy = p0[1] + (p1[1] - p0[1]) * t - r2HT;
            g.fillStyle = shade(houseRoofs[v], 0.55); g.fillRect(dx - 3, dy - 8, 6, 5);
            g.fillStyle = "#ffe9a0"; g.fillRect(dx - 2, dy - 7, 4, 3);
            poly(g, [[dx - 4, dy - 8], [dx + 4, dy - 8], [dx, dy - 12]], shade(houseRoofs[v], 1.2));
          }
        });
      }
    }), { BR, fam: 2, v, cx: HW, cy: r2hip ? 29 : 26, spread: 8 }));
    r3.push(withJitter(withNight(1, 1, 82, (g, ox, oy) => {
      const base = r3Base[v];
      // GQ3: brick-red tower under the saturated terracotta roof cap —
      // the hospital's #d8d5ca helipad stays a clear >= 12 distance from these
      if (v % 2 === 0) {
        // GQ5 (A3): STEPPED WEDDING-CAKE — three setback tiers (40/18/10,
        // total 68 like HEAD) via the proven plymouth idiom; deterministic
        // constants only, then the preserved seeded roof furniture below.
        const tiers = setbackTiers(g, ox, oy, 1, 1, [
          { k: 1.0, ht: 40, base, opts: zoneFaces(base, R_ROOF[v]) },
          { k: 0.74, ht: 18, base, opts: zoneFaces(base, R_ROOF[v]) },
        ]);
        // crown tier pushed to the front (W-S) half of the tier-2 terrace —
        // the asymmetric top keeps A3's outline apart from the symmetric
        // boxes AND the r1 cottage cluster (corner lerps: facing-agnostic)
        const r2r = tiers[1].cn;
        const midp = (a, b2) => [(a[0] + b2[0]) / 2, (a[1] + b2[1]) / 2];
        const t3cn = raise({ N: midp(r2r.N, r2r.W), E: midp(r2r.E, r2r.S), S: r2r.S, W: r2r.W }, 18);
        prismFrom(g, t3cn, 12, base, zoneFaces(base, shade(R_ROOF[v], 1.1)));
        tiers.push({ cn: t3cn, top: 70 });
        const b0 = tiers[0].cn;
        windows(g, b0.W, b0.S, 40, 6, 3, 0.6, "#ffe9a0", "#20242c", GLOW_WARM, 0.4);
        windows(g, b0.S, b0.E, 40, 6, 3, 0.6, "#ffe9a0", "#20242c", GLOW_WARM, 0.4);
        // preserved R() draws, order/count identical to HEAD: tank x-jitter,
        // bulkhead y-jitter, then the v%2 branch (planters here: 0 draws)
        const [tx3, ty3] = roofDeckFrom(g, tiers[2].cn, 12, shade(base, 0.55), "rgba(24,20,16,.9)");
        waterTank(g, tx3 - 5 + (R() * 4 | 0), ty3 + 2);
        bulkhead(g, ox + 16, oy - 58 + 9 + (R() * 3 | 0), base);
        planter(g, ox - 17, oy - 58 + 8); planter(g, ox - 8, oy - 58 + 12);
      } else {
        // GQ5 (A12): TANK-CROWN TOWER — parapet piers + an oversized stave
        // water tank on splayed legs clearing the roofline (~+28px silhouette)
        const { W, S, E } = prism(g, ox, oy, 1, 1, 62, base, zoneFaces(base, R_ROOF[v]));
        windows(g, up(W, 0), up(S, 0), 62, 6, 3, 0.6, "#ffe9a0", "#20242c", GLOW_WARM, 0.4);
        windows(g, up(S, 0), up(E, 0), 62, 6, 3, 0.6, "#ffe9a0", "#20242c", GLOW_WARM, 0.4);
        const [cx, cy] = roofDeck(g, ox, oy, 1, 1, 62, shade(base, 0.55), "rgba(24,20,16,.9)");
        // G10: warm coping cap along the two back parapet edges
        g.strokeStyle = shade(R_ROOF[v], 1.15); g.lineWidth = 1.8;
        g.beginPath();
        g.moveTo(cx - HW * 0.82, cy); g.lineTo(cx, cy - HH * 0.82);
        g.lineTo(cx + HW * 0.82, cy); g.stroke();
        g.fillStyle = shade(base, 0.8); // corner parapet piers
        for (const [px2, py2] of [[cx - HW, cy], [cx + HW, cy], [cx, cy - HH], [cx, cy + HH]])
          g.fillRect(px2 - 2, py2 - 6, 4, 7);
        // oversized rooftop tank, pushed off-center (asymmetric silhouette;
        // consumes the SAME single R() x-jitter draw as HEAD's waterTank)
        const tx = cx - 8 + (R() * 4 | 0), ty = cy - 3;
        g.strokeStyle = "#3c3630"; g.lineWidth = 2;
        for (const dx of [-8, -3, 3, 8]) {
          g.beginPath(); g.moveTo(tx + dx * 0.45, ty - 8); g.lineTo(tx + dx, ty + 4); g.stroke();
        }
        g.fillStyle = "#23262c"; g.fillRect(tx - 14, ty - 9, 28, 2);      // platform
        g.fillStyle = "#8a7a64"; g.fillRect(tx - 13, ty - 24, 26, 15);    // stave drum
        g.fillStyle = "#a5947c"; g.fillRect(tx - 13, ty - 24, 9, 15);
        g.strokeStyle = "#6e6152"; g.lineWidth = 1;                       // hoops
        for (const hy of [-20, -14]) {
          g.beginPath(); g.moveTo(tx - 13, ty + hy); g.lineTo(tx + 13, ty + hy); g.stroke();
        }
        g.fillStyle = "#54493c";                                          // conic cap
        g.beginPath(); g.moveTo(tx - 15, ty - 24); g.lineTo(tx + 15, ty - 24);
        g.lineTo(tx, ty - 30); g.closePath(); g.fill();
        ROOF_PROPS[4](g, cx + 16, cy - 2); // companion drum on the E shoulder
        bulkhead(g, cx + 12, cy + 4 + (R() * 3 | 0), base);
        clothesline(g, cx - 3, cy + 8, R); // v odd: HEAD's clothesline branch
      }
    }), { BR, fam: 3, v, cx: HW + ((v % 2) ? 0 : 2), cy: (v % 2) ? 36 : 47, spread: 9 }));
  }

  /* ---- commercial ---- */
  // GQ3: commercial = teal/cyan glass (constants only — see the RNG note at
  // the residential palettes). c1 pale teal storefronts (hue 180-192), c2
  // teal/cyan mid-rise (hue 183-195), c3 curtain-wall glass split into two
  // buckets: variants 0,3 teal (hue 188-196), variants 1,2,4 blue (hue
  // 210-224, S capped at .50 so summer water stays the most saturated blue
  // in frame — GQ1). Awnings keep their cool jewel tones.
  const c1Base = ["#93babd", "#9bbbbf", "#89bcbd", "#a3bdc2", "#85b2b7"];
  const c2Base = ["#4f96a1", "#47999e", "#5996a6", "#468d95", "#5d99ac"];
  const c3Glass = ["#428b9a", "#3f6aa2", "#4966a2", "#377f95", "#4660aa"];
  const C_ROOF = ["#79b0c8", "#7ec0c4", "#88b8cc", "#7ab4c6", "#8cbcce"];
  for (let v = 0; v < NV; v++) {
    c1.push(withJitter(mkSprite(1, 1, 30, (g, ox, oy) => {
      const base = c1Base[v];
      const { W, S, E } = prism(g, ox, oy, 1, 1, 18, base, zoneFaces(base));
      // storefront glass band + cool jewel-tone awning (trim punch). G10:
      // the glass is a muted cool gray-blue so the facade stays low-saturation.
      const aw = ["#3d6b95", "#3a8489", "#3f5f99", "#447894", "#495e89"][v];
      poly(g, [up(S, 4), up(E, 4), up(E, 13), up(S, 13)], "#aebfc6");
      poly(g, [up(W, 4), up(S, 4), up(S, 13), up(W, 13)], "#93a9b2");
      g.fillStyle = aw;
      poly(g, [up(S, 13), up(E, 13), up(E, 17), up(S, 17)], aw);
      poly(g, [up(W, 13), up(S, 13), up(S, 17), up(W, 17)], shade(aw, 0.8));
    })));
    c2.push(withJitter(withNight(1, 1, 56, (g, ox, oy) => {
      const base = c2Base[v];
      // GQ5 (A5): PODIUM + OFFSET SLAB — a full-lot podium (ht 14) under a
      // half-lot slab (ht 40) pushed to the rear (N-E) or front (W-S) half by
      // variant parity. Corner-lerp construction keeps it facing-agnostic and
      // both slab faces coplanar with the podium faces, so the SE windows run
      // ground-to-crown in ONE call. Stream signature preserved verbatim:
      // windows(4,3) + windows(4,4) + roofClutter(3, R).
      const cn = corners(ox, oy, 1, 1);
      const mid = (a, b2) => [(a[0] + b2[0]) / 2, (a[1] + b2[1]) / 2];
      prismFrom(g, cn, 14, base, zoneFaces(base));
      const back2 = (v % 2) === 0;
      const slab = back2
        ? { N: cn.N, E: cn.E, S: mid(cn.E, cn.S), W: mid(cn.N, cn.W) }
        : { N: mid(cn.N, cn.W), E: mid(cn.E, cn.S), S: cn.S, W: cn.W };
      const sc = raise(slab, 14);
      // GQ3: bright cool crown for roof-line punch over the teal facade
      prismFrom(g, sc, 40, base, zoneFaces(base, C_ROOF[v]));
      windows(g, sc.W, sc.S, 40, 4, 3, 0.65, "#cfe8ff", "#20242c", GLOW_COOL);
      windows(g, slab.S, slab.E, 54, 4, 4, 0.65, "#cfe8ff", "#20242c", GLOW_COOL);
      // G9: gravel deck behind a 1px parapet plus seeded service gear
      const [cx, cy] = roofDeckFrom(g, sc, 40, shade(base, 0.55), "rgba(16,16,20,.85)");
      roofClutter(g, cx, cy, 3, R);
      // deterministic skylight strip along the exposed podium half
      const pod = raise(back2
        ? { N: mid(cn.N, cn.W), E: mid(cn.E, cn.S), S: cn.S, W: cn.W }
        : { N: cn.N, E: cn.E, S: mid(cn.E, cn.S), W: mid(cn.N, cn.W) }, 14);
      for (const t of [0.3, 0.5, 0.7]) {
        const kx = pod.W[0] + (pod.E[0] - pod.W[0]) * t;
        const ky = pod.W[1] + (pod.E[1] - pod.W[1]) * t;
        g.fillStyle = "#1c2733"; g.fillRect(kx - 4, ky - 2, 8, 4);
        g.fillStyle = "#8fc3e0"; g.fillRect(kx - 3, ky - 1, 6, 2);
      }
    }), { BR, fam: 5, v, cx: (v % 2) ? 24 : 40, cy: (v % 2) ? 24 : 17, spread: 7 }));
    // G9: the mast + red beacon is a C3-only signature carried by exactly
    // 2 of the 5 variants; the tip bakes in its lit state and the renderer
    // blinks it live via spr.beacon (phase-offset per tower)
    const c3mast = v === 1 || v === 3;
    // GQ6: reflective-glass side stream (GQ2/GQ5 hard rule: never the shared
    // 0x5EED stream) — consumed ONLY inside the draw callback below, which
    // mkSprite runs exactly once per bakeBuildingSet(BR) call, so streak
    // placement is boot- and facing-deterministic and zero downstream bakes
    // (civic/mega/i-family) shift by a single RNG draw.
    const glassRng = mulberry32((0x61A55C ^ (BR * 0x9E3779B1) ^ (v * 0x85EBCA77)) >>> 0);
    const c3spr = withNight(1, 1, 104, (g, ox, oy) => {
      const glass = c3Glass[v];
      // GQ3: banded curtain wall (period-correct SC2K tower skin) — spandrel/
      // glass strips + 2 mullion lines per visible face. Pure loops, ZERO RNG,
      // drawn on the day canvas only. GQ5 generalizes the loop to any corner
      // set / height: at ht 88 it reproduces the GQ3 8-band pattern exactly.
      const spandrel = faceL(glass, -0.16), band = faceL(glass, 0.08),
            mullion = faceL(glass, -0.22);
      // GQ6: reflective-glass tone set — palette-quantized, no alpha, no
      // gradients. dith/dithSky are ordered-dither light cells over the glass
      // strips; the top skyN bands swap to bandSky/dithSky (hue nudged 10°
      // cool) so upper glass reflects sky and lower glass reflects street in
      // hard palette steps; glint/glintLo are the diagonal reflection-streak
      // pair, deliberately distinct from the "#eaf6ff" lit-pane color.
      const [gh, gs, gl] = hexToHsl(glass);
      const dith = hslStr(gh, gs, Math.min(0.88, gl + 0.13)),
            bandSky = hslStr(gh + 10, gs, Math.min(0.88, gl + 0.17)),
            dithSky = hslStr(gh + 10, gs, Math.min(0.88, gl + 0.22)),
            glint = hslStr(gh + 6, gs * 0.7, 0.84),
            glintLo = hslStr(gh + 6, gs * 0.7, 0.68);
      const skin = (cn2, ht2, skyN) => {
        const nb = Math.max(2, Math.round(ht2 / 11)), bh = ht2 / nb;
        for (const [p0, p1] of [[cn2.W, cn2.S], [cn2.S, cn2.E]]) {
          for (let k = 0; k < nb; k++) {
            const sky = k >= nb - skyN;
            poly(g, [up(p0, k * bh + bh * 4 / 11), up(p1, k * bh + bh * 4 / 11),
                     up(p1, k * bh + bh), up(p0, k * bh + bh)], sky ? bandSky : band);
            poly(g, [up(p0, k * bh), up(p1, k * bh),
                     up(p1, k * bh + bh * 4 / 11), up(p0, k * bh + bh * 4 / 11)], spandrel);
            // GQ6: ordered dither inside the glass strip — 2px cell columns
            // on a checkerboard whose phase flips per band. Integer-rounded
            // rects keep AA noise down; ZERO RNG, pure loop.
            g.fillStyle = sky ? dithSky : dith;
            const m = Math.floor((p1[0] - p0[0]) / 2), hHi = k * bh + bh;
            for (let j = 0; j < m; j++) {
              if (((j + k) & 1) !== 0) continue;
              const tj = (j + 0.5) / m;
              const jx = p0[0] + (p1[0] - p0[0]) * tj, jy = p0[1] + (p1[1] - p0[1]) * tj;
              g.fillRect(Math.round(jx) - 1, Math.round(jy - hHi) + 1, 2,
                         Math.round(bh * 7 / 11) - 2);
            }
          }
          g.fillStyle = mullion;
          for (const t of [1 / 3, 2 / 3]) {
            const mx = p0[0] + (p1[0] - p0[0]) * t, my = p0[1] + (p1[1] - p0[1]) * t;
            // GQ6: x snapped to the integer column so the mullion rasterizes
            // crisp (un-blended) over the dither/streak texture; y span verbatim
            g.fillRect(Math.round(mx), my - ht2, 1, ht2);
          }
        }
      };
      // GQ6: sky-glint pass — pixel-stepped diagonal reflection ribbons laid
      // over the FINISHED curtain wall (spandrels, glass strips and window
      // panes alike, so it reads as one reflection on the whole wall, not
      // per-stripe paint), then the mullion grid is re-stamped on top so the
      // grid slices every streak — the "reflective glass" cue. Ribbons are
      // 1px-row fillRect steps (zero AA, SC2K-flat) and are clipped to the
      // exact face parallelogram built from the same corner points, so no
      // pixel can escape the silhouette. All randomness comes from glassRng
      // (the GQ6 side stream) — the shared R()/ART_RNG stream is untouched.
      const glints = (cn2, ht2) => {
        let fi = 0;
        for (const [p0, p1] of [[cn2.W, cn2.S], [cn2.S, cn2.E]]) {
          const nS = fi === 1 ? 2 : (glassRng() < 0.6 ? 1 : 0);
          if (nS) {
            g.save();
            g.beginPath();
            g.moveTo(p0[0], p0[1]); g.lineTo(p1[0], p1[1]);
            g.lineTo(p1[0], p1[1] - ht2); g.lineTo(p0[0], p0[1] - ht2);
            g.closePath(); g.clip();
            const ed = (u) => [p0[0] + (p1[0] - p0[0]) * u, p0[1] + (p1[1] - p0[1]) * u];
            const echo = Math.round((p1[0] - p0[0]) * 0.09); // glintLo trail offset
            for (let s2 = 0; s2 < nS; s2++) {
              const u0 = 0.06 + glassRng() * 0.42, h0 = ht2 * (0.12 + glassRng() * 0.35),
                    du = 0.45, dh = ht2 * 0.42, w2 = 2 + (glassRng() * 2 | 0);
              const [ax, ay0] = ed(u0), [bx, by0] = ed(u0 + du);
              const ay = Math.round(ay0 - h0), by = Math.round(by0 - h0 - dh);
              for (let yy = by; yy < ay; yy++) { // crisp 1px ribbon rows
                const xx = Math.round(ax + (bx - ax) * (ay - yy) / (ay - by));
                g.fillStyle = glint; g.fillRect(xx, yy, w2, 1);
                g.fillStyle = glintLo; g.fillRect(xx + w2 + echo, yy, 1, 1);
              }
            }
            g.restore();
          }
          fi++;
          g.fillStyle = mullion; // re-stamp the grid over the streaks
          for (const t of [1 / 3, 2 / 3]) {
            const mx = p0[0] + (p1[0] - p0[0]) * t, my = p0[1] + (p1[1] - p0[1]) * t;
            g.fillRect(Math.round(mx), my - ht2, 1, ht2);
          }
        }
      };
      // STREAM RULE: both branches consume windows(8,3) x2 then
      // roofClutter(2+(v&1), R) — identical to HEAD in count and order.
      if (v % 2 === 0) {
        // GQ5 (A6): TAPERING TOWER — three curtain-wall setback tiers
        // (42/30/18, crown at 90) + a deterministic spire on the crown deck
        const tiers = setbackTiers(g, ox, oy, 1, 1, [
          { k: 1.0, ht: 42, base: glass, opts: zoneFaces(glass) },
          { k: 0.8, ht: 30, base: glass, opts: zoneFaces(glass) },
          { k: 0.58, ht: 18, base: glass, opts: zoneFaces(glass, shade(glass, 1.5)) },
        ]);
        // GQ6: skyN steps up the tower — street reflections low, sky high
        skin(tiers[0].cn, 42, 0); skin(tiers[1].cn, 30, 1); skin(tiers[2].cn, 18, 2);
        const b0 = tiers[0].cn;
        windows(g, b0.W, b0.S, 42, 8, 3, 0.75, "#eaf6ff", shade(glass, 0.45), GLOW_COOL);
        windows(g, b0.S, b0.E, 42, 8, 3, 0.75, "#eaf6ff", shade(glass, 0.5), GLOW_COOL);
        // GQ6: reflections catch the big shaft and the crown; the waist tier
        // stays calm dithered glass so the setbacks don't read as one smear
        glints(tiers[0].cn, 42); glints(tiers[2].cn, 18);
        const [cx, cy] = roofDeckFrom(g, tiers[2].cn, 18, shade(glass, 1.12), "rgba(16,20,28,.8)");
        roofClutter(g, cx + 2, cy + 2, 2 + (v & 1), R);
        g.strokeStyle = "#222"; g.lineWidth = 2; // crown spire (deterministic)
        g.beginPath(); g.moveTo(ox, cy); g.lineTo(ox, cy - 18); g.stroke();
        g.strokeStyle = "#8a9098"; g.lineWidth = 1;
        g.beginPath(); g.moveTo(ox - 4, cy - 12); g.lineTo(ox + 4, cy - 12); g.stroke();
        g.fillStyle = "#c9d2da"; g.fillRect(ox - 1.5, cy - 21, 3, 4);
        // lit lobby spilling onto the plaza (G2: own layer, suppressible)
        groundPool(b0.S[0], b0.S[1] - 2, 12, 5, GLOW_COOL);
      } else {
        // GQ5 (A7): BANDED TOWER + CROWN STEP + MAST — today's banded box
        // plus one crown setback tier (inset .7, ht 8) drawn AFTER windows;
        // mast/beacon geometry stays verbatim (spr.beacon offset unchanged).
        const { W, S, E, N } = prism(g, ox, oy, 1, 1, 88, glass,
          zoneFaces(glass, shade(glass, 1.5)));
        skin({ N, E, S, W }, 88, 2);
        windows(g, up(W, 0), up(S, 0), 88, 8, 3, 0.75, "#eaf6ff", shade(glass, 0.45), GLOW_COOL);
        windows(g, up(S, 0), up(E, 0), 88, 8, 3, 0.75, "#eaf6ff", shade(glass, 0.5), GLOW_COOL);
        glints({ N, E, S, W }, 88); // GQ6: reflection streaks over the full wall
        // G9: service deck ring on the glass crown, then the crown step
        roofDeck(g, ox, oy, 1, 1, 88, shade(glass, 1.12), "rgba(16,20,28,.8)");
        // half-lot crown slab on the front (W-S) half of the roof ring —
        // the asymmetric step keeps A7's outline off the plain-box ramp
        const rr = raise(insetCorners(ox, oy, 1, 1, 0.84), 88);
        const midp = (a, b2) => [(a[0] + b2[0]) / 2, (a[1] + b2[1]) / 2];
        const cc = { N: midp(rr.N, rr.W), E: midp(rr.E, rr.S), S: rr.S, W: rr.W };
        prismFrom(g, cc, 12, glass, zoneFaces(glass, shade(glass, 1.4)));
        const [cx, cy] = roofDeckFrom(g, cc, 12, shade(glass, 1.12), "rgba(16,20,28,.8)");
        roofClutter(g, cx + 4, cy + 3, 2 + (v & 1), R);
        if (c3mast) {
          g.strokeStyle = "#222"; g.lineWidth = 2;
          g.beginPath(); g.moveTo(ox, N[1] - 88); g.lineTo(ox, N[1] - 102); g.stroke();
          g.fillStyle = "#f33"; g.fillRect(ox - 1.5, N[1] - 104, 3, 3);
        }
        // lit lobby spilling onto the plaza (G2: own layer, suppressible)
        groundPool(S[0], S[1] - 2, 12, 5, GLOW_COOL);
      }
    });
    // beacon tip offset from the anchor center, for the live blink pass —
    // set BEFORE withJitter so every value-jittered copy inherits it (G10)
    if (c3mast) c3spr.beacon = { x: -1.5, y: -(HH + 104) };
    c3.push(withJitter(c3spr, { BR, fam: 6, v, cx: HW, cy: (v % 2) ? 20 : 30, spread: 7 }));
  }

  /* ---- industrial ---- */
  // GQ3: industrial = drab steel/olive (constants only — see the RNG note at
  // the residential palettes). Hue 70-95 (HARD BUDGET: >=70 keeps >=12deg
  // margin to mustard r2's <=45 boundary), S .10-.24, lightness DECLINING by
  // density (.48/.42/.36) — lightness is the MN3 non-hue cue. I_ROOF rust
  // stays the punch (roofs/trim rule), not the facade.
  const i1Base = ["#859169", "#7d8a6a", "#8f9966", "#77856b", "#809064"];
  const i2Base = ["#74805b", "#6c7a5c", "#778255", "#67755c", "#6f7f57"];
  const i3Base = ["#636f4d", "#5c6a4e", "#657048", "#58664d", "#5e6e49"];
  // G10: rust/ochre roof caps — the industrial "punch" that keeps the roof
  // family saturated while the concrete facades stay grey (roofs/trim rule).
  const I_ROOF = ["#9a6a3c", "#8f6236", "#a06e3e", "#8a5e34", "#9c6a3a"];
  for (let v = 0; v < NV; v++) {
    // GQ5 (A8): v0,2,4 remass as a GABLE SHED — low walls under a full-width
    // pitched roof whose ridge runs the N-S tile axis (the OPPOSITE axis to
    // r2's hip, keeping the two pitched archetypes' top profiles apart);
    // v1,3 keep the flat box. i1 makes ZERO shared-stream draws either way.
    const i1gable = (v % 2) === 0, i1HT = i1gable ? 12 : 20;
    i1.push(withJitter(mkSprite(1, 1, 30, (g, ox, oy) => {
      const base = i1Base[v];
      const cn = prism(g, ox, oy, 1, 1, i1HT, base, zoneFaces(base));
      if (i1gable) {
        hipRoofFrom(g, cn, i1HT, 10, shade(I_ROOF[v], 1.05), shade(I_ROOF[v], 0.72), 1, 0.8);
        for (const t of [-0.3, 0, 0.3]) { // 3 ridge vents (deterministic)
          const vy = (oy - i1HT - 10) + t * 2 * HH * 0.8;
          g.fillStyle = "#6c717c"; g.fillRect(ox - 1, vy - 3, 3, 3);
          g.fillStyle = "#8a8f98"; g.fillRect(ox - 2, vy - 4, 5, 1);
        }
      }
      // big loading door tagged to ONE world face (M32b) — plainer at the two
      // orientations where that face rotates to an occluded back
      onFace(FE_PX, cn, (p0, p1) => {
        const fm = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
        const dt = i1gable ? 11 : 14; // door top stays under the gable eave
        g.fillStyle = "#5a5148";
        poly(g, [up(p0, 2), up(p1, 2), up(p1, dt), up(p0, dt)].map(p => [
          p[0] * 0.5 + fm[0] * 0.5, p[1] * 0.5 + fm[1] * 0.5]), "#5a5148");
      });
    })));
    // GQ5 (A9): v0,2,4 remass as a SAWTOOTH SHED (3 north-light teeth on a
    // lower hall); v1,3 keep the box+stack (A10). The two windows(2,3) calls
    // below are preserved verbatim INCLUDING the BR===0 forked-seed swap
    // block, so the shared-stream signature is identical at every variant.
    const i2saw = (v % 2) === 0, i2HT = i2saw ? 22 : 28;
    i2.push(withJitter(withNight(1, 1, 56, (g, ox, oy) => {
      const base = i2Base[v];
      const { W, S, E, N } = prism(g, ox, oy, 1, 1, i2HT, base, zoneFaces(base, I_ROOF[v]));
      windows(g, up(S, 0), up(E, 0), i2HT, 2, 3, 0.4, "#ffd27f", "#20242c", GLOW_SODIUM);
      // M32b: the SW screen face was bare grey at every rotation (HEAD only lit
      // the SE face). Light it too so both screen-visible faces read populated,
      // like the box families. At facing 0 (BR===0) the shared 0x5EED stream is
      // live, so draw this newly-lit face from a forked seed swapped in/out (the
      // gasRng idiom, ~l.1340): the extra panes never consume the shared ART_RNG,
      // so every OTHER sprite in the facing-0 bake stays byte-identical to HEAD
      // and only this previously-blank face gains pixels. Facings 1..3 already
      // draw from the forked fseed, so they are left exactly as before.
      {
        const swPrev = ART_RNG;
        if (BR === 0) ART_RNG = mulberry32((0x1252A7 ^ (v * 0x9E3779B1)) >>> 0);
        windows(g, up(W, 0), up(S, 0), i2HT, 2, 3, 0.4, "#ffd27f", "#20242c", GLOW_SODIUM);
        ART_RNG = swPrev;
      }
      if (i2saw) {
        sawtoothRoof(g, { N, E, S, W }, i2HT, 3, 9, I_ROOF[v]);
        stack(g, ox + 10, N[1] - 16, 20, 5); // rear-corner stack over the teeth
        groundPool(ox + 8, oy + 4, 15, 6, GLOW_SODIUM); // night-shift yard flood
        if (GLOWG) { // stack beacon stays with the window glow
          GLOWG.fillStyle = "#ff6a4a";
          GLOWG.fillRect(ox + 9, N[1] - 39, 3, 3);
        }
      } else {
        stack(g, ox - 10, N[1] - 24, 22, 6);
        groundPool(ox + 8, oy + 4, 15, 6, GLOW_SODIUM); // night-shift yard flood
        if (GLOWG) { // stack beacon stays with the window glow
          GLOWG.fillStyle = "#ff6a4a";
          GLOWG.fillRect(ox - 11, N[1] - 49, 3, 3);
        }
      }
    }), { BR, fam: 8, v, cx: HW, cy: 44, spread: 8 }));
    i3.push(withJitter(withNight(1, 1, 74, (g, ox, oy) => {
      const base = i3Base[v];
      const { W, S, E, N } = prism(g, ox, oy, 1, 1, 38, base, zoneFaces(base, I_ROOF[v]));
      windows(g, up(W, 0), up(S, 0), 38, 2, 2, 0.35, "#ffd27f", "#20242c", GLOW_SODIUM);
      // M32b: mirror of i2 — HEAD only lit the SW face, leaving the SE screen
      // face bare grey at every rotation. Light it too so both screen-visible
      // faces read populated. At facing 0 (BR===0) the shared 0x5EED stream is
      // live, so draw this face from a forked seed swapped in/out (gasRng idiom)
      // — the extra panes never consume the shared ART_RNG, so the rest of the
      // facing-0 bake stays byte-identical to HEAD and only this previously-blank
      // face gains pixels. Facings 1..3 draw from the forked fseed as before.
      {
        const sePrev = ART_RNG;
        if (BR === 0) ART_RNG = mulberry32((0x3E9B11 ^ (v * 0x85EBCA77)) >>> 0);
        windows(g, up(S, 0), up(E, 0), 38, 2, 2, 0.35, "#ffd27f", "#20242c", GLOW_SODIUM);
        ART_RNG = sePrev;
      }
      stack(g, ox - 12, N[1] - 34, 30, 7);
      stack(g, ox + 2, N[1] - 30, 24, 6);
      g.fillStyle = "#a8b2ba"; // storage tank
      g.beginPath(); g.ellipse(ox + 16, N[1] - 30, 7, 4, 0, 0, 7); g.fill();
      g.fillRect(ox + 9, N[1] - 30, 14, 8);
      g.beginPath(); g.ellipse(ox + 16, N[1] - 22, 7, 4, 0, 0, 7); g.fill();
      groundPool(ox - 2, oy + 6, 17, 7, GLOW_SODIUM); // night-shift yard flood
      if (GLOWG) { // stack beacons stay with the window glow
        GLOWG.fillStyle = "#ff6a4a";
        GLOWG.fillRect(ox - 13, N[1] - 67, 3, 3);
        GLOWG.fillRect(ox + 1, N[1] - 57, 3, 3);
      }
    })));
  }

  /* ---- civic 2x2 buildings ---- */
  // Police precinct: raised massing + a comms-mast landmark clearing the
  // tower skyline, a blue shield roof glyph (minimap #88f) and a paved apron.
  police = withNight(2, 2, 92, (g, ox, oy) => {
    civicApron(g, ox, oy, 2, 2);
    const HT = 58, cn = insetCorners(ox, oy, 2, 2, 0.84), { W, S, E } = cn;
    prismFrom(g, cn, HT, "#b9c4d4");
    windows(g, up(W, 0), up(S, 0), HT, 4, 4, 0.7, "#dce9ff", "#20242c", GLOW_COOL);
    windows(g, up(S, 0), up(E, 0), HT, 4, 4, 0.7, "#dce9ff", "#20242c", GLOW_COOL);
    // blue precinct band + gold badge near the base
    poly(g, [up(S, 20), up(E, 20), up(E, 27), up(S, 27)], "#173e8c");
    poly(g, [up(W, 20), up(S, 20), up(S, 27), up(W, 27)], "#102e6b");
    g.fillStyle = "#ffd94e";
    g.beginPath(); g.arc(S[0], S[1] - 23, 3.4, 0, 7); g.fill();
    // G9: service deck + parapet + seeded clutter on the precinct roof
    const [rx, ry] = roofDeckFrom(g, cn, HT, shade("#b9c4d4", 0.6), "rgba(16,18,24,.85)");
    roofClutter(g, rx - 18, ry + 3, 2, R, 1.0);
    commsMast(g, rx + 2, ry - 6);       // skyline landmark
    policeShield(g, rx - 4, ry + 10);   // findable blue roof glyph
  });

  // Fire station: apparatus bays, a red-roofed hose tower landmark, a bright
  // red garage-door roof emblem (minimap #f55) and a paved apron.
  firesta = mkSprite(2, 2, 64, (g, ox, oy) => {
    civicApron(g, ox, oy, 2, 2);
    const HT = 34, cn = insetCorners(ox, oy, 2, 2, 0.84), { W, S, E } = cn;
    prismFrom(g, cn, HT, "#c8574a");
    // three cream apparatus-bay doors tagged to the apparatus world face (M32b)
    onFace(FE_PX, cn, (p0, p1) => {
      for (let k = 0; k < 3; k++) {
        const t0 = 0.12 + k * 0.28, t1 = t0 + 0.2;
        const p = (t) => [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t];
        poly(g, [up(p(t0), 3), up(p(t1), 3), up(p(t1), 18), up(p(t0), 18)], "#e8e2d2");
      }
    });
    poly(g, [up(W, 26), up(S, 26), up(S, 31), up(W, 31)], "#8c2c22");
    poly(g, [up(S, 26), up(E, 26), up(E, 31), up(S, 31)], "#a53328");
    // G9: deck + parapet + clutter behind the station front
    const [rx, ry] = roofDeckFrom(g, cn, HT, shade("#c8574a", 0.55), "rgba(20,12,10,.85)");
    roofClutter(g, rx - 16, ry + 2, 2, R, 1.0);
    fireTower(g, rx + 9, ry + 1);       // hose-drying tower landmark
    garageEmblem(g, rx - 6, ry + 7);    // findable red roof glyph
  });

  coal = withNight(2, 2, 78, (g, ox, oy) => {
    const { W, S, E, N } = prism(g, ox, oy, 2, 2, 34, "#5c5c64");
    windows(g, up(S, 0), up(E, 0), 34, 2, 4, 0.5, "#ffb54e", "#20242c", GLOW_SODIUM);
    stack(g, ox - 18, N[1] - 26, 44, 10, true);
    stack(g, ox + 14, N[1] - 20, 36, 9, true);
    g.fillStyle = "#2f2f36"; // coal pile
    g.beginPath(); g.ellipse(S[0] + 14, S[1] - 40, 12, 6, 0, 0, 7); g.fill();
  });

  solar = mkSprite(2, 2, 30, (g, ox, oy) => {
    const { N, E, S, W } = prism(g, ox, oy, 2, 2, 10, "#8d97a4");
    // panel grid on the top face
    g.save();
    g.beginPath();
    g.moveTo(...up(N, 10)); g.lineTo(...up(E, 10)); g.lineTo(...up(S, 10)); g.lineTo(...up(W, 10));
    g.closePath(); g.clip();
    g.fillStyle = "#173a6e";
    g.fill();
    g.strokeStyle = "#5fa8e8"; g.lineWidth = 1;
    for (let k = -6; k <= 6; k++) {
      g.beginPath(); g.moveTo(N[0] + k * 10 - 40, N[1] - 10 - 20); g.lineTo(N[0] + k * 10 + 40, N[1] - 10 + 60); g.stroke();
      g.beginPath(); g.moveTo(N[0] + k * 10 + 40, N[1] - 10 - 20); g.lineTo(N[0] + k * 10 - 40, N[1] - 10 + 60); g.stroke();
    }
    g.restore();
  });

  /* ---- gas plant (M19) ----
     A big fossil peaker in the coal/solar prism-and-stack idiom: a low tan
     turbine hall with lit machine-hall windows, two short striped exhaust
     stacks (its coal-level smog rises from here, updateSmoke) and a round
     steel gas storage tank. Baked with withNight so its windows glow.
     G13-style discipline: windows()'s pane-lighting draws from a DEDICATED
     seeded stream (swapped in/out around the bake) so inserting this new
     sprite never shifts the shared ART_RNG sequence — every building baked
     after it (school/hospital/mayor/stadium, seasonal r1) stays byte-identical. */
  {
    const gasRng = mulberry32(0x6A5C0A1);
    const prevRng = ART_RNG; ART_RNG = gasRng;
    gas = withNight(2, 2, 66, (g, ox, oy) => {
      const { W, S, E, N } = prism(g, ox, oy, 2, 2, 26, "#7d7360");
      windows(g, up(S, 0), up(E, 0), 26, 2, 5, 0.55, "#ffd27a", "#20242c", GLOW_SODIUM);
      // two short exhaust stacks rising off the back of the hall
      stack(g, ox - 14, N[1] - 16, 26, 8, true);
      stack(g, ox + 10, N[1] - 12, 21, 7, true);
      // round steel gas storage tank on the SE apron
      const tx = S[0] + 15, ty = S[1] - 30;
      g.fillStyle = "#c6ccd3";
      g.beginPath(); g.ellipse(tx, ty, 11, 11, 0, 0, 7); g.fill();
      g.fillStyle = "#a4acb4"; // shaded right hemisphere
      g.beginPath(); g.ellipse(tx, ty, 11, 11, 0, Math.PI * 0.1, Math.PI * 0.9); g.fill();
      g.strokeStyle = "#6d747c"; g.lineWidth = 1;
      g.beginPath(); g.ellipse(tx, ty, 11, 11, 0, 0, 7); g.stroke();
      g.beginPath(); g.moveTo(tx - 11, ty); g.lineTo(tx + 11, ty); g.stroke(); // equator band
    });
    ART_RNG = prevRng;
  }

  /* ---- wind farm (M19) ----
     A clean, low-output generator: a grassy pad carrying two white lattice-
     free turbine towers, each with a hub and three swept blades. No stack,
     no windows — zero smog. Uses mkSprite (no night bake) like solar. */
  wind = mkSprite(2, 2, 88, (g, ox, oy) => {
    const { N, E, S, W } = prism(g, ox, oy, 2, 2, 6, "#6f9e57");
    const turbine = (bx, baseY, h) => {
      // tapered tower
      g.fillStyle = "#eceff2"; g.fillRect(bx - 2, baseY - h, 4, h);
      g.fillStyle = "#ccd2d8"; g.fillRect(bx - 2, baseY - h, 1.6, h); // shaded side
      g.fillStyle = "#b7bec5"; g.fillRect(bx - 3, baseY - 2, 6, 3);   // footing
      const hx = bx, hy = baseY - h;
      // three swept blades at 120°, a fixed rake (deterministic, no RNG)
      g.strokeStyle = "#f2f5f8"; g.lineWidth = 2.4; g.lineCap = "round";
      for (let k = 0; k < 3; k++) {
        const a = k * (Math.PI * 2 / 3) - 1.05;
        g.beginPath(); g.moveTo(hx, hy);
        g.lineTo(hx + Math.cos(a) * 17, hy + Math.sin(a) * 17); g.stroke();
      }
      g.lineCap = "butt";
      // nacelle / hub
      g.fillStyle = "#f6f8fb";
      g.beginPath(); g.arc(hx, hy, 3, 0, 7); g.fill();
      g.strokeStyle = "#9aa2aa"; g.lineWidth = 1; g.stroke();
    };
    const cx = (W[0] + E[0]) / 2, cy = (N[1] + S[1]) / 2 - 6;
    turbine(cx - 12, cy + 8, 58); // taller turbine, back-left
    turbine(cx + 12, cy + 14, 44); // shorter turbine, front-right
  });

  // School: red-brick block with a tall white bell-tower landmark, a cyan
  // book roof glyph (minimap #0cc), a small yard and a paved apron.
  school = withNight(2, 2, 72, (g, ox, oy) => {
    civicApron(g, ox, oy, 2, 2);
    const HT = 32, cn = insetCorners(ox, oy, 2, 2, 0.84), { W, S, E } = cn;
    // G9: the brick red would glow neon at 1.3 — the roof drops to 1.1
    prismFrom(g, cn, HT, "#b5533c", { top: shade("#b5533c", 1.1) });
    windows(g, up(W, 0), up(S, 0), HT, 3, 3, 0.7, "#ffe9a0");
    windows(g, up(S, 0), up(E, 0), HT, 3, 3, 0.7, "#ffe9a0");
    // G9: gravel field behind the parapet, speckled by the seeded RNG
    const [gx, gy] = roofDeckFrom(g, cn, HT, "#98907e", "rgba(52,40,30,.7)");
    g.save();
    g.beginPath();
    g.moveTo(gx, gy - HH * 2 * 0.68); g.lineTo(gx + HW * 2 * 0.68, gy);
    g.lineTo(gx, gy + HH * 2 * 0.68); g.lineTo(gx - HW * 2 * 0.68, gy);
    g.closePath(); g.clip();
    g.fillStyle = "#aaa290";
    for (let k = 0; k < 24; k++) g.fillRect(gx - 44 + R() * 88, gy - 20 + R() * 40, 2, 1);
    g.fillStyle = "#6e6656";
    for (let k = 0; k < 18; k++) g.fillRect(gx - 44 + R() * 88, gy - 20 + R() * 40, 2, 1);
    g.restore();
    // double doors tagged to the entrance world face (M32b)
    onFace(FE_PX, cn, (p0, p1) => {
      const dm = (t) => [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t];
      poly(g, [up(dm(0.42), 2), up(dm(0.58), 2), up(dm(0.58), 14), up(dm(0.42), 14)], "#e8e0d0");
      g.strokeStyle = "#6b3020"; g.lineWidth = 1;
      g.beginPath(); g.moveTo(...up(dm(0.5), 2)); g.lineTo(...up(dm(0.5), 14)); g.stroke();
    });
    // cyan open-book roof glyph on the front of the deck (findable)
    schoolBook(g, gx - 2, gy + 12);
    // tall white bell tower — the school's skyline landmark
    const tx = gx + 4, ty = gy - 4;
    g.fillStyle = "#ece4d4"; g.fillRect(tx - 7, ty - 40, 14, 40);
    g.fillStyle = "#d9d0bc"; g.fillRect(tx - 7, ty - 40, 6, 40);
    g.fillStyle = "#b8ad97"; g.fillRect(tx - 7, ty - 22, 14, 2); // string course
    g.fillStyle = "#2b2b30"; g.fillRect(tx - 5, ty - 34, 10, 9); // belfry arch
    g.fillStyle = "#e0b23c";
    g.beginPath(); g.arc(tx, ty - 29, 3, 0, 7); g.fill();        // the bell
    poly(g, [[tx - 9, ty - 40], [tx + 9, ty - 40], [tx, ty - 54]], "#7a3a2a"); // tower roof
    poly(g, [[tx, ty - 40], [tx + 9, ty - 40], [tx, ty - 54]], "#5f2c1f");
    g.strokeStyle = "#d8d8e0"; g.lineWidth = 1;                   // finial + pennant
    g.beginPath(); g.moveTo(tx, ty - 54); g.lineTo(tx, ty - 61); g.stroke();
    poly(g, [[tx, ty - 61], [tx + 8, ty - 58], [tx, ty - 55]], "#4860e0"); // GQ1 fix: was #3555ff (S=1.0, out-blued the lake)
  });

  // Hospital: white slab with a taller tower wing, a #d8d5ca helipad bearing
  // an iso "H", an iso red cross, and a paved apron.
  hospital = withNight(2, 2, 96, (g, ox, oy) => {
    civicApron(g, ox, oy, 2, 2);
    const HT = 62, cn = insetCorners(ox, oy, 2, 2, 0.84), { W, S, E } = cn;
    prismFrom(g, cn, HT, "#e6e3da");
    windows(g, up(W, 0), up(S, 0), HT, 5, 4, 0.75, "#bfe0f2", "#20242c", GLOW_COOL);
    windows(g, up(S, 0), up(E, 0), HT, 5, 4, 0.75, "#bfe0f2", "#20242c", GLOW_COOL);
    // emergency canopy tagged to the entrance world face (M32b)
    onFace(FE_PX, cn, (p0, p1) => {
      const dm = (t) => [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t];
      poly(g, [up(dm(0.3), 12), up(dm(0.7), 12), up(dm(0.7), 15), up(dm(0.3), 15)], "#c94040");
      poly(g, [up(dm(0.38), 2), up(dm(0.62), 2), up(dm(0.62), 12), up(dm(0.38), 12)], "#9fd8e8");
    });
    const [rx, ry] = roofDeckFrom(g, cn, HT, shade("#e6e3da", 0.82), "rgba(40,44,52,.7)");
    // helipad slab (#d8d5ca signature, G9) with a roof-plane white "H"
    const hp = [rx - 15, ry + 15];
    g.fillStyle = "#d8d5ca";
    g.beginPath(); g.ellipse(hp[0], hp[1], 18, 9, 0, 0, 7); g.fill();
    g.strokeStyle = "#a8a498"; g.lineWidth = 1; g.stroke();
    isoH(g, hp, 4, 3.2, 1.1, "#f4f6fb");
    // roof-plane red cross (sheared to the 2:1 diamond, no screen-axis rects)
    isoCross(g, [rx + 15, ry + 5], 7, 1.3, "#d8302c", "#7a1512");
    // tower wing behind the pad — the hospital's skyline landmark
    const wc = [rx + 4, ry - 13];
    const wcn = { N: ruv(wc, -6, -3), E: ruv(wc, 6, -3), S: ruv(wc, 6, 3), W: ruv(wc, -6, 3) };
    prismFrom(g, wcn, 22, "#dfe0d8", { top: "#eef0ea" });
    windows(g, up(wcn.W, 0), up(wcn.S, 0), 22, 3, 2, 0.7, "#bfe0f2", "#20242c", GLOW_COOL);
    windows(g, up(wcn.S, 0), up(wcn.E, 0), 22, 3, 2, 0.7, "#bfe0f2", "#20242c", GLOW_COOL);
  });

  /* ---- milestone rewards ---- */
  // Mayor's House: stately 1x1 manor with a flag and hedges
  mayor = mkSprite(1, 1, 40, (g, ox, oy) => {
    diamondPath(g, ox, oy);
    g.fillStyle = "#5fae57"; g.fill();
    g.strokeStyle = "rgba(0,0,0,.18)"; g.stroke();
    tinyHouse(g, ox - 2, oy - 2, 30, "#f2e7c9", "#2b4a8c");
    tinyHouse(g, ox + 16, oy + 4, 16, "#f2e7c9", "#2b4a8c");
    // hedges along the S edge
    g.fillStyle = "#1d6e2a";
    for (let k = 0; k < 4; k++) {
      g.beginPath(); g.ellipse(ox - 20 + k * 7, oy + 9 + k * 1.5, 3.4, 2.2, 0, 0, 7); g.fill();
    }
    // flagpole + golden city flag
    g.strokeStyle = "#d8d8e0"; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(ox - 22, oy + 2); g.lineTo(ox - 22, oy - 34); g.stroke();
    g.fillStyle = "#ffd94e";
    g.beginPath(); g.moveTo(ox - 22, oy - 34); g.lineTo(ox - 10, oy - 31);
    g.lineTo(ox - 22, oy - 27); g.closePath(); g.fill();
  });

  // Stadium: 2x2 bowl with a green pitch and floodlights
  stadium = mkSprite(2, 2, 52, (g, ox, oy) => {
    const { N, E, S, W } = prism(g, ox, oy, 2, 2, 22, "#b8b2a4");
    const cx = (E[0] + W[0]) / 2, cy = (N[1] + S[1]) / 2 - 22;
    // concrete bowl rim
    g.fillStyle = "#cac4b6";
    g.beginPath(); g.ellipse(cx, cy, 52, 24, 0, 0, 7); g.fill();
    g.strokeStyle = "#7d7869"; g.lineWidth = 1.5; g.stroke();
    // seating rings
    g.fillStyle = "#c0392b";
    g.beginPath(); g.ellipse(cx, cy, 44, 20, 0, 0, 7); g.fill();
    g.fillStyle = "#2f5f9e";
    g.beginPath(); g.ellipse(cx, cy, 37, 16.5, 0, 0, 7); g.fill();
    // the pitch
    g.fillStyle = "#2f9c3f";
    g.beginPath(); g.ellipse(cx, cy, 28, 12, 0, 0, 7); g.fill();
    g.strokeStyle = "#e8f6e8"; g.lineWidth = 1;
    g.beginPath(); g.ellipse(cx, cy, 8, 3.6, 0, 0, 7); g.stroke();
    g.beginPath(); g.moveTo(cx - 28, cy); g.lineTo(cx + 28, cy); g.stroke();
    // floodlight masts
    for (const [fx, fy] of [[cx - 46, cy - 8], [cx + 46, cy - 8], [cx - 30, cy + 16], [cx + 30, cy + 16]]) {
      g.strokeStyle = "#55565e"; g.lineWidth = 2;
      g.beginPath(); g.moveTo(fx, fy); g.lineTo(fx, fy - 22); g.stroke();
      g.fillStyle = "#fff7c8"; g.fillRect(fx - 4, fy - 27, 8, 5);
    }
  });

  /* ---- M28: arcologies & wonder landmarks ----
     Seven large self-powered mega-structures, baked in the per-facing family
     exactly like coal/stadium so cam.r rotation + the billboard pin apply for
     free, and the size-agnostic multi-tile render path (render.js) draws the
     3x3/4x4 footprints with zero render-loop change. Each carries a withNight
     glow bake so city.powered[anchor]===1 lights arco windows / landmark
     floodlights after dark. Wrapped in a DEDICATED seeded stream (gas-plant
     idiom) so their windows() pane-lighting never shifts the shared ART_RNG —
     every sprite baked before/after (and every prior facing) stays byte-
     identical. prismFrom() records SNOWSPEC, so makeWinter() snow-caps them. */
  {
    const megaRng = mulberry32((0x2AC0DE ^ (BR * 0x9E3779B1)) >>> 0);
    const prevRng = ART_RNG; ART_RNG = megaRng;
    // face helper (g passed in — GLOWG/up/windows are module-level; raise()
    // was hoisted to module scope for GQ5 and is byte-equivalent here)
    const facewin = (g, cn, ht, rows, cols, col, glow, gf) => {
      windows(g, cn.W, cn.S, ht, rows, cols, 0.55, col, "#20242c", glow, gf);
      windows(g, cn.S, cn.E, ht, rows, cols, 0.55, col, "#20242c", glow, gf);
    };
    const glowDot = (x, y, r, col) => {
      if (!GLOWG) return;
      GLOWG.fillStyle = col; GLOWG.beginPath(); GLOWG.arc(x, y, r, 0, 7); GLOWG.fill();
    };

    // ---- Plymouth Arcology (3x3): a stepped residential ziggurat, warm lights ----
    plymouth = withNight(3, 3, 150, (g, ox, oy) => {
      const foot = corners(ox, oy, 3, 3);
      prismFrom(g, foot, 44, "#8b90a0");
      facewin(g, foot, 44, 4, 6, "#ffe9a0", GLOW_WARM, 0.5);
      const t2 = raise(insetCorners(ox, oy, 3, 3, 0.7), 44);
      prismFrom(g, t2, 40, "#989dad");
      facewin(g, t2, 40, 3, 5, "#ffe9a0", GLOW_WARM, 0.5);
      const t3 = raise(insetCorners(ox, oy, 3, 3, 0.42), 84);
      prismFrom(g, t3, 30, "#a6abbb");
      facewin(g, t3, 30, 2, 3, "#ffe9a0", GLOW_WARM, 0.5);
      const tx = t3.N[0], ty = t3.N[1] - 30;
      g.strokeStyle = "#c4c8d2"; g.lineWidth = 2;
      g.beginPath(); g.moveTo(tx, ty); g.lineTo(tx, ty - 22); g.stroke();
      g.fillStyle = "#ff5a5a"; g.beginPath(); g.arc(tx, ty - 22, 2.4, 0, 7); g.fill();
      glowDot(tx, ty - 22, 4, "#ff8a8a");
    });

    // ---- Forest Arcology (3x3): a green glass biodome full of trees ----
    forestArc = withNight(3, 3, 130, (g, ox, oy) => {
      const foot = corners(ox, oy, 3, 3);
      prismFrom(g, foot, 30, "#6f7a68");
      facewin(g, foot, 30, 2, 6, "#bfeecc", GLOW_COOL, 0.4);
      const cx = ox, cy = (foot.N[1] + foot.S[1]) / 2 - 30 - 4, rx = 66, ry = 40;
      g.fillStyle = "#3f7d55";
      g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI, true); g.closePath(); g.fill();
      g.strokeStyle = "rgba(180,240,200,.5)"; g.lineWidth = 1;
      for (let k = 1; k <= 3; k++) { g.beginPath(); g.ellipse(cx, cy, k * 16, ry, 0, 0, Math.PI, true); g.stroke(); }
      g.beginPath(); g.moveTo(cx - rx, cy); g.lineTo(cx + rx, cy); g.stroke();
      drawTree(g, cx - 24, cy - 4, 12, 1); drawTree(g, cx + 4, cy - 14, 14, 1.1); drawTree(g, cx + 26, cy - 2, 11, 0.9);
      glowDot(cx, cy - 10, 24, "#8fe0a8");
    });

    // ---- Darco Arcology (4x4): a dark brutalist megatower, sodium windows ----
    darco = withNight(4, 4, 190, (g, ox, oy) => {
      const foot = corners(ox, oy, 4, 4);
      prismFrom(g, foot, 60, "#3a3d47");
      facewin(g, foot, 60, 6, 8, "#ffcf6e", GLOW_SODIUM, 0.5);
      const t2 = raise(insetCorners(ox, oy, 4, 4, 0.62), 60);
      prismFrom(g, t2, 70, "#444753");
      facewin(g, t2, 70, 6, 5, "#ffcf6e", GLOW_SODIUM, 0.5);
      const t3 = raise(insetCorners(ox, oy, 4, 4, 0.3), 130);
      prismFrom(g, t3, 24, "#50535f");
      for (const p of [t3.E, t3.W]) {
        const x = p[0], y = p[1] - 24;
        g.fillStyle = "#ff4a4a"; g.beginPath(); g.arc(x, y, 2.4, 0, 7); g.fill();
        glowDot(x, y, 4, "#ff8a8a");
      }
    });

    // ---- Launch Arcology (4x4): rooftop launch pad + rocket (the SC2K icon) ----
    launch = withNight(4, 4, 210, (g, ox, oy) => {
      const foot = corners(ox, oy, 4, 4);
      prismFrom(g, foot, 46, "#9aa2ae");
      facewin(g, foot, 46, 4, 8, "#dce9ff", GLOW_COOL, 0.55);
      const cx = ox, cy = (foot.N[1] + foot.S[1]) / 2 - 46;
      g.fillStyle = "#6b7078"; g.beginPath(); g.ellipse(cx, cy, 54, 26, 0, 0, 7); g.fill();
      g.strokeStyle = "#3a3d44"; g.lineWidth = 2; g.stroke();
      g.strokeStyle = "#8a9098"; g.lineWidth = 2;
      for (const sx of [-30, 30]) { g.beginPath(); g.moveTo(cx + sx, cy + 6); g.lineTo(cx + sx * 0.5, cy - 70); g.stroke(); }
      const ry0 = cy - 4, H = 96;
      g.fillStyle = "#eef2f6"; g.beginPath();
      g.moveTo(cx - 9, ry0); g.lineTo(cx - 9, ry0 - H + 22);
      g.quadraticCurveTo(cx, ry0 - H - 8, cx + 9, ry0 - H + 22);
      g.lineTo(cx + 9, ry0); g.closePath(); g.fill();
      g.fillStyle = "#c9d2da"; g.fillRect(cx - 9, ry0 - H + 22, 4, H - 22);
      g.fillStyle = "#d23b3b"; g.fillRect(cx - 9, ry0 - 24, 18, 8);
      g.fillStyle = "#b7bec6";
      g.beginPath(); g.moveTo(cx - 9, ry0 - 4); g.lineTo(cx - 20, ry0 + 6); g.lineTo(cx - 9, ry0 - 16); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(cx + 9, ry0 - 4); g.lineTo(cx + 20, ry0 + 6); g.lineTo(cx + 9, ry0 - 16); g.closePath(); g.fill();
      glowDot(cx, ry0 + 4, 10, "#ff9a3a");
      g.fillStyle = "#ff5a5a"; g.beginPath(); g.arc(cx, ry0 - H - 2, 2.4, 0, 7); g.fill();
      glowDot(cx, ry0 - H - 2, 4, "#ff8a8a");
    });

    // ---- Statue of Liberty (3x3): pedestal + verdigris figure + glowing torch ----
    statue = withNight(3, 3, 160, (g, ox, oy) => {
      const foot = corners(ox, oy, 3, 3);
      prismFrom(g, foot, 30, "#7d7360");
      const ped = raise(insetCorners(ox, oy, 3, 3, 0.5), 30);
      prismFrom(g, ped, 40, "#9a8f78");
      const cx = ox, ty = ped.N[1] - 40;
      g.fillStyle = "#6fbfa6";
      g.beginPath(); g.moveTo(cx - 10, ty); g.lineTo(cx + 10, ty);
      g.lineTo(cx + 6, ty - 46); g.lineTo(cx - 6, ty - 46); g.closePath(); g.fill();
      g.fillStyle = "#5fae95"; g.fillRect(cx, ty - 46, 4, 46);
      g.fillStyle = "#6fbfa6"; g.beginPath(); g.arc(cx, ty - 52, 5, 0, 7); g.fill();
      g.strokeStyle = "#6fbfa6"; g.lineWidth = 1.5;
      for (let k = -2; k <= 2; k++) { g.beginPath(); g.moveTo(cx, ty - 56); g.lineTo(cx + k * 4, ty - 64); g.stroke(); }
      g.lineWidth = 3;
      g.beginPath(); g.moveTo(cx + 4, ty - 42); g.lineTo(cx + 16, ty - 64); g.stroke();
      g.fillStyle = "#ffd24a"; g.beginPath(); g.arc(cx + 16, ty - 68, 4, 0, 7); g.fill();
      glowDot(cx + 16, ty - 68, 8, "#ffe08a");
    });

    // ---- Eiffel Tower (3x3): tapering lattice with a beacon + floodlit wash ----
    eiffel = withNight(3, 3, 200, (g, ox, oy) => {
      const foot = corners(ox, oy, 3, 3);
      poly(g, [foot.N, foot.E, foot.S, foot.W], "#6f7a5f");
      const baseY = (foot.N[1] + foot.S[1]) / 2 + 18, apexY = baseY - 150, legHalf = 44;
      const col = "#8a6a3a", colS = "#6f5730";
      g.fillStyle = col;
      g.beginPath();
      g.moveTo(ox - legHalf, baseY); g.lineTo(ox + legHalf, baseY);
      g.lineTo(ox + 7, apexY); g.lineTo(ox - 7, apexY); g.closePath(); g.fill();
      g.save(); g.clip();
      g.strokeStyle = colS; g.lineWidth = 1;
      for (let yy = 0; yy < 1; yy += 0.08) {
        const w0 = legHalf * (1 - yy) + 7 * yy, y0 = baseY + (apexY - baseY) * yy;
        const y1 = baseY + (apexY - baseY) * Math.min(1, yy + 0.08);
        g.beginPath(); g.moveTo(ox - w0, y0); g.lineTo(ox + w0, y1); g.stroke();
        g.beginPath(); g.moveTo(ox + w0, y0); g.lineTo(ox - w0, y1); g.stroke();
      }
      g.restore();
      g.fillStyle = "#7a5f34";
      g.fillRect(ox - 30, baseY - 48, 60, 5);
      g.fillRect(ox - 16, baseY - 94, 32, 4);
      g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); g.moveTo(ox, apexY); g.lineTo(ox, apexY - 16); g.stroke();
      g.fillStyle = "#ffd24a"; g.beginPath(); g.arc(ox, apexY - 18, 2.6, 0, 7); g.fill();
      glowDot(ox, apexY - 18, 5, "#ffe08a");
      glowDot(ox, baseY - 70, 30, "#ffcf7a");
    });

    // ---- Great Pyramid (4x4): stone pyramid with a gilded, glowing capstone ----
    pyramid = withNight(4, 4, 150, (g, ox, oy) => {
      const foot = corners(ox, oy, 4, 4);
      const apex = [ox, (foot.N[1] + foot.S[1]) / 2 - 120];
      poly(g, [foot.W, foot.S, apex], "#c9a86a");
      poly(g, [foot.S, foot.E, apex], "#e0c184");
      g.strokeStyle = "rgba(120,90,40,.35)"; g.lineWidth = 1;
      for (let k = 1; k < 8; k++) {
        const t = k / 8;
        const lw = [foot.W[0] + (apex[0] - foot.W[0]) * t, foot.W[1] + (apex[1] - foot.W[1]) * t];
        const ls = [foot.S[0] + (apex[0] - foot.S[0]) * t, foot.S[1] + (apex[1] - foot.S[1]) * t];
        const le = [foot.E[0] + (apex[0] - foot.E[0]) * t, foot.E[1] + (apex[1] - foot.E[1]) * t];
        g.beginPath(); g.moveTo(lw[0], lw[1]); g.lineTo(ls[0], ls[1]); g.lineTo(le[0], le[1]); g.stroke();
      }
      g.fillStyle = "#f0e6c8";
      g.beginPath(); g.moveTo(apex[0], apex[1]); g.lineTo(apex[0] - 8, apex[1] + 16); g.lineTo(apex[0] + 8, apex[1] + 16); g.closePath(); g.fill();
      glowDot(apex[0], apex[1] + 6, 10, "#ffe9a0");
    });

    ART_RNG = prevRng;
  }

  /* ---- GQ10: special buildings gap-fill (nuke / airport / seaport) ----
     Three more large structures in the exact M28 discipline: baked in the
     per-facing family, registered at the literal END of every seasonal set so
     all existing evaluation order is untouched, and wrapped in a DEDICATED
     seeded stream (gas-plant / mega snapshot-swap idiom, BR folded into the
     seed) so windows()/any RNG here consumes ONLY the side stream — every
     pre-existing sprite (all facings, all seasons, night/pool layers) stays
     byte-identical. prismFrom records SNOWSPEC, so makeWinter snow-caps them. */
  {
    const gq10Rng = mulberry32((0x6110A ^ (BR * 0x9E3779B1)) >>> 0);
    const prevRng = ART_RNG; ART_RNG = gq10Rng;
    const glowDot = (x, y, r, col) => {
      if (!GLOWG) return;
      GLOWG.fillStyle = col; GLOWG.beginPath(); GLOWG.arc(x, y, r, 0, 7); GLOWG.fill();
    };

    // ---- Nuclear plant (3x3): twin cooling towers + containment dome +
    //      turbine hall; radiation-yellow trefoil + hazard chevrons ----
    nuke = withNight(3, 3, 120, (g, ox, oy) => {
      civicApron(g, ox, oy, 3, 3);
      const foot = corners(ox, oy, 3, 3);
      const cx = ox, cy = (foot.N[1] + foot.S[1]) / 2;
      // waisted hyperboloid cooling tower (quadraticCurveTo flanks, lip
      // highlight + interior shadow, red aviation beacon on the lip)
      const tower = (bx, by, h, wb) => {
        const wt = wb * 0.78, ww = wb * 0.58, wy = by - h * 0.62;
        g.fillStyle = "#c2c6cd";
        g.beginPath();
        g.moveTo(bx - wb / 2, by);
        g.quadraticCurveTo(bx - ww / 2 - 2, wy, bx - wt / 2, by - h);
        g.lineTo(bx + wt / 2, by - h);
        g.quadraticCurveTo(bx + ww / 2 + 2, wy, bx + wb / 2, by);
        g.closePath(); g.fill();
        g.fillStyle = "#a9aeb8"; // shaded W flank
        g.beginPath();
        g.moveTo(bx - wb / 2, by);
        g.quadraticCurveTo(bx - ww / 2 - 2, wy, bx - wt / 2, by - h);
        g.lineTo(bx - wt / 2 + wt * 0.3, by - h);
        g.quadraticCurveTo(bx - ww / 2 + ww * 0.28 - 2, wy, bx - wb / 2 + wb * 0.3, by);
        g.closePath(); g.fill();
        g.fillStyle = "#8b9099"; // interior shadow inside the lip
        g.beginPath(); g.ellipse(bx, by - h, wt / 2, wt / 8, 0, 0, 7); g.fill();
        g.strokeStyle = "#dde0e6"; g.lineWidth = 1.6; // sunlit lip
        g.beginPath(); g.ellipse(bx, by - h, wt / 2, wt / 8, 0, Math.PI, Math.PI * 2); g.stroke();
        g.fillStyle = "#ff5a5a";
        g.beginPath(); g.arc(bx + wt / 2 - 1, by - h - 1, 1.8, 0, 7); g.fill();
        glowDot(bx + wt / 2 - 1, by - h - 1, 3.5, "#ff8a8a");
      };
      tower(cx - 38, cy - 12, 64, 30);
      tower(cx + 2, cy - 22, 56, 26);
      // containment dome on the E side
      const dx0 = cx + 34, dy0 = cy - 6;
      g.fillStyle = "#d7d9de";
      g.beginPath(); g.arc(dx0, dy0, 17, Math.PI, Math.PI * 2); g.fill();
      g.beginPath(); g.ellipse(dx0, dy0, 17, 6.5, 0, 0, 7); g.fill();
      g.fillStyle = "#b6bac2"; // shaded E cheek
      g.beginPath(); g.ellipse(dx0, dy0, 17, 6.5, 0, -0.35, Math.PI * 0.55); g.fill();
      g.strokeStyle = "#8f939c"; g.lineWidth = 1;
      g.beginPath(); g.ellipse(dx0, dy0, 17, 6.5, 0, 0, 7); g.stroke();
      g.fillStyle = lighten("#d7d9de", 0.4);
      g.beginPath(); g.ellipse(dx0 - 6, dy0 - 9, 4.5, 6.5, -0.5, 0, 7); g.fill();
      glowDot(dx0, dy0 - 8, 9, "#ffd9a0"); // faint warm dome wash
      // low turbine hall front-center (windows draw from the gq10 side stream)
      const hc = [cx - 14, cy + 14];
      const hcn = { N: ruv(hc, -10, -5), E: ruv(hc, 10, -5), S: ruv(hc, 10, 5), W: ruv(hc, -10, 5) };
      prismFrom(g, hcn, 20, "#b9bcc4");
      windows(g, up(hcn.W, 0), up(hcn.S, 0), 20, 1, 4, 0.6, "#cfe6f2", "#20242c", GLOW_COOL, 0.6);
      windows(g, up(hcn.S, 0), up(hcn.E, 0), 20, 1, 3, 0.6, "#cfe6f2", "#20242c", GLOW_COOL, 0.6);
      // SIGNATURE ACCENT: radiation-yellow trefoil roundel on the hall's S face
      const tfx = (hcn.S[0] + hcn.E[0]) / 2, tfy = (hcn.S[1] + hcn.E[1]) / 2 - 10;
      g.fillStyle = "#ffd400";
      g.beginPath(); g.arc(tfx, tfy, 5, 0, 7); g.fill();
      g.fillStyle = "#2b2b1c";
      for (let k = 0; k < 3; k++) {
        const a = -Math.PI / 2 + k * (Math.PI * 2 / 3);
        g.beginPath(); g.moveTo(tfx, tfy);
        g.arc(tfx, tfy, 4.4, a - 0.5, a + 0.5); g.closePath(); g.fill();
      }
      g.beginPath(); g.arc(tfx, tfy, 1.1, 0, 7); g.fill();
      // yellow hazard chevrons on the apron toward the S corner
      g.strokeStyle = "#ffd400"; g.lineWidth = 2.5;
      for (let k = 0; k < 5; k++) {
        const sx = foot.S[0] - 24 + k * 9, sy = foot.S[1] - 16;
        g.beginPath(); g.moveTo(sx, sy + 4.5); g.lineTo(sx + 5, sy); g.stroke();
      }
    });

    // ---- Airport (4x4): tarmac slab, marked runway, glass-band terminal,
    //      control tower with teal cab (>=70px over the N corner), parked
    //      aircraft + windsock; runway edge lights on the glow layer ----
    // GP2 R2: the noise cone (stampAirportNoise) runs along WORLD X, which
    // projects to screen slope +1/2 at even cam.r but -1/2 at odd cam.r. The
    // runway art must track it, so at odd BR every roof-plane point goes
    // through A (a u/v swap = reflection about the sprite's vertical
    // centerline — ruv keeps swapped points inside the (w+h)*HW canvas) and
    // box corners through boxUV (relabeled so N stays topmost / E rightmost,
    // preserving prismFrom's screen-welded SW/SE sun shading, M32b). Both are
    // identity at even BR, so facings 0 and 2 stay byte-identical. Pure
    // geometry — ZERO RNG draws, so every downstream bake is untouched.
    airport = withNight(4, 4, 90, (g, ox, oy) => {
      const foot = corners(ox, oy, 4, 4);
      const rc = [ox, (foot.N[1] + foot.S[1]) / 2];
      const odd = (BR & 1) === 1;
      const A = (c, u, v) => odd ? ruv(c, v, u) : ruv(c, u, v);
      const boxUV = (c, hu, hv) => odd
        ? { N: ruv(c, -hv, -hu), E: ruv(c, hv, -hu), S: ruv(c, hv, hu), W: ruv(c, -hv, hu) }
        : { N: ruv(c, -hu, -hv), E: ruv(c, hu, -hv), S: ruv(c, hu, hv), W: ruv(c, -hu, hv) };
      poly(g, [foot.N, foot.E, foot.S, foot.W], "#3e4148", "rgba(0,0,0,.35)");
      const q = (u0, u1, v0, v1, fill) =>
        poly(g, [A(rc, u0, v0), A(rc, u1, v0), A(rc, u1, v1), A(rc, u0, v1)], fill);
      q(-20, 16, -22, -10, "#4a4e57"); // concrete apron by the terminal
      q(-27, 27, 6, 15, "#33363d");    // the runway strip (long world-X diagonal)
      g.strokeStyle = "#f2f2f4"; g.lineWidth = 2;
      for (const ue of [-25, 25]) // painted threshold bars at both ends
        for (let k = 0; k < 4; k++) {
          const a = A(rc, ue, 7 + k * 2), b = A(rc, ue + (ue < 0 ? 2 : -2), 7 + k * 2);
          g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
        }
      for (let u = -20; u <= 18; u += 5) { // dashed centerline
        const a = A(rc, u, 10.5), b = A(rc, u + 2.4, 10.5);
        g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
      }
      g.strokeStyle = "#e8c33a"; g.lineWidth = 1.5; // yellow taxiway line
      const t0 = A(rc, -6, -10), t1 = A(rc, -6, 6);
      g.beginPath(); g.moveTo(t0[0], t0[1]); g.lineTo(t1[0], t1[1]); g.stroke();
      // glass-band terminal prism along the N edge
      const tc = A(rc, -2, -16);
      const tcn = boxUV(tc, 14, 4);
      prismFrom(g, tcn, 18, "#b9bfc8");
      windows(g, up(tcn.W, 0), up(tcn.S, 0), 18, 1, 6, 0.7, "#4fd4e4", "#1b3f46", "#49e0f0", 0.8);
      windows(g, up(tcn.S, 0), up(tcn.E, 0), 18, 1, 4, 0.7, "#4fd4e4", "#1b3f46", "#49e0f0", 0.8);
      g.strokeStyle = "#2ec8dc"; g.lineWidth = 2.5; // SIGNATURE teal fascia band
      g.beginPath(); g.moveTo(...up(tcn.W, 14)); g.lineTo(...up(tcn.S, 14)); g.lineTo(...up(tcn.E, 14)); g.stroke();
      // control tower: thin shaft + wide teal glass cab + rotating beacon
      // (screen-space furniture: repositioned across the centerline at odd
      // facings, silhouette itself untouched)
      const bx = ox + (odd ? 28 : -28), by = rc[1] - 16;
      g.fillStyle = "#cdd2d8"; g.fillRect(bx - 3.5, by - 100, 7, 100);
      g.fillStyle = "#aab0b8"; g.fillRect(bx - 3.5, by - 100, 3, 100);
      g.fillStyle = "#9aa0a8"; g.fillRect(bx - 7, by - 104, 14, 5);   // collar
      g.fillStyle = "#20c4d8"; g.fillRect(bx - 9, by - 116, 18, 12);  // octagonal glass cab
      g.fillStyle = "#137a88"; g.fillRect(bx - 9, by - 116, 4, 12);   // shaded cab cheek
      g.strokeStyle = "#0f5560"; g.lineWidth = 1;                     // mullions
      for (const mx of [-4, 1, 5]) {
        g.beginPath(); g.moveTo(bx + mx, by - 116); g.lineTo(bx + mx, by - 104); g.stroke();
      }
      g.fillStyle = "#e8eaee"; g.fillRect(bx - 10, by - 119, 20, 3);  // cap slab
      g.strokeStyle = "#c8ccd2"; g.lineWidth = 1.2;                   // beacon mast
      g.beginPath(); g.moveTo(bx, by - 119); g.lineTo(bx, by - 126); g.stroke();
      g.fillStyle = "#ff5a5a"; g.beginPath(); g.arc(bx, by - 128, 2, 0, 7); g.fill();
      glowDot(bx, by - 128, 4, "#ff8a8a");
      glowDot(bx, by - 110, 8, "#49e0f0"); // lit cab
      // parked white aircraft silhouette on the apron (anchored on the
      // swapped apron at odd facings, x-deltas mirrored to match)
      const sx = odd ? -1 : 1;
      const px0 = ox + sx * 68, py0 = rc[1] - 4;
      g.fillStyle = "#f2f4f6";
      g.beginPath(); g.ellipse(px0, py0, 9, 2.6, sx * 0.46, 0, 7); g.fill();
      poly(g, [[px0 - 2 * sx, py0 - 5], [px0 + 3 * sx, py0 + 4], [px0 - 1 * sx, py0 + 5], [px0 - 6 * sx, py0 - 4]], "#e4e8ec");
      poly(g, [[px0 - 8 * sx, py0 - 6], [px0 - 4 * sx, py0 - 3], [px0 - 9 * sx, py0 - 1]], "#cdd3da");
      // orange windsock at the runway threshold
      const wsk = A(rc, -24, 3);
      g.strokeStyle = "#d8dade"; g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(wsk[0], wsk[1]); g.lineTo(wsk[0], wsk[1] - 12); g.stroke();
      poly(g, [[wsk[0], wsk[1] - 12], [wsk[0] + 9, wsk[1] - 10], [wsk[0], wsk[1] - 7]], "#ff7a1a");
      // runway edge lights, both rows, on the glow layer only
      for (let u = -24; u <= 24; u += 6) {
        const a = A(rc, u, 5.6), b = A(rc, u, 15.4);
        glowDot(a[0], a[1], 1.4, "#ffe9a0");
        glowDot(b[0], b[1], 1.4, "#ffe9a0");
      }
    });

    // ---- Seaport (3x3): concrete quay, clerestory-roof warehouse, stacked
    //      containers, red-orange gantry crane with a jib out over the water,
    //      bollards + mooring line; sodium quay floodlights on the glow layer ----
    seaport = withNight(3, 3, 80, (g, ox, oy) => {
      const foot = corners(ox, oy, 3, 3);
      const rc = [ox, (foot.N[1] + foot.S[1]) / 2];
      poly(g, [foot.N, foot.E, foot.S, foot.W], "#9aa0a6", "rgba(0,0,0,.3)");
      // quay edge beam + bollards + a slack mooring line along the SW water edge
      const eW = foot.W, eS = foot.S;
      g.strokeStyle = "#5d646c"; g.lineWidth = 3;
      g.beginPath(); g.moveTo(eW[0], eW[1]); g.lineTo(eS[0], eS[1]); g.stroke();
      const bol = (t) => [eW[0] + (eS[0] - eW[0]) * t, eW[1] + (eS[1] - eW[1]) * t - 2];
      g.fillStyle = "#2e3238";
      for (let k = 1; k <= 4; k++) {
        const p = bol(k / 5);
        g.beginPath(); g.arc(p[0], p[1], 1.6, 0, 7); g.fill();
      }
      const m0 = bol(0.4), m1 = bol(0.6);
      g.strokeStyle = "#3a3f45"; g.lineWidth = 1;
      g.beginPath(); g.moveTo(m0[0], m0[1]);
      g.quadraticCurveTo((m0[0] + m1[0]) / 2, (m0[1] + m1[1]) / 2 + 5, m1[0], m1[1]); g.stroke();
      // warehouse shed (NE) with a raised clerestory monitor roof
      const sc = ruv(rc, 7, -7);
      const scn = { N: ruv(sc, -8, -5), E: ruv(sc, 8, -5), S: ruv(sc, 8, 5), W: ruv(sc, -8, 5) };
      prismFrom(g, scn, 14, "#a8927a");
      const ridge = { N: ruv(sc, -8, -1.5), E: ruv(sc, 8, -1.5), S: ruv(sc, 8, 1.5), W: ruv(sc, -8, 1.5) };
      prismFrom(g, raise(ridge, 14), 6, "#b8a086");
      // roller door on the shed's SW face
      const dm = (t) => [scn.W[0] + (scn.S[0] - scn.W[0]) * t, scn.W[1] + (scn.S[1] - scn.W[1]) * t];
      poly(g, [up(dm(0.3), 1), up(dm(0.7), 1), up(dm(0.7), 10), up(dm(0.3), 10)], "#6f6154");
      // stacked containers from a fixed palette
      const cbox = (bc) => ({ N: ruv(bc, -4, -2), E: ruv(bc, 4, -2), S: ruv(bc, 4, 2), W: ruv(bc, -4, 2) });
      const b1 = cbox([ox - 30, rc[1] + 20]);
      prismFrom(g, b1, 8, "#3b6ea8");
      prismFrom(g, raise(b1, 8), 7, "#b0533f");
      prismFrom(g, cbox([ox - 11, rc[1] + 28]), 8, "#3f8a4f");
      // SIGNATURE ACCENT: red-orange gantry crane, jib overhanging the water
      g.strokeStyle = "#e04a28"; g.lineWidth = 3; g.lineCap = "round";
      g.beginPath(); g.moveTo(ox - 32, rc[1]); g.lineTo(ox - 32, rc[1] - 32); g.stroke();      // W leg
      g.beginPath(); g.moveTo(ox - 8, rc[1] + 12); g.lineTo(ox - 8, rc[1] - 20); g.stroke();   // E leg
      g.beginPath(); g.moveTo(ox - 40, rc[1] - 36); g.lineTo(ox + 2, rc[1] - 15); g.stroke();  // bridge
      g.beginPath(); g.moveTo(ox - 32, rc[1] - 32); g.lineTo(ox - 60, rc[1] - 18); g.stroke(); // jib
      g.lineWidth = 2;
      g.beginPath(); g.moveTo(ox - 32, rc[1] - 42); g.lineTo(ox - 60, rc[1] - 18); g.stroke(); // jib tie
      g.beginPath(); g.moveTo(ox - 32, rc[1] - 32); g.lineTo(ox - 32, rc[1] - 42); g.stroke(); // mast
      g.lineCap = "butt";
      g.strokeStyle = "#3a3f45"; g.lineWidth = 1; // trolley cable + spreader
      g.beginPath(); g.moveTo(ox - 52, rc[1] - 22); g.lineTo(ox - 52, rc[1] - 6); g.stroke();
      g.fillStyle = "#e04a28"; g.fillRect(ox - 54, rc[1] - 6, 4, 3);
      g.fillStyle = "#ff5a5a"; // crane-tip beacon
      g.beginPath(); g.arc(ox - 60, rc[1] - 19, 1.6, 0, 7); g.fill();
      glowDot(ox - 60, rc[1] - 19, 3, "#ff8a8a");
      // sodium floodlight masts + quay light pools (glow layer)
      g.strokeStyle = "#4a4f55"; g.lineWidth = 1.5;
      for (const [mx, my] of [[ox + 22, rc[1] + 20], [ox + 54, rc[1] + 4]]) {
        g.beginPath(); g.moveTo(mx, my); g.lineTo(mx, my - 22); g.stroke();
        g.fillStyle = "#ffe2b0"; g.fillRect(mx - 3, my - 25, 6, 3);
        if (GLOWG) {
          GLOWG.fillStyle = GLOW_SODIUM;
          GLOWG.beginPath(); GLOWG.ellipse(mx, my + 3, 13, 6, 0, 0, 7); GLOWG.fill();
        }
      }
    });

    ART_RNG = prevRng;
  }

  /* ---- GP5b: clean high-tech industry families (i1c / i2c / i3c) ----
     The sprite half of the eduLevel payoff: when city.isCleanInd() flips,
     spriteFor swaps the whole ZI ladder to these families. APPENDED AFTER
     every existing bake and drawn ONLY under a forked mulberry32 seed swapped
     in/out of ART_RNG (the i2/gasRng idiom above), so every shipped sprite —
     all facings, all seasons, night/pool layers — stays byte-identical (C5).

     PALETTE (GQ3 hue budget): jade / sea-green anodized panel, hue 142-156,
     S .19-.30, lightness DECLINING by density (.60/.50/.40 — the MN3 non-hue
     cue). Margins: >=25deg to commercial teal/cyan (c 180-224), >=47deg to
     dirty industrial olive (i 70-95), >=97deg to the residential warm band
     (r 8-45), >=25deg to the grass family (117). IC_ROOF is a DARK saturated
     emerald metal cap (L .26-.30) — the clean family's roof/trim punch, the
     rust I_ROOF analogue — which also keeps the tops far from ROOF_SNOW so
     the G14 winter cap stays a visible cue and the district never whites out.

     NIGHT (G1): the clean ladder keeps the certified SODIUM industrial glow
     for panes AND yard pools. Education changes what industry BUILDS, never
     what zone it IS — ZI must still read warm against commercial's cool
     #a8ccf8 after dark, at every eduLevel.

     SILHOUETTE (rubric: archetypes distinguishable by outline alone): each
     family remasses on variant parity, like the dirty ladder's A8/A9 —
     i1c monitor-roof shed + silo vs flat lab box + solar deck; i2c stepped
     rear-block campus vs full-lot block + cooling drum; i3c setback tier
     tower vs slab + drum. The loading dock (onFace, the i1 idiom) stays on
     level 1 so clean industry still reads as industry, not as an office. */
  const i1c = [], i2c = [], i3c = [];
  {
    const cleanRng = mulberry32((0xC1EA12 ^ (BR * 0x9E3779B1)) >>> 0);
    const prevRng = ART_RNG; ART_RNG = cleanRng;
    const Rc = () => cleanRng();
    const i1cBase = ["#83af96", "#89ae9c", "#7cb18f", "#8ab2a1", "#7aae92"];
    const i2cBase = ["#619e7c", "#689c84", "#5b9f75", "#68a189", "#5b9a79"];
    const i3cBase = ["#4a8264", "#4f826b", "#46815d", "#4f8771", "#457d61"];
    const IC_ROOF = ["#2b644d", "#2f6553", "#276247", "#2f6a54", "#275d46"];
    // lighter same-hue tones for the secondary masses (lantern / wing / podium).
    // Hex literals, never shade()/lighten() — those return rgb() strings and
    // zoneFaces()/faceL() parse a HEX, so a computed tone would blacken a face.
    const IC_LANT = ["#98bda8", "#9ebdae", "#93bea3", "#9fc1b2", "#90bba4"];
    const IC_WING = ["#7db094", "#84ae9a", "#77b18d", "#85b29f", "#75ae90"];
    const IC_PODM = ["#5b9f7b", "#619e83", "#569f73", "#62a389", "#559b78"];
    const IC_TRIM = "#3dc296", IC_TRIM_LO = "#307e64";
    const IC_LIT = "#ffe1a6", IC_DARK = "#1b2a25";
    const IC_MET = "#b9c6c0", IC_MET_HI = "#d7e0da", IC_MET_LO = "#7f8f88";
    // rooftop chiller bank: n light-metal units stepped along a tile diagonal
    const chillers = (g, cx, cy, n) => {
      for (let k = 0; k < n; k++) {
        const px = cx + k * 9, py = cy + k * 4;
        g.fillStyle = "#1d2b26"; g.fillRect(px - 4, py - 1, 9, 3);
        g.fillStyle = IC_MET_LO; g.fillRect(px - 4, py - 5, 9, 5);
        g.fillStyle = IC_MET; g.fillRect(px - 4, py - 6, 9, 2);
        g.fillStyle = IC_TRIM_LO; g.fillRect(px - 4, py - 3, 9, 1);
      }
    };
    // process silo / cooling drum — the clean family's vertical signature,
    // standing in for the dirty ladder's smoke stacks (no plume, ever)
    const drum = (g, cx, cy, rx, ht) => {
      const ry = rx * 0.55;
      g.fillStyle = IC_MET_LO;
      g.fillRect(cx - rx, cy - ht, rx * 2, ht);
      g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, 7); g.fill();
      g.fillStyle = IC_MET; g.fillRect(cx - rx, cy - ht, rx * 0.72, ht);
      g.fillStyle = IC_TRIM_LO; g.fillRect(cx - rx, cy - Math.round(ht * 0.55), rx * 2, 2);
      g.fillStyle = IC_MET_HI;
      g.beginPath(); g.ellipse(cx, cy - ht, rx, ry, 0, 0, 7); g.fill();
      g.strokeStyle = IC_MET_LO; g.lineWidth = 1;
      g.beginPath(); g.ellipse(cx, cy - ht, rx, ry, 0, 0, 7); g.stroke();
    };
    const latticeMast = (g, x, y, ht) => {
      g.strokeStyle = "#33463f"; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(x - 2.5, y); g.lineTo(x, y - ht); g.stroke();
      g.beginPath(); g.moveTo(x + 2.5, y); g.lineTo(x, y - ht); g.stroke();
      g.strokeStyle = "#6f8079"; g.lineWidth = 1;
      for (let k = 1; k * 5 < ht; k++) {
        const t = (k * 5) / ht, hw = 2.5 * (1 - t);
        g.beginPath(); g.moveTo(x - hw, y - k * 5); g.lineTo(x + hw, y - k * 5); g.stroke();
      }
    };
    const dish = (g, x, y) => {
      g.fillStyle = "#dfe8e3";
      g.beginPath(); g.ellipse(x, y, 5, 3, -0.5, 0, 7); g.fill();
      g.strokeStyle = "#8fa39b"; g.lineWidth = 1;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + 3, y + 4); g.stroke();
    };
    // parapet trim band (roofs/trim punch): bright jade on the SE face, the
    // shaded jade on SW, so the crown reads at every rotation
    const trimBand = (g, cn, ht) => {
      poly(g, [up(cn.S, ht), up(cn.E, ht), up(cn.E, ht - 3), up(cn.S, ht - 3)], IC_TRIM);
      poly(g, [up(cn.W, ht), up(cn.S, ht), up(cn.S, ht - 3), up(cn.W, ht - 3)], IC_TRIM_LO);
    };
    for (let v = 0; v < NV; v++) {
      /* i1c — level 1. v0,2,4 remass as a MONITOR-ROOF SHED (low walls under
         a raised central clerestory, the north-light lab archetype); v1,3 are
         a flat lab box with a solar deck and a ground-standing process silo
         that breaks the box outline. Both keep i1's big loading door on ONE
         world face, so level-1 clean industry can never be mistaken for the
         level-1 commercial storefront. */
      const i1cMon = (v % 2) === 0, i1cHT = i1cMon ? 8 : 23;
      i1c.push(withJitter(mkSprite(1, 1, 40, (g, ox, oy) => {
        const base = i1cBase[v];
        const cn = prism(g, ox, oy, 1, 1, i1cHT, base, zoneFaces(base, IC_ROOF[v]));
        if (i1cMon) {
          // clerestory monitor: a narrow raised lantern that clears the shed's
          // own top-face outline by ~8px, so the stepped profile survives the
          // grayscale-silhouette test against both c1 and the dirty i1 gable
          const mo = raise(insetCorners(ox, oy, 1, 1, 0.55), i1cHT);
          const mb = IC_LANT[v];
          prismFrom(g, mo, 18, mb, zoneFaces(mb, IC_ROOF[v]));
          const lrp = (a, c, t) => [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t];
          for (const [p0, p1] of [[mo.W, mo.S], [mo.S, mo.E]]) { // north-light clerestory
            poly(g, [up(p0, 4), up(p1, 4), up(p1, 13), up(p0, 13)], "#1a2e2c");
            for (const t of [0.22, 0.5, 0.78]) { // 3 iso glazing panes per face
              const q0 = lrp(p0, p1, t - 0.11), q1 = lrp(p0, p1, t + 0.11);
              poly(g, [up(q0, 6), up(q1, 6), up(q1, 12), up(q0, 12)], "#b6ddd0");
            }
          }
          trimBand(g, mo, 18);
          g.fillStyle = IC_MET; // ridge vent line on the monitor cap
          g.fillRect(ox - 5, mo.N[1] - 19, 10, 2);
          g.fillStyle = IC_MET_LO; g.fillRect(ox - 5, mo.N[1] - 17, 10, 1);
          chillers(g, ox - 13, oy - i1cHT + 5, 1);
        } else {
          const rc = [ox, oy - i1cHT];
          // solar-deck shadow pad
          poly(g, [[rc[0] - 15, rc[1]], [rc[0], rc[1] - 7], [rc[0] + 15, rc[1]], [rc[0], rc[1] + 7]], "rgba(14,24,20,.35)");
          for (let k = 0; k < 3; k++) { // tilted PV array
            const px = rc[0] + (k - 1) * 9, py = rc[1] + (k - 1) * 4.5;
            poly(g, [[px - 6, py + 1], [px + 5, py + 1], [px + 6, py - 5], [px - 5, py - 5]], "#1f3f4d", "#4d6b74");
            g.fillStyle = "#3f7686"; g.fillRect(px - 4, py - 4, 9, 1);
          }
          chillers(g, ox - 14, oy - i1cHT + 6, 1);
          // roof-standing process silo + whip mast: both clear the box outline
          drum(g, ox + 7, rc[1] + 3, 5, 21);
          latticeMast(g, ox - 9, rc[1] + 2, 19);
          trimBand(g, cn, i1cHT);
        }
        onFace(FE_PX, cn, (p0, p1) => { // loading dock (the i1 idiom)
          const fm = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
          const dt = i1cMon ? 6 : 15;
          poly(g, [up(p0, 2), up(p1, 2), up(p1, dt), up(p0, dt)].map(p => [
            p[0] * 0.5 + fm[0] * 0.5, p[1] * 0.5 + fm[1] * 0.5]), "#243a34");
          poly(g, [up(p0, dt), up(p1, dt), up(p1, dt + 2), up(p0, dt + 2)].map(p => [
            p[0] * 0.5 + fm[0] * 0.5, p[1] * 0.5 + fm[1] * 0.5]), IC_TRIM_LO);
        });
      })));
      /* i2c — level 2. v0,2,4: a low front wing under a TALL REAR BLOCK
         (stepped campus, half-lot corner sets); v1,3: a full-lot block with a
         rooftop cooling drum. Sodium panes + sodium forecourt pool (G1). */
      const i2cStep = (v % 2) === 0;
      i2c.push(withJitter(withNight(1, 1, 56, (g, ox, oy) => {
        const base = i2cBase[v];
        const cn = corners(ox, oy, 1, 1);
        const mid = (a, b2) => [(a[0] + b2[0]) / 2, (a[1] + b2[1]) / 2];
        if (i2cStep) {
          const rear = { N: cn.N, E: cn.E, S: mid(cn.E, cn.S), W: mid(cn.N, cn.W) };
          const front = { N: mid(cn.N, cn.W), E: mid(cn.E, cn.S), S: cn.S, W: cn.W };
          prismFrom(g, rear, 30, base, zoneFaces(base, IC_ROOF[v]));
          windows(g, rear.W, rear.S, 30, 2, 2, 0.5, IC_LIT, IC_DARK, GLOW_SODIUM);
          windows(g, rear.S, rear.E, 30, 2, 2, 0.5, IC_LIT, IC_DARK, GLOW_SODIUM);
          trimBand(g, rear, 30);
          const [rx, ry] = roofDeckFrom(g, rear, 30, shade(base, 0.62), "rgba(12,22,18,.85)");
          chillers(g, rx - 9, ry - 1, 2);
          latticeMast(g, rx + 9, ry + 2, 15);
          const fb = IC_WING[v];
          prismFrom(g, front, 14, fb, zoneFaces(fb, IC_ROOF[v]));
          windows(g, front.W, front.S, 14, 1, 3, 0.5, IC_LIT, IC_DARK, GLOW_SODIUM);
          windows(g, front.S, front.E, 14, 1, 3, 0.5, IC_LIT, IC_DARK, GLOW_SODIUM);
          drum(g, front.W[0] + 10, front.S[1] - 15, 5, 16); // wing-top silo
        } else {
          const HT = 26;
          prismFrom(g, cn, HT, base, zoneFaces(base, IC_ROOF[v]));
          windows(g, cn.W, cn.S, HT, 2, 3, 0.5, IC_LIT, IC_DARK, GLOW_SODIUM);
          windows(g, cn.S, cn.E, HT, 2, 3, 0.5, IC_LIT, IC_DARK, GLOW_SODIUM);
          trimBand(g, cn, HT);
          const [rx, ry] = roofDeckFrom(g, cn, HT, shade(base, 0.62), "rgba(12,22,18,.85)");
          drum(g, rx + 9, ry + 4, 6, 14);
          chillers(g, rx - 13, ry - 2, 2);
          latticeMast(g, rx - 1, ry + 3, 17);
        }
        groundPool(ox + 8, oy + 4, 15, 6, GLOW_SODIUM); // yard flood stays sodium (G1)
      }), { BR, fam: 20, v, cx: i2cStep ? 40 : HW, cy: i2cStep ? 38 : 46, spread: 7 }));
      /* i3c — level 3. v0,2,4: a SETBACK TIER tower (podium + inset shaft);
         v1,3: a single slab crowned by a big cooling drum. Both carry the
         dish + lattice mast; neither carries a stack. */
      const i3cTier = (v % 2) === 0;
      i3c.push(withJitter(withNight(1, 1, 74, (g, ox, oy) => {
        const base = i3cBase[v];
        if (i3cTier) {
          const pb = IC_PODM[v];
          const t = setbackTiers(g, ox, oy, 1, 1, [
            { k: 1.0, ht: 16, base: pb, opts: zoneFaces(pb, IC_ROOF[v]) },
            { k: 0.62, ht: 26, base, opts: zoneFaces(base, IC_ROOF[v]) },
          ]);
          windows(g, t[0].cn.W, t[0].cn.S, 16, 1, 3, 0.5, IC_LIT, IC_DARK, GLOW_SODIUM);
          windows(g, t[0].cn.S, t[0].cn.E, 16, 1, 3, 0.5, IC_LIT, IC_DARK, GLOW_SODIUM);
          windows(g, t[1].cn.W, t[1].cn.S, 26, 2, 2, 0.55, IC_LIT, IC_DARK, GLOW_SODIUM);
          windows(g, t[1].cn.S, t[1].cn.E, 26, 2, 2, 0.55, IC_LIT, IC_DARK, GLOW_SODIUM);
          trimBand(g, t[1].cn, 26);
          const [rx, ry] = roofDeckFrom(g, t[1].cn, 26, shade(base, 0.62), "rgba(12,22,18,.85)");
          roofClutter(g, rx, ry + 2, 2, Rc);
          drum(g, rx + 8, ry + 3, 5, 13);
          dish(g, rx - 9, ry - 2);
          latticeMast(g, rx - 2, ry + 2, 18);
          if (GLOWG) { GLOWG.fillStyle = "#ff8a5a"; GLOWG.fillRect(rx - 3, ry - 18, 3, 3); }
        } else {
          const HT = 38, cn = corners(ox, oy, 1, 1);
          prismFrom(g, cn, HT, base, zoneFaces(base, IC_ROOF[v]));
          windows(g, cn.W, cn.S, HT, 3, 3, 0.5, IC_LIT, IC_DARK, GLOW_SODIUM);
          windows(g, cn.S, cn.E, HT, 3, 3, 0.5, IC_LIT, IC_DARK, GLOW_SODIUM);
          trimBand(g, cn, HT);
          const [rx, ry] = roofDeckFrom(g, cn, HT, shade(base, 0.62), "rgba(12,22,18,.85)");
          roofClutter(g, rx - 2, ry + 2, 2, Rc);
          drum(g, rx + 10, ry + 4, 7, 18);
          dish(g, rx - 12, ry - 1);
          latticeMast(g, rx - 4, ry + 3, 20);
          if (GLOWG) { GLOWG.fillStyle = "#ff8a5a"; GLOWG.fillRect(rx - 5, ry - 20, 3, 3); }
        }
        groundPool(ox - 2, oy + 6, 17, 7, GLOW_SODIUM); // yard flood stays sodium (G1)
      })));
    }
    ART_RNG = prevRng;
  }

  /* ---- seasonal building lookup (G14) ----
     spriteFor picks a building set by season. summer & spring reuse the bake
     above (byte-identical to HEAD). winter derives a snow-capped, cool-graded
     variant of every developed building (makeWinter) and rebakes the two
     tree-bearing amenities (r1, park) with snow-capped trees; the night glow /
     pool / beacon layers are shared by reference, so G1/G2/G9 are untouched.
     autumn only rebakes the tree-bearing amenities (fall canopy) — its
     buildings stay the summer bake. This runs once at boot; renderFrame only
     ever looks the set up, so a season rollover is not a rebuild event. */
  const winArr = (arr) => arr.map((b) => withJitter(makeWinter(b)));
  const seasonR1 = (sk) => { const a = []; for (let v = 0; v < NV; v++) a.push(withJitter(mkSprite(1, 1, 30, r1Draw(v, sk)))); return a; };
  const summerSet = {
    r1: r1, r2: r2, r3: r3, c1: c1, c2: c2, c3: c3,
    i1: i1, i2: i2, i3: i3, park: park,
    police: police, firesta: firesta, coal: coal, solar: solar,
    gas: gas, wind: wind,
    school: school, hospital: hospital, mayor: mayor, stadium: stadium,
    // M28: mega-structures (season-invariant art, but included in every set so
    // spriteFor's B.<name> lookup resolves regardless of the month)
    plymouth: plymouth, forestArc: forestArc, darco: darco, launch: launch,
    statue: statue, eiffel: eiffel, pyramid: pyramid,
    // GQ10: appended at the literal END so existing evaluation order holds
    nuke: nuke, airport: airport, seaport: seaport,
    // GP5b: clean-industry families, appended after everything (forked-seed bakes)
    i1c: i1c, i2c: i2c, i3c: i3c,
  };
  const winterSet = {
    r1: seasonR1("winter"),
    r2: winArr(r2), r3: winArr(r3),
    c1: winArr(c1), c2: winArr(c2), c3: winArr(c3),
    i1: winArr(i1), i2: winArr(i2), i3: winArr(i3),
    park: mkSprite(1, 1, 22, parkDraw("winter")),
    police: makeWinter(police), firesta: makeWinter(firesta),
    coal: makeWinter(coal), solar: makeWinter(solar),
    gas: makeWinter(gas), wind: makeWinter(wind),
    school: makeWinter(school), hospital: makeWinter(hospital),
    mayor: makeWinter(mayor), stadium: makeWinter(stadium),
    // M28: snow-capped mega-structures (prismFrom recorded SNOWSPEC, so the
    // ziggurat/tower tops + pyramid faces cap; night glow shared by reference)
    plymouth: makeWinter(plymouth), forestArc: makeWinter(forestArc),
    darco: makeWinter(darco), launch: makeWinter(launch),
    statue: makeWinter(statue), eiffel: makeWinter(eiffel), pyramid: makeWinter(pyramid),
    // GQ10: appended at the literal END (makeWinter is a pure per-pixel
    // recolor — RNG-free — so no side-stream wrap is needed here)
    nuke: makeWinter(nuke), airport: makeWinter(airport), seaport: makeWinter(seaport),
    // GP5b: snow-capped clean industry (winArr/makeWinter are RNG-free)
    i1c: winArr(i1c), i2c: winArr(i2c), i3c: winArr(i3c),
  };
  const autumnSet = Object.assign({}, summerSet, {
    r1: seasonR1("autumn"), park: mkSprite(1, 1, 22, parkDraw("autumn")),
  });
  bset = { summer: summerSet, spring: summerSet, autumn: autumnSet, winter: winterSet };

    ART_RNG = facingPrev; // restore the shared stream (a no-op for facing 0)
    return {
      bset,
      fams: { park, r1, r2, r3, c1, c2, c3, i1, i2, i3, police, firesta, coal,
              solar, gas, wind, school, hospital, mayor, stadium,
              // M28: exposed as SPR.plymouth / SPR.forestArc / … for the toolbar
              plymouth, forestArc, darco, launch, statue, eiffel, pyramid,
              // GQ10: SPR.nuke / SPR.airport / SPR.seaport
              nuke, airport, seaport },
    };
  } // end bakeBuildingSet

  // Boot: bake facing 0 only (boot time + default memory unchanged). Facing 0
  // uses the shared 0x5EED stream, so its spritesheet is byte-identical to HEAD.
  // Expose the family sprites as SPR.<fam> (UI toolbar / postcard read these)
  // and SPR.bset (facing-0 set). Facings 1..3 bake lazily via SPR.bakeFacing().
  const facing0 = bakeBuildingSet(0);
  Object.assign(SPR, facing0.fams);
  SPR.bset = facing0.bset;
  SPR.facings = [facing0.bset];
  SPR.bakeFacing = (r) => SPR.facings[r] || (SPR.facings[r] = bakeBuildingSet(r).bset);

  /* ---- night-light sprites (M10) ----
     Baked once here; renderFrame draws them additively ("lighter") after the
     dusk tint. No gradients or canvases are ever created per frame. */
  const radialSprite = (r, stops) => {
    const c = document.createElement("canvas");
    c.width = c.height = r * 2;
    const g = c.getContext("2d");
    const gr = g.createRadialGradient(r, r, 0, r, r, r);
    for (const [t, col] of stops) gr.addColorStop(t, col);
    g.fillStyle = gr;
    g.beginPath(); g.arc(r, r, r, 0, 7); g.fill();
    return { c, ox: r, oy: r };
  };
  // street-lamp pool of warm light on road tiles
  SPR.lamp = radialSprite(17, [
    [0, "rgba(255,242,200,0.95)"], [0.25, "rgba(255,214,140,0.55)"],
    [1, "rgba(255,180,80,0)"]]);
  // disaster halos: fire glow, UFO beam wash, storm lightning flicker.
  // fireGlow bakes a full-alpha core (G3): the renderer owns its strength —
  // FIRE_DAY_ALPHA for the daytime apron, and at night an alpha scaled by
  // 1/sqrt(burning cluster size) capped at FIRE_GLOW_CORE.
  SPR.fireGlow = radialSprite(110, [
    [0, "rgba(255,170,80,1)"], [0.5, "rgba(255,120,40,0.55)"],
    [1, "rgba(255,80,20,0)"]]);
  SPR.ufoGlow = radialSprite(80, [
    [0, "rgba(160,255,160,0.65)"], [0.5, "rgba(120,255,140,0.3)"],
    [1, "rgba(80,255,120,0)"]]);
  SPR.stormGlow = radialSprite(90, [
    [0, "rgba(200,215,255,0.6)"], [0.5, "rgba(170,190,255,0.28)"],
    [1, "rgba(140,160,255,0)"]]);
  // smoke puffs (G3): radial-falloff sprites for the smoke[] pool — soft
  // light gray for industry stacks, darker warm gray for fire smoke.
  // G16: industry smoke warmed to a coal-gray and its core opacity lifted to
  // ~0.5 (was 0.42) so the stacks read as actually burning something, not cold.
  SPR.puff = radialSprite(16, [
    [0, "rgba(206,200,190,0.52)"], [0.5, "rgba(206,200,190,0.26)"],
    [1, "rgba(206,200,190,0)"]]);
  SPR.puffFire = radialSprite(16, [
    [0, "rgba(88,82,78,0.95)"], [0.5, "rgba(126,120,116,0.55)"],
    [1, "rgba(150,144,140,0)"]]);

  /* ---- news helicopter (M18) ----
     Built exactly once here at boot, like every other sprite: a fuselage,
     three prebaked rotor-blur frames (cycled by the shared frame counter in
     updateChopper — never rebuilt), and a soft ground-shadow ellipse. */
  SPR.chop = (() => {
    const c = document.createElement("canvas"); c.width = 48; c.height = 26;
    const g = c.getContext("2d");
    // tail boom
    g.fillStyle = "#20406e";
    g.fillRect(8, 12, 18, 4);
    g.beginPath(); g.moveTo(8, 8); g.lineTo(12, 12); g.lineTo(8, 16); g.closePath(); g.fill();
    // tail rotor hub
    g.fillStyle = "#101a2c"; g.fillRect(6, 6, 2, 12);
    // fuselage
    g.fillStyle = "#2b57a0";
    g.beginPath(); g.ellipse(32, 13, 12, 8, 0, 0, 7); g.fill();
    g.fillStyle = "#1c3c72";
    g.beginPath(); g.ellipse(32, 16, 12, 5, 0, 0, Math.PI); g.fill();
    // cockpit glass
    g.fillStyle = "#bfe6ff";
    g.beginPath(); g.ellipse(38, 11, 5, 4.5, 0, -Math.PI / 2, Math.PI / 2); g.fill();
    // "99" livery
    g.fillStyle = "#ffe14a"; g.font = "bold 7px monospace";
    g.fillText("99", 26, 15);
    // skids
    g.strokeStyle = "#101a2c"; g.lineWidth = 2;
    g.beginPath();
    g.moveTo(26, 21); g.lineTo(28, 24); g.moveTo(38, 21); g.lineTo(36, 24);
    g.moveTo(24, 24.5); g.lineTo(40, 24.5);
    g.stroke();
    // rotor mast
    g.fillStyle = "#101a2c"; g.fillRect(31, 3, 2, 4);
    return { c, ox: 32, oy: 14 }; // anchor at fuselage center
  })();
  // 3 rotor-blur frames: sweeping ellipse widths sell the spin
  SPR.chopRotor = [21, 13, 6].map((hw, k) => {
    const c = document.createElement("canvas"); c.width = 46; c.height = 10;
    const g = c.getContext("2d");
    g.fillStyle = "rgba(210,220,235,0.65)";
    g.beginPath(); g.ellipse(23, 5, hw, 1.6 + k * 0.4, 0, 0, 7); g.fill();
    g.fillStyle = "#0e1626";
    g.fillRect(21, 3, 4, 4); // hub
    return { c, ox: 23, oy: 5 };
  });
  SPR.chopShadow = (() => {
    const c = document.createElement("canvas"); c.width = 48; c.height = 22;
    const g = c.getContext("2d");
    g.translate(24, 11); g.scale(1, 0.45);
    const gr = g.createRadialGradient(0, 0, 2, 0, 0, 22);
    gr.addColorStop(0, "rgba(8,8,16,0.5)");
    gr.addColorStop(1, "rgba(8,8,16,0)");
    g.fillStyle = gr;
    g.beginPath(); g.arc(0, 0, 22, 0, 7); g.fill();
    return { c, ox: 24, oy: 11 };
  })();

  // ---- "no power" bolt ----
  SPR.zap = (() => {
    const c = document.createElement("canvas"); c.width = 16; c.height = 22;
    const g = c.getContext("2d");
    g.fillStyle = "#ffd800"; g.strokeStyle = "#7a5a00"; g.lineWidth = 1;
    g.beginPath();
    g.moveTo(10, 0); g.lineTo(3, 12); g.lineTo(7, 12); g.lineTo(5, 22);
    g.lineTo(13, 9); g.lineTo(9, 9); g.closePath();
    g.fill(); g.stroke();
    return { c, ox: 8, oy: 22 };
  })();

  // ---- GP2 R2: "no link" badge — a POWERED port with no road/rail
  // connection (portWork false while powered true). Mutually exclusive with
  // the zap, which keys on !powered. Deterministic geometry, zero RNG: a
  // severed road stub under a red interdiction ring + diagonal bar. ----
  SPR.noLink = (() => {
    const c = document.createElement("canvas"); c.width = 22; c.height = 22;
    const g = c.getContext("2d");
    g.fillStyle = "#f2f2f2"; // light disc so the ring reads at night too
    g.beginPath(); g.arc(11, 11, 10, 0, 7); g.fill();
    g.fillStyle = "#565b62"; // grey road stub, broken in the middle
    g.fillRect(3, 9, 6, 4); g.fillRect(13, 9, 6, 4);
    g.fillStyle = "#e8e5d8"; // lane dashes on the stubs
    g.fillRect(4.5, 10.5, 2, 1); g.fillRect(15.5, 10.5, 2, 1);
    g.strokeStyle = "#e23b2e"; g.lineWidth = 2.5; // signature interdiction red
    g.beginPath(); g.arc(11, 11, 8.6, 0, 7); g.stroke();
    g.beginPath(); g.moveTo(4.9, 4.9); g.lineTo(17.1, 17.1); g.stroke();
    return { c, ox: 11, oy: 26 }; // hovers above the anchor tile like the zap
  })();

  /* ---- GQ9: suspension-bridge towers ----
     Appended at the very END of buildSprites with ZERO RNG of any stream, so
     every prior bake stays byte-identical. Two view-axis variants —
     SPR.bridgeTower[0] for a run along view u, [1] for view v — anchored at
     the end tile's deck center; render.js picks the variant from the run axis
     and cam.r, so all four rotations come free. Two tapered trapezoid legs
     (5px base → 3px top) straddle the deck at perp ±7px and rise 38px above
     the deck plane, tied by a portal cross-beam at −26px and topped by saddle
     caps, in the international-orange family (#a63c2e body, #c25a48 NE-lit
     face, #6e2419 shade) so the silhouette is identifiable at 1x. */
  SPR.bridgeTower = [1, -1].map((sgn) => {
    const c = document.createElement("canvas");
    c.width = 44; c.height = 58;
    const g = c.getContext("2d");
    const ox = 22, oy = 44;                 // anchor = deck center
    const body = "#a63c2e", lit = "#c25a48", shd = "#6e2419";
    // the perp ground axis projects to (∓2,±1)/√5 for a u-run (sgn +1) and
    // mirrors for a v-run (sgn −1): ±7px perp ⇒ leg centers (∓6.26, ±3.13)
    const legs = [[ox - sgn * 6.26, oy + 3.13], [ox + sgn * 6.26, oy - 3.13]];
    // portal cross-beam first, so the legs cap its ends
    const bx0 = Math.min(legs[0][0], legs[1][0]), bx1 = Math.max(legs[0][0], legs[1][0]);
    g.fillStyle = body; g.fillRect(bx0, oy - 27.5, bx1 - bx0, 3);
    g.fillStyle = lit; g.fillRect(bx0, oy - 27.5, bx1 - bx0, 1);
    // far (screen-upper) leg first so the near one overlaps it
    legs.sort((a, b) => a[1] - b[1]);
    for (const [lx, ly] of legs) {
      const yB = ly + 8, yT = ly - 38;      // base dips into the water plane
      g.beginPath();
      g.moveTo(lx - 2.5, yB); g.lineTo(lx + 2.5, yB);
      g.lineTo(lx + 1.5, yT); g.lineTo(lx - 1.5, yT);
      g.closePath();
      g.fillStyle = body; g.fill();
      g.strokeStyle = lit; g.lineWidth = 1.2; // NE-lit right face
      g.beginPath(); g.moveTo(lx + 1.9, yB); g.lineTo(lx + 1.1, yT); g.stroke();
      g.strokeStyle = shd; g.lineWidth = 1;   // shaded left face
      g.beginPath(); g.moveTo(lx - 2.1, yB); g.lineTo(lx - 1.2, yT); g.stroke();
      g.fillStyle = shd; g.fillRect(lx - 2.5, yT - 2.5, 5, 2.5); // saddle cap
      g.fillStyle = lit; g.fillRect(lx - 2.5, yT - 2.5, 5, 1);
    }
    return { c, ox, oy };
  });

  /* ---- GP4b: the metro consist — loco + boxcar, one bake per travel axis ----
     Appended at the very END of buildSprites, after SPR.bridgeTower, with
     ZERO calls to R()/ART_RNG/any stream (the roadSprite/bridgeTower append
     contract) so every prior bake's draw stream stays byte-identical.
     Construction is the buildCarSprites iso-quad recipe (render.js): an iso
     ground-plane quad with half-length hl along the travel tile axis and
     half-width hw across it, raised body faces stacked by elevation, plus
     the same ground-shadow quad cars use. Anchored at the unit's ground
     center; render.js (computeTrains/drawTrainsAt) drives the position per
     frame, so the bake itself is static art. Deliberately NO withNight —
     trains contribute NOTHING to the G1/G2 night layer.
     SPR.train[axis][kind]: axis "x"/"y" = travel tile axis, kind 0 = loco
     (graphite, warning-yellow nose stripe on the leading end, raised cab
     with dark glass), kind 1 = boxcar (slab body, pale roof stripe, 3 dark
     window ticks on the screen-front face). */
  SPR.train = (() => {
    const OX = 20, OY = 16, W = 40, H = 26;   // anchor = ground center
    const bake = (axis, kind) => {
      const c = document.createElement("canvas"); c.width = W; c.height = H;
      const g = c.getContext("2d");
      const hl = kind ? 0.36 : 0.40, hw = 0.13; // loco runs a touch longer
      // iso quad: half-length hl*sl along the travel axis, half-width hw*sw
      // across it, slid `off` tiles toward the +travel (leading) end
      const quad = (elev, sl, sw, off = 0) => {
        const L = hl * sl, Wd = hw * sw;
        const pts = axis === "x"
          ? [[off + L, Wd], [off + L, -Wd], [off - L, -Wd], [off - L, Wd]]
          : [[Wd, off + L], [-Wd, off + L], [-Wd, off - L], [Wd, off - L]];
        g.beginPath();
        for (let k = 0; k < 4; k++) {
          const dx = pts[k][0], dy = pts[k][1];
          const X = OX + (dx - dy) * HW, Y = OY + (dx + dy) * HH - elev;
          k ? g.lineTo(X, Y) : g.moveTo(X, Y);
        }
        g.closePath();
      };
      quad(0, 1.15, 1.15); g.fillStyle = "rgba(8,8,14,0.5)"; g.fill(); // ground shadow (car idiom)
      if (kind) {
        // dark underframe first: a chassis quad 2px below and a hair wider
        // than the slab leaves a dark rim outlining the pale body — winter
        // legibility (panel: silver-on-snow was marginal) without touching
        // the slab's silver day/night read
        quad(2, 1.04, 1.6); g.fillStyle = "#232833"; g.fill();     // underframe rim
        quad(4, 1, 1); g.fillStyle = "#8b93a2"; g.fill();          // boxcar slab
        quad(6, 0.9, 0.5); g.fillStyle = "#c9ced6"; g.fill();      // roof stripe
        g.fillStyle = "#2c323c";                                   // 3 window ticks
        for (const t of [-0.18, 0, 0.18]) {
          const dx = axis === "x" ? t : hw, dy = axis === "x" ? hw : t;
          g.fillRect(OX + (dx - dy) * HW - 1, OY + (dx + dy) * HH - 5.5, 2, 2);
        }
      } else {
        quad(4, 1, 1); g.fillStyle = "#3a4150"; g.fill();          // graphite body
        quad(4.5, 0.16, 1, 0.33); g.fillStyle = "#f2c53a"; g.fill(); // nose stripe, leading end
        quad(6.5, 0.42, 0.85, -0.12); g.fillStyle = "#4a5262"; g.fill(); // raised cab block
        quad(7, 0.24, 0.5, -0.12); g.fillStyle = "#202730"; g.fill();    // cab glass
      }
      return { c, ox: OX, oy: OY };
    };
    return { x: [bake("x", 0), bake("x", 1)], y: [bake("y", 0), bake("y", 1)] };
  })();

  /* ================= GP9b: DISPOSAL ART =====================================
     APPENDED AT THE LITERAL END of buildSprites, after SPR.train, and every
     draw below consumes ONLY the dedicated `wasteRng` side stream (swapped in
     and out around the whole block — the gasRng/megaRng idiom). That is the
     hard rule this milestone rides on: interleaving a new bake anywhere
     earlier re-pins the value-jitter of every shipped sprite and silently
     breaks the G1/G2 night legibility and the G12/G14 season bakes. Both
     families are baked ONCE here and only ever looked up by spriteFor — never
     rebuilt per frame.

     SPR.landfill is THREE BANDS OF FOUR BAKES, indexed by fillBand(city.fill[i])
     — the SAME function the sim's pollution term and the query readout key on,
     so the art can never claim a cell is empty while the sim is charging it for
     a capped one — and then by the G10 (x + 2y) & 3 four-colouring, so a
     drag-painted field is never wallpaper. SPR.landfillWinter is the same
     structure snowed over (G12/G14):
       [0] EMPTY      graded earth, a perimeter berm and fresh dozer tracks
       [1] HALF       a working refuse mound with scattered debris and a plant
       [2] SATURATED  a capped, grassed-over mound with a lit methane flare
                      and circling gulls — visibly finished, visibly still there

     SPR.incin is a PAIR, indexed by powered[anchor]:
       [0] IDLE  cold stack, dark glass, closed tipping door
       [1] LIT   lit hall windows, a glowing grate and a warm stack cap
     Both are baked through withNight, so the LIT one carries a real G1 glow
     layer and the IDLE one carries an (empty) one — a dark incinerator stays
     dark at night, which is the whole point of the pair. */
  {
    const wasteRng = mulberry32(0x9A57E5);
    const prevRng = ART_RNG; ART_RNG = wasteRng;
    const R2 = () => wasteRng();

    /* one landfill cell at band b (0 empty / 1 working / 2 capped), in season
       sk, drawn from the seeded side stream.

       EVERY BAKE IS A DIFFERENT CELL. The landfill is the one family in the
       game that is meant to be DRAG-PAINTED IN BULK, which makes it the family
       G10's anti-repetition doctrine ("so identical adjacent towers never
       render as pixel-twins", line 309) matters most for — and a single bake
       per band measured 0.00% differing pixels between neighbouring cells: a
       field rendered as wallpaper, with the same dome, the same debris in the
       same places and, once capped, the same methane flare standing in perfect
       rows. So the pad tone, the mound's centre, its radii and height, the
       scraped-band phase, the debris and the flare's position are all drawn
       from the stream PER BAKE, and spriteFor picks a variant by the same
       (x + 2y) & 3 four-colouring the zone jitter uses — which guarantees that
       no two orthogonally OR diagonally adjacent cells share a bake. */
    const LF_PADS  = ["#6b5f4e", "#665a49", "#706352", "#635846"];
    const landfillDraw = (b, sk) => {
      const winter = sk === "winter";
      // per-bake geometry, all drawn BEFORE the returned closure runs so the
      // draw itself is a pure function of these (mkSprite may be called once)
      const pad = LF_PADS[(R2() * LF_PADS.length) | 0];
      const phase = R2() * 4 - 2, mdx = R2() * 5 - 2.5, mdy = R2() * 3 - 1.5;
      const rw = 12.5 + R2() * 3, hj = 0.82 + R2() * 0.36;
      const fdx = R2() * 12 - 6, tilt = R2() * 0.5 - 0.25;
      const junkN = 7 + ((R2() * 5) | 0), gullN = 3 + ((R2() * 3) | 0);
      const seeds = []; for (let k = 0; k < 40; k++) seeds.push(R2());
      let sp = 0; const S = () => seeds[sp++ % seeds.length];
      return (g, ox, oy) => {
        // graded earth pad — sealedDiamond so adjacent cells composite with no
        // seam bleed (the terrain-tile contract)
        sealedDiamond(g, ox, oy, winter ? shade(pad, 1.34) : pad);
        // scraped lighter bands running along the NE-SW axis
        g.save(); diamondPath(g, ox, oy); g.clip();
        g.fillStyle = winter ? "#c9ccd2" : lighten(pad, 0.16);
        for (let k = -2; k <= 2; k++) {
          const yy = k * 5 + phase;
          g.beginPath();
          g.moveTo(ox - HW, oy + yy); g.lineTo(ox, oy - HH + yy);
          g.lineTo(ox, oy - HH + yy + 3); g.lineTo(ox - HW, oy + yy + 3);
          g.closePath(); g.fill();
        }
        // dozer tracks: paired dark hatch ticks
        g.strokeStyle = "rgba(50,42,32,.55)"; g.lineWidth = 1;
        for (let k = 0; k < 7; k++) {
          const u = S() * 1.6 - 0.8, v = S() * 1.6 - 0.8;
          const tx = ox + (u - v) * HW * 0.5, ty = oy + (u + v) * HH * 0.5;
          g.beginPath(); g.moveTo(tx - 3, ty - 1); g.lineTo(tx + 3, ty + 1); g.stroke();
          g.beginPath(); g.moveTo(tx - 3, ty + 1.6); g.lineTo(tx + 3, ty + 3.6); g.stroke();
        }
        g.restore();
        if (b === 0) {
          // a low back berm of pushed spoil, so an empty cell still reads as
          // WORKED ground rather than bare dirt at every rotation
          g.fillStyle = winter ? "#d8dbe0" : lighten(pad, 0.22);
          g.beginPath(); g.ellipse(ox + mdx * 0.6, oy - HH + 5, 13, 4, 0, 0, 7); g.fill();
          g.fillStyle = winter ? "#eceef2" : lighten(pad, 0.34);
          g.beginPath(); g.ellipse(ox - 2 + mdx * 0.6, oy - HH + 4, 9, 2.6, 0, 0, 7); g.fill();
          return;
        }
        // refuse mound — a squashed dome. CAPPED is duller and heavier, never
        // brighter: a finished tip is a dead grey-olive scar, not the greenest
        // thing on the map (it used to bake at #6d7a52, a lawn green, which
        // read as an ornamental hillock rather than as failure).
        const ht = (b === 2 ? 17 : 10) * hj;
        const body = b === 2 ? "#5c6047" : "#8a7f62";
        const cx = ox + mdx, cy = oy + mdy;
        g.fillStyle = "rgba(0,0,0,.20)";
        g.beginPath(); g.ellipse(cx, cy + 2, rw + 1, 6, 0, 0, 7); g.fill();
        g.fillStyle = body;
        g.beginPath(); g.ellipse(cx, cy - ht * 0.35, rw, ht * 0.62, 0, 0, 7); g.fill();
        g.fillStyle = lighten(body, 0.22);   // NE-lit crown
        g.beginPath(); g.ellipse(cx - 3, cy - ht * 0.55, rw * 0.64, ht * 0.36, 0, 0, 7); g.fill();
        g.fillStyle = shade(body, 0.78);     // SW shadow flank
        g.beginPath(); g.ellipse(cx + 4, cy - ht * 0.18, rw * 0.57, ht * 0.3, 0, 0, 7); g.fill();
        if (winter) { // G12/G14: snow lies on the crown, not on the working face
          g.fillStyle = "rgba(238,242,248,.86)";
          g.beginPath(); g.ellipse(cx - 2, cy - ht * 0.58, rw * 0.62, ht * 0.3, 0, 0, 7); g.fill();
          g.fillStyle = "rgba(226,232,240,.55)";
          g.beginPath(); g.ellipse(cx - 4, cy - ht * 0.44, rw * 0.4, ht * 0.2, 0, 0, 7); g.fill();
        }
        if (b === 1) {
          // scattered debris: little bright polys poking out of the working
          // face — count, colours and positions all per bake
          const junk = ["#b4423a", "#4d6fa8", "#c9c3b0", "#7a8f4a", "#c9903a"];
          for (let k = 0; k < junkN; k++) {
            const a = S() * Math.PI * 2, r = 3 + S() * 10;
            const jx = cx + Math.cos(a) * r, jy = cy - 2 + Math.sin(a) * r * 0.42;
            g.fillStyle = junk[(S() * junk.length) | 0];
            g.beginPath();
            g.moveTo(jx, jy - 2.2); g.lineTo(jx + 2, jy); g.lineTo(jx, jy + 1.6); g.lineTo(jx - 2, jy - 0.4);
            g.closePath(); g.fill();
          }
        } else {
          // capped: a methane flare stack — SHORT, thin and low-flame, so a
          // field of finished cells reads as a scarred tip rather than as an
          // orchard of lamps
          const fx = cx + fdx, fy = cy - ht * 0.7;
          g.fillStyle = "#4e5249"; g.fillRect(fx - 1.2, fy - 12, 2.4, 12);
          g.fillStyle = "#6d7367"; g.fillRect(fx - 1.2, fy - 12, 1, 12);
          g.fillStyle = "#e0762c";
          g.beginPath(); g.ellipse(fx + tilt, fy - 13.4, 1.5, 2.2, 0, 0, 7); g.fill();
          g.fillStyle = "#f2c079";
          g.beginPath(); g.ellipse(fx + tilt, fy - 13.8, 0.8, 1.2, 0, 0, 7); g.fill();
          if (GLOWG) { // G1: the flare is the ONE thing on a tip that glows at night
            GLOWG.fillStyle = "#e0762c";
            GLOWG.beginPath(); GLOWG.ellipse(fx + tilt, fy - 13.4, 1.9, 2.6, 0, 0, 7); GLOWG.fill();
          }
          g.strokeStyle = winter ? "#f2f4f8" : "#e8e8ea"; g.lineWidth = 1;
          for (let k = 0; k < gullN; k++) {
            const gx = cx - 10 + S() * 20, gy = cy - ht - 4 - S() * 9;
            g.beginPath();
            g.moveTo(gx - 2.4, gy + 1); g.lineTo(gx, gy - 0.8); g.lineTo(gx + 2.4, gy + 1);
            g.stroke();
          }
        }
      };
    };
    // band 2 carries the flare glow, so it goes through withNight; the other
    // two bake flat (nothing on a working tip is lit after dark). LF_VAR bakes
    // per band, per season — the renderer's four-colouring needs exactly four.
    const LF_VAR = 4;
    const bakeBand = (b, sk) => {
      const a = [];
      for (let v = 0; v < LF_VAR; v++)
        a.push(b === 2 ? withNight(1, 1, 26, landfillDraw(b, sk))
                       : mkSprite(1, 1, 26, landfillDraw(b, sk)));
      return a;
    };
    SPR.landfill = [bakeBand(0), bakeBand(1), bakeBand(2)];
    // G12/G14: the disposal families used to be the ONLY structures in the
    // game that ignored the season — twelve of twelve shipped ones snow up
    // (26%-51% of their pixels change), and a bare khaki tip beside a
    // snow-capped fire station read as "the sprites that forgot the seasons".
    SPR.landfillWinter = [bakeBand(0, "winter"), bakeBand(1, "winter"), bakeBand(2, "winter")];

    /* the 2x2 waste-to-energy plant. `lit` swaps the window quota, the grate
       and the stack cap — the SILHOUETTE is identical in both, so the pair
       reads as one building in two states rather than two buildings. */
    const incinDraw = (lit) => (g, ox, oy) => {
      const cn = corners(ox, oy, 2, 2);
      poly(g, [cn.N, cn.E, cn.S, cn.W], "#6a6a70", "rgba(0,0,0,.28)"); // concrete apron
      const hc = insetCorners(ox, oy, 2, 2, 0.66);
      const HT = 26;
      prismFrom(g, hc, HT, "#8a7f6a");                                 // the burn hall
      // machine-hall glazing on the two screen-front faces
      windows(g, hc.W, hc.S, HT, 2, 3, lit ? 0.85 : 0, "#ffd27a", "#20242c", GLOW_SODIUM);
      windows(g, hc.S, hc.E, HT, 2, 4, lit ? 0.85 : 0, "#ffd27a", "#20242c", GLOW_SODIUM);
      // the tipping-hall door on the SW face — the tile trucks drive into
      const dx = (hc.W[0] + hc.S[0]) / 2, dy = (hc.W[1] + hc.S[1]) / 2;
      g.fillStyle = "#3a3a42"; g.fillRect(dx - 5, dy - 13, 10, 12);
      g.fillStyle = "#4c4c56"; g.fillRect(dx - 5, dy - 13, 10, 2);
      // the GRATE: a slot above the door that is a cold dark bar when idle and
      // an incandescent bar when the furnace is running
      g.fillStyle = lit ? "#ff7a2a" : "#2b2b33";
      g.fillRect(dx - 6, dy - 17, 12, 3);
      if (lit) {
        g.fillStyle = "#ffdca0"; g.fillRect(dx - 5, dy - 16.4, 10, 1.2);
        if (GLOWG) { GLOWG.fillStyle = "#ff7a2a"; GLOWG.fillRect(dx - 7, dy - 18, 14, 5); }
        groundPool(dx, dy + 4, 15, 6, GLOW_SODIUM); // G2: yard spill under the door
      }
      // the stack: tall, striped, with a warm cap only while burning
      const tN = up(hc.N, HT);
      stack(g, tN[0] + 11, tN[1] + 6, 46, 10, true);
      if (lit) {
        g.fillStyle = "#ff9c3e";
        g.fillRect(tN[0] + 11 - 5, tN[1] + 6 - 46 - 3, 10, 3);
        if (GLOWG) { GLOWG.fillStyle = "#ff9c3e"; GLOWG.fillRect(tN[0] + 6, tN[1] - 44, 10, 4); }
      }
      // roof scrubber drum, so the hall is not a bare box from above
      const tS = up(hc.S, HT), rx = (tN[0] + tS[0]) / 2, ry = (tN[1] + tS[1]) / 2;
      g.fillStyle = "#5f6670";
      g.beginPath(); g.ellipse(rx - 6, ry + 2, 8, 3.6, 0, 0, 7); g.fill();
      g.fillStyle = "#6d757f"; g.fillRect(rx - 14, ry - 6, 16, 8);
      g.fillStyle = "#828b96";
      g.beginPath(); g.ellipse(rx - 6, ry - 6, 8, 3.6, 0, 0, 7); g.fill();
    };
    SPR.incin = [withNight(2, 2, 74, incinDraw(false)),
                 withNight(2, 2, 74, incinDraw(true))];
    // G12/G14: the burn hall is a PRISM, so prismFrom already recorded its top
    // faces on SNOWSPEC and makeWinter caps them exactly as it caps the coal
    // plant beside it — night glow, ground pool and beacon layers are shared
    // by reference, so the lit/idle G1 pair survives the season untouched.
    SPR.incinWinter = SPR.incin.map(makeWinter);

    ART_RNG = prevRng; // restore the shared 0x5EED stream
  }
}

// sprite lookup for an overlay tile (returns null when tile isn't the drawn anchor)
function spriteFor(city, i) {
  const t = city.over[i];
  // G14: buildings pick a season set — winter is snow-capped/cool-graded,
  // autumn recolors the tree-bearing amenities, summer & spring are the base
  // bake. M32b: pick the building set for the active VIEW ROTATION first —
  // facing 0 is baked at boot; facings 1..3 bake lazily on first visit to that
  // rotation and cache (a one-time hitch), so a rotated view shows different
  // building sides. An optional billboard pref pins facing 0 at every rotation.
  const season = seasonOf(city.month);
  const bill = (typeof UI !== "undefined" && UI.prefs && UI.prefs.billboard);
  const F = SPR.bakeFacing(bill ? 0 : (cam.r & 3));
  const B = F[season] || F.summer;
  // developed zones: variant is a pure function of varnt[] (mod family size).
  // G10: pick a value-jittered day copy by a 4-colouring of (x, y) so two
  // orthogonally adjacent same-variant towers never render pixel-identical.
  const zone = (fams, marker) => {
    if (city.lvl[i] === 0) return marker;
    const fam = fams[city.lvl[i] - 1];
    const base = fam[city.varnt[i] % fam.length];
    if (base.jit) {
      const x = i % MAP, y = (i / MAP) | 0;
      return base.jit[(x + 2 * y) & 3];
    }
    return base;
  };
  switch (t) {
    case OV.ROAD:  // winter roads show plowed snow banks (M12)
      // M32a: rotate the mask index (not the connectivity probes) so arms point
      // at the correct screen edge at every camera rotation. rot4(m,0)===m.
      return (season === "winter" ? SPR.roadWinter : SPR.road)[rot4(roadMask(city, i), cam.r)];
    // M26: a crossing's ground footprint is the ROAD sprite; render.js blits the
    // overhead wire on top (the road is what sits on the ground).
    case OV.WIREROAD:
      return (season === "winter" ? SPR.roadWinter : SPR.road)[rot4(roadMask(city, i), cam.r)];
    case OV.WIRE:  return SPR.wire[rot4(wireMask(city, i), cam.r)];
    // M24: water mains draw FLAT through this normal ground path (SPR.pipe is
    // baked at elevation 0, so it renders like a road, NOT overhead like a wire);
    // the tower/pump are static single sprites (not per-facing/season bakes).
    // GP4a: the expressway autotiles on its own class mask (XWAY||RAMP
    // neighbors) and the ramp keys on which neighbors are true XWAY so its
    // rising wedge points up the carriageway — rot4 gives 4-rotation
    // correctness exactly as roads get it (M32a).
    case OV.XWAY:
      return (season === "winter" ? SPR.xwayWinter : SPR.xway)[rot4(xwayMask(city, i), cam.r)];
    // GP4a fix: the ramp keys on BOTH neighbor classes (wedge toward true
    // XWAY, apron only toward real street tiles) and gets a winter variant
    // like every other road-class overlay (G12/G14).
    case OV.RAMP:
      return (season === "winter" ? SPR.rampWinter : SPR.ramp)[
        rot4(rampMask(city, i), cam.r) | (rot4(rampApronMask(city, i), cam.r) << 4)];
    case OV.PIPE:  return SPR.pipe[rot4(pipeMask(city, i), cam.r)];
    case OV.WATERTOWER: return SPR.watertower;
    case OV.PUMP:  return SPR.pump;
    case OV.PARK:  return B.park;
    case OV.RUBBLE: return SPR.rubble;
    case OV.ZR:    return zone([B.r1, B.r2, B.r3], SPR.zoneR);
    case OV.ZC:    return zone([B.c1, B.c2, B.c3], SPR.zoneC);
    // GP5b: the clean-industry flip — one handle swap keyed on the same
    // isCleanInd() the sim reads, so art and behavior can never disagree.
    case OV.ZI:    return zone(city.isCleanInd() ? [B.i1c, B.i2c, B.i3c] : [B.i1, B.i2, B.i3], SPR.zoneI);
    case OV.POLICE:  return B.police;
    case OV.FIRESTA: return B.firesta;
    case OV.COAL:    return B.coal;
    case OV.SOLAR:   return B.solar;
    case OV.GAS:     return B.gas;
    case OV.WIND:    return B.wind;
    case OV.SCHOOL:  return B.school;
    case OV.HOSPITAL: return B.hospital;
    case OV.MAYOR:   return B.mayor;
    case OV.STADIUM: return B.stadium;
    // M28: arcologies + wonder landmarks (large footprints; the size-agnostic
    // multi-tile render path draws them with no render-loop change)
    case OV.PLYMOUTH: return B.plymouth;
    case OV.FOREST:   return B.forestArc;
    case OV.DARCO:    return B.darco;
    case OV.LAUNCH:   return B.launch;
    case OV.STATUE:   return B.statue;
    case OV.EIFFEL:   return B.eiffel;
    case OV.PYRAMID:  return B.pyramid;
    // GQ10: special buildings — same size-agnostic anchor render path, so
    // per-facing lazy bakes, the billboard pin, winter sets and click-picking
    // all come free, exactly like M28.
    case OV.NUKE:     return B.nuke;
    case OV.AIRPORT:  return B.airport;
    case OV.SEAPORT:  return B.seaport;
    /* GP9b: both disposal families are FACING-invariant static bakes (SPR.*,
       not the per-facing B.* sets) — a refuse tip and a burn hall look the same
       from every side — but they are NOT season-invariant: snow lies on a
       capped mound and caps a burn hall's roof exactly as it does on every
       other structure (G12/G14), so each family carries a winter set of its own.
       The landfill indexes fillBand() — the SAME function the pollution term
       and the query readout use, so the sprite can never claim a cell is empty
       while the sim is charging the player for a capped one — and then the
       G10 four-colouring (x + 2y) & 3, so no two adjacent cells of a
       drag-painted field are pixel-twins.
       The incinerator indexes powered[] AT ITS ANCHOR (not at the tile), so all
       four footprint tiles agree; the `anc[i] >= 0` guard mirrors the identical
       one in bulldoze() for a hand-edited save with a missing anchor. */
    case OV.LANDFILL: {
      const lx = i % MAP, ly = (i / MAP) | 0;
      return (season === "winter" ? SPR.landfillWinter : SPR.landfill)
               [fillBand(city.fill[i])][(lx + 2 * ly) & 3];
    }
    case OV.INCIN:    return (season === "winter" ? SPR.incinWinter : SPR.incin)
                               [city.powered[city.anc[i] >= 0 ? city.anc[i] : i] ? 1 : 0];
  }
  return null;
}

function roadMask(city, i) {
  const x = i % MAP, y = (i / MAP) | 0;
  let m = 0;
  // M26: road connects through a crossing. GP4a fix: it ALSO draws its
  // junction arm toward a RAMP's ground apron (the exact WIREROAD lesson —
  // without this the road's curb + centre dashes ran unbroken past every
  // interchange and a working ramp looked disconnected). Render-only; with
  // zero ramps on the map the mask is byte-identical to shipped output.
  const road = (X, Y) => {
    if (!city.inMap(X, Y)) return false;
    const t = city.over[city.idx(X, Y)];
    return t === OV.ROAD || t === OV.WIREROAD || t === OV.RAMP;
  };
  if (road(x, y - 1)) m |= 1;
  if (road(x + 1, y)) m |= 2;
  if (road(x, y + 1)) m |= 4;
  if (road(x - 1, y)) m |= 8;
  return m;
}

// GP4a: expressway autotile mask — an XWAY arm points at any XWAY or RAMP
// 4-neighbor (the carriageway runs through its ramps). Pure logical-neighbor
// read, never cam.r — rotation correctness comes ONLY from rot4 at the
// spriteFor call site (M32a).
function xwayMask(city, i) {
  const x = i % MAP, y = (i / MAP) | 0;
  let m = 0;
  const xp = (X, Y) => {
    if (!city.inMap(X, Y)) return false;
    const t = city.over[city.idx(X, Y)];
    return t === OV.XWAY || t === OV.RAMP;
  };
  if (xp(x, y - 1)) m |= 1;
  if (xp(x + 1, y)) m |= 2;
  if (xp(x, y + 1)) m |= 4;
  if (xp(x - 1, y)) m |= 8;
  return m;
}

// GP4a: ramp wedge mask — ONLY true XWAY neighbors raise a bit.
function rampMask(city, i) {
  const x = i % MAP, y = (i / MAP) | 0;
  let m = 0;
  const xw = (X, Y) => city.inMap(X, Y) && city.over[city.idx(X, Y)] === OV.XWAY;
  if (xw(x, y - 1)) m |= 1;
  if (xw(x + 1, y)) m |= 2;
  if (xw(x, y + 1)) m |= 4;
  if (xw(x - 1, y)) m |= 8;
  return m;
}

// GP4a fix: ramp apron mask — street-class neighbors (ROAD/WIREROAD/RAMP)
// the ramp actually serves. Aprons draw ONLY toward these arms, never into
// open grass (panel defect: unconditional aprons sprouted dead-end stubs).
// Pure logical-neighbor read, never cam.r (M32a).
function rampApronMask(city, i) {
  const x = i % MAP, y = (i / MAP) | 0;
  let m = 0;
  const rd = (X, Y) => {
    if (!city.inMap(X, Y)) return false;
    const t = city.over[city.idx(X, Y)];
    return t === OV.ROAD || t === OV.WIREROAD || t === OV.RAMP;
  };
  if (rd(x, y - 1)) m |= 1;
  if (rd(x + 1, y)) m |= 2;
  if (rd(x, y + 1)) m |= 4;
  if (rd(x - 1, y)) m |= 8;
  return m;
}

/* ---- GQ9: suspension-bridge run finder ----
   For a WATER tile carrying a road (OV.ROAD / OV.WIREROAD) or surface rail
   (RL.TRACK): the contiguous straight water run of the same carrier class, as
   { x0, y0, ax, ay, L, d } — start tile, logical axis unit, run length and
   this tile's index along it. Pure in city state (zero RNG, never reads
   cam), memoized per (terrRev, devRev): place()/bulldoze/waterfill all bump
   one of the two (rail place/doze bumps devRev too, sim.js), so a doze never
   leaves a ghost bridge and the map is never rescanned per frame. */
const bridgeMemo = { city: null, key: "", runs: new Map() };
function bridgeRun(city, i) {
  // GQ9 fix: the memo keys on the CITY OBJECT IDENTITY as well as the revs —
  // City's constructor resets terrRev/devRev to 0, so two different loaded
  // cities would otherwise collide at key "0|0" and serve stale runs (wrong
  // tower/cable geometry) until any place/doze bumped a rev. Same discipline
  // as tKey carrying city.seed.
  const key = `${city.terrRev}|${city.devRev}`;
  if (bridgeMemo.city !== city || bridgeMemo.key !== key) {
    bridgeMemo.city = city; bridgeMemo.key = key; bridgeMemo.runs.clear();
  }
  // GP4a: a THIRD carrier class — the expressway viaduct crosses water on the
  // same suspension spans. Memo key widened from (i<<1)|isRoad to i*4+cls
  // (0 road, 1 rail, 2 xway) so the three run families memoize apart; road
  // and rail geometry is untouched.
  const ovi = city.over[i];
  const isRoad = ovi === OV.ROAD || ovi === OV.WIREROAD;
  const cls = isRoad ? 0 : ovi === OV.XWAY ? 2 : 1;
  const mk = i * 4 + cls;
  const hit = bridgeMemo.runs.get(mk);
  if (hit !== undefined) return hit;
  const x = i % MAP, y = (i / MAP) | 0;
  const carrier = (X, Y) => {
    if (!city.inMap(X, Y)) return false;
    const j = city.idx(X, Y);
    if (city.terr[j] !== TERR.WATER) return false;
    return cls === 0 ? (city.over[j] === OV.ROAD || city.over[j] === OV.WIREROAD)
         : cls === 2 ? city.over[j] === OV.XWAY
         : city.rail[j] === RL.TRACK;
  };
  // axis: follow the water-carrier run at x±1, else y±1; a single ambiguous
  // tile reads its carrier mask's opposite-arm pair (default y)
  let ax = 0, ay = 1;
  if (carrier(x - 1, y) || carrier(x + 1, y)) { ax = 1; ay = 0; }
  else if (!carrier(x, y - 1) && !carrier(x, y + 1)) {
    const cm = cls === 0 ? roadMask(city, i) : cls === 2 ? xwayMask(city, i) : railMask(city, i);
    if (cm === 10) { ax = 1; ay = 0; } // E+W arm pair ⇒ an x-axis deck
  }
  let x0 = x, y0 = y;
  while (carrier(x0 - ax, y0 - ay)) { x0 -= ax; y0 -= ay; }
  let x1 = x, y1 = y;
  while (carrier(x1 + ax, y1 + ay)) { x1 += ax; y1 += ay; }
  const run = { x0, y0, ax, ay, L: ax ? x1 - x0 + 1 : y1 - y0 + 1,
                d: ax ? x - x0 : y - y0 };
  bridgeMemo.runs.set(mk, run);
  return run;
}

// for a WATER tile: bitmask of 4-neighbors that are land (off-map counts as
// water so map-border tiles never grow sand toward the void)
function shoreMask(city, i) {
  const x = i % MAP, y = (i / MAP) | 0;
  let m = 0;
  const land = (X, Y) => city.inMap(X, Y) && city.terr[city.idx(X, Y)] !== TERR.WATER;
  if (land(x, y - 1)) m |= 1;
  if (land(x + 1, y)) m |= 2;
  if (land(x, y + 1)) m |= 4;
  if (land(x - 1, y)) m |= 8;
  return m;
}

// for a LAND tile: bitmask of 4-neighbors that are water (the beach fringe
// drawn on the land side of the seam)
function beachMask(city, i) {
  const x = i % MAP, y = (i / MAP) | 0;
  let m = 0;
  const water = (X, Y) => city.inMap(X, Y) && city.terr[city.idx(X, Y)] === TERR.WATER;
  if (water(x, y - 1)) m |= 1;
  if (water(x + 1, y)) m |= 2;
  if (water(x, y + 1)) m |= 4;
  if (water(x - 1, y)) m |= 8;
  return m;
}

// G5: for a LAND tile — bitmask of 4-neighbors whose land type differs
// (grass vs forest); the terrain layer strokes only these edges. Water
// boundaries are excluded: the shore band already straddles those seams.
// Off-map neighbors never raise an edge.
function terrEdgeMask(city, i) {
  const x = i % MAP, y = (i / MAP) | 0;
  const f = city.terr[i] === TERR.FOREST;
  let m = 0;
  const diff = (X, Y) => {
    if (!city.inMap(X, Y)) return false;
    const t = city.terr[city.idx(X, Y)];
    return t !== TERR.WATER && (t === TERR.FOREST) !== f;
  };
  if (diff(x, y - 1)) m |= 1;
  if (diff(x + 1, y)) m |= 2;
  if (diff(x, y + 1)) m |= 4;
  if (diff(x - 1, y)) m |= 8;
  return m;
}

// GQ2: for a GRASS-terr tile — bitmask of 4-neighbors that are also bare
// land (non-water, non-forest) but carry a DIFFERENT groundMat; analogous to
// terrEdgeMask, drawn as the SPR.matFringe stippled feather. Off-map, water
// and forest neighbors never raise a bit — the shore band and the terrEdge
// feather already own those seams.
function matFringeMask(city, i) {
  const x = i % MAP, y = (i / MAP) | 0;
  const m0 = groundMat(city.seed, x, y);
  let m = 0;
  const diff = (X, Y) => {
    if (!city.inMap(X, Y)) return false;
    const t = city.terr[city.idx(X, Y)];
    return t !== TERR.WATER && t !== TERR.FOREST && groundMat(city.seed, X, Y) !== m0;
  };
  if (diff(x, y - 1)) m |= 1;
  if (diff(x + 1, y)) m |= 2;
  if (diff(x, y + 1)) m |= 4;
  if (diff(x - 1, y)) m |= 8;
  return m;
}

// cluster-aware forest sprite: denser stands draw fuller canopies. Pure
// function of (terr neighborhood, varnt, season) — deterministic per frame.
function forestSprite(city, i) {
  const x = i % MAP, y = (i / MAP) | 0;
  let n = 0;
  const forest = (X, Y) => city.inMap(X, Y) && city.terr[city.idx(X, Y)] === TERR.FOREST;
  if (forest(x, y - 1)) n++;
  if (forest(x + 1, y)) n++;
  if (forest(x, y + 1)) n++;
  if (forest(x - 1, y)) n++;
  const tier = n <= 1 ? 0 : n <= 3 ? 1 : 2;
  const fam = SPR.season[seasonOf(city.month)].forest[tier]; // seasonal canopy (M12)
  // G13: pick the canopy variant by the scrambled position hash (like the G5
  // grass/water variants) rather than city.varnt, so neighbouring stands
  // decorrelate; the (x+y) flip in the render pass then guarantees adjacent
  // forest tiles never draw an identical arrangement. Pure in (x, y).
  return fam[terrHash(x, y) % fam.length];
}

// GQ4: street trees along straight road verges — the SINGLE source of truth
// for placement. Pure in (city.seed, over[], terr[], fire[], LOGICAL x, y):
// boot-stable, rotation-stable (M32), save/load-stable (seed is serialized,
// v11), and it reacts to road build/doze automatically because roadMask is an
// input. Returns null (no tree) or { dx, dy, variant }: a fractional verge
// offset inside the road tile's own diamond (|off| < 0.5, so the tree
// functionally occupies nothing — no over[]/terr[]/rail[] writes, no sim
// state, no save-format change, no click-picking change) plus the baked
// fam.streetTree variant index. Straight segments only (mask 5 = N-S,
// 10 = E-W); intersections, corners and dead-ends excluded by construction.
const ST_COVER = 0.85;
// GQ4 panel fix: the road bake's asphalt spans perpendicular offsets
// -0.36..+0.36 (AW0/AW1 = 0.14/0.86), so the trunk must stand BEYOND 0.36 to
// read as planted on the grass verge, yet under 0.5 to stay inside the road
// tile's own diamond. 0.44 is the centre of that verge strip — trunk and
// grounding shadow land on the verge, clear of the curb line.
const ST_OFF = 0.44;
// NOTE (panel, low): the fresh result object per visible straight-road tile
// (~83/frame at z=1) is deliberately KEPT — it is short-lived nursery garbage
// with no measured cost, and a reused scratch object would alias in every
// caller that holds the result across another streetTreeInfo/renderFrame
// call (the verification harnesses do exactly that).
function streetTreeInfo(city, i) {
  const ov = city.over[i];
  if (ov !== OV.ROAD && ov !== OV.WIREROAD) return null;
  if (city.terr[i] === TERR.WATER) return null;   // never on a water-bridging road span
  if (city.fire[i]) return null;                   // burning tile shows fire, not a tidy tree
  const m = roadMask(city, i);
  if (m !== 5 && m !== 10) return null;            // straight N-S / E-W only
  const x = i % MAP, y = (i / MAP) | 0;
  if (hash01(city.seed ^ 0x57EE, x, y) >= ST_COVER) return null; // ~85% of straight tiles
  const h2 = hash01(city.seed ^ 0x7A31, x, y);
  const side = h2 < 0.5 ? -ST_OFF : ST_OFF;        // verge side, deterministic per tile
  return { dx: m === 5 ? side : 0, dy: m === 10 ? side : 0, variant: (h2 * 4096 | 0) % 6 };
}

function wireMask(city, i) {
  const x = i % MAP, y = (i / MAP) | 0;
  let m = 0;
  const conn = (X, Y) => {
    if (!city.inMap(X, Y)) return false;
    // M24: exclude the water overlays so a power line never draws an arm toward
    // a pipe/tower/pump (the two utilities are visually separate networks).
    // GP4a: exclude the expressway class too — placement already forbids
    // contact-conduction (a wire may not cross an xway), so the cosmetic arm
    // must not suggest otherwise.
    // GP9a: the membership test is now ovWireJoins (sim.js module scope, which
    // this file already resolves). It is NOT ovConducts: the two differ on
    // exactly ids 22..28, the megas — a mega never routes power through itself,
    // but a wire beside one still draws its arm.
    return !!OV_WIRE_JOINS[city.over[city.idx(X, Y)]];
  };
  if (conn(x, y - 1)) m |= 1;
  if (conn(x + 1, y)) m |= 2;
  if (conn(x, y + 1)) m |= 4;
  if (conn(x - 1, y)) m |= 8;
  return m;
}

// M25: rail autotile mask — mirrors roadMask but reads the rail PLANE. Surface
// track, subway and stations all connect into one continuous line, so a cell
// links to a 4-neighbor whenever that neighbor is any rail feature (!== RL.NONE).
function railMask(city, i) {
  const x = i % MAP, y = (i / MAP) | 0;
  let m = 0;
  const rail = (X, Y) => city.inMap(X, Y) && city.rail[city.idx(X, Y)] !== RL.NONE;
  if (rail(x, y - 1)) m |= 1;
  if (rail(x + 1, y)) m |= 2;
  if (rail(x, y + 1)) m |= 4;
  if (rail(x - 1, y)) m |= 8;
  return m;
}

// M24: pipe autotile mask — the water analog of wireMask. A pipe connects to
// adjacent PIPE tiles and to the two providers (a tower/pump the main plugs
// into), never to a wire/road, so the water grid autotiles independently.
function pipeMask(city, i) {
  const x = i % MAP, y = (i / MAP) | 0;
  let m = 0;
  const conn = (X, Y) => {
    if (!city.inMap(X, Y)) return false;
    const t = city.over[city.idx(X, Y)];
    return t === OV.PIPE || isWaterSrc(t);
  };
  if (conn(x, y - 1)) m |= 1;
  if (conn(x + 1, y)) m |= 2;
  if (conn(x, y + 1)) m |= 4;
  if (conn(x - 1, y)) m |= 8;
  return m;
}
