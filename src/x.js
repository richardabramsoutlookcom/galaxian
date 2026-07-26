// -------------------------------------------------------------------------
//  GALAXIAN X -- the widescreen build.
//
//  The other three versions draw a 224x256 portrait frame and scale it up.
//  This one takes the whole window and composes a landscape scene *around*
//  the playfield: the backdrop, planet and starfield run edge to edge, the
//  playfield sits in the middle inside a lit containment corridor, and the
//  flanks are cockpit panels carrying the score, the loadout and the wave
//  readout.  Divers that swing past the corridor rails fly out into the open
//  screen, which is the whole reason the composition works.
//
//  The simulation is untouched -- same formation, same peel-off arc, same
//  cosine sweep, same bombing heights.  What X adds (power-ups, skill tiers,
//  the combo) lives in the engine behind xr(); everything in this file is
//  presentation, and it reads a snapshot rather than reaching into state.
//
//  Like the other renderers it keeps its own random stream, so it never
//  consumes a number the simulation was going to draw.
// -------------------------------------------------------------------------
const Xr = (() => {
  const RES = 4;                 // kept for interface compatibility; unused
  const FULL = true;             // "size me to the window, not to 224x256"
  const GW = 224, GH = 256;      // the game's own coordinate space
  const TAU = Math.PI * 2;

  // Sprites are baked once at REF device pixels per *game* pixel and then
  // drawn at L.sc / REF, so a shape written as `1.1 * k` where `k = REF * n`
  // occupies 1.1 * n game pixels however big the window is.  Getting this
  // wrong is invisible in isolation and obvious next to the 16px column pitch:
  // the first pass baked everything at half scale and the swarm looked sparse.
  const REF = 8;
  const K_ALIEN = REF * 5.0;     // wing tips reach 1.10k -> 11 game px across
  const K_BOSS = REF * 5.8;
  const K_SHIP = REF * 6.2;      // wings reach 1.02k -> 12.6 game px across
  const K_POD = REF * 3.4;

  let cx = null;                 // the visible context
  let VW = 0, VH = 0;            // backing store size, device px
  let scene, sx;                 // full-res offscreen we compose into
  let b1, b1x, b2, b2x;          // two bloom taps at 1/4 and 1/8
  let neb, planet, moon;         // pre-baked backdrop pieces
  let canBlur = true;
  let built = 0;                 // the VW*VH the buffers were built for

  // playfield placement, recomputed on resize
  const L = { x: 0, y: 0, w: 0, h: 0, sc: 1, panel: 0, gut: 0, pad: 0, wide: true };

  const art = {};                // baked sprites
  const pods = {};               // baked power-up capsules
  let dot = null;

  const parts = [];
  const trails = new Map();
  const angles = new Map();
  const dust = [];
  const stars = [];
  let shake = 0, flash = 0, flashCol = '0,0,0', warp = 0, ca = 0;
  let tick = 0, lastPx = null, railPulse = 0;

  // --- private random stream ----------------------------------------------
  let seed = 0x7ac3f19;
  function nrand() {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  }
  const rnd = (a, b) => a + nrand() * (b - a);
  const pick = a => a[(nrand() * a.length) | 0];

  function mkCanvas(w, h) {
    const c = (typeof document !== 'undefined' && document.createElement)
      ? document.createElement('canvas') : null;
    if (!c) return null;
    c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0);
    return c;
  }

  // --- palette ------------------------------------------------------------
  const SKIN = {
    blue:   { hot: '#e6feff', mid: '#1fc8f5', low: '#062a4d', glow: '#45e0ff' },
    purple: { hot: '#fbd8ff', mid: '#b141ef', low: '#33075a', glow: '#d264ff' },
    red:    { hot: '#ffe6c0', mid: '#ff4520', low: '#4d0d04', glow: '#ff7038' },
    boss:   { hot: '#fffbdc', mid: '#ffb800', low: '#5c2f00', glow: '#ffd23c' },
  };
  const SHIP = { hull: '#eef5ff', trim: '#3df0ff', deep: '#1b3350', glow: '#6ef2ff' };
  const UI = {
    cyan: '#4fe6ff', ink: '#9fc4e8', hot: '#ff4fbf', gold: '#ffcf4a',
    good: '#7dffc4', dim: 'rgba(150,185,230,0.42)',
  };

  // =======================================================================
  //  layout
  //
  //  The playfield keeps its 224:256 aspect and its full height, then the
  //  screen is divided: a gutter each side wide enough for a diver's sweep to
  //  carry it clear of the rails, and a cockpit panel outside that.  On a
  //  narrow window the playfield gives ground until the panels fit.
  // =======================================================================
  const GUTTER_G = 46;           // game px of open space outside each rail

  function layout() {
    const pad = Math.round(VH * 0.035);
    let ph = VH - pad * 2;
    let pw = ph * GW / GH;
    const gutOf = w => GUTTER_G * w / GW;
    let panel = (VW - pw - 2 * gutOf(pw) - 4 * pad) / 2;

    if (panel < VH * 0.155) {
      panel = Math.max(VH * 0.125, Math.min(VH * 0.235, (VW - 4 * pad) * 0.16));
      pw = Math.max(80, (VW - 4 * pad - 2 * panel) / (1 + 2 * GUTTER_G / GW));
      ph = pw * GH / GW;
      if (ph > VH - pad * 2) { ph = VH - pad * 2; pw = ph * GW / GH; }
      panel = (VW - pw - 2 * gutOf(pw) - 4 * pad) / 2;
    }
    // On a very wide screen the arithmetic above hands the panels far more
    // width than they have content for.  Cap them and let the surplus become
    // open sky between the panel and the rail, which is where divers fly.
    panel = Math.min(panel, VH * 0.30);

    L.pad = pad;
    L.w = pw; L.h = ph;
    L.x = (VW - pw) / 2;
    L.y = (VH - ph) / 2;
    L.sc = pw / GW;
    L.gut = gutOf(pw);
    L.panel = panel;
    // below this the panels are too cramped to read, so the HUD folds into
    // slim strips top and bottom instead
    L.wide = panel > VH * 0.115 && VW > VH * 1.15;
  }

  const gx = v => L.x + v * L.sc;         // game x -> device x
  const gy = v => L.y + v * L.sc;
  const gs = v => v * L.sc;               // game length -> device length
  const u = () => VH / 900;               // UI unit, so panels scale with height

  // =======================================================================
  //  baked art
  // =======================================================================
  function glowPath(g, path, fill, stroke, blur, glowCol, lw) {
    g.save();
    if (blur) { g.shadowBlur = blur; g.shadowColor = glowCol; }
    g.fillStyle = fill;
    g.fill(path);
    g.restore();
    if (stroke) {
      g.strokeStyle = stroke;
      g.lineWidth = lw || 2.4;
      g.lineJoin = 'round';
      g.stroke(path);
    }
  }

  // The X alien is the 2026 silhouette sharpened: a longer nose, a hard
  // shoulder line and a separate canopy, so it still reads at 60 device px.
  function alienPaths(k, flap) {
    const s = flap * 0.12;
    const body = new Path2D();
    body.moveTo(0, 1.15 * k);
    body.lineTo(0.26 * k, 0.42 * k);
    body.lineTo(0.34 * k, -0.30 * k);
    body.lineTo(0.20 * k, -0.72 * k);
    body.lineTo(0.08 * k, -0.94 * k);
    body.lineTo(-0.08 * k, -0.94 * k);
    body.lineTo(-0.20 * k, -0.72 * k);
    body.lineTo(-0.34 * k, -0.30 * k);
    body.lineTo(-0.26 * k, 0.42 * k);
    body.closePath();

    const wings = [];
    for (const side of [-1, 1]) {
      const p = new Path2D();
      p.moveTo(side * 0.26 * k, 0.26 * k);
      p.lineTo(side * (1.04 + s) * k, (-0.04 - s) * k);
      p.lineTo(side * (1.10 + s) * k, (-0.46 - s * 1.3) * k);
      p.lineTo(side * 0.74 * k, (-0.20 - s * 0.4) * k);
      p.lineTo(side * 0.60 * k, (-0.44 - s * 0.3) * k);
      p.lineTo(side * 0.32 * k, -0.30 * k);
      p.closePath();
      wings.push(p);
    }
    return { body, wings };
  }

  function bakeAlien(kind, flapIdx) {
    const P = SKIN[kind];
    const big = kind === 'boss';
    const k = big ? K_BOSS : K_ALIEN;
    const size = Math.ceil(k * 3.2);
    const c = mkCanvas(size, size);
    if (!c) return null;
    const g = c.getContext('2d');
    g.translate(size / 2, size / 2);
    const flap = [0, 1, 0.5][flapIdx] || 0;
    const { body, wings } = alienPaths(k, flap);

    for (const w of wings) {
      const grad = g.createLinearGradient(0, -k, 0, k);
      grad.addColorStop(0, P.mid);
      grad.addColorStop(0.6, P.low);
      grad.addColorStop(1, '#000');
      glowPath(g, w, grad, P.glow, k * 0.5, P.glow, k * 0.045);
    }

    const bg = g.createLinearGradient(0, -k, 0, k);
    bg.addColorStop(0, P.low);
    bg.addColorStop(0.4, P.mid);
    bg.addColorStop(0.82, P.hot);
    bg.addColorStop(1, '#ffffff');
    glowPath(g, body, bg, P.hot, k * 0.6, P.glow, k * 0.05);

    // canopy
    g.globalCompositeOperation = 'lighter';
    const cp = g.createRadialGradient(0, -0.15 * k, 0, 0, -0.15 * k, 0.36 * k);
    cp.addColorStop(0, '#ffffff');
    cp.addColorStop(0.4, P.hot);
    cp.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = cp;
    g.beginPath();
    g.ellipse(0, -0.15 * k, 0.19 * k, 0.42 * k, 0, 0, TAU);
    g.fill();

    // core bloom
    const core = g.createRadialGradient(0, 0.1 * k, 0, 0, 0.1 * k, 0.62 * k);
    core.addColorStop(0, 'rgba(255,255,255,0.95)');
    core.addColorStop(0.3, P.hot);
    core.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = core;
    g.beginPath();
    g.arc(0, 0.1 * k, 0.62 * k, 0, TAU);
    g.fill();
    g.globalCompositeOperation = 'source-over';

    // antennae
    g.strokeStyle = P.hot;
    g.lineWidth = k * 0.06;
    g.lineCap = 'round';
    g.shadowBlur = k * 0.4; g.shadowColor = P.glow;
    g.beginPath();
    g.moveTo(-0.10 * k, -0.86 * k); g.lineTo(-0.30 * k, -1.34 * k);
    g.moveTo(0.10 * k, -0.86 * k); g.lineTo(0.30 * k, -1.34 * k);
    g.stroke();
    g.shadowBlur = 0;

    if (big) {                     // the flagship carries pods and a crown arc
      g.fillStyle = P.hot;
      g.shadowBlur = k * 0.45; g.shadowColor = P.glow;
      for (const side of [-1, 1]) {
        g.beginPath();
        g.ellipse(side * 0.56 * k, 0.14 * k, 0.12 * k, 0.32 * k, 0, 0, TAU);
        g.fill();
      }
      g.strokeStyle = '#fff7d0';
      g.lineWidth = k * 0.05;
      g.beginPath();
      g.arc(0, 0.05 * k, 0.86 * k, Math.PI * 1.15, Math.PI * 1.85);
      g.stroke();
      g.shadowBlur = 0;
    }
    return c;
  }

  function bakePlayer() {
    const k = K_SHIP;
    const size = Math.ceil(k * 3.0);
    const c = mkCanvas(size, size);
    if (!c) return null;
    const g = c.getContext('2d');
    g.translate(size / 2, size / 2);

    const p = new Path2D();
    p.moveTo(0, -1.15 * k);
    p.lineTo(0.16 * k, -0.44 * k);
    p.lineTo(0.40 * k, -0.10 * k);
    p.lineTo(0.80 * k, 0.20 * k);
    p.lineTo(1.02 * k, 0.66 * k);
    p.lineTo(0.50 * k, 0.46 * k);
    p.lineTo(0.32 * k, 0.92 * k);
    p.lineTo(-0.32 * k, 0.92 * k);
    p.lineTo(-0.50 * k, 0.46 * k);
    p.lineTo(-1.02 * k, 0.66 * k);
    p.lineTo(-0.80 * k, 0.20 * k);
    p.lineTo(-0.40 * k, -0.10 * k);
    p.lineTo(-0.16 * k, -0.44 * k);
    p.closePath();

    const grad = g.createLinearGradient(0, -k, 0, k);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.35, SHIP.hull);
    grad.addColorStop(0.75, '#6f9ec4');
    grad.addColorStop(1, SHIP.deep);
    glowPath(g, p, grad, SHIP.trim, k * 0.55, SHIP.glow, k * 0.05);

    // canopy
    const cp = g.createLinearGradient(0, -0.8 * k, 0, 0.1 * k);
    cp.addColorStop(0, '#ffffff');
    cp.addColorStop(0.6, SHIP.trim);
    cp.addColorStop(1, '#0d3a56');
    g.fillStyle = cp;
    g.shadowBlur = k * 0.4; g.shadowColor = SHIP.glow;
    g.beginPath();
    g.ellipse(0, -0.36 * k, 0.13 * k, 0.40 * k, 0, 0, TAU);
    g.fill();
    g.shadowBlur = 0;

    // wing strakes
    g.globalCompositeOperation = 'lighter';
    g.strokeStyle = 'rgba(120,240,255,0.75)';
    g.lineWidth = k * 0.04;
    for (const side of [-1, 1]) {
      g.beginPath();
      g.moveTo(side * 0.42 * k, 0.02 * k);
      g.lineTo(side * 0.88 * k, 0.42 * k);
      g.stroke();
    }
    for (const side of [-1, 1]) {
      const e = g.createRadialGradient(side * 0.17 * k, 0.86 * k, 0,
                                       side * 0.17 * k, 0.86 * k, 0.46 * k);
      e.addColorStop(0, '#ffffff');
      e.addColorStop(0.3, SHIP.trim);
      e.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = e;
      g.beginPath();
      g.arc(side * 0.17 * k, 0.86 * k, 0.46 * k, 0, TAU);
      g.fill();
    }
    return c;
  }

  // A power-up pod: a hexagonal capsule in the pickup's colour with its
  // letter burnt into the middle.
  function bakePod(def) {
    const k = K_POD;
    const size = Math.ceil(k * 3.2);
    const c = mkCanvas(size, size);
    if (!c) return null;
    const g = c.getContext('2d');
    g.translate(size / 2, size / 2);

    const hex = new Path2D();
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI / 2 + i * TAU / 6;
      const x = Math.cos(a) * k, y = Math.sin(a) * k;
      if (i) hex.lineTo(x, y); else hex.moveTo(x, y);
    }
    hex.closePath();

    const grad = g.createLinearGradient(0, -k, 0, k);
    grad.addColorStop(0, 'rgba(255,255,255,0.95)');
    grad.addColorStop(0.35, def.col);
    grad.addColorStop(1, 'rgba(8,12,30,0.9)');
    g.shadowBlur = k * 0.9; g.shadowColor = def.col;
    g.fillStyle = grad;
    g.fill(hex);
    g.shadowBlur = 0;
    g.strokeStyle = '#ffffff';
    g.lineWidth = k * 0.11;
    g.stroke(hex);

    g.font = `800 ${k * 1.15}px "Inter", system-ui, -apple-system, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#05070f';
    g.fillText(def.glyph, 0, k * 0.06);
    return c;
  }

  // The pod definitions live in the engine, so they arrive with the frame
  // rather than at bake time; cache the capsule the first time one is seen.
  function podFor(def) {
    if (!def) return null;
    if (!(def.key in pods)) pods[def.key] = bakePod(def);
    return pods[def.key];
  }

  function bakeDot() {
    const s = 128;
    const c = mkCanvas(s, s);
    if (!c) return null;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.2, 'rgba(255,255,255,0.72)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.20)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
    return c;
  }

  // A planet limb: lit from the upper right, with a terminator falling into
  // shadow and an atmospheric rim that reads even when it is mostly off-screen.
  function bakePlanet(size, base, rim, lit) {
    const c = mkCanvas(size, size);
    if (!c) return null;
    const g = c.getContext('2d');
    const r = size / 2;

    const body = g.createRadialGradient(r * 1.32, r * 0.62, r * 0.05,
                                        r, r, r);
    body.addColorStop(0, lit);
    body.addColorStop(0.35, base);
    body.addColorStop(0.72, 'rgba(6,8,20,0.96)');
    body.addColorStop(1, 'rgba(2,3,10,1)');
    g.fillStyle = body;
    g.beginPath();
    g.arc(r, r, r * 0.94, 0, TAU);
    g.fill();

    // banding
    g.save();
    g.globalCompositeOperation = 'overlay';
    g.beginPath();
    g.arc(r, r, r * 0.94, 0, TAU);
    g.clip();
    for (let i = 0; i < 22; i++) {
      const y = r * 0.1 + i * r * 0.085;
      g.globalAlpha = 0.05 + nrand() * 0.08;
      g.fillStyle = i & 1 ? '#ffffff' : '#000000';
      g.fillRect(0, y, size, r * (0.02 + nrand() * 0.05));
    }
    g.restore();

    // atmosphere
    g.globalCompositeOperation = 'lighter';
    const atm = g.createRadialGradient(r, r, r * 0.82, r, r, r);
    atm.addColorStop(0, 'rgba(0,0,0,0)');
    atm.addColorStop(0.78, rim);
    atm.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = atm;
    g.beginPath();
    g.arc(r, r, r, 0, TAU);
    g.fill();
    return c;
  }

  function bakeNebula(w, h) {
    const c = mkCanvas(w, h);
    if (!c) return null;
    const g = c.getContext('2d');
    g.globalCompositeOperation = 'lighter';
    const cols = ['rgba(96,26,190,0.50)', 'rgba(12,96,175,0.46)',
                  'rgba(180,24,110,0.32)', 'rgba(20,58,150,0.40)',
                  'rgba(60,180,190,0.22)'];
    for (let i = 0; i < 22; i++) {
      const px = nrand() * w, py = nrand() * h;
      const r = (0.10 + nrand() * 0.34) * w;
      const grad = g.createRadialGradient(px, py, 0, px, py, r);
      grad.addColorStop(0, pick(cols));
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(px, py, r, 0, TAU);
      g.fill();
    }
    return c;
  }

  // =======================================================================
  //  starfield and dust
  //
  //  Five layers across the whole window, not just the playfield -- the
  //  point of the landscape frame is that the sky keeps going past the rails.
  // =======================================================================
  function makeField() {
    stars.length = 0;
    const cfg = [[90, 0.16, 0.5, 0.30], [80, 0.34, 0.75, 0.45],
                 [60, 0.62, 1.0, 0.65], [34, 1.05, 1.4, 0.9],
                 [16, 1.75, 1.9, 1.0]];
    const cols = ['#ffffff', '#bcd8ff', '#ffd9c0', '#e0c0ff', '#c8fff0', '#fff0c0'];
    for (let l = 0; l < cfg.length; l++) {
      const [n, sp, sz, br] = cfg[l];
      for (let i = 0; i < n; i++) {
        stars.push({ l, fx: nrand(), fy: nrand(), r: sz * rnd(0.5, 1.15),
                     sp, br, c: pick(cols), ph: nrand() * TAU });
      }
    }
    dust.length = 0;
    for (let i = 0; i < 46; i++) {
      dust.push({ fx: nrand(), fy: nrand(), r: rnd(0.5, 2.2),
                  vx: rnd(-0.10, -0.02), vy: rnd(0.02, 0.14), a: rnd(0.05, 0.22) });
    }
  }

  function drawSky(g, scroll) {
    const grad = g.createLinearGradient(0, 0, VW * 0.35, VH);
    grad.addColorStop(0, '#03040c');
    grad.addColorStop(0.45, '#070a1e');
    grad.addColorStop(1, '#0d0620');
    g.fillStyle = grad;
    g.fillRect(0, 0, VW, VH);

    if (neb) {
      g.globalCompositeOperation = 'lighter';
      const d1 = (tick * 0.10) % VH;
      g.globalAlpha = 0.26;
      g.drawImage(neb, 0, d1 - VH, VW, VH);
      g.drawImage(neb, 0, d1, VW, VH);
      const d2 = (tick * 0.035) % VH;
      g.globalAlpha = 0.16;
      g.drawImage(neb, -VW * 0.15, d2 - VH, VW * 1.3, VH);
      g.drawImage(neb, -VW * 0.15, d2, VW * 1.3, VH);
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
    }

    // The planet is scenery, not the subject: it sits low and to the left,
    // dim enough that the swarm still reads against it.
    if (planet) {
      const pr = VH * 0.78;
      g.globalAlpha = 0.42;
      g.drawImage(planet, VW * 0.06 - pr, VH * 1.02 - pr * 0.5, pr * 2, pr * 2);
      g.globalAlpha = 1;
    }
    if (moon) {
      const mr = VH * 0.10;
      const drift = Math.sin(tick * 0.0015) * VH * 0.01;
      g.globalAlpha = 0.45;
      g.drawImage(moon, VW * 0.90 - mr, VH * 0.16 - mr + drift, mr * 2, mr * 2);
      g.globalAlpha = 1;
    }

    // stars, with the near layers stretched while the wave-clear warp runs
    g.globalCompositeOperation = 'lighter';
    const stretch = 1 + warp * 26;
    for (const s of stars) {
      let y = (s.fy * VH + scroll * s.sp * L.sc * 0.9) % VH;
      if (y < 0) y += VH;
      const tw = 0.62 + 0.38 * Math.sin(tick * 0.06 + s.ph);
      g.globalAlpha = s.br * tw;
      g.fillStyle = s.c;
      const r = s.r * u() * 1.2;
      const len = s.l >= 3 ? r * 3.4 * stretch : r * (1 + warp * 8);
      g.fillRect(s.fx * VW - r * 0.5, y - len * 0.5, Math.max(1, r), Math.max(1, len));
    }
    // slow foreground motes -- the thing that sells depth on a wide screen
    for (const d of dust) {
      d.fx += d.vx * 0.0006; d.fy += d.vy * 0.0006;
      if (d.fx < -0.05) d.fx = 1.05;
      if (d.fy > 1.05) d.fy = -0.05;
      g.globalAlpha = d.a * (0.6 + 0.4 * Math.sin(tick * 0.02 + d.fx * 40));
      g.fillStyle = '#cfe6ff';
      g.beginPath();
      g.arc(d.fx * VW, d.fy * VH, d.r * u(), 0, TAU);
      g.fill();
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  // =======================================================================
  //  the containment corridor
  // =======================================================================
  function drawCorridor(g) {
    const x0 = gx(0), x1 = gx(GW), y0 = gy(0), y1 = gy(GH);
    const w = x1 - x0, h = y1 - y0;

    // Interior wash.  This has to *darken*, not tint: the sky behind the
    // corridor is already near-black, so anything with colour in it makes the
    // playfield read as a pale rectangle pasted over the scene.  Black at
    // partial alpha sinks the lane instead, and the ships pop out of it.
    const inner = g.createLinearGradient(0, y0, 0, y1);
    inner.addColorStop(0, 'rgba(0,0,4,0.70)');
    inner.addColorStop(0.5, 'rgba(0,0,6,0.52)');
    inner.addColorStop(1, 'rgba(2,0,8,0.70)');
    g.fillStyle = inner;
    g.fillRect(x0, y0, w, h);

    // light spill inward from each rail -- narrow, or it lifts the whole lane
    g.globalCompositeOperation = 'lighter';
    const spill = gs(13);
    for (const [ex, dir] of [[x0, 1], [x1, -1]]) {
      const sp = g.createLinearGradient(ex, 0, ex + dir * spill, 0);
      sp.addColorStop(0, 'rgba(60,190,255,0.13)');
      sp.addColorStop(1, 'rgba(60,190,255,0)');
      g.fillStyle = sp;
      g.fillRect(Math.min(ex, ex + dir * spill), y0, spill, h);
    }
    g.globalCompositeOperation = 'source-over';

    // the rails themselves: a bright core with travelling scan segments
    const rw = Math.max(1.5, gs(0.9));
    const pulse = 0.55 + 0.45 * Math.sin(tick * 0.05) + railPulse;
    for (const ex of [x0, x1]) {
      g.globalCompositeOperation = 'lighter';
      g.fillStyle = `rgba(70,210,255,${Math.min(1, 0.35 + pulse * 0.3)})`;
      g.fillRect(ex - rw / 2, y0, rw, h);
      g.fillStyle = 'rgba(200,245,255,0.9)';
      g.fillRect(ex - rw * 0.18, y0, rw * 0.36, h);
      // scan segments running down the rail
      const seg = h / 9;
      for (let i = 0; i < 9; i++) {
        const sy = y0 + ((i * seg + (tick * 2.2) % seg + seg) % h);
        const grd = g.createLinearGradient(0, sy, 0, sy + seg * 0.5);
        grd.addColorStop(0, 'rgba(120,240,255,0)');
        grd.addColorStop(0.5, 'rgba(160,250,255,0.55)');
        grd.addColorStop(1, 'rgba(120,240,255,0)');
        g.fillStyle = grd;
        g.fillRect(ex - rw * 1.6, sy, rw * 3.2, Math.min(seg * 0.5, y1 - sy));
      }
      g.globalCompositeOperation = 'source-over';
    }

    // caps top and bottom
    g.globalCompositeOperation = 'lighter';
    for (const [yy, dir] of [[y0, 1], [y1, -1]]) {
      const cg = g.createLinearGradient(0, yy, 0, yy + dir * gs(8));
      cg.addColorStop(0, 'rgba(80,200,255,0.22)');
      cg.addColorStop(1, 'rgba(80,200,255,0)');
      g.fillStyle = cg;
      g.fillRect(x0, Math.min(yy, yy + dir * gs(8)), w, gs(8));
    }
    g.globalCompositeOperation = 'source-over';
    if (railPulse > 0) railPulse *= 0.88;
  }

  // =======================================================================
  //  particles
  // =======================================================================
  function spark(x, y, col, spd, life, size) {
    const a = nrand() * TAU;
    const v = rnd(spd * 0.2, spd);
    parts.push({ t: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
                 life, max: life, col, size });
  }

  function burst(x, y, col, hot, n, spd, big) {
    parts.push({ t: 'ring', x, y, r: 1, max: big ? 42 : 17, life: big ? 30 : 18,
                 lmax: big ? 30 : 18, col: hot, wob: big ? 0.22 : 0.1 });
    parts.push({ t: 'flash', x, y, r: big ? 17 : 7.5, life: 11, lmax: 11, col: hot });
    for (let i = 0; i < n; i++) {
      spark(x, y, nrand() < 0.4 ? hot : col, spd,
            rnd(14, big ? 54 : 32), rnd(0.5, big ? 1.7 : 1.1));
    }
    for (let i = 0; i < (big ? 20 : 8); i++) {
      const a = nrand() * TAU, v = rnd(0.35, spd * 0.85);
      parts.push({ t: 'shard', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
                   life: rnd(26, 64), max: 64, col, rot: nrand() * TAU,
                   spin: rnd(-0.3, 0.3), len: rnd(1.8, 4.6) });
    }
    // smoke lags behind the flash and is what makes the hit feel physical
    for (let i = 0; i < (big ? 14 : 5); i++) {
      const a = nrand() * TAU, v = rnd(0.1, spd * 0.30);
      parts.push({ t: 'smoke', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 0.05,
                   life: rnd(38, big ? 96 : 62), max: 96,
                   r: rnd(2.5, big ? 9 : 5), col });
    }
  }

  function updateParts() {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life--;
      if (p.life <= 0) { parts.splice(i, 1); continue; }
      if (p.t === 'spark' || p.t === 'shard' || p.t === 'smoke') {
        p.x += p.vx; p.y += p.vy;
        p.vx *= p.t === 'smoke' ? 0.965 : 0.94;
        p.vy *= p.t === 'smoke' ? 0.965 : 0.94;
        p.vy += p.t === 'smoke' ? -0.004 : 0.012;
        if (p.t === 'shard') p.rot += p.spin;
        if (p.t === 'smoke') p.r += 0.09;
      } else if (p.t === 'ring') {
        p.r += (p.max - p.r) * 0.15;
      }
    }
    if (parts.length > 900) parts.splice(0, parts.length - 900);
  }

  function drawParts(g) {
    const sc = L.sc;
    // smoke sits under the additive layers, darkening rather than adding
    g.globalCompositeOperation = 'source-over';
    for (const p of parts) {
      if (p.t !== 'smoke') continue;
      const k = p.life / p.max;
      g.globalAlpha = k * k * 0.30;
      g.fillStyle = p.col;
      const r = p.r * sc * (1.5 - k * 0.5);
      g.drawImage(dot, gx(p.x) - r, gy(p.y) - r, r * 2, r * 2);
    }
    g.globalCompositeOperation = 'lighter';
    for (const p of parts) {
      const k = p.life / (p.lmax || p.max);
      if (p.t === 'spark') {
        const s = p.size * sc * (0.35 + k * 0.95);
        g.globalAlpha = Math.min(1, k * 1.3) * 0.9;
        g.fillStyle = p.col;
        g.beginPath();
        g.arc(gx(p.x), gy(p.y), Math.max(0.7, s * 0.5), 0, TAU);
        g.fill();
      } else if (p.t === 'flash') {
        const s = p.r * sc * (1.6 - k * 0.6);
        g.globalAlpha = k * k * 0.85;
        g.drawImage(dot, gx(p.x) - s, gy(p.y) - s, s * 2, s * 2);
      } else if (p.t === 'ring') {
        g.globalAlpha = k * k * 0.6;
        g.strokeStyle = p.col;
        g.lineWidth = Math.max(1, 1.9 * sc * k);
        g.beginPath();
        // slightly elliptical, so the blast reads as a wave not a circle
        g.ellipse(gx(p.x), gy(p.y), p.r * sc, p.r * sc * (1 - p.wob), 0, 0, TAU);
        g.stroke();
      } else if (p.t === 'shard') {
        g.globalAlpha = k;
        g.strokeStyle = p.col;
        g.lineWidth = Math.max(0.8, 1.7 * sc * k);
        g.save();
        g.translate(gx(p.x), gy(p.y));
        g.rotate(p.rot);
        g.beginPath();
        g.moveTo(-p.len * sc, 0);
        g.lineTo(p.len * sc, 0);
        g.stroke();
        g.restore();
      }
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  // =======================================================================
  //  entities
  // =======================================================================
  function pushTrails(aliens) {
    for (const a of aliens) {
      if (!a.alive || a.state === 'form') { trails.delete(a); continue; }
      let t = trails.get(a);
      if (!t) { t = []; trails.set(a, t); }
      t.push(a.x, a.y);
      if (t.length > 84) t.splice(0, t.length - 84);
    }
  }

  function drawTrails(g, aliens) {
    g.globalCompositeOperation = 'lighter';
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const a of aliens) {
      const t = trails.get(a);
      if (!t || t.length < 6) continue;
      const P = SKIN[a.kind];
      const n = t.length / 2;
      // two passes: a wide soft ribbon, then a bright filament inside it
      for (const [wmul, amul, col] of [[1, 0.34, P.glow], [0.34, 0.5, P.hot]]) {
        for (let i = 1; i < n; i++) {
          const k = i / n;
          g.globalAlpha = k * k * amul;
          g.strokeStyle = col;
          g.lineWidth = Math.max(0.5,
            k * (a.kind === 'boss' ? 6.5 : 4.2) * L.sc * 0.55 * wmul);
          g.beginPath();
          g.moveTo(gx(t[(i - 1) * 2]), gy(t[(i - 1) * 2 + 1]));
          g.lineTo(gx(t[i * 2]), gy(t[i * 2 + 1]));
          g.stroke();
        }
      }
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  function facingOf(a) {
    const want = -a.face * (Math.PI / 12);
    let cur = angles.get(a);
    if (cur === undefined) cur = want;
    let d = want - cur;
    while (d > Math.PI) d -= TAU;
    while (d < -Math.PI) d += TAU;
    cur += d * 0.3;
    angles.set(a, cur);
    return cur;
  }

  function drawAliens(g, aliens) {
    const s = L.sc / REF;
    for (const a of aliens) {
      if (!a.alive) continue;
      const set = art[a.kind];
      if (!set || !set[0]) continue;
      const frame = set[(tick >> (a.state === 'form' ? 3 : 2)) % 3];
      if (!frame) continue;
      const ang = a.state === 'form'
        ? Math.sin(tick * 0.04 + a.col * 0.7) * 0.06 : facingOf(a);
      const bob = a.state === 'form'
        ? Math.sin(tick * 0.05 + a.col * 0.8 + a.row) * 0.7 : 0;
      g.save();
      g.translate(gx(a.x), gy(a.y + bob));
      g.rotate(ang);
      g.scale(s, s);
      g.drawImage(frame, -frame.width / 2, -frame.height / 2);
      g.restore();

      // ARMOUR: plated aliens carry a hex shell, which flares white on the
      // hit that does not kill them.  Without this the shot reads as a miss.
      if (a.hp > 1 || a.flash > 0) {
        const r = gs(8.5);
        g.save();
        g.globalCompositeOperation = 'lighter';
        g.translate(gx(a.x), gy(a.y + bob));
        g.rotate(tick * 0.02 + a.col);
        const hit = a.flash > 0 ? a.flash / 9 : 0;
        g.globalAlpha = 0.10 + 0.06 * Math.sin(tick * 0.08 + a.col) + hit * 0.8;
        g.strokeStyle = hit > 0 ? '#ffffff' : SKIN[a.kind].hot;
        g.lineWidth = Math.max(1, gs(0.55) * (1 + hit * 2));
        g.beginPath();
        for (let i = 0; i <= 6; i++) {
          const t = i * TAU / 6;
          const xx = Math.cos(t) * r, yy = Math.sin(t) * r * 0.86;
          if (i) g.lineTo(xx, yy); else g.moveTo(xx, yy);
        }
        g.stroke();
        g.restore();
        g.globalAlpha = 1;
        g.globalCompositeOperation = 'source-over';
      }
    }
  }

  function drawPlayer(g, api) {
    if (!api.shipVisible || !art.ship) return;
    const X = api.x;
    // blink out of the mercy frames, but never so much that you lose the ship
    if (X && X.inv > 0 && ((tick >> 1) & 1) && X.inv > 12) {
      // still draw, just dimmer -- vanishing entirely reads as a dropped frame
      g.globalAlpha = 0.45;
    }
    const px = api.px, py = api.py;
    if (lastPx === null) lastPx = px;
    const lean = Math.max(-0.26, Math.min(0.26, (px - lastPx) * 0.18));
    lastPx = px;

    g.save();
    g.translate(gx(px), gy(py));
    g.rotate(lean);
    g.globalCompositeOperation = 'lighter';
    const f = 1 + Math.sin(tick * 0.7) * 0.24;
    for (const side of [-1, 1]) {
      const ex = side * gs(4.2), ey = gs(6.5);
      const len = gs(10) * f;
      const grad = g.createLinearGradient(ex, ey, ex, ey + len);
      grad.addColorStop(0, 'rgba(255,255,255,0.95)');
      grad.addColorStop(0.28, 'rgba(90,225,255,0.72)');
      grad.addColorStop(1, 'rgba(40,90,255,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(ex - gs(2.2), ey);
      g.lineTo(ex + gs(2.2), ey);
      g.lineTo(ex, ey + len);
      g.closePath();
      g.fill();
    }
    g.globalCompositeOperation = 'source-over';
    const s = L.sc / REF;
    g.scale(s, s);
    g.drawImage(art.ship, -art.ship.width / 2, -art.ship.height / 2);
    g.restore();
    g.globalAlpha = 1;

    // shield bubble: a faceted ring that brightens as charges stack
    if (X && X.shield > 0) {
      const r = gs(13 + X.shield * 1.6);
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.translate(gx(px), gy(py));
      g.rotate(tick * 0.012);
      for (let ring = 0; ring < X.shield; ring++) {
        g.globalAlpha = 0.20 + 0.16 * Math.sin(tick * 0.09 + ring);
        g.strokeStyle = UI.good;
        g.lineWidth = Math.max(1, gs(0.7));
        g.beginPath();
        for (let i = 0; i <= 8; i++) {
          const a = i * TAU / 8;
          const rr = r + ring * gs(2.4);
          const x = Math.cos(a) * rr, y = Math.sin(a) * rr * 0.92;
          if (i) g.lineTo(x, y); else g.moveTo(x, y);
        }
        g.stroke();
      }
      g.restore();
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
    }
  }

  function bolt(g, x, y, len, w, c1, c2) {
    g.globalCompositeOperation = 'lighter';
    const grad = g.createLinearGradient(0, gy(y - len), 0, gy(y + len));
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.5, c1);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(gx(x - w), gy(y - len), gs(w * 2), gs(len * 2));
    const s = gs(w * 2.6);
    g.drawImage(dot, gx(x) - s, gy(y) - s, s * 2, s * 2);
    g.fillStyle = c2;
    g.fillRect(gx(x - w * 0.32), gy(y - len * 0.5), gs(w * 0.64), gs(len));
    g.globalCompositeOperation = 'source-over';
  }

  function drawDrops(g, X) {
    if (!X) return;
    const s = L.sc / REF;
    const defOf = k => {
      for (const p of X.powerups) if (p.key === k) return p;
      return null;
    };
    for (const d of X.drops) {
      const c = podFor(defOf(d.kind));
      if (!c) continue;
      const wob = Math.sin(d.t * 0.11) * gs(1.6);
      g.save();
      g.globalCompositeOperation = 'lighter';
      const hal = gs(9 + Math.sin(d.t * 0.15) * 1.4);
      g.globalAlpha = 0.5;
      g.drawImage(dot, gx(d.x) + wob - hal, gy(d.y) - hal, hal * 2, hal * 2);
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
      g.translate(gx(d.x) + wob, gy(d.y));
      g.rotate(Math.sin(d.t * 0.045) * 0.5);
      g.scale(s, s);
      g.drawImage(c, -c.width / 2, -c.height / 2);
      g.restore();
    }
  }

  // =======================================================================
  //  text and panels
  // =======================================================================
  function font(g, px, weight) {
    g.font = `${weight || 700} ${Math.max(1, px)}px "Inter", system-ui, `
           + `-apple-system, "Segoe UI", Roboto, sans-serif`;
  }

  function txt(g, s, x, y, px, col, align, glow, weight, track) {
    font(g, px, weight);
    g.textAlign = align || 'left';
    g.textBaseline = 'alphabetic';
    if (track !== undefined) { try { g.letterSpacing = track * px + 'px'; } catch (e) {} }
    if (glow) { g.shadowBlur = px * 0.85; g.shadowColor = glow; }
    g.fillStyle = col;
    g.fillText(s, x, y);
    g.shadowBlur = 0;
    try { g.letterSpacing = '0px'; } catch (e) {}
  }

  // A chamfered cockpit panel -- corners cut rather than rounded, which is
  // what makes it read as a machined bezel instead of a web card.
  function panelPath(g, x, y, w, h, cut) {
    const p = new Path2D();
    p.moveTo(x + cut, y);
    p.lineTo(x + w - cut, y);
    p.lineTo(x + w, y + cut);
    p.lineTo(x + w, y + h - cut);
    p.lineTo(x + w - cut, y + h);
    p.lineTo(x + cut, y + h);
    p.lineTo(x, y + h - cut);
    p.lineTo(x, y + cut);
    p.closePath();
    return p;
  }

  function panel(g, x, y, w, h, tint) {
    const cut = Math.min(w, h) * 0.10;
    const p = panelPath(g, x, y, w, h, cut);
    const grad = g.createLinearGradient(x, y, x + w * 0.4, y + h);
    grad.addColorStop(0, 'rgba(14,26,58,0.72)');
    grad.addColorStop(0.5, 'rgba(8,14,36,0.60)');
    grad.addColorStop(1, 'rgba(10,8,32,0.72)');
    g.fillStyle = grad;
    g.fill(p);
    g.strokeStyle = tint || 'rgba(80,205,255,0.45)';
    g.lineWidth = Math.max(1, u() * 1.4);
    g.stroke(p);
    // inner hairline
    const q = panelPath(g, x + u() * 4, y + u() * 4, w - u() * 8, h - u() * 8,
                        cut * 0.8);
    g.strokeStyle = 'rgba(120,220,255,0.14)';
    g.lineWidth = Math.max(1, u());
    g.stroke(q);
    return p;
  }

  function meter(g, x, y, w, h, k, col, bg) {
    g.fillStyle = bg || 'rgba(120,170,220,0.16)';
    g.fillRect(x, y, w, h);
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = col;
    g.fillRect(x, y, w * Math.max(0, Math.min(1, k)), h);
    g.globalCompositeOperation = 'source-over';
    g.strokeStyle = 'rgba(160,215,255,0.30)';
    g.lineWidth = 1;
    g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }

  function pips(g, x, y, n, filled, r, col) {
    for (let i = 0; i < n; i++) {
      const cxp = x + i * r * 2.7;
      g.beginPath();
      g.arc(cxp, y, r, 0, TAU);
      if (i < filled) {
        g.globalCompositeOperation = 'lighter';
        g.fillStyle = col;
        g.fill();
        g.globalCompositeOperation = 'source-over';
      } else {
        g.strokeStyle = 'rgba(150,195,235,0.35)';
        g.lineWidth = Math.max(1, r * 0.28);
        g.stroke();
      }
    }
  }

  function shipGlyph(g, x, y, size, alpha) {
    if (!art.ship) return;
    g.save();
    g.globalAlpha = alpha === undefined ? 1 : alpha;
    g.translate(x, y);
    const s = size / art.ship.width;
    g.scale(s, s);
    g.drawImage(art.ship, -art.ship.width / 2, -art.ship.height / 2);
    g.restore();
  }

  // =======================================================================
  //  the cockpit HUD
  // =======================================================================
  function drawWings(g, api) {
    const X = api.x;
    const U = u();
    const pw = L.panel, ph = L.h * 0.86;
    const py = L.y + (L.h - ph) / 2;
    const lx = L.x - L.gut - L.pad - pw;
    const rx = L.x + L.w + L.gut + L.pad;
    if (!L.wide) { drawCompactHud(g, api); return; }

    // ---- left: pilot ----
    panel(g, lx, py, pw, ph, 'rgba(80,205,255,0.45)');
    let y = py + U * 40;
    const px0 = lx + U * 22;
    const pw0 = pw - U * 44;

    txt(g, '1UP', px0, y, U * 15, UI.cyan, 'left', null, 800, 0.16);
    txt(g, String(api.p0).padStart(7, '0'), px0 + pw0, y, U * 26, '#ffffff',
        'right', UI.cyan, 800);
    y += U * 30;
    txt(g, 'HIGH', px0, y, U * 13, UI.hot, 'left', null, 800, 0.16);
    txt(g, String(api.hi).padStart(7, '0'), px0 + pw0, y, U * 19, '#ffe9fb',
        'right', UI.hot, 700);
    if (api.two) {
      y += U * 26;
      txt(g, '2UP', px0, y, U * 13, UI.cyan, 'left', null, 800, 0.16);
      txt(g, String(api.p1).padStart(7, '0'), px0 + pw0, y, U * 19, '#ffffff',
          'right', null, 700);
    }

    y += U * 34;
    txt(g, 'SHIPS', px0, y, U * 12, UI.dim, 'left', null, 700, 0.2);
    y += U * 20;
    const nl = Math.min(6, Math.max(0, api.lives - 1));
    for (let i = 0; i < nl; i++) shipGlyph(g, px0 + U * 13 + i * U * 26, y, U * 24, 0.95);

    y += U * 34;
    txt(g, 'WEAPON', px0, y, U * 12, UI.dim, 'left', null, 700, 0.2);
    y += U * 14;
    const tiers = X ? X.maxWeapon : 3;
    const seg = pw0 / tiers;
    for (let i = 0; i < tiers; i++) {
      const on = X && i <= X.weapon;
      g.fillStyle = on ? 'rgba(79,230,255,0.85)' : 'rgba(120,170,220,0.15)';
      if (on) { g.shadowBlur = U * 10; g.shadowColor = UI.cyan; }
      g.fillRect(px0 + i * seg + U * 2, y, seg - U * 5, U * 9);
      g.shadowBlur = 0;
    }
    y += U * 24;
    txt(g, ['SINGLE', 'TWIN', 'TRIPLE'][X ? Math.min(2, X.weapon) : 0],
        px0, y, U * 15, '#ffffff', 'left', UI.cyan, 800, 0.1);

    y += U * 30;
    txt(g, 'SHIELD', px0, y, U * 12, UI.dim, 'left', null, 700, 0.2);
    pips(g, px0 + U * 66, y - U * 4, X ? X.shieldMax : 2, X ? X.shield : 0,
         U * 6, UI.good);

    // timed pickups, only while they are running
    y += U * 30;
    if (X && X.rapid > 0) {
      txt(g, 'RAPID', px0, y, U * 12, UI.gold, 'left', null, 800, 0.16);
      meter(g, px0 + U * 62, y - U * 9, pw0 - U * 62, U * 10,
            X.rapid / X.rapidMax, 'rgba(255,210,74,0.9)');
      y += U * 24;
    }
    if (X && X.dbl > 0) {
      txt(g, 'x2', px0, y, U * 12, UI.hot, 'left', null, 800, 0.16);
      meter(g, px0 + U * 62, y - U * 9, pw0 - U * 62, U * 10,
            X.dbl / X.dblMax, 'rgba(255,92,192,0.9)');
      y += U * 24;
    }

    // The hold, at the foot of the panel: three slots, the selected one lit.
    // This is the screen's most important widget -- spending a pod arms the
    // swarm too, so the choice of which one wants to be visible at a glance.
    if (X) {
      const holdY = py + ph - U * 132;
      txt(g, 'HOLD', px0, holdY, U * 13, UI.dim, 'left', null, 700, 0.2);
      txt(g, X.cycleKey + '  CYCLE', px0 + pw0, holdY, U * 12, UI.ink, 'right',
          null, 800, 0.1);

      const slotW = (pw0 - U * 16) / X.holdMax;
      const slotH = U * 52;
      for (let i = 0; i < X.holdMax; i++) {
        const sx0 = px0 + i * (slotW + U * 8);
        const def = X.holdDefs[i];
        const on = def && i === X.holdSel;
        const p = panelPath(g, sx0, holdY + U * 12, slotW, slotH, slotW * 0.16);
        g.fillStyle = def ? 'rgba(20,40,80,0.6)' : 'rgba(10,16,34,0.45)';
        g.fill(p);
        g.strokeStyle = on ? 'rgba(140,240,255,0.95)'
                     : def ? 'rgba(90,160,215,0.5)' : 'rgba(70,100,140,0.3)';
        g.lineWidth = Math.max(1, U * (on ? 2 : 1));
        if (on) { g.shadowBlur = U * 16; g.shadowColor = UI.cyan; }
        g.stroke(p);
        g.shadowBlur = 0;
        if (def) {
          const pod = podFor(def);
          if (pod) {
            g.save();
            g.translate(sx0 + slotW / 2, holdY + U * 12 + slotH * 0.40);
            const ps = U * 26 / pod.width;
            g.scale(ps, ps);
            g.drawImage(pod, -pod.width / 2, -pod.height / 2);
            g.restore();
          }
          txt(g, def.name, sx0 + slotW / 2, holdY + U * 12 + slotH - U * 8,
              U * 9, on ? '#ffffff' : 'rgba(160,195,235,0.6)', 'center',
              on ? def.col : null, 800, 0.04);
        } else {
          txt(g, '-', sx0 + slotW / 2, holdY + U * 12 + slotH * 0.62, U * 16,
              'rgba(120,160,200,0.35)', 'center', null, 700);
        }
      }

      // The spend prompt.  Cycling is discoverable because the highlight moves
      // when you press C; spending is not discoverable at all unless the key
      // is stated outright, so it gets a pulsing badge whenever the hold has
      // something in it.
      const promptY = holdY + U * 12 + slotH + U * 26;
      if (X.hold.length) {
        const pulse = 0.62 + 0.38 * Math.sin(tick * 0.11);
        const bw = U * 34, bh = U * 24;
        const bx = px0, by = promptY - bh + U * 6;
        const p = panelPath(g, bx, by, bw, bh, U * 6);
        g.globalAlpha = pulse;
        g.fillStyle = 'rgba(79,230,255,0.22)';
        g.fill(p);
        g.strokeStyle = UI.cyan;
        g.lineWidth = Math.max(1, U * 1.6);
        g.shadowBlur = U * 14; g.shadowColor = UI.cyan;
        g.stroke(p);
        g.shadowBlur = 0;
        txt(g, X.useKey, bx + bw / 2, by + bh - U * 6,
            U * (X.useKey.length > 2 ? 11 : 16), '#ffffff', 'center',
            UI.cyan, 900);
        txt(g, 'USE ' + (X.holdDefs[X.holdSel] ? X.holdDefs[X.holdSel].name : ''),
            bx + bw + U * 10, promptY, U * 14, '#ffffff', 'left', UI.cyan,
            800, 0.1);
        g.globalAlpha = 1;
      } else {
        txt(g, 'SHOOT ALIENS TO DROP PODS', px0, promptY, U * 11,
            'rgba(150,185,230,0.5)', 'left', null, 700, 0.1);
      }
      txt(g, 'SPENDING A POD ARMS THE SWARM', px0, py + ph - U * 24, U * 10,
          'rgba(255,140,180,0.75)', 'left', null, 700, 0.1);
    }

    // ---- right: mission ----
    panel(g, rx, py, pw, ph, 'rgba(255,92,192,0.35)');
    let ry = py + U * 40;
    const rx0 = rx + U * 22;
    const rw0 = pw - U * 44;

    txt(g, 'WAVE', rx0, ry, U * 13, UI.dim, 'left', null, 700, 0.2);
    txt(g, String(api.stage).padStart(2, '0'), rx0 + rw0, ry, U * 30, UI.gold,
        'right', '#ff9a2a', 800);
    ry += U * 30;
    txt(g, 'SKILL', rx0, ry, U * 13, UI.dim, 'left', null, 700, 0.2);
    txt(g, X ? X.skillName : '', rx0 + rw0, ry, U * 17, '#ffffff', 'right',
        UI.cyan, 800, 0.08);

    ry += U * 36;
    txt(g, 'SWARM', rx0, ry, U * 12, UI.dim, 'left', null, 700, 0.2);
    ry += U * 12;
    const left = X ? X.alive : 0, total = X ? X.total : 46;
    meter(g, rx0, ry, rw0, U * 12, left / total, 'rgba(255,92,120,0.85)');
    ry += U * 24;
    txt(g, left + ' / ' + total, rx0 + rw0, ry, U * 13, UI.ink, 'right', null, 700);

    ry += U * 32;
    txt(g, 'COMBO', rx0, ry, U * 12, UI.dim, 'left', null, 700, 0.2);
    const cm = X ? X.comboMul : 1;
    txt(g, 'x' + cm, rx0 + rw0, ry + U * 4, U * 26,
        cm > 1 ? UI.good : 'rgba(150,195,235,0.5)', 'right',
        cm > 1 ? UI.good : null, 800);
    ry += U * 14;
    meter(g, rx0, ry, rw0 * 0.62, U * 8,
          X && X.comboT ? X.comboT / X.comboHold : 0, 'rgba(125,255,196,0.85)');

    // how much of the swarm is in the air right now, which is the number that
    // actually decides whether you are about to die
    ry += U * 34;
    txt(g, 'IN THE AIR', rx0, ry, U * 12, UI.dim, 'left', null, 700, 0.2);
    const air = X ? X.diving : 0;
    txt(g, String(air), rx0 + rw0, ry + U * 2, U * 22,
        air > 3 ? '#ff6a8a' : air > 0 ? UI.gold : 'rgba(150,195,235,0.5)',
        'right', air > 3 ? '#ff2a5a' : null, 800);
    ry += U * 12;
    meter(g, rx0, ry, rw0, U * 8, Math.min(1, air / 6),
          air > 3 ? 'rgba(255,106,138,0.9)' : 'rgba(255,207,74,0.8)');

    ry += U * 40;
    txt(g, 'TRACK', rx0, ry, U * 12, UI.dim, 'left', null, 700, 0.2);
    ry += U * 20;
    txt(g, X ? X.track : '', rx0, ry, U * 15, UI.cyan, 'left', '#2aa8d8', 800, 0.06);
    ry += U * 16;
    // a little analyser, driven by the tick rather than the actual signal
    const bars = 16, bw = rw0 / bars;
    for (let i = 0; i < bars; i++) {
      const h = (0.25 + 0.75 * Math.abs(Math.sin(tick * 0.07 + i * 0.9)
                                        * Math.cos(tick * 0.023 + i))) * U * 26;
      g.globalCompositeOperation = 'lighter';
      g.fillStyle = i < bars * 0.6 ? 'rgba(79,230,255,0.75)' : 'rgba(255,92,192,0.7)';
      g.fillRect(rx0 + i * bw, ry + U * 26 - h, bw - U * 2, h);
      g.globalCompositeOperation = 'source-over';
    }

    // What the swarm has been given in exchange for the pods you spent.
    // It is the mirror of the HOLD panel opposite, deliberately: the two
    // readouts are the same bargain seen from each side.
    if (X) {
      const eu = X.enemyUpgrades;
      const eupY = py + ph - U * 42 - eu.length * U * 24;
      const total = eu.reduce((n, e) => n + (X.eup[e.key] | 0), 0);
      txt(g, 'SWARM UPGRADES', rx0, eupY - U * 16, U * 12,
          total ? '#ff8ab0' : UI.dim, 'left', null, 700, 0.2);
      if (total) {
        txt(g, String(total), rx0 + rw0, eupY - U * 16, U * 14, '#ff6a8a',
            'right', '#ff2a5a', 800);
      }
      let ey = eupY;
      for (const e of eu) {
        const lvl = X.eup[e.key] | 0;
        txt(g, e.name, rx0, ey, U * 11,
            lvl ? '#ffffff' : 'rgba(150,185,230,0.38)', 'left',
            lvl ? '#ff5c7a' : null, 700, 0.1);
        txt(g, e.note, rx0 + U * 74, ey, U * 9,
            lvl ? 'rgba(255,150,180,0.75)' : 'rgba(140,175,215,0.28)',
            'left', null, 600, 0.06);
        for (let i = 0; i < e.max; i++) {
          const bx = rx0 + rw0 - (e.max - i) * U * 9;
          g.fillStyle = i < lvl ? 'rgba(255,92,120,0.95)'
                                : 'rgba(140,175,215,0.18)';
          if (i < lvl) { g.shadowBlur = U * 7; g.shadowColor = '#ff2a5a'; }
          g.fillRect(bx, ey - U * 8, U * 6, U * 9);
          g.shadowBlur = 0;
        }
        ey += U * 24;
      }
    }
    txt(g, X ? (X.pauseKey + ' PAUSE   ' + X.muteKey + ' SOUND   '
                + X.versionKey + ' VERSION') : '',
        rx0, py + ph - U * 18, U * 10, UI.dim, 'left', null, 600, 0.08);
  }

  // Narrow windows: no room for wings, so the same numbers go in slim strips.
  function drawCompactHud(g, api) {
    const X = api.x, U = u();
    const barH = U * 34;
    g.fillStyle = 'rgba(6,10,26,0.72)';
    g.fillRect(0, 0, VW, barH);
    g.fillRect(0, VH - barH, VW, barH);
    txt(g, '1UP ' + String(api.p0).padStart(7, '0'), U * 16, barH * 0.68,
        U * 17, '#ffffff', 'left', UI.cyan, 800);
    txt(g, 'HIGH ' + String(api.hi).padStart(7, '0'), VW / 2, barH * 0.68,
        U * 15, '#ffe9fb', 'center', UI.hot, 700);
    txt(g, 'WAVE ' + api.stage, VW - U * 16, barH * 0.68, U * 17, UI.gold,
        'right', '#ff9a2a', 800);
    const y = VH - barH * 0.34;
    for (let i = 0; i < Math.min(6, Math.max(0, api.lives - 1)); i++) {
      shipGlyph(g, U * 22 + i * U * 24, y - U * 4, U * 22, 0.95);
    }
    if (X) {
      const held = X.holdDefs.map((d, i) =>
        (i === X.holdSel ? '[' + d.name + ']' : d.name)).join(' ');
      txt(g, ['SINGLE', 'TWIN', 'TRIPLE'][Math.min(2, X.weapon)]
            + (X.shield ? '  SHIELD ' + X.shield : '')
            + (X.rapid > 0 ? '  RAPID' : '') + (X.dbl > 0 ? '  x2' : '')
            + (held ? '   HOLD ' + held
                      + '  (' + X.cycleKey + ' CYCLE / ' + X.useKey + ' USE)' : ''),
          VW / 2, y, U * 13, UI.cyan, 'center', null, 700, 0.06);
      const ups = X.enemyUpgrades.reduce((n, e) => n + (X.eup[e.key] | 0), 0);
      txt(g, X.skillName + '   x' + X.comboMul
            + (ups ? '   SWARM +' + ups : ''),
          VW - U * 16, y, U * 13, ups ? '#ff8ab0' : UI.good, 'right', null,
          700, 0.06);
    }
  }

  // =======================================================================
  //  full-screen states
  // =======================================================================
  // GALAXIAN set in a gradient with an oversized X alongside.  The two pieces
  // are measured and laid out rather than nudged by eye, because the font is
  // whatever the system supplies and its widths are not knowable in advance.
  function wordmark(g, cxp, cy, size) {
    const gap = size * 0.30;
    const xSize = size * 1.55;
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';

    font(g, size, 900);
    try { g.letterSpacing = size * 0.05 + 'px'; } catch (e) {}
    const wName = g.measureText('GALAXIAN').width;
    try { g.letterSpacing = '0px'; } catch (e) {}
    font(g, xSize, 900);
    const wX = g.measureText('X').width;

    const total = wName + gap + wX;
    const left = cxp - total / 2;

    const grad = g.createLinearGradient(0, cy - size, 0, cy + size * 0.35);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.4, '#6fe4ff');
    grad.addColorStop(0.72, '#c45cff');
    grad.addColorStop(1, '#ff3f9a');
    font(g, size, 900);
    try { g.letterSpacing = size * 0.05 + 'px'; } catch (e) {}
    g.shadowBlur = size * 0.6; g.shadowColor = '#4bd2ff';
    g.fillStyle = grad;
    g.fillText('GALAXIAN', left, cy);
    g.shadowBlur = 0;
    try { g.letterSpacing = '0px'; } catch (e) {}

    font(g, xSize, 900);
    g.shadowBlur = size * 0.9; g.shadowColor = '#ff3f9a';
    g.fillStyle = '#ffffff';
    g.fillText('X', left + wName + gap, cy + size * 0.10);
    g.shadowBlur = 0;
    g.textAlign = 'left';
  }

  function scrim(g, k) {
    g.fillStyle = `rgba(2,4,12,${k})`;
    g.fillRect(0, 0, VW, VH);
  }

  function drawSelect(g, api) {
    const X = api.x, U = u();
    scrim(g, 0.55);
    wordmark(g, VW / 2, VH * 0.24, U * 54);
    txt(g, 'SELECT VERSION', VW / 2, VH * 0.32, U * 16, UI.ink, 'center',
        null, 700, 0.4);

    const vs = X ? X.versions : [];
    const rowH = U * 62;
    const top = VH * 0.40;
    for (let i = 0; i < vs.length; i++) {
      const y = top + i * rowH;
      const on = i === (X ? X.selIdx : 0);
      const w = Math.min(VW * 0.5, U * 620), x = (VW - w) / 2;
      if (on) {
        const p = panelPath(g, x, y - U * 22, w, U * 50, U * 12);
        const grd = g.createLinearGradient(x, 0, x + w, 0);
        grd.addColorStop(0, 'rgba(60,200,255,0.02)');
        grd.addColorStop(0.5, 'rgba(60,200,255,0.20)');
        grd.addColorStop(1, 'rgba(255,92,192,0.10)');
        g.fillStyle = grd;
        g.fill(p);
        g.strokeStyle = 'rgba(120,230,255,0.65)';
        g.lineWidth = Math.max(1, U * 1.5);
        g.stroke(p);
      }
      txt(g, vs[i].name + ' ' + vs[i].year, x + U * 26, y + U * 6, U * 26,
          on ? '#ffffff' : 'rgba(170,200,240,0.55)', 'left',
          on ? UI.cyan : null, 800, 0.06);
      txt(g, vs[i].note, x + w - U * 26, y + U * 5, U * 14,
          on ? UI.cyan : 'rgba(140,170,210,0.4)', 'right', null, 700, 0.14);
    }
    txt(g, 'ARROWS TO CHANGE     ENTER TO CONFIRM', VW / 2, VH * 0.90, U * 15,
        'rgba(190,215,255,0.8)', 'center', null, 700, 0.18);
    txt(g, 'K   KEY BINDINGS', VW / 2, VH * 0.955, U * 14, UI.cyan, 'center',
        null, 700, 0.22);
  }

  function drawSkill(g, api) {
    const X = api.x, U = u();
    scrim(g, 0.62);
    txt(g, 'SELECT SKILL', VW / 2, VH * 0.20, U * 44, '#ffffff', 'center',
        UI.cyan, 900, 0.16);
    txt(g, 'HARDER TIERS SCORE MORE', VW / 2, VH * 0.26, U * 15, UI.ink,
        'center', null, 700, 0.24);

    const list = X ? X.skills : [];
    const n = Math.max(1, list.length);
    const gapW = U * 18;
    const cardW = Math.min(U * 250, (VW * 0.82 - gapW * (n - 1)) / n);
    const cardH = U * 250;
    const total = cardW * n + gapW * (n - 1);
    const x0 = (VW - total) / 2, y0 = VH * 0.32;

    for (let i = 0; i < n; i++) {
      const k = list[i];
      const x = x0 + i * (cardW + gapW);
      const on = i === X.skill;
      const p = panelPath(g, x, y0, cardW, cardH, cardW * 0.09);
      const grd = g.createLinearGradient(x, y0, x, y0 + cardH);
      grd.addColorStop(0, on ? 'rgba(40,110,190,0.55)' : 'rgba(12,20,44,0.6)');
      grd.addColorStop(1, on ? 'rgba(120,30,140,0.45)' : 'rgba(8,12,30,0.6)');
      g.fillStyle = grd;
      g.fill(p);
      g.strokeStyle = on ? 'rgba(140,240,255,0.9)' : 'rgba(90,130,180,0.35)';
      g.lineWidth = Math.max(1, U * (on ? 2.2 : 1.2));
      if (on) { g.shadowBlur = U * 22; g.shadowColor = UI.cyan; }
      g.stroke(p);
      g.shadowBlur = 0;

      const cxp = x + cardW / 2;
      txt(g, k.name, cxp, y0 + U * 46, U * 26, on ? '#ffffff' : UI.ink,
          'center', on ? UI.cyan : null, 800, 0.08);
      txt(g, k.note, cxp, y0 + U * 68, U * 12, UI.dim, 'center', null, 700, 0.14);

      const rows = [
        ['SHIPS', String(k.lives)],
        ['ATTACKERS', '+' + k.attackers],
        ['BOMB CAP', String(k.maxEshots)],
        ['SCORE', 'x' + k.scoreMul],
      ];
      let ry = y0 + U * 104;
      for (const [a, b] of rows) {
        txt(g, a, x + U * 20, ry, U * 12, UI.dim, 'left', null, 700, 0.1);
        txt(g, b, x + cardW - U * 20, ry, U * 15,
            on ? UI.gold : 'rgba(180,210,245,0.65)', 'right', null, 800);
        ry += U * 26;
      }
      // difficulty bar
      meter(g, x + U * 20, y0 + cardH - U * 34, cardW - U * 40, U * 10,
            (i + 1) / n, on ? 'rgba(255,92,120,0.9)' : 'rgba(255,92,120,0.45)');
      txt(g, i === X.skill ? 'SELECTED' : '', cxp, y0 + cardH - U * 12, U * 11,
          UI.good, 'center', null, 800, 0.2);
    }
    txt(g, 'ARROWS TO CHANGE     ENTER TO LAUNCH     ESC TO GO BACK',
        VW / 2, Math.min(VH * 0.92, y0 + cardH + U * 60), U * 15,
        'rgba(190,215,255,0.8)', 'center', null, 700, 0.16);
  }

  // The bindings editor.  Two key slots per action; the cursor picks a cell
  // and the next key pressed takes it.  Driven by raw arrows and Enter, never
  // by the bindings themselves, so it cannot be locked out.
  function drawKeys(g, api) {
    const X = api.x, U = u();
    scrim(g, 0.68);
    txt(g, 'KEY BINDINGS', VW / 2, VH * 0.15, U * 40, '#ffffff', 'center',
        UI.cyan, 900, 0.16);

    const acts = X ? X.actions : [];
    const w = Math.min(VW * 0.5, U * 620), x = (VW - w) / 2;
    const rowH = U * 34;
    const top = VH * 0.24;
    const c0 = x + w * 0.58, c1 = x + w * 0.85;

    txt(g, 'ACTION', x + U * 20, top - U * 14, U * 12, UI.dim, 'left', null,
        700, 0.2);
    txt(g, 'KEY 1', c0, top - U * 14, U * 12, UI.dim, 'center', null, 700, 0.2);
    txt(g, 'KEY 2', c1, top - U * 14, U * 12, UI.dim, 'center', null, 700, 0.2);

    for (let i = 0; i < acts.length; i++) {
      const a = acts[i];
      const y = top + i * rowH;
      const on = i === X.keyIdx;
      if (on) {
        const p = panelPath(g, x, y - U * 20, w, rowH - U * 4, U * 8);
        const grd = g.createLinearGradient(x, 0, x + w, 0);
        grd.addColorStop(0, 'rgba(60,200,255,0.03)');
        grd.addColorStop(0.5, 'rgba(60,200,255,0.18)');
        grd.addColorStop(1, 'rgba(255,92,192,0.08)');
        g.fillStyle = grd;
        g.fill(p);
        g.strokeStyle = 'rgba(120,230,255,0.6)';
        g.lineWidth = Math.max(1, U * 1.4);
        g.stroke(p);
      }
      txt(g, a.name, x + U * 20, y, U * 17,
          on ? '#ffffff' : 'rgba(170,200,240,0.6)', 'left',
          on ? UI.cyan : null, 800, 0.08);
      if (a.x) {
        txt(g, 'X ONLY', x + w * 0.34, y, U * 10, 'rgba(255,140,180,0.6)',
            'left', null, 700, 0.14);
      }
      for (let s = 0; s < X.slots; s++) {
        const code = X.binds[a.key][s];
        const sel = on && s === X.keySlot;
        const listening = sel && X.keyWait;
        const cxp = s ? c1 : c0;
        if (sel) {
          const bw = U * 92, bh = U * 24;
          const p = panelPath(g, cxp - bw / 2, y - bh + U * 6, bw, bh, U * 6);
          g.fillStyle = listening ? 'rgba(255,211,106,0.20)'
                                  : 'rgba(79,230,255,0.16)';
          g.fill(p);
          g.strokeStyle = listening ? UI.gold : UI.cyan;
          g.lineWidth = Math.max(1, U * 1.6);
          g.stroke(p);
        }
        const label = listening
          ? (((tick >> 3) & 1) ? 'PRESS A KEY' : '')
          : X.keyName(code);
        txt(g, label, cxp, y, U * 15,
            listening ? UI.gold
            : !code && s === 0 ? '#ff6a8a'
            : sel ? '#ffffff' : 'rgba(175,205,240,0.65)',
            'center', sel ? UI.cyan : null, 800, 0.06);
      }
    }
    const footY = top + acts.length * rowH + U * 24;
    txt(g, 'ARROWS MOVE     ENTER SET     BKSP CLEAR', VW / 2, footY, U * 14,
        'rgba(190,215,255,0.85)', 'center', null, 700, 0.16);
    txt(g, 'R  RESTORE DEFAULTS          ESC  GO BACK', VW / 2,
        footY + U * 22, U * 14, 'rgba(190,215,255,0.85)', 'center', null,
        700, 0.16);
  }

  function drawAttract(g, api) {
    const X = api.x, U = u();
    if (X && X.attractPage === 0) {
      scrim(g, 0.35);
      wordmark(g, VW / 2, VH * 0.30, U * 64);
      txt(g, 'WE ARE THE GALAXIANS', VW / 2, VH * 0.42, U * 22, UI.gold,
          'center', '#ff9a2a', 800, 0.22);
      txt(g, 'MISSION: DESTROY ALIENS', VW / 2, VH * 0.47, U * 18, UI.ink,
          'center', null, 700, 0.22);
      const pulse = 0.55 + 0.45 * Math.sin(tick * 0.08);
      g.globalAlpha = pulse;
      txt(g, 'PRESS 1 OR 2 TO PLAY', VW / 2, VH * 0.60, U * 26, '#ffffff',
          'center', UI.cyan, 800, 0.14);
      g.globalAlpha = 1;
      txt(g, 'WIDESCREEN   POWER-UPS   FOUR SKILL TIERS', VW / 2, VH * 0.67,
          U * 14, UI.cyan, 'center', null, 700, 0.3);
      txt(g, 'HOLD THREE PODS  ·  ' + X.cycleKey + ' CYCLES  ·  '
            + X.useKey + ' SPENDS', VW / 2, VH * 0.72,
          U * 14, '#ffffff', 'center', null, 700, 0.18);
      txt(g, 'EVERY POD YOU SPEND ARMS THE SWARM IN RETURN', VW / 2,
          VH * 0.765, U * 13, '#ff8ab0', 'center', null, 700, 0.18);
      txt(g, X.versionKey + '  SWITCH VERSION      K  KEY BINDINGS',
          VW / 2, VH * 0.82, U * 12, UI.dim, 'center', null, 700, 0.2);
      txt(g, '1979 NAMCO  ·  HOMAGE BUILD', VW / 2, VH * 0.90, U * 12,
          'rgba(255,120,190,0.7)', 'center', null, 600, 0.2);
      return;
    }
    // page 1: the score advance table, laid out across the width
    scrim(g, 0.5);
    txt(g, 'SCORE ADVANCE TABLE', VW / 2, VH * 0.16, U * 30, UI.cyan,
        'center', '#2aa8d8', 800, 0.2);

    const rows = [
      ['boss', '60',  0, false, 'IN FORMATION'],
      ['boss', '150', 0, false, 'DIVING ALONE'],
      ['boss', '200', 1, false, 'ONE ESCORT LEFT'],
      ['boss', '300', 2, false, 'TWO ESCORTS LEFT'],
      ['boss', '800', 2, true,  'ESCORTS SHOT FIRST'],
      ['red',    '50   100', 0, false, ''],
      ['purple', '40    80', 0, false, ''],
      ['blue',   '30    60', 0, false, ''],
    ];
    const w = Math.min(VW * 0.62, U * 760), x = (VW - w) / 2;
    let y = VH * 0.26;
    const step = VH * 0.072;
    const s = L.sc / REF;
    for (const [kind, val, esc, dim, note] of rows) {
      const set = art[kind];
      if (set && set[0]) {
        g.save();
        g.translate(x + U * 40, y - U * 6);
        g.scale(s * 0.9, s * 0.9);
        g.drawImage(set[0], -set[0].width / 2, -set[0].height / 2);
        g.restore();
      }
      for (let e = 0; e < esc; e++) {
        const rs = art.red;
        if (!rs || !rs[0]) break;
        g.save();
        g.globalAlpha = dim ? 0.2 : 1;
        g.translate(x + U * 90 + e * U * 40, y - U * 6);
        g.scale(s * 0.72, s * 0.72);
        g.drawImage(rs[0], -rs[0].width / 2, -rs[0].height / 2);
        g.restore();
      }
      if (note) txt(g, note, x + U * 190, y, U * 14, dim ? '#ff9c8a' : UI.dim,
                    'left', null, 700, 0.14);
      txt(g, val + ' PTS', x + w, y, U * 20,
          kind === 'boss' ? UI.gold : kind === 'red' ? '#ff8a6a'
        : kind === 'purple' ? '#d18aff' : UI.cyan, 'right', null, 800, 0.06);
      y += step;
    }
    txt(g, 'SHOOT THE ESCORTS FIRST', VW / 2, VH * 0.90, U * 20, '#ffffff',
        'center', UI.hot, 800, 0.2);
  }

  function drawBanners(g, api) {
    const X = api.x, U = u();
    const cxp = L.x + L.w / 2;
    if (api.mode === 'ready') {
      txt(g, 'PLAYER ' + (api.cur + 1), cxp, gy(112), U * 34, '#ffffff',
          'center', UI.cyan, 800, 0.14);
      txt(g, 'WAVE ' + api.stage, cxp, gy(132), U * 20, UI.ink, 'center',
          null, 700, 0.24);
      if (X && X.track) {
        txt(g, X.track, cxp, gy(150), U * 22, UI.cyan, 'center', '#2aa8d8',
            800, 0.14);
      }
      if (X) {
        txt(g, X.skillName, cxp, gy(172), U * 16, UI.gold, 'center', null,
            800, 0.24);
        txt(g, X.cycleKey + '  CYCLE HOLD          ' + X.useKey
              + '  USE POD', cxp, gy(198), U * 14,
            '#ffffff', 'center', UI.cyan, 800, 0.12);
        txt(g, 'EVERY POD YOU SPEND ARMS THE SWARM', cxp, gy(212), U * 12,
            '#ff8ab0', 'center', null, 700, 0.14);
      }
    }
    if (api.mode === 'clear') {
      txt(g, 'WAVE ' + api.stage + ' CLEAR', cxp, gy(126), U * 40, UI.gold,
          'center', '#ff9a2a', 900, 0.12);
    }
    if (api.mode === 'over') {
      txt(g, 'GAME OVER', cxp, gy(126), U * 46, '#ff6a8a', 'center',
          '#ff2a5a', 900, 0.14);
      txt(g, 'PRESS 1 TO PLAY AGAIN', cxp, gy(146), U * 16, UI.ink,
          'center', null, 700, 0.2);
    }
    if (X && X.paused) {
      scrim(g, 0.45);
      txt(g, 'PAUSED', VW / 2, VH / 2, U * 48, '#ffffff', 'center', UI.cyan,
          900, 0.2);
    }
    if (X && X.demo && api.mode === 'play') {
      txt(g, 'DEMO', cxp, gy(28), U * 15, 'rgba(190,215,255,0.7)', 'center',
          null, 700, 0.3);
    }
    // the pickup banner, riding just above the ship
    if (X && X.banner && X.bannerT > 0) {
      const k = Math.min(1, X.bannerT / 24);
      g.globalAlpha = k;
      txt(g, X.banner, cxp, gy(200), U * 24, '#ffffff', 'center', UI.good,
          900, 0.2);
      g.globalAlpha = 1;
    }
    // and the swarm's answer, high on the screen and in their colour, so the
    // two halves of the bargain never get confused for one another
    if (X && X.ebanner && X.ebannerT > 0) {
      const k = Math.min(1, X.ebannerT / 30);
      const slide = (1 - Math.min(1, (130 - X.ebannerT) / 14)) * U * 20;
      g.globalAlpha = k;
      txt(g, 'SWARM UPGRADE', cxp, gy(52) - slide, U * 13,
          'rgba(255,150,180,0.9)', 'center', null, 700, 0.34);
      txt(g, X.ebanner, cxp, gy(68) - slide, U * 30, '#ff6a8a', 'center',
          '#ff2a5a', 900, 0.16);
      g.globalAlpha = 1;
    }
  }

  // =======================================================================
  //  setup
  // =======================================================================
  function ensure(canvasEl, ctx2d) {
    cx = ctx2d;
    const w = canvasEl.width, h = canvasEl.height;
    if (!w || !h) return false;
    if (VW !== w || VH !== h) { VW = w; VH = h; layout(); }
    const key = VW * 65536 + VH;
    if (built === key) return !!sx;
    built = key;

    scene = mkCanvas(VW, VH); sx = scene && scene.getContext('2d');
    b1 = mkCanvas(Math.max(1, VW >> 2), Math.max(1, VH >> 2));
    b1x = b1 && b1.getContext('2d');
    b2 = mkCanvas(Math.max(1, VW >> 3), Math.max(1, VH >> 3));
    b2x = b2 && b2.getContext('2d');
    if (b1x) {
      try { b1x.filter = 'blur(4px)'; canBlur = b1x.filter === 'blur(4px)'; }
      catch (e) { canBlur = false; }
      b1x.filter = 'none';
    }
    neb = bakeNebula(Math.max(1, VW >> 1), Math.max(1, VH >> 1));

    if (!art.ship) {                     // one-time sprite baking
      for (const k of ['blue', 'purple', 'red', 'boss']) {
        art[k] = [0, 1, 2].map(f => bakeAlien(k, f));
      }
      art.ship = bakePlayer();
      dot = bakeDot();
      planet = bakePlanet(1024, '#2b3f7a', 'rgba(120,190,255,0.55)', '#9fc7ff');
      moon = bakePlanet(512, '#6b4a5f', 'rgba(255,180,190,0.4)', '#e6c0c8');
      makeField();
    }
    return !!sx;
  }

  return {
    RES, FULL,
    ensure,
    resize() { built = 0; },              // buffers are rebuilt on next frame

    // exposed so the tests can assert the landscape composition without a
    // browser: how the window got divided up on the last frame
    layoutInfo() {
      return { playW: L.w, playH: L.h, panel: L.panel, gutter: L.gut,
               scale: L.sc, wide: L.wide, vw: VW, vh: VH };
    },

    reset() {
      parts.length = 0;
      trails.clear();
      angles.clear();
      shake = 0; flash = 0; warp = 0; ca = 0;
      lastPx = null;
    },

    // --- effect hooks ----------------------------------------------------
    fxBoom(x, y, big, kind) {
      const P = SKIN[kind] || SKIN.blue;
      if (big) {
        burst(x, y, P.mid, '#ffffff', 120, 4.0, true);
        burst(x, y, '#ff8a3c', '#fff2b0', 55, 2.4, false);
        shake = Math.max(shake, 16);
        flash = 14; flashCol = '255,120,80';
        ca = Math.max(ca, 1);
      } else {
        burst(x, y, P.mid, P.hot, kind === 'boss' ? 62 : 32,
              kind === 'boss' ? 2.9 : 2.0, kind === 'boss');
        shake = Math.max(shake, kind === 'boss' ? 7 : 2.4);
        if (kind === 'boss') {
          flash = 8; flashCol = '255,200,90'; ca = Math.max(ca, 0.5);
        }
      }
      railPulse = Math.min(1.2, railPulse + (big ? 0.9 : 0.15));
    },
    fxShot(x, y) {
      for (let i = 0; i < 7; i++) spark(x, y, '#a8f2ff', 1.2, rnd(6, 15), 1.1);
    },
    fxHit(x, y) {
      for (let i = 0; i < 9; i++) spark(x, y, '#ffe9a0', 1.7, rnd(8, 18), 1.2);
    },

    // X-only cues
    fxX(kind, x, y, col) {
      if (kind === 'pickup') {
        parts.push({ t: 'ring', x, y, r: 1, max: 22, life: 20, lmax: 20,
                     col: col || '#ffffff', wob: 0.15 });
        for (let i = 0; i < 26; i++) spark(x, y, col || '#ffffff', 2.2, rnd(12, 30), 1.2);
        railPulse = Math.min(1.2, railPulse + 0.35);
      } else if (kind === 'shield') {
        parts.push({ t: 'ring', x, y, r: 4, max: 30, life: 24, lmax: 24,
                     col: UI.good, wob: 0.05 });
        for (let i = 0; i < 34; i++) spark(x, y, UI.good, 2.6, rnd(14, 34), 1.3);
        shake = Math.max(shake, 6);
        flash = 8; flashCol = '125,255,196';
      } else if (kind === 'arm') {
        // spending a pod: the charge runs up the ship rather than out from it
        parts.push({ t: 'ring', x, y, r: 2, max: 26, life: 22, lmax: 22,
                     col: col || '#ffffff', wob: 0.08 });
        for (let i = 0; i < 30; i++) {
          const a = nrand() * TAU, v = rnd(0.6, 2.6);
          parts.push({ t: 'spark', x, y, vx: Math.cos(a) * v,
                       vy: Math.sin(a) * v - 0.7, life: rnd(16, 38), max: 38,
                       col: col || '#ffffff', size: 1.3 });
        }
        flash = 6; flashCol = '160,240,255';
        railPulse = Math.min(1.2, railPulse + 0.5);
      } else if (kind === 'escalate') {
        // the swarm's answer: a red wave sweeping down over the formation
        for (let i = 0; i < 2; i++) {
          parts.push({ t: 'ring', x: 112, y: 70, r: 6, max: 120 + i * 50,
                       life: 30 + i * 8, lmax: 30 + i * 8,
                       col: i ? '#ff2a5a' : '#ff9ab4', wob: 0.5 });
        }
        for (let i = 0; i < 70; i++) {
          spark(rnd(24, 200), rnd(36, 108), i & 1 ? '#ff6a8a' : '#ffffff',
                2.4, rnd(18, 46), 1.3);
        }
        shake = Math.max(shake, 11);
        flash = 12; flashCol = '255,70,110';
        ca = Math.max(ca, 0.9);
        railPulse = 1.0;
      } else if (kind === 'nova') {
        for (let i = 0; i < 3; i++) {
          parts.push({ t: 'ring', x, y: 128, r: 4, max: 150 + i * 60,
                       life: 34 + i * 8, lmax: 34 + i * 8,
                       col: i ? '#7fe6ff' : '#ffffff', wob: 0.35 });
        }
        for (let i = 0; i < 140; i++) {
          spark(x, 128, i & 1 ? '#ffffff' : '#7fe6ff', 5.5, rnd(20, 60), 1.6);
        }
        shake = Math.max(shake, 20);
        flash = 20; flashCol = '200,240,255';
        ca = Math.max(ca, 1.4);
        railPulse = 1.2;
      }
    },

    // Effects age with the simulation, never with the frame -- the main loop
    // can run several updates per draw.
    step(aliens) {
      tick++;
      updateParts();
      pushTrails(aliens);
      if (shake > 0) shake *= 0.87;
      if (flash > 0) flash--;
      if (ca > 0) ca *= 0.90;
    },

    // --- the frame -------------------------------------------------------
    render(api) {
      if (!ensure(api.canvas, api.ctx)) return;
      const g = sx;
      const X = api.x;
      const mode = api.mode;

      // the wave-clear warp: stars stretch out as the stage ends
      const wantWarp = mode === 'clear' ? 1 : 0;
      warp += (wantWarp - warp) * 0.08;

      g.setTransform(1, 0, 0, 1, 0, 0);
      drawSky(g, api.scroll);

      const inGame = mode !== 'attract' && mode !== 'select'
                  && mode !== 'skill' && mode !== 'keys';
      if (inGame) drawCorridor(g);

      const sh = shake > 0.15 ? shake : 0;
      g.save();
      if (sh) g.translate(rnd(-sh, sh) * L.sc, rnd(-sh, sh) * L.sc);

      if (inGame) {
        drawTrails(g, api.aliens);
        drawAliens(g, api.aliens);
        drawDrops(g, X);
        drawPlayer(g, api);
        for (const s of api.pshots) {
          bolt(g, s.x, s.y, 8, 1.5, 'rgba(120,255,255,0.95)', '#ffffff');
        }
        for (const b of api.eshots) {
          bolt(g, b.x, b.y, 5.5, 1.4, 'rgba(255,90,180,0.9)', '#ffe6f6');
        }
        for (const p of api.pops) {
          const k = p.t / 48;
          g.globalAlpha = Math.min(1, k * 2);
          txt(g, String(p.v), gx(p.x), gy(p.y), u() * 20, '#ffd9f4', 'center',
              UI.hot, 800);
          g.globalAlpha = 1;
        }
      }
      drawParts(g);
      g.restore();

      if (flash > 0) {
        g.fillStyle = `rgba(${flashCol},${flash / 22 * 0.4})`;
        g.fillRect(0, 0, VW, VH);
      }

      // --- UI on top of the scene ---------------------------------------
      if (mode === 'select') drawSelect(g, api);
      else if (mode === 'keys') drawKeys(g, api);
      else if (mode === 'skill') drawSkill(g, api);
      else if (mode === 'attract') drawAttract(g, api);
      else { drawWings(g, api); drawBanners(g, api); }

      // vignette, biased wide so the corners of a 21:9 screen still fall off
      const vg = g.createRadialGradient(VW / 2, VH / 2, VH * 0.30,
                                        VW / 2, VH / 2, VW * 0.66);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,0.72)');
      g.fillStyle = vg;
      g.fillRect(0, 0, VW, VH);

      // --- compose: scene, two bloom taps, then a chromatic split --------
      cx.setTransform(1, 0, 0, 1, 0, 0);
      cx.globalCompositeOperation = 'source-over';
      cx.globalAlpha = 1;

      const split = ca > 0.03 ? ca * VW * 0.0035 : 0;
      if (split > 0.4) {
        // red and blue drawn a hair apart, green dead centre -- only while
        // something is actually exploding, because it costs three full blits
        cx.fillStyle = '#000';
        cx.fillRect(0, 0, VW, VH);
        cx.globalCompositeOperation = 'lighter';
        cx.globalAlpha = 1;
        cx.drawImage(scene, -split, 0);
        cx.globalAlpha = 0.85;
        cx.drawImage(scene, split, 0);
        cx.globalAlpha = 1;
        cx.globalCompositeOperation = 'source-over';
        cx.globalAlpha = 0.55;
        cx.drawImage(scene, 0, 0);
        cx.globalAlpha = 1;
      } else {
        cx.drawImage(scene, 0, 0);
      }

      if (b1x && canBlur) {
        b1x.setTransform(1, 0, 0, 1, 0, 0);
        b1x.globalCompositeOperation = 'source-over';
        b1x.clearRect(0, 0, b1.width, b1.height);
        b1x.filter = 'blur(3px)';
        b1x.drawImage(scene, 0, 0, b1.width, b1.height);
        b1x.filter = 'none';

        if (b2x) {
          b2x.setTransform(1, 0, 0, 1, 0, 0);
          b2x.clearRect(0, 0, b2.width, b2.height);
          b2x.filter = 'blur(4px)';
          b2x.drawImage(b1, 0, 0, b2.width, b2.height);
          b2x.filter = 'none';
        }

        cx.globalCompositeOperation = 'lighter';
        cx.globalAlpha = 0.34;
        cx.drawImage(b1, 0, 0, VW, VH);
        if (b2x) {
          cx.globalAlpha = 0.30;
          cx.drawImage(b2, 0, 0, VW, VH);
        }
        cx.globalAlpha = 1;
        cx.globalCompositeOperation = 'source-over';
      }
    },
  };
})();
