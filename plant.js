/*
 * Plant model for the game. DOM-free so it can be tested in Node.
 *
 * Neutronics: one-delayed-group point kinetics with real reactivity
 * coefficients (Doppler, moderator temperature, void, xenon, rod S-curves,
 * burnup). Power is tracked over ~8 decades, from the source range up to
 * overpower. Time is compressed about 10x versus a real plant so that
 * startups and transients play out in seconds rather than minutes.
 *
 * Thermal-hydraulics: lumped fuel and coolant temperatures, pumps with
 * coast-down, natural circulation, boiling and dry-out, ECCS, decay heat.
 *
 * The particle simulation in sim.js runs alongside as the visible core: its
 * fission rate is steered to follow the point-kinetics power, while rods and
 * fuel burnup in it stay physical.
 */
(function (root) {
  'use strict';
  const F = root.FissionSim || (typeof require !== 'undefined' ? require('./sim.js') : null);
  const T = F.T;
  const ROD_COUNT = 10;

  const DESIGNS = {
    pwr: {
      id: 'pwr', name: 'PWR', full: 'Pressurized water reactor',
      blurb: 'Light water is both coolant and moderator. Hotter or boiling water moderates less, so power drops on its own. Forgiving, but it cannot stop decay heat.',
      fuel: { id: 'pwr', short: 'UO₂ 4.5%', name: 'Uranium dioxide, 4.5% U-235', mix: { [T.U235]: 0.3, [T.U238]: 0.7 } },
      mod: { therm: 5.5, abs: 0.7, res: 0.32 }, modName: 'Light water', coolant: 'Water, 155 bar',
      ratedMW: 3400, Tin: 292, dTcore: 18, dTfuel: 620, Tsat: 345,
      beta: 0.0065, lambda: 1.5, gen: 2e-4,
      rhoEx: 0.075, rodWorth: 0.13, tip: 0,
      alphaD: -3.0e-5, alphaM: -3.0e-4, voidW: -0.15, xeW: -0.026, burnK: 0.15, burnRate: 0.0001, eccsBoron: -0.04,
      rodSpeed: 0.08, scramSpeed: 1.5,
      meltT: 2865, meltWhat: 'UO₂ fuel melts at 2,865 °C', cladT: 1204, cladWhat: 'Zircaloy cladding limit, 1,204 °C',
      burnFrac: 0.01, onlineRefuel: false, zircaloy: true,
    },
    candu: {
      id: 'candu', name: 'CANDU', full: 'Pressurized heavy-water reactor',
      blurb: 'Natural uranium in a heavy-water tank. Little excess reactivity, so fuel burnout pulls power down fast. CANDUs refuel channel by channel while running.',
      fuel: { id: 'candu', short: 'Nat U', name: 'Natural uranium, 0.72% U-235', mix: { [T.U235]: 0.15, [T.U238]: 0.85 } },
      mod: { therm: 3.2, abs: 0.01, res: 0.18 }, modName: 'Heavy water', coolant: 'Heavy water, 100 bar',
      ratedMW: 2100, Tin: 266, dTcore: 22, dTfuel: 650, Tsat: 311,
      beta: 0.0058, lambda: 1.5, gen: 6e-4,
      rhoEx: 0.05, rodWorth: 0.08, tip: 0,
      alphaD: -1.5e-5, alphaM: 0, voidW: 0.012, xeW: -0.028, burnK: 0.5, burnRate: 0.0004, eccsBoron: -0.01,
      rodSpeed: 0.08, scramSpeed: 1.5,
      meltT: 2865, meltWhat: 'UO₂ fuel melts at 2,865 °C', cladT: 1204, cladWhat: 'Zircaloy cladding limit, 1,204 °C',
      burnFrac: 0.06, onlineRefuel: true, zircaloy: true,
    },
    rbmk: {
      id: 'rbmk', name: 'RBMK', full: 'Graphite-moderated boiling-water reactor',
      blurb: 'Graphite moderates; the water only cools and absorbs. Boiling removes an absorber, so steam adds power. Rods are slow, and their graphite tips add power as they first go in.',
      fuel: { id: 'rbmk', short: 'UO₂ 2%', name: 'Uranium dioxide, 2% U-235', mix: { [T.U235]: 0.2, [T.U238]: 0.8 } },
      mod: { therm: 2.6, abs: 0.03, res: 0.18 }, modName: 'Graphite', coolant: 'Boiling water, 70 bar',
      ratedMW: 3200, Tin: 270, dTcore: 12, dTfuel: 600, Tsat: 284,
      beta: 0.0048, lambda: 1.5, gen: 5e-4,
      rhoEx: 0.07, rodWorth: 0.11, tip: 0.0035,
      alphaD: -1.2e-5, alphaM: 0, voidW: 0.025, xeW: -0.03, burnK: 0.15, burnRate: 0.0001, eccsBoron: -0.01,
      rodSpeed: 0.04, scramSpeed: 0.07,
      meltT: 2865, meltWhat: 'UO₂ fuel melts at 2,865 °C', cladT: 1204, cladWhat: 'Zircaloy cladding limit, 1,204 °C',
      burnFrac: 0.01, onlineRefuel: true, zircaloy: true,
    },
    sfr: {
      id: 'sfr', name: 'SFR', full: 'Sodium-cooled fast reactor',
      blurb: 'No moderator: plutonium fissions on fast neutrons. Only 0.21% of neutrons are delayed, so it reacts quickly. Sodium boils at 883 °C, a huge coolant margin.',
      fuel: { id: 'sfr', short: 'Pu MOX', name: 'Plutonium–uranium MOX', mix: { [T.PU239]: 0.3, [T.U238]: 0.7 } },
      mod: { therm: 0, abs: 0, res: 0 }, modName: 'None (fast spectrum)', coolant: 'Liquid sodium, 1 bar',
      ratedMW: 1500, Tin: 395, dTcore: 150, dTfuel: 900, Tsat: 883,
      beta: 0.0021, lambda: 1.5, gen: 6e-5,
      rhoEx: 0.03, rodWorth: 0.05, tip: 0,
      alphaD: -1.5e-5, alphaM: -2.5e-5, voidW: 0.012, xeW: 0, burnK: 0.1, burnRate: 0.0001, eccsBoron: -0.01,
      rodSpeed: 0.05, scramSpeed: 1.5,
      meltT: 2750, meltWhat: 'MOX fuel melts at about 2,750 °C', cladT: 900, cladWhat: 'Steel cladding limit, about 900 °C',
      burnFrac: 0.01, onlineRefuel: false,
    },
  };

  const TAU_F = 2.5, TAU_C = 3.5, BOIL_TIME = 10, DECAY_FRAC = 0.066;
  const ECCS_TANK = 75, ECCS_FLOW = 0.7, ECCS_T = 40, ECCS_REFILL = 0.05;
  const NAT_CIRC = 0.05, PUMP_COAST = 3;
  const N_FLOOR = 1e-7;             // source-range floor (fraction of rated)
  const N_CAP = 1e4;                // numerical ceiling; the fuel melts long before this
  const VIS_RATE = 170;             // particle fissions/s drawn at 100% power

  // Rods sit where the flux is highest in the middle of the core.
  const ROD_WEIGHT = (() => {
    const w = [];
    for (let i = 0; i < ROD_COUNT; i++) w.push(Math.pow(Math.sin(Math.PI * (i + 1) / (ROD_COUNT + 1)), 2));
    const s = w.reduce((a, b) => a + b, 0);
    return w.map(x => x / s);
  })();
  // Integral rod worth: the S-curve real control rods follow.
  const sCurve = z => z - Math.sin(2 * Math.PI * z) / (2 * Math.PI);
  // RBMK graphite displacer: the first ~1.2 m of travel adds reactivity.
  const tipBump = z => (z > 0 && z < 0.3) ? Math.sin(Math.PI * z / 0.3) : 0;

  function smooth(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

  function create(designId, opts) {
    opts = opts || {};
    // opts.overrides lets tests tweak a design (e.g. disable melting) without touching DESIGNS
    const d = Object.assign({}, DESIGNS[designId], opts.overrides);
    const sim = F.create({ fuel: 'leu', rand: opts.rand, burnFrac: d.burnFrac });
    sim.modObj = d.mod;
    sim.loadFuel(d.fuel);
    sim.source = true;
    sim.reflectY = false;
    sim.feedback = { doppler: 1, thermScale: 1, extraAbs: 0, fastAbs: 0 };
    sim.rods = 1;

    const p = {
      d, sim, time: 0,
      n: N_FLOOR * 10, C: 0, rho: 0, rhoParts: {},
      Tf: d.Tin, Tc: d.Tin, Tclad: d.Tin, Tcl: d.Tin, leak: 0, zr: 0, level: 1, voidEff: 0, boron: 0, void: 0, flow: 1, pumps: true, pumpsTripped: false,
      eccs: false, eccsLeft: ECCS_TANK, eccsTank: ECCS_TANK,
      decay: 0, I: 0, X: 0, power: 0, period: Infinity,
      rodTarget: new Array(ROD_COUNT).fill(1), rods: new Array(ROD_COUNT).fill(1), scram: false,
      energyMWh: 0, peakTf: d.Tin, peakPower: 0, cladSecs: 0, melted: false,
      fissile: 1, burn: 0, visBias: 0, visRate: 0, lastFis: 0,
    };
    p.C = d.beta / (d.gen * d.lambda) * p.n;
    sim.rodDepths = p.rods.slice();

    const clamp01 = v => Math.min(1, Math.max(0, v));
    p.setRod = function (i, v) { if (!p.scram) p.rodTarget[i] = clamp01(v); };
    p.setAllRods = function (v) { if (!p.scram) p.rodTarget.fill(clamp01(v)); };
    p.nudgeRods = function (dv) { if (!p.scram) for (let i = 0; i < ROD_COUNT; i++) p.rodTarget[i] = clamp01(p.rodTarget[i] + dv); };
    p.avgRods = () => p.rods.reduce((a, b) => a + b, 0) / ROD_COUNT;
    p.doScram = function () { p.scram = true; p.rodTarget.fill(1); };
    p.resetScram = function () { p.scram = false; };
    p.setPumps = function (on) { if (on && p.pumpsTripped) return false; p.pumps = on; return true; };
    p.tripPumps = function () { p.pumpsTripped = true; p.pumps = false; };
    p.setEccs = function (on) { p.eccs = on && p.eccsLeft > 0; };

    p.rodRho = function (depths) {
      let r = 0;
      for (let i = 0; i < ROD_COUNT; i++) r += ROD_WEIGHT[i] * (sCurve(depths[i]) - (d.tip ? d.tip / d.rodWorth * tipBump(depths[i]) : 0));
      return -d.rodWorth * r;
    };

    p.computeRho = function () {
      const parts = p.rhoParts;
      parts.excess = d.rhoEx;
      parts.rods = p.rodRho(p.rods);
      parts.doppler = d.alphaD * (p.Tf - d.Tin);
      parts.moderator = d.alphaM * (p.Tc - d.Tin);
      parts.void = d.voidW * p.voidEff;
      parts.boron = d.eccsBoron * p.boron;
      parts.xenon = d.xeW * p.X;
      parts.burnup = -d.burnK * p.burn;
      let r = 0;
      for (const k in parts) r += parts[k];
      p.rho = r;
      return r;
    };

    // Steady state at a power fraction; returns the uniform rod position that holds it.
    p.preset = function (frac, opt) {
      opt = opt || {};
      p.n = Math.max(N_FLOOR, frac);
      p.Tc = d.Tin + d.dTcore * frac;
      p.Tf = p.Tc + d.dTfuel * frac;
      p.decay = DECAY_FRAC * frac;
      // default iodine/xenon to their equilibrium at this power (matches the I/X equations in step)
      const pc = Math.min(frac, 3);
      p.I = opt.I == null ? pc : opt.I;
      p.X = opt.X == null ? (0.95 * pc + 0.05 * pc) / (0.35 + 0.65 * pc) : opt.X;
      p.C = d.beta / (d.gen * d.lambda) * p.n;
      p.power = frac;
      // bisection on a uniform rod position for rho = 0
      let lo = 0, hi = 1;
      for (let it = 0; it < 40; it++) {
        const mid = (lo + hi) / 2;
        p.rods.fill(mid);
        if (p.computeRho() > 0) lo = mid; else hi = mid;
      }
      p.rodTarget = p.rods.slice();
      for (let i = 0; i < ROD_COUNT; i++) sim.rodDepths[i] = p.rods[i];
      const nv = Math.round(VIS_RATE * Math.min(frac, 3) * 0.35);
      for (let i = 0; i < nv; i++) sim.inject(Math.random() * F.W, Math.random() * F.H, 1);
      p.visRate = VIS_RATE * frac;
      return p.rods[0];
    };

    function kinetics(dt) {
      // implicit one-group point kinetics, sub-stepped
      const rho = p.rho, b = d.beta, L = d.gen, lam = d.lambda;
      const S = N_FLOOR * Math.max(1e-3, -rho) / L;
      // Near and above prompt critical power grows very fast. Keep each implicit step
      // well inside that time constant, or the denominator below can reach zero and
      // flip sign (wrong, even negative, power on long frames).
      // Step size from the fastest-growing mode: the positive root of the one-group
      // inhour equation L w^2 + (L lam + beta - rho) w - rho lam = 0.
      const B = L * lam + b - rho;
      const growth = Math.max(0, (-B + Math.sqrt(B * B + 4 * L * rho * lam)) / (2 * L));
      const subs = Math.min(5000, Math.max(8, Math.ceil(dt * growth / 0.02)));
      const h = dt / subs;
      const n0 = p.n;
      for (let s = 0; s < subs; s++) {
        const a = 1 - h * (rho - b) / L - (h * h * lam * b) / (L * (1 + h * lam));
        const nn = (p.n + h * lam * p.C / (1 + h * lam) + h * S) / a;
        p.C = Math.max(0, (p.C + h * b / L * nn) / (1 + h * lam));
        p.n = Math.max(0, Math.min(nn, N_CAP));
        if (p.n >= N_CAP) break;
      }
      const g = dt > 0 ? Math.log(Math.max(p.n, 1e-12) / Math.max(n0, 1e-12)) / dt : 0;
      p.period = Math.abs(g) < 1e-4 ? Infinity : 1 / g;
    }

    p.step = function (dt) {
      if (p.melted || dt <= 0) return;
      p.time += dt;

      // Rod drives
      const speed = (p.scram ? d.scramSpeed : d.rodSpeed) * dt;
      for (let i = 0; i < ROD_COUNT; i++) {
        const diff = p.rodTarget[i] - p.rods[i];
        p.rods[i] = Math.abs(diff) <= speed ? p.rodTarget[i] : p.rods[i] + Math.sign(diff) * speed;
        sim.rodDepths[i] = p.rods[i];
      }

      p.computeRho();
      kinetics(dt);
      const pf = p.n;

      // Decay heat builds with operation and fades after shutdown
      const dTarget = DECAY_FRAC * pf;
      p.decay += (dTarget - p.decay) * Math.min(1, dt / (dTarget > p.decay ? 10 : 120));
      p.power = pf * (1 - DECAY_FRAC) + p.decay;
      p.peakPower = Math.max(p.peakPower, pf);

      // Iodine-135 → xenon-135, normalised to 1 at full-power equilibrium
      if (d.xeW) {
        const pc = Math.min(pf, 3);
        p.I += (pc - p.I) * dt / 25;
        p.X += (0.95 * p.I + 0.05 * pc - p.X * (0.35 + 0.65 * pc)) * dt / 25;
        if (p.X < 0) p.X = 0;
      }

      // Pumps, natural circulation, ECCS
      // Coolant leak (loss-of-coolant accident) drains inventory; ECCS refills it with borated water
      if (p.leak > 0) p.level = Math.max(0, p.level - p.leak * dt);
      if (p.eccs) { p.level = Math.min(1, p.level + ECCS_REFILL * dt); p.boron = Math.min(1, p.boron + dt / 6); }
      p.voidEff = 1 - p.level * (1 - p.void);
      const pumpOk = smooth(0.45, 0.7, p.level);   // pumps cavitate as the level drops
      const flowTarget = (p.pumps ? pumpOk : 0) + NAT_CIRC * (1 - p.voidEff) * (p.pumps ? 0 : 1);
      p.flow += (flowTarget - p.flow) * Math.min(1, dt / PUMP_COAST);
      if (p.eccs) { p.eccsLeft -= dt; if (p.eccsLeft <= 0) { p.eccsLeft = 0; p.eccs = false; } }

      // Fuel → coolant heat transfer collapses as the channel dries out
      const h = 1 - 0.92 * smooth(0.35, 0.85, p.voidEff);
      const qIn = (p.Tf - p.Tc) * h / d.dTfuel;
      // Zirconium–steam reaction: above ~1,200 °C hot cladding burns in steam and adds heat
      p.zr = (d.zircaloy && p.voidEff > 0.3 && p.Tclad > 1150) ? 0.04 * (p.Tclad - 1150) / 300 * p.voidEff : 0;
      // an uncovered core heats almost adiabatically
      const heatTau = TAU_F * (1 - 0.7 * smooth(0.8, 1, p.voidEff));
      p.Tf += (p.power + p.zr) * d.dTfuel * dt / heatTau - (p.Tf - p.Tc) * h * dt / TAU_F;

      let qOut = p.flow * (p.Tc - d.Tin) / d.dTcore;
      if (p.eccs) qOut += ECCS_FLOW * (p.Tc - ECCS_T) / d.dTcore;
      qOut *= p.level > 0.05 ? 1 : 0;
      const net = qIn - qOut;
      if (p.voidEff >= 0.999 && net > 0) {
        // uncovered core: steam superheats quickly
        p.Tc += net * d.dTcore * dt / (TAU_C * 0.05);
      } else if (p.void > 0 || (p.Tc >= d.Tsat && net > 0)) {
        if (p.void < 1 || net < 0) {
          // boiling at saturation: net heat makes or condenses steam
          p.void = Math.min(1, Math.max(0, p.void + net * dt / BOIL_TIME));
          p.Tc = d.Tsat;
        } else {
          // dry channel: steam superheats quickly
          p.Tc += net * d.dTcore * dt / (TAU_C * 0.05);
        }
      } else {
        p.Tc += net * d.dTcore * dt / TAU_C;
      }
      if (p.Tc < ECCS_T) p.Tc = ECCS_T;

      // Cladding sits between coolant and fuel; when the channel dries out it heads for fuel temperature
      p.Tclad = p.Tc + (p.Tf - p.Tc) * (0.2 + 0.75 * (1 - h));
      // Centerline runs hotter than the pellet average
      p.Tcl = p.Tc + 1.7 * (p.Tf - p.Tc);
      p.peakTf = Math.max(p.peakTf, p.Tcl);
      p.peakClad = Math.max(p.peakClad || 0, p.Tclad);
      if (p.Tclad >= d.cladT) p.cladSecs += dt;
      if (p.Tcl >= d.meltT) p.melted = true;
      // 1 game second ≈ 1 plant minute for energy; 33% thermal efficiency
      p.energyMWh += Math.max(0, pf) * d.ratedMW * 0.33 * dt / 60;
      p.burn += Math.min(pf, 5) * d.burnRate * dt;

      stepVisual(dt);
    };

    // Steer the particle core so its fission rate follows plant power.
    function stepVisual(dt) {
      const target = VIS_RATE * Math.min(p.n, 12);
      const fb = sim.feedback;
      fb.thermScale = Math.max(0.1, 1 - 0.9 * p.voidEff);
      fb.doppler = 1;
      fb.extraAbs = p.visBias;
      sim.step(dt);
      const fis = sim.fissions - p.lastFis; p.lastFis = sim.fissions;
      p.visRate += (fis / dt - p.visRate) * Math.min(1, dt / 0.6);
      const err = Math.log((p.visRate + 2) / (target + 2));
      p.visBias = Math.max(-0.6, Math.min(12, p.visBias + err * dt * 2));
      sim.cull(Math.round(target * 0.6 + 25));
      // top up neutrons when the core is below target (rods can starve it)
      const deficit = target - p.visRate;
      if (deficit > 5) {
        const k = Math.min(40, Math.round(deficit * dt * 0.8 + Math.random()));
        for (let i = 0; i < k; i++) {
          const j = (Math.random() * sim.N) | 0;
          sim.inject(sim.nx[j], sim.ny[j], 1);
        }
      }
      p.fissile = sim.stats().fissileFrac;
    }

    p.refuel = function () {
      if (d.onlineRefuel || p.n < 0.02) { sim.refuelPartial(0.12); p.burn *= 0.88; p.fissile = sim.stats().fissileFrac; return true; }
      return false;
    };

    return p;
  }

  const api = { create, DESIGNS, ROD_COUNT, ROD_WEIGHT, N_FLOOR, N_CAP };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Plant = api;
})(typeof window !== 'undefined' ? window : globalThis);
