// -------------------------------------------------------------------------
//  GALAXIANS VECTOR -- a phosphor vector-monitor rendering.
//
//  The look of an XY display: no fills anywhere, everything is a stroked
//  outline drawn by a beam, with an overbright core, a soft halo, and short
//  phosphor persistence so fast movement smears.  Explosions come apart into
//  tumbling line fragments the way Asteroids does.
//
//  Exposes the same interface as Neo, and shares its audio, so the engine
//  treats the two modern versions identically.  The simulation is untouched.
// -------------------------------------------------------------------------
const Vec = (() => {
  const RES = 4;
  let VW = 0, VH = 0;

  let cx = null;
  let beam, bmx;                       // the persistent phosphor layer
  let bloom, bx;
  let canBlur = true;
  let inited = false;

  const parts = [];
  const angles = new Map();
  let shake = 0, flash = 0;
  let tick = 0;
  let starsArr = [];

  // its own random stream, so the simulation's sequence is never touched
  let seed = 0x51f3c9d;
  function nrand() {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  }
  const rnd = (a, b) => a + nrand() * (b - a);

  const TAU = Math.PI * 2;

  const HUE = {
    blue:   '#5cf0ff',
    purple: '#cc7cff',
    red:    '#ff7a4a',
    boss:   '#ffd24a',
  };
  const PLAYER_C = '#9dffd8';

  function mkCanvas(w, h) {
    const c = (typeof document !== 'undefined' && document.createElement)
      ? document.createElement('canvas') : null;
    if (!c) return null;
    c.width = w; c.height = h;
    return c;
  }

  // -----------------------------------------------------------------------
  //  shapes -- Vectrex sparse: one closed outline per object, few segments,
  //  and sized to sit inside the swarm's 16px column / 12px row pitch so
  //  neighbours never touch.
  // -----------------------------------------------------------------------

  // Sizes in game pixels.  Half-width * 2 must stay under 16, height under 12.
  const U_ALIEN = 5.2, U_BOSS = 6.2, U_PLAYER = 6.8;

  // A single silhouette: nose down, wings swept back, two short antennae
  // folded into the same outline rather than drawn as extra strokes.
  const ALIEN = [
    [0, 1.00], [0.42, 0.18], [1.00, -0.22], [0.66, -0.60], [0.26, -0.36],
    [0.17, -0.98], [-0.17, -0.98], [-0.26, -0.36], [-0.66, -0.60],
    [-1.00, -0.22], [-0.42, 0.18],
  ];
  // wings-in pose for the idle flap
  const ALIEN_F = [
    [0, 1.00], [0.38, 0.16], [0.80, -0.34], [0.56, -0.62], [0.24, -0.34],
    [0.17, -0.98], [-0.17, -0.98], [-0.24, -0.34], [-0.56, -0.62],
    [-0.80, -0.34], [-0.38, 0.16],
  ];
  const BOSS_INNER = [[0, 0.34], [0.22, 0], [0, -0.34], [-0.22, 0]];

  const PLAYER_SHAPE = [
    [0, -1.00], [0.22, -0.18], [0.92, 0.42], [0.40, 0.36],
    [0.30, 0.82], [-0.30, 0.82], [-0.40, 0.36], [-0.92, 0.42],
    [-0.22, -0.18],
  ];

  // Line weights, in game pixels -- a Vectrex beam is hairline.
  const W_CORE = 0.42, W_HALO = 1.15;

  // Every stroke sets its own alpha, so a caller that wants to fade a whole
  // object has to go through this rather than setting globalAlpha itself.
  let alphaMul = 1;

  function poly(g, pts, u, close, col, w, alpha) {
    g.strokeStyle = col;
    g.lineWidth = w;
    g.globalAlpha = alpha * alphaMul;
    g.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const x = pts[i][0] * u, y = pts[i][1] * u;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    if (close) g.closePath();
    g.stroke();
  }

  // A hairline core with a faint wide halo around it.  The halo is what makes
  // it look like light rather than ink; keep it dim or the shape fills in.
  function stroked(g, pts, u, close, col) {
    poly(g, pts, u, close, col, W_HALO * RES, 0.13);
    poly(g, pts, u, close, col, W_CORE * RES, 1);
  }

  function drawAlienShape(g, kind, u, flap, alpha) {
    const col = HUE[kind] || HUE.blue;
    alphaMul = alpha === undefined ? 1 : alpha;
    stroked(g, flap ? ALIEN_F : ALIEN, u, true, col);
    if (kind === 'boss') stroked(g, BOSS_INNER, u, true, '#fff2b0');
    alphaMul = 1;
  }

  function drawStars(g, scroll) {
    g.globalCompositeOperation = 'lighter';
    for (const s of starsArr) {
      let y = (s.y + scroll * s.sp) % 256;
      if (y < 0) y += 256;
      g.globalAlpha = s.br * (0.55 + 0.45 * Math.sin(tick * 0.05 + s.ph));
      g.fillStyle = '#cfeaff';
      g.fillRect(s.x * RES, y * RES, RES * 0.6, RES * 0.6);
    }
    g.globalAlpha = 1;
  }

  function makeStars() {
    starsArr = [];
    for (let i = 0; i < 120; i++) {
      starsArr.push({
        x: nrand() * 224, y: nrand() * 256,
        sp: 0.3 + nrand() * 1.0,
        br: 0.25 + nrand() * 0.5,
        ph: nrand() * TAU,
      });
    }
  }

  function ensure(canvasEl, ctx2d) {
    VW = 224 * RES; VH = 256 * RES;
    cx = ctx2d;
    if (inited) return;
    inited = true;
    beam = mkCanvas(VW, VH); bmx = beam && beam.getContext('2d');
    bloom = mkCanvas(VW >> 2, VH >> 2); bx = bloom && bloom.getContext('2d');
    if (bx) {
      try { bx.filter = 'blur(4px)'; canBlur = bx.filter === 'blur(4px)'; }
      catch (e) { canBlur = false; }
      bx.filter = 'none';
    }
    if (bmx) { bmx.lineCap = 'round'; bmx.lineJoin = 'round'; }
    makeStars();
  }

  // -----------------------------------------------------------------------
  //  effects -- everything is made of lines
  // -----------------------------------------------------------------------
  function frag(x, y, col, spd, life, len) {
    const a = nrand() * TAU, v = rnd(spd * 0.3, spd);
    parts.push({ t: 'frag', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
                 rot: nrand() * TAU, spin: rnd(-0.3, 0.3),
                 len, life, max: life, col });
  }

  function updateParts() {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      if (--p.life <= 0) { parts.splice(i, 1); continue; }
      if (p.t === 'frag') {
        p.x += p.vx; p.y += p.vy;
        p.vx *= 0.985; p.vy *= 0.985;
        p.rot += p.spin;
      } else if (p.t === 'ring') {
        p.r += (p.max - p.r) * 0.14;
      }
    }
  }

  function drawParts(g) {
    g.globalCompositeOperation = 'lighter';
    for (const p of parts) {
      const k = p.life / p.max;
      if (p.t === 'frag') {
        g.save();
        g.translate(p.x * RES, p.y * RES);
        g.rotate(p.rot);
        const pts = [[-p.len, 0], [p.len, 0]];
        poly(g, pts, RES, false, p.col, W_HALO * RES, k * 0.14);
        poly(g, pts, RES, false, p.col, W_CORE * RES, k);
        g.restore();
      } else if (p.t === 'ring') {
        // a polygon, not a circle -- vector hardware had no curves
        const n = 14, pts = [];
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU + p.rot;
          pts.push([p.x + Math.cos(a) * p.r, p.y + Math.sin(a) * p.r]);
        }
        poly(g, pts, RES, true, p.col, W_HALO * RES, k * k * 0.12);
        poly(g, pts, RES, true, p.col, W_CORE * RES, k * k * 0.9);
      }
    }
    g.globalAlpha = 1;
  }

  function facingOf(a) {
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

  function hud(g, api) {
    const { p0, p1, hi, two, cur, mode, lives, stage } = api;
    g.globalCompositeOperation = 'lighter';
    g.lineJoin = 'round';

    const put = (s, x, y, px, col, align) => {
      g.font = `700 ${px * RES}px "Inter", system-ui, -apple-system, sans-serif`;
      try { g.letterSpacing = `${0.12 * px * RES}px`; } catch (e) {}
      g.textAlign = align || 'left';
      g.lineWidth = Math.max(1, px * RES * 0.09);
      g.strokeStyle = col;
      g.globalAlpha = 0.25;
      g.lineWidth = Math.max(1, px * RES * 0.24);
      g.strokeText(s, x * RES, y * RES);
      g.globalAlpha = 1;
      g.lineWidth = Math.max(1, px * RES * 0.09);
      g.strokeText(s, x * RES, y * RES);
      try { g.letterSpacing = '0px'; } catch (e) {}
    };

    const blink = (tick >> 4) & 1;
    const live = mode !== 'attract' && mode !== 'select';
    if (!(live && cur === 0 && blink)) put('1UP', 12, 9, 6, '#7fe8ff');
    put('HIGH', 112, 9, 6, '#ff9ad8', 'center');
    if (two && !(live && cur === 1 && blink)) put('2UP', 212, 9, 6, '#7fe8ff', 'right');
    put(String(p0).padStart(6, '0'), 12, 19, 8, '#dffaff');
    put(String(hi).padStart(6, '0'), 112, 19, 8, '#ffd9f2', 'center');
    if (two) put(String(p1).padStart(6, '0'), 212, 19, 8, '#dffaff', 'right');

    // reserve ships, drawn as the real outline at badge size
    for (let i = 0; i < Math.min(5, Math.max(0, lives - 1)); i++) {
      g.save();
      g.translate((10 + i * 12) * RES, 247 * RES);
      stroked(g, PLAYER_SHAPE, 3.6 * RES, true, PLAYER_C);
      g.restore();
    }

    let tens = Math.floor(stage / 10), ones = stage % 10;
    if (tens > 5) { tens = 5; ones = 0; }
    let x = 214;
    const tick10 = [[0, -2.6], [2.4, 2.2], [-2.4, 2.2]];
    for (let i = 0; i < ones; i++) {
      g.save(); g.translate(x * RES, 247 * RES);
      stroked(g, tick10, RES, true, '#5cf0ff'); g.restore(); x -= 8;
    }
    for (let i = 0; i < tens; i++) {
      g.save(); g.translate(x * RES, 247 * RES); g.scale(1.6, 1.6);
      stroked(g, tick10, RES, true, '#ffd24a'); g.restore(); x -= 13;
    }
    g.globalAlpha = 1;
  }

  function wordmark(g, y) {
    g.globalCompositeOperation = 'lighter';
    g.font = `800 ${24 * RES}px "Inter", system-ui, -apple-system, sans-serif`;
    try { g.letterSpacing = `${3 * RES}px`; } catch (e) {}
    g.textAlign = 'center';
    g.strokeStyle = '#7fffd8';
    g.globalAlpha = 0.22;
    g.lineWidth = 5 * RES * 0.55;
    g.strokeText('GALAXIANS', 112 * RES, y * RES);
    g.globalAlpha = 1;
    g.lineWidth = 1.7 * RES * 0.55;
    g.strokeText('GALAXIANS', 112 * RES, y * RES);
    g.font = `500 ${10 * RES}px "Inter", system-ui, sans-serif`;
    g.lineWidth = 1.1 * RES * 0.55;
    g.strokeStyle = '#9dffd8';
    g.strokeText('V E C T O R', 112 * RES, (y + 16) * RES);
    try { g.letterSpacing = '0px'; } catch (e) {}
  }

  function label(g, s, x, y, px, col, align) {
    g.globalCompositeOperation = 'lighter';
    g.font = `700 ${px * RES}px "Inter", system-ui, -apple-system, sans-serif`;
    try { g.letterSpacing = `${0.12 * px * RES}px`; } catch (e) {}
    g.textAlign = align || 'left';
    g.strokeStyle = col;
    g.globalAlpha = 0.22;
    g.lineWidth = Math.max(1, px * RES * 0.26);
    g.strokeText(s, x * RES, y * RES);
    g.globalAlpha = 1;
    g.lineWidth = Math.max(1, px * RES * 0.10);
    g.strokeText(s, x * RES, y * RES);
    try { g.letterSpacing = '0px'; } catch (e) {}
  }

  return {
    RES,
    ensure,
    reset() { parts.length = 0; angles.clear(); shake = 0; flash = 0;
              if (bmx) bmx.clearRect(0, 0, VW, VH); },

    step(aliens) {
      tick++;
      updateParts();
      if (shake > 0) shake *= 0.86;
      if (flash > 0) flash--;
    },

    fxBoom(x, y, big, kind) {
      const col = HUE[kind] || HUE.blue;
      parts.push({ t: 'ring', x, y, r: 1, max: big ? 34 : 15,
                   life: big ? 30 : 18, col: big ? '#ffffff' : col,
                   rot: nrand() * TAU });
      const n = big ? 26 : (kind === 'boss' ? 14 : 8);
      for (let i = 0; i < n; i++) {
        frag(x, y, col, big ? 2.2 : 1.3, rnd(24, big ? 80 : 46),
             rnd(1.4, big ? 4 : 2.6));
      }
      shake = Math.max(shake, big ? 12 : (kind === 'boss' ? 5 : 2));
      if (big) flash = 10;
    },
    fxShot(x, y) { },
    fxHit(x, y) { for (let i = 0; i < 4; i++) frag(x, y, '#ffffff', 1.2, 10, 1.2); },

    render(api) {
      ensure(api.canvas, api.ctx);
      if (!bmx) return;
      const g = bmx;
      g.setTransform(1, 0, 0, 1, 0, 0);

      // phosphor decay: never a hard clear, so the beam leaves a short trail
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 1;
      g.fillStyle = 'rgba(0,0,0,0.52)';
      g.fillRect(0, 0, VW, VH);

      g.globalCompositeOperation = 'lighter';
      drawStars(g, api.scroll);

      const sh = shake > 0.15 ? shake : 0;
      g.save();
      if (sh) g.translate(rnd(-sh, sh) * RES, rnd(-sh, sh) * RES);

      if (api.mode !== 'attract' && api.mode !== 'select') {
        for (const a of api.aliens) {
          if (!a.alive) continue;
          const u = (a.kind === 'boss' ? U_BOSS : U_ALIEN) * RES;
          const ang = a.state === 'form'
            ? Math.sin(tick * 0.04 + a.col * 0.7) * 0.04 : facingOf(a);
          const flap = a.state === 'form'
            ? (((tick >> 4) & 1) ? 1 : 0) : (((tick >> 3) & 1) ? 1 : 0);
          g.save();
          g.translate(a.x * RES, a.y * RES);
          g.rotate(ang);
          drawAlienShape(g, a.kind, u, flap);
          g.restore();
        }

        if (api.shipVisible) {
          g.save();
          g.translate(api.px * RES, api.py * RES);
          stroked(g, PLAYER_SHAPE, U_PLAYER * RES, true, PLAYER_C);
          // thrust, two short flickering strokes
          const f = 1 + Math.sin(tick * 0.8) * 0.3;
          for (const side of [-1, 1]) {
            poly(g, [[side * 0.16, 0.84], [side * 0.16, 0.84 + 0.5 * f]],
                 U_PLAYER * RES, false, '#8ff0ff', W_CORE * RES, 0.85);
          }
          g.restore();
        }

        for (const b of api.pshots) {
          const s = [[b.x, b.y - 4], [b.x, b.y + 4]];
          poly(g, s, RES, false, '#ffffff', W_HALO * RES, 0.2);
          poly(g, s, RES, false, '#ffffff', W_CORE * RES, 1);
        }
        for (const b of api.eshots) {
          const s = [[b.x, b.y - 3], [b.x, b.y + 3]];
          poly(g, s, RES, false, '#ff7ab0', W_HALO * RES, 0.2);
          poly(g, s, RES, false, '#ffd0e6', W_CORE * RES, 1);
        }
        for (const p of api.pops) {
          label(g, String(p.v), p.x, p.y, 9, '#ffb0e0', 'center');
        }
      }
      drawParts(g);
      g.restore();
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';

      // --- compose ------------------------------------------------------
      cx.setTransform(1, 0, 0, 1, 0, 0);
      cx.globalCompositeOperation = 'source-over';
      cx.globalAlpha = 1;
      cx.fillStyle = '#000';
      cx.fillRect(0, 0, VW, VH);
      cx.drawImage(beam, 0, 0);
      if (bx && canBlur) {
        bx.setTransform(1, 0, 0, 1, 0, 0);
        bx.globalCompositeOperation = 'source-over';
        bx.clearRect(0, 0, bloom.width, bloom.height);
        bx.filter = 'blur(4px)';
        bx.drawImage(beam, 0, 0, bloom.width, bloom.height);
        bx.filter = 'none';
        cx.globalCompositeOperation = 'lighter';
        cx.globalAlpha = 0.5;
        cx.drawImage(bloom, 0, 0, VW, VH);
        cx.globalAlpha = 1;
        cx.globalCompositeOperation = 'source-over';
      }

      // Text and HUD are drawn after the composite, straight onto the output.
      // Put them on the beam layer and the phosphor decay smears them into an
      // unreadable ghost.
      cx.save();
      api.overlay(cx, { label, wordmark, RES, VW, VH, tick,
                        stroked, HUE, drawAlienShape });
      hud(cx, api);
      cx.restore();
      cx.globalAlpha = 1;
      cx.globalCompositeOperation = 'source-over';

      if (flash > 0) {
        cx.fillStyle = 'rgba(255,255,255,' + (flash / 30) + ')';
        cx.fillRect(0, 0, VW, VH);
      }
    },
  };
})();
