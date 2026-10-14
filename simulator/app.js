(function () {
  'use strict';
  const F = window.FissionSim;
  const T = F.T;
  const $ = id => document.getElementById(id);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Colors inside the pool. The pool is always dark, so these are fixed.
  const NODE_COLOR = {
    [T.U235]: '#ffb238', [T.PU239]: '#ff5c8a', [T.U233]: '#ffe066',
    [T.U238]: '#5f7896', [T.TH232]: '#8f946c',
    [T.FP]: '#39414e', [T.XE135]: '#7a5cc4', [T.SPENT]: '#2b323d',
    [T.BREED_PU]: '#b9789a', [T.BREED_U3]: '#c2b25e',
  };
  const NODE_NAME = {
    [T.U235]: 'U-235', [T.PU239]: 'Pu-239', [T.U233]: 'U-233', [T.U238]: 'U-238', [T.TH232]: 'Th-232',
    [T.FP]: 'Fission products', [T.XE135]: 'Xe-135 poison', [T.SPENT]: 'U-236 / Pu-240',
    [T.BREED_PU]: 'U-239 → Pu-239', [T.BREED_U3]: 'Pa-233 → U-233',
  };
  const FISSILE = new Set([T.U235, T.PU239, T.U233]);
  const FERTILE_OF = { natu: T.U238, leu: T.U238, heu: T.U238, pu: T.U238, mox: T.U238, thor: T.TH232 };

  const sim = F.create({ fuel: 'leu', mod: 'h2o' });
  sim.rods = 0.6;

  // ---------- Controls ----------
  const fuelsEl = $('fuels');
  F.FUELS.forEach(f => {
    const fissileType = +Object.keys(f.mix).find(t => FISSILE.has(+t) && f.mix[t] >= 0.05);
    const lab = document.createElement('label');
    lab.className = 'choice';
    lab.innerHTML = `<input type="radio" name="fuel" id="fuel-${f.id}" value="${f.id}"${f.id === 'leu' ? ' checked' : ''}>
      <span class="face"><b><i style="background:${NODE_COLOR[fissileType]}"></i>${f.short}</b><small>${f.real}</small></span>`;
    fuelsEl.appendChild(lab);
  });
  const modsEl = $('mods');
  Object.entries(F.MODERATORS).forEach(([id, m]) => {
    const lab = document.createElement('label');
    lab.className = 'choice';
    lab.innerHTML = `<input type="radio" name="mod" id="mod-${id}" value="${id}"${id === 'h2o' ? ' checked' : ''}>
      <span class="face"><b>${m.label}</b><small>${m.detail}</small></span>`;
    modsEl.appendChild(lab);
  });

  function fmtPct(x, d) { return (x * 100).toFixed(d == null ? 2 : d) + '%'; }

  function renderFacts() {
    const f = sim.fuel;
    const types = Object.keys(f.mix).map(Number);
    const fissile = types.filter(t => FISSILE.has(t)).sort((a, b) => f.mix[b] - f.mix[a]);
    const main = F.ISO[fissile[0]];
    const fertile = F.ISO[FERTILE_OF[f.id]];
    const breed = FERTILE_OF[f.id] === T.TH232 ? 'Th-232 → Pa-233 → U-233' : 'U-238 → U-239 → Np-239 → Pu-239';
    $('facts').innerHTML = `
      <dt>Real makeup</dt><dd>${f.real}</dd>
      <dt>Fissile</dt><dd>${fissile.map(t => F.ISO[t].label).join(' + ')}</dd>
      <dt>Neutrons / fission (ν)</dt><dd>${main.nu.toFixed(2)}</dd>
      <dt>Energy / fission</dt><dd>≈ ${main.mev.toFixed(1)} MeV</dd>
      <dt>Delayed fraction (β)</dt><dd>${fmtPct(main.beta)}</dd>
      <dt>Fertile</dt><dd>${fertile.label}</dd>
      <dt>Breeding</dt><dd>${breed}</dd>
      <dt>Used in</dt><dd>${f.use}</dd>`;
    $('fuelNote').textContent = f.note;
    renderLegend();
    updateTag();
  }

  function renderLegend() {
    const types = Object.keys(sim.fuel.mix).map(Number);
    const fert = FERTILE_OF[sim.fuel.id];
    const shown = [...types, fert === T.TH232 ? T.BREED_U3 : T.BREED_PU, T.XE135, T.FP];
    const uniq = [...new Set(shown)];
    $('legend').innerHTML = uniq.map(t => `<span><i style="background:${NODE_COLOR[t]}"></i>${NODE_NAME[t]}</span>`).join('') +
      '<span><i class="n-fast"></i>Fast neutron</span><span><i class="n-th"></i>Thermal neutron</span>';
  }

  function updateTag() {
    const m = F.MODERATORS[sim.mod];
    $('poolTag').textContent = `Core · ${sim.fuel.short} · ${m.label.toLowerCase()}`;
  }

  fuelsEl.addEventListener('change', e => {
    sim.loadFuel(e.target.value);
    resetRun();
    renderFacts();
    kick(30);
  });
  modsEl.addEventListener('change', e => { sim.mod = e.target.value; updateTag(); });

  const rodsEl = $('rods');
  let rodTarget = sim.rods;
  function setRods(v) {
    rodTarget = v;
    rodsEl.value = Math.round(v * 100);
    $('rodsOut').textContent = Math.round(v * 100) + '% in';
  }
  rodsEl.addEventListener('input', () => setRods(rodsEl.value / 100));
  $('scram').addEventListener('click', () => { setRods(1); scramFast = true; });
  let scramFast = false;

  $('reflector').addEventListener('change', e => { sim.reflector = e.target.checked; });
  $('source').addEventListener('change', e => { sim.source = e.target.checked; });

  let speed = 1;
  $('speed').addEventListener('input', e => { speed = +e.target.value; $('speedOut').textContent = speed.toFixed(2).replace(/0$/, '') + '×'; });

  let paused = false;
  $('pause').addEventListener('click', () => {
    paused = !paused;
    $('pause').textContent = paused ? 'Resume' : 'Pause';
  });
  $('fire').addEventListener('click', () => kick(20));
  $('refuel').addEventListener('click', () => { sim.loadFuel(sim.fuel.id); resetRun(); kick(30); });

  function kick(n) {
    for (let i = 0; i < n; i++) sim.inject(F.W * (0.3 + Math.random() * 0.4), F.H * (0.3 + Math.random() * 0.4), 1);
  }

  // ---------- Core canvas ----------
  const pool = $('pool');
  const canvas = $('core');
  const ctx = canvas.getContext('2d');
  let scale = 1, dpr = 1;

  function resize() {
    const r = pool.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    scale = r.width / F.W;
  }
  new ResizeObserver(resize).observe(pool);
  resize();

  canvas.addEventListener('pointerdown', e => {
    const r = canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width * F.W, y = (e.clientY - r.top) / r.height * F.H;
    sim.inject(x, y, 6);
    flashes.push({ x, y, t: performance.now(), color: '#9fd6ff', ring: true, inject: true });
  });

  const flashes = [];
  const frags = [];

  function drawCore(now, stats) {
    const W = F.W, H = F.H;
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);

    // Water + Cherenkov glow proportional to fission rate
    const g = ctx.createRadialGradient(W / 2, H / 2, 20, W / 2, H / 2, W * 0.7);
    const glow = Math.min(1, Math.log10(1 + stats.fissionRate) / 3);
    g.addColorStop(0, `rgba(${20 + 40 * glow | 0}, ${50 + 90 * glow | 0}, ${110 + 120 * glow | 0}, 1)`);
    g.addColorStop(1, '#030b17');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // Nuclei, batched by type
    const { nx, ny, type, atoms, N } = sim;
    const byType = {};
    for (let k = 0; k < N; k++) (byType[type[k]] || (byType[type[k]] = [])).push(k);
    const pulse = reduceMotion ? 1 : 0.6 + 0.4 * Math.sin(now / 180);
    for (const t in byType) {
      const tt = +t;
      const list = byType[t];
      ctx.fillStyle = NODE_COLOR[tt];
      if (FISSILE.has(tt)) {
        // size shows remaining fissile atoms at that site
        for (const k of list) {
          const rr = 1.6 + 2.2 * (atoms[k] / F.ATOMS);
          ctx.beginPath(); ctx.arc(nx[k], ny[k], Math.min(4, rr), 0, Math.PI * 2); ctx.fill();
        }
      } else {
        let r = 2.4;
        if (tt === T.FP || tt === T.SPENT) r = 1.6;
        if (tt === T.XE135) r = 2.6;
        if (tt === T.BREED_PU || tt === T.BREED_U3) { r = 2.6; ctx.globalAlpha = pulse; }
        ctx.beginPath();
        for (const k of list) { ctx.moveTo(nx[k] + r, ny[k]); ctx.arc(nx[k], ny[k], r, 0, Math.PI * 2); }
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    // Control rods
    const depth = sim.rods * H;
    if (depth > 0.5) {
      const w = F.ROD_W;
      for (const x of sim.rodXs) {
        ctx.fillStyle = 'rgba(8, 12, 18, 0.88)';
        ctx.fillRect(x - w / 2, 0, w, depth);
        ctx.strokeStyle = '#4c5a6b'; ctx.lineWidth = 1;
        ctx.strokeRect(x - w / 2 + 0.5, -1, w - 1, depth + 0.5);
        ctx.fillStyle = '#7f8ea0';
        ctx.fillRect(x - w / 2, depth - 3, w, 3);
      }
    }

    // Startup source
    if (sim.source) {
      ctx.strokeStyle = '#9fd6ff'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(W / 2, H / 2, 6, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#9fd6ff'; ctx.font = '600 9px "IBM Plex Mono", monospace';
      ctx.fillText('Am-Be', W / 2 + 9, H / 2 - 7);
    }

    // New fission events → flashes and fragments
    const evs = sim.events;
    for (let i = 0; i < evs.length; i++) {
      const ev = evs[i];
      flashes.push({ x: ev.x, y: ev.y, t: now, color: NODE_COLOR[ev.isoType] });
      if (!reduceMotion && frags.length < 600) {
        const a = Math.random() * Math.PI * 2;
        frags.push({ x: ev.x, y: ev.y, dx: Math.cos(a), dy: Math.sin(a), t: now });
        frags.push({ x: ev.x, y: ev.y, dx: -Math.cos(a), dy: -Math.sin(a), t: now });
      }
      pushLog(ev);
    }
    evs.length = 0;
    if (flashes.length > 250) flashes.splice(0, flashes.length - 250);

    ctx.globalCompositeOperation = 'lighter';
    for (let i = flashes.length - 1; i >= 0; i--) {
      const f = flashes[i];
      const age = (now - f.t) / (reduceMotion ? 250 : 450);
      if (age >= 1) { flashes.splice(i, 1); continue; }
      ctx.globalAlpha = 1 - age;
      if (f.ring) {
        ctx.strokeStyle = f.color; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(f.x, f.y, 4 + age * 18, 0, Math.PI * 2); ctx.stroke();
      } else {
        const rad = reduceMotion ? 8 : 4 + age * 16;
        const rg = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, rad);
        rg.addColorStop(0, '#ffffff'); rg.addColorStop(0.35, f.color); rg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = rg;
        ctx.beginPath(); ctx.arc(f.x, f.y, rad, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.fillStyle = '#ffd3a1';
    for (let i = frags.length - 1; i >= 0; i--) {
      const p = frags[i];
      const age = (now - p.t) / 600;
      if (age >= 1) { frags.splice(i, 1); continue; }
      ctx.globalAlpha = 1 - age;
      const d = 30 * Math.sqrt(age);
      ctx.beginPath(); ctx.arc(p.x + p.dx * d, p.y + p.dy * d, 1.8, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Neutrons
    const { px, py, vx, vy, th, n } = sim;
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < n; i++) if (!th[i]) { ctx.moveTo(px[i], py[i]); ctx.lineTo(px[i] - vx[i] * 0.03, py[i] - vy[i] * 0.03); }
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    for (let i = 0; i < n; i++) if (!th[i]) { ctx.moveTo(px[i] + 1.4, py[i]); ctx.arc(px[i], py[i], 1.4, 0, Math.PI * 2); }
    ctx.fill();
    ctx.fillStyle = '#4fb8ff';
    ctx.beginPath();
    for (let i = 0; i < n; i++) if (th[i]) { ctx.moveTo(px[i] + 1.7, py[i]); ctx.arc(px[i], py[i], 1.7, 0, Math.PI * 2); }
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  // ---------- Reaction log ----------
  const logEl = $('log');
  const logItems = [];
  let lastLogAt = 0;
  function pushLog(ev) {
    const now = performance.now();
    if (now - lastLogAt < 220) return;
    lastLogAt = now;
    logItems.unshift({ text: `${ev.iso} + n → ${ev.frags[0]} + ${ev.frags[1]} + ${ev.count}n`, mev: ev.mev });
    if (logItems.length > 7) logItems.pop();
    logEl.innerHTML = logItems.map(l => `<li><span>${l.text}</span><span>${l.mev.toFixed(1)} MeV</span></li>`).join('');
  }

  // ---------- Trend chart ----------
  const trend = $('trend');
  const tctx = trend.getContext('2d');
  const samples = [];
  const SAMPLE_DT = 0.5, NSAMPLES = 120;
  let themeColors = null;
  function readTheme() {
    const cs = getComputedStyle(document.documentElement);
    themeColors = {
      accent: cs.getPropertyValue('--accent').trim(), muted: cs.getPropertyValue('--muted').trim(),
      line: cs.getPropertyValue('--line').trim(), ink: cs.getPropertyValue('--ink').trim(),
      crit: cs.getPropertyValue('--crit').trim(),
    };
  }
  readTheme();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { readTheme(); drawTrend(); });
  new MutationObserver(() => { readTheme(); drawTrend(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  function drawTrend() {
    const r = trend.getBoundingClientRect();
    const w = Math.round(r.width), h = Math.round(r.height);
    if (!w || !h) return;
    const d = Math.min(window.devicePixelRatio || 1, 2);
    if (trend.width !== w * d) { trend.width = w * d; trend.height = h * d; }
    tctx.setTransform(d, 0, 0, d, 0, 0);
    tctx.clearRect(0, 0, w, h);
    const c = themeColors;
    const padL = 38, padR = 8, padT = 8, padB = 18;
    const pw = w - padL - padR, ph = h - padT - padB;
    const maxLog = Math.log10(F.MAX_N);
    const yOf = v => padT + ph - (Math.log10(1 + v) / maxLog) * ph;
    tctx.font = '11px "IBM Plex Mono", monospace';
    tctx.textBaseline = 'middle';
    [1, 10, 100, 1000].forEach(v => {
      const y = Math.round(yOf(v)) + 0.5;
      tctx.strokeStyle = c.line; tctx.lineWidth = 1;
      tctx.beginPath(); tctx.moveTo(padL, y); tctx.lineTo(w - padR, y); tctx.stroke();
      tctx.fillStyle = c.muted; tctx.textAlign = 'right';
      tctx.fillText(v >= 1000 ? '1k' : String(v), padL - 6, y);
    });
    tctx.textAlign = 'left'; tctx.textBaseline = 'alphabetic'; tctx.fillStyle = c.muted;
    tctx.fillText('−60 s', padL, h - 4);
    tctx.textAlign = 'right'; tctx.fillText('now', w - padR, h - 4);
    if (samples.length < 2) return;
    const xOf = i => padL + pw * (i + NSAMPLES - samples.length) / (NSAMPLES - 1);
    tctx.beginPath();
    samples.forEach((v, i) => { const x = xOf(i), y = yOf(v); i ? tctx.lineTo(x, y) : tctx.moveTo(x, y); });
    const lastX = xOf(samples.length - 1);
    tctx.save();
    tctx.lineTo(lastX, padT + ph); tctx.lineTo(xOf(0), padT + ph); tctx.closePath();
    tctx.globalAlpha = 0.16; tctx.fillStyle = c.accent; tctx.fill();
    tctx.restore();
    tctx.beginPath();
    samples.forEach((v, i) => { const x = xOf(i), y = yOf(v); i ? tctx.lineTo(x, y) : tctx.moveTo(x, y); });
    tctx.strokeStyle = c.accent; tctx.lineWidth = 2; tctx.lineJoin = 'round'; tctx.stroke();
    const lv = samples[samples.length - 1];
    tctx.fillStyle = lv >= F.MAX_N ? c.crit : c.accent;
    tctx.beginPath(); tctx.arc(lastX, yOf(lv), 3.5, 0, Math.PI * 2); tctx.fill();
  }

  // ---------- Readouts ----------
  let kSmooth = null;
  function fmtInt(n) { return Math.round(n).toLocaleString('en-US'); }
  function fmtMeV(mev) {
    if (mev >= 1e6) return (mev / 1e6).toFixed(2) + ' TeV';
    if (mev >= 1e3) return (mev / 1e3).toFixed(1) + ' GeV';
    return mev.toFixed(0) + ' MeV';
  }
  function fmtWatts(w) {
    const units = [['W', 1], ['mW', 1e-3], ['µW', 1e-6], ['nW', 1e-9], ['pW', 1e-12], ['fW', 1e-15]];
    if (w <= 0) return '0 W';
    for (const [u, f] of units) if (w >= f) return (w / f).toFixed(w / f < 10 ? 2 : 1) + ' ' + u;
    return w.toExponential(1) + ' W';
  }

  function updateReadouts(stats) {
    if (stats.k == null) kSmooth = null;
    else kSmooth = kSmooth == null ? stats.k : kSmooth * 0.7 + stats.k * 0.3;
    const k = kSmooth;
    $('roK').textContent = k == null ? '—' : k.toFixed(3);
    $('gaugeNeedle').style.left = k == null ? '0%' : Math.min(100, Math.max(0, k / 2 * 100)) + '%';
    $('roN').textContent = fmtInt(stats.neutrons) + (stats.capped ? '+' : '');
    $('roNsub').textContent = `${fmtInt(stats.fast)} fast · ${fmtInt(stats.thermal)} th · ${fmtInt(stats.delayedPending)} delayed`;
    $('roF').textContent = fmtInt(stats.fissionRate) + ' /s';
    $('roFsub').textContent = fmtInt(stats.fissions) + ' total';
    $('roP').textContent = fmtMeV(stats.powerMeVs) + '/s';
    $('roPsub').textContent = '≈ ' + fmtWatts(stats.powerMeVs * 1.602176634e-13);
    $('roFuel').textContent = Math.round(stats.fissileFrac * 100) + '%';
    $('roFuelsub').textContent = `${fmtInt(stats.bred)} sites bred`;
    $('energyTotal').textContent = fmtMeV(stats.energyMeV) + ' released';

    let s = 'sub', label = 'Subcritical';
    if (stats.capped) { s = 'excursion'; label = 'Power excursion'; }
    else if (k == null) { s = 'sub'; label = stats.neutrons ? 'Measuring' : 'Shut down'; }
    else if (k > 1.03) { s = 'super'; label = 'Supercritical'; }
    else if (k >= 0.97) { s = 'critical'; label = 'Critical'; }
    const st = $('state');
    if (st.dataset.s !== s) st.dataset.s = s;
    $('stateText').textContent = label;
    $('stateK').textContent = k == null ? 'k —' : 'k ' + k.toFixed(2);

    const hint = $('hint');
    if (stats.capped) {
      hint.textContent = 'Neutron population at the simulator limit. Insert the rods or hit SCRAM.';
      hint.dataset.warn = '';
    } else if (!stats.neutrons && !stats.delayedPending && !sim.source) {
      hint.textContent = 'The chain has died out. Click the core or turn on the startup source.';
      hint.dataset.warn = '';
    } else if (stats.fissileFrac < 0.1) {
      hint.textContent = 'The core is almost burned out. Refuel to start over.';
      hint.dataset.warn = '';
    } else {
      hint.textContent = 'Click or tap anywhere in the core to fire neutrons.';
      delete hint.dataset.warn;
    }
  }

  function resetRun() {
    samples.length = 0; kSmooth = null; logItems.length = 0;
    flashes.length = 0; frags.length = 0;
    logEl.innerHTML = '<li class="empty">Waiting for the first fission…</li>';
    drawTrend();
  }

  // ---------- Main loop ----------
  let last = performance.now(), uiAcc = 0, sampleAcc = 0;
  function frame(now) {
    const raw = Math.min(0.05, (now - last) / 1000);
    last = now;
    // Rods are driven at a finite speed; SCRAM drops them by gravity.
    const rodSpeed = scramFast ? 3 : 0.5;
    if (sim.rods !== rodTarget) {
      const step = rodSpeed * raw;
      sim.rods = Math.abs(rodTarget - sim.rods) <= step ? rodTarget : sim.rods + Math.sign(rodTarget - sim.rods) * step;
      if (sim.rods === rodTarget) scramFast = false;
    }
    if (!paused) {
      const dt = raw * speed;
      sim.step(dt);
      sampleAcc += dt;
    }
    const stats = sim.stats();
    drawCore(now, stats);
    uiAcc += raw;
    if (uiAcc > 0.2) { uiAcc = 0; updateReadouts(stats); }
    if (sampleAcc >= SAMPLE_DT) {
      sampleAcc -= SAMPLE_DT;
      samples.push(stats.neutrons);
      if (samples.length > NSAMPLES) samples.shift();
      drawTrend();
    }
    requestAnimationFrame(frame);
  }

  renderFacts();
  setRods(0.6);
  kick(30);
  updateReadouts(sim.stats());
  drawTrend();
  requestAnimationFrame(frame);
})();
