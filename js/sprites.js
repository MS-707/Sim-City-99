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
function withJitter(base) {
  base.jit = JIT_DELTAS.map((delta) => {
    const copy = { c: valueJitterCopy(base.c, delta), ox: base.ox, oy: base.oy };
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
    grass: ["#4a9d44", "#479a47", "#4d9f46", "#489744"],
    fleckA: "rgba(255,255,255,.08)", fleckB: "rgba(0,60,0,.15)",
    floor: "#479843", leafLo: "#1d6e2a", leafHi: "#2f9c3f", snowCap: null,
    waterTop: "#2564af", waterBot: "#215aa1",
    wave: "rgba(210,235,255,.35)", glint: "rgba(220,240,255,.5)",
    sand: "#dcc37a", sandHi: "#e0c87f", foam: "rgba(255,255,255,.32)", iceEdge: null,
  },
  spring: { // fresh greens, blossom flecks in the grass
    grass: ["#55ac4b", "#52a94e", "#57ae51", "#53a74d"],
    fleckA: "rgba(255,215,235,.4)", fleckB: "rgba(0,70,0,.15)",
    floor: "#53a74b", leafLo: "#2a8a36", leafHi: "#4fb453", snowCap: null,
    waterTop: "#2a6bb5", waterBot: "#2561a7",
    wave: "rgba(210,235,255,.35)", glint: "rgba(220,240,255,.5)",
    sand: "#dcc37a", sandHi: "#e0c87f", foam: "rgba(255,255,255,.32)", iceEdge: null,
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
    wave: "rgba(210,235,255,.3)", glint: "rgba(220,240,255,.45)",
    sand: "#d8bd74", sandHi: "#dcc17b", foam: "rgba(255,255,255,.30)", iceEdge: null,
  },
  winter: { // snowed-under lawns, pine canopies with snow caps, icy shores
    grass: ["#e9edf3", "#e6eaf1", "#eceff5", "#e5e9f0"],
    fleckA: "rgba(255,255,255,.5)", fleckB: "rgba(165,182,210,.35)",
    floor: "#e3e8f0", leafLo: "#2c5a34", leafHi: "#38703f", snowCap: "#eef2f7",
    waterTop: "#9fc1d9", waterBot: "#98bbd5",
    wave: "rgba(255,255,255,.4)", glint: "rgba(240,248,255,.7)",
    sand: "#c9d6e4", sandHi: "#e8eef5", foam: "rgba(255,255,255,.5)", iceEdge: "#7fa0bf",
  },
};

// G13: `sil` selects a canopy silhouette (0 round, 1 conifer, 2 wide oak),
// `hue` jitters the leaf color per tree, and `ground` drops a grounding shadow
// ellipse so forest trees stop floating. Defaults reproduce the pre-G13 round
// tree exactly, so standalone park/mayor/stadium trees are unchanged.
function drawTree(g, x, y, s, tint = 1, pal = null, sil = 0, hue = 0, ground = false) {
  let lo = pal ? pal.leafLo : "#1d6e2a", hi = pal ? pal.leafHi : "#2f9c3f";
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

// G5: scrambled coordinate hash for terrain variation (grass mottle, water
// variant). Pure in (x, y) — every boot and every frame agrees, so the
// terrain-layer cache stays deterministic and rebuild-free.
function terrHash(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
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
  const forestRng = mulberry32(0x0F0E);

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
    for (let v = 0; v < 4; v++) {
      fam.grass.push(mkSprite(1, 1, 0, (g, ox, oy) => {
        sealedDiamond(g, ox, oy, P.grass[v]); // opaque seam, no bleed
        g.save(); diamondPath(g, ox, oy); g.clip();
        g.fillStyle = P.fleckA;
        for (let k = 0; k < 14; k++) g.fillRect(ox - HW + R() * TW, oy - HH + R() * TH, 2, 1);
        g.fillStyle = P.fleckB;
        for (let k = 0; k < 10; k++) g.fillRect(ox - HW + R() * TW, oy - HH + R() * TH, 2, 1);
        g.restore();
      }));
    }

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
    for (let sv = 0; sv < SHORE_VARIANTS; sv++) {
      const svar = [];
      for (let m = 0; m < 16; m++) {
        svar.push(mkSprite(1, 1, 4, (g, ox, oy) => {
          if (!m) return; // open water / inland: no band
          const N = [ox, oy - HH], E = [ox + HW, oy], S = [ox, oy + HH], W = [ox - HW, oy];
          const cpts = [N, E, S, W];
          const edges = [[N, E], [E, S], [S, W], [W, N]]; // bit order N,E,S,W
          // per-edge sand width, 5..9px — jittered from the shore stream so
          // the four variants differ and adjacent coast tiles wander in width
          const wdt = [0, 0, 0, 0];
          for (let b = 0; b < 4; b++) wdt[b] = 5 + shoreRng() * 4;
          // clip to a slightly expanded diamond so the band hugs both sides of the seam
          g.save();
          g.translate(ox, oy); g.scale((TW + 6) / TW, (TH + 3) / TH); g.translate(-ox, -oy);
          diamondPath(g, ox, oy);
          g.restore();
          g.save(); g.clip();
          const lerp = (P0, t) => [P0[0] + (ox - P0[0]) * t, P0[1] + (oy - P0[1]) * t];
          g.lineCap = "butt";
          // 1) main sand band per set edge, jittered width
          for (let b = 0; b < 4; b++) {
            if (!(m & (1 << b))) continue;
            const [P0, P1] = edges[b];
            g.strokeStyle = P.sand; g.lineWidth = wdt[b];
            g.beginPath(); g.moveTo(P0[0], P0[1]); g.lineTo(P1[0], P1[1]); g.stroke();
          }
          // 2) corner wedge fills: where BOTH edges meeting at a diamond corner
          // are shore edges, fill a triangle so the sand bevels around the
          // corner (kills the 90-degree notch / diagonal-contact bowtie)
          g.fillStyle = P.sand;
          for (let c = 0; c < 4; c++) {
            const eA = (c + 3) & 3, eB = c;                 // the two edges at corner c
            if (!((m & (1 << eA)) && (m & (1 << eB)))) continue;
            const CP = cpts[c];
            const oA = edges[eA][0] === CP ? edges[eA][1] : edges[eA][0]; // far ends
            const oB = edges[eB][0] === CP ? edges[eB][1] : edges[eB][0];
            const fl = (Q0, Q1, t) => [Q0[0] + (Q1[0] - Q0[0]) * t, Q0[1] + (Q1[1] - Q0[1]) * t];
            const fA = fl(CP, oA, 0.34), fB = fl(CP, oB, 0.34);
            const apex = [CP[0] + (ox - CP[0]) * 0.5, CP[1] + (oy - CP[1]) * 0.5];
            g.beginPath(); g.moveTo(fA[0], fA[1]); g.lineTo(apex[0], apex[1]);
            g.lineTo(fB[0], fB[1]); g.closePath(); g.fill();
          }
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
          // 4) surf foam / ice fringe
          for (let b = 0; b < 4; b++) {
            if (!(m & (1 << b))) continue;
            const [P0, P1] = edges[b];
            g.strokeStyle = P.foam; g.lineWidth = 1.4;
            g.beginPath(); g.moveTo(...lerp(P0, 0.24)); g.lineTo(...lerp(P1, 0.24)); g.stroke();
          }
          g.restore();
        }));
      }
      fam.shore.push(svar);
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
  // G12: wide asphalt (~72% of the edge vs HEAD's 44%) with a lighter curb line
  // on each verge; centre-line dashes run one continuous edge-to-edge stroke on
  // straight tiles (even 4-4 rhythm carried seamlessly across tile seams) and
  // stop short of the centre on junctions/corners so junction boxes stay clean.
  const roadSprite = (m, snow) => mkSprite(1, 1, 0, (g, ox, oy) => {
    const C = [ox, oy];
    const asphalt = "#55565e", curb = "#93949c", line = "#d8c24a";
    const AW0 = 0.14, AW1 = 0.86;              // asphalt spans ~72% of each edge
    const armLen = Math.hypot(HW / 2, HH / 2); // centre → edge-midpoint distance
    const dash = armLen / 4;                   // 4-4 rhythm; a straight tile = 8 dashes
    const clearR = 9;                          // junction dashes stop this far from centre
    const straight = m === 5 || m === 10;      // 2 opposite arms => a through road
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
      if (snow) { // plowed snow banks piled along both arm edges (M12)
        g.strokeStyle = "#e8edf3"; g.lineWidth = 2.6; g.lineCap = "round";
        g.beginPath(); g.moveTo(e1[0], e1[1]); g.lineTo(c1[0], c1[1]); g.stroke();
        g.beginPath(); g.moveTo(e2[0], e2[1]); g.lineTo(c2[0], c2[1]); g.stroke();
        g.lineCap = "butt";
      } else { // 1px curb line, lighter than asphalt, on each verge
        g.strokeStyle = curb; g.lineWidth = 1.2;
        g.beginPath(); g.moveTo(e1[0], e1[1]); g.lineTo(c1[0], c1[1]); g.stroke();
        g.beginPath(); g.moveTo(e2[0], e2[1]); g.lineTo(c2[0], c2[1]); g.stroke();
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
      g.stroke();
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

  // ---- undeveloped zone markers ----
  const zoneDef = [["zoneR", "#22c522", "R"], ["zoneC", "#3555ff", "C"], ["zoneI", "#e6c619", "I"]];
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
    const r1 = [], r2 = [], r3 = [], c1 = [], c2 = [], c3 = [], i1 = [], i2 = [], i3 = [];

  // ---- park ----
  // G14: parameterized by season so the park's two standalone trees recolor
  // with the year (snow caps in winter, fall hues in autumn) — the isolated-
  // tree case the seasonal recolor used to miss. `sk` null/summer/spring is the
  // pre-G14 summer bake, byte-for-byte (drawTree pal stays null, lawn stays
  // green, the flower confetti draws with the same seeded R() sequence).
  const parkDraw = (sk) => (g, ox, oy) => {
    const P = (sk && sk !== "summer" && sk !== "spring") ? SEASON_PAL[sk] : null;
    const lawn = sk === "winter" ? "#e4e9f1" : sk === "autumn" ? "#9c9850" : "#57b04f";
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
  // G10: residential = warm brick/cream/terracotta. Facades are muted warm
  // greige/clay (hue 0-50, low saturation); the punch is reserved for the
  // terracotta roofs and warm trim. R_ROOF are the saturated roof caps.
  const houseWalls = ["#bdb2a4", "#b8aa9a", "#c0b6a6", "#b1a594", "#c3b8a8"];
  const houseRoofs = ["#8b4b3f", "#9a5d4e", "#855242", "#996750", "#7a4b3a"];
  const r2Base = ["#977c6d", "#927662", "#9b806e", "#8e7263", "#9e8573"];
  const r3Base = ["#bea997", "#c2b19c", "#b8a08e", "#c5af9b", "#b39986"];
  const R_ROOF = ["#b0563c", "#a94f38", "#b5603f", "#a24a34", "#b56945"];
  // G14: r1 (cottages + a standalone tree) parameterized by season — winter
  // snows the pitched roofs and the tree, autumn turns the tree. sk null/
  // summer/spring reproduce the pre-G14 bake exactly (no snow, green lawn,
  // pal-less tree), so summer stays byte-identical.
  const r1Draw = (v, sk) => (g, ox, oy) => {
    const P = (sk && sk !== "summer" && sk !== "spring") ? SEASON_PAL[sk] : null;
    const snow = sk === "winter";
    const lawn = sk === "winter" ? "#e6ebf2" : sk === "autumn" ? "#9c9850" : "#5aa552";
    diamondPath(g, ox, oy);
    g.fillStyle = lawn; g.fill(); g.strokeStyle = "rgba(0,0,0,.18)"; g.stroke();
    tinyHouse(g, ox - 10, oy + 2, 22, houseWalls[v], houseRoofs[v], snow);
    tinyHouse(g, ox + 12, oy - 2, 18, houseWalls[(v + 1) % NV], houseRoofs[(v + 1) % NV], snow);
    drawTree(g, ox + 22, oy + 6, 8, 1, P, 0, sk === "autumn" ? 0.3 : 0);
  };
  for (let v = 0; v < NV; v++) {
    r1.push(withJitter(mkSprite(1, 1, 30, r1Draw(v, "summer"))));
    r2.push(withJitter(withNight(1, 1, 46, (g, ox, oy) => {
      const base = r2Base[v];
      // G10: pale mid-rise deck top (keeps G9's roof luminance variety); the
      // warm identity comes from the terracotta coping cap below.
      const { W, S, E } = prism(g, ox, oy, 1, 1, 36, base);
      windows(g, up(W, 0), up(S, 0), 36, 3, 2, 0.55, "#ffe9a0", "#20242c", GLOW_WARM, 0.4);
      windows(g, up(S, 0), up(E, 0), 36, 3, 3, 0.55, "#ffe9a0", "#20242c", GLOW_WARM, 0.4);
      // G9: tar deck behind a 1px parapet, dressed with seeded service gear
      const [cx, cy] = roofDeck(g, ox, oy, 1, 1, 36, "#26282d", "rgba(14,12,10,.9)");
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
    })));
    r3.push(withJitter(withNight(1, 1, 82, (g, ox, oy) => {
      const base = r3Base[v];
      // G10: pale-cream brick tower under a saturated terracotta roof cap —
      // the hospital's #d8d5ca helipad stays a clear >= 12 distance from these
      const { W, S, E, N } = prism(g, ox, oy, 1, 1, 68, base, { top: R_ROOF[v] });
      windows(g, up(W, 0), up(S, 0), 68, 6, 3, 0.6, "#ffe9a0", "#20242c", GLOW_WARM, 0.4);
      windows(g, up(S, 0), up(E, 0), 68, 6, 3, 0.6, "#ffe9a0", "#20242c", GLOW_WARM, 0.4);
      // G9: no mast here — the beacon is a C3-only signature now. R3 roofs
      // get residential furniture on a tar deck behind the parapet.
      const [cx, cy] = roofDeck(g, ox, oy, 1, 1, 68, shade(base, 0.55), "rgba(24,20,16,.9)");
      // G10: warm coping cap along the two back parapet edges
      g.strokeStyle = shade(R_ROOF[v], 1.15); g.lineWidth = 1.8;
      g.beginPath();
      g.moveTo(cx - HW * 0.82, cy); g.lineTo(cx, cy - HH * 0.82);
      g.lineTo(cx + HW * 0.82, cy); g.stroke();
      waterTank(g, cx - 9 + (R() * 4 | 0), cy + 2);
      bulkhead(g, cx + 8, cy + 1 + (R() * 3 | 0), base);
      if (v % 2) clothesline(g, cx - 2, cy + 9, R);
      else { planter(g, cx - 15, cy + 3); planter(g, cx + 2, cy + 9); }
    })));
  }

  /* ---- commercial ---- */
  // G10: commercial = cool glass blues / teals / grays. Facades are muted
  // cool blue-grays (hue 180-260); the punch lives in the bright glass crowns
  // and the saturated cool storefront awnings.
  const c1Base = ["#a9b3bc", "#b0bbc4", "#a7b3bc", "#acb7c0", "#b4bdc5"];
  const c2Base = ["#91a2b0", "#96a8b7", "#8c9fa7", "#92a4b7", "#9daebc"];
  const c3Glass = ["#546d84", "#4b6d7b", "#5a6e83", "#4d727d", "#606e84"];
  const C_ROOF = ["#79b0c8", "#7ec0c4", "#88b8cc", "#7ab4c6", "#8cbcce"];
  for (let v = 0; v < NV; v++) {
    c1.push(withJitter(mkSprite(1, 1, 30, (g, ox, oy) => {
      const base = c1Base[v];
      const { W, S, E } = prism(g, ox, oy, 1, 1, 18, base);
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
      // G10: bright cool crown for roof-line punch over the muted facade
      const { W, S, E } = prism(g, ox, oy, 1, 1, 44, base, { top: C_ROOF[v] });
      windows(g, up(W, 0), up(S, 0), 44, 4, 3, 0.65, "#cfe8ff", "#20242c", GLOW_COOL);
      windows(g, up(S, 0), up(E, 0), 44, 4, 4, 0.65, "#cfe8ff", "#20242c", GLOW_COOL);
      // G9: gravel deck behind a 1px parapet plus seeded service gear
      const [cx, cy] = roofDeck(g, ox, oy, 1, 1, 44, shade(base, 0.55), "rgba(16,16,20,.85)");
      roofClutter(g, cx, cy, 3, R);
    })));
    // G9: the mast + red beacon is a C3-only signature carried by exactly
    // 2 of the 5 variants; the tip bakes in its lit state and the renderer
    // blinks it live via spr.beacon (phase-offset per tower)
    const c3mast = v === 1 || v === 3;
    const c3spr = withNight(1, 1, 104, (g, ox, oy) => {
      const glass = c3Glass[v];
      const { W, S, E, N } = prism(g, ox, oy, 1, 1, 88, glass,
        { top: shade(glass, 1.5), left: shade(glass, 0.62), right: shade(glass, 0.88) });
      windows(g, up(W, 0), up(S, 0), 88, 8, 3, 0.75, "#eaf6ff", shade(glass, 0.45), GLOW_COOL);
      windows(g, up(S, 0), up(E, 0), 88, 8, 3, 0.75, "#eaf6ff", shade(glass, 0.5), GLOW_COOL);
      // G9: service deck on the glass crown
      const [cx, cy] = roofDeck(g, ox, oy, 1, 1, 88, shade(glass, 1.12), "rgba(16,20,28,.8)");
      roofClutter(g, cx + 4, cy + 3, 2 + (v & 1), R);
      if (c3mast) {
        g.strokeStyle = "#222"; g.lineWidth = 2;
        g.beginPath(); g.moveTo(ox, N[1] - 88); g.lineTo(ox, N[1] - 102); g.stroke();
        g.fillStyle = "#f33"; g.fillRect(ox - 1.5, N[1] - 104, 3, 3);
      }
      // lit lobby spilling onto the plaza (G2: own layer, suppressible)
      groundPool(S[0], S[1] - 2, 12, 5, GLOW_COOL);
    });
    // beacon tip offset from the anchor center, for the live blink pass —
    // set BEFORE withJitter so every value-jittered copy inherits it (G10)
    if (c3mast) c3spr.beacon = { x: -1.5, y: -(HH + 104) };
    c3.push(withJitter(c3spr));
  }

  /* ---- industrial ---- */
  // G10: industrial = desaturated ochre / rust / concrete (saturation <= 0.35,
  // warm-neutral hue) — clearly grayer than the warm-brick residential so the
  // two never trade places, and the smokestacks stay an industrial-only mark.
  const i1Base = ["#a39c90", "#9b968e", "#a79e8f", "#959089", "#a79e8d"];
  const i2Base = ["#88837b", "#847f79", "#8b847c", "#7f7d78", "#888176"];
  const i3Base = ["#757068", "#716f6c", "#79726a", "#6f6d69", "#77706c"];
  // G10: rust/ochre roof caps — the industrial "punch" that keeps the roof
  // family saturated while the concrete facades stay grey (roofs/trim rule).
  const I_ROOF = ["#9a6a3c", "#8f6236", "#a06e3e", "#8a5e34", "#9c6a3a"];
  for (let v = 0; v < NV; v++) {
    i1.push(withJitter(mkSprite(1, 1, 30, (g, ox, oy) => {
      const base = i1Base[v];
      const cn = prism(g, ox, oy, 1, 1, 20, base);
      // big loading door tagged to ONE world face (M32b) — plainer at the two
      // orientations where that face rotates to an occluded back
      onFace(FE_PX, cn, (p0, p1) => {
        const fm = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
        g.fillStyle = "#5a5148";
        poly(g, [up(p0, 2), up(p1, 2), up(p1, 14), up(p0, 14)].map(p => [
          p[0] * 0.5 + fm[0] * 0.5, p[1] * 0.5 + fm[1] * 0.5]), "#5a5148");
      });
    })));
    i2.push(withJitter(withNight(1, 1, 56, (g, ox, oy) => {
      const base = i2Base[v];
      const { W, S, E, N } = prism(g, ox, oy, 1, 1, 28, base, { top: I_ROOF[v] });
      windows(g, up(S, 0), up(E, 0), 28, 2, 3, 0.4, "#ffd27f", "#20242c", GLOW_SODIUM);
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
        windows(g, up(W, 0), up(S, 0), 28, 2, 3, 0.4, "#ffd27f", "#20242c", GLOW_SODIUM);
        ART_RNG = swPrev;
      }
      stack(g, ox - 10, N[1] - 24, 22, 6);
      groundPool(ox + 8, oy + 4, 15, 6, GLOW_SODIUM); // night-shift yard flood
      if (GLOWG) { // stack beacon stays with the window glow
        GLOWG.fillStyle = "#ff6a4a";
        GLOWG.fillRect(ox - 11, N[1] - 49, 3, 3);
      }
    })));
    i3.push(withJitter(withNight(1, 1, 74, (g, ox, oy) => {
      const base = i3Base[v];
      const { W, S, E, N } = prism(g, ox, oy, 1, 1, 38, base, { top: I_ROOF[v] });
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
    poly(g, [[tx, ty - 61], [tx + 8, ty - 58], [tx, ty - 55]], "#3555ff");
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
  };
  const autumnSet = Object.assign({}, summerSet, {
    r1: seasonR1("autumn"), park: mkSprite(1, 1, 22, parkDraw("autumn")),
  });
  bset = { summer: summerSet, spring: summerSet, autumn: autumnSet, winter: winterSet };

    ART_RNG = facingPrev; // restore the shared stream (a no-op for facing 0)
    return {
      bset,
      fams: { park, r1, r2, r3, c1, c2, c3, i1, i2, i3, police, firesta, coal,
              solar, gas, wind, school, hospital, mayor, stadium },
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
    case OV.PIPE:  return SPR.pipe[rot4(pipeMask(city, i), cam.r)];
    case OV.WATERTOWER: return SPR.watertower;
    case OV.PUMP:  return SPR.pump;
    case OV.PARK:  return B.park;
    case OV.RUBBLE: return SPR.rubble;
    case OV.ZR:    return zone([B.r1, B.r2, B.r3], SPR.zoneR);
    case OV.ZC:    return zone([B.c1, B.c2, B.c3], SPR.zoneC);
    case OV.ZI:    return zone([B.i1, B.i2, B.i3], SPR.zoneI);
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
  }
  return null;
}

function roadMask(city, i) {
  const x = i % MAP, y = (i / MAP) | 0;
  let m = 0;
  const road = (X, Y) => city.inMap(X, Y) &&
    (city.over[city.idx(X, Y)] === OV.ROAD || city.over[city.idx(X, Y)] === OV.WIREROAD); // M26: road connects through a crossing
  if (road(x, y - 1)) m |= 1;
  if (road(x + 1, y)) m |= 2;
  if (road(x, y + 1)) m |= 4;
  if (road(x - 1, y)) m |= 8;
  return m;
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

function wireMask(city, i) {
  const x = i % MAP, y = (i / MAP) | 0;
  let m = 0;
  const conn = (X, Y) => {
    if (!city.inMap(X, Y)) return false;
    const t = city.over[city.idx(X, Y)];
    // M24: exclude the water overlays so a power line never draws an arm toward
    // a pipe/tower/pump (the two utilities are visually separate networks).
    return t !== OV.NONE && t !== OV.ROAD && t !== OV.RUBBLE && !isWaterOv(t);
  };
  if (conn(x, y - 1)) m |= 1;
  if (conn(x + 1, y)) m |= 2;
  if (conn(x, y + 1)) m |= 4;
  if (conn(x - 1, y)) m |= 8;
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
