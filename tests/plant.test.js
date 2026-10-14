// Physics tests for the game's plant model (plant.js). Run: npm test
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../sim.js');
const P = require('../plant.js');

const DESIGNS = Object.keys(P.DESIGNS);
const DT = 1 / 60;

function run(p, secs, dt, each) {
  const steps = Math.round(secs / (dt || DT));
  for (let i = 0; i < steps; i++) {
    if (each) each(p, p.time);
    p.step(dt || DT);
    if (p.melted) break;
  }
  return p;
}

// Hold reactivity fixed, bypassing feedback, to test the kinetics solver alone.
function fixedRho(design, rho, n0) {
  const p = P.create(design, { overrides: { meltT: Infinity, cladT: Infinity } });
  p.preset(n0 == null ? 1 : n0);
  p.computeRho = () => (p.rho = rho);
  return p;
}

// Exact one-delayed-group solution from equilibrium at n(0) = 1:
// roots of L w^2 + (L lam + beta - rho) w - rho lam = 0, with n'(0) = rho / L.
function exactN(d, rho, t) {
  const L = d.gen, lam = d.lambda, b = d.beta;
  const B = L * lam + b - rho, disc = Math.sqrt(B * B + 4 * L * rho * lam);
  const w1 = (-B + disc) / (2 * L), w2 = (-B - disc) / (2 * L);
  const A1 = (rho / L - w2) / (w1 - w2), A2 = 1 - A1;
  return A1 * Math.exp(w1 * t) + A2 * Math.exp(w2 * t);
}

test('point kinetics matches the exact one-group solution', () => {
  for (const id of DESIGNS) {
    const d = P.DESIGNS[id];
    for (const dollars of [-1, -0.3, 0.1, 0.5, 0.9]) {
      const rho = dollars * d.beta;
      // run 3 s, or less if the exact answer would pass 1000x (keeps clear of the numeric cap)
      let T = 3;
      while (exactN(d, rho, T) > 1000) T *= 0.8;
      const p = run(fixedRho(id, rho), T);
      const want = exactN(d, rho, p.time);
      const err = Math.abs(p.n - want) / want;
      assert.ok(err < 0.03, `${id} ρ=$${dollars}: got ${p.n.toPrecision(4)}, exact ${want.toPrecision(4)} (${(err * 100).toFixed(1)}% off)`);
    }
  }
});

test('prompt-supercritical steps stay accurate even on long frames', () => {
  // Regression: one 50 ms frame used to send power negative in the SFR at ρ = 0.03.
  for (const id of DESIGNS) {
    const d = P.DESIGNS[id];
    const rho = 2 * d.beta;                  // $2: prompt critical
    const T = 6 * d.gen / (rho - d.beta);    // ~6 prompt e-folds
    for (const dt of [T / 40, T / 2, T]) {
      const p = run(fixedRho(id, rho), T, dt);
      const want = exactN(d, rho, p.time);
      assert.ok(p.n > 0 && Number.isFinite(p.n), `${id} dt=${dt}: n=${p.n}`);
      assert.ok(Math.abs(p.n - want) / want < 0.1, `${id} dt=${dt.toExponential(1)}: got ${p.n.toPrecision(4)}, exact ${want.toPrecision(4)}`);
    }
  }
});

test('power is never negative or NaN, whatever the operator does', () => {
  const rand = F.mulberry32(1234);
  for (const id of DESIGNS) {
    for (const dt of [1 / 120, 1 / 60, 0.05]) {
      for (let trial = 0; trial < 3; trial++) {
        const p = P.create(id, { rand });
        if (trial > 0) p.preset(trial === 1 ? 1 : 0.3);
        run(p, 60, dt, (pp) => {
          const r = rand();
          if (r < 0.03) pp.setAllRods(rand());
          else if (r < 0.06) pp.setRod((rand() * P.ROD_COUNT) | 0, rand());
          else if (r < 0.065) pp.setPumps(!pp.pumps);
          else if (r < 0.068) pp.setEccs(!pp.eccs);
          else if (r < 0.069) pp.leak = 0.03;
          else if (r < 0.071) pp.refuel();
          else if (r < 0.072) { if (pp.scram) pp.resetScram(); else pp.doScram(); }
          for (const [k, v] of Object.entries({ n: pp.n, C: pp.C, Tf: pp.Tf, Tc: pp.Tc, level: pp.level, void: pp.void })) {
            assert.ok(Number.isFinite(v), `${id} dt=${dt} t=${pp.time.toFixed(2)}: ${k}=${v}`);
          }
          assert.ok(pp.n >= 0 && pp.C >= 0, `${id} dt=${dt}: negative population n=${pp.n} C=${pp.C}`);
          assert.ok(pp.level >= 0 && pp.level <= 1 && pp.void >= 0 && pp.void <= 1, `${id}: level/void out of range`);
        });
      }
    }
  }
});

test('every control rod removes reactivity as it goes in', () => {
  for (const id of DESIGNS) {
    const p = P.create(id), d = P.DESIGNS[id];
    for (let i = 0; i < P.ROD_COUNT; i++) {
      const depths = new Array(P.ROD_COUNT).fill(0);
      let prev = p.rodRho(depths);
      // RBMK graphite tips add reactivity over the first 30% of travel; that is by design.
      const start = d.tip ? 0.3 : 0;
      for (let z = start; z <= 1.0001; z += 0.01) {
        depths[i] = Math.min(1, z);
        const r = p.rodRho(depths);
        if (z > start) assert.ok(r <= prev + 1e-12, `${id} rod ${i}: worth rose from ${prev} to ${r} at z=${z.toFixed(2)}`);
        prev = r;
      }
      assert.ok(prev < 0, `${id} rod ${i}: fully inserted rod has no worth`);
    }
  }
});

test('central rods are worth more than edge rods', () => {
  for (const id of DESIGNS) {
    const p = P.create(id);
    const worth = i => { const z = new Array(P.ROD_COUNT).fill(0); z[i] = 1; return -p.rodRho(z); };
    assert.ok(worth(4) > worth(0) && worth(5) > worth(9), id);
  }
});

test('RBMK rod tips add reactivity at the start of a SCRAM (the Chernobyl flaw)', () => {
  const p = P.create('rbmk');
  const out = p.rodRho(new Array(P.ROD_COUNT).fill(0));
  const tipsIn = p.rodRho(new Array(P.ROD_COUNT).fill(0.15));
  assert.ok(tipsIn > out, `tips should add reactivity: ${tipsIn} vs ${out}`);
  for (const id of DESIGNS.filter(x => !P.DESIGNS[x].tip)) {
    const q = P.create(id);
    assert.ok(q.rodRho(new Array(P.ROD_COUNT).fill(0.15)) < q.rodRho(new Array(P.ROD_COUNT).fill(0)), id);
  }
});

test('all rods in keeps every design more than $1 subcritical, even cold, clean and voided', () => {
  for (const id of DESIGNS) {
    const p = P.create(id), d = p.d;
    p.rods.fill(1);
    for (const v of [0, 1]) {
      p.Tf = p.Tc = d.Tin; p.X = 0; p.burn = 0; p.level = 1; p.void = 0; p.voidEff = v;
      const rho = p.computeRho();
      assert.ok(rho < -d.beta, `${id} void=${v}: shutdown margin only $${(rho / d.beta).toFixed(2)}`);
    }
  }
});

test('all rods out on a cold clean core is supercritical, so startup is possible', () => {
  for (const id of DESIGNS) {
    const p = P.create(id);
    p.rods.fill(0);
    assert.ok(p.computeRho() > 0, id);
  }
});

test('a preset steady state holds with hands off', () => {
  for (const id of DESIGNS) {
    for (const frac of [0.5, 1]) {
      const p = P.create(id);
      p.preset(frac);
      // CANDU burns natural uranium fast by design; check it over a shorter window.
      run(p, id === 'candu' ? 1 : 10);
      assert.ok(Math.abs(p.n / frac - 1) < 0.1, `${id} ${frac * 100}%: drifted to ${(p.n * 100).toFixed(1)}%`);
    }
  }
});

test('pulling rods raises power and inserting them lowers it', () => {
  for (const id of DESIGNS) {
    const up = P.create(id), r = up.preset(1);
    up.setAllRods(r - 0.08); run(up, 6);
    assert.ok(up.n > 1.03, `${id}: withdrawal gave ${(up.n * 100).toFixed(0)}%`);
    const down = P.create(id); down.preset(1);
    down.setAllRods(r + 0.08); run(down, 6);
    assert.ok(down.n < 0.97, `${id}: insertion gave ${(down.n * 100).toFixed(0)}%`);
  }
});

test('moving a single rod changes power in the expected direction', () => {
  const p = P.create('pwr'), r = p.preset(1);
  p.setRod(5, Math.max(0, r - 0.25)); run(p, 6);
  assert.ok(p.n > 1.01, `single rod out: ${(p.n * 100).toFixed(1)}%`);
  const q = P.create('pwr'); q.preset(1);
  q.setRod(5, 1); run(q, 6);
  assert.ok(q.n < 0.99, `single rod in: ${(q.n * 100).toFixed(1)}%`);
});

test('rods travel at the drive speed, and SCRAM ignores later rod commands', () => {
  const p = P.create('pwr'); p.preset(1);
  const r0 = p.rods[0];
  p.setAllRods(0); run(p, 1);
  assert.ok(Math.abs((r0 - p.rods[0]) - p.d.rodSpeed) < 0.02, `moved ${r0 - p.rods[0]} in 1 s`);
  p.doScram(); p.setAllRods(0); p.setRod(3, 0);
  assert.deepEqual(p.rodTarget, new Array(P.ROD_COUNT).fill(1));
});

test('SCRAM shuts every design down from full power', () => {
  for (const id of DESIGNS) {
    const p = P.create(id); p.preset(1);
    p.doScram();
    run(p, id === 'rbmk' ? 25 : 5);
    assert.ok(p.n < 0.01, `${id}: still at ${(p.n * 100).toFixed(2)}%`);
    assert.ok(!p.melted, id);
  }
});

test('a careful startup from cold shutdown reaches full power without damage', () => {
  // Operator procedure: withdraw in small steps and wait for the rods to stop; only
  // step again while the period is long (or power is not rising yet). Approaching
  // full power, insert a step whenever power is still climbing quickly.
  for (const id of DESIGNS) {
    const p = P.create(id);
    let wait = 0, best = 0;
    run(p, 300, DT, (pp) => {
      best = Math.max(best, pp.n);
      wait -= DT;
      if (wait > 0) return;
      if (pp.n > 0.6 && pp.period > 0 && pp.period < 40) { pp.nudgeRods(0.01); wait = 1.5; }
      else if (pp.n < 0.9 && (pp.period > 20 || pp.period < 0)) { pp.nudgeRods(-0.01); wait = 1.5; }
    });
    // (CANDU then sags as xenon and burnup eat its small excess: that is why it refuels online)
    assert.ok(best > 0.85, `${id}: never got past ${(best * 100).toFixed(3)}% in 300 s`);
    assert.ok(!p.melted && p.cladSecs === 0, `${id}: damaged during a careful startup (peak ${(p.peakPower * 100).toFixed(0)}%)`);
  }
});

// Accident scenarios the levels are built on. If these change, the levels change.
test('scenario: PWR loss of coolant melts with no action', () => {
  const p = P.create('pwr'); p.preset(1);
  run(p, 200, DT, (pp, t) => { if (t >= 3) pp.leak = 0.03; });
  assert.ok(p.melted);
});

test('scenario: PWR loss of coolant is survivable with SCRAM and ECCS', () => {
  const p = P.create('pwr'); p.preset(1);
  run(p, 100, DT, (pp, t) => {
    if (t >= 3) pp.leak = 0.03;
    if (t >= 5 && !pp.scram) pp.doScram();
    if (t >= 20 && !pp.eccs && pp.eccsLeft > 0) pp.setEccs(true);
  });
  assert.ok(!p.melted && p.cladSecs === 0, `peak clad ${p.peakClad}`);
});

test('scenario: RBMK pump trip without SCRAM runs away on positive void', () => {
  const p = P.create('rbmk'); p.preset(0.5, { I: 1.3, X: 1.0 });
  run(p, 60, DT, (pp, t) => {
    if (t < 30) pp.setAllRods(pp.rodTarget[0] + (pp.n - 0.5) * 0.02);
    if (t >= 30 && !pp.pumpsTripped) pp.tripPumps();
  });
  assert.ok(p.melted);
});

test('scenario: RBMK pump trip with a prompt SCRAM survives', () => {
  const p = P.create('rbmk'); p.preset(0.5, { I: 1.3, X: 1.0 });
  run(p, 60, DT, (pp, t) => {
    if (t < 30) pp.setAllRods(pp.rodTarget[0] + (pp.n - 0.5) * 0.02);
    if (t >= 30 && !pp.pumpsTripped) pp.tripPumps();
    if (t >= 33 && !pp.scram) pp.doScram();
  });
  assert.ok(!p.melted);
});

test('scenario: SFR loss of flow without SCRAM shuts itself down (EBR-II)', () => {
  const p = P.create('sfr'); p.preset(1);
  run(p, 70, DT, (pp, t) => { if (t >= 10 && !pp.pumpsTripped) pp.tripPumps(); });
  assert.ok(!p.melted && p.cladSecs === 0, `peak clad ${p.peakClad}`);
  assert.ok(p.n < 0.2, `settled at ${(p.n * 100).toFixed(0)}%`);
});

test('the particle core follows plant power', () => {
  const p = P.create('pwr'); p.preset(1);
  run(p, 8);
  const hi = p.visRate;
  p.doScram(); run(p, 10);
  assert.ok(hi > 80, `visual fission rate at 100%: ${hi.toFixed(0)}/s`);
  assert.ok(p.visRate < hi / 5, `visual fission rate after SCRAM: ${p.visRate.toFixed(0)}/s`);
});
