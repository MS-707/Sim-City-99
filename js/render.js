/* ============ SimCity 99 — isometric renderer ============ */
"use strict";

const cam = { x: 0, y: 0, z: 1 };   // world-space center + zoom
let cvs, ctx, frame = 0;
const smoke = [];                    // {x, y, age, drift}

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

function screenToTile(sx, sy) {
  const wx = (sx - cvs.width / 2) / cam.z + cam.x;
  const wy = (sy - cvs.height / 2) / cam.z + cam.y;
  const A = wx / HW, B = (wy - HH) / HH;
  return { x: Math.round((A + B) / 2), y: Math.round((B - A) / 2) };
}

function renderFrame(city, uiState) {
  frame++;
  ctx.fillStyle = "#0a0a12";
  ctx.fillRect(0, 0, cvs.width, cvs.height);
  ctx.save();
  ctx.translate(cvs.width / 2, cvs.height / 2);
  ctx.scale(cam.z, cam.z);
  ctx.translate(-cam.x, -cam.y);
  ctx.imageSmoothingEnabled = false;

  const margin = 160;
  const minWX = cam.x - cvs.width / 2 / cam.z - margin;
  const maxWX = cam.x + cvs.width / 2 / cam.z + margin;
  const minWY = cam.y - cvs.height / 2 / cam.z - margin;
  const maxWY = cam.y + cvs.height / 2 / cam.z + margin;

  const blink = (frame / 24 | 0) % 2 === 0;

  // painter's order: by (x + y), then x
  for (let s = 0; s <= (MAP - 1) * 2; s++) {
    for (let x = Math.max(0, s - MAP + 1); x <= Math.min(MAP - 1, s); x++) {
      const y = s - x;
      const wx = worldX(x, y), wy = worldY(x, y);
      if (wx < minWX || wx > maxWX || wy < minWY || wy > maxWY) continue;
      const i = y * MAP + x;

      // terrain
      const t = city.terr[i];
      let tspr;
      if (t === TERR.WATER) tspr = SPR.water;
      else if (t === TERR.FOREST && city.over[i] === OV.NONE) tspr = SPR.forest[city.varnt[i] % 3];
      else tspr = SPR.grass[city.varnt[i] % 4];
      // buildings sit on grass; forests draw their own grass base
      if (t === TERR.FOREST && city.over[i] === OV.NONE) {
        ctx.drawImage(SPR.grass[city.varnt[i] % 4].c, wx - HW, wy - HH - HH + HH);
      }
      ctx.drawImage(tspr.c, wx - tspr.ox, wy - tspr.oy);

      // overlay
      const ov = city.over[i];
      if (ov !== OV.NONE) {
        const size = sizeOf(ov);
        if (size === 1) {
          const spr = spriteFor(city, i);
          if (spr) ctx.drawImage(spr.c, wx - spr.ox, wy - spr.oy);
        } else {
          const a = city.anc[i];
          const ax = a % MAP, ay = (a / MAP) | 0;
          if (x === ax + size - 1 && y === ay + size - 1) {
            const spr = spriteFor(city, a);
            const awx = worldX(ax, ay), awy = worldY(ax, ay);
            if (spr) ctx.drawImage(spr.c, awx - spr.ox, awy - spr.oy);
          }
        }
      }

      // fire on this tile
      if (city.fire[i]) drawFlames(wx, wy);

      // blinking "no power" bolt on developed but unpowered zones / civics
      if (blink && !city.powered[i] &&
          ((ov >= OV.ZR && ov <= OV.ZI && city.lvl[i] > 0) ||
           ov === OV.POLICE || ov === OV.FIRESTA)) {
        if (city.anc[i] === -1 || city.anc[i] === i)
          ctx.drawImage(SPR.zap.c, wx - SPR.zap.ox, wy - SPR.zap.oy - 4);
      }
    }
  }

  updateSmoke(city);
  drawDisaster(city);
  if (uiState.hover && uiState.tool !== "query") drawCursor(city, uiState);

  ctx.restore();
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
      else if (t === OV.RUBBLE) col = "#654";
      else col = city.terr[i] === TERR.WATER ? "#136" : (city.terr[i] === TERR.FOREST ? "#0a3a12" : "#1c4a1c");
      if (city.fire[i]) col = "#f80";
    }
    g.fillStyle = col;
    g.fillRect(x * sc, y * sc, sc, sc);
  }
}
