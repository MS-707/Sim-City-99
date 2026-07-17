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

// rows x cols of window parallelograms on a face whose bottom edge runs p0->p1
function windows(g, p0, p1, ht, rows, cols, lit = 0.5, color = "#ffe9a0", dark = "#20242c") {
  const topPad = 6, botPad = 4;
  const usable = ht - topPad - botPad;
  for (let r = 0; r < rows; r++) {
    const y0 = botPad + (r + 0.15) / rows * usable;
    const y1 = botPad + (r + 0.7) / rows * usable;
    for (let c = 0; c < cols; c++) {
      const u0 = (c + 0.25) / cols, u1 = (c + 0.75) / cols;
      const ax = p0[0] + (p1[0] - p0[0]) * u0, ay = p0[1] + (p1[1] - p0[1]) * u0;
      const bx = p0[0] + (p1[0] - p0[0]) * u1, by = p0[1] + (p1[1] - p0[1]) * u1;
      g.fillStyle = Math.random() < lit ? color : dark;
      g.beginPath();
      g.moveTo(ax, ay - y1); g.lineTo(bx, by - y1);
      g.lineTo(bx, by - y0); g.lineTo(ax, ay - y0);
      g.closePath(); g.fill();
    }
  }
}

function drawTree(g, x, y, s, tint = 1) {
  g.strokeStyle = "#5d4123"; g.lineWidth = 2;
  g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - s * 0.8); g.stroke();
  g.fillStyle = shade("#1d6e2a", tint);
  g.beginPath(); g.ellipse(x, y - s * 1.1, s * 0.55, s * 0.65, 0, 0, 7); g.fill();
  g.fillStyle = shade("#2f9c3f", tint);
  g.beginPath(); g.ellipse(x - s * 0.15, y - s * 1.3, s * 0.4, s * 0.45, 0, 0, 7); g.fill();
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

  // ---- terrain ----
  SPR.grass = [];
  for (let v = 0; v < 4; v++) {
    SPR.grass.push(mkSprite(1, 1, 0, (g, ox, oy) => {
      diamondPath(g, ox, oy);
      g.fillStyle = ["#4a9d44", "#459743", "#50a349", "#43903f"][v];
      g.fill();
      g.strokeStyle = "rgba(0,0,0,.18)"; g.lineWidth = 1; g.stroke();
      g.save(); diamondPath(g, ox, oy); g.clip();
      g.fillStyle = "rgba(255,255,255,.08)";
      for (let k = 0; k < 14; k++) g.fillRect(ox - HW + R() * TW, oy - HH + R() * TH, 2, 1);
      g.fillStyle = "rgba(0,60,0,.15)";
      for (let k = 0; k < 10; k++) g.fillRect(ox - HW + R() * TW, oy - HH + R() * TH, 2, 1);
      g.restore();
    }));
  }

  SPR.water = mkSprite(1, 1, 0, (g, ox, oy) => {
    diamondPath(g, ox, oy);
    const gr = g.createLinearGradient(ox, oy - HH, ox, oy + HH);
    gr.addColorStop(0, "#2a6fbe"); gr.addColorStop(1, "#1c4f92");
    g.fillStyle = gr; g.fill();
    g.strokeStyle = "rgba(0,0,40,.25)"; g.stroke();
    g.save(); diamondPath(g, ox, oy); g.clip();
    g.strokeStyle = "rgba(210,235,255,.35)"; g.lineWidth = 1;
    for (let k = 0; k < 4; k++) {
      const wy = oy - HH + 4 + k * 7 + R() * 3, wx = ox - HW + R() * 30;
      g.beginPath(); g.moveTo(wx, wy); g.bezierCurveTo(wx + 8, wy - 2, wx + 14, wy + 2, wx + 22, wy); g.stroke();
    }
    g.restore();
  });

  SPR.forest = [];
  for (let v = 0; v < 3; v++) {
    SPR.forest.push(mkSprite(1, 1, 26, (g, ox, oy) => {
      diamondPath(g, ox, oy);
      g.fillStyle = "#3d8a3a"; g.fill();
      g.strokeStyle = "rgba(0,0,0,.18)"; g.stroke();
      const n = 2 + (v % 2);
      for (let k = 0; k < n; k++) {
        drawTree(g, ox - 12 + k * 14 + R() * 6, oy + 6 - k * 5, 13 + R() * 5, 0.85 + R() * 0.4);
      }
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
  SPR.road = []; SPR.wire = [];
  for (let m = 0; m < 16; m++) {
    SPR.road.push(mkSprite(1, 1, 0, (g, ox, oy) => {
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
    }));

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

  /* ---- residential ---- */
  SPR.r1 = []; SPR.r2 = []; SPR.r3 = [];
  const houseWalls = ["#e8d9b0", "#cfe0ee", "#efc8c0"];
  const houseRoofs = ["#a03c2c", "#3c5a80", "#6b4f8a"];
  for (let v = 0; v < 3; v++) {
    SPR.r1.push(mkSprite(1, 1, 30, (g, ox, oy) => {
      diamondPath(g, ox, oy);
      g.fillStyle = "#5aa552"; g.fill(); g.strokeStyle = "rgba(0,0,0,.18)"; g.stroke();
      tinyHouse(g, ox - 10, oy + 2, 22, houseWalls[v], houseRoofs[v]);
      tinyHouse(g, ox + 12, oy - 2, 18, houseWalls[(v + 1) % 3], houseRoofs[(v + 1) % 3]);
      drawTree(g, ox + 22, oy + 6, 8, 1);
    }));
    SPR.r2.push(mkSprite(1, 1, 46, (g, ox, oy) => {
      const base = ["#b06a4a", "#9c8a6e", "#7e8fa0"][v];
      const { W, S, E } = prism(g, ox, oy, 1, 1, 36, base);
      windows(g, up(W, 0), up(S, 0), 36, 3, 2, 0.55);
      windows(g, up(S, 0), up(E, 0), 36, 3, 3, 0.55);
      g.fillStyle = "#4c4c52"; g.fillRect(ox - 6, oy - 36 - HH + 2, 8, 5); // roof AC
    }));
    SPR.r3.push(mkSprite(1, 1, 82, (g, ox, oy) => {
      const base = ["#c9c1ae", "#a9b6c4", "#c7a9a1"][v];
      const { W, S, E, N } = prism(g, ox, oy, 1, 1, 68, base);
      windows(g, up(W, 0), up(S, 0), 68, 6, 3, 0.6);
      windows(g, up(S, 0), up(E, 0), 68, 6, 3, 0.6);
      g.strokeStyle = "#333"; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(ox, N[1] - 68); g.lineTo(ox, N[1] - 80); g.stroke();
      g.fillStyle = "#e33"; g.fillRect(ox - 1, N[1] - 82, 3, 3);
    }));
  }

  /* ---- commercial ---- */
  SPR.c1 = []; SPR.c2 = []; SPR.c3 = [];
  for (let v = 0; v < 3; v++) {
    SPR.c1.push(mkSprite(1, 1, 30, (g, ox, oy) => {
      const base = "#cdbfa3";
      const { W, S, E } = prism(g, ox, oy, 1, 1, 18, base);
      // storefront glass band + awning
      const aw = ["#c0392b", "#2980b9", "#27ae60"][v];
      g.fillStyle = "#9fd8e8";
      poly(g, [up(S, 4), up(E, 4), up(E, 13), up(S, 13)], "#9fd8e8");
      poly(g, [up(W, 4), up(S, 4), up(S, 13), up(W, 13)], "#7fb8cc");
      g.fillStyle = aw;
      poly(g, [up(S, 13), up(E, 13), up(E, 17), up(S, 17)], aw);
      poly(g, [up(W, 13), up(S, 13), up(S, 17), up(W, 17)], shade(aw, 0.8));
    }));
    SPR.c2.push(mkSprite(1, 1, 56, (g, ox, oy) => {
      const base = ["#8ba3b5", "#a39b8b", "#8b9b8f"][v];
      const { W, S, E } = prism(g, ox, oy, 1, 1, 44, base);
      windows(g, up(W, 0), up(S, 0), 44, 4, 3, 0.65, "#cfe8ff");
      windows(g, up(S, 0), up(E, 0), 44, 4, 4, 0.65, "#cfe8ff");
    }));
    SPR.c3.push(mkSprite(1, 1, 104, (g, ox, oy) => {
      const glass = ["#3e6f9e", "#2e8a84", "#7a6a4e"][v];
      const { W, S, E, N } = prism(g, ox, oy, 1, 1, 88, glass,
        { top: shade(glass, 1.5), left: shade(glass, 0.62), right: shade(glass, 0.88) });
      windows(g, up(W, 0), up(S, 0), 88, 8, 3, 0.75, "#eaf6ff", shade(glass, 0.45));
      windows(g, up(S, 0), up(E, 0), 88, 8, 3, 0.75, "#eaf6ff", shade(glass, 0.5));
      g.strokeStyle = "#222"; g.lineWidth = 2;
      g.beginPath(); g.moveTo(ox, N[1] - 88); g.lineTo(ox, N[1] - 102); g.stroke();
      g.fillStyle = "#f33"; g.fillRect(ox - 1.5, N[1] - 104, 3, 3);
    }));
  }

  /* ---- industrial ---- */
  SPR.i1 = []; SPR.i2 = []; SPR.i3 = [];
  for (let v = 0; v < 3; v++) {
    SPR.i1.push(mkSprite(1, 1, 30, (g, ox, oy) => {
      const base = ["#b09a72", "#a8a08a", "#9a8a80"][v];
      const { W, S, E } = prism(g, ox, oy, 1, 1, 20, base);
      g.fillStyle = "#5a5148"; // big loading door on SE face
      poly(g, [up(S, 2), up(E, 2), up(E, 14), up(S, 14)].map(p => [
        p[0] * 0.5 + (S[0] + E[0]) / 4, p[1] * 0.5 + (S[1] + E[1]) / 4]), "#5a5148");
    }));
    SPR.i2.push(mkSprite(1, 1, 56, (g, ox, oy) => {
      const base = ["#8f7f6f", "#7f8272", "#94836a"][v];
      const { W, S, E, N } = prism(g, ox, oy, 1, 1, 28, base);
      windows(g, up(S, 0), up(E, 0), 28, 2, 3, 0.4, "#ffd27f");
      stack(g, ox - 10, N[1] - 24, 22, 6);
    }));
    SPR.i3.push(mkSprite(1, 1, 74, (g, ox, oy) => {
      const base = ["#77706a", "#6f7078", "#7c6f62"][v];
      const { W, S, E, N } = prism(g, ox, oy, 1, 1, 38, base);
      windows(g, up(W, 0), up(S, 0), 38, 2, 2, 0.35, "#ffd27f");
      stack(g, ox - 12, N[1] - 34, 30, 7);
      stack(g, ox + 2, N[1] - 30, 24, 6);
      g.fillStyle = "#a8b2ba"; // storage tank
      g.beginPath(); g.ellipse(ox + 16, N[1] - 30, 7, 4, 0, 0, 7); g.fill();
      g.fillRect(ox + 9, N[1] - 30, 14, 8);
      g.beginPath(); g.ellipse(ox + 16, N[1] - 22, 7, 4, 0, 0, 7); g.fill();
    }));
  }

  /* ---- civic 2x2 buildings ---- */
  SPR.police = mkSprite(2, 2, 46, (g, ox, oy) => {
    const { W, S, E } = prism(g, ox, oy, 2, 2, 30, "#b9c4d4");
    windows(g, up(W, 0), up(S, 0), 30, 2, 4, 0.7, "#dce9ff");
    windows(g, up(S, 0), up(E, 0), 30, 2, 4, 0.7, "#dce9ff");
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

  SPR.coal = mkSprite(2, 2, 78, (g, ox, oy) => {
    const { W, S, E, N } = prism(g, ox, oy, 2, 2, 34, "#5c5c64");
    windows(g, up(S, 0), up(E, 0), 34, 2, 4, 0.5, "#ffb54e");
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
  const v = city.varnt[i] % 3;
  switch (t) {
    case OV.ROAD:  return SPR.road[roadMask(city, i)];
    case OV.WIRE:  return SPR.wire[wireMask(city, i)];
    case OV.PARK:  return SPR.park;
    case OV.RUBBLE: return SPR.rubble;
    case OV.ZR:    return city.lvl[i] === 0 ? SPR.zoneR : [SPR.r1, SPR.r2, SPR.r3][city.lvl[i] - 1][v];
    case OV.ZC:    return city.lvl[i] === 0 ? SPR.zoneC : [SPR.c1, SPR.c2, SPR.c3][city.lvl[i] - 1][v];
    case OV.ZI:    return city.lvl[i] === 0 ? SPR.zoneI : [SPR.i1, SPR.i2, SPR.i3][city.lvl[i] - 1][v];
    case OV.POLICE:  return SPR.police;
    case OV.FIRESTA: return SPR.firesta;
    case OV.COAL:    return SPR.coal;
    case OV.SOLAR:   return SPR.solar;
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
