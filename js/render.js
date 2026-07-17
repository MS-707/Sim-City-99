/* ============ SimCity 99 — isometric renderer ============ */
"use strict";

const cam = { x: 0, y: 0, z: 1 };   // world-space center + zoom
let cvs, ctx, frame = 0;
const smoke = [];                    // {x, y, age, drift}
const cars = [];                     // {id, x, y, fx, fy, tx, ty, p, spd, col}
let carSeq = 0;
const CAR_COLS = ["#e34a4a", "#4a8fe3", "#e8e8ee", "#f2c53a", "#57c957", "#b06fe0"];

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
const NIGHT_MAX_ALPHA = 0.7;      // overlay opacity at deepest night
const NIGHT_MAX_Q = 3 * 700;      // draw cap on queued (sprite,x,y) triples
const nightQ = [];                // reused every frame — never reallocated

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
   they can be pre-composited once per (camera, water-frame, terrain-rev)
   into an offscreen canvas and blitted in one drawImage per frame. Forest
   sprites stay in the live pass — they rise above the diamond and must keep
   painter-order occlusion against buildings. Big developed maps (128x128)
   drop thousands of per-frame draw calls this way. */
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
  for (let s = 0; s <= (MAP - 1) * 2; s++) {
    for (let x = Math.max(0, s - MAP + 1); x <= Math.min(MAP - 1, s); x++) {
      const y = s - x;
      const wx = worldX(x, y), wy = worldY(x, y);
      if (wx < minWX || wx > maxWX || wy < minWY || wy > maxWY) continue;
      const i = y * MAP + x;
      if (city.terr[i] === TERR.WATER) {
        const w = SPR.water[waterFrame];
        g.drawImage(w.c, wx - w.ox, wy - w.oy);
        const sm = shoreMask(city, i); // sand on land-facing edges
        if (sm) { const sh = SPR.shore[sm]; g.drawImage(sh.c, wx - sh.ox, wy - sh.oy); }
      } else {
        const gs = SPR.grass[city.varnt[i] % 4];
        g.drawImage(gs.c, wx - gs.ox, wy - gs.oy);
        const bm = beachMask(city, i); // beach fringe on the land side of the seam
        if (bm) { const sh = SPR.shore[bm]; g.drawImage(sh.c, wx - sh.ox, wy - sh.oy); }
      }
    }
  }
  L.key = key;
}

function renderFrame(city, uiState) {
  frame++;
  const ns = nightStrength(city, uiState); // 0 ⇒ the whole night path is skipped
  nightQ.length = 0;
  ctx.fillStyle = "#0a0a12";
  ctx.fillRect(0, 0, cvs.width, cvs.height);

  // cull margins sized to the sprite extents: buildings reach ~64px sideways,
  // ~110px above and ~48px below their anchor tile's diamond center
  const minWX = cam.x - cvs.width / 2 / cam.z - 80;
  const maxWX = cam.x + cvs.width / 2 / cam.z + 80;
  const minWY = cam.y - cvs.height / 2 / cam.z - 64;
  const maxWY = cam.y + cvs.height / 2 / cam.z + 128;

  const blink = (frame / 24 | 0) % 2 === 0;
  const waterFrame = (frame / 16 | 0) % SPR.water.length; // prebuilt frame cycle

  // flat terrain: one cached blit unless the camera / water / terrain moved
  const tKey = `${cam.x},${cam.y},${cam.z},${cvs.width},${cvs.height},` +
    `${waterFrame},${city.terrRev | 0},${city.seed},${MAP}`;
  if (terrLayer.key !== tKey)
    buildTerrainLayer(city, waterFrame, minWX, maxWX, minWY, maxWY, tKey);
  ctx.drawImage(terrLayer.cv, 0, 0);

  ctx.save();
  worldTransform();
  ctx.imageSmoothingEnabled = false;

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

      // forest rises above the flat layer — drawn live for correct occlusion
      if (t === TERR.FOREST && ov === OV.NONE) {
        const fs = forestSprite(city, i); // cluster-aware density
        ctx.drawImage(fs.c, wx - fs.ox, wy - fs.oy);
      }

      // overlay
      if (ov !== OV.NONE) {
        const size = sizeOf(ov);
        if (size === 1) {
          const spr = spriteFor(city, i);
          if (spr) ctx.drawImage(spr.c, wx - spr.ox, wy - spr.oy);
          if (ns > 0 && nightQ.length < NIGHT_MAX_Q) {
            // queue night lights (drawn after the dusk tint): street lamps on
            // road tiles, prebaked lit-window glow on powered zones
            if (ov === OV.ROAD) {
              nightQ.push(SPR.lamp, wx, wy);
            } else if (spr && spr.night && city.powered[i]) {
              nightQ.push(spr.night, wx, wy);
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
              if (ns > 0 && spr.night && city.powered[a] && nightQ.length < NIGHT_MAX_Q)
                nightQ.push(spr.night, awx, awy);
            }
          }
        }
      }

      // fire on this tile
      if (city.fire[i]) {
        drawFlames(wx, wy);
        if (ns > 0 && nightQ.length < NIGHT_MAX_Q) nightQ.push(SPR.fireGlow, wx, wy);
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
  }

  updateCars(city);
  updateSmoke(city);
  drawDisaster(city);
  ctx.restore();

  // dusk tint: one screen-space fill over the whole scene — no per-tile work,
  // no pixel reads. Skipped entirely by day / with the cycle pref off.
  if (ns > 0) {
    ctx.globalAlpha = ns * NIGHT_MAX_ALPHA;
    ctx.fillStyle = NIGHT_TINT;
    ctx.fillRect(0, 0, cvs.width, cvs.height);
    ctx.globalAlpha = 1;
  }

  ctx.save();
  worldTransform();
  if (ns > 0) drawNightLights(city, ns);
  if (uiState.hover && uiState.tool !== "query") drawCursor(city, uiState);
  ctx.restore();
}

// additive light pass over the dusk tint: prebaked lamp / window / halo
// sprites queued during the tile loop. Lookups + drawImage only — nothing is
// allocated here, no gradients built, no getImageData.
function drawNightLights(city, ns) {
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = ns;
  for (let k = 0; k < nightQ.length; k += 3) {
    const s = nightQ[k];
    ctx.drawImage(s.c, nightQ[k + 1] - s.ox, nightQ[k + 2] - s.oy);
  }
  const d = city.disaster;
  if (d) {
    const wx = worldX(d.x, d.y), wy = worldY(d.x, d.y);
    if (d.kind === "ufo") {
      // the abduction beam washes the ground green at night
      ctx.drawImage(SPR.ufoGlow.c, wx - SPR.ufoGlow.ox, wy - SPR.ufoGlow.oy - 16);
    } else if (d.kind === "tornado") {
      // lightning flicker around the funnel
      ctx.globalAlpha = ns * (0.35 + 0.65 * Math.abs(Math.sin(frame * 0.31)));
      ctx.drawImage(SPR.stormGlow.c, wx - SPR.stormGlow.ox, wy - SPR.stormGlow.oy - 24);
    }
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
}

function drawFlames(wx, wy) {
  for (let k = 0; k < 3; k++) {
    const fx = wx - 10 + k * 10 + Math.random() * 4;
    const h = 12 + Math.random() * 14;
    ctx.fillStyle = k % 2 ? "rgba(255,140,0,.85)" : "rgba(255,220,60,.9)";
    ctx.beginPath();
    ctx.moveTo(fx - 4, wy); ctx.lineTo(fx + 4, wy); ctx.lineTo(fx, wy - h);
    ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = "rgba(40,40,40,.5)";
  ctx.beginPath(); ctx.arc(wx + Math.random() * 8 - 4, wy - 22 - Math.random() * 8, 4, 0, 7); ctx.fill();
}

/* ---------------- cars ---------------- */
// a cheap pool of cars that drive tile-to-tile along connected roads.
// pool size scales with total congestion so busy cities look busy.
function updateCars(city) {
  const roads = [];
  let total = 0;
  for (let i = 0; i < city.over.length; i++)
    if (city.over[i] === OV.ROAD) { roads.push(i); total += city.traffic[i]; }

  const want = roads.length >= 8 ? Math.min(70, 6 + (total / 45 | 0)) : 0;
  while (cars.length > want) cars.pop();
  for (let tries = 0; tries < 8 && cars.length < want && roads.length; tries++) {
    const i = roads[(Math.random() * roads.length) | 0];
    if (Math.random() * 160 > city.traffic[i] + 25) continue; // favor busy roads
    const x = i % MAP, y = (i / MAP) | 0;
    cars.push({ id: carSeq++, fx: x, fy: y, tx: x, ty: y, x, y, p: 1,
                spd: 0.1, col: CAR_COLS[carSeq % CAR_COLS.length] });
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
      c.spd = Math.max(0.03, 0.13 - city.traffic[i] * 0.0004); // congestion slows
    }
    c.x = c.fx + (c.tx - c.fx) * c.p;
    c.y = c.fy + (c.ty - c.fy) * c.p;
    const wx = worldX(c.x, c.y), wy = worldY(c.x, c.y);
    ctx.fillStyle = "#101018";
    ctx.fillRect(wx - 3, wy - 3, 7, 4);            // shadow / chassis
    ctx.fillStyle = c.col;
    ctx.fillRect(wx - 2, wy - 5, 5, 3);            // body
    ctx.fillStyle = "rgba(255,255,255,.75)";
    ctx.fillRect(wx - 1, wy - 4, 2, 1);            // windshield glint
  }
}

function updateSmoke(city) {
  // spawn from coal plants & big industry
  if (frame % 6 === 0) {
    for (let i = 0; i < city.over.length; i++) {
      const t = city.over[i];
      if (t === OV.COAL && city.anc[i] === i && Math.random() < 0.6) {
        const x = i % MAP, y = (i / MAP) | 0;
        smoke.push({ x: worldX(x, y) - 18, y: worldY(x, y) + HH - 78, age: 0, drift: Math.random() * 0.4 - 0.1 });
      } else if (t === OV.ZI && city.lvl[i] === 3 && city.powered[i] && Math.random() < 0.25) {
        const x = i % MAP, y = (i / MAP) | 0;
        smoke.push({ x: worldX(x, y) - 12, y: worldY(x, y) - 68, age: 0, drift: Math.random() * 0.3 });
      }
      if (smoke.length > 160) break;
    }
  }
  for (let k = smoke.length - 1; k >= 0; k--) {
    const p = smoke[k];
    p.age++; p.y -= 0.45; p.x += p.drift;
    if (p.age > 90) { smoke.splice(k, 1); continue; }
    const a = 0.32 * (1 - p.age / 90);
    ctx.fillStyle = `rgba(190,190,200,${a.toFixed(3)})`;
    ctx.beginPath(); ctx.arc(p.x, p.y, 3 + p.age * 0.09, 0, 7); ctx.fill();
  }
}

function drawDisaster(city) {
  const d = city.disaster;
  if (!d) return;
  const wx = worldX(d.x, d.y), wy = worldY(d.x, d.y);
  if (d.kind === "tornado") {
    for (let k = 0; k < 7; k++) {
      const r = 5 + k * 3.4;
      const ang = frame * 0.25 + k;
      ctx.fillStyle = `rgba(120,120,130,${0.55 - k * 0.05})`;
      ctx.beginPath();
      ctx.ellipse(wx + Math.cos(ang) * 3, wy - 8 - k * 9, r, r * 0.45, 0, 0, 7);
      ctx.fill();
    }
  } else { // ufo
    const bob = Math.sin(frame * 0.1) * 4;
    // beam
    const gr = ctx.createLinearGradient(wx, wy - 60, wx, wy);
    gr.addColorStop(0, "rgba(140,255,140,.45)"); gr.addColorStop(1, "rgba(140,255,140,.05)");
    ctx.fillStyle = gr;
    ctx.beginPath();
    ctx.moveTo(wx - 6, wy - 60 + bob); ctx.lineTo(wx + 6, wy - 60 + bob);
    ctx.lineTo(wx + 26, wy); ctx.lineTo(wx - 26, wy);
    ctx.closePath(); ctx.fill();
    // saucer
    ctx.fillStyle = "#9aa4b2";
    ctx.beginPath(); ctx.ellipse(wx, wy - 64 + bob, 22, 7, 0, 0, 7); ctx.fill();
    ctx.fillStyle = "#cdd6e2";
    ctx.beginPath(); ctx.ellipse(wx, wy - 69 + bob, 10, 6, 0, Math.PI, 0); ctx.fill();
    for (let k = 0; k < 4; k++) {
      ctx.fillStyle = (frame + k) % 8 < 4 ? "#ff5b5b" : "#ffe95b";
      ctx.beginPath(); ctx.arc(wx - 15 + k * 10, wy - 62 + bob, 1.8, 0, 7); ctx.fill();
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
function renderMinimap(city, mode) {
  const mm = document.getElementById("minimap");
  const g = mm.getContext("2d");
  const sc = mm.width / MAP;
  g.fillStyle = "#000"; g.fillRect(0, 0, mm.width, mm.height);
  for (let y = 0; y < MAP; y++) for (let x = 0; x < MAP; x++) {
    const i = y * MAP + x;
    let col = null;
    if (mode === "power") {
      if (city.over[i] === OV.COAL || city.over[i] === OV.SOLAR) col = "#ff0";
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
      } else col = city.terr[i] === TERR.WATER ? "#013" : "#111";
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
      const t = city.over[i];
      if (t === OV.ROAD) col = "#888";
      else if (t === OV.WIRE) col = "#ba8";
      else if (t === OV.ZR) col = city.lvl[i] ? "#2d2" : "#141";
      else if (t === OV.ZC) col = city.lvl[i] ? "#46f" : "#114";
      else if (t === OV.ZI) col = city.lvl[i] ? "#dc2" : "#441";
      else if (t === OV.PARK) col = "#5c5";
      else if (t === OV.POLICE) col = "#88f";
      else if (t === OV.FIRESTA) col = "#f55";
      else if (t === OV.COAL || t === OV.SOLAR) col = "#ff0";
      else if (t === OV.SCHOOL) col = "#0cc";
      else if (t === OV.HOSPITAL) col = "#fcf";
      else if (t === OV.MAYOR) col = "#fd6";
      else if (t === OV.STADIUM) col = "#e5e";
      else if (t === OV.RUBBLE) col = "#654";
      else col = city.terr[i] === TERR.WATER ? "#136" : (city.terr[i] === TERR.FOREST ? "#0a3a12" : "#1c4a1c");
      if (city.fire[i]) col = "#f80";
    }
    g.fillStyle = col;
    // integer pixel edges: every canvas pixel belongs wholly to one tile, so
    // fractional scales (e.g. 160/128) never blend neighbouring tile colors
    const px = Math.round(x * sc), py = Math.round(y * sc);
    g.fillRect(px, py, Math.round((x + 1) * sc) - px, Math.round((y + 1) * sc) - py);
  }
}
