/* ============ SimCity 99 — bootstrap & game loop ============ */
"use strict";

let city = null;
let simAccum = 0, lastTime = 0;
const TICK_MS = 250; // one sim tick at "Llama" speed

function boot() {
  buildSprites();
  renderInit(document.getElementById("game"));
  uiInit();
  buildScenarioCards(); // scenario select on the splash (M9)

  document.getElementById("btn-new-city").addEventListener("click", () => {
    Snd.ensure(); Snd.cash();
    newCity();
    startGame();
  });
  document.getElementById("btn-load-city").addEventListener("click", () => {
    Snd.ensure();
    if (loadCity()) startGame();
    else uiAlert("No saved city found in this browser. Start a new one!");
  });

  // pre-create a city so the sim objects exist even on splash
  newCity();

  // G15: the splash's beveled pixel logo and its live iso skyline are drawn
  // last — purely additive title art, so a hiccup here can never block the
  // boot sequence. The skyline is composed from the SAME SPR building/tree
  // bake the game renders, so the title card and the game are one product.
  drawSplashLogo(document.getElementById("splash-logo-canvas"));
  drawSplashSkyline(document.getElementById("splash-skyline"));
}

function startGame() {
  document.getElementById("splash").classList.add("hidden");
  document.getElementById("win-main").classList.remove("hidden");
  // resize canvas now that the viewport is visible
  window.dispatchEvent(new Event("resize"));
  lastTime = performance.now();
  requestAnimationFrame(loop);
  // autosave every 45s
  setInterval(() => { if (city.pop >= 0) try { localStorage.setItem(SAVE_KEY, city.serialize()); } catch (e) {} }, 45000);
}

let mmCounter = 0;
function loop(now) {
  const dt = Math.min(200, now - lastTime);
  lastTime = now;

  if (UI.speed > 0) {
    simAccum += dt * UI.speed;
    let safety = 8;
    while (simAccum >= TICK_MS && safety-- > 0) {
      simAccum -= TICK_MS;
      const monthRolled = city.tick();
      if (monthRolled) {
        Snd.monthChime();
        if (UI.prefs.autoBudget) openBudget(); // monthly report, if subscribed
      }
    }
  }

  camEase(dt); // GQ11: eased zoom-to-cursor — presentation-only, one step per rAF
  renderFrame(city, UI);
  ambienceFrame(city);
  tickerFrame();
  refreshHUD();
  newsFrame();
  advisorsFrame();
  if (++mmCounter % 15 === 0) renderMinimap(city, UI.mapMode);

  requestAnimationFrame(loop);
}

/* ============ splash art (G15) ============
   Both the logo and the skyline are baked once at boot into their splash
   canvases. The logo is hard-edged beveled pixel lettering (chrome/gold box
   art) — drawn small and up-scaled with smoothing OFF so its edges step like
   90s pixel type, with zero CSS blur. The skyline is a procedural isometric
   city block drawn from the shared SPR building/tree bake — the very sprites
   the game paints, so the splash and the game share one rendering fidelity. */

// Hard-edged beveled pixel logo: chrome/gold 90s box-art, no soft glow.
function drawSplashLogo(cv) {
  if (!cv) return;
  const g = cv.getContext("2d");
  const W = cv.width, H = cv.height;
  g.clearRect(0, 0, W, H);
  const SC = 2;                       // up-scale factor => chunky stepped edges
  const off = document.createElement("canvas");
  off.width = (W / SC) | 0; off.height = (H / SC) | 0;
  const o = off.getContext("2d");
  const text = "SIMCITY 99";
  // fit the type to the small canvas, then blit up with smoothing off
  let fs = (off.height * 0.62) | 0;
  o.textAlign = "center"; o.textBaseline = "middle";
  const fit = () => { o.font = `900 ${fs}px "Arial Black","Impact",sans-serif`; return o.measureText(text).width; };
  while (fit() > off.width * 0.92 && fs > 8) fs -= 1;
  const cx = off.width / 2, cy = off.height / 2 + 1;
  // 1) hard drop shadow (offset, no blur) — the bevel's dark side
  o.fillStyle = "#2c1a00"; o.fillText(text, cx + 2, cy + 2);
  // 2) top-left highlight — the bevel's lit side
  o.fillStyle = "#fff4c8"; o.fillText(text, cx - 1, cy - 1);
  // 3) gold/chrome face: a banded vertical gradient (bright top, dark waist,
  //    warm base) is the classic 90s reflective box-art metal
  const grad = o.createLinearGradient(0, cy - fs * 0.55, 0, cy + fs * 0.55);
  grad.addColorStop(0.00, "#fff6b8");
  grad.addColorStop(0.44, "#ffb43a");
  grad.addColorStop(0.50, "#9c520a");
  grad.addColorStop(0.56, "#ffd764");
  grad.addColorStop(1.00, "#ef9500");
  o.fillStyle = grad; o.fillText(text, cx, cy);
  // 4) crisp black outline
  o.lineWidth = 1; o.strokeStyle = "#1a1000"; o.strokeText(text, cx, cy);
  g.imageSmoothingEnabled = false;    // stepped, non-anti-aliased up-scale
  g.drawImage(off, 0, 0, off.width, off.height, 0, 0, W, H);
}

// Live procedural isometric skyline, composed from the shared SPR bake.
function drawSplashSkyline(cv) {
  if (!cv || typeof SPR === "undefined" || !SPR.r3) return;
  const g = cv.getContext("2d");
  const W = cv.width, H = cv.height;
  g.clearRect(0, 0, W, H);

  // deterministic PRNG so the skyline is stable across boots
  let s = 0x51ce99 >>> 0;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const pv = (arr) => arr[(rnd() * arr.length) | 0];   // pick a variant sprite

  // dusk backdrop seats the strip: sky gradient over a grass band
  const sky = g.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0.00, "#173763");
  sky.addColorStop(0.52, "#8aa4c2");
  sky.addColorStop(0.74, "#c6b088");
  g.fillStyle = sky; g.fillRect(0, 0, W, H);
  const baseY = H - 46, cx = W / 2, N = 8;
  g.fillStyle = "#3c7a37"; g.fillRect(0, baseY - 6, W, H - (baseY - 6));

  const backX = (c) => cx + (2 * c - (N - 1)) * HW;     // 64px flat-baseline spacing
  const put = (spr, x, y) => { if (spr) g.drawImage(spr.c, x - spr.ox, y - spr.oy); };

  // --- ground plane: two interleaved rows of SPR terrain diamonds, drawn
  //     first (flat) so every building sits on top of the whole ground ---
  const road = new Set([2, 5]);        // front-row columns that carry a road
  for (let c = -1; c <= N; c++) {
    put(pv(SPR.grass), backX(c), baseY);                     // back ground row
    const fx = backX(c) - HW, fy = baseY + HH;               // front ground row
    put(road.has(c) ? SPR.road[10] : pv(SPR.grass), fx, fy);
  }

  // --- back row: the tall skyline of towers + one 2x2 landmark ---
  const tall = [SPR.c3, SPR.r3, SPR.i3, SPR.i2];
  const landmark = 4;                  // SPR.stadium spans this + next column
  for (let c = 0; c < N; c++) {
    if (c === landmark) { put(SPR.stadium, backX(c), baseY); continue; }
    if (c === landmark + 1) continue;                       // reserved by stadium
    put(pv(pv(tall)), backX(c), baseY);
  }

  // --- front row: low/mid buildings and trees, interleaved and 16px lower so
  //     they overlap correctly in front of the towers behind them ---
  const low = [SPR.r2, SPR.c2, SPR.r1, SPR.c1, SPR.i1];
  const green = [SPR.forest[2][0], SPR.forest[2][1], SPR.park];
  for (let c = 0; c <= N; c++) {
    if (road.has(c)) continue;                              // keep the road clear
    const fx = backX(c) - HW, fy = baseY + HH;
    put(rnd() < 0.34 ? pv(green) : pv(pv(low)), fx, fy);
  }
}

window.addEventListener("DOMContentLoaded", boot);
