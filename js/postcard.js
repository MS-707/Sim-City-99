/* ============ SimCity 99 — postcard photo mode (M14) ============ */
"use strict";

// "Send Postcard…" composes a retro 1997 postcard on its own dedicated
// canvas (#postcard-canvas). The photograph is shot by a dedicated postcard
// camera (G4): the composer fits the developed city's bounding box (fallback:
// the whole terrain diamond) into the photo mount and renders it offscreen
// via renderPhotoTo — the live #game canvas and cam are never drawn onto,
// resized, or mutated, no matter where the player left the view. A
// season-matched banded sunset sky fills whatever the world doesn't cover,
// so the photo never shows the renderer's void color. Nothing in this file
// runs per frame: the compose happens exactly once per menu click /
// recompose, the PNG encode exactly once per Save click. The preview dialog
// therefore works even in a sandboxed iframe where downloads are blocked —
// Save just degrades to a polite status-bar apology while the preview stays
// on screen.

const POSTCARD = {
  padL: 40, padR: 40,   // cream margins left / right of the photo mount
  padT: 88,             // top strip: stamp + postmark live here
  padB: 96,             // bottom strip: headline + dateline live here
  photoW: 560,          // photo width; height follows the viewport aspect
  ring: 8,              // white photo-print mount around the photo
  skyFrac: 0.22,        // top slice of the photo reserved for the sunset sky
  zMin: 0.4, zMax: 1.35, // postcard-camera zoom clamp: giant cities crop to
                         // their center, one-block towns don't blow up to mush
};

/* --------- auto-framing (G4) --------- */
// tile bounding box of everything the mayor built — a brand-new map falls
// back to the whole terrain diamond — padded out to world-space bounds with
// headroom for the tallest tower sprites (~96px above their tile center)
function postcardBounds() {
  let minX = MAP, minY = MAP, maxX = -1, maxY = -1;
  for (let y = 0; y < MAP; y++) for (let x = 0; x < MAP; x++) {
    if (city.over[y * MAP + x] === OV.NONE) continue;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (maxX < 0) { minX = minY = 0; maxX = maxY = MAP - 1; }
  return {
    x0: worldX(minX, maxY) - HW - 28, x1: worldX(maxX, minY) + HW + 28,
    y0: worldY(minX, minY) - HH - 96, y1: worldY(maxX, maxY) + HH + 20,
  };
}

// season-matched sunset skies: [zenith, mid, horizon] stops, brightening
// toward the horizon. Drawn as chunky bands — 1997 had no truecolor skies.
const POSTCARD_SKY = {
  spring: ["#4a5a9a", "#c97a9a", "#f5cf62"],
  summer: ["#3a4a8e", "#e0784a", "#ffd35e"],
  autumn: ["#553a6e", "#c05f2e", "#f2ab42"],
  winter: ["#4a608c", "#93aac6", "#ecdcae"],
};

const pcRGB = (hex) =>
  [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
const pcMix = (a, b, t) =>
  [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const pcCSS = (c) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;

// paint the sky band + below-horizon ground haze under the (transparent)
// photo pass. ns-tinted with the exact dusk wash renderFrame lays over the
// scene, so a midnight postcard gets a midnight sky. Returns the horizon
// color for the seam haze.
function drawPostcardSky(g, x, y, w, h, skyH, ns) {
  const stops = POSTCARD_SKY[seasonOf(city.month)].map(pcRGB);
  const tint = pcRGB(NIGHT_TINT), tintA = ns * NIGHT_MAX_ALPHA;
  const at = (t) => pcMix(t < 0.55 ? pcMix(stops[0], stops[1], t / 0.55)
                                   : pcMix(stops[1], stops[2], (t - 0.55) / 0.45),
                          tint, tintA);
  const bands = 12;
  for (let k = 0; k < bands; k++) {
    const y0 = Math.round(skyH * k / bands), y1 = Math.round(skyH * (k + 1) / bands);
    g.fillStyle = pcCSS(at((k + 0.5) / bands));
    g.fillRect(x, y + y0, w, y1 - y0);
  }
  const hz = at(1); // ground haze — visible only past the map's edges
  g.fillStyle = pcCSS(pcMix(hz, [40, 34, 30], 0.35));
  g.fillRect(x, y + skyH, w, h - skyH);
  return hz;
}

/* --------- compose --------- */
function composePostcard() {
  const game = document.getElementById("game");
  const cv = document.getElementById("postcard-canvas");
  const gw = game.width, gh = game.height;
  const P = POSTCARD;
  const pw = P.photoW;
  const ph = Math.max(1, Math.round(pw * gh / gw));
  const px = P.padL, py = P.padT;
  const W = P.padL + pw + P.padR;
  const H = P.padT + ph + P.padB;
  if (cv.width !== W) cv.width = W;
  if (cv.height !== H) cv.height = H;
  const g = cv.getContext("2d");
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.globalCompositeOperation = "source-over";

  // aged cream card stock — fully opaque, edge to edge
  g.fillStyle = "#f3e7cd";
  g.fillRect(0, 0, W, H);
  // deterministic paper grain (subtle scan lines, never random)
  g.fillStyle = "rgba(122,92,44,.05)";
  for (let yy = 3; yy < H; yy += 7) g.fillRect(0, yy, W, 1);

  // airmail border: alternating red/blue dashes around the card perimeter
  const dash = 14, thick = 6;
  for (let x = 0; x < W; x += dash) {
    g.fillStyle = ((x / dash) | 0) % 2 ? "#2456a0" : "#c0392b";
    g.fillRect(x, 0, dash - 4, thick);
    g.fillStyle = ((x / dash) | 0) % 2 ? "#c0392b" : "#2456a0";
    g.fillRect(x, H - thick, dash - 4, thick);
  }
  for (let y = 0; y < H; y += dash) {
    g.fillStyle = ((y / dash) | 0) % 2 ? "#c0392b" : "#2456a0";
    g.fillRect(0, y, thick, dash - 4);
    g.fillStyle = ((y / dash) | 0) % 2 ? "#2456a0" : "#c0392b";
    g.fillRect(W - thick, y, thick, dash - 4);
  }

  // white photo-print mount with a soft edge line
  g.fillStyle = "#ffffff";
  g.fillRect(px - P.ring, py - P.ring, pw + P.ring * 2, ph + P.ring * 2);
  g.strokeStyle = "#b7a67f";
  g.lineWidth = 1;
  g.strokeRect(px - P.ring + 0.5, py - P.ring + 0.5,
               pw + P.ring * 2 - 1, ph + P.ring * 2 - 1);

  // the photograph (G4): shot fresh from a dedicated postcard camera fitted
  // to the developed city's bounding box, so the skyline fills the mount no
  // matter where the live camera wandered — night tint, season palette,
  // disasters and cars still render exactly as the game would draw them.
  // renderPhotoTo restores the live canvas/cam; the sky band underneath
  // catches everything past the map edge.
  const skyH = Math.round(ph * P.skyFrac);
  const ns = nightStrength(city, UI);
  const hz = drawPostcardSky(g, px, py, pw, ph, skyH, ns);
  const b = postcardBounds();
  const z = Math.min(P.zMax, Math.max(P.zMin,
    Math.min(pw / (b.x1 - b.x0), (ph - skyH) / (b.y1 - b.y0))));
  const photo = document.createElement("canvas");
  photo.width = pw;
  photo.height = Math.max(1, ph - skyH);
  renderPhotoTo(photo, city, { prefs: UI.prefs, hover: null },
                (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, z);
  g.drawImage(photo, px, py + skyH);
  // a wisp of horizon haze so the skyline meets the sky, not a hard seam
  const haze = g.createLinearGradient(0, py + skyH, 0, py + skyH + 14);
  haze.addColorStop(0, `rgba(${hz[0] | 0},${hz[1] | 0},${hz[2] | 0},.45)`);
  haze.addColorStop(1, `rgba(${hz[0] | 0},${hz[1] | 0},${hz[2] | 0},0)`);
  g.fillStyle = haze;
  g.fillRect(px, py + skyH, pw, 14);
  g.strokeStyle = "rgba(20,16,8,.55)";
  g.strokeRect(px + 0.5, py + 0.5, pw - 1, ph - 1);

  // 1997 postal furniture in the top strip: stamp, postmark, wavy cancel
  drawPostcardStamp(g, W - 100, 10, 56, 64);
  drawPostcardPostmark(g, W - 148, 42, W - 112);
  g.fillStyle = "#8a6f3c";
  g.font = 'bold 10px "Courier New", monospace';
  g.textAlign = "left";
  g.textBaseline = "alphabetic";
  g.fillText("SIMCITY POSTAL SVC · PAR AVION · 33.6k", P.padL - P.ring, 26);
  g.fillText("EST. 1997 — NO POSTAGE NECESSARY IF MAILED BY MODEM",
             P.padL - P.ring, 42);

  // headline + dateline in the bottom strip (live text, drawn as pixels)
  const by = py + ph + P.ring;
  g.textAlign = "center";
  g.font = 'italic bold 30px "Brush Script MT", "Segoe Script", "Comic Sans MS", cursive';
  const head = `Greetings from ${city.cityName.toUpperCase()}!`;
  g.fillStyle = "#f2c53a";
  g.fillText(head, W / 2 + 2, by + 40);
  g.fillStyle = "#b3261e";
  g.fillText(head, W / 2, by + 38);
  g.font = 'bold 15px "Courier New", monospace';
  g.fillStyle = "#4a3a22";
  g.fillText(`· ${MONTHS[city.month]} ${city.year} · a ${TIERS[city.tier].name} of the modem age ·`,
             W / 2, by + 66);
}

function drawPostcardStamp(g, x, y, w, h) {
  // white stamp with punched perforations against the cream card
  g.fillStyle = "#ffffff";
  g.fillRect(x, y, w, h);
  g.fillStyle = "#f3e7cd";
  for (let d = 3; d <= w - 3; d += 7) {
    g.beginPath(); g.arc(x + d, y, 2, 0, 7); g.fill();
    g.beginPath(); g.arc(x + d, y + h, 2, 0, 7); g.fill();
  }
  for (let d = 3; d <= h - 3; d += 7) {
    g.beginPath(); g.arc(x, y + d, 2, 0, 7); g.fill();
    g.beginPath(); g.arc(x + w, y + d, 2, 0, 7); g.fill();
  }
  // teal panel with a tiny sunset skyline (tier decides how tall it grew)
  g.fillStyle = "#2a7a6a";
  g.fillRect(x + 5, y + 5, w - 10, h - 10);
  g.fillStyle = "#f2c53a";
  g.beginPath(); g.arc(x + w / 2, y + 24, 8, 0, 7); g.fill();
  g.fillStyle = "#173f36";
  const floors = 2 + city.tier * 2;
  for (let k = 0; k < 5; k++) {
    const bh = 6 + ((k * 7 + floors * 3) % (8 + floors * 2));
    g.fillRect(x + 8 + k * 9, y + h - 12 - bh, 7, bh);
  }
  g.fillStyle = "#ffffff";
  g.font = 'bold 9px "Courier New", monospace';
  g.textAlign = "left";
  g.textBaseline = "alphabetic";
  g.fillText("SC99", x + 7, y + 14);
  g.textAlign = "right";
  g.fillText("32¢", x + w - 7, y + h - 4 - 10);
}

function drawPostcardPostmark(g, cx, cy, waveEndX) {
  // circular date cancel + three wavy killer bars running into the stamp
  g.strokeStyle = "rgba(74,58,90,.85)";
  g.lineWidth = 1.6;
  g.beginPath(); g.arc(cx, cy, 22, 0, 7); g.stroke();
  g.beginPath(); g.arc(cx, cy, 17, 0, 7); g.stroke();
  g.fillStyle = "rgba(74,58,90,.9)";
  g.font = 'bold 9px "Courier New", monospace';
  g.textAlign = "center";
  g.textBaseline = "alphabetic";
  g.fillText(MONTHS[city.month].toUpperCase(), cx, cy - 2);
  g.fillText(String(city.year), cx, cy + 9);
  for (let k = 0; k < 3; k++) {
    g.beginPath();
    const wy = cy - 8 + k * 8;
    g.moveTo(cx - 118, wy);
    for (let wx = cx - 118; wx <= waveEndX; wx += 12)
      g.quadraticCurveTo(wx + 6, wy + (((wx / 12) | 0) % 2 ? 3 : -3), wx + 12, wy);
    g.stroke();
  }
}

/* --------- preview dialog --------- */
function openPostcard() {
  composePostcard();
  document.getElementById("postcard-caption").textContent =
    `Wish you were here in ${city.cityName} — ${MONTHS[city.month]} ${city.year}. ` +
    `Weather's pixelated, send floppy disks.`;
  showDlg("dlg-postcard");
}

/* --------- save (graceful when the sandbox blocks downloads) --------- */
function postcardFilename() {
  const name = String(city.cityName).toLowerCase().replace(/[^a-z0-9]+/g, "") || "city";
  return `simcity99-${name}-${MONTHS[city.month].toLowerCase()}${city.year}.png`;
}

function savePostcard() {
  const cv = document.getElementById("postcard-canvas");
  const fname = postcardFilename();
  const finish = (url, isObjectURL) => {
    try {
      const a = document.createElement("a");
      a.href = url;
      a.download = fname;
      document.body.appendChild(a);
      a.click();       // may be silently ignored in a sandboxed iframe — fine
      a.remove();
      Snd.cash();
      setStatus(`📮 Postcard mailed — ${fname}`);
    } catch (e) {
      setStatus("📮 Downloads are blocked here — enjoy the preview instead.");
    } finally {
      if (isObjectURL) setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
  };
  try {
    cv.toBlob((blob) => {
      if (blob) finish(URL.createObjectURL(blob), true);
      else finish(cv.toDataURL("image/png"), false);
    }, "image/png");
  } catch (e) {
    try { finish(cv.toDataURL("image/png"), false); }
    catch (e2) { setStatus("📮 Could not export the postcard in this browser."); }
  }
}

document.getElementById("btn-postcard-save").addEventListener("click", () => {
  Snd.ensure();
  savePostcard();
});
