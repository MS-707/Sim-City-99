/* ============ SimCity 99 — ambient soundscape scheduler ============ */
// When zoomed in close, the city murmurs: busy roads hum, industry clanks,
// gulls wheel over water, stadium crowds roar. Presentation-driven — runs
// off the render loop, so the city keeps making noise while paused.
"use strict";

const AMB_KINDS = ["traffic", "industry", "water", "stadium", "chopper"];
const AMB_FN = { traffic: "ambTraffic", industry: "ambIndustry",
                 water: "ambWater", stadium: "ambStadium",
                 chopper: "ambChopper" }; // news chopper thump (M18)
const AMB_INTERVAL = 1900;    // ms between ambient triggers (one per interval)
const AMB_GAP = 500;          // min ms between same-category triggers
const AMB_MIN_ZOOM = 1.3;     // only when zoomed in close
const AMB_TRAFFIC_MIN = 70;   // congestion level that counts as "busy"

const amb = { last: 0, idx: 0, lastCat: {} };

// invert the camera for the four canvas corners -> tile-space bounding box
function ambVisibleTileRect() {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [sx, sy] of [[0, 0], [cvs.width, 0], [0, cvs.height], [cvs.width, cvs.height]]) {
    const t = screenToTile(sx, sy);
    x0 = Math.min(x0, t.x); x1 = Math.max(x1, t.x);
    y0 = Math.min(y0, t.y); y1 = Math.max(y1, t.y);
  }
  return { x0: Math.max(0, x0), x1: Math.min(MAP - 1, x1),
           y0: Math.max(0, y0), y1: Math.min(MAP - 1, y1) };
}

// which ambience sources are inside the current viewport?
function ambScanViewport(city) {
  const r = ambVisibleTileRect();
  const found = { traffic: false, industry: false, water: false, stadium: false };
  for (let y = r.y0; y <= r.y1; y++) {
    for (let x = r.x0; x <= r.x1; x++) {
      const i = y * MAP + x;
      if (city.terr[i] === TERR.WATER) found.water = true;
      const ov = city.over[i];
      if (ov === OV.ROAD && city.traffic[i] >= AMB_TRAFFIC_MIN) found.traffic = true;
      else if (ov === OV.ZI && city.lvl[i] > 0) found.industry = true;
      else if (ov === OV.STADIUM) found.stadium = true;
    }
  }
  return found;
}

function ambienceFrame(city) {
  if (!city || !Snd.ctx || !Snd.sfxOn) return;
  if (document.hidden || document.visibilityState === "hidden") return;
  if (cam.z < AMB_MIN_ZOOM) return;
  const now = performance.now();
  if (now - amb.last < AMB_INTERVAL) return;
  amb.last = now;
  const found = ambScanViewport(city);
  // news chopper (M18): rotor thump while airborne AND on screen — reuses
  // this scheduler's zoom gate + per-category spacing; O(1), no map scan
  found.chopper = chopperOnScreen();
  // at most one ambient per interval, round-robin through the kinds in view
  for (let k = 0; k < AMB_KINDS.length; k++) {
    const kind = AMB_KINDS[(amb.idx + k) % AMB_KINDS.length];
    if (!found[kind]) continue;
    if (now - (amb.lastCat[kind] || 0) < AMB_GAP) continue;
    amb.idx = (amb.idx + k + 1) % AMB_KINDS.length;
    amb.lastCat[kind] = now;
    Snd[AMB_FN[kind]]();
    return;
  }
}
