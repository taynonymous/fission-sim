// Tests for the particle engine (sim.js), which drives /simulator and the game's visuals.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../sim.js');

function seeded(fuel, mod, seed) {
  const rand = F.mulberry32(seed);
  const s = F.create({ fuel, mod, rand });
  return { s, rand };
}

test('sandbox engine output is unchanged (golden snapshot)', () => {
  // Seeded runs of /simulator's engine. Game-only hooks must not change these.
  // If you change the sandbox physics on purpose, update the numbers.
  const golden = { 'leu/h2o': [947, 2301, 1657, 613, 0], 'natu/d2o': [36, 91, 133, 19, 0], 'pu/none': [2601, 7434, 3664, 3720, 0] };
  for (const key of Object.keys(golden)) {
    const [fuel, mod] = key.split('/');
    const { s, rand } = seeded(fuel, mod, 42);
    s.rods = 0.3;
    for (let i = 0; i < 50; i++) s.inject(rand() * F.W, rand() * F.H, 1);
    for (let i = 0; i < 180; i++) s.step(1 / 60);
    assert.deepEqual([s.fissions, s.totB, s.totL, s.n, s.bred], golden[key], key);
  }
});

// k-effective from births/losses over several seeds
function measureK(setup, seeds) {
  let B = 0, L = 0;
  for (let sd = 1; sd <= (seeds || 12); sd++) {
    const { s, rand } = seeded('leu', 'h2o', sd * 31);
    s.source = false;
    setup(s);
    for (let i = 0; i < 40; i++) s.inject(rand() * F.W, rand() * F.H, 1);
    for (let i = 0; i < 20; i++) s.step(1 / 60);
    const b0 = s.totB, l0 = s.totL;
    for (let i = 0; i < 120; i++) { s.step(1 / 60); if (s.n > 800) break; }
    B += s.totB - b0; L += s.totL - l0;
  }
  return B / L;
}

test('inserting the rod bank lowers k-effective', () => {
  const out = measureK(s => { s.rods = 0; });
  const half = measureK(s => { s.rods = 0.6; });
  const full = measureK(s => { s.rods = 1; });
  assert.ok(out > half && half > full, `k: out ${out.toFixed(2)}, 60% ${half.toFixed(2)}, in ${full.toFixed(2)}`);
  assert.ok(full < 1, `fully inserted rods leave LEU/H2O supercritical (k=${full.toFixed(2)})`);
});

test('per-rod depths absorb only where each rod is', () => {
  const none = measureK(s => { s.rodDepths = new Array(10).fill(0); });
  const five = measureK(s => { s.rodDepths = [1, 0, 1, 0, 1, 0, 1, 0, 1, 0]; });
  const all = measureK(s => { s.rodDepths = new Array(10).fill(1); });
  assert.ok(none > five && five > all, `k: none ${none.toFixed(2)}, five ${five.toFixed(2)}, all ${all.toFixed(2)}`);
});

test('neutrons inside a fully inserted rod are absorbed', () => {
  const { s } = seeded('leu', 'h2o', 7);
  s.source = false; s.rodDepths = new Array(10).fill(1);
  const x = s.rodXs[4];
  for (let i = 0; i < 200; i++) s.inject(x, F.H / 2, 1);
  for (let i = 0; i < 6; i++) s.step(1 / 60);   // 0.1 s: too short to leave a 24 px rod at thermal speed... most die
  assert.ok(s.totL > 150, `only ${s.totL} of 200 neutrons absorbed`);
});

test('moderator choice changes k the way reactor physics says it should', () => {
  // Natural uranium needs heavy water; LEU needs a moderator at all.
  const k = (fuel, mod) => {
    let B = 0, L = 0;
    for (let sd = 1; sd <= 10; sd++) {
      const { s, rand } = seeded(fuel, mod, sd * 17);
      s.source = false;
      for (let i = 0; i < 60; i++) s.inject(rand() * F.W, rand() * F.H, 1);
      for (let i = 0; i < 20; i++) s.step(1 / 60);
      const b0 = s.totB, l0 = s.totL;
      for (let i = 0; i < 120; i++) { s.step(1 / 60); if (s.n > 800) break; }
      B += s.totB - b0; L += s.totL - l0;
    }
    return B / L;
  };
  assert.ok(k('natu', 'd2o') > k('natu', 'h2o'), 'natural U should do better in heavy water');
  assert.ok(k('leu', 'h2o') > k('leu', 'none'), 'LEU should need a moderator');
  assert.ok(k('heu', 'none') > 1, 'HEU should go critical on fast neutrons');
});

test('cull trims the population without counting losses', () => {
  const { s } = seeded('leu', 'h2o', 3);
  for (let i = 0; i < 500; i++) s.inject(100, 100, 1);
  const l0 = s.totL;
  s.cull(120);
  assert.equal(s.n, 120);
  assert.equal(s.totL, l0);
});

test('refuelPartial restores fissile inventory', () => {
  const { s } = seeded('leu', 'h2o', 5);
  s.rods = 0;
  for (let i = 0; i < 300; i++) s.inject(F.W / 2, F.H / 2, 1);
  for (let i = 0; i < 600; i++) s.step(1 / 60);
  const before = s.stats().fissileFrac;
  s.refuelPartial(0.3);
  assert.ok(s.stats().fissileFrac > before, `${before} → ${s.stats().fissileFrac}`);
});
