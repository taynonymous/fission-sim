/*
 * Fission chain-reaction engine. Pure logic, no DOM: runs in the browser
 * (window.FissionSim) and in Node (module.exports) for tuning/tests.
 *
 * Model (stylized): a hex lattice of nuclei in a 2D core. Neutrons fly in
 * straight lines; when one passes within a nucleus' effective radius it
 * interacts. Thermal neutrons "see" much larger fissile nuclei than fast
 * ones, which is the 2D stand-in for cross-sections. Fissile concentrations
 * are exaggerated so a reaction is visible with ~1,300 nuclei.
 */
(function (root) {
  'use strict';

  // Node type codes
  const T = {
    EMPTY: 0, U235: 1, PU239: 2, U233: 3, U238: 4, TH232: 5,
    FP: 6, XE135: 7, BREED_PU: 8, BREED_U3: 9, SPENT: 10,
  };

  // Per-isotope behaviour. r = effective radius as a fraction of lattice
  // spacing. th/fa = thermal/fast. fis/cap = branching once inside radius
  // (remainder is elastic scatter). Real physical constants: nu, mev, beta.
  const ISO = {
    [T.U235]: { key: 'U235', label: 'U-235', Z: 92, A: 235, nu: 2.43, mev: 202.5, beta: 0.0065,
      th: { r: 0.44, fis: 0.855, cap: 0.145 }, fa: { r: 0.15, fis: 0.5, cap: 0.1 } },
    [T.PU239]: { key: 'Pu239', label: 'Pu-239', Z: 94, A: 239, nu: 2.87, mev: 207.1, beta: 0.0021,
      th: { r: 0.5, fis: 0.735, cap: 0.265 }, fa: { r: 0.19, fis: 0.7, cap: 0.05 } },
    [T.U233]: { key: 'U233', label: 'U-233', Z: 92, A: 233, nu: 2.49, mev: 197.9, beta: 0.0026,
      th: { r: 0.44, fis: 0.915, cap: 0.085 }, fa: { r: 0.17, fis: 0.6, cap: 0.05 } },
    [T.U238]: { key: 'U238', label: 'U-238', Z: 92, A: 238, nu: 2.6, mev: 205.0, beta: 0.0148,
      th: { r: 0.05, fis: 0, cap: 1 }, fa: { r: 0.24, fis: 0.04, cap: 0.3 } },
    [T.TH232]: { key: 'Th232', label: 'Th-232', Z: 90, A: 232, nu: 2.3, mev: 196.0, beta: 0.0203,
      th: { r: 0.06, fis: 0, cap: 1 }, fa: { r: 0.22, fis: 0.01, cap: 0.3 } },
    [T.FP]: { label: 'Fission product', th: { r: 0.1, fis: 0, cap: 1 }, fa: null },
    [T.XE135]: { label: 'Xe-135', th: { r: 0.42, fis: 0, cap: 1 }, fa: null },
    [T.SPENT]: { label: 'U-236 / Pu-240', th: { r: 0.12, fis: 0, cap: 1 }, fa: null },
    [T.BREED_PU]: { label: 'U-239 → Pu-239', th: null, fa: null },
    [T.BREED_U3]: { label: 'Pa-233 → U-233', th: null, fa: null },
  };

  // Fragment pairs per compound nucleus, grouped by prompt neutron count.
  // Z and A balance: Zf1+Zf2 = Z, Af1+Af2+n = A+1.
  const FRAGMENTS = {
    [T.U235]: { 2: [['Xe-140', 'Sr-94'], ['Te-134', 'Zr-100']], 3: [['Ba-141', 'Kr-92'], ['Cs-137', 'Rb-96']] },
    [T.PU239]: { 2: [['Ba-144', 'Sr-94'], ['Xe-135', 'Zr-103']], 3: [['Xe-134', 'Zr-103'], ['Cs-138', 'Y-99'], ['Te-135', 'Mo-102']] },
    [T.U233]: { 2: [['Xe-139', 'Sr-93'], ['Cs-137', 'Rb-95'], ['Te-133', 'Zr-99']], 3: [['Ba-138', 'Kr-93']] },
    [T.U238]: { 2: [['Xe-139', 'Sr-98']], 3: [['Ba-143', 'Kr-93'], ['Xe-140', 'Sr-96']] },
    [T.TH232]: { 2: [['Xe-140', 'Kr-89']], 3: [['Ba-140', 'Kr-87']] },
  };

  const FUELS = [
    { id: 'natu', name: 'Natural uranium', short: 'Nat U', mix: { [T.U235]: 0.15, [T.U238]: 0.85 },
      real: '0.72% U-235 · 99.3% U-238', use: 'CANDU, Magnox, Chicago Pile-1',
      note: 'Too little U-235 to sustain a chain in light water. It needs a moderator that absorbs almost nothing: heavy water or graphite.' },
    { id: 'leu', name: 'Low-enriched uranium', short: 'LEU', mix: { [T.U235]: 0.3, [T.U238]: 0.7 },
      real: '3–5% U-235', use: 'Commercial PWR and BWR power plants',
      note: 'Today\'s workhorse fuel. Supercritical in water with the rods out, so the operator holds it at k = 1 with control rods.' },
    { id: 'heu', name: 'Highly enriched uranium', short: 'HEU', mix: { [T.U235]: 0.5, [T.U238]: 0.5 },
      real: '≥20% U-235, naval cores ~93%', use: 'Naval propulsion and research reactors',
      note: 'Dense enough in U-235 to go critical on fast neutrons with no moderator at all. Watch how fast it runs away.' },
    { id: 'pu', name: 'Plutonium-239', short: 'Pu-239', mix: { [T.PU239]: 0.36, [T.U238]: 0.64 },
      real: '≥93% Pu-239 (weapons grade)', use: 'Fast breeder cores, weapons',
      note: 'More neutrons per fission than U-235 and good fast fission. Only 0.21% of its neutrons are delayed, which leaves less margin for control.' },
    { id: 'mox', name: 'Mixed oxide (MOX)', short: 'MOX', mix: { [T.PU239]: 0.14, [T.U235]: 0.01, [T.U238]: 0.85 },
      real: '~7% PuO₂ in depleted UO₂', use: 'Recycled fuel in French and Japanese LWRs',
      note: 'Burns plutonium recovered from spent fuel. U-238 captures keep breeding fresh Pu-239 as it runs.' },
    { id: 'thor', name: 'Thorium / U-233', short: 'Th / U-233', mix: { [T.U233]: 0.17, [T.TH232]: 0.83 },
      real: 'Th-232 with a U-233 driver', use: 'MSRE, Shippingport LWBR, molten-salt concepts',
      note: 'Th-232 is fertile, not fissile. It captures a neutron and decays through Pa-233 into U-233, so the core breeds its own fuel.' },
  ];

  // therm: fast→thermal rate (1/s). abs: parasitic thermal absorption (1/s).
  // res: chance of U-238/Th-232 resonance capture while slowing down on a fertile site.
  const MODERATORS = {
    none: { label: 'None', detail: 'Fast spectrum', therm: 0, abs: 0, res: 0 },
    h2o: { label: 'Light water', detail: 'H₂O', therm: 5.5, abs: 0.7, res: 0.32 },
    d2o: { label: 'Heavy water', detail: 'D₂O', therm: 3.2, abs: 0.01, res: 0.18 },
    graphite: { label: 'Graphite', detail: 'C', therm: 2.6, abs: 0.03, res: 0.18 },
  };

  const W = 720, H = 480, SP = 16;
  const COLS = Math.floor(W / SP) - 1, ROWS = Math.floor(H / SP);
  const V_FAST = 210, V_THERM = 62;
  const MAX_N = 4000;
  const DELAY_BOOST = 8;          // delayed fraction exaggerated so it is visible
  const ROD_COUNT = 10, ROD_W = 24;
  const ROD_ABS = { fast: 14, therm: 70 };
  const REFLECT_P = 0.72;
  const SOURCE_RATE = 4;          // Am-Be startup source, neutrons/s
  const BUCKET = 0.25, NBUCKETS = 12;
  const DOPPLER = 0.5;            // strength of negative fuel-temperature feedback
  const ATOMS = 16;               // fissions a fresh fissile site can host
  const BRED_ATOMS = 3;           // fissile atoms a bred site gains
  const FERTILE = t => t === T.U238 || t === T.TH232;
  const FISSILE = t => t === T.U235 || t === T.PU239 || t === T.U233;

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function create(opts) {
    opts = opts || {};
    const rand = opts.rand || Math.random;
    const N = COLS * ROWS;
    const nx = new Float32Array(N), ny = new Float32Array(N);
    const type = new Uint8Array(N), timer = new Float32Array(N), atoms = new Uint8Array(N);
    for (let j = 0; j < ROWS; j++) {
      const off = (j & 1) ? SP / 2 : 0;
      for (let i = 0; i < COLS; i++) {
        const k = j * COLS + i;
        nx[k] = (i + 0.5) * SP + off + SP / 4;
        ny[k] = (j + 0.5) * SP;
      }
    }

    const px = new Float32Array(MAX_N), py = new Float32Array(MAX_N);
    const vx = new Float32Array(MAX_N), vy = new Float32Array(MAX_N);
    const th = new Uint8Array(MAX_N), last = new Int32Array(MAX_N);

    const s = {
      W, H, SP, COLS, ROWS, N, nx, ny, type, timer, atoms,
      px, py, vx, vy, th, n: 0,
      fuel: FUELS[1], mod: 'h2o', rods: 0, reflector: true, source: true,
      time: 0, pending: [], events: [], log: [],
      fissions: 0, energyMeV: 0, bred: 0, dropped: 0, fissile0: 1,
      births: new Float64Array(NBUCKETS), losses: new Float64Array(NBUCKETS),
      fisB: new Float64Array(NBUCKETS), eB: new Float64Array(NBUCKETS), bucketIdx: 0, bucketT: 0,
      sourceAcc: 0, rodXs: [], totB: 0, totL: 0, doppler: 1,
    };
    for (let r = 0; r < ROD_COUNT; r++) s.rodXs.push(((r + 1) / (ROD_COUNT + 1)) * W);

    function fissileCount() {
      let c = 0;
      for (let k = 0; k < N; k++) if (FISSILE(type[k])) c += atoms[k];
      return c;
    }

    s.loadFuel = function (id) {
      const f = FUELS.find(x => x.id === id) || s.fuel;
      s.fuel = f;
      const entries = Object.entries(f.mix).map(([t, p]) => [+t, p]);
      for (let k = 0; k < N; k++) {
        let r = rand(), t = entries[entries.length - 1][0];
        for (const [tt, p] of entries) { if (r < p) { t = tt; break; } r -= p; }
        type[k] = t; timer[k] = 0; atoms[k] = FISSILE(t) ? ATOMS : 1;
      }
      s.n = 0; s.pending.length = 0; s.events.length = 0; s.log.length = 0;
      s.fissions = 0; s.energyMeV = 0; s.bred = 0; s.dropped = 0;
      s.births.fill(0); s.losses.fill(0); s.fisB.fill(0); s.eB.fill(0);
      s.fissile0 = Math.max(1, fissileCount());
    };

    function spawn(x, y, thermal) {
      if (s.n >= MAX_N) { s.dropped++; return; }
      const a = rand() * Math.PI * 2, v = thermal ? V_THERM : V_FAST;
      const i = s.n++;
      px[i] = x; py[i] = y; vx[i] = Math.cos(a) * v; vy[i] = Math.sin(a) * v;
      th[i] = thermal ? 1 : 0; last[i] = -1;
    }
    s.inject = function (x, y, count) { for (let c = 0; c < (count || 1); c++) spawn(x, y, false); };

    function kill(i) {
      const e = --s.n;
      if (i !== e) {
        px[i] = px[e]; py[i] = py[e]; vx[i] = vx[e]; vy[i] = vy[e]; th[i] = th[e]; last[i] = last[e];
      }
      s.losses[s.bucketIdx]++; s.totL++;
    }

    function fission(k, t) {
      const iso = ISO[t];
      const base = Math.floor(iso.nu);
      const count = base + (rand() < iso.nu - base ? 1 : 0);
      const x = nx[k], y = ny[k];
      for (let c = 0; c < count; c++) {
        if (rand() < iso.beta * DELAY_BOOST) {
          s.pending.push({ t: s.time + 0.3 + -Math.log(1 - rand()) * 1.4, x, y });
        } else spawn(x, y, false);
      }
      if (--atoms[k] === 0) {
        type[k] = rand() < 0.25 ? T.XE135 : T.FP;
        timer[k] = type[k] === T.XE135 ? 6 + rand() * 10 : 0;
      }
      s.births[s.bucketIdx] += count; s.totB += count;
      s.fisB[s.bucketIdx]++;
      s.fissions++;
      s.energyMeV += iso.mev;
      s.eB[s.bucketIdx] += iso.mev;
      const pairs = FRAGMENTS[t][count] || FRAGMENTS[t][3];
      const pair = pairs[(rand() * pairs.length) | 0];
      const ev = { x, y, t: s.time, iso: iso.label, isoType: t, count, frags: pair, mev: iso.mev };
      s.events.push(ev);
      if (s.events.length > 400) s.events.splice(0, s.events.length - 400);
      s.log.push(ev);
      if (s.log.length > 60) s.log.shift();
    }

    function capture(k, t) {
      if (t === T.U238) { type[k] = T.BREED_PU; timer[k] = 4 + rand() * 5; }
      else if (t === T.TH232) { type[k] = T.BREED_U3; timer[k] = 4 + rand() * 5; }
      else if (t === T.XE135) { type[k] = T.FP; }
      else if (FISSILE(t) && --atoms[k] === 0) { type[k] = T.SPENT; }
    }

    function nearestNode(x, y) {
      const j = Math.round(y / SP - 0.5);
      if (j < 0 || j >= ROWS) return -1;
      const off = (j & 1) ? SP / 2 : 0;
      const i = Math.round((x - off - SP / 4) / SP - 0.5);
      if (i < 0 || i >= COLS) return -1;
      return j * COLS + i;
    }

    function substep(dt) {
      const mod = MODERATORS[s.mod];
      const pTherm = 1 - Math.exp(-mod.therm * dt);
      const pModAbs = 1 - Math.exp(-mod.abs * dt);
      const pRodF = 1 - Math.exp(-ROD_ABS.fast * dt), pRodT = 1 - Math.exp(-ROD_ABS.therm * dt);
      const rodDepth = s.rods * H, half = ROD_W / 2;

      for (let i = s.n - 1; i >= 0; i--) {
        let x = px[i] + vx[i] * dt, y = py[i] + vy[i] * dt;
        if (x < 0 || x > W || y < 0 || y > H) {
          if (s.reflector && rand() < REFLECT_P) {
            if (x < 0 || x > W) { vx[i] = -vx[i]; x = Math.min(W, Math.max(0, x)); }
            if (y < 0 || y > H) { vy[i] = -vy[i]; y = Math.min(H, Math.max(0, y)); }
          } else { kill(i); continue; }
        }
        px[i] = x; py[i] = y;

        if (y < rodDepth) {
          let inRod = false;
          for (let r = 0; r < s.rodXs.length; r++) if (Math.abs(x - s.rodXs[r]) < half) { inRod = true; break; }
          if (inRod && rand() < (th[i] ? pRodT : pRodF)) { kill(i); continue; }
        }

        if (!th[i]) {
          if (pTherm && rand() < pTherm) {
            const a = rand() * Math.PI * 2;
            vx[i] = Math.cos(a) * V_THERM; vy[i] = Math.sin(a) * V_THERM; th[i] = 1; last[i] = -1;
            // Resonance capture: slowing down past U-238/Th-232 resonances
            const kr = nearestNode(x, y);
            if (kr >= 0 && (type[kr] === T.U238 || type[kr] === T.TH232) && rand() < mod.res * s.doppler) {
              kill(i); capture(kr, type[kr]); continue;
            }
          }
        } else if (pModAbs && rand() < pModAbs) { kill(i); continue; }

        const k = nearestNode(x, y);
        if (k < 0 || k === last[i]) continue;
        const t = type[k];
        const iso = ISO[t];
        if (!iso) continue;
        const xs = th[i] ? iso.th : iso.fa;
        if (!xs) continue;
        const dx = x - nx[k], dy = y - ny[k], rr = xs.r * SP;
        if (dx * dx + dy * dy > rr * rr) continue;
        last[i] = k;
        const roll = rand();
        if (roll < xs.fis) { kill(i); fission(k, t); }
        else if (roll < xs.fis + xs.cap * (FERTILE(t) ? s.doppler : 1)) { kill(i); capture(k, t); }
        else {
          const a = rand() * Math.PI * 2, v = th[i] ? V_THERM : V_FAST;
          vx[i] = Math.cos(a) * v; vy[i] = Math.sin(a) * v;
        }
      }
    }

    s.step = function (dt) {
      // Doppler feedback: hotter fuel broadens U-238/Th-232 capture resonances
      let f = 0;
      for (let q = 0; q < NBUCKETS; q++) f += s.fisB[q];
      s.doppler = 1 + DOPPLER * Math.log10(1 + f / (NBUCKETS * BUCKET) / 40);
      const subs = Math.max(1, Math.ceil(dt * V_FAST / (SP * 0.25)));
      const h = dt / subs;
      for (let q = 0; q < subs; q++) {
        s.time += h;
        s.bucketT += h;
        if (s.bucketT >= BUCKET) {
          s.bucketT -= BUCKET;
          s.bucketIdx = (s.bucketIdx + 1) % NBUCKETS;
          s.births[s.bucketIdx] = 0; s.losses[s.bucketIdx] = 0; s.fisB[s.bucketIdx] = 0; s.eB[s.bucketIdx] = 0;
        }
        if (s.source) {
          s.sourceAcc += SOURCE_RATE * h;
          while (s.sourceAcc >= 1) { s.sourceAcc--; spawn(W / 2, H / 2, false); }
        }
        if (s.pending.length) {
          for (let p = s.pending.length - 1; p >= 0; p--) {
            const d = s.pending[p];
            if (d.t <= s.time) { spawn(d.x, d.y, false); s.pending.splice(p, 1); }
          }
        }
        substep(h);
      }
      for (let k = 0; k < N; k++) {
        if (timer[k] > 0) {
          timer[k] -= dt;
          if (timer[k] <= 0) {
            timer[k] = 0;
            const t = type[k];
            if (t === T.BREED_PU) { type[k] = T.PU239; atoms[k] = BRED_ATOMS; s.bred++; }
            else if (t === T.BREED_U3) { type[k] = T.U233; atoms[k] = BRED_ATOMS; s.bred++; }
            else if (t === T.XE135) { type[k] = T.FP; }
          }
        }
      }
    };

    s.stats = function () {
      let b = 0, l = 0, f = 0, e = 0;
      for (let q = 0; q < NBUCKETS; q++) { b += s.births[q]; l += s.losses[q]; f += s.fisB[q]; e += s.eB[q]; }
      let fast = 0;
      for (let i = 0; i < s.n; i++) if (!th[i]) fast++;
      const span = NBUCKETS * BUCKET;
      const fRate = f / span;
      return {
        k: l >= 6 ? b / l : null, doppler: s.doppler,
        neutrons: s.n, fast, thermal: s.n - fast, delayedPending: s.pending.length,
        fissionRate: fRate, powerMeVs: e / span,
        fissions: s.fissions, energyMeV: s.energyMeV,
        fissileFrac: fissileCount() / s.fissile0, bred: s.bred, capped: s.n >= MAX_N,
      };
    };

    s.loadFuel(opts.fuel || 'leu');
    if (opts.mod) s.mod = opts.mod;
    return s;
  }

  const api = { create, T, ISO, ATOMS, FUELS, MODERATORS, mulberry32, W, H, MAX_N, ROD_W, DELAY_BOOST };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FissionSim = api;
})(typeof window !== 'undefined' ? window : globalThis);
