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
  fanfare() { // milestone promotion — triumphant lil' bugle
    const seq = [523.3, 659.3, 784, 1046.5];
    seq.forEach((f, k) => this.tone(f, 0.16, "square", 0.16, k * 0.11));
    this.tone(1046.5, 0.5, "triangle", 0.18, seq.length * 0.11);
  },

  // ---- tiny generative jazz-ish loop (very 90s "city" mood) ----
  startMusic() {
    if (!this.ctx || this.musicTimer) return;
    const bass  = [110, 110, 146.8, 98, 110, 87.3, 146.8, 164.8];  // A A D G A F D E
    const scale = [220, 261.6, 293.7, 329.6, 392, 440, 523.3];      // A minor pentatonic-ish
    let bar = 0;
    const playBar = () => {
      if (!this.musicOn || !this.ctx) return;
      const t0 = this.ctx.currentTime + 0.05;
      const b = bass[bar % bass.length];
      // bass
      for (let beat = 0; beat < 4; beat++) {
        this.musNote(b / (beat === 2 ? 1 : 2) * 2, t0 + beat * 0.5, 0.4, "triangle", 0.5);
      }
      // sparse lead
      for (let beat = 0; beat < 8; beat++) {
        if (Math.random() < 0.4) {
          const f = scale[(Math.random() * scale.length) | 0] * (Math.random() < 0.25 ? 2 : 1);
          this.musNote(f, t0 + beat * 0.25, 0.22, "square", 0.16);
        }
      }
      // hats
      for (let beat = 0; beat < 8; beat++) this.musHat(t0 + beat * 0.25, beat % 2 ? 0.02 : 0.045);
      bar++;
    };
    playBar();
    this.musicTimer = setInterval(playBar, 2000);
  },
  stopMusic() { clearInterval(this.musicTimer); this.musicTimer = null; },
  musNote(freq, t, dur, type, vol) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.musicGain);
    o.start(t); o.stop(t + dur + 0.05);
  },
  musHat(t, vol) {
    const len = (this.ctx.sampleRate * 0.05) | 0;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 6000;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    src.connect(f); f.connect(g); g.connect(this.musicGain);
    src.start(t);
  },

  toggleMusic() {
    this.musicOn = !this.musicOn;
    if (this.ctx) { this.musicOn ? this.startMusic() : this.stopMusic(); }
    return this.musicOn;
  },
  toggleSfx() { this.sfxOn = !this.sfxOn; return this.sfxOn; },
};
