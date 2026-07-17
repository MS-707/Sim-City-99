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

function mkSprite(w, h, extraTop, draw) {
  const cw = (w + h) * HW, ch = extraTop + (w + h) * HH;
  const c = document.createElement("canvas");
  c.width = cw; c.height = ch;
  const g = c.getContext("2d");
  const ox = h * HW, oy = extraTop + HH;
  draw(g, ox, oy, w, h);
  return { c, ox, oy };
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

// solid iso prism: top + two visible faces
function prism(g, ox, oy, w, h, ht, base, opts = {}) {
  const { N, E, S, W } = corners(ox, oy, w, h);
  const topC = opts.top || shade(base, 1.3);
  const leftC = opts.left || shade(base, 0.72);
  const rightC = opts.right || shade(base, 0.92);
  poly(g, [up(W, ht), up(S, ht), S, W], leftC);           // SW face
  poly(g, [up(S, ht), up(E, ht), E, S], rightC);          // SE face
  poly(g, [up(N, ht), up(E, ht), up(S, ht), up(W, ht)], topC, shade(base, 0.55));
  return { N, E, S, W };
}

// rows x cols of window parallelograms on a face whose bottom edge runs p0->p1.
// While GLOWG is set (the boot-time night bake in withNight), day-lit panes
// are also stamped onto the glow layer in the zone's own light color (G1).
let GLOWG = null;
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
      const isLit = Math.random() < lit;
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

// build a sprite plus a prebaked night variant (M10/G1): the draw callback
// runs once with GLOWG set, so windows() bakes its day-lit panes, in the
// zone's light color, into a glow layer; a cheap 8-tap stamp adds a faint
// halo. All of this happens at boot inside buildSprites — renderFrame only
// ever *looks up* spr.night.
function withNight(w, h, extraTop, draw) {
  const cw = (w + h) * HW, ch = extraTop + (w + h) * HH;
  const glow = document.createElement("canvas");
  glow.width = cw; glow.height = ch;
  GLOWG = glow.getContext("2d");
  const spr = mkSprite(w, h, extraTop, draw);
  GLOWG = null;
  const night = document.createElement("canvas");
  night.width = cw; night.height = ch;
  const g = night.getContext("2d");
  g.globalAlpha = 0.08; // faint halo around every lit pane (G1: tamed bloom)
  for (const [dx, dy] of [[-2, 0], [2, 0], [0, -2], [0, 2], [-1, -1], [1, -1], [-1, 1], [1, 1]])
    g.drawImage(glow, dx, dy);
  g.globalAlpha = 1;
  g.drawImage(glow, 0, 0);
  spr.night = { c: night, ox: spr.ox, oy: spr.oy };
  return spr;
}

/* ---- seasonal terrain palettes (M12) ----
   Terrain-family sprites (grass, water, shore, forest, road banks) are baked
   once per season at boot — the same draw code runs four times with a palette
   parameter. The renderer just looks up SPR.season[seasonOf(city.month)]. */
const SEASON_PAL = {
  summer: {
    grass: ["#4a9d44", "#459743", "#50a349", "#43903f"],
    fleckA: "rgba(255,255,255,.08)", fleckB: "rgba(0,60,0,.15)",
    floor: "#3d8a3a", leafLo: "#1d6e2a", leafHi: "#2f9c3f", snowCap: null,
    waterTop: "#2a6fbe", waterBot: "#1c4f92",
    wave: "rgba(210,235,255,.35)", glint: "rgba(220,240,255,.5)",
    sand: "#dcc37a", sandHi: "#eeda9c", foam: "rgba(255,255,255,.55)",
  },
  spring: { // fresh greens, blossom flecks in the grass
    grass: ["#55ac4b", "#4ea44b", "#5db252", "#4a9e46"],
    fleckA: "rgba(255,215,235,.4)", fleckB: "rgba(0,70,0,.15)",
    floor: "#46993f", leafLo: "#2a8a36", leafHi: "#4fb453", snowCap: null,
    waterTop: "#2f77c4", waterBot: "#205598",
    wave: "rgba(210,235,255,.35)", glint: "rgba(220,240,255,.5)",
    sand: "#dcc37a", sandHi: "#eeda9c", foam: "rgba(255,255,255,.55)",
  },
  autumn: { // dry stubble lawns, orange/red canopies
    grass: ["#9c9a48", "#948f3f", "#a4a04e", "#8e8a3e"],
    fleckA: "rgba(230,180,90,.3)", fleckB: "rgba(90,60,10,.2)",
    floor: "#7e7a38", leafLo: "#b0541e", leafHi: "#d2691e", snowCap: null,
    waterTop: "#2a6ab2", waterBot: "#1c4a86",
    wave: "rgba(210,235,255,.3)", glint: "rgba(220,240,255,.45)",
    sand: "#d8bd74", sandHi: "#ead597", foam: "rgba(255,255,255,.5)",
  },
  winter: { // snowed-under lawns, pine canopies with snow caps, icy shores
    grass: ["#e9edf3", "#e4e9f0", "#eef1f6", "#e0e6ee"],
    fleckA: "rgba(255,255,255,.5)", fleckB: "rgba(165,182,210,.35)",
    floor: "#dfe5ee", leafLo: "#2c5a34", leafHi: "#38703f", snowCap: "#eef2f7",
    waterTop: "#a8c8de", waterBot: "#8fb4d0",
    wave: "rgba(255,255,255,.4)", glint: "rgba(240,248,255,.7)",
    sand: "#c9d6e4", sandHi: "#e8eef5", foam: "rgba(255,255,255,.7)",
  },
};

function drawTree(g, x, y, s, tint = 1, pal = null) {
  const lo = pal ? pal.leafLo : "#1d6e2a", hi = pal ? pal.leafHi : "#2f9c3f";
  g.strokeStyle = "#5d4123"; g.lineWidth = 2;
  g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - s * 0.8); g.stroke();
  g.fillStyle = shade(lo, tint);
  g.beginPath(); g.ellipse(x, y - s * 1.1, s * 0.55, s * 0.65, 0, 0, 7); g.fill();
  g.fillStyle = shade(hi, tint);
  g.beginPath(); g.ellipse(x - s * 0.15, y - s * 1.3, s * 0.4, s * 0.45, 0, 0, 7); g.fill();
  if (pal && pal.snowCap) { // winter: fresh snow load on the crown
    g.fillStyle = pal.snowCap;
    g.beginPath(); g.ellipse(x - s * 0.1, y - s * 1.42, s * 0.42, s * 0.28, 0, 0, 7); g.fill();
  }
}

function tinyHouse(g, cx, cy, s, wall, roof) {
  // little iso cottage: body + pitched roof, footprint ~s wide
  const hw = s / 2, hh = s / 4, ht = s * 0.42;
  const N = [cx, cy - hh], E = [cx + hw, cy], S = [cx, cy + hh], W = [cx - hw, cy];
  poly(g, [up(W, ht), up(S, ht), S, W], shade(wall, 0.7));
  poly(g, [up(S, ht), up(E, ht), E, S], shade(wall, 0.95));
  // roof ridge runs W->E raised
  const ridge = ht + s * 0.34;
  poly(g, [up(W, ht), up(N, ht), up(E, ht), [cx + hw * 0.1, cy - ridge], [cx - hw * 0.1, cy - ridge]], shade(roof, 1.05));
  poly(g, [up(W, ht), up(S, ht), up(E, ht), [cx + hw * 0.1, cy - ridge], [cx - hw * 0.1, cy - ridge]], shade(roof, 0.75));
  // door
  g.fillStyle = "#3a2a18";
  g.fillRect(cx + hw * 0.25, cy + hh * 0.2 - ht, s * 0.13, ht * 0.6);
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

  // ---- terrain families, baked once per season (M12) ----
  // The same draw code runs for each of the four palettes; renderFrame picks
  // SPR.season[seasonOf(city.month)]. Nothing is (re)built after boot.
  SPR.season = {};
  const TREES_PER_TIER = [2, 4, 7];  // sparse / medium / dense
  const TREE_SIZE_TIER = [10, 12, 14];
  for (const sk of ["winter", "spring", "summer", "autumn"]) {
    const P = SEASON_PAL[sk];
    const fam = { grass: [], water: [], shore: [], forest: [] };

    // grass (or snowpack, or dry stubble)
    for (let v = 0; v < 4; v++) {
      fam.grass.push(mkSprite(1, 1, 0, (g, ox, oy) => {
        diamondPath(g, ox, oy);
        g.fillStyle = P.grass[v];
        g.fill();
        g.strokeStyle = "rgba(0,0,0,.18)"; g.lineWidth = 1; g.stroke();
        g.save(); diamondPath(g, ox, oy); g.clip();
        g.fillStyle = P.fleckA;
        for (let k = 0; k < 14; k++) g.fillRect(ox - HW + R() * TW, oy - HH + R() * TH, 2, 1);
        g.fillStyle = P.fleckB;
        for (let k = 0; k < 10; k++) g.fillRect(ox - HW + R() * TW, oy - HH + R() * TH, 2, 1);
        g.restore();
      }));
    }

    // water: a small family of frames cycled by the render frame counter.
    // Wave/glint positions are pure arithmetic in (k, f) so every boot builds
    // pixel-identical frames and equal frame values always render identically.
    for (let f = 0; f < 3; f++) {
      fam.water.push(mkSprite(1, 1, 0, (g, ox, oy) => {
        diamondPath(g, ox, oy);
        const gr = g.createLinearGradient(ox, oy - HH, ox, oy + HH);
        gr.addColorStop(0, P.waterTop); gr.addColorStop(1, P.waterBot);
        g.fillStyle = gr; g.fill();
        g.strokeStyle = "rgba(0,0,40,.25)"; g.stroke();
        g.save(); diamondPath(g, ox, oy); g.clip();
        g.strokeStyle = P.wave; g.lineWidth = 1;
        for (let k = 0; k < 4; k++) {
          const wy = oy - HH + 4 + k * 7 + ((k * 5 + f * 2) % 5);
          const wx = ox - HW + ((k * 13 + f * 11) % 40);
          g.beginPath(); g.moveTo(wx, wy);
          g.bezierCurveTo(wx + 8, wy - 2, wx + 14, wy + 2, wx + 22, wy); g.stroke();
        }
        g.fillStyle = P.glint; // shimmering glints (ice sparkle in winter)
        for (let k = 0; k < 3; k++) {
          g.fillRect(ox - HW + 4 + ((k * 23 + f * 17) % 54),
                     oy - HH + 3 + ((k * 11 + f * 7) % 26), 2, 1);
        }
        g.restore();
      }));
    }

    // shoreline bands (16 masks; bit0=N bit1=E bit2=S bit3=W) — sand in
    // summer, rime ice in winter. Drawn over a water tile on its land-facing
    // edges AND over a land tile on its water-facing edges, so the treatment
    // straddles the seam with no hard line.
    for (let m = 0; m < 16; m++) {
      fam.shore.push(mkSprite(1, 1, 4, (g, ox, oy) => {
        if (!m) return; // open water / inland: no band
        const N = [ox, oy - HH], E = [ox + HW, oy], S = [ox, oy + HH], W = [ox - HW, oy];
        const edges = [[N, E], [E, S], [S, W], [W, N]]; // bit order N,E,S,W
        // clip to a slightly expanded diamond so the band hugs both sides of the seam
        g.save();
        g.translate(ox, oy); g.scale((TW + 6) / TW, (TH + 3) / TH); g.translate(-ox, -oy);
        diamondPath(g, ox, oy);
        g.restore();
        g.save(); g.clip();
        const lerp = (P0, t) => [P0[0] + (ox - P0[0]) * t, P0[1] + (oy - P0[1]) * t];
        for (let b = 0; b < 4; b++) {
          if (!(m & (1 << b))) continue;
          const [P0, P1] = edges[b];
          g.lineCap = "butt";
          g.strokeStyle = P.sand; g.lineWidth = 7; // main band on the edge
          g.beginPath(); g.moveTo(P0[0], P0[1]); g.lineTo(P1[0], P1[1]); g.stroke();
          g.strokeStyle = P.sandHi; g.lineWidth = 3; // dry highlight
          g.beginPath(); g.moveTo(...lerp(P0, 0.06)); g.lineTo(...lerp(P1, 0.06)); g.stroke();
          g.strokeStyle = P.foam; g.lineWidth = 1.4; // surf foam / ice fringe
          g.beginPath(); g.moveTo(...lerp(P0, 0.22)); g.lineTo(...lerp(P1, 0.22)); g.stroke();
        }
        g.restore();
      }));
    }

    // forest: 3 density tiers x 3 variants (tier picked by neighbor count)
    for (let d = 0; d < 3; d++) {
      const tier = [];
      for (let v = 0; v < 3; v++) {
        tier.push(mkSprite(1, 1, 26, (g, ox, oy) => {
          diamondPath(g, ox, oy);
          g.fillStyle = P.floor; g.fill();
          g.strokeStyle = "rgba(0,0,0,.18)"; g.stroke();
          const n = TREES_PER_TIER[d] + (v % 2);
          for (let k = 0; k < n; k++) {
            drawTree(g, ox - 14 + ((k * 9 + v * 7 + d * 3) % 28) + R() * 4,
                     oy + 7 - ((k * 5 + v * 3) % 11),
                     TREE_SIZE_TIER[d] + R() * 4, 0.85 + R() * 0.4, P);
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
  const roadSprite = (m, snow) => mkSprite(1, 1, 0, (g, ox, oy) => {
    const C = [ox, oy];
    const asphalt = "#55565e", line = "#d8c24a";
    // arms
    for (let b = 0; b < 4; b++) {
      if (!(m & (1 << b)) && m !== 0) continue;
      const [P0, P1] = EDGE[b];
      const mid = [(P0[0] + P1[0]) / 2, (P0[1] + P1[1]) / 2];
      const e1 = [P0[0] + (P1[0] - P0[0]) * 0.28, P0[1] + (P1[1] - P0[1]) * 0.28];
      const e2 = [P0[0] + (P1[0] - P0[0]) * 0.72, P0[1] + (P1[1] - P0[1]) * 0.72];
      const c1 = [C[0] + e1[0] - mid[0], C[1] + e1[1] - mid[1]];
      const c2 = [C[0] + e2[0] - mid[0], C[1] + e2[1] - mid[1]];
      poly(g, [e1, e2, c2, c1], asphalt);
      if (snow) { // plowed snow banks along both arm edges
        g.strokeStyle = "#e8edf3"; g.lineWidth = 2.6; g.lineCap = "round";
        g.beginPath(); g.moveTo(e1[0], e1[1]); g.lineTo(c1[0], c1[1]); g.stroke();
        g.beginPath(); g.moveTo(e2[0], e2[1]); g.lineTo(c2[0], c2[1]); g.stroke();
        g.lineCap = "butt";
      }
      if (m & (1 << b)) { // center line dash
        g.strokeStyle = line; g.lineWidth = 1.4;
        g.setLineDash([4, 4]);
        g.beginPath(); g.moveTo(C[0], C[1]); g.lineTo(mid[0], mid[1]); g.stroke();
        g.setLineDash([]);
      }
    }
    // center pad
    poly(g, [[C[0] - 6.4, C[1] - 3.2], [C[0] + 6.4, C[1] - 3.2],
             [C[0] + 6.4, C[1] + 3.2], [C[0] - 6.4, C[1] + 3.2]], asphalt);
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

  // ---- park ----
  SPR.park = mkSprite(1, 1, 22, (g, ox, oy) => {
    diamondPath(g, ox, oy);
    g.fillStyle = "#57b04f"; g.fill();
    g.strokeStyle = "rgba(0,0,0,.2)"; g.stroke();
    g.fillStyle = "#8fd3f0";
    g.beginPath(); g.ellipse(ox + 8, oy + 4, 9, 4.5, 0, 0, 7); g.fill();
    g.strokeStyle = "#7ba7c2"; g.stroke();
    drawTree(g, ox - 14, oy + 2, 12, 1.05);
    drawTree(g, ox - 2, oy - 4, 10, 0.9);
    for (let k = 0; k < 8; k++) {
      g.fillStyle = ["#ff5d5d", "#ffd34e", "#ff8ee0"][k % 3];
      g.fillRect(ox - 20 + R() * 40, oy - 4 + R() * 12, 2, 2);
    }
  });

  /* ---- residential (5 variants per level) ---- */
  const NV = 5; // zone sprite variants per level
  SPR.r1 = []; SPR.r2 = []; SPR.r3 = [];
  const houseWalls = ["#e8d9b0", "#cfe0ee", "#efc8c0", "#d6e8c2", "#e6d0e8"];
  const houseRoofs = ["#a03c2c", "#3c5a80", "#6b4f8a", "#4f7a3c", "#7a5a2c"];
  for (let v = 0; v < NV; v++) {
    SPR.r1.push(mkSprite(1, 1, 30, (g, ox, oy) => {
      diamondPath(g, ox, oy);
      g.fillStyle = "#5aa552"; g.fill(); g.strokeStyle = "rgba(0,0,0,.18)"; g.stroke();
      tinyHouse(g, ox - 10, oy + 2, 22, houseWalls[v], houseRoofs[v]);
      tinyHouse(g, ox + 12, oy - 2, 18, houseWalls[(v + 1) % NV], houseRoofs[(v + 1) % NV]);
      drawTree(g, ox + 22, oy + 6, 8, 1);
    }));
    SPR.r2.push(withNight(1, 1, 46, (g, ox, oy) => {
      const base = ["#b06a4a", "#9c8a6e", "#7e8fa0", "#8a9a7a", "#a87888"][v];
      const { W, S, E } = prism(g, ox, oy, 1, 1, 36, base);
      windows(g, up(W, 0), up(S, 0), 36, 3, 2, 0.55, "#ffe9a0", "#20242c", GLOW_WARM, 0.4);
      windows(g, up(S, 0), up(E, 0), 36, 3, 3, 0.55, "#ffe9a0", "#20242c", GLOW_WARM, 0.4);
      g.fillStyle = "#4c4c52"; g.fillRect(ox - 6, oy - 36 - HH + 2, 8, 5); // roof AC
    }));
    SPR.r3.push(withNight(1, 1, 82, (g, ox, oy) => {
      const base = ["#c9c1ae", "#a9b6c4", "#c7a9a1", "#b4c4ae", "#cbb98e"][v];
      const { W, S, E, N } = prism(g, ox, oy, 1, 1, 68, base);
      windows(g, up(W, 0), up(S, 0), 68, 6, 3, 0.6, "#ffe9a0", "#20242c", GLOW_WARM, 0.4);
      windows(g, up(S, 0), up(E, 0), 68, 6, 3, 0.6, "#ffe9a0", "#20242c", GLOW_WARM, 0.4);
      g.strokeStyle = "#333"; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(ox, N[1] - 68); g.lineTo(ox, N[1] - 80); g.stroke();
      g.fillStyle = "#e33"; g.fillRect(ox - 1, N[1] - 82, 3, 3);
    }));
  }

  /* ---- commercial ---- */
  SPR.c1 = []; SPR.c2 = []; SPR.c3 = [];
  for (let v = 0; v < NV; v++) {
    SPR.c1.push(mkSprite(1, 1, 30, (g, ox, oy) => {
      const base = ["#cdbfa3", "#c3b3a8", "#b8c3ad", "#c9bdc6", "#b3bcc3"][v];
      const { W, S, E } = prism(g, ox, oy, 1, 1, 18, base);
      // storefront glass band + awning
      const aw = ["#c0392b", "#2980b9", "#27ae60", "#8e44ad", "#d97e12"][v];
      g.fillStyle = "#9fd8e8";
      poly(g, [up(S, 4), up(E, 4), up(E, 13), up(S, 13)], "#9fd8e8");
      poly(g, [up(W, 4), up(S, 4), up(S, 13), up(W, 13)], "#7fb8cc");
      g.fillStyle = aw;
      poly(g, [up(S, 13), up(E, 13), up(E, 17), up(S, 17)], aw);
      poly(g, [up(W, 13), up(S, 13), up(S, 17), up(W, 17)], shade(aw, 0.8));
    }));
    SPR.c2.push(withNight(1, 1, 56, (g, ox, oy) => {
      const base = ["#8ba3b5", "#a39b8b", "#8b9b8f", "#9b8ba3", "#b5a08b"][v];
      const { W, S, E } = prism(g, ox, oy, 1, 1, 44, base);
      windows(g, up(W, 0), up(S, 0), 44, 4, 3, 0.65, "#cfe8ff", "#20242c", GLOW_COOL);
      windows(g, up(S, 0), up(E, 0), 44, 4, 4, 0.65, "#cfe8ff", "#20242c", GLOW_COOL);
    }));
    SPR.c3.push(withNight(1, 1, 104, (g, ox, oy) => {
      const glass = ["#3e6f9e", "#2e8a84", "#7a6a4e", "#5e4e8e", "#8e4e5e"][v];
      const { W, S, E, N } = prism(g, ox, oy, 1, 1, 88, glass,
        { top: shade(glass, 1.5), left: shade(glass, 0.62), right: shade(glass, 0.88) });
      windows(g, up(W, 0), up(S, 0), 88, 8, 3, 0.75, "#eaf6ff", shade(glass, 0.45), GLOW_COOL);
      windows(g, up(S, 0), up(E, 0), 88, 8, 3, 0.75, "#eaf6ff", shade(glass, 0.5), GLOW_COOL);
      g.strokeStyle = "#222"; g.lineWidth = 2;
      g.beginPath(); g.moveTo(ox, N[1] - 88); g.lineTo(ox, N[1] - 102); g.stroke();
      g.fillStyle = "#f33"; g.fillRect(ox - 1.5, N[1] - 104, 3, 3);
      if (GLOWG) { // lit lobby spilling onto the plaza
        GLOWG.fillStyle = GLOW_COOL;
        GLOWG.beginPath(); GLOWG.ellipse(S[0], S[1] - 2, 12, 5, 0, 0, 7); GLOWG.fill();
      }
    }));
  }

  /* ---- industrial ---- */
  SPR.i1 = []; SPR.i2 = []; SPR.i3 = [];
  for (let v = 0; v < NV; v++) {
    SPR.i1.push(mkSprite(1, 1, 30, (g, ox, oy) => {
      const base = ["#b09a72", "#a8a08a", "#9a8a80", "#8a9a90", "#b0a060"][v];
      const { W, S, E } = prism(g, ox, oy, 1, 1, 20, base);
      g.fillStyle = "#5a5148"; // big loading door on SE face
      poly(g, [up(S, 2), up(E, 2), up(E, 14), up(S, 14)].map(p => [
        p[0] * 0.5 + (S[0] + E[0]) / 4, p[1] * 0.5 + (S[1] + E[1]) / 4]), "#5a5148");
    }));
    SPR.i2.push(withNight(1, 1, 56, (g, ox, oy) => {
      const base = ["#8f7f6f", "#7f8272", "#94836a", "#6f7f8f", "#877a88"][v];
      const { W, S, E, N } = prism(g, ox, oy, 1, 1, 28, base);
      windows(g, up(S, 0), up(E, 0), 28, 2, 3, 0.4, "#ffd27f", "#20242c", GLOW_SODIUM);
      stack(g, ox - 10, N[1] - 24, 22, 6);
      if (GLOWG) { // night shift: yard floodlight pool + stack beacon
        GLOWG.fillStyle = GLOW_SODIUM;
        GLOWG.beginPath(); GLOWG.ellipse(ox + 8, oy + 4, 15, 6, 0, 0, 7); GLOWG.fill();
        GLOWG.fillStyle = "#ff6a4a";
        GLOWG.fillRect(ox - 11, N[1] - 49, 3, 3);
      }
    }));
    SPR.i3.push(withNight(1, 1, 74, (g, ox, oy) => {
      const base = ["#77706a", "#6f7078", "#7c6f62", "#6a7770", "#78645e"][v];
      const { W, S, E, N } = prism(g, ox, oy, 1, 1, 38, base);
      windows(g, up(W, 0), up(S, 0), 38, 2, 2, 0.35, "#ffd27f", "#20242c", GLOW_SODIUM);
      stack(g, ox - 12, N[1] - 34, 30, 7);
      stack(g, ox + 2, N[1] - 30, 24, 6);
      g.fillStyle = "#a8b2ba"; // storage tank
      g.beginPath(); g.ellipse(ox + 16, N[1] - 30, 7, 4, 0, 0, 7); g.fill();
      g.fillRect(ox + 9, N[1] - 30, 14, 8);
      g.beginPath(); g.ellipse(ox + 16, N[1] - 22, 7, 4, 0, 0, 7); g.fill();
      if (GLOWG) { // night shift: yard floodlight pool + stack beacons
        GLOWG.fillStyle = GLOW_SODIUM;
        GLOWG.beginPath(); GLOWG.ellipse(ox - 2, oy + 6, 17, 7, 0, 0, 7); GLOWG.fill();
        GLOWG.fillStyle = "#ff6a4a";
        GLOWG.fillRect(ox - 13, N[1] - 67, 3, 3);
        GLOWG.fillRect(ox + 1, N[1] - 57, 3, 3);
      }
    }));
  }

  /* ---- civic 2x2 buildings ---- */
  SPR.police = withNight(2, 2, 46, (g, ox, oy) => {
    const { W, S, E } = prism(g, ox, oy, 2, 2, 30, "#b9c4d4");
    windows(g, up(W, 0), up(S, 0), 30, 2, 4, 0.7, "#dce9ff", "#20242c", GLOW_COOL);
    windows(g, up(S, 0), up(E, 0), 30, 2, 4, 0.7, "#dce9ff", "#20242c", GLOW_COOL);
    // blue band + badge
    poly(g, [up(S, 22), up(E, 22), up(E, 28), up(S, 28)], "#173e8c");
    poly(g, [up(W, 22), up(S, 22), up(S, 28), up(W, 28)], "#102e6b");
    g.fillStyle = "#ffd94e";
    g.beginPath(); g.arc(S[0], S[1] - 25, 3.4, 0, 7); g.fill();
  });

  SPR.firesta = mkSprite(2, 2, 46, (g, ox, oy) => {
    const { W, S, E } = prism(g, ox, oy, 2, 2, 28, "#c8574a");
    // garage doors on SE face
    for (let k = 0; k < 3; k++) {
      const t0 = 0.12 + k * 0.28, t1 = t0 + 0.2;
      const p = (t) => [S[0] + (E[0] - S[0]) * t, S[1] + (E[1] - S[1]) * t];
      poly(g, [up(p(t0), 3), up(p(t1), 3), up(p(t1), 18), up(p(t0), 18)], "#e8e2d2");
    }
    poly(g, [up(W, 24), up(S, 24), up(S, 28), up(W, 28)], "#8c2c22");
    poly(g, [up(S, 24), up(E, 24), up(E, 28), up(S, 28)], "#a53328");
  });

  SPR.coal = withNight(2, 2, 78, (g, ox, oy) => {
    const { W, S, E, N } = prism(g, ox, oy, 2, 2, 34, "#5c5c64");
    windows(g, up(S, 0), up(E, 0), 34, 2, 4, 0.5, "#ffb54e", "#20242c", GLOW_SODIUM);
    stack(g, ox - 18, N[1] - 26, 44, 10, true);
    stack(g, ox + 14, N[1] - 20, 36, 9, true);
    g.fillStyle = "#2f2f36"; // coal pile
    g.beginPath(); g.ellipse(S[0] + 14, S[1] - 40, 12, 6, 0, 0, 7); g.fill();
  });

  SPR.solar = mkSprite(2, 2, 30, (g, ox, oy) => {
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

  // School: red-brick block with a white bell tower and a small yard
  SPR.school = withNight(2, 2, 56, (g, ox, oy) => {
    const { W, S, E, N } = prism(g, ox, oy, 2, 2, 24, "#b5533c");
    windows(g, up(W, 0), up(S, 0), 24, 2, 3, 0.7, "#ffe9a0");
    windows(g, up(S, 0), up(E, 0), 24, 2, 3, 0.7, "#ffe9a0");
    // double doors on the SE face
    const dm = (t) => [S[0] + (E[0] - S[0]) * t, S[1] + (E[1] - S[1]) * t];
    poly(g, [up(dm(0.42), 2), up(dm(0.58), 2), up(dm(0.58), 14), up(dm(0.42), 14)], "#e8e0d0");
    g.strokeStyle = "#6b3020"; g.lineWidth = 1;
    g.beginPath(); g.moveTo(...up(dm(0.5), 2)); g.lineTo(...up(dm(0.5), 14)); g.stroke();
    // bell tower on the roof center
    const tx = ox, ty = oy + HH - 24;
    g.fillStyle = "#ece4d4"; g.fillRect(tx - 6, ty - 22, 12, 19);
    g.fillStyle = "#d9d0bc"; g.fillRect(tx - 6, ty - 22, 5, 19);
    g.fillStyle = "#2b2b30"; g.fillRect(tx - 4, ty - 18, 8, 7); // bell arch
    g.fillStyle = "#e0b23c";
    g.beginPath(); g.arc(tx, ty - 15, 2.6, 0, 7); g.fill();     // the bell
    g.fillStyle = "#7a3a2a";
    g.beginPath(); g.moveTo(tx - 8, ty - 22); g.lineTo(tx + 8, ty - 22);
    g.lineTo(tx, ty - 32); g.closePath(); g.fill();             // tower roof
    // flag by the entrance
    g.strokeStyle = "#d8d8e0"; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(E[0] - 12, E[1] - 4); g.lineTo(E[0] - 12, E[1] - 34); g.stroke();
    g.fillStyle = "#3555ff";
    g.beginPath(); g.moveTo(E[0] - 12, E[1] - 34); g.lineTo(E[0] - 2, E[1] - 31);
    g.lineTo(E[0] - 12, E[1] - 28); g.closePath(); g.fill();
  });

  // Hospital: white slab with blue window bands and a red-cross helipad roof
  SPR.hospital = withNight(2, 2, 62, (g, ox, oy) => {
    const { W, S, E, N } = prism(g, ox, oy, 2, 2, 34, "#e6e3da");
    windows(g, up(W, 0), up(S, 0), 34, 3, 4, 0.75, "#bfe0f2", "#20242c", GLOW_COOL);
    windows(g, up(S, 0), up(E, 0), 34, 3, 4, 0.75, "#bfe0f2", "#20242c", GLOW_COOL);
    // emergency canopy on SE face
    const dm = (t) => [S[0] + (E[0] - S[0]) * t, S[1] + (E[1] - S[1]) * t];
    poly(g, [up(dm(0.3), 12), up(dm(0.7), 12), up(dm(0.7), 15), up(dm(0.3), 15)], "#c94040");
    poly(g, [up(dm(0.38), 2), up(dm(0.62), 2), up(dm(0.62), 12), up(dm(0.38), 12)], "#9fd8e8");
    // helipad + red cross on the roof
    const cx = ox, cy = oy + HH - 34;
    g.fillStyle = "#d4d1c6";
    g.beginPath(); g.ellipse(cx, cy, 22, 11, 0, 0, 7); g.fill();
    g.strokeStyle = "#a8a498"; g.lineWidth = 1; g.stroke();
    g.fillStyle = "#d02c2c";
    g.fillRect(cx - 3, cy - 9, 6, 18);
    g.fillRect(cx - 11, cy - 3, 22, 6);
  });

  /* ---- milestone rewards ---- */
  // Mayor's House: stately 1x1 manor with a flag and hedges
  SPR.mayor = mkSprite(1, 1, 40, (g, ox, oy) => {
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
  SPR.stadium = mkSprite(2, 2, 52, (g, ox, oy) => {
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
  // disaster halos: fire glow, UFO beam wash, storm lightning flicker
  SPR.fireGlow = radialSprite(110, [
    [0, "rgba(255,170,80,0.8)"], [0.5, "rgba(255,120,40,0.45)"],
    [1, "rgba(255,80,20,0)"]]);
  SPR.ufoGlow = radialSprite(80, [
    [0, "rgba(160,255,160,0.65)"], [0.5, "rgba(120,255,140,0.3)"],
    [1, "rgba(80,255,120,0)"]]);
  SPR.stormGlow = radialSprite(90, [
    [0, "rgba(200,215,255,0.6)"], [0.5, "rgba(170,190,255,0.28)"],
    [1, "rgba(140,160,255,0)"]]);

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
  // developed zones: variant is a pure function of varnt[] (mod family size)
  const zone = (fams, marker) => {
    if (city.lvl[i] === 0) return marker;
    const fam = fams[city.lvl[i] - 1];
    return fam[city.varnt[i] % fam.length];
  };
  switch (t) {
    case OV.ROAD:  // winter roads show plowed snow banks (M12)
      return (seasonOf(city.month) === "winter" ? SPR.roadWinter : SPR.road)[roadMask(city, i)];
    case OV.WIRE:  return SPR.wire[wireMask(city, i)];
    case OV.PARK:  return SPR.park;
    case OV.RUBBLE: return SPR.rubble;
    case OV.ZR:    return zone([SPR.r1, SPR.r2, SPR.r3], SPR.zoneR);
    case OV.ZC:    return zone([SPR.c1, SPR.c2, SPR.c3], SPR.zoneC);
    case OV.ZI:    return zone([SPR.i1, SPR.i2, SPR.i3], SPR.zoneI);
    case OV.POLICE:  return SPR.police;
    case OV.FIRESTA: return SPR.firesta;
    case OV.COAL:    return SPR.coal;
    case OV.SOLAR:   return SPR.solar;
    case OV.SCHOOL:  return SPR.school;
    case OV.HOSPITAL: return SPR.hospital;
    case OV.MAYOR:   return SPR.mayor;
    case OV.STADIUM: return SPR.stadium;
  }
  return null;
}

function roadMask(city, i) {
  const x = i % MAP, y = (i / MAP) | 0;
  let m = 0;
  const road = (X, Y) => city.inMap(X, Y) && city.over[city.idx(X, Y)] === OV.ROAD;
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
  return fam[city.varnt[i] % fam.length];
}

function wireMask(city, i) {
  const x = i % MAP, y = (i / MAP) | 0;
  let m = 0;
  const conn = (X, Y) => {
    if (!city.inMap(X, Y)) return false;
    const t = city.over[city.idx(X, Y)];
    return t !== OV.NONE && t !== OV.ROAD && t !== OV.RUBBLE;
  };
  if (conn(x, y - 1)) m |= 1;
  if (conn(x + 1, y)) m |= 2;
  if (conn(x, y + 1)) m |= 4;
  if (conn(x - 1, y)) m |= 8;
  return m;
}
