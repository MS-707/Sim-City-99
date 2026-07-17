/* ============ SimCity 99 — simulation core ============ */
"use strict";

// ---- shared constants ----
const TW = 64, TH = 32, HW = TW / 2, HH = TH / 2; // iso tile metrics
const MAP = 80;                                    // map is MAP x MAP tiles

const TERR = { GRASS: 0, WATER: 1, FOREST: 2 };

const OV = {
  NONE: 0, ROAD: 1, WIRE: 2, ZR: 3, ZC: 4, ZI: 5, PARK: 6,
  POLICE: 7, FIRESTA: 8, COAL: 9, SOLAR: 10, RUBBLE: 11,
};

// footprint (w,h) per overlay type
const OV_SIZE = {
  [OV.POLICE]: 2, [OV.FIRESTA]: 2, [OV.COAL]: 2, [OV.SOLAR]: 2,
};
const sizeOf = (t) => OV_SIZE[t] || 1;

// population / jobs per developed zone level (index 0 unused)
const RES_POP = [0, 8, 24, 56];
const COM_JOB = [0, 6, 18, 40];
const IND_JOB = [0, 8, 22, 48];

const POWER_CAP = { [OV.COAL]: 300, [OV.SOLAR]: 120 };

const COST = {
  bulldoze: 1, road: 10, wire: 5, zr: 100, zc: 100, zi: 100,
  park: 50, tree: 25, police: 500, firesta: 500, coal: 3000, solar: 5000,
};

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// ---- deterministic-ish PRNG (so terrain can be reseeded) ----
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class City {
  constructor(seed) {
    const n = MAP * MAP;
    this.terr    = new Uint8Array(n);
    this.over    = new Uint8Array(n);   // OV.*
    this.lvl     = new Uint8Array(n);   // zone development level 0..3
    this.varnt   = new Uint8Array(n);   // sprite variant
    this.anc     = new Int32Array(n).fill(-1); // anchor index for multi-tile
    this.powered = new Uint8Array(n);
    this.access  = new Uint8Array(n);   // 1 = road within reach
    this.fire    = new Uint8Array(n);   // burning ticks remaining
    this.unpow   = new Uint8Array(n);   // consecutive unpowered growth passes
    this.poll    = new Uint8Array(n);   // pollution 0..255
    this.landv   = new Uint8Array(n);   // land value 0..255
    this.crime   = new Uint8Array(n);   // crime 0..255
    this.polCov  = new Uint8Array(n);   // police coverage
    this.fireCov = new Uint8Array(n);   // fire dept coverage
    this.traffic = new Uint8Array(n);   // road congestion 0..255 (roads only)

    this.funds = 20000;
    this.taxRate = 7;               // percent
    this.month = 0; this.year = 1997;
    this.tickCount = 0;
    this.pop = 0; this.jobs = 0;
    this.demand = { r: 0.4, c: 0.1, i: 0.5 };
    this.powerDemand = 0; this.powerSupply = 0;
    this.history = { pop: [], funds: [] };
    this.lastBudget = { taxes: 0, roads: 0, power: 0, services: 0, net: 0 };
    this.disastersEnabled = true;
    this.disaster = null;           // {kind:'tornado'|'ufo', x, y, ticks}
    this.powerDirty = true;
    this.messages = [];             // ticker event queue
    this.cityName = "Llamaville";

    this.generateTerrain(seed ?? ((Math.random() * 1e9) | 0));
  }

  idx(x, y) { return y * MAP + x; }
  inMap(x, y) { return x >= 0 && y >= 0 && x < MAP && y < MAP; }

  // ---------- terrain generation ----------
  generateTerrain(seed) {
    this.seed = seed;
    const rnd = mulberry32(seed);
    // coarse random grid, bilinear-interpolated => smooth heightmap
    const C = 9, cell = MAP / (C - 1);
    const g = [];
    for (let i = 0; i < C * C; i++) g.push(rnd());
    const hAt = (x, y) => {
      const gx = Math.min(x / cell, C - 1.001), gy = Math.min(y / cell, C - 1.001);
      const x0 = gx | 0, y0 = gy | 0, fx = gx - x0, fy = gy - y0;
      const sm = (t) => t * t * (3 - 2 * t);
      const a = g[y0 * C + x0], b = g[y0 * C + x0 + 1];
      const c = g[(y0 + 1) * C + x0], d = g[(y0 + 1) * C + x0 + 1];
      return a + (b - a) * sm(fx) + (c - a) * sm(fy) + (a - b - c + d) * sm(fx) * sm(fy);
    };
    for (let y = 0; y < MAP; y++) for (let x = 0; x < MAP; x++) {
      const h = hAt(x, y) + (rnd() - 0.5) * 0.14;
      const i = this.idx(x, y);
      if (h < 0.34) this.terr[i] = TERR.WATER;
      else if (h > 0.62 && rnd() < 0.75) this.terr[i] = TERR.FOREST;
      else this.terr[i] = TERR.GRASS;
      if (this.terr[i] === TERR.FOREST) this.varnt[i] = (rnd() * 3) | 0;
      if (this.terr[i] === TERR.GRASS) this.varnt[i] = (rnd() * 4) | 0;
    }
  }

  // ---------- building / bulldozing ----------
  canPlace(tool, x, y) {
    const s = sizeOf(toolOverlay(tool));
    for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) {
      const X = x + dx, Y = y + dy;
      if (!this.inMap(X, Y)) return false;
      const i = this.idx(X, Y);
      if (tool === "bulldoze") continue;
      if (this.over[i] !== OV.NONE) return false;
      if (this.terr[i] === TERR.WATER) {
        // only roads & wires may bridge water
        if (tool !== "road" && tool !== "wire") return false;
      }
      if (this.terr[i] === TERR.FOREST && (tool === "tree")) return false;
    }
    return true;
  }

  toolCost(tool, x, y) {
    let c = COST[tool] ?? 0;
    if ((tool === "road" || tool === "wire") && this.inMap(x, y) &&
        this.terr[this.idx(x, y)] === TERR.WATER) c *= 5; // bridges cost more
    return c;
  }

  place(tool, x, y) {
    if (tool === "bulldoze") return this.bulldoze(x, y);
    if (!this.canPlace(tool, x, y)) return { ok: false, reason: "blocked" };
    const cost = this.toolCost(tool, x, y);
    if (this.funds < cost) return { ok: false, reason: "funds" };
    const type = toolOverlay(tool);
    if (tool === "tree") {
      const i = this.idx(x, y);
      this.terr[i] = TERR.FOREST; this.varnt[i] = (Math.random() * 3) | 0;
      this.funds -= cost;
      return { ok: true, cost };
    }
    const s = sizeOf(type);
    const a = this.idx(x, y);
    for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) {
      const i = this.idx(x + dx, y + dy);
      this.over[i] = type; this.lvl[i] = 0; this.anc[i] = a;
      this.varnt[i] = (Math.random() * 3) | 0;
      if (this.terr[i] === TERR.FOREST) this.terr[i] = TERR.GRASS;
    }
    this.funds -= cost;
    this.powerDirty = true;
    return { ok: true, cost };
  }

  bulldoze(x, y) {
    if (!this.inMap(x, y)) return { ok: false, reason: "blocked" };
    let i = this.idx(x, y);
    if (this.over[i] === OV.NONE && this.terr[i] !== TERR.FOREST)
      return { ok: false, reason: "nothing" };
    if (this.funds < COST.bulldoze) return { ok: false, reason: "funds" };
    if (this.over[i] === OV.NONE) { // clear forest
      this.terr[i] = TERR.GRASS;
      this.funds -= COST.bulldoze;
      return { ok: true, cost: COST.bulldoze };
    }
    // remove the whole multi-tile building
    const a = this.anc[i] >= 0 ? this.anc[i] : i;
    const ax = a % MAP, ay = (a / MAP) | 0;
    const s = sizeOf(this.over[a]);
    for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) {
      const j = this.idx(ax + dx, ay + dy);
      this.over[j] = OV.NONE; this.lvl[j] = 0; this.anc[j] = -1;
      this.fire[j] = 0; this.unpow[j] = 0;
    }
    this.funds -= COST.bulldoze;
    this.powerDirty = true;
    return { ok: true, cost: COST.bulldoze };
  }

  // ---------- power network ----------
  recomputePower() {
    this.powered.fill(0);
    let supply = 0;
    const q = [];
    const conducts = (i) => this.over[i] !== OV.NONE && this.over[i] !== OV.ROAD
      && this.over[i] !== OV.RUBBLE;
    for (let i = 0; i < this.over.length; i++) {
      if ((this.over[i] === OV.COAL || this.over[i] === OV.SOLAR) && this.anc[i] === i) {
        supply += POWER_CAP[this.over[i]];
      }
      if (this.over[i] === OV.COAL || this.over[i] === OV.SOLAR) {
        this.powered[i] = 1; q.push(i);
      }
    }
    while (q.length) {
      const i = q.pop();
      const x = i % MAP, y = (i / MAP) | 0;
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const X = x + dx, Y = y + dy;
        if (!this.inMap(X, Y)) continue;
        const j = this.idx(X, Y);
        if (!this.powered[j] && conducts(j)) { this.powered[j] = 1; q.push(j); }
      }
    }
    // demand = number of developed/zoned consumer tiles that got power
    let demand = 0;
    for (let i = 0; i < this.over.length; i++) {
      const t = this.over[i];
      if (this.powered[i] && t >= OV.ZR && t !== OV.WIRE && t !== OV.RUBBLE
          && t !== OV.COAL && t !== OV.SOLAR) demand++;
    }
    this.powerSupply = supply; this.powerDemand = demand;
    if (demand > supply && supply > 0) {
      // brownout: cut power to a fraction of consumers
      const cutRatio = 1 - supply / demand;
      for (let i = 0; i < this.powered.length; i++) {
        const t = this.over[i];
        if (this.powered[i] && t >= OV.ZR && t !== OV.COAL && t !== OV.SOLAR &&
            Math.random() < cutRatio) this.powered[i] = 0;
      }
      this.pushMsg("⚡ BROWNOUTS reported — the grid is over capacity! Build more power plants.");
    } else if (supply === 0 && demand === 0) {
      this.powered.fill(0);
    }
    this.powerDirty = false;
  }

  // ---------- road access (multi-source BFS, depth 3) ----------
  recomputeAccess() {
    this.access.fill(0);
    let q = [];
    for (let i = 0; i < this.over.length; i++)
      if (this.over[i] === OV.ROAD) { this.access[i] = 4; q.push(i); }
    for (let d = 3; d >= 1 && q.length; d--) {
      const next = [];
      for (const i of q) {
        const x = i % MAP, y = (i / MAP) | 0;
        for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const X = x + dx, Y = y + dy;
          if (!this.inMap(X, Y)) continue;
          const j = this.idx(X, Y);
          if (this.access[j] === 0 && this.terr[j] !== TERR.WATER) {
            this.access[j] = d; next.push(j);
          }
        }
      }
      q = next;
    }
  }

  // ---------- traffic ----------
  // nearest road tile within manhattan distance 3 (matches access BFS reach)
  nearestRoad(i) {
    const x = i % MAP, y = (i / MAP) | 0;
    for (let r = 1; r <= 3; r++) {
      for (let dy = -r; dy <= r; dy++) {
        const dx = r - Math.abs(dy);
        for (const sx of dx === 0 ? [0] : [-dx, dx]) {
          const X = x + sx, Y = y + dy;
          if (!this.inMap(X, Y)) continue;
          const j = Y * MAP + X;
          if (this.over[j] === OV.ROAD) return j;
        }
      }
    }
    return -1;
  }

  // max congestion on any road within 2 tiles — what a zone "feels"
  trafficNear(i) {
    const x = i % MAP, y = (i / MAP) | 0;
    let m = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const X = x + dx, Y = y + dy;
      if (!this.inMap(X, Y)) continue;
      const j = Y * MAP + X;
      if (this.over[j] === OV.ROAD && this.traffic[j] > m) m = this.traffic[j];
    }
    return m;
  }

  // each developed zone emits trips onto its serving road, then the trips
  // random-walk a short way along the road network (commutes / deliveries).
  recomputeTraffic() {
    const n = MAP * MAP;
    const load = this._trafficLoad || (this._trafficLoad = new Float32Array(n));
    load.fill(0);
    for (let i = 0; i < n; i++) {
      const t = this.over[i];
      if ((t !== OV.ZR && t !== OV.ZC && t !== OV.ZI) || this.lvl[i] === 0) continue;
      const trips = 4 + this.lvl[i] * 9;      // busier at higher development
      let cur = this.nearestRoad(i);
      if (cur < 0) continue;
      let prev = -1;
      for (let step = 0; step < 10; step++) {
        load[cur] += trips;
        const x = cur % MAP, y = (cur / MAP) | 0;
        let nxt = -1, cnt = 0;
        for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const X = x + dx, Y = y + dy;
          if (!this.inMap(X, Y)) continue;
          const j = Y * MAP + X;
          if (this.over[j] !== OV.ROAD || j === prev) continue;
          cnt++;
          if (Math.random() * cnt < 1) nxt = j;  // reservoir pick
        }
        if (nxt < 0) break;
        prev = cur; cur = nxt;
      }
    }
    // blend toward the new load so congestion is stable; roads only
    for (let i = 0; i < n; i++) {
      this.traffic[i] = this.over[i] === OV.ROAD
        ? Math.min(255, this.traffic[i] * 0.5 + Math.min(255, load[i]) * 0.5)
        : 0;
    }
  }

  // ---------- pollution / land value / crime / coverage ----------
  recomputeMaps() {
    const n = MAP * MAP;
    const src = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = this.over[i];
      if (t === OV.ZI) src[i] += 30 + this.lvl[i] * 35;
      if (t === OV.COAL) src[i] += 120;
      if (t === OV.ROAD) src[i] += 8;
      if (this.fire[i]) src[i] += 100;
    }
    this.diffuse(src, this.poll, 3, 0.24);

    // land value: water/forest/park proximity is good, pollution is bad
    const lv = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      if (this.terr[i] === TERR.WATER) lv[i] = 60;
      else if (this.terr[i] === TERR.FOREST) lv[i] = 40;
      if (this.over[i] === OV.PARK) lv[i] = 90;
    }
    const lvOut = new Uint8Array(n);
    this.diffuse(lv, lvOut, 4, 0.3);

    // congested roads drag down nearby land value (noise, fumes, gridlock)
    const tr = new Float32Array(n);
    for (let i = 0; i < n; i++) if (this.traffic[i]) tr[i] = this.traffic[i];
    const trOut = new Uint8Array(n);
    this.diffuse(tr, trOut, 2, 0.35);

    for (let i = 0; i < n; i++) {
      let v = 40 + lvOut[i] - this.poll[i] * 0.7 - trOut[i] * 0.4; // traffic penalty
      this.landv[i] = Math.max(0, Math.min(255, v));
    }

    // police / fire coverage
    this.stampCoverage(OV.POLICE, this.polCov, 12);
    this.stampCoverage(OV.FIRESTA, this.fireCov, 12);

    // crime: density beats coverage
    for (let i = 0; i < n; i++) {
      const t = this.over[i];
      const density = (t === OV.ZR || t === OV.ZC) ? this.lvl[i] * 40 : (t === OV.ZI ? this.lvl[i] * 20 : 0);
      const v = density - this.polCov[i] - this.landv[i] * 0.2;
      this.crime[i] = Math.max(0, Math.min(255, v));
    }
  }

  diffuse(src, out, passes, rate) {
    let a = src, b = new Float32Array(src.length);
    for (let p = 0; p < passes; p++) {
      for (let y = 0; y < MAP; y++) for (let x = 0; x < MAP; x++) {
        const i = y * MAP + x;
        let sum = a[i], cnt = 1;
        if (x > 0)       { sum += a[i - 1];   cnt++; }
        if (x < MAP - 1) { sum += a[i + 1];   cnt++; }
        if (y > 0)       { sum += a[i - MAP]; cnt++; }
        if (y < MAP - 1) { sum += a[i + MAP]; cnt++; }
        b[i] = a[i] * (1 - rate) + (sum / cnt) * rate;
      }
      [a, b] = [b, a];
    }
    for (let i = 0; i < out.length; i++) out[i] = Math.max(0, Math.min(255, a[i]));
  }

  stampCoverage(type, out, radius) {
    out.fill(0);
    for (let i = 0; i < this.over.length; i++) {
      if (this.over[i] !== type || this.anc[i] !== i) continue;
      if (!this.powered[i]) continue; // stations need power
      const x = i % MAP, y = (i / MAP) | 0;
      for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
        const X = x + dx, Y = y + dy;
        if (!this.inMap(X, Y)) continue;
        const d = Math.abs(dx) + Math.abs(dy);
        if (d > radius) continue;
        const j = this.idx(X, Y);
        out[j] = Math.max(out[j], Math.min(255, (radius - d) * 18));
      }
    }
  }

  // ---------- demand ----------
  recomputeDemand() {
    let pop = 0, cJobs = 0, iJobs = 0;
    for (let i = 0; i < this.over.length; i++) {
      if (this.over[i] === OV.ZR) pop += RES_POP[this.lvl[i]];
      else if (this.over[i] === OV.ZC) cJobs += COM_JOB[this.lvl[i]];
      else if (this.over[i] === OV.ZI) iJobs += IND_JOB[this.lvl[i]];
    }
    this.pop = pop; this.jobs = cJobs + iJobs;
    const taxMod = (7 - this.taxRate) * 0.05;         // low taxes juice demand
    const jobsAvail = this.jobs + 40 - pop * 0.62;    // 40 = external commuters
    this.demand.r = clampD(jobsAvail / 220 + taxMod);
    this.demand.c = clampD((pop * 0.28 - cJobs) / 160 + taxMod * 0.6);
    this.demand.i = clampD((pop * 0.42 - iJobs) / 180 + 0.28 + taxMod * 0.4);
    function clampD(v) { return Math.max(-1, Math.min(1, v)); }
  }

  // ---------- growth ----------
  growthPass() {
    const n = MAP * MAP;
    const tries = 340;
    for (let t = 0; t < tries; t++) {
      const i = (Math.random() * n) | 0;
      const ov = this.over[i];
      if (ov !== OV.ZR && ov !== OV.ZC && ov !== OV.ZI) continue;
      if (this.fire[i]) continue;
      const dem = ov === OV.ZR ? this.demand.r : ov === OV.ZC ? this.demand.c : this.demand.i;
      const powered = this.powered[i], road = this.access[i] > 0;

      if (!powered) {
        this.unpow[i] = Math.min(250, this.unpow[i] + 1);
        if (this.lvl[i] > 0 && this.unpow[i] > 6 && Math.random() < 0.35) this.lvl[i]--;
        continue;
      }
      this.unpow[i] = 0;

      // congestion on the serving roads (city.traffic) dampens growth
      const cong = this.trafficNear(i) / 255;

      if (this.lvl[i] === 0) {
        if (road && dem > 0 && Math.random() < dem * 0.85 * (1 - cong * 0.7)) {
          this.lvl[i] = 1; this.varnt[i] = (Math.random() * 3) | 0;
        }
      } else if (dem > 0.15 && this.lvl[i] < 3) {
        // upgrading needs decent conditions
        let fit = this.landv[i] / 255;
        if (ov === OV.ZI) fit = 0.75; // industry doesn't care about views
        if (ov === OV.ZR) fit -= this.crime[i] / 400;
        fit *= 1 - cong * 0.75;       // nobody moves up on a gridlocked block
        if (road && Math.random() < dem * fit * 0.42) {
          this.lvl[i]++; this.varnt[i] = (Math.random() * 3) | 0;
        }
      } else if (dem < -0.25 && this.lvl[i] > 0 && Math.random() < -dem * 0.3) {
        this.lvl[i]--;
      }

      // gridlock actively drives tenants away
      if (this.lvl[i] > 1 && cong > 0.8 && Math.random() < 0.07) this.lvl[i]--;
    }
  }

  // ---------- fire ----------
  fireTick() {
    const burning = [];
    for (let i = 0; i < this.fire.length; i++) if (this.fire[i]) burning.push(i);
    for (const i of burning) {
      const cov = this.fireCov[i];
      this.fire[i] = Math.max(0, this.fire[i] - 1 - (cov > 40 ? 2 : 0));
      if (this.fire[i] === 0) {
        // burnt out -> rubble (or scorched earth)
        if (this.over[i] !== OV.NONE) {
          const a = this.anc[i] >= 0 ? this.anc[i] : i;
          const ax = a % MAP, ay = (a / MAP) | 0, s = sizeOf(this.over[a]);
          for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) {
            const j = this.idx(ax + dx, ay + dy);
            this.over[j] = OV.RUBBLE; this.lvl[j] = 0; this.anc[j] = -1;
          }
          this.powerDirty = true;
        } else if (this.terr[i] === TERR.FOREST) this.terr[i] = TERR.GRASS;
        continue;
      }
      // spread
      const x = i % MAP, y = (i / MAP) | 0;
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const X = x + dx, Y = y + dy;
        if (!this.inMap(X, Y)) continue;
        const j = this.idx(X, Y);
        if (this.fire[j]) continue;
        const flammable = (this.over[j] !== OV.NONE && this.over[j] !== OV.ROAD &&
                           this.over[j] !== OV.RUBBLE) || this.terr[j] === TERR.FOREST;
        if (!flammable) continue;
        const chance = 0.09 * (1 - this.fireCov[j] / 300);
        if (Math.random() < chance) this.fire[j] = 8 + ((Math.random() * 6) | 0);
      }
    }
  }

  ignite(x, y) {
    if (!this.inMap(x, y)) return;
    const i = this.idx(x, y);
    const flammable = (this.over[i] !== OV.NONE && this.over[i] !== OV.ROAD &&
                       this.over[i] !== OV.RUBBLE) || this.terr[i] === TERR.FOREST;
    if (flammable) this.fire[i] = 10 + ((Math.random() * 8) | 0);
  }

  startDisaster(kind) {
    if (kind === "fire") {
      // torch a random developed tile
      const cand = [];
      for (let i = 0; i < this.over.length; i++)
        if (this.over[i] >= OV.ZR && this.over[i] !== OV.RUBBLE) cand.push(i);
      const i = cand.length ? cand[(Math.random() * cand.length) | 0]
                            : (Math.random() * this.over.length) | 0;
      this.ignite(i % MAP, (i / MAP) | 0);
      this.pushMsg("🔥 FIRE breaks out downtown! Firefighters scramble.");
      return;
    }
    this.disaster = {
      kind,
      x: 5 + Math.random() * (MAP - 10),
      y: 5 + Math.random() * (MAP - 10),
      vx: Math.random() - 0.5, vy: Math.random() - 0.5,
      ticks: kind === "ufo" ? 70 : 90,
    };
    this.pushMsg(kind === "ufo"
      ? "👽 UNIDENTIFIED FLYING OBJECT over the city! (Roswell was 50 years ago... coincidence?)"
      : "🌪️ TORNADO WARNING! A twister is tearing through town!");
  }

  disasterTick() {
    const d = this.disaster;
    if (!d) return;
    d.ticks--;
    d.vx += (Math.random() - 0.5) * 0.4; d.vy += (Math.random() - 0.5) * 0.4;
    const sp = Math.hypot(d.vx, d.vy) || 1;
    d.vx = d.vx / sp * 0.8; d.vy = d.vy / sp * 0.8;
    d.x = Math.max(1, Math.min(MAP - 2, d.x + d.vx));
    d.y = Math.max(1, Math.min(MAP - 2, d.y + d.vy));
    const cx = d.x | 0, cy = d.y | 0;
    if (d.kind === "tornado") {
      // destroy what's underneath
      for (const [dx, dy] of [[0,0],[1,0],[0,1]]) {
        const X = cx + dx, Y = cy + dy;
        if (!this.inMap(X, Y)) continue;
        const i = this.idx(X, Y);
        if (this.over[i] !== OV.NONE && Math.random() < 0.5) {
          const a = this.anc[i] >= 0 ? this.anc[i] : i;
          const ax = a % MAP, ay = (a / MAP) | 0, s = sizeOf(this.over[a]);
          for (let ddy = 0; ddy < s; ddy++) for (let ddx = 0; ddx < s; ddx++) {
            const j = this.idx(ax + ddx, ay + ddy);
            this.over[j] = OV.RUBBLE; this.lvl[j] = 0; this.anc[j] = -1;
          }
          this.powerDirty = true;
        } else if (this.terr[i] === TERR.FOREST && Math.random() < 0.4) {
          this.terr[i] = TERR.GRASS;
        }
      }
    } else if (d.kind === "ufo") {
      // the saucer zaps things with fire
      if (Math.random() < 0.35) this.ignite(cx, cy);
    }
    if (d.ticks <= 0) {
      this.disaster = null;
      this.pushMsg(d.kind === "ufo" ? "👽 The saucer departs. The truth is out there."
                                    : "🌪️ The tornado dissipates. Assess the damage, Mayor.");
    }
  }

  // ---------- budget (monthly) ----------
  collectBudget() {
    let roads = 0, wires = 0, services = 0, plants = 0;
    for (let i = 0; i < this.over.length; i++) {
      const t = this.over[i];
      if (t === OV.ROAD) roads++;
      else if (t === OV.WIRE) wires++;
      else if ((t === OV.POLICE || t === OV.FIRESTA) && this.anc[i] === i) services++;
      else if ((t === OV.COAL || t === OV.SOLAR) && this.anc[i] === i) plants++;
    }
    const taxes = Math.round(this.pop * this.taxRate * 0.28 + this.jobs * this.taxRate * 0.18);
    const roadCost = Math.round(roads * 0.4 + wires * 0.15);
    const serviceCost = services * 25;
    const plantCost = plants * 40;
    const net = taxes - roadCost - serviceCost - plantCost;
    this.funds += net;
    this.lastBudget = { taxes, roads: roadCost, power: plantCost, services: serviceCost, net };
    if (this.funds < 0) this.pushMsg("💸 The city is BROKE. Raise taxes or cut back, Mayor!");
    this.history.pop.push(this.pop);
    this.history.funds.push(this.funds);
    if (this.history.pop.length > 240) { this.history.pop.shift(); this.history.funds.shift(); }
  }

  // ---------- master tick ----------
  tick() {
    this.tickCount++;
    if (this.powerDirty || this.tickCount % 10 === 0) {
      this.recomputePower();
      this.recomputeAccess();
    }
    if (this.tickCount % 5 === 0) this.recomputeTraffic();
    if (this.tickCount % 14 === 0) this.recomputeMaps();
    this.recomputeDemand();
    this.growthPass();
    if (this.tickCount % 2 === 0) this.fireTick();
    this.disasterTick();

    // random misfortune
    if (this.disastersEnabled && Math.random() < 0.0009 && this.pop > 200) {
      this.startDisaster(Math.random() < 0.75 ? "fire" : (Math.random() < 0.6 ? "tornado" : "ufo"));
    }

    // a month passes every 24 ticks
    if (this.tickCount % 24 === 0) {
      this.month++;
      if (this.month >= 12) { this.month = 0; this.year++; }
      this.collectBudget();
      return true; // month rolled over
    }
    return false;
  }

  pushMsg(m) { this.messages.push(m); }

  // ---------- save / load ----------
  serialize() {
    return JSON.stringify({
      v: 1, seed: this.seed, cityName: this.cityName,
      funds: this.funds, taxRate: this.taxRate,
      month: this.month, year: this.year, tickCount: this.tickCount,
      disastersEnabled: this.disastersEnabled,
      terr: Array.from(this.terr), over: Array.from(this.over),
      lvl: Array.from(this.lvl), varnt: Array.from(this.varnt),
      anc: Array.from(this.anc),
      history: this.history,
    });
  }

  static deserialize(json) {
    const d = JSON.parse(json);
    const c = new City(d.seed);
    c.cityName = d.cityName; c.funds = d.funds; c.taxRate = d.taxRate;
    c.month = d.month; c.year = d.year; c.tickCount = d.tickCount;
    c.disastersEnabled = d.disastersEnabled;
    c.terr.set(d.terr); c.over.set(d.over); c.lvl.set(d.lvl);
    c.varnt.set(d.varnt); c.anc.set(d.anc);
    c.history = d.history || { pop: [], funds: [] };
    c.powerDirty = true;
    c.recomputePower(); c.recomputeAccess(); c.recomputeTraffic();
    c.recomputeMaps(); c.recomputeDemand();
    return c;
  }
}

// map tool id -> overlay type
function toolOverlay(tool) {
  return ({
    road: OV.ROAD, wire: OV.WIRE, zr: OV.ZR, zc: OV.ZC, zi: OV.ZI,
    park: OV.PARK, police: OV.POLICE, firesta: OV.FIRESTA,
    coal: OV.COAL, solar: OV.SOLAR,
  })[tool] ?? OV.NONE;
}
