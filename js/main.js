/* ============ SimCity 99 — bootstrap & game loop ============ */
"use strict";

let city = null;
let simAccum = 0, lastTime = 0;
const TICK_MS = 250; // one sim tick at "Llama" speed

function boot() {
  buildSprites();
  renderInit(document.getElementById("game"));
  uiInit();

  document.getElementById("btn-new-city").addEventListener("click", () => {
    Snd.ensure(); Snd.cash();
    newCity();
    startGame();
  });
  document.getElementById("btn-load-city").addEventListener("click", () => {
    Snd.ensure();
    if (loadCity()) startGame();
    else alert("No saved city found in this browser. Start a new one!");
  });

  // pre-create a city so the sim objects exist even on splash
  newCity();
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

  renderFrame(city, UI);
  ambienceFrame(city);
  tickerFrame();
  refreshHUD();
  newsFrame();
  advisorsFrame();
  if (++mmCounter % 15 === 0) renderMinimap(city, UI.mapMode);

  requestAnimationFrame(loop);
}

window.addEventListener("DOMContentLoaded", boot);
