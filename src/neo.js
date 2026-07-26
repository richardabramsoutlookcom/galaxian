// -------------------------------------------------------------------------
//  GALAXIANS 2026 -- the modern renderer.
//
//  Draws the exact same game state as the arcade renderer, at 4x the
//  resolution, with none of the original art.  The ships are vector forms with
//  baked glow, the swarm sits over a drifting nebula and a parallax starfield,
//  divers leave light ribbons that trace their swoop, kills throw particles and
//  shockwaves, and the whole frame gets a bloom pass.
//
//  Nothing in here touches the simulation -- update() is untouched, so the
//  flight paths, scoring and timings are identical in both versions.
// -------------------------------------------------------------------------
const Neo = (() => {
  const RES = 4;                       // device pixels per game pixel
  let VW = 0, VH = 0;                  // backing store size

  let cx = null;                       // the shared canvas context
  let scene, sx;                       // full-res offscreen we compose into
  let bloom, bx;                       // quarter-res blur target
  let neb, nx;                         // pre-baked nebula
  let canBlur = true;
  let inited = false;

  const art = {};                      // baked sprite canvases
  let dot = null, ring = null;

  const parts = [];
  const trails = new Map();            // alien -> array of past positions
  const angles = new Map();            // alien -> smoothed facing, radians
  let shake = 0, flash = 0, flashCol = '#fff';
  let tick = 0;

  const stars = [[], [], []];

  // --- palettes -----------------------------------------------------------
  const SKIN = {
    blue:   { hot: '#d7fbff', mid: '#22b8e6', low: '#0a3c62', glow: '#3fd9ff' },
    purple: { hot: '#f7d0ff', mid: '#a63cdc', low: '#3d0d5c', glow: '#c558ff' },
    red:    { hot: '#ffe0b4', mid: '#ff4b28', low: '#5f1206', glow: '#ff6a34' },
    boss:   { hot: '#fff8cf', mid: '#ffb31f', low: '#6d3a00', glow: '#ffc93c' },
  };
  const SHIP = { hull: '#e8f0ff', trim: '#39e9ff', deep: '#25405e', glow: '#66e9ff' };

  const TAU = Math.PI * 2;

  // The renderer keeps its own random stream.  If it drew from Math.random it
  // would consume the same sequence the simulation does, and the two versions
  // would stop playing identically -- which is the one thing that must not
  // change between them.
  let seed = 0x2f6e2b1;
  function nrand() {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  }
  const rnd = (a, b) => a + nrand() * (b - a);

  function mkCanvas(w, h) {
    const c = (typeof document !== 'undefined' && document.createElement)
      ? document.createElement('canvas') : null;
    if (!c) return null;
    c.width = w; c.height = h;
    return c;
  }

  // -----------------------------------------------------------------------
  //  art baking -- every sprite is drawn once into an offscreen canvas with
  //  its glow already burned in, then just rotated and blitted per frame.
  // -----------------------------------------------------------------------
  function glowPath(g, path, fill, stroke, blur, glowCol) {
    g.save();
    if (blur) { g.shadowBlur = blur; g.shadowColor = glowCol; }
    g.fillStyle = fill;
    g.fill(path);
    g.restore();
    if (stroke) {
      g.strokeStyle = stroke;
      g.lineWidth = 1.6;
      g.lineJoin = 'round';
      g.stroke(path);
    }
  }

  // The alien: a swept-wing interceptor, nose pointing down the screen, drawn
  // in a unit space and scaled.  `flap` slides the wings for the idle animation.
  function alienPath(u, flap) {
    const p = new Path2D();
    const s = flap * 0.13;
    // body
    p.moveTo(0, 1.05 * u);
    p.lineTo(0.30 * u, 0.34 * u);
    p.lineTo(0.36 * u, -0.36 * u);
    p.lineTo(0.17 * u, -0.86 * u);
    p.lineTo(-0.17 * u, -0.86 * u);
    p.lineTo(-0.36 * u, -0.36 * u);
    p.lineTo(-0.30 * u, 0.34 * u);
    p.closePath();
    return p;
  }
  function wingPath(u, flap, side) {
    const p = new Path2D();
    const s = flap * 0.16;
    const k = side;
    p.moveTo(k * 0.28 * u, 0.18 * u);
    p.lineTo(k * (0.98 + s) * u, (-0.10 - s) * u);
    p.lineTo(k * (1.02 + s) * u, (-0.52 - s * 1.4) * u);
    p.lineTo(k * 0.62 * u, (-0.30 - s * 0.4) * u);
    p.lineTo(k * 0.34 * u, -0.34 * u);
    p.closePath();
    return p;
  }

  function bakeAlien(kind, flapIdx) {
    const S = SKIN[kind];
    const big = kind === 'boss';
    const size = big ? 116 : 96;
    const c = mkCanvas(size, size);
    if (!c) return null;
    const g = c.getContext('2d');
    g.translate(size / 2, size / 2);
    const u = (big ? 30 : 25);
    const flap = [0, 1, 0.5][flapIdx] || 0;

    // wings first so the body sits over them
    for (const side of [-1, 1]) {
      const w = wingPath(u, flap, side);
      const grad = g.createLinearGradient(side * u, -u, side * u * 0.2, u);
      grad.addColorStop(0, S.mid);
      grad.addColorStop(1, S.low);
      glowPath(g, w, grad, S.glow, 16, S.glow);
    }

    const body = alienPath(u, flap);
    const bg = g.createLinearGradient(0, -u, 0, u);
    bg.addColorStop(0, S.low);
    bg.addColorStop(0.45, S.mid);
    bg.addColorStop(1, S.hot);
    glowPath(g, body, bg, S.hot, 20, S.glow);

    // antennae
    g.strokeStyle = S.hot;
    g.lineWidth = 2;
    g.shadowBlur = 12; g.shadowColor = S.glow;
    g.beginPath();
    g.moveTo(-0.14 * u, -0.8 * u); g.lineTo(-0.30 * u, -1.25 * u);
    g.moveTo(0.14 * u, -0.8 * u); g.lineTo(0.30 * u, -1.25 * u);
    g.stroke();
    g.shadowBlur = 0;

    // glowing core
    const core = g.createRadialGradient(0, 0.05 * u, 0, 0, 0.05 * u, 0.5 * u);
    core.addColorStop(0, '#ffffff');
    core.addColorStop(0.35, S.hot);
    core.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = core;
    g.beginPath();
    g.arc(0, 0.05 * u, 0.5 * u, 0, TAU);
    g.fill();

    if (big) {                        // flagship gets side pods and a crown
      g.globalCompositeOperation = 'source-over';
      g.fillStyle = S.hot;
      g.shadowBlur = 14; g.shadowColor = S.glow;
      for (const side of [-1, 1]) {
        g.beginPath();
        g.ellipse(side * 0.52 * u, 0.10 * u, 0.11 * u, 0.28 * u, 0, 0, TAU);
        g.fill();
      }
      g.shadowBlur = 0;
    }
    return c;
  }

  function bakePlayer(thrust) {
    const size = 110;
    const c = mkCanvas(size, size);
    if (!c) return null;
    const g = c.getContext('2d');
    g.translate(size / 2, size / 2);
    const u = 26;

    const p = new Path2D();
    p.moveTo(0, -1.05 * u);
    p.lineTo(0.20 * u, -0.30 * u);
    p.lineTo(0.72 * u, 0.16 * u);
    p.lineTo(0.94 * u, 0.60 * u);
    p.lineTo(0.44 * u, 0.44 * u);
    p.lineTo(0.30 * u, 0.86 * u);
    p.lineTo(-0.30 * u, 0.86 * u);
    p.lineTo(-0.44 * u, 0.44 * u);
    p.lineTo(-0.94 * u, 0.60 * u);
    p.lineTo(-0.72 * u, 0.16 * u);
    p.lineTo(-0.20 * u, -0.30 * u);
    p.closePath();

    const grad = g.createLinearGradient(0, -u, 0, u);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.4, SHIP.hull);
    grad.addColorStop(1, SHIP.deep);
    glowPath(g, p, grad, SHIP.trim, 18, SHIP.glow);

    // cockpit
    const cp = g.createLinearGradient(0, -0.6 * u, 0, 0.2 * u);
    cp.addColorStop(0, '#ffffff');
    cp.addColorStop(1, SHIP.trim);
    g.fillStyle = cp;
    g.shadowBlur = 14; g.shadowColor = SHIP.glow;
    g.beginPath();
    g.ellipse(0, -0.28 * u, 0.13 * u, 0.34 * u, 0, 0, TAU);
    g.fill();
    g.shadowBlur = 0;

    // engine nozzles
    g.globalCompositeOperation = 'lighter';
    for (const side of [-1, 1]) {
      const e = g.createRadialGradient(side * 0.17 * u, 0.8 * u, 0,
                                       side * 0.17 * u, 0.8 * u, 0.42 * u);
      e.addColorStop(0, '#ffffff');
      e.addColorStop(0.3, SHIP.trim);
      e.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = e;
      g.beginPath();
      g.arc(side * 0.17 * u, 0.8 * u, 0.42 * u, 0, TAU);
      g.fill();
    }
    return c;
  }

  function bakeDot() {
    const s = 64;
    const c = mkCanvas(s, s);
    if (!c) return null;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.25, 'rgba(255,255,255,0.75)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
    return c;
  }

  function bakeNebula() {
    neb = mkCanvas(VW >> 1, VH >> 1);
    if (!neb) return;
    nx = neb.getContext('2d');
    const w = neb.width, h = neb.height;
    nx.clearRect(0, 0, w, h);
    const blobs = [
      ['rgba(84,26,160,0.55)', 0.24, 0.18, 0.62],
      ['rgba(14,92,150,0.50)', 0.78, 0.34, 0.55],
      ['rgba(160,26,96,0.34)', 0.55, 0.72, 0.48],
      ['rgba(20,60,140,0.40)', 0.10, 0.80, 0.50],
      ['rgba(60,16,120,0.40)', 0.90, 0.92, 0.44],
    ];
    nx.globalCompositeOperation = 'lighter';
    for (const [col, px, py, pr] of blobs) {
      const r = pr * w;
      const grad = nx.createRadialGradient(px * w, py * h, 0, px * w, py * h, r);
      grad.addColorStop(0, col);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      nx.fillStyle = grad;
      nx.beginPath();
      nx.arc(px * w, py * h, r, 0, TAU);
      nx.fill();
    }
  }

  function makeStars() {
    const cfg = [[110, 0.30, 0.6, 0.35], [70, 0.65, 1.0, 0.6], [34, 1.25, 1.7, 1]];
    const cols = ['#ffffff', '#bcd8ff', '#ffd9c0', '#d8c0ff', '#c8fff0'];
    for (let l = 0; l < 3; l++) {
      const [n, sp, sz, br] = cfg[l];
      stars[l] = [];
      for (let i = 0; i < n; i++) {
        stars[l].push({
          x: nrand() * 224,
          y: nrand() * 256,
          r: sz * rnd(0.5, 1.1),
          sp, br,
          c: cols[(nrand() * cols.length) | 0],
          ph: nrand() * TAU,
        });
      }
    }
  }

  // -----------------------------------------------------------------------
  //  setup
  // -----------------------------------------------------------------------
  function ensure(canvasEl, ctx2d) {
    VW = 224 * RES; VH = 256 * RES;
    cx = ctx2d;
    if (inited) return;
    inited = true;

    scene = mkCanvas(VW, VH); sx = scene && scene.getContext('2d');
    bloom = mkCanvas(VW >> 2, VH >> 2); bx = bloom && bloom.getContext('2d');
    if (bx) {
      try { bx.filter = 'blur(4px)'; canBlur = bx.filter === 'blur(4px)'; }
      catch (e) { canBlur = false; }
      bx.filter = 'none';
    }
    bakeNebula();
    makeStars();

    for (const k of ['blue', 'purple', 'red', 'boss']) {
      art[k] = [0, 1, 2].map(f => bakeAlien(k, f));
    }
    art.ship = bakePlayer(0);
    dot = bakeDot();
  }

  // -----------------------------------------------------------------------
  //  particles
  // -----------------------------------------------------------------------
  function spark(x, y, col, spd, life, size) {
    const a = nrand() * TAU;
    const v = rnd(spd * 0.25, spd);
    parts.push({ t: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
                 life, max: life, col, size });
  }

  function burst(x, y, col, hot, n, spd, big) {
    parts.push({ t: 'ring', x, y, r: 1, max: big ? 30 : 14, life: big ? 26 : 16,
                 lmax: big ? 26 : 16, col: hot });
    parts.push({ t: 'flash', x, y, r: big ? 13 : 6.5, life: 9, lmax: 9, col: hot });
    for (let i = 0; i < n; i++) {
      spark(x, y, nrand() < 0.35 ? hot : col, spd,
            rnd(14, big ? 46 : 30), rnd(0.5, big ? 1.5 : 1.05));
    }
    for (let i = 0; i < (big ? 14 : 6); i++) {
      const a = nrand() * TAU, v = rnd(0.4, spd * 0.8);
      parts.push({ t: 'shard', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
                   life: rnd(24, 56), max: 56, col, rot: nrand() * TAU,
                   spin: rnd(-0.28, 0.28), len: rnd(1.6, 4) });
    }
  }

  function updateParts() {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life--;
      if (p.life <= 0) { parts.splice(i, 1); continue; }
      if (p.t === 'spark' || p.t === 'shard') {
        p.x += p.vx; p.y += p.vy;
        p.vx *= 0.94; p.vy *= 0.94;
        p.vy += 0.012;
        if (p.t === 'shard') p.rot += p.spin;
      } else if (p.t === 'ring') {
        p.r += (p.max - p.r) * 0.16;
      }
    }
  }

  function drawParts(g) {
    g.globalCompositeOperation = 'lighter';
    for (const p of parts) {
      const k = p.life / (p.lmax || p.max);
      if (p.t === 'spark') {
        const s = p.size * RES * (0.35 + k * 0.9);
        g.globalAlpha = Math.min(1, k * 1.2) * 0.85;
        g.fillStyle = p.col;
        g.beginPath();
        g.arc(p.x * RES, p.y * RES, Math.max(0.6, s * 0.5), 0, TAU);
        g.fill();
      } else if (p.t === 'flash') {
        const s = p.r * RES * (1.5 - k * 0.55);
        g.globalAlpha = k * k * 0.8;
        g.drawImage(dot, p.x * RES - s, p.y * RES - s, s * 2, s * 2);
      } else if (p.t === 'ring') {
        g.globalAlpha = k * k * 0.55;
        g.strokeStyle = p.col;
        g.lineWidth = Math.max(1, 1.6 * RES * k);
        g.beginPath();
        g.arc(p.x * RES, p.y * RES, p.r * RES, 0, TAU);
        g.stroke();
      } else if (p.t === 'shard') {
        g.globalAlpha = k;
        g.strokeStyle = p.col;
        g.lineWidth = 1.6 * RES * k;
        g.save();
        g.translate(p.x * RES, p.y * RES);
        g.rotate(p.rot);
        g.beginPath();
        g.moveTo(-p.len * RES, 0);
        g.lineTo(p.len * RES, 0);
        g.stroke();
        g.restore();
      }
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  // -----------------------------------------------------------------------
  //  scene
  // -----------------------------------------------------------------------
  function drawBackdrop(g) {
    const grad = g.createLinearGradient(0, 0, 0, VH);
    grad.addColorStop(0, '#05060f');
    grad.addColorStop(0.55, '#080a1c');
    grad.addColorStop(1, '#0c0718');
    g.fillStyle = grad;
    g.fillRect(0, 0, VW, VH);

    if (neb) {
      const drift = (tick * 0.06) % VH;
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = 0.30;
      g.drawImage(neb, 0, drift - VH, VW, VH);
      g.drawImage(neb, 0, drift, VW, VH);
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
    }
  }

  function drawStars(g, scroll) {
    g.globalCompositeOperation = 'lighter';
    for (let l = 0; l < 3; l++) {
      for (const s of stars[l]) {
        let y = (s.y + scroll * s.sp) % 256;
        if (y < 0) y += 256;
        const tw = 0.65 + 0.35 * Math.sin(tick * 0.06 + s.ph);
        g.globalAlpha = s.br * tw;
        g.fillStyle = s.c;
        const r = s.r * RES * 0.5;
        if (l === 2) {                       // near layer streaks slightly
          g.fillRect(s.x * RES - r * 0.5, y * RES - r * 1.6, r, r * 3.2);
        } else {
          g.beginPath();
          g.arc(s.x * RES, y * RES, r, 0, TAU);
          g.fill();
        }
      }
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  // Ribbons behind the divers -- these trace the cosine sweep, which is the
  // whole point of the arcade flight model, so they get to show it off.
  function pushTrails(aliens) {
    for (const a of aliens) {
      if (!a.alive || a.state === 'form') { trails.delete(a); continue; }
      let t = trails.get(a);
      if (!t) { t = []; trails.set(a, t); }
      t.push(a.x, a.y);
      if (t.length > 60) t.splice(0, t.length - 60);
    }
  }

  function drawTrails(g, aliens) {
    g.globalCompositeOperation = 'lighter';
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const a of aliens) {
      const t = trails.get(a);
      if (!t || t.length < 6) continue;
      const S = SKIN[a.kind];
      const n = t.length / 2;
      for (let i = 1; i < n; i++) {
        const k = i / n;
        g.globalAlpha = k * k * 0.5;
        g.strokeStyle = S.glow;
        g.lineWidth = Math.max(0.6, k * (a.kind === 'boss' ? 5 : 3.4) * RES * 0.6);
        g.beginPath();
        g.moveTo(t[(i - 1) * 2] * RES, t[(i - 1) * 2 + 1] * RES);
        g.lineTo(t[i * 2] * RES, t[i * 2 + 1] * RES);
        g.stroke();
      }
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  function facingOf(a) {
    // the engine's 24-step facing, smoothed so the ships turn continuously
    const want = -a.face * (Math.PI / 12);
    let cur = angles.get(a);
    if (cur === undefined) cur = want;
    let d = want - cur;
    while (d > Math.PI) d -= TAU;
    while (d < -Math.PI) d += TAU;
    cur += d * 0.28;
    angles.set(a, cur);
    return cur;
  }

  function drawAliens(g, aliens) {
    for (const a of aliens) {
      if (!a.alive) continue;
      const set = art[a.kind];
      if (!set) continue;
      const frame = a.state === 'form'
        ? set[(tick >> 3) % 3] : set[(tick >> 2) % 3];
      if (!frame) continue;
      const ang = a.state === 'form'
        ? Math.sin(tick * 0.04 + a.col * 0.7) * 0.05 : facingOf(a);
      const bob = a.state === 'form'
        ? Math.sin(tick * 0.05 + a.col * 0.8 + a.row) * 0.6 : 0;
      g.save();
      g.translate(a.x * RES, (a.y + bob) * RES);
      g.rotate(ang);
      g.drawImage(frame, -frame.width / 2, -frame.height / 2);
      g.restore();
    }
  }

  function drawPlayer(g, px, py, alive) {
    if (!alive || !art.ship) return;
    const lean = Math.max(-0.22, Math.min(0.22, (px - (Neo._lastPx || px)) * 0.16));
    Neo._lastPx = px;
    g.save();
    g.translate(px * RES, py * RES);
    g.rotate(lean);
    // thruster
    g.globalCompositeOperation = 'lighter';
    const f = 1 + Math.sin(tick * 0.7) * 0.22;
    for (const side of [-1, 1]) {
      const gx = side * 4.4 * RES, gy = 7 * RES;
      const len = 13 * RES * f;
      const grad = g.createLinearGradient(gx, gy, gx, gy + len);
      grad.addColorStop(0, 'rgba(255,255,255,0.95)');
      grad.addColorStop(0.3, 'rgba(80,220,255,0.7)');
      grad.addColorStop(1, 'rgba(40,90,255,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(gx - 2.6 * RES, gy);
      g.lineTo(gx + 2.6 * RES, gy);
      g.lineTo(gx, gy + len);
      g.closePath();
      g.fill();
    }
    g.globalCompositeOperation = 'source-over';
    g.drawImage(art.ship, -art.ship.width / 2, -art.ship.height / 2);
    g.restore();
  }

  function bolt(g, x, y, len, w, c1, c2) {
    g.globalCompositeOperation = 'lighter';
    const grad = g.createLinearGradient(x * RES, (y - len) * RES,
                                        x * RES, (y + len) * RES);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.5, c1);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect((x - w) * RES, (y - len) * RES, w * 2 * RES, len * 2 * RES);
    const s = w * 2.4 * RES;
    g.drawImage(dot, x * RES - s, y * RES - s, s * 2, s * 2);
    g.fillStyle = c2;
    g.fillRect((x - w * 0.35) * RES, (y - len * 0.5) * RES,
               w * 0.7 * RES, len * RES);
    g.globalCompositeOperation = 'source-over';
  }

  // -----------------------------------------------------------------------
  //  HUD
  // -----------------------------------------------------------------------
  function font(g, px, weight) {
    g.font = `${weight || 600} ${px * RES}px "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    try { g.letterSpacing = `${0.09 * px * RES}px`; } catch (e) {}
  }

  function label(g, s, x, y, px, col, align, glow) {
    font(g, px, 700);
    g.textAlign = align || 'left';
    g.textBaseline = 'alphabetic';
    if (glow) { g.shadowBlur = 12 * RES * 0.5; g.shadowColor = glow; }
    g.fillStyle = col;
    g.fillText(s, x * RES, y * RES);
    g.shadowBlur = 0;
    try { g.letterSpacing = '0px'; } catch (e) {}
  }

  function shipGlyph(g, x, y, s, alpha) {
    g.save();
    g.globalAlpha = alpha === undefined ? 1 : alpha;
    g.translate(x * RES, y * RES);
    g.scale(s, s);
    g.drawImage(art.ship, -art.ship.width / 2, -art.ship.height / 2);
    g.restore();
  }

  function drawHud(g, api) {
    const { p0, p1, hi, two, cur, mode, lives, stage } = api;
    g.save();
    // top bar wash
    const bar = g.createLinearGradient(0, 0, 0, 22 * RES);
    bar.addColorStop(0, 'rgba(10,16,40,0.85)');
    bar.addColorStop(1, 'rgba(10,16,40,0)');
    g.fillStyle = bar;
    g.fillRect(0, 0, VW, 22 * RES);

    const blink = (tick >> 4) & 1;
    const live = mode !== 'attract' && mode !== 'select';
    if (!(live && cur === 0 && blink)) label(g, '1UP', 12, 9, 6, '#7ad9ff', 'left', '#1f9fd0');
    label(g, 'HIGH', 112, 9, 6, '#ff7ad0', 'center', '#d0348f');
    if (two && !(live && cur === 1 && blink)) label(g, '2UP', 212, 9, 6, '#7ad9ff', 'right', '#1f9fd0');

    label(g, String(p0).padStart(6, '0'), 12, 19, 8, '#ffffff', 'left', '#3fd9ff');
    label(g, String(hi).padStart(6, '0'), 112, 19, 8, '#ffe9fb', 'center', '#ff7ad0');
    if (two) label(g, String(p1).padStart(6, '0'), 212, 19, 8, '#ffffff', 'right', '#3fd9ff');

    // bottom bar
    const bb = g.createLinearGradient(0, VH - 20 * RES, 0, VH);
    bb.addColorStop(0, 'rgba(10,16,40,0)');
    bb.addColorStop(1, 'rgba(10,16,40,0.9)');
    g.fillStyle = bb;
    g.fillRect(0, VH - 20 * RES, VW, 20 * RES);

    for (let i = 0; i < Math.min(5, Math.max(0, lives - 1)); i++) {
      shipGlyph(g, 12 + i * 13, 247, 0.30, 0.9);
    }

    // stage as stacked chevrons, ten-markers first
    let tens = Math.floor(stage / 10), ones = stage % 10;
    if (tens > 5) { tens = 5; ones = 0; }
    let x = 214;
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < ones; i++) { chevron(g, x, 247, 1, '#4fe3ff'); x -= 7; }
    for (let i = 0; i < tens; i++) { chevron(g, x, 247, 1.7, '#ffcf4a'); x -= 12; }
    g.globalCompositeOperation = 'source-over';
    g.restore();
  }

  function chevron(g, x, y, s, col) {
    g.save();
    g.translate(x * RES, y * RES);
    g.scale(s, s);
    g.strokeStyle = col;
    g.lineWidth = 1.6 * RES;
    g.lineCap = 'round';
    g.shadowBlur = 8 * RES * 0.5; g.shadowColor = col;
    g.beginPath();
    g.moveTo(-2.4 * RES, 2.2 * RES);
    g.lineTo(0, -2.4 * RES);
    g.lineTo(2.4 * RES, 2.2 * RES);
    g.stroke();
    g.restore();
  }

  function wordmark(g, y) {
    const t = tick * 0.02;
    const grad = g.createLinearGradient(0, (y - 14) * RES, 0, (y + 6) * RES);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.45, '#6fe4ff');
    grad.addColorStop(0.75, '#c45cff');
    grad.addColorStop(1, '#ff3f9a');
    font(g, 26, 800);
    g.textAlign = 'center';
    g.shadowBlur = 30; g.shadowColor = '#4bd2ff';
    g.fillStyle = grad;
    g.fillText('GALAXIANS', 112 * RES, y * RES);
    g.shadowBlur = 0;
    font(g, 11, 500);
    g.fillStyle = 'rgba(190,220,255,0.85)';
    g.fillText('2 0 2 6', 112 * RES, (y + 16) * RES);
    try { g.letterSpacing = '0px'; } catch (e) {}
  }

  return {
    RES,
    ensure,

    reset() {
      parts.length = 0;
      trails.clear();
      angles.clear();
      shake = 0; flash = 0;
    },

    // --- effect hooks fired by the engine --------------------------------
    fxBoom(x, y, big, kind) {
      const S = SKIN[kind] || SKIN.blue;
      if (big) {
        burst(x, y, S.mid, '#ffffff', 90, 3.6, true);
        burst(x, y, '#ff8a3c', '#fff2b0', 40, 2.2, false);
        shake = Math.max(shake, 13);
        flash = 12; flashCol = 'rgba(255,120,80,';
      } else {
        burst(x, y, S.mid, S.hot, kind === 'boss' ? 46 : 26,
              kind === 'boss' ? 2.6 : 1.9, kind === 'boss');
        shake = Math.max(shake, kind === 'boss' ? 6 : 2.2);
        if (kind === 'boss') { flash = 7; flashCol = 'rgba(255,200,90,'; }
      }
    },
    fxShot(x, y) {
      for (let i = 0; i < 6; i++) spark(x, y, '#9df0ff', 1.1, rnd(6, 14), 1.1);
    },
    fxHit(x, y) {
      for (let i = 0; i < 8; i++) spark(x, y, '#ffe9a0', 1.6, rnd(8, 18), 1.2);
    },

    // Effects advance with the simulation, not with the frame: the main loop
    // can run several updates for one draw, and particles must not pile up.
    step(aliens) {
      tick++;
      updateParts();
      pushTrails(aliens);
      if (shake > 0) shake *= 0.86;
      if (flash > 0) flash--;
    },

    // --- the frame -------------------------------------------------------
    render(api) {
      ensure(api.canvas, api.ctx);
      if (!sx) return;

      const g = sx;
      g.setTransform(1, 0, 0, 1, 0, 0);
      drawBackdrop(g);
      drawStars(g, api.scroll);

      const sh = shake > 0.15 ? shake : 0;
      g.save();
      if (sh) g.translate(rnd(-sh, sh) * RES, rnd(-sh, sh) * RES);

      if (api.mode !== 'attract' && api.mode !== 'select') {
        drawTrails(g, api.aliens);
        drawAliens(g, api.aliens);
        drawPlayer(g, api.px, api.py, api.shipVisible);
        for (const s of api.pshots) {
          bolt(g, s.x, s.y, 7, 1.5, 'rgba(120,255,255,0.95)', '#ffffff');
        }
        for (const b of api.eshots) {
          bolt(g, b.x, b.y, 5, 1.4, 'rgba(255,90,180,0.9)', '#ffe6f6');
        }
        for (const p of api.pops) {
          const k = p.t / 48;
          g.globalAlpha = Math.min(1, k * 2);
          label(g, String(p.v), p.x, p.y, 9, '#ffd9f4', 'center', '#ff5cc0');
          g.globalAlpha = 1;
        }
      }
      drawParts(g);
      g.restore();

      if (flash > 0) {
        g.fillStyle = flashCol + (flash / 14 * 0.35) + ')';
        g.fillRect(0, 0, VW, VH);
      }

      api.overlay(g, {
        label, wordmark, font, shipGlyph, chevron, art, SKIN, RES, VW, VH, tick,
      });

      drawHud(g, api);

      // vignette
      const vg = g.createRadialGradient(VW / 2, VH / 2, VH * 0.32,
                                        VW / 2, VH / 2, VH * 0.72);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,0.55)');
      g.fillStyle = vg;
      g.fillRect(0, 0, VW, VH);

      // --- compose: scene, then a blurred copy added back as bloom -------
      cx.setTransform(1, 0, 0, 1, 0, 0);
      cx.globalCompositeOperation = 'source-over';
      cx.globalAlpha = 1;
      cx.drawImage(scene, 0, 0);
      if (bx && canBlur) {
        bx.setTransform(1, 0, 0, 1, 0, 0);
        bx.globalCompositeOperation = 'source-over';
        bx.clearRect(0, 0, bloom.width, bloom.height);
        bx.filter = 'blur(3px)';
        bx.drawImage(scene, 0, 0, bloom.width, bloom.height);
        bx.filter = 'none';
        cx.globalCompositeOperation = 'lighter';
        cx.globalAlpha = 0.42;
        cx.drawImage(bloom, 0, 0, VW, VH);
        cx.globalAlpha = 1;
        cx.globalCompositeOperation = 'source-over';
      }
    },
  };
})();
