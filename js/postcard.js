/* ============ SimCity 99 — postcard photo mode (M14) ============ */
"use strict";

// "Send Postcard…" composes the CURRENT viewport into a retro 1997 postcard
// on its own dedicated canvas (#postcard-canvas). The live #game canvas is
// only ever a drawImage SOURCE here — it is never drawn onto, resized, read
// back, or otherwise touched, and nothing in this file runs per frame: the
// compose happens exactly once per menu click / recompose, the PNG encode
// exactly once per Save click. The preview dialog therefore works even in a
// sandboxed iframe where downloads are blocked — Save just degrades to a
// polite status-bar apology while the preview stays on screen.

const POSTCARD = {
  padL: 40, padR: 40,   // cream margins left / right of the photo mount
  padT: 88,             // top strip: stamp + postmark live here
  padB: 96,             // bottom strip: headline + dateline live here
  photoW: 560,          // photo width; height follows the viewport aspect
  ring: 8,              // white photo-print mount around the photo
};

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

  // the photograph: the entire live viewport, scaled into the photo area —
  // whatever renderFrame last drew (night tint, season palette, disasters,
  // cars) is exactly what the postcard shows
  g.imageSmoothingEnabled = true;
  g.drawImage(game, 0, 0, gw, gh, px, py, pw, ph);
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
