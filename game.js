(function () {
  'use strict';
  const F = window.FissionSim, PL = window.Plant, T = F.T;
  const $ = id => document.getElementById(id);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const fmtClock = s => { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

  // ---------------------------------------------------------------- storage
  const store = {
    get(k, d) { try { const v = localStorage.getItem('crl.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('crl.' + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
  };

  // ---------------------------------------------------------------- levels
  const LEVELS = [
    {
      id: 'startup', design: 'pwr', title: 'First Criticality',
      short: 'Start a cold reactor and bring it up to full power.',
      goal: 'Reach 100% and hold 90–110% for 15 s', timeLimit: 180,
      type: 'hold', band: [0.9, 1.1], holdSecs: 15,
      setup() { /* cold shutdown is the default state */ },
      tips: [
        'Pull rods out a little at a time. At first nothing seems to happen: power has to climb through seven decades before it shows on the gauge.',
        'Watch the period. Longer than 10 s is calm. Under 3 s means power is running away.',
        'Hot fuel absorbs more neutrons (Doppler feedback), so power settles back as the core warms. Expect to pull rods a bit more near the end.',
      ],
      stars: [['Hold for 15 s', (g) => g.won], ['Never above 130%', (g, p) => g.won && p.peakPower < 1.3], ['Finish in under 1:40', (g) => g.won && g.t < 100]],
    },
    {
      id: 'grid', design: 'pwr', title: 'Follow the Grid',
      short: 'Track the dispatcher’s demand as it drops and climbs back.',
      goal: 'Stay within ±8% of demand', timeLimit: 120,
      type: 'track', tol: 0.08,
      demand(t) {
        const pts = [[0, 1], [15, 1], [30, 0.6], [55, 0.6], [75, 1], [95, 1], [105, 0.8], [120, 0.8]];
        for (let i = 1; i < pts.length; i++) if (t <= pts[i][0]) {
          const [t0, v0] = pts[i - 1], [t1, v1] = pts[i];
          return v0 + (v1 - v0) * (t - t0) / (t1 - t0);
        }
        return pts[pts.length - 1][1];
      },
      setup(p) { p.preset(1); },
      tips: [
        'Push rods in to follow demand down, pull them out to follow it back up.',
        'Xenon-135 builds up after you cut power and fights you when you raise it again. You will need to pull rods further than before.',
        'Rods act at once, but temperature feedback lags a few seconds. Lead the target a little.',
      ],
      stars: [['On target 50% of the time', (g) => g.won], ['On target 70%', (g) => g.score >= 0.7], ['On target 85%', (g) => g.score >= 0.85]],
    },
    {
      id: 'loca', design: 'pwr', title: 'Loss of Coolant',
      short: 'A pipe breaks at full power. Keep the core covered.',
      goal: 'Keep the core intact until the clock runs out', timeLimit: 100,
      type: 'survive',
      setup(p) { p.preset(1); },
      events: [{ t: 10, run(p, g) { p.leak = 0.03; g.breakAt = g.t; toast('Pipe break! Coolant is leaking', 'crit'); sound.alarm(); } }],
      tips: [
        'SCRAM stops the chain reaction, but decay heat does not stop: it starts near 7% of full power.',
        'ECCS injects cold borated water and refills the vessel. The tank lasts 75 s, so do not waste it.',
        'If the water drops below the fuel, the cladding heats fast. Above about 1,200 °C zirconium burns in steam and adds its own heat.',
      ],
      stars: [['Core intact', (g) => g.won], ['Cladding never past its limit', (g, p) => g.won && p.cladSecs === 0], ['SCRAM within 5 s of the break', (g, p) => g.won && g.scramAt != null && g.breakAt != null && g.scramAt - g.breakAt <= 5]],
    },
    {
      id: 'candu', design: 'candu', title: 'Online Refuelling',
      short: 'Natural uranium burns out fast. Refuel without shutting down.',
      goal: 'Keep power at 85–115% for 60 s in total', timeLimit: 110,
      type: 'hold', band: [0.85, 1.15], holdSecs: 60, accumulate: true,
      setup(p) { p.preset(1); },
      tips: [
        'Natural uranium has little spare reactivity. As fuel burns, power sags within seconds.',
        'Tap Refuel to push fresh bundles into the most-burned channels. Each push adds reactivity, so be ready on the rods.',
        'The fuelling machine needs about 4 s between pushes.',
      ],
      stars: [['60 s in the band', (g) => g.won], ['Never above 120%', (g, p) => g.won && p.peakPower < 1.2], ['Finish by 1:20', (g) => g.won && g.t <= 80]],
    },
    {
      id: 'rbmk', design: 'rbmk', title: 'The Night Test',
      short: 'An RBMK at half power. The shift wants to run a pump test.',
      goal: 'Keep power above 30% until the pump test at 0:30, then keep the core intact', timeLimit: 80,
      type: 'survive', minPower: { until: 30, p: 0.3, grace: 5 },
      setup(p) { p.preset(0.5, { I: 1.3, X: 1.0 }); },
      events: [{ t: 30, run(p) { if (!p.scram) { p.tripPumps(); toast('Test started: pumps coasting down', 'crit'); sound.alarm(); } else toast('Test cancelled. The reactor is shut down.', 'info'); } }],
      tips: [
        'The grid needs this unit online for the test, so power must stay above 30%. Xenon from an earlier power cut is building against you.',
        'Holding power means pulling rods, which leaves fewer rods ready to stop the reactor. You can also refuse the test by pressing SCRAM.',
        'In an RBMK, steam removes an absorber, so boiling adds power. Lose the pumps and power can run away within seconds.',
        'Its SCRAM is slow, and the graphite rod tips briefly add power as they first go in.',
      ],
      stars: [['Core intact', (g) => g.won], ['Power never above 150%', (g, p) => g.won && p.peakPower < 1.5], ['Refuse the test: SCRAM before 0:30', (g) => g.won && g.scramAt != null && g.scramAt < 30]],
    },
    {
      id: 'sfr', design: 'sfr', title: 'Walk-Away Safe',
      short: 'A fast reactor loses its pumps. Does it need you?',
      goal: 'Keep the cladding under 900 °C until the clock runs out', timeLimit: 70,
      type: 'survive', maxCladSecs: 2,
      setup(p) { p.preset(1); },
      events: [{ t: 10, run(p) { p.tripPumps(); toast('Loss of flow: pumps tripped', 'crit'); sound.alarm(); } }],
      tips: [
        'There is no moderator here, so the core reacts fast. Move rods in small steps.',
        'As sodium and fuel heat up, the core expands and more neutrons leak out. That is strong negative feedback.',
        'In 1986, EBR-II shut off its pumps on purpose without a SCRAM and shut itself down.',
      ],
      stars: [['Cladding kept under its limit', (g) => g.won], ['Peak cladding under 880 °C', (g, p) => g.won && p.peakClad < 880], ['Trust the physics: no SCRAM', (g) => g.won && g.scramAt == null]],
    },
  ];
  const FREE = { id: 'free', title: 'Free Play', type: 'free', goal: 'No objective. Make power, and don’t melt it.', setup(p) { p.preset(1); } };

  // ---------------------------------------------------------------- state
  let level = null, plant = null, g = null, paused = true, lastFrame = performance.now();
  let selectedRod = -1, dragging = null, hintShown = !store.get('hintDone', false);
  const progress = store.get('progress', {});

  function startLevel(lv, designId) {
    level = lv;
    const design = lv.design || designId;
    plant = PL.create(design);
    g = { t: 0, hold: 0, inBand: 0, scored: 0, score: 0, won: false, over: false, scramAt: null, breakAt: null, fired: new Set(), samples: [], refuelReady: 0, result: null, design };
    lv.setup(plant);
    flashes.length = 0; bubbles.length = 0; slump = 0;
    lastAnn = {};
    $('mTitle').textContent = lv.title;
    $('mDesign').textContent = PL.DESIGNS[design].name;
    $('faultRow').hidden = lv.type !== 'free';
    $('hint').style.opacity = hintShown && lv.type !== 'free' ? '1' : '0';
    updateHUD(true);
  }

  // ---------------------------------------------------------------- audio
  const sound = (() => {
    let ctx = null, noise = null, on = store.get('sound', true);
    function ensure() {
      if (!on) return null;
      if (!ctx) {
        try {
          ctx = new (window.AudioContext || window.webkitAudioContext)();
          const len = Math.floor(ctx.sampleRate * 0.004);
          noise = ctx.createBuffer(1, len, ctx.sampleRate);
          const d = noise.getChannelData(0);
          for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
        } catch (e) { ctx = null; }
      }
      if (ctx && ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    function click(when) {
      const c = ensure(); if (!c) return;
      const src = c.createBufferSource(); src.buffer = noise;
      const gn = c.createGain(); gn.gain.value = 0.35;
      src.connect(gn).connect(c.destination); src.start(when || c.currentTime);
    }
    function tone(freq, dur, type, vol, delay) {
      const c = ensure(); if (!c) return;
      const o = c.createOscillator(), gn = c.createGain();
      o.type = type || 'square'; o.frequency.value = freq;
      const t0 = c.currentTime + (delay || 0);
      gn.gain.setValueAtTime(0, t0); gn.gain.linearRampToValueAtTime(vol || 0.06, t0 + 0.01);
      gn.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(gn).connect(c.destination); o.start(t0); o.stop(t0 + dur + 0.02);
    }
    return {
      get on() { return on; },
      toggle() { on = !on; store.set('sound', on); if (on) ensure(); else if (ctx) ctx.suspend(); return on; },
      unlock() { ensure(); },
      geiger(rate, dt) {
        if (!on || !ctx || paused) return;
        const k = rate * dt; let n = Math.floor(k) + (Math.random() < k % 1 ? 1 : 0);
        n = Math.min(n, 6);
        for (let i = 0; i < n; i++) click(ctx.currentTime + Math.random() * dt);
      },
      alarm() { tone(880, 0.14, 'square', 0.05); tone(660, 0.18, 'square', 0.05, 0.16); },
      scram() { tone(90, 0.5, 'sawtooth', 0.12); tone(60, 0.6, 'sine', 0.15, 0.05); },
      win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, 'triangle', 0.07, i * 0.11)); },
      melt() { tone(55, 2.2, 'sawtooth', 0.14); tone(41, 2.6, 'sine', 0.2, 0.1); },
      blip() { tone(1200, 0.05, 'sine', 0.04); },
    };
  })();

  // ---------------------------------------------------------------- toast
  let toastTimer = 0;
  function toast(msg, kind) {
    const el = $('toast');
    el.textContent = msg; el.className = 'toast' + (kind === 'info' ? ' info' : ''); el.hidden = false;
    $('hint').style.visibility = 'hidden';
    toastTimer = 3.5;
  }

  // ---------------------------------------------------------------- core canvas
  const wrap = $('coreWrap'), canvas = $('core'), ctx = canvas.getContext('2d');
  let view = { s: 1, ox: 0, oy: 0, dpr: 1, w: 0, h: 0 };
  function resize() {
    const r = wrap.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
    // leave room for the lever on the right
    const padR = 46, pad = 6;
    const s = Math.min((r.width - padR - pad) / F.W, (r.height - pad * 2) / F.H);
    view = { s, ox: pad + (r.width - padR - pad - F.W * s) / 2, oy: (r.height - F.H * s) / 2, dpr, w: r.width, h: r.height };
    drawTrend();
  }
  new ResizeObserver(resize).observe(wrap);

  const NODE_COLOR = {
    [T.U235]: '#ffb238', [T.PU239]: '#ff5c8a', [T.U233]: '#ffe066', [T.U238]: '#5f7896', [T.TH232]: '#8f946c',
    [T.FP]: '#39414e', [T.XE135]: '#8a68d8', [T.SPENT]: '#2b323d', [T.BREED_PU]: '#b9789a', [T.BREED_U3]: '#c2b25e',
  };
  const FISSILE = new Set([T.U235, T.PU239, T.U233]);
  const flashes = [], bubbles = [];
  let slump = 0, shake = 0;

  function heatColor(f) {
    // 0 → none, 0.5 → orange, 1 → white-hot
    f = clamp(f, 0, 1);
    const r = 255, gch = Math.round(80 + 175 * Math.max(0, f - 0.5) * 2), b = Math.round(40 + 215 * Math.max(0, f - 0.8) * 5);
    return `rgb(${r},${Math.min(255, gch)},${Math.min(255, b)})`;
  }

  function drawCore(now, dt) {
    const p = plant, sim = p.sim, d = p.d, W = F.W, H = F.H;
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.fillStyle = '#02080f';
    ctx.fillRect(0, 0, view.w, view.h);
    let sx = 0, sy = 0;
    if (shake > 0 && !reduceMotion) { sx = (Math.random() - 0.5) * shake * 10; sy = (Math.random() - 0.5) * shake * 10; }
    ctx.setTransform(view.dpr * view.s, 0, 0, view.dpr * view.s, view.dpr * (view.ox + sx), view.dpr * (view.oy + sy));
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();

    // Water with Cherenkov glow; steam above the water line when the level drops
    const pw = Math.max(p.n, 1e-9);
    const glow = clamp((Math.log10(pw) + 3) / 3.3, 0, 1);
    const water = p.level * (1 - p.void);
    const g0 = ctx.createRadialGradient(W / 2, H / 2, 10, W / 2, H / 2, W * 0.7);
    if (d.id === 'sfr') {
      g0.addColorStop(0, `rgb(${40 + 60 * glow | 0},${30 + 30 * glow | 0},${20 + 20 * glow | 0})`); g0.addColorStop(1, '#0a0705');
    } else {
      g0.addColorStop(0, `rgb(${10 + 50 * glow | 0},${40 + 110 * glow | 0},${90 + 150 * glow | 0})`); g0.addColorStop(1, '#020b18');
    }
    ctx.fillStyle = g0; ctx.fillRect(0, 0, W, H);
    if (p.level < 0.999) {
      const yl = H * (1 - p.level);
      const sg = ctx.createLinearGradient(0, 0, 0, yl);
      sg.addColorStop(0, '#1d1a19'); sg.addColorStop(1, '#2b2826');
      ctx.fillStyle = sg; ctx.fillRect(0, 0, W, yl);
      ctx.strokeStyle = 'rgba(160, 210, 255, 0.7)'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 12) ctx.lineTo(x, yl + Math.sin(now / 300 + x / 30) * 2);
      ctx.stroke();
    }
    if (p.void > 0.01 && water > 0.02) {
      ctx.fillStyle = `rgba(220, 235, 255, ${0.25 * p.void})`; ctx.fillRect(0, H * (1 - p.level), W, H * p.level);
    }

    // Nuclei
    const { nx, ny, type, atoms, N } = sim;
    const heat = clamp((p.Tcl - 900) / (d.meltT - 900), 0, 1);
    const sl = slump;
    const byType = {};
    for (let k = 0; k < N; k++) (byType[type[k]] || (byType[type[k]] = [])).push(k);
    for (let pass = 0; pass < 2; pass++) {
      for (const t in byType) {
        const tt = +t, list = byType[t], fis = FISSILE.has(tt);
        if (pass === 1 && !fis && tt !== T.U238 && tt !== T.TH232) continue;
        ctx.fillStyle = pass === 0 ? NODE_COLOR[tt] : heatColor(heat);
        if (pass === 1) { if (heat < 0.02) break; ctx.globalAlpha = heat * 0.8; }
        ctx.beginPath();
        for (const k of list) {
          const r = fis ? 1.6 + 2.2 * (atoms[k] / F.ATOMS) : (tt === T.FP || tt === T.SPENT ? 1.5 : 2.4);
          let x = nx[k], y = ny[k];
          if (sl > 0) { y += sl * (H - y) * (0.6 + 0.4 * Math.sin(k * 12.9898)); x += sl * 8 * Math.sin(k); }
          ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, Math.PI * 2);
        }
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      if (pass === 0 && heat < 0.02) break;
    }

    // Steam bubbles
    if (!reduceMotion && p.void > 0.02 && water > 0.02) {
      const rate = p.void * 120 * dt;
      for (let i = 0; i < rate; i++) if (Math.random() < rate - i) bubbles.push({ x: Math.random() * W, y: H, v: 40 + Math.random() * 60, r: 1.5 + Math.random() * 3 });
    }
    if (bubbles.length > 300) bubbles.splice(0, bubbles.length - 300);
    ctx.strokeStyle = 'rgba(230, 240, 255, 0.6)'; ctx.lineWidth = 1;
    ctx.beginPath();
    const top = H * (1 - p.level);
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i];
      b.y -= b.v * dt; b.x += Math.sin(b.y / 20) * 0.3;
      if (b.y < top) { bubbles.splice(i, 1); continue; }
      ctx.moveTo(b.x + b.r, b.y); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    }
    ctx.stroke();

    // ECCS injection
    if (p.eccs && !reduceMotion) {
      ctx.strokeStyle = 'rgba(120, 200, 255, 0.55)'; ctx.lineWidth = 3;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const yy = H - 20 - ((now / 4 + i * 37) % 120);
        ctx.moveTo(0, yy); ctx.lineTo(28, yy + 6);
        ctx.moveTo(W, yy); ctx.lineTo(W - 28, yy + 6);
      }
      ctx.stroke();
    }

    // Fission flashes
    const evs = sim.events;
    const maxNew = reduceMotion ? 6 : 30;
    for (let i = Math.max(0, evs.length - maxNew); i < evs.length; i++) flashes.push({ x: evs[i].x, y: evs[i].y, t: now, c: NODE_COLOR[evs[i].isoType] });
    evs.length = 0;
    if (flashes.length > 160) flashes.splice(0, flashes.length - 160);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = flashes.length - 1; i >= 0; i--) {
      const f = flashes[i], age = (now - f.t) / 420;
      if (age >= 1) { flashes.splice(i, 1); continue; }
      const rad = 3 + age * 14;
      ctx.globalAlpha = 1 - age;
      const rg = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, rad);
      rg.addColorStop(0, '#ffffff'); rg.addColorStop(0.35, f.c); rg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(f.x, f.y, rad, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Neutrons
    const { px, py, vx, vy, th, n } = sim;
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < n; i++) if (!th[i]) { ctx.moveTo(px[i], py[i]); ctx.lineTo(px[i] - vx[i] * 0.03, py[i] - vy[i] * 0.03); }
    ctx.stroke();
    ctx.fillStyle = '#ffffff'; ctx.beginPath();
    for (let i = 0; i < n; i++) if (!th[i]) { ctx.moveTo(px[i] + 1.4, py[i]); ctx.arc(px[i], py[i], 1.4, 0, Math.PI * 2); }
    ctx.fill();
    ctx.fillStyle = '#4fb8ff'; ctx.beginPath();
    for (let i = 0; i < n; i++) if (th[i]) { ctx.moveTo(px[i] + 1.7, py[i]); ctx.arc(px[i], py[i], 1.7, 0, Math.PI * 2); }
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    // Control rods
    const rw = F.ROD_W;
    for (let i = 0; i < PL.ROD_COUNT; i++) {
      const x = sim.rodXs[i], depth = p.rods[i] * H, sel = i === selectedRod;
      if (depth > 0.5) {
        const rg = ctx.createLinearGradient(x - rw / 2, 0, x + rw / 2, 0);
        rg.addColorStop(0, '#1b2129'); rg.addColorStop(0.5, sel ? '#4a5868' : '#333d49'); rg.addColorStop(1, '#161b22');
        ctx.fillStyle = rg; ctx.fillRect(x - rw / 2, 0, rw, depth);
        if (d.tip) { ctx.fillStyle = '#3d3a33'; ctx.fillRect(x - rw / 2, depth, rw, Math.min(H * 0.12, H - depth)); }
        ctx.fillStyle = sel ? '#ffd27a' : '#9aa9b8';
        ctx.fillRect(x - rw / 2, depth - 4, rw, 4);
      } else {
        ctx.fillStyle = sel ? '#ffd27a' : '#9aa9b8';
        ctx.fillRect(x - rw / 2, 0, rw, 3);
      }
      const tgt = p.rodTarget[i] * H;
      if (Math.abs(tgt - depth) > 2) {
        ctx.strokeStyle = '#ffb238'; ctx.lineWidth = 2; ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.moveTo(x - rw / 2 - 4, tgt); ctx.lineTo(x + rw / 2 + 4, tgt); ctx.stroke();
        ctx.setLineDash([]);
      }
      if (sel) { ctx.strokeStyle = 'rgba(255, 210, 122, 0.8)'; ctx.lineWidth = 1.5; ctx.strokeRect(x - rw / 2 - 2, -2, rw + 4, Math.max(depth, 6) + 4); }
    }

    // Meltdown glow
    if (p.melted) {
      ctx.globalCompositeOperation = 'lighter';
      const mg = ctx.createRadialGradient(W / 2, H * 0.8, 10, W / 2, H * 0.8, W * 0.6);
      mg.addColorStop(0, `rgba(255, 120, 30, ${0.55 * Math.min(1, slump * 2)})`); mg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = mg; ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
    ctx.strokeStyle = '#163049'; ctx.lineWidth = 2 / view.s;
    ctx.strokeRect(0, 0, W, H);
  }

  // ---------------------------------------------------------------- rods input
  function toWorld(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left - view.ox) / view.s, y: (e.clientY - r.top - view.oy) / view.s };
  }
  function nearestRod(x) {
    let best = 0, bd = Infinity;
    plant.sim.rodXs.forEach((rx, i) => { const dd = Math.abs(rx - x); if (dd < bd) { bd = dd; best = i; } });
    return best;
  }
  function dismissHint() { if (hintShown) { hintShown = false; store.set('hintDone', true); $('hint').style.opacity = '0'; } }
  canvas.addEventListener('pointerdown', e => {
    if (!plant || paused) return;
    sound.unlock();
    const w = toWorld(e);
    selectedRod = nearestRod(w.x);
    dragging = { id: e.pointerId, rod: selectedRod };
    canvas.setPointerCapture(e.pointerId);
    rodFromPointer(w);
    dismissHint();
  });
  canvas.addEventListener('pointermove', e => {
    if (!plant) return;
    const w = toWorld(e);
    if (dragging && dragging.id === e.pointerId) rodFromPointer(w);
    else if (e.pointerType === 'mouse') selectedRod = (w.x >= 0 && w.x <= F.W && w.y >= 0 && w.y <= F.H) ? nearestRod(w.x) : -1;
  });
  const endDrag = e => { if (dragging && dragging.id === e.pointerId) { dragging = null; if (e.pointerType !== 'mouse') selectedRod = -1; } };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave', e => { if (!dragging && e.pointerType === 'mouse') selectedRod = -1; });
  function rodFromPointer(w) {
    if (plant.scram) { scramNag(); return; }
    plant.setRod(dragging.rod, clamp(w.y / F.H, 0, 1));
  }
  let nagAt = 0;
  function scramNag() { if (performance.now() - nagAt > 2500) { nagAt = performance.now(); toast('Rods are latched in after a SCRAM. Press Reset first.', 'info'); } }
  canvas.addEventListener('wheel', e => {
    if (!plant || paused) return;
    e.preventDefault();
    if (plant.scram) return scramNag();
    plant.nudgeRods(Math.sign(e.deltaY) * 0.02);
    dismissHint();
  }, { passive: false });

  // Lever: all rods together
  const lever = $('lever'), track = $('leverTrack');
  let leverDrag = null;
  function leverSet(e) {
    const r = track.getBoundingClientRect();
    const v = clamp((e.clientY - r.top) / r.height, 0, 1);
    if (plant.scram) return scramNag();
    plant.setAllRods(v);
  }
  lever.addEventListener('pointerdown', e => {
    if (!plant || paused) return;
    sound.unlock(); leverDrag = e.pointerId; lever.setPointerCapture(e.pointerId); leverSet(e); dismissHint();
  });
  lever.addEventListener('pointermove', e => { if (leverDrag === e.pointerId) leverSet(e); });
  lever.addEventListener('pointerup', e => { if (leverDrag === e.pointerId) leverDrag = null; });
  lever.addEventListener('pointercancel', () => { leverDrag = null; });
  lever.addEventListener('keydown', e => {
    if (!plant) return;
    if (e.key === 'ArrowUp') { plant.nudgeRods(-0.02); e.preventDefault(); }
    if (e.key === 'ArrowDown') { plant.nudgeRods(0.02); e.preventDefault(); }
  });

  window.addEventListener('keydown', e => {
    if (!plant) return;
    const k = e.key.toLowerCase();
    if (k === 'p' || e.key === 'Escape') { togglePause(); return; }
    if (!overlay.hidden) return;
    if (k === 'x') doScram();
    else if (paused) return;
    else if (e.key === 'ArrowUp' && e.target !== lever) { if (plant.scram) scramNag(); else plant.nudgeRods(-0.02); e.preventDefault(); }
    else if (e.key === 'ArrowDown' && e.target !== lever) { if (!plant.scram) plant.nudgeRods(0.02); e.preventDefault(); }
  });

  // ---------------------------------------------------------------- buttons
  function doScram() {
    if (!plant || paused || g.over) return;
    sound.unlock();
    if (!plant.scram) {
      plant.doScram(); if (g.scramAt == null) g.scramAt = g.t;
      sound.scram(); toast('SCRAM: all rods dropping', 'crit');
    } else {
      plant.resetScram(); toast('SCRAM reset. Rods unlatched.', 'info'); sound.blip();
    }
  }
  $('scramBtn').addEventListener('click', doScram);
  $('pumpBtn').addEventListener('click', () => {
    if (!plant || paused) return; sound.unlock();
    if (plant.pumpsTripped) { toast('Pumps tripped and locked out', 'crit'); return; }
    plant.setPumps(!plant.pumps); sound.blip();
  });
  $('eccsBtn').addEventListener('click', () => {
    if (!plant || paused) return; sound.unlock();
    if (plant.eccsLeft <= 0) { toast('ECCS tank is empty', 'crit'); return; }
    plant.setEccs(!plant.eccs); sound.blip();
    if (plant.eccs) toast('ECCS injecting borated water', 'info');
  });
  $('refuelBtn').addEventListener('click', () => {
    if (!plant || paused) return; sound.unlock();
    if (g.refuelReady > 0) return;
    if (plant.refuel()) { g.refuelReady = 4; sound.blip(); toast('Fresh fuel loaded', 'info'); }
    else toast(`${plant.d.name} can only refuel when shut down`, 'info');
  });
  $('faultPumps').addEventListener('click', () => { if (plant && !paused) { plant.tripPumps(); toast('Pumps tripped', 'crit'); sound.alarm(); } });
  $('faultLeak').addEventListener('click', () => { if (plant && !paused) { plant.leak = 0.03; toast('Pipe break! Coolant is leaking', 'crit'); sound.alarm(); } });
  $('soundBtn').addEventListener('click', () => {
    const on = sound.toggle();
    $('soundBtn').setAttribute('aria-pressed', on); $('soundWaves').style.display = on ? '' : 'none';
  });
  if (!sound.on) { $('soundBtn').setAttribute('aria-pressed', 'false'); $('soundWaves').style.display = 'none'; }
  $('pauseBtn').addEventListener('click', togglePause);
  $('menuBtn').addEventListener('click', () => { if (plant && !g.over) paused = true; showLevels(); });

  // ---------------------------------------------------------------- instruments
  const trend = $('trend'), tctx = trend.getContext('2d');
  // Power axis: log below 1% (source and intermediate range), linear above.
  const axY = v => v >= 0.01 ? 0.3 + 0.7 * Math.min(1, (v - 0.01) / 1.49) : 0.3 * clamp((Math.log10(Math.max(v, 1e-8)) + 8) / 6, 0, 1);
  function drawTrend() {
    const r = trend.getBoundingClientRect();
    const w = Math.round(r.width), h = Math.round(r.height);
    if (!w || !h || !g) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (trend.width !== w * dpr || trend.height !== h * dpr) { trend.width = w * dpr; trend.height = h * dpr; }
    tctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    tctx.clearRect(0, 0, w, h);
    const padL = 30, padR = 2, padT = 4, padB = 4, pw = w - padL - padR, ph = h - padT - padB;
    const Y = v => padT + ph * (1 - axY(v));
    tctx.font = '10px "IBM Plex Mono", monospace'; tctx.textBaseline = 'middle'; tctx.textAlign = 'right';
    [[1e-6, '10⁻⁴'], [0.01, '1%'], [0.5, '50'], [1, '100'], [1.5, '150']].forEach(([v, l]) => {
      if (h < 50 && (v === 0.5 || v === 1e-6)) return;
      const y = Math.round(Y(v)) + 0.5;
      tctx.strokeStyle = v === 1 ? '#3b5563' : '#1f2f37'; tctx.lineWidth = 1;
      tctx.beginPath(); tctx.moveTo(padL, y); tctx.lineTo(w - padR, y); tctx.stroke();
      tctx.fillStyle = '#6f8790'; tctx.fillText(l, padL - 4, y);
    });
    const N = 120, xs = i => padL + pw * i / (N - 1);
    const s = g.samples, off = N - s.length;
    // target band
    if (level && (level.type === 'hold' || level.type === 'track')) {
      tctx.fillStyle = 'rgba(79, 209, 139, 0.16)'; tctx.strokeStyle = 'rgba(79, 209, 139, 0.6)';
      if (level.type === 'hold') {
        const y1 = Y(level.band[1]), y0 = Y(level.band[0]);
        tctx.fillRect(padL, y1, pw, y0 - y1);
      } else {
        // demand looks ahead 15 s to the right edge
        tctx.beginPath();
        for (let i = 0; i < N; i++) { const t = g.t - (N - 1 - i) * 0.5 + 15; const dv = level.demand(Math.max(0, t)); const y = Y(dv + level.tol); i ? tctx.lineTo(xs(i), y) : tctx.moveTo(xs(i), y); }
        for (let i = N - 1; i >= 0; i--) { const t = g.t - (N - 1 - i) * 0.5 + 15; const dv = level.demand(Math.max(0, t)); tctx.lineTo(xs(i), Y(dv - level.tol)); }
        tctx.closePath(); tctx.fill();
        const nowX = padL + pw * (1 - 15 / 60);
        tctx.strokeStyle = '#3b5563'; tctx.setLineDash([3, 3]); tctx.beginPath(); tctx.moveTo(nowX, padT); tctx.lineTo(nowX, h - padB); tctx.stroke(); tctx.setLineDash([]);
      }
    }
    if (s.length > 1) {
      const shift = level && level.type === 'track' ? 30 : 0;
      tctx.beginPath();
      s.forEach((v, i) => { const x = xs(i + off - shift); const y = Y(v); i ? tctx.lineTo(x, y) : tctx.moveTo(x, y); });
      tctx.strokeStyle = '#ffffff'; tctx.lineWidth = 1.8; tctx.lineJoin = 'round'; tctx.stroke();
      const lv = s[s.length - 1];
      tctx.fillStyle = lv > 1.1 ? '#ff5a43' : '#5fb4ff';
      tctx.beginPath(); tctx.arc(xs(N - 1 - shift), Y(lv), 3.5, 0, Math.PI * 2); tctx.fill();
    }
  }

  function setBar(id, frac, color, markFrac) {
    const el = $(id);
    const i = el.firstElementChild, b = el.querySelector('b');
    i.style.width = (clamp(frac, 0, 1) * 100).toFixed(1) + '%';
    if (color) i.style.background = color;
    if (b && markFrac != null) b.style.left = (clamp(markFrac, 0, 1) * 100).toFixed(1) + '%';
  }
  const sev = f => f < 0.6 ? '#5fb4ff' : f < 0.85 ? '#ffc44d' : '#ff5a43';
  // Tiny powers read as "2.1×10⁻⁵" rather than "2.1e-5", which looks like a negative number.
  function fmtPower(n) {
    const pct = n * 100;
    if (pct >= 10) return pct.toFixed(0);
    if (pct >= 0.1) return pct.toFixed(1);
    const e = Math.floor(Math.log10(Math.max(pct, 1e-12))), m = pct / Math.pow(10, e);
    return `${m.toFixed(1)}×10<sup>−${Math.abs(e)}</sup>`;
  }
  // Nuclear instrumentation ranges, as on a real control panel
  const powerRange = n => n < 1e-5 ? 'Source range · shut down' : n < 0.01 ? 'Intermediate range' : 'Power range';

  const ANN = [
    ['prompt', 'Prompt crit', p => p.rho >= p.d.beta, 'crit'],
    ['period', 'Short period', p => p.period > 0 && p.period < 3 && p.n > 1e-6, 'crit'],
    ['high', 'High power', p => p.n > 1.12, 'crit'],
    ['fuel', 'Fuel temp', p => p.Tcl > 0.85 * p.d.meltT, 'crit'],
    ['clad', 'Clad temp', p => p.Tclad > 0.92 * p.d.cladT, 'crit'],
    ['boil', 'Boiling', p => p.void > 0.02, 'warn'],
    ['level', 'Low water', p => p.level < 0.85, 'crit'],
    ['pumps', 'Pumps off', p => !p.pumps, 'warn'],
  ];
  const annEl = $('annun');
  annEl.innerHTML = ANN.map(a => `<div class="ann" id="ann-${a[0]}">${a[1]}</div>`).join('');
  let lastAnn = {};

  function updateHUD(force) {
    const p = plant, d = p.d;
    $('powerVal').innerHTML = `${fmtPower(p.n)}<small>%</small>`;
    $('powerVal').style.color = p.n > 1.12 ? 'var(--crit)' : '';
    const per = p.period;
    const perEl = $('periodVal');
    perEl.textContent = !isFinite(per) || Math.abs(per) > 999 || p.n < 2e-7 ? '∞' : (per > 0 ? '+' : '−') + Math.abs(per).toFixed(Math.abs(per) < 10 ? 1 : 0) + ' s';
    perEl.className = per > 0 && per < 3 && p.n > 1e-6 ? 'hot' : '';
    const dol = p.rho / d.beta;
    const rhoEl = $('rhoVal');
    rhoEl.textContent = (dol >= 0 ? '+' : '−') + '$' + Math.abs(dol).toFixed(2);
    rhoEl.className = dol >= 1 ? 'hot' : '';
    $('targetLbl').textContent = level.type === 'hold' ? `Target ${Math.round(level.band[0] * 100)}–${Math.round(level.band[1] * 100)}%`
      : level.type === 'track' ? `Demand ${Math.round(level.demand(g.t) * 100)}%` : powerRange(p.n);

    const fuelF = (p.Tcl - 0) / d.meltT;
    setBar('fuelBar', fuelF, sev(fuelF), 1);
    $('fuelVal').textContent = Math.round(p.Tcl) + '°';
    const cladMax = d.cladT * 1.4, cladF = p.Tclad / cladMax;
    setBar('cladBar', cladF, sev(p.Tclad / d.cladT), d.cladT / cladMax);
    $('cladVal').textContent = Math.round(p.Tclad) + '°';
    const cLo = d.Tin - 30, cHi = d.Tsat + 40;
    setBar('coolBar', (p.Tc - cLo) / (cHi - cLo), p.Tc >= d.Tsat - 0.5 ? '#ffc44d' : '#5fb4ff', (d.Tsat - cLo) / (cHi - cLo));
    $('coolVal').textContent = Math.round(p.Tc) + '°';
    const water = p.level * (1 - p.void);
    setBar('levelBar', water, water < 0.6 ? '#ff5a43' : water < 0.85 ? '#ffc44d' : '#5fb4ff');
    $('levelVal').textContent = Math.round(water * 100) + '%';
    const flow = p.flow + (p.eccs ? 0.7 : 0);
    setBar('flowBar', Math.min(1, flow), p.flow < 0.3 ? '#ffc44d' : '#5fb4ff');
    $('flowVal').textContent = Math.round(p.flow * 100) + '%';
    setBar('xeBar', p.X / 2, p.X > 1.3 ? '#ffc44d' : '#8a68d8');
    $('xeVal').textContent = d.xeW ? p.X.toFixed(2) : 'n/a';

    // annunciators
    let newAlarm = false;
    for (const [id, , test, kind] of ANN) {
      const on = !!test(p);
      const el = $('ann-' + id);
      if (on !== lastAnn[id] || force) {
        el.className = 'ann' + (on ? ' on' + (kind === 'warn' ? ' warn' : '') + (kind === 'crit' ? ' blink' : '') : '');
        if (on && !lastAnn[id] && kind === 'crit' && !force) newAlarm = true;
        lastAnn[id] = on;
      }
    }
    if (newAlarm) sound.alarm();

    // controls
    const pumpBtn = $('pumpBtn');
    pumpBtn.setAttribute('aria-pressed', p.pumps);
    pumpBtn.classList.toggle('fault', p.pumpsTripped);
    $('pumpSub').textContent = p.pumpsTripped ? 'Tripped · ' + Math.round(p.flow * 100) + '%' : (p.pumps ? 'On · ' : 'Off · ') + Math.round(p.flow * 100) + '%';
    const eccsBtn = $('eccsBtn');
    eccsBtn.setAttribute('aria-pressed', p.eccs);
    eccsBtn.disabled = p.eccsLeft <= 0;
    $('eccsSub').textContent = p.eccsLeft <= 0 ? 'Tank empty' : (p.eccs ? 'Injecting · ' : 'Ready · ') + Math.ceil(p.eccsLeft) + ' s';
    const canRefuel = d.onlineRefuel || p.n < 0.02;
    $('refuelBtn').disabled = !canRefuel || g.refuelReady > 0;
    $('refuelSub').textContent = `Fuel ${Math.round(100 * (1 - p.burn))}%` + (g.refuelReady > 0 ? ' · loading' : canRefuel ? ' · ready' : ' · shut down first');
    const sb = $('scramBtn');
    sb.classList.toggle('reset', p.scram);
    $('scramK').textContent = p.scram ? 'Reset' : 'Scram';
    $('scramSub').textContent = p.scram ? 'Unlatch the rods' : 'Drop all rods';

    // lever
    const avgT = p.rodTarget.reduce((a, b) => a + b, 0) / PL.ROD_COUNT;
    $('leverHandle').style.top = (p.avgRods() * 100).toFixed(1) + '%';
    $('leverTarget').style.top = (avgT * 100).toFixed(1) + '%';
    lever.setAttribute('aria-valuenow', Math.round(avgT * 100));

    // mission
    let goal = level.goal, prog = 0;
    if (level.type === 'hold') { goal = `${level.goal} · ${Math.floor(g.hold)}/${level.holdSecs} s`; prog = g.hold / level.holdSecs; }
    else if (level.type === 'track') { goal = `${level.goal} · on target ${Math.round(g.score * 100)}%`; prog = g.t / level.timeLimit; }
    else if (level.type === 'survive') { prog = g.t / level.timeLimit; }
    else { goal = `${level.goal} · ${Math.round(p.energyMWh).toLocaleString('en-US')} MWh`; }
    $('mGoal').textContent = goal;
    $('mProg').style.width = (clamp(prog, 0, 1) * 100).toFixed(1) + '%';
    $('clock').textContent = level.timeLimit ? fmtClock(level.timeLimit - g.t) : fmtClock(g.t);
  }

  // ---------------------------------------------------------------- game logic
  function tick(dt) {
    const p = plant;
    g.t += dt;
    if (g.refuelReady > 0) g.refuelReady = Math.max(0, g.refuelReady - dt);
    if (level.events) for (const ev of level.events) if (!g.fired.has(ev) && g.t >= ev.t) { g.fired.add(ev); ev.run(p, g); }
    p.step(dt);
    if (p.scram && g.scramAt == null) g.scramAt = g.t;

    if (level.type === 'hold') {
      const inBand = p.n >= level.band[0] && p.n <= level.band[1];
      if (level.accumulate) { if (inBand) g.hold += dt; } else g.hold = inBand ? g.hold + dt : 0;
      if (g.hold >= level.holdSecs) return finish(true);
    } else if (level.type === 'track') {
      if (g.t > 3) { g.scored += dt; if (Math.abs(p.n - level.demand(g.t)) <= level.tol) g.inBand += dt; }
      g.score = g.scored > 0 ? g.inBand / g.scored : 0;
    }
    if (level.minPower && g.t < level.minPower.until && !p.scram && p.n < level.minPower.p) {
      g.lowSecs = (g.lowSecs || 0) + dt;
      if (g.lowSecs > level.minPower.grace) return finish(false, 'lowpower');
    }
    if (p.melted) return finish(false, 'melt');
    if (level.maxCladSecs != null && p.cladSecs > level.maxCladSecs) return finish(false, 'clad');
    if (level.timeLimit && g.t >= level.timeLimit) {
      if (level.type === 'survive') return finish(true);
      if (level.type === 'track') return finish(g.score >= 0.5, g.score >= 0.5 ? null : 'track');
      return finish(false, 'time');
    }
  }

  function finish(won, why) {
    g.over = true; g.won = won; g.why = why;
    if (won) sound.win(); else if (why === 'melt') sound.melt();
    setTimeout(() => { paused = true; showResult(); }, won ? 600 : 2600);
  }

  // ---------------------------------------------------------------- overlays
  const overlay = $('overlay'), sheet = $('sheet');
  function openSheet(html) { sheet.innerHTML = html; overlay.hidden = false; const b = sheet.querySelector('.btn.primary, .lvl'); if (b) b.focus({ preventScroll: true }); }
  function closeSheet() { overlay.hidden = true; }
  const starStr = n => '★'.repeat(n) + `<span class="off">${'★'.repeat(3 - n)}</span>`;

  function showLevels() {
    const cards = LEVELS.map((lv, i) => {
      const st = progress[lv.id] || 0;
      return `<button class="lvl" type="button" data-lv="${i}">
        <div class="row"><span class="n">Level ${i + 1}</span><span class="chip">${PL.DESIGNS[lv.design].name}</span></div>
        <div class="t">${lv.title}</div>
        <div class="d">${lv.short}</div>
        <div class="stars" aria-label="${st} of 3 stars">${starStr(st)}</div>
      </button>`;
    }).join('');
    const total = LEVELS.reduce((a, lv) => a + (progress[lv.id] || 0), 0);
    openSheet(`
      <div class="kicker">Night shift · ${total}/${LEVELS.length * 3} stars</div>
      <h2>Chain Reaction Lab</h2>
      <p>Run real reactor designs through startups, load changes and accidents. The physics is real: delayed neutrons, Doppler and void feedback, xenon, decay heat. Your job is to keep the core from melting.</p>
      <div class="levels">${cards}</div>
      <div class="free">
        <h3>Free play</h3>
        <p class="muted">Pick a design and run it at full power. Break things on purpose with the fault buttons.</p>
        <div class="chips">${Object.values(PL.DESIGNS).map(dd => `<button type="button" data-free="${dd.id}">${dd.name}</button>`).join('')}</div>
      </div>
      <p class="keys"><kbd>↑</kbd> <kbd>↓</kbd> all rods · drag a rod to move it alone · <kbd>X</kbd> SCRAM · <kbd>P</kbd> pause.
      Want to see the bare particle physics? <a href="simulator/">Open the fission simulator</a>.</p>
    `);
    sheet.querySelectorAll('[data-lv]').forEach(b => b.addEventListener('click', () => showBrief(LEVELS[+b.dataset.lv])));
    sheet.querySelectorAll('[data-free]').forEach(b => b.addEventListener('click', () => { sound.unlock(); startLevel(FREE, b.dataset.free); closeSheet(); paused = false; }));
  }

  function showBrief(lv) {
    const d = PL.DESIGNS[lv.design];
    const st = progress[lv.id] || 0;
    openSheet(`
      <div class="kicker">Level ${LEVELS.indexOf(lv) + 1} · ${d.name} · ${d.full}</div>
      <h2>${lv.title}</h2>
      <p><b>Goal:</b> ${lv.goal}${lv.timeLimit ? ` (${fmtClock(lv.timeLimit)} on the clock)` : ''}.</p>
      <p class="muted">${d.blurb}</p>
      <div class="facts">
        <div class="fact"><span class="lbl">Fuel</span><b>${d.fuel.short}</b></div>
        <div class="fact"><span class="lbl">Moderator</span><b>${d.modName}</b></div>
        <div class="fact"><span class="lbl">Coolant</span><b>${d.coolant}</b></div>
        <div class="fact"><span class="lbl">Delayed neutrons β</span><b>${(d.beta * 100).toFixed(2)}%</b></div>
      </div>
      <ul class="tips">${lv.tips.map(t => `<li>${t}</li>`).join('')}</ul>
      <div class="star-list" aria-label="Stars">${lv.stars.map((s, i) => `<span class="${i < st ? '' : 'off'}"><b>★</b>${s[0]}</span>`).join('')}</div>
      <div class="btn-row"><button class="btn primary" type="button" id="goBtn">Start shift</button><button class="btn" type="button" id="backBtn">All levels</button></div>
    `);
    $('goBtn').addEventListener('click', () => { sound.unlock(); startLevel(lv); closeSheet(); paused = false; });
    $('backBtn').addEventListener('click', showLevels);
  }

  function lessonFor() {
    const p = plant, d = p.d;
    if (g.why === 'melt') {
      if (p.level < 0.3) return `The core was uncovered and decay heat did the rest. ${d.meltWhat}. Once the cladding passed 1,200 °C, zirconium burning in steam added its own heat. Earlier ECCS keeps the fuel under water.`;
      if (d.id === 'rbmk' && p.voidEff > 0.05) return `Boiling added reactivity, power rose, more water boiled: the positive void feedback that destroyed Chernobyl Unit 4. A SCRAM right after the trip, or refusing the test, keeps the core intact.`;
      if (p.peakPower > 1.5) return `Power ran away. Reactivity went in faster than Doppler feedback could answer, and the fuel centerline passed its melting point. ${d.meltWhat}. Move rods in small steps and keep the period long.`;
      return `${d.meltWhat}. The fuel could not shed heat fast enough.`;
    }
    if (g.why === 'clad') return `The cladding passed ${d.cladT} °C. ${d.cladWhat}.`;
    if (g.why === 'lowpower') return 'Power fell into a xenon pit and the unit dropped off the grid. The 1986 crew fought the same pit by pulling almost every rod, which set up the accident. Hold power by pulling rods early and gently, or SCRAM to refuse the test.';
    if (g.why === 'time') return 'The clock ran out before you held the target. Pull rods a little faster, and keep an eye on the period so you don’t overshoot.';
    if (g.why === 'track') return 'You were on target less than half the time. Remember that xenon builds after a power cut, so climbing back needs extra rod withdrawal.';
    const wins = {
      startup: 'You took the core from the source range to full power. Real operators do the same thing, more slowly: about a decade of power per minute.',
      grid: 'You followed the grid. Load following is harder with xenon fighting back, which is why many plants prefer to run flat out.',
      loca: 'The core stayed covered. A fast SCRAM and timely ECCS are exactly what was missing at Three Mile Island in 1979.',
      candu: 'Online refuelling is how CANDU reactors run on natural uranium for years without shutting down.',
      rbmk: g.scramAt != null && g.scramAt < 30 ? 'You refused an unsafe test. In 1986 the Chernobyl crew went ahead with too few rods and too little power.' : 'You caught the void runaway in time. After 1986 every RBMK got more rods, faster SCRAM and fixed rod tips.',
      sfr: g.scramAt == null ? 'The reactor shut itself down. Thermal expansion and Doppler feedback did the work, just as in the EBR-II tests of 1986.' : 'Safe. Next time try leaving the rods alone: this core can shut itself down.',
    };
    return wins[level.id] || 'Shift complete.';
  }

  function showResult() {
    const p = plant;
    let stars = 0;
    if (level.stars && g.won) stars = level.stars.filter(s => s[1](g, p)).length;
    if (level.id && level.stars && stars > (progress[level.id] || 0)) { progress[level.id] = stars; store.set('progress', progress); }
    const idx = LEVELS.indexOf(level);
    const next = idx >= 0 && idx < LEVELS.length - 1 ? LEVELS[idx + 1] : null;
    const title = g.won ? (level.type === 'free' ? 'Shift over' : 'Shift complete') : g.why === 'melt' ? 'Core meltdown' : 'Shift failed';
    openSheet(`
      <div class="kicker">${level.title} · ${p.d.name}</div>
      <h2 style="color:${g.won ? 'var(--ok)' : 'var(--crit)'}">${title}</h2>
      ${level.stars ? `<div class="stars big-stars" aria-label="${stars} of 3 stars">${starStr(stars)}</div>
      <div class="star-list" style="justify-content:center">${level.stars.map(s => `<span class="${g.won && s[1](g, p) ? '' : 'off'}"><b>★</b>${s[0]}</span>`).join('')}</div>` : ''}
      <p>${lessonFor()}</p>
      <div class="facts">
        <div class="fact"><span class="lbl">Peak power</span><b>${Math.round(p.peakPower * 100)}%</b></div>
        <div class="fact"><span class="lbl">Peak fuel centerline</span><b>${Math.round(p.peakTf).toLocaleString('en-US')} °C</b></div>
        <div class="fact"><span class="lbl">Peak cladding</span><b>${Math.round(p.peakClad || 0).toLocaleString('en-US')} °C</b></div>
        <div class="fact"><span class="lbl">Electricity made</span><b>${Math.round(p.energyMWh).toLocaleString('en-US')} MWh</b></div>
      </div>
      <div class="btn-row">
        ${g.won && next ? `<button class="btn primary" type="button" id="nextBtn">Next: ${next.title}</button>` : ''}
        <button class="btn ${g.won && next ? '' : 'primary'}" type="button" id="retryBtn">Try again</button>
        <button class="btn" type="button" id="lvBtn">All levels</button>
      </div>
    `);
    if ($('nextBtn')) $('nextBtn').addEventListener('click', () => showBrief(next));
    $('retryBtn').addEventListener('click', () => { if (level.type === 'free') { startLevel(FREE, g.design); closeSheet(); paused = false; } else showBrief(level); });
    $('lvBtn').addEventListener('click', showLevels);
  }

  function togglePause() {
    if (!plant || g.over) return;
    if (!overlay.hidden && !paused) return;
    if (paused && !overlay.hidden) { closeSheet(); paused = false; return; }
    paused = true;
    openSheet(`
      <div class="kicker">${level.title}</div>
      <h2>Paused</h2>
      <div class="btn-row">
        <button class="btn primary" type="button" id="resumeBtn">Resume</button>
        <button class="btn" type="button" id="restartBtn">Restart</button>
        ${level.type === 'free' ? '<button class="btn danger" type="button" id="endBtn">End shift</button>' : ''}
        <button class="btn" type="button" id="lvBtn2">All levels</button>
      </div>
    `);
    $('resumeBtn').addEventListener('click', () => { closeSheet(); paused = false; });
    $('restartBtn').addEventListener('click', () => { if (level.type === 'free') { startLevel(FREE, g.design); closeSheet(); paused = false; } else showBrief(level); });
    if ($('endBtn')) $('endBtn').addEventListener('click', () => { g.over = true; g.won = true; showResult(); });
    $('lvBtn2').addEventListener('click', showLevels);
  }
  overlay.addEventListener('click', e => { if (e.target === overlay && plant && !g.over && level) { closeSheet(); paused = false; } });

  // ---------------------------------------------------------------- loop
  let hudAcc = 0, sampleAcc = 0;
  function frame(now) {
    const raw = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    if (plant) {
      if (!paused && !g.over) {
        tick(raw);
        sampleAcc += raw;
        sound.geiger(Math.min(70, 3 + 60 * Math.sqrt(Math.max(plant.n, 0))), raw);
      }
      if (plant.melted) { slump = Math.min(1, slump + raw * 0.35); shake = Math.max(0, 1 - slump); } else shake = 0;
      if (toastTimer > 0) { toastTimer -= raw; if (toastTimer <= 0) { $('toast').hidden = true; $('hint').style.visibility = ''; } }
      if (sampleAcc >= 0.5) { sampleAcc -= 0.5; g.samples.push(plant.n); if (g.samples.length > 120) g.samples.shift(); drawTrend(); }
      drawCore(now, paused ? 0 : raw);
      hudAcc += raw;
      if (hudAcc > 0.1) { hudAcc = 0; updateHUD(); }
    }
    requestAnimationFrame(frame);
  }

  // Attract mode behind the title screen: a PWR humming at full power.
  startLevel(FREE, 'pwr');
  paused = false;
  showLevels();
  requestAnimationFrame(frame);
})();
