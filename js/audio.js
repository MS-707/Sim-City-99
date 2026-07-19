/* ============ SimCity 99 — WebAudio synth (no samples, all original) ============ */
"use strict";

const Snd = {
  ctx: null, master: null, musicGain: null,
  sfxOn: true, musicOn: true, musicTimer: null,

  ensure() {
    if (this.ctx) return true;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.16;
      this.musicGain.connect(this.master);
      if (this.musicOn) this.startMusic();
    } catch (e) { return false; }
    return true;
  },

  tone(freq, dur, type = "square", vol = 0.2, when = 0, slide = 0) {
    if (!this.sfxOn || !this.ensure()) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  },

  noise(dur, vol = 0.25, freq = 800, when = 0) {
    if (!this.sfxOn || !this.ensure()) return;
    const t = this.ctx.currentTime + when;
    const len = Math.max(1, (this.ctx.sampleRate * dur) | 0);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t);
  },

  // ---- the SFX palette ----
  click()    { this.tone(1100, 0.04, "square", 0.12); },
  denied()   { this.tone(160, 0.18, "sawtooth", 0.2); this.tone(120, 0.22, "sawtooth", 0.16, 0.05); },
  place()    { this.noise(0.08, 0.2, 600); this.tone(520, 0.07, "triangle", 0.2, 0.02); },
  zone()     { this.tone(700, 0.05, "square", 0.14); this.tone(940, 0.06, "square", 0.12, 0.05); },
  bulldoze() { this.noise(0.28, 0.3, 300); this.tone(90, 0.25, "sawtooth", 0.18, 0, -40); },
  wire()     { this.tone(1500, 0.06, "sawtooth", 0.1, 0, -700); },
  cash()     { this.tone(1320, 0.06, "square", 0.14); this.tone(1760, 0.1, "square", 0.14, 0.07); },
  grow()     { this.tone(660, 0.05, "triangle", 0.1); this.tone(880, 0.06, "triangle", 0.09, 0.05); },
  siren() {
    for (let k = 0; k < 3; k++) {
      this.tone(700, 0.22, "square", 0.12, k * 0.45);
      this.tone(520, 0.22, "square", 0.12, k * 0.45 + 0.22);
    }
  },
  boom()     { this.noise(0.7, 0.4, 200); this.tone(60, 0.6, "sine", 0.35, 0, -20); },
  ufo() {
    for (let k = 0; k < 6; k++) this.tone(900 + k * 120, 0.1, "sine", 0.1, k * 0.08, 300);
  },
  monthChime() { this.tone(1046, 0.08, "sine", 0.07); },

  // ---- zoom-level ambience (scheduled by ambienceFrame in ambience.js) ----
  ambTraffic() {   // busy-road hum: filtered rumble + engine drone
    this.noise(1.3, 0.055, 240);
    this.tone(65, 1.1, "sawtooth", 0.035, 0, 18);
    this.tone(52, 1.2, "triangle", 0.03, 0.1, 10);
  },
  ambIndustry() {  // short metallic clanks from the mills
    const base = 420 + Math.random() * 480;
    this.tone(base, 0.08, "square", 0.07);
    this.tone(base * 1.63, 0.05, "square", 0.05, 0.02);
    this.noise(0.09, 0.06, 2600, 0.01);
    this.tone(base * 0.57, 0.1, "square", 0.05, 0.3);
  },
  ambWater() {     // gull chirps over lapping water
    const n = 2 + ((Math.random() * 2) | 0);
    for (let k = 0; k < n; k++)
      this.tone(1700 + Math.random() * 500, 0.16, "sine", 0.05, k * 0.22, -650);
    this.noise(1.1, 0.03, 420, 0.05);
  },
  ambChopper() {   // news chopper overhead (M18): rotor thump-thump + wash
    for (let k = 0; k < 5; k++)
      this.tone(62, 0.07, "triangle", 0.11, k * 0.15, -16);
    this.noise(0.85, 0.04, 320);
  },
  ambStadium() {   // crowd swell + a distant vuvuzela-ish drone
    this.noise(1.5, 0.085, 1200);
    this.noise(0.9, 0.05, 900, 0.35);
    this.tone(311, 0.45, "sawtooth", 0.025, 0.4, 40);
  },

  fanfare() { // milestone promotion — triumphant lil' bugle
    const seq = [523.3, 659.3, 784, 1046.5];
    seq.forEach((f, k) => this.tone(f, 0.16, "square", 0.16, k * 0.11));
    this.tone(1046.5, 0.5, "triangle", 0.18, seq.length * 0.11);
  },

  // ---- M20: generative multi-mood soundtrack -------------------------------
  // Four DISTINCT generative moods, each with its own tempo, note-set,
  // instrument voices and register. The active mood is chosen from live sim
  // state (pop / demand / day-night / disaster) and mood changes CROSSFADE via
  // per-mood GainNodes hanging under musicGain — no hard cuts. All synthesized
  // live in WebAudio; there are no samples.
  moods: {
    // sparse, airy early-build theme — slow, high-ish major pentatonic on soft voices
    calm: {
      id: "calm", interval: 2600, base: 110.0, bassOct: 1,
      scale: [220.0, 246.9, 277.2, 329.6, 370.0],   // A major-pentatonic
      bassType: "triangle", leadType: "sine",
      density: 0.24, hats: false, swing: 0, vol: 1.0,
    },
    // up-tempo, dense downtown groove — bright square lead, driving saw bass, hats
    bustling: {
      id: "bustling", interval: 1450, base: 130.8, bassOct: 1,
      scale: [261.6, 293.7, 329.6, 392.0, 440.0, 523.3], // C major-pentatonic (higher)
      bassType: "sawtooth", leadType: "square",
      density: 0.62, hats: true, swing: 0, vol: 1.0,
    },
    // dissonant, low, ominous — tritone-laced set on twin sawtooths, deep register
    tension: {
      id: "tension", interval: 1800, base: 65.4, bassOct: 1,
      scale: [138.6, 146.8, 185.0, 196.0, 233.1],   // C#/D + tritones, tense
      bassType: "sawtooth", leadType: "sawtooth",
      density: 0.5, hats: false, swing: 0, vol: 1.0,
    },
    // mellow, swung night jazz — minor-7th colours on sine/triangle, lower octave
    night: {
      id: "night", interval: 2200, base: 98.0, bassOct: 1,
      scale: [220.0, 261.6, 311.1, 349.2, 415.3, 466.2], // A dorian-ish w/ b7
      bassType: "sine", leadType: "triangle",
      density: 0.4, hats: true, swing: 0.35, vol: 1.0,
    },
  },
  moodGains: null,        // { id: GainNode } — each feeds musicGain
  activeMood: null,       // id of the mood currently faded up
  crossfadeTime: 1.2,     // seconds of overlap on a mood switch

  // Pick a mood id from live city state. Disaster ALWAYS wins (tension).
  selectMood() {
    const c = (typeof city !== "undefined" && city) ? city
            : (typeof window !== "undefined" && window.city) || null;
    if (!c) return "calm";
    let burning = false;
    if (c.fire) for (let k = 0; k < c.fire.length; k++) { if (c.fire[k]) { burning = true; break; } }
    if (c.disaster || burning) return "tension";               // disaster precedence
    const hour = (((c.tickCount | 0) % 24) + 24) % 24;
    const night = hour < 6 || hour >= 21;                      // at/near midnight
    const pop = c.pop || 0;
    const dem = c.demand || { r: 0, c: 0, i: 0 };
    const hiDemand = dem.r > 0.6 || dem.c > 0.6 || dem.i > 0.6;
    const busy = pop >= 4000 || (pop >= 1200 && hiDemand);     // thriving metropolis
    if (night) return busy ? "bustling" : "night";
    return busy ? "bustling" : "calm";
  },

  // Re-evaluate desired mood and crossfade to it if it changed.
  updateMood() {
    if (!this.ctx || !this.moodGains) return this.activeMood;
    const want = this.selectMood();
    if (want !== this.activeMood) this.crossfadeTo(want);
    return this.activeMood;
  },

  ensureMoodGains() {
    if (this.moodGains) return;
    this.moodGains = {};
    for (const id in this.moods) {
      const g = this.ctx.createGain();
      g.gain.value = 0;
      g.connect(this.musicGain);
      this.moodGains[id] = g;
    }
  },

  // Ramp the target mood's gain up and every other mood's gain down, overlapping.
  crossfadeTo(id) {
    if (!this.moodGains || !this.moods[id]) return;
    const now = this.ctx.currentTime;
    const cf = this.crossfadeTime;
    for (const k in this.moodGains) {
      const gp = this.moodGains[k].gain;
      const target = k === id ? this.moods[id].vol : 0;
      gp.cancelScheduledValues(now);
      gp.setValueAtTime(gp.value, now);
      gp.linearRampToValueAtTime(target, now + cf);
    }
    this.activeMood = id;
  },

  startMusic() {
    if (!this.ctx || this.musicTimer) return;
    this.ensureMoodGains();
    // choose an initial mood and fade it in (from silence, still a ramp)
    const start = this.selectMood();
    this.activeMood = null;
    this.crossfadeTo(start);
    this.scheduleBar();
  },

  // Self-rescheduling bar player: tempo follows the ACTIVE mood, so switching
  // moods changes the groove without a hard timer restart.
  scheduleBar() {
    if (!this.musicOn || !this.ctx) { this.musicTimer = null; return; }
    this.updateMood();                          // let live state steer the mood
    const mood = this.moods[this.activeMood] || this.moods.calm;
    this.playBar(mood);
    this.musicTimer = setTimeout(() => this.scheduleBar(), mood.interval);
  },

  playBar(mood) {
    const t0 = this.ctx.currentTime + 0.05;
    const dest = this.moodGains[mood.id];
    const barLen = mood.interval / 1000;
    const beatLen = barLen / 4;
    const sc = mood.scale;
    // walking-ish bass, one hit per beat, occasional octave drop
    for (let beat = 0; beat < 4; beat++) {
      const root = mood.base * (beat === 2 ? 2 : 1);
      this.musNote(root, t0 + beat * beatLen, beatLen * 0.85, mood.bassType, 0.5, dest);
    }
    // lead motif, 8 sixteenth slots, density + swing per mood
    for (let s = 0; s < 8; s++) {
      if (Math.random() < mood.density) {
        const oct = Math.random() < 0.22 ? 2 : 1;
        const f = sc[(Math.random() * sc.length) | 0] * oct;
        const sw = (s % 2 && mood.swing) ? beatLen * 0.5 * mood.swing : 0;
        this.musNote(f, t0 + s * (beatLen / 2) + sw, beatLen * 0.9, mood.leadType, 0.16, dest);
      }
    }
    // hats for busier moods
    if (mood.hats) {
      for (let s = 0; s < 8; s++) this.musHat(t0 + s * (beatLen / 2), s % 2 ? 0.02 : 0.045, dest);
    }
  },

  stopMusic() { clearTimeout(this.musicTimer); this.musicTimer = null; },

  musNote(freq, t, dur, type, vol, dest) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(dest || this.musicGain);
    o.start(t); o.stop(t + dur + 0.05);
  },
  musHat(t, vol, dest) {
    const len = (this.ctx.sampleRate * 0.05) | 0;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 6000;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    src.connect(f); f.connect(g); g.connect(dest || this.musicGain);
    src.start(t);
  },

  toggleMusic() {
    this.musicOn = !this.musicOn;
    if (this.ctx) { this.musicOn ? this.startMusic() : this.stopMusic(); }
    return this.musicOn;
  },
  toggleSfx() { this.sfxOn = !this.sfxOn; return this.sfxOn; },
};
