// -------------------------------------------------------------------------
//  Galaxian -- a pixel-faithful homage to the 1979 Namco arcade machine.
//
//  Renders at the cabinet's native 224x256 portrait resolution, one game pixel
//  to one canvas pixel.  Sprites and font come from src/art.js and were
//  extracted from the arcade graphics; the rules below follow the cabinet.
//
//  Non-commercial hobby project.  Contains no ROM data.
// -------------------------------------------------------------------------

const W = 224, H = 256;

// --- playfield geometry ----------------------------------------------------
// Every figure here is taken from the ROM, via Scott Tunstall's disassembly.
// The machine works in a rotated frame (its X runs down the screen, its Y
// across); these are already converted to screen coordinates.
//
//   swarm rows      X = 124 - row*3/4  ->  40, 52, 64, 76, 88, 100   ($1147)
//   swarm columns   Y = scroll + col*16 + 7                          ($1147)
//   player ship     drawn as 2x2 tiles at tile row 28  ->  y 224..239  ($219B)
//   status row      drawn at tile row 30               ->  y 240..255  ($22B3)
const HDR_H = 16;                  // 1UP / HIGH SCORE / 2UP band
const STATUS_Y = 240;              // lives and stage flags
const PLAY_BOT = 240;

const PLAYER_Y = 232;              // centre line of the ship, so it spans 224..239
const PLAYER_MIN = 10, PLAYER_MAX = W - 10;
const PLAYER_SPEED = 1.15;

// --- the formation ---------------------------------------------------------
// 46 aliens: 2 flagships, 6 red, 8 purple, 30 blue.  Ten columns on a 16px
// pitch, six rows on a 12px pitch, top row at y=40.
const COLS = 10, COLW = 16, ROWH = 12;
const FORM_LEFT = 32;                       // left edge of column 0
const FORM_TOP = 40;
const colX = c => FORM_LEFT + COLW * c + 8; // column centre, before sway
const rowY = r => FORM_TOP + ROWH * r;

const LAYOUT = [
  { row: 0, kind: 'boss',   cols: [4, 5] },
  { row: 1, kind: 'red',    cols: [2, 3, 4, 5, 6, 7] },
  { row: 2, kind: 'purple', cols: [1, 2, 3, 4, 5, 6, 7, 8] },
  { row: 3, kind: 'blue',   cols: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] },
  { row: 4, kind: 'blue',   cols: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] },
  { row: 5, kind: 'blue',   cols: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] },
];

const FORM_AMP = 24;               // how far the formation sways either way
const FORM_SPEED = 0.28;

// --- scoring ---------------------------------------------------------------
// Straight off the cabinet: in formation / while diving.
const KIND = {
  blue:   { form: 30, dive: 60 },
  purple: { form: 40, dive: 80 },
  red:    { form: 50, dive: 100 },
  boss:   { form: 60, dive: 150 },
};
// The flagship's diving value depends on its escorts -- see bossPoints().
const EXTRA_LIFE_AT = 7000;        // cabinet DIP default
const START_LIVES = 3;

// --- combat ----------------------------------------------------------------
const PSHOT_SPEED = 5;             // the player gets exactly one shot on screen
const ESHOT_SPEED = 1.9;
const MAX_ESHOTS = 3;              // later-ROM behaviour

// -------------------------------------------------------------------------
//  GALAXIAN X -- the rules layer
//
//  X is the fourth presentation, and the only one that changes the rules:
//  skill tiers, power-ups, multi-shot weapons, a shield and a kill combo.
//  All of it hangs off `xr()`, which is null unless the X skin is live, so the
//  other three versions run literally the same code path they always did and
//  the frame-for-frame identity between them still holds.
//
//  The flight model is not touched at all -- launch order, the arc table, the
//  cosine sweep, the bombing heights and the convoy are shared verbatim.
// -------------------------------------------------------------------------
const SKILLS = [
  { name: 'ROOKIE', note: 'FORGIVING',
    lives: 5, eshotMul: 0.80, maxEshots: 2, delayMul: 1.40, bossMul: 0.75,
    attackers: 0, dropRate: 0.34, scoreMul: 1, fireMul: -1 },
  { name: 'PILOT', note: 'ARCADE PACE',
    lives: 3, eshotMul: 1.00, maxEshots: 3, delayMul: 1.00, bossMul: 1.00,
    attackers: 1, dropRate: 0.24, scoreMul: 2, fireMul: 0 },
  { name: 'ACE', note: 'HEAVY PRESSURE',
    lives: 3, eshotMul: 1.18, maxEshots: 4, delayMul: 0.70, bossMul: 1.40,
    attackers: 2, dropRate: 0.17, scoreMul: 3, fireMul: 1 },
  { name: 'LEGEND', note: 'NO QUARTER',
    lives: 2, eshotMul: 1.36, maxEshots: 6, delayMul: 0.48, bossMul: 1.75,
    attackers: 3, dropRate: 0.12, scoreMul: 5, fireMul: 2 },
];

// Power-ups fall from a kill and are collected by flying into them.
//   beam    permanent weapon tier, up to three
//   rapid   timed: shorter cooldown and more bolts in the air
//   shield  a charge that soaks one hit, two can be stacked
//   nova    instant: every diver in the air is destroyed
//   score   timed: doubles everything on top of the skill multiplier
const POWERUPS = [
  { key: 'beam',   glyph: 'W', name: 'BEAM UP',   time: 0,   col: '#4bd2ff', w: 5 },
  { key: 'rapid',  glyph: 'R', name: 'RAPID',     time: 600, col: '#ffd24a', w: 4 },
  { key: 'shield', glyph: 'S', name: 'SHIELD',    time: 0,   col: '#7dffc4', w: 4 },
  { key: 'score',  glyph: 'X', name: 'DOUBLE',    time: 900, col: '#ff5cc0', w: 3 },
  { key: 'nova',   glyph: 'N', name: 'NOVA',      time: 0,   col: '#ffffff', w: 2 },
];
// A collected pod is not spent on pickup: it goes into a three-slot hold.
// `C` cycles the hold, `X` spends the selected pod -- and spending one hands
// the swarm an upgrade of its own, which is usually a different kind of thing
// to the one you just took.  Arming yourself arms them.
const HOLD_MAX = 3;

const ENEMY_UPGRADES = [
  { key: 'barrage',  name: 'BARRAGE',  note: 'MORE BOMBS',      max: 3 },
  { key: 'swarm',    name: 'SWARM',    note: 'MORE ATTACKERS',  max: 3 },
  { key: 'velocity', name: 'VELOCITY', note: 'FASTER ATTACKS',  max: 3 },
  { key: 'vanguard', name: 'VANGUARD', note: 'FLAGSHIPS PRESS', max: 3 },
  { key: 'armour',   name: 'ARMOUR',   note: 'HULL PLATING',    max: 2 },
];
const ARMOUR_HP = 3;               // most hits an alien can ever need

const DROP_SPEED = 0.62;
const MAX_WEAPON = 3;
const SHIELD_MAX = 2;
const INVULN = 96;                 // frames of mercy after a shield soaks a hit
const COMBO_HOLD = 170;            // a combo lapses if nothing dies for this long
const COMBO_MAX = 8;
const XPSHOT_SPEED = 6.2;
const X_COOL = [11, 8, 6];         // frames between shots, by weapon tier
const X_INFLIGHT = [2, 3, 4];      // player bolts allowed on screen, by tier

// -------------------------------------------------------------------------
//  attack flight model -- reproduced from the ROM
//
//  An attacking alien lives through a small state machine ($0CD6):
//    packs bags -> flies in arc -> ready to attack -> attacking ->
//    near bottom -> reached bottom -> returning to swarm.
//
//  The peel-off is a table-driven half-loop that climbs 16px and shifts 32px
//  sideways over 51 frames.  The dive itself is not homing at all: the alien
//  descends at a constant 1px per frame while its horizontal offset from a
//  fixed pivot is swept by a fixed-point circle generator, so the path is a
//  cosine.  The sweep radius is chosen once, at launch, from how far the alien
//  is from the player.
// -------------------------------------------------------------------------

// INFLIGHT_ALIEN_ARC_TABLE @ $1E00 -- 51 pairs of [vertical, horizontal] steps.
// Vertical is signed and starts negative, so the alien climbs before it dives;
// horizontal is 0 or 1 and is applied left or right depending on the flank.
const ARC_TABLE = [
  [-1,0],[-1,0],[-1,0],[-1,1],[-1,0],[-1,0],[-1,1],[-1,0],[-1,1],[-1,0],
  [0,1],[-1,0],[-1,1],[0,1],[-1,0],[0,1],[-1,1],[0,1],[-1,1],[0,1],
  [0,1],[-1,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[1,1],[0,1],
  [0,1],[1,1],[0,1],[1,1],[0,1],[1,0],[0,1],[1,1],[1,0],[0,1],
  [1,0],[1,1],[1,0],[1,1],[1,0],[1,0],[1,1],[1,0],[1,0],[1,0],[1,0],
];
const ARC_ANIM_STEPS = 12;         // sprite rotates 12 times across the arc
const ARC_ANIM_TICKS = 4;          // ... one step every 4 frames  ($0D99)

// Sweep radius: |alien - player| / 2 + 16, clamped to 48..112  ($0DE7)
const SWEEP_MIN = 48, SWEEP_MAX = 112, SWEEP_BIAS = 16;
// The circle generator advances 1/128 radian per sub-step  ($116B)
const SWEEP_STEP = 1 / 128;

const NEAR_BOTTOM_Y = 184;         // X + $48 carries  ($0E43)
const REENTRY_Y = 8;               // back in at the very top  ($0E99)
const BOTTOM_Y = 256;              // it leaves by running off the bottom ($0E77)
// The machine keeps the across-screen coordinate in a single byte, so there is
// roughly 32px of room past each edge before it wraps and the alien is treated
// as gone ($0E3A).  A sweep can therefore carry a diver off the side and bring
// it back, which is a large part of how the attacks look.
const SIDE_MARGIN = 34;

// Per-row sweep rate, from the table at $1DD1: the ROM stores a "speed" of
// 0..3 per swarm row and takes (speed & 3) + 1 circle-generator sub-steps per
// frame.  Rows here are top-down, so: flagship, red, purple, blue, blue, blue.
const ROW_SUBSTEPS = [3, 3, 4, 2, 3, 2];

// A diver fires only when its descent reaches an exact height, or that height
// less a multiple of 25 -- which is why Galaxian's bombing is so sparse and
// so predictable.  $9D = 157, and the multiplier grows as rows are cleared.
const FIRE_AT_Y = 157, FIRE_STEP = 25;

// -------------------------------------------------------------------------
//  framebuffer
// -------------------------------------------------------------------------
const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d', { alpha: false });
const img = ctx.createImageData(W, H);
const buf = new Uint32Array(img.data.buffer);

// palette char -> packed ABGR
const COL = {};
for (const k in PALETTE) {
  const h = PALETTE[k];
  const r = parseInt(h.slice(1, 3), 16);
  const g = parseInt(h.slice(3, 5), 16);
  const b = parseInt(h.slice(5, 7), 16);
  COL[k] = (255 << 24) | (b << 16) | (g << 8) | r;
}
const rgb = (r, g, b) => (255 << 24) | (b << 16) | (g << 8) | r;
const BLACK = rgb(0, 0, 0);

function clear() { buf.fill(BLACK); }

function fill(x0, y0, w, h, c) {
  for (let y = y0; y < y0 + h; y++) {
    if (y < 0 || y >= H) continue;
    for (let x = x0; x < x0 + w; x++) {
      if (x < 0 || x >= W) continue;
      buf[y * W + x] = c;
    }
  }
}

const sw = a => a[0].length;
const sh = a => a.length;

// Draw a palette-char sprite with its top-left at (x,y).  `remap` swaps
// palette chars, which is how one sprite serves several colours.
function blit(art, x, y, remap) {
  for (let j = 0; j < art.length; j++) {
    const row = art[j];
    const py = y + j;
    if (py < 0 || py >= H) continue;
    for (let i = 0; i < row.length; i++) {
      let ch = row[i];
      if (ch === '.') continue;
      if (remap && remap[ch]) ch = remap[ch];
      const c = COL[ch];
      if (c === undefined) continue;
      const px = x + i;
      if (px < 0 || px >= W) continue;
      buf[py * W + px] = c;
    }
  }
}

// Centred blit -- every moving entity is positioned by its centre so that
// frames of different sizes stay registered with one another.
function blitC(art, cx, cy, remap) {
  blit(art, Math.round(cx - sw(art) / 2), Math.round(cy - sh(art) / 2), remap);
}

function mirror(art) {
  return art.map(r => r.split('').reverse().join(''));
}
function flipV(art) { return art.slice().reverse(); }

// --- text ------------------------------------------------------------------
function text(s, x, y, c) {
  const col = COL[c] || COL.w;
  for (let n = 0; n < s.length; n++) {
    const g = FONT[s[n]];
    if (!g) continue;
    for (let j = 0; j < 8; j++) {
      const py = y + j;
      if (py < 0 || py >= H) continue;
      const row = g[j];
      for (let i = 0; i < 8; i++) {
        if (row[i] === '#') {
          const px = x + n * 8 + i;
          if (px >= 0 && px < W) buf[py * W + px] = col;
        }
      }
    }
  }
}
const textC = (s, y, c) => text(s, Math.round((W - s.length * 8) / 2), y, c);
const textR = (s, xEnd, y, c) => text(s, xEnd - s.length * 8, y, c);
const pad = (n, d) => String(Math.max(0, Math.min(999999, n))).padStart(d, '0');

// -------------------------------------------------------------------------
//  sprite tables
// -------------------------------------------------------------------------
// The machine stores a facing as a 24-step angle and picks one of seven
// quarter-turn sprites, flipping it horizontally and/or vertically to reach
// all 24 directions ($0C3D).  Step 0 is head-on, step 6 is side-on, step 12
// is facing straight back up the screen -- which is why an alien peeling out
// of the swarm needs the vertical flip.
const ROT_STEPS = 24;
const FRAMES = {};
for (const k of ['red', 'purple', 'blue', 'boss']) {
  const flap = k === 'boss'
    ? [ART.boss_flap0]
    : [ART[k + '_flap0'], ART[k + '_flap1'], ART[k + '_flap2']];
  const bank = [0, 1, 2, 3, 4, 5].map(i => ART[k + '_bank' + i]);
  // rot[0] is head-on, rot[1..6] bank round to side-on
  const rot = [flap[0]].concat(bank);
  FRAMES[k] = {
    flap, bank, rot,
    rotH: rot.map(mirror),
    rotV: rot.map(flipV),
    rotHV: rot.map(a => flipV(mirror(a))),
  };
}
const BOOM = [ART.boom0, ART.boom1, ART.boom2, ART.boom3];
const BIGBOOM = [ART.bigboom0, ART.bigboom1, ART.bigboom2, ART.bigboom3];
const SCORE_ART = { 150: ART.score150, 200: ART.score200,
                    300: ART.score300, 800: ART.score800 };

// Pick the sprite for a facing given as a 24-step angle, where 0 points down
// the screen (straight at the player), +6 is due right and +-12 is straight
// up.  Magnitudes past 6 are the mirror of (12 - m) flipped vertically.
function rotArt(kind, step) {
  const F = FRAMES[kind];
  let k = ((Math.round(step) % ROT_STEPS) + ROT_STEPS) % ROT_STEPS;
  if (k > 12) k -= ROT_STEPS;                // fold to -11..12
  const left = k < 0;
  const m = Math.abs(k);
  const up = m > 6;
  const i = up ? 12 - m : m;                 // 0..6 into the quarter turn
  if (up) return left ? F.rotHV[i] : F.rotV[i];
  return left ? F.rotH[i] : F.rot[i];
}

function alienArt(a) {
  const F = FRAMES[a.kind];
  // in the swarm the aliens just flap their wings
  if (a.state === 'form') return F.flap[(S.tick >> 3) % F.flap.length];
  return rotArt(a.kind, a.face);
}

// -------------------------------------------------------------------------
//  starfield
//
//  The cabinet generates its stars in hardware from a long shift register,
//  giving a fixed, non-repeating-looking field that scrolls and twinkles.
//  This is a reconstruction of that behaviour -- a 17-bit maximal LFSR walked
//  once at load to place the stars -- not the hardware's exact sequence.
// -------------------------------------------------------------------------
const STAR_COLS = ['w', 'r', 'Y', 'c', 'B', 'm', 'o', 'G'];
const FIELD_H = 512;
const STARS = [];
(function makeStars() {
  let sr = 0x1c37b;
  for (let i = 0; i < FIELD_H * W; i++) {
    // one star roughly every 512 cells
    if ((sr & 0x1ff) === 0x1ff) {
      STARS.push({
        x: i % W,
        y: (i / W) | 0,
        c: STAR_COLS[(sr >> 9) & 7],
        ph: (sr >> 12) & 7,
      });
    }
    const bit = ((sr >> 0) ^ (sr >> 3)) & 1;      // x^17 + x^14 + 1
    sr = (sr >>> 1) | (bit << 16);
  }
})();

function drawStars() {
  const off = S.scroll | 0;
  const t = S.tick >> 4;
  for (let i = 0; i < STARS.length; i++) {
    const s = STARS[i];
    // twinkle: each star sits out two beats in eight
    if (((t + s.ph) & 7) >= 6) continue;
    let y = s.y - off;
    y %= FIELD_H;
    if (y < 0) y += FIELD_H;
    if (y < HDR_H || y >= PLAY_BOT) continue;
    buf[y * W + s.x] = COL[s.c];
  }
}

// -------------------------------------------------------------------------
//  state
// -------------------------------------------------------------------------
const MODE = {
  SELECT: 'select', SKILL: 'skill', KEYS: 'keys',
  ATTRACT: 'attract', READY: 'ready', PLAY: 'play',
  DYING: 'dying', CLEAR: 'clear', OVER: 'over',
};

// Four presentations over one simulation.  'retro' is the arcade renderer and
// the chiptune; 'neo' is the 2026 renderer and soundtrack; 'vector' is the
// phosphor display.  update() never looks at any of them, so those three are
// the identical game.  'x' is the landscape build, and is the one version that
// also adds rules -- see xr().
const SKINS = ['retro', 'neo', 'vector', 'x'];
function loadSkin() {
  try {
    const v = localStorage.getItem('galaxian.skin');
    return SKINS.indexOf(v) >= 0 ? v : 'retro';
  } catch (e) { return 'retro'; }
}
function saveSkin(v) {
  try { localStorage.setItem('galaxian.skin', v); } catch (e) {}
}

// Which module draws the frame.  Every modern skin exposes the same interface.
function renderer() {
  if (S.skin === 'neo') return typeof Neo !== 'undefined' ? Neo : null;
  if (S.skin === 'vector') return typeof Vec !== 'undefined' ? Vec : null;
  if (S.skin === 'x') return typeof Xr !== 'undefined' ? Xr : null;
  return null;
}
const isModern = () => renderer() !== null;

// The X rules layer, or null.  Every rule X adds is written as an explicit
// branch on this, never as an arithmetic tweak to the shared path, so the
// classic versions execute unchanged instructions rather than "the same sum
// times one".
const xr = () => (S.skin === 'x' ? XRULES : null);
const XRULES = { on: true };
const skill = () => SKILLS[Math.max(0, Math.min(SKILLS.length - 1, S.skill | 0))];

// The sound banks share an interface too; both modern skins use the 2026 one.
const A = () => (S.skin !== 'retro' && typeof NeoAudio !== 'undefined')
  ? NeoAudio : Sfx;

function audioInit() {
  Sfx.init();
  if (typeof NeoAudio !== 'undefined') NeoAudio.init();
  applyMute();
}
function applyMute() {
  if (Sfx.setMuted) Sfx.setMuted(S.muted);
  if (typeof NeoAudio !== 'undefined') NeoAudio.setMuted(S.muted);
}
function toggleMute() {
  S.muted = !S.muted;
  applyMute();
}

// Switching presentation resizes the backing store: the arcade renderer wants
// one canvas pixel per game pixel, the 2026 and vector ones want four, and X
// wants the whole window because it composes a landscape scene around the
// playfield rather than inside it.
function applySkin(v) {
  const changed = S.skin !== v;
  S.skin = v;
  saveSkin(v);
  S.hi = loadHi();                  // X keeps its own table -- see loadHi()
  const R = renderer();
  const body = typeof document !== 'undefined' ? document.body : null;
  if (R && R.FULL) {
    if (body && body.classList) body.classList.add('full');
    sizeFull(R);
  } else {
    if (body && body.classList) body.classList.remove('full');
    const w = R ? 224 * R.RES : W;
    const h = R ? 256 * R.RES : H;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h;
    }
  }
  canvas.style.imageRendering = R ? 'auto' : 'pixelated';
  if (R) R.reset();
  if (changed) {
    // hand the soundtrack over to whichever bank is now live
    Sfx.thrumOff();
    if (typeof NeoAudio !== 'undefined') NeoAudio.thrumOff();
    if (typeof NeoAudio !== 'undefined') NeoAudio.setComplex(v === 'x');
    A().setTrack(P().stage);
    if (S.mode === MODE.PLAY) A().thrumOn();
  }
  fitCanvas();
}

// X sizes its backing store to the window, capped at 2x device pixels so a
// 5K display does not ask for a 30-megapixel buffer every frame.
function sizeFull(R) {
  if (typeof innerWidth !== 'number' || typeof innerHeight !== 'number') return;
  const dpr = Math.min(2, (typeof devicePixelRatio === 'number'
                            ? devicePixelRatio : 1) || 1);
  const w = Math.max(480, Math.round(innerWidth * dpr));
  const h = Math.max(320, Math.round(innerHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w; canvas.height = h;
    if (R.resize) R.resize(w, h);
  }
  canvas.style.width = innerWidth + 'px';
  canvas.style.height = innerHeight + 'px';
}

// Effect hooks.  The arcade renderer ignores them; the modern ones turn them
// into particles, shockwaves, line debris and screen shake.
const Fx = {
  boom(x, y, big, kind) { const R = renderer(); if (R) R.fxBoom(x, y, big, kind); },
  shot(x, y) { const R = renderer(); if (R) R.fxShot(x, y); },
  hit(x, y) { const R = renderer(); if (R) R.fxHit(x, y); },
  // X-only cues.  A renderer that does not implement fxX simply never sees them.
  x(kind, a, b, c) { const R = renderer(); if (R && R.fxX) R.fxX(kind, a, b, c); },
};

// X scores on a different curve -- skill multipliers, combos and a doubler --
// so it keeps its own table rather than flooding the arcade high score.
const hiKey = () => (S.skin === 'x' ? 'galaxian.hi.x' : 'galaxian.hi');
function loadHi() {
  try { return parseInt(localStorage.getItem(hiKey()) || '0', 10) || 0; }
  catch (e) { return 0; }
}
function saveHi(v) {
  try { localStorage.setItem(hiKey(), String(v)); } catch (e) {}
}
function loadSkill() {
  try {
    const n = parseInt(localStorage.getItem('galaxian.skill') || '1', 10);
    return n >= 0 && n < SKILLS.length ? n : 1;
  } catch (e) { return 1; }
}
function saveSkill(n) {
  try { localStorage.setItem('galaxian.skill', String(n)); } catch (e) {}
}

const startLives = () => (xr() ? skill().lives : START_LIVES);

function newPlayer() {
  return { score: 0, lives: startLives(), stage: 1, extra: false,
           extraDiff: 0, aliens: null, alive: true };
}

const S = {
  mode: MODE.ATTRACT,
  // `timer` counts down the current mode; `demoLeft` is the attract demo's own
  // clock and must stay separate, or a READY->PLAY transition zeroes the demo.
  tick: 0, scroll: 0, timer: 0, demoLeft: 0,
  hi: loadHi(),
  players: [],                  // filled in below: newPlayer() reads S.skin
  cur: 0,
  twoPlayer: false,
  demo: false,

  aliens: [],
  formX: 0, formDir: 1,
  px: W / 2,
  pshots: [],
  eshots: [],
  booms: [],
  pops: [],
  diveTimer: 0,
  groupSeq: 0,
  // shooting a flagship in flight leaves the swarm too shaken to launch
  // anything for a while ($422B/$422C)
  shock: 0,
  flagshipHit: false,

  attractPage: 0,
  paused: false,

  skin: 'retro',
  selIdx: 0,
  muted: false,

  // key bindings and the screen that edits them
  binds: null,
  keyIdx: 0, keySlot: 0, keyWait: false, keyFrom: 'select',

  // --- X only ---------------------------------------------------------
  skill: 1, skillIdx: 1, pendingTwo: false,
  drops: [], weapon: 0, shield: 0, inv: 0, pcool: 0,
  rapid: 0, dbl: 0, combo: 0, comboT: 0, banner: null, bannerT: 0,
  hold: [], holdSel: 0,           // the three-slot pod hold
  eup: {}, ebanner: null, ebannerT: 0,
};

function resetEnemyUpgrades() {
  S.eup = {};
  for (const e of ENEMY_UPGRADES) S.eup[e.key] = 0;
}
resetEnemyUpgrades();
const eup = k => (xr() ? (S.eup[k] | 0) : 0);

// The rest of the engine says `S.pshot` in a dozen places and means "the one
// shot the cabinet allows".  X allows several, so the single slot became the
// head of a list; keeping the old name as an accessor means the classic path
// reads and writes exactly what it always did.
Object.defineProperty(S, 'pshot', {
  get() { return this.pshots.length ? this.pshots[0] : null; },
  set(v) { if (v) this.pshots = [v]; else this.pshots.length = 0; },
});

// newPlayer() asks the skin how many ships a run starts with, so the first
// one can only be made once S itself exists.
S.players = [newPlayer()];

const P = () => S.players[S.cur];

// -------------------------------------------------------------------------
//  formation
// -------------------------------------------------------------------------
function buildFormation() {
  const list = [];
  for (const band of LAYOUT) {
    for (const c of band.cols) {
      list.push({
        kind: band.kind, col: c, row: band.row,
        alive: true, state: 'form',
        x: colX(c), y: rowY(band.row),
        face: 0,                       // 24-step facing, 0 = straight down
        hp: 1, flash: 0,               // X only: ARMOUR plating and its tell
        arcI: 0, arcCW: 0, arcT: 0, arcLeft: 0,
        pivot: 0, hh: 0, ll: 0,        // circle generator: offset and its rate
        sub: 2, sortie: 0, fired: 0,
        group: null, isEscort: false,
      });
    }
  }
  return list;
}

const slotX = a => colX(a.col) + S.formX;
const slotY = a => rowY(a.row);

function aliveCount() {
  let n = 0;
  for (const a of S.aliens) if (a.alive) n++;
  return n;
}

function startStage(keepAliens) {
  const p = P();
  S.aliens = keepAliens || buildFormation();
  const plate = xr() ? Math.min(ARMOUR_HP, 1 + (S.eup.armour | 0)) : 1;
  for (const a of S.aliens) {
    a.state = 'form';
    a.face = 0;
    a.group = null;
    a.isEscort = false;
    a.sortie = 0;
    a.fired = 0;
    a.hp = plate;
    a.flash = 0;
    a.x = slotX(a);
    a.y = slotY(a);
  }
  S.pshot = null;
  S.eshots.length = 0;
  S.booms.length = 0;
  S.pops.length = 0;
  S.diveTimer = 90;
  S.shock = 0;
  S.flagshipHit = false;
  S.px = W / 2;
  // X carries the weapon tier between waves but not the timed pickups
  S.drops.length = 0;
  S.pcool = 0; S.inv = 0; S.rapid = 0; S.dbl = 0;
  S.combo = 0; S.comboT = 0;
  A().setTrack(p.stage);          // one soundtrack per level
  p.aliens = S.aliens;
}

// Difficulty, as the ROM keeps it: a base value that steps up each level and
// an extra value that creeps up during a level, both capped at 7 ($421A/$421B).
// The number of individual attackers allowed at once is (base+extra)/2, capped
// at 3, plus 1 -- so 1 to 4, on top of a flagship and its two escorts ($1352).
function diff() {
  const p = P();
  const base = Math.min(7, p.stage - 1);
  const extra = Math.min(7, p.extraDiff | 0);
  const d = {
    maxAttackers: Math.min(3, (base + extra) >> 1) + 1,
    delay: Math.max(20, 90 - (base + extra) * 5),
    bossChance: Math.min(0.4, 0.1 + base * 0.03),
    fireMul: 2 + Math.min(3, base >> 1),   // grows as the wave thins out
  };
  // X layers the chosen skill tier on top.  Nothing here alters *how* an alien
  // flies -- only how many are in the air, how often, and how hard they bomb.
  if (xr()) {
    const k = skill();
    d.maxAttackers = Math.min(7, d.maxAttackers + k.attackers);
    d.delay = Math.max(10, Math.round(d.delay * k.delayMul));
    d.bossChance = Math.min(0.65, d.bossChance * k.bossMul);
    d.fireMul = Math.max(1, d.fireMul + k.fireMul);
    // and then whatever the swarm has been handed in exchange for your pods
    d.maxAttackers = Math.min(9, d.maxAttackers + eup('swarm'));
    d.fireMul += eup('barrage');
    d.delay = Math.max(8, Math.round(d.delay * (1 - 0.13 * eup('velocity'))));
    d.bossChance = Math.min(0.8, d.bossChance * (1 + 0.5 * eup('vanguard')));
  }
  return d;
}
const maxEshots = () =>
  (xr() ? skill().maxEshots + eup('barrage') : MAX_ESHOTS);

// -------------------------------------------------------------------------
//  dives
// -------------------------------------------------------------------------
function diving() {
  let n = 0;
  for (const a of S.aliens) if (a.alive && a.state !== 'form') n++;
  return n;
}

// Send an alien off on the peel-off arc.  `cw` picks the flank it swings out
// to, which the machine derives from where the swarm has swayed to ($13E1).
function launch(a, cw, group) {
  a.state = 'arc';
  a.arcI = 0;
  a.arcCW = cw ? 1 : 0;
  a.arcT = ARC_ANIM_TICKS - 1;
  a.arcLeft = ARC_ANIM_STEPS;
  // it starts facing back up the screen and rotates to face down as it loops
  a.face = cw ? -12 : 12;
  a.sub = ROW_SUBSTEPS[a.row] || 2;
  a.sortie = 0;
  a.fired = 0;
  a.group = group || null;
}

// Once the arc is done, fix the sweep the alien will fly.  This is the whole
// trick: a radius chosen from the distance to the player, and a pivot placed
// so the alien starts at one end of the swing.  It never adjusts again --
// Galaxian's divers do not home, they commit.
function defineFlightPath(a) {
  let delta = a.x - S.px;
  const sign = delta >= 0 ? 1 : -1;
  let r = Math.abs(delta) / 2 + SWEEP_BIAS;
  r = Math.max(SWEEP_MIN, Math.min(SWEEP_MAX, r));
  a.hh = sign * r;
  a.ll = 0;
  a.pivot = a.x - a.hh;
  a.state = 'attack';
  // publish the flagship's sweep so its escorts can fly the identical path
  if (a.kind === 'boss' && a.group) { a.group.hh = a.hh; a.group.ll = a.ll; }
}

// The flagship's escorts copy its sweep exactly, so the convoy flies as one
// rigid shape with the escorts holding station either side of it ($0E26).
function adoptConvoyPath(a, g) {
  a.hh = g.hh;
  a.ll = g.ll;
  a.pivot = a.x - a.hh;
  a.state = 'attack';
}

// Advance the fixed-point circle generator: hh is the horizontal offset from
// the pivot, ll its rate of change.  Together they trace a cosine ($116B).
function sweep(a) {
  for (let i = 0; i < a.sub; i++) {
    a.hh += a.ll * SWEEP_STEP;
    a.ll -= a.hh * SWEEP_STEP;
  }
}

// Face the player, quantised to the machine's 24 steps ($11B0).  The ROM
// buckets the tangent into 5 magnitudes per side.
function lookAtPlayer(a) {
  const down = Math.max(1, 240 - a.y);
  const across = S.px - a.x;
  const t = Math.abs(across) / down;
  const mag = Math.min(4, Math.floor(t * 4));
  a.face = across >= 0 ? mag : -mag;
}

function launchBoss(boss, cw) {
  const reds = S.aliens
    .filter(a => a.alive && a.kind === 'red' && a.state === 'form')
    .sort((x, y) => Math.abs(x.x - boss.x) - Math.abs(y.x - boss.x))
    .slice(0, 2);
  const group = { id: ++S.groupSeq, launched: reds.length, alive: reds.length,
                  boss };
  launch(boss, cw, group);
  boss.isEscort = false;
  for (const r of reds) {
    launch(r, cw, group);
    r.isEscort = true;
  }
  A().dive(true);
}

// Which flank the next attacker peels from: if the swarm has swayed close to
// one side, it comes from that side, otherwise it is random ($13E1).
function attackFlank() {
  if (S.formX > FORM_AMP - 12) return 1;
  if (S.formX < -FORM_AMP + 12) return 0;
  return Math.random() < 0.5 ? 1 : 0;
}

// The machine does not pick a random alien.  It walks in from the leftmost or
// rightmost occupied column, then takes the topmost available alien in that
// column, preferring purple then blue.  Red aliens only join in once every
// flagship is gone ($137B / $138A).
function pickAttacker(fromRight) {
  const formed = S.aliens.filter(a => a.alive && a.state === 'form');
  if (!formed.length) return null;
  const haveBoss = formed.some(a => a.kind === 'boss');
  const eligible = formed.filter(a => a.kind !== 'boss'
                                   && (haveBoss ? a.kind !== 'red' : true));
  if (!eligible.length) return null;

  const cols = eligible.map(a => a.col);
  const edge = fromRight ? Math.max(...cols) : Math.min(...cols);
  const inCol = eligible.filter(a => a.col === edge);
  // topmost first: purple (row 2) before the blue rows below it
  inCol.sort((x, y) => x.row - y.row);
  return inCol[0];
}

function maybeLaunch() {
  const d = diff();
  if (S.diveTimer > 0) { S.diveTimer--; return; }
  // shooting a flagship in flight puts the swarm in shock -- nothing leaves
  // the formation until it wears off ($422B)
  if (S.shock > 0) { S.shock--; return; }

  let attackers = 0;
  for (const a of S.aliens) {
    if (a.alive && a.state !== 'form' && a.kind !== 'boss' && !a.isEscort) {
      attackers++;
    }
  }

  const formed = S.aliens.filter(a => a.alive && a.state === 'form');
  if (!formed.length) return;
  const cw = attackFlank();

  const bossInFlight = S.aliens.some(a => a.alive && a.kind === 'boss'
                                       && a.state !== 'form');
  const bosses = formed.filter(a => a.kind === 'boss');
  if (bosses.length && !bossInFlight && Math.random() < d.bossChance) {
    launchBoss(bosses[(Math.random() * bosses.length) | 0], cw);
  } else {
    if (attackers >= d.maxAttackers) return;
    const pick = pickAttacker(cw);
    if (!pick) return;
    launch(pick, cw);
    A().dive(false);
  }
  S.diveTimer = d.delay + ((Math.random() * d.delay) | 0);
}

function updateDiver(a) {
  const d = diff();

  if (a.state === 'arc') {
    // ride the arc table: it climbs, rolls over and comes out pointing down
    const step = ARC_TABLE[Math.min(a.arcI, ARC_TABLE.length - 1)];
    a.y += step[0];
    a.x += a.arcCW ? step[1] : -step[1];
    a.arcI++;
    if (a.y < HDR_H - 8) {                 // climbed off the top
      a.state = 'reenter';
      return;
    }
    if (--a.arcT <= 0) {
      a.arcT = ARC_ANIM_TICKS;
      a.face += a.arcCW ? 1 : -1;          // rotate toward facing down
      if (--a.arcLeft <= 0) {
        a.face = 0;
        // red aliens flying with a live flagship take its path, not their own
        const g = a.group;
        if (a.isEscort && g && g.boss.alive && g.hh !== undefined) {
          adoptConvoyPath(a, g);
        } else {
          defineFlightPath(a);
        }
      }
    }
    return;
  }

  if (a.state === 'attack' || a.state === 'near') {
    if (a.state === 'attack') a.y += 1;
    else a.y += 1 + (S.tick & 1);          // it accelerates past the player

    sweep(a);
    a.x = a.pivot + a.hh;
    lookAtPlayer(a);

    if (a.x < -SIDE_MARGIN || a.x > W + SIDE_MARGIN) { a.state = 'reenter'; return; }
    if (a.state === 'attack' && a.y >= NEAR_BOTTOM_Y) a.state = 'near';
    if (a.y > BOTTOM_Y) { a.state = 'reenter'; return; }

    // bombs are dropped at exact heights, not at random
    if (S.mode === MODE.PLAY && !S.flagshipHit && S.eshots.length < maxEshots()) {
      for (let k = 0; k < d.fireMul; k++) {
        const at = FIRE_AT_Y - k * FIRE_STEP;
        if (a.y >= at && a.y - 1 < at && !(a.fired & (1 << k))) {
          a.fired |= (1 << k);
          fireEnemyShot(a);
          break;
        }
      }
    }
    return;
  }

  if (a.state === 'reenter') {
    // back in at the very top, lined up with its own column
    a.y = REENTRY_Y;
    a.x = slotX(a);
    a.face = 0;
    a.sortie++;
    a.fired = 0;
    // a flagship that came down alone leaves the level rather than going home
    if (a.kind === 'boss' && a.group && a.group.launched === 0) {
      a.alive = false;
      a.state = 'form';
      return;
    }
    a.state = 'return';
    return;
  }

  if (a.state === 'return') {
    a.x = slotX(a);                        // hold the column and drop into place
    const sy = slotY(a);
    if (a.y >= sy) {
      a.state = 'form';
      a.x = slotX(a); a.y = sy; a.face = 0;
      a.group = null; a.isEscort = false;
    } else {
      a.y += 1;
    }
  }
}


// -------------------------------------------------------------------------
//  shots
// -------------------------------------------------------------------------
function fireEnemyShot(a) {
  const sp = xr()
    ? ESHOT_SPEED * skill().eshotMul * (1 + 0.14 * eup('velocity'))
    : ESHOT_SPEED;
  const dx = S.px - a.x, dy = PLAYER_Y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  let vx = dx / len * sp;
  // the cabinet's shots fall; they never travel more sideways than down
  vx = Math.max(-sp * 0.55, Math.min(sp * 0.55, vx));
  S.eshots.push({ x: a.x, y: a.y + 5, vx, vy: sp });
}

function firePlayer() {
  if (S.mode !== MODE.PLAY) return;
  if (!xr()) {
    if (S.pshot) return;             // the cabinet's one-shot rule
    S.pshot = { x: Math.round(S.px), y: PLAYER_Y - 9 };
    Fx.shot(S.px, PLAYER_Y - 9);
    A().shoot();
    return;
  }
  // X: a cooldown and a bolt budget instead, both set by the weapon tier and
  // relaxed while RAPID is running.
  const tier = Math.min(MAX_WEAPON - 1, S.weapon | 0);
  const rapid = S.rapid > 0;
  if (S.pcool > 0) return;
  const cap = X_INFLIGHT[tier] + (rapid ? 2 : 0);
  if (S.pshots.length >= cap) return;
  S.pcool = Math.max(3, Math.round(X_COOL[tier] * (rapid ? 0.55 : 1)));

  const x = Math.round(S.px), y = PLAYER_Y - 9;
  const lanes = tier === 0 ? [[0, 0]]
              : tier === 1 ? [[-3, 0], [3, 0]]
                           : [[-5, -0.85], [0, 0], [5, 0.85]];
  for (const [dx, vx] of lanes) {
    S.pshots.push({ x: x + dx, y, vx, vy: XPSHOT_SPEED, tier });
  }
  Fx.shot(S.px, y);
  A().shoot();
}

// -------------------------------------------------------------------------
//  X: power-ups
// -------------------------------------------------------------------------
// A kill may leave a pod behind.  The roll only ever happens under X, so the
// classic versions never touch the random stream here and stay in lockstep.
function maybeDrop(a) {
  const k = skill();
  let chance = k.dropRate;
  if (a.kind === 'boss') chance *= 2.4;
  else if (a.kind === 'red') chance *= 1.35;
  if (Math.random() >= chance) return;

  // weighted pick, with BEAM suppressed once the weapon is maxed
  const pool = POWERUPS.filter(p => !(p.key === 'beam' && S.weapon >= MAX_WEAPON - 1));
  let total = 0;
  for (const p of pool) total += p.w;
  let r = Math.random() * total;
  let pick = pool[pool.length - 1];
  for (const p of pool) { r -= p.w; if (r <= 0) { pick = p; break; } }
  S.drops.push({ kind: pick.key, x: a.x, y: a.y, vy: DROP_SPEED, t: 0 });
}

function powerupDef(key) {
  for (const p of POWERUPS) if (p.key === key) return p;
  return POWERUPS[0];
}

// Picking a pod up only stows it.  A full hold banks the pod as points
// instead, so a good run is never punished for being well stocked.
function collect(d) {
  const def = powerupDef(d.kind);
  Fx.x('pickup', d.x, d.y, def.col);
  A().pickup(d.kind);
  if (S.hold.length < HOLD_MAX) {
    S.hold.push(d.kind);
    S.holdSel = S.hold.length - 1;
    // say the key here too -- the pickup is the moment the player is looking
    S.banner = def.name + '  HELD   PRESS X';
  } else {
    addScore(500 * skill().scoreMul);
    S.banner = 'HOLD FULL  +' + (500 * skill().scoreMul);
  }
  S.bannerT = 90;
}

function cycleHold(dir) {
  if (!S.hold.length) return;
  const n = S.hold.length;
  S.holdSel = ((S.holdSel + (dir < 0 ? n - 1 : 1)) % n + n) % n;
  A().cycle();
}

function applyPowerup(key) {
  const def = powerupDef(key);
  if (key === 'beam') {
    S.weapon = Math.min(MAX_WEAPON - 1, S.weapon + 1);
  } else if (key === 'rapid') {
    S.rapid = Math.max(S.rapid, 0) + def.time;
  } else if (key === 'shield') {
    S.shield = Math.min(SHIELD_MAX, S.shield + 1);
  } else if (key === 'score') {
    S.dbl = Math.max(S.dbl, 0) + def.time;
  } else if (key === 'nova') {
    nova();
  }
}

// Spending a pod is the whole bargain: you get stronger, and so do they.
function useHold() {
  if (!xr() || S.mode !== MODE.PLAY || !S.hold.length) return;
  const idx = Math.max(0, Math.min(S.hold.length - 1, S.holdSel));
  const key = S.hold.splice(idx, 1)[0];
  S.holdSel = Math.min(S.holdSel, Math.max(0, S.hold.length - 1));
  const def = powerupDef(key);
  applyPowerup(key);
  S.banner = def.name;
  S.bannerT = 100;
  Fx.x('arm', S.px, PLAYER_Y, def.col);
  A().arm(key);
  escalate();
}

// The swarm's side of the bargain.  It never takes the same upgrade twice in
// a row while another is still available, so the escalation spreads out
// rather than piling everything onto one axis.
function escalate() {
  const open = ENEMY_UPGRADES.filter(e => S.eup[e.key] < e.max
                                       && e.key !== S.lastEup);
  const pool = open.length ? open
             : ENEMY_UPGRADES.filter(e => S.eup[e.key] < e.max);
  if (!pool.length) return;
  const e = pool[(Math.random() * pool.length) | 0];
  S.eup[e.key]++;
  S.lastEup = e.key;
  // ARMOUR re-plates whatever is already on screen, so it is felt at once
  if (e.key === 'armour') {
    for (const a of S.aliens) {
      if (a.alive) a.hp = Math.min(ARMOUR_HP, 1 + S.eup.armour);
    }
  }
  S.ebanner = e.name;
  S.ebannerT = 130;
  Fx.x('escalate', 112, 70, null);
  A().escalate();
}

// NOVA: everything currently in the air dies at once, and the sky is cleared.
function nova() {
  for (const a of S.aliens) {
    if (a.alive && a.state !== 'form') killAlien(a);
  }
  S.eshots.length = 0;
  Fx.x('nova', S.px, PLAYER_Y, null);
  A().nova();
}

function updateDrops() {
  for (let i = S.drops.length - 1; i >= 0; i--) {
    const d = S.drops[i];
    d.t++;
    d.y += d.vy;
    if (d.y > PLAY_BOT) { S.drops.splice(i, 1); continue; }
    if (Math.abs(d.x - S.px) < 11 && Math.abs(d.y - PLAYER_Y) < 10) {
      S.drops.splice(i, 1);
      collect(d);
    }
  }
}

// The combo runs on kills, not on time: it climbs with every alien destroyed
// and lapses if nothing dies for a couple of seconds.
const comboMul = () => Math.min(COMBO_MAX, 1 + (S.combo / 4 | 0));

// -------------------------------------------------------------------------
//  hits and scoring
// -------------------------------------------------------------------------
function addScore(n) {
  const p = P();
  p.score += n;
  if (!p.extra && p.score >= EXTRA_LIFE_AT) {
    p.extra = true;
    p.lives++;
    A().extraLife();
  }
  if (p.score > S.hi) { S.hi = p.score; saveHi(S.hi); }
}

// The signature Galaxian risk: dive on the flagship and its escorts are worth
// far more if you clear the escorts out first.
function bossPoints(a) {
  const g = a.group;
  if (!g || g.launched === 0) return 150;   // came down alone
  if (g.alive >= 2) return 300;             // both escorts still flying
  if (g.alive === 1) return 200;            // one left
  return 800;                               // escorts shot first -- the jackpot
}

function killAlien(a) {
  a.alive = false;
  const flying = a.state !== 'form';
  let pts;
  if (a.kind === 'boss') {
    pts = flying ? bossPoints(a) : KIND.boss.form;
    if (flying && SCORE_ART[pts]) {
      S.pops.push({ art: SCORE_ART[pts], v: pts, x: a.x, y: a.y, t: 48 });
    }
    if (flying) { S.flagshipHit = true; S.shock = 150; }
    A().bossBoom();
  } else {
    pts = flying ? KIND[a.kind].dive : KIND[a.kind].form;
    A().boom();
  }
  if (a.isEscort && a.group) a.group.alive--;
  if (xr()) {
    S.combo++;
    S.comboT = COMBO_HOLD;
    pts = pts * comboMul() * skill().scoreMul * (S.dbl > 0 ? 2 : 1);
    if (S.mode === MODE.PLAY) maybeDrop(a);
  }
  addScore(pts);
  S.booms.push({ x: a.x, y: a.y, f: 0, t: 0, big: false });
  Fx.boom(a.x, a.y, false, a.kind);
}

function killPlayer() {
  if (S.mode !== MODE.PLAY) return;
  // X: a shield charge soaks the hit and buys a moment of mercy instead
  if (xr()) {
    if (S.inv > 0) return;
    if (S.shield > 0) {
      S.shield--;
      S.inv = INVULN;
      S.combo = 0; S.comboT = 0;
      Fx.x('shield', S.px, PLAYER_Y, null);
      A().shieldHit();
      return;
    }
  }
  S.mode = MODE.DYING;
  S.timer = 110;
  S.booms.push({ x: S.px, y: PLAYER_Y, f: 0, t: 0, big: true });
  S.pshot = null;
  Fx.boom(S.px, PLAYER_Y, true, 'blue');
  A().death();
  A().thrumOff();
}

// axis-aligned overlap between a centred sprite and a point-ish box
function hitsSprite(art, cx, cy, x, y, w, h) {
  const aw = sw(art), ah = sh(art);
  return x < cx + aw / 2 && x + w > cx - aw / 2
      && y < cy + ah / 2 && y + h > cy - ah / 2;
}

function collide() {
  // player shots vs aliens.  Classic play only ever has one in the list, so
  // this is the same walk it always was; X may have up to six.
  for (let i = S.pshots.length - 1; i >= 0; i--) {
    const s = S.pshots[i];
    for (const a of S.aliens) {
      if (!a.alive) continue;
      if (hitsSprite(alienArt(a), a.x, a.y, s.x, s.y, 1, 3)) {
        // ARMOUR: the shot lands but the plating holds.  Only X ever sets
        // hp above 1, so the classic versions go straight to the kill.
        if (xr() && a.hp > 1) {
          a.hp--;
          a.flash = 9;
          Fx.hit(a.x, a.y);
          A().plating();
        } else {
          killAlien(a);
        }
        S.pshots.splice(i, 1);
        break;
      }
    }
  }
  if (S.mode !== MODE.PLAY) return;

  // enemy shots vs player
  for (let i = S.eshots.length - 1; i >= 0; i--) {
    const b = S.eshots[i];
    if (hitsSprite(ART.ship, S.px, PLAYER_Y, b.x, b.y, 1, 3)) {
      S.eshots.splice(i, 1);
      killPlayer();
      return;
    }
  }
  // a diving alien that reaches the player takes them both out
  for (const a of S.aliens) {
    if (!a.alive || a.state === 'form') continue;
    const art = alienArt(a);
    if (Math.abs(a.x - S.px) < (sw(art) + sw(ART.ship)) / 2 - 3
     && Math.abs(a.y - PLAYER_Y) < (sh(art) + sh(ART.ship)) / 2 - 3) {
      killAlien(a);
      killPlayer();
      return;
    }
  }
}

// -------------------------------------------------------------------------
//  lifecycle
// -------------------------------------------------------------------------
function startGame(two) {
  S.twoPlayer = !!two;
  S.demo = false;
  // X starts every run from a clean loadout, and with the swarm un-escalated
  S.weapon = 0; S.shield = 0; S.combo = 0; S.comboT = 0;
  S.banner = null; S.bannerT = 0;
  S.ebanner = null; S.ebannerT = 0;
  S.hold.length = 0; S.holdSel = 0;
  S.lastEup = null;
  resetEnemyUpgrades();
  S.players = two ? [newPlayer(), newPlayer()] : [newPlayer()];
  S.cur = 0;
  S.hi = Math.max(S.hi, 0);
  startStage(null);
  S.mode = MODE.READY;
  S.timer = 110;
  audioInit();
  A().start();
}

function startAttract() {
  S.mode = MODE.ATTRACT;
  S.demo = false;
  S.attractPage = 0;
  S.timer = 300;
  S.players = [newPlayer()];
  S.cur = 0;
  S.twoPlayer = false;
  startStage(null);
  A().thrumOff();
}

function startDemo() {
  S.demo = true;
  S.players = [newPlayer()];
  S.cur = 0;
  startStage(null);
  S.mode = MODE.PLAY;
  S.timer = 0;
  S.demoLeft = 900;
}

// pick the next player who still has lives; false if the game is over
function nextPlayer() {
  const p = P();
  if (p.lives <= 0) p.alive = false;
  if (!S.twoPlayer) return p.lives > 0;
  const other = 1 - S.cur;
  if (S.players[other].lives > 0) {
    S.players[S.cur].aliens = S.aliens;
    S.cur = other;
    S.aliens = S.players[S.cur].aliens || buildFormation();
    startStage(S.aliens);
    return true;
  }
  return p.lives > 0;
}

function afterDeath() {
  const p = P();
  p.lives--;
  S.eshots.length = 0;
  if (xr()) {
    // dying costs a weapon tier and every timed pickup, but not the shield
    // charges you were holding -- those were already spent to survive
    S.weapon = Math.max(0, S.weapon - 1);
    S.rapid = 0; S.dbl = 0; S.pcool = 0;
    S.combo = 0; S.comboT = 0;
    S.inv = INVULN;
    S.drops.length = 0;
  }
  for (const a of S.aliens) {
    if (a.state !== 'form') { a.state = 'form'; a.group = null; a.isEscort = false; }
    a.x = slotX(a); a.y = slotY(a); a.face = 0; a.fired = 0;
  }
  S.shock = 0;
  S.flagshipHit = false;
  if (nextPlayer()) {
    S.mode = MODE.READY;
    S.timer = 100;
  } else {
    S.mode = MODE.OVER;
    S.timer = 220;
    A().gameOver();
  }
}

// -------------------------------------------------------------------------
//  input
//
//  Nothing below asks "was that the X key" -- it asks "was that the USE POD
//  action", and a binding table answers.  Two slots per action, both editable
//  on the key-bindings screen and remembered in localStorage.
// -------------------------------------------------------------------------
const keys = Object.create(null);

const ACTIONS = [
  { key: 'left',    name: 'LEFT' },
  { key: 'right',   name: 'RIGHT' },
  { key: 'fire',    name: 'FIRE' },
  { key: 'cycle',   name: 'CYCLE HOLD', x: true },
  { key: 'use',     name: 'USE POD',    x: true },
  { key: 'start1',  name: 'START 1P' },
  { key: 'start2',  name: 'START 2P' },
  { key: 'pause',   name: 'PAUSE' },
  { key: 'mute',    name: 'SOUND' },
  { key: 'version', name: 'VERSION' },
];
const BIND_SLOTS = 2;
const DEFAULT_BINDS = {
  left:    ['ArrowLeft', 'KeyA'],
  right:   ['ArrowRight', 'KeyD'],
  fire:    ['Space', 'ControlLeft'],
  cycle:   ['KeyC', ''],
  use:     ['KeyX', 'KeyZ'],
  start1:  ['Digit1', ''],
  start2:  ['Digit2', ''],
  pause:   ['KeyP', ''],
  mute:    ['KeyM', ''],
  version: ['KeyV', ''],
};
const defaultBinds = () => {
  const o = {};
  for (const a of ACTIONS) o[a.key] = DEFAULT_BINDS[a.key].slice();
  return o;
};

function loadBinds() {
  const b = defaultBinds();
  try {
    const raw = JSON.parse(localStorage.getItem('galaxian.keys') || 'null');
    if (raw && typeof raw === 'object') {
      for (const a of ACTIONS) {
        const v = raw[a.key];
        if (!Array.isArray(v)) continue;
        for (let i = 0; i < BIND_SLOTS; i++) {
          b[a.key][i] = typeof v[i] === 'string' ? v[i] : '';
        }
      }
    }
  } catch (e) {}
  return b;
}
function saveBinds() {
  try { localStorage.setItem('galaxian.keys', JSON.stringify(S.binds)); }
  catch (e) {}
}

// The tables above are declared after S, so the binds themselves are loaded
// in the boot block at the foot of the file; until then these read as unbound.
const binds = action => (S.binds ? S.binds[action] : null);
// Is this key code bound to that action?
const bound = (action, code) => {
  const v = binds(action);
  return !!v && (v[0] === code || v[1] === code);
};
// Is any key bound to that action currently held down?
const held = action => {
  const v = binds(action);
  if (!v) return false;
  return !!((v[0] && keys[v[0]]) || (v[1] && keys[v[1]]));
};

// A code may only drive one action, so setting a binding takes it away from
// wherever else it was.  Leaving an action unbound is allowed -- the screen
// shows it in red, and R restores every default.
function setBind(action, slot, code) {
  for (const a of ACTIONS) {
    for (let i = 0; i < BIND_SLOTS; i++) {
      if (S.binds[a.key][i] === code) S.binds[a.key][i] = '';
    }
  }
  S.binds[action][slot] = code;
  saveBinds();
}
function clearBind(action, slot) {
  S.binds[action][slot] = '';
  saveBinds();
}

// Codes are what the browser reports; these are what a person calls them.
// The arcade font has only 0-9, A-Z and '-', so every name stays inside that.
const KEY_NAMES = {
  Space: 'SPACE', Enter: 'ENTER', Escape: 'ESC', Backspace: 'BKSP',
  Tab: 'TAB', CapsLock: 'CAPS',
  ShiftLeft: 'LSHIFT', ShiftRight: 'RSHIFT',
  ControlLeft: 'LCTRL', ControlRight: 'RCTRL',
  AltLeft: 'LALT', AltRight: 'RALT',
  MetaLeft: 'LMETA', MetaRight: 'RMETA',
  Minus: 'MINUS', Equal: 'EQUALS', Comma: 'COMMA', Period: 'PERIOD',
  Slash: 'SLASH', Backslash: 'BSLASH', Semicolon: 'SEMI', Quote: 'QUOTE',
  BracketLeft: 'LBRACK', BracketRight: 'RBRACK', Backquote: 'BTICK',
};
function keyName(code) {
  if (!code) return '-';
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  if (code.indexOf('Key') === 0) return code.slice(3);
  if (code.indexOf('Digit') === 0) return code.slice(5);
  if (code.indexOf('Arrow') === 0) return code.slice(5).toUpperCase();
  if (code.indexOf('Numpad') === 0) return 'NUM' + code.slice(6).toUpperCase();
  return code.toUpperCase().replace(/[^A-Z0-9-]/g, '');
}

const LEFT = () => held('left');
const RIGHT = () => held('right');

function openKeys(from) {
  S.keyFrom = from;
  S.mode = MODE.KEYS;
  S.keyIdx = 0; S.keySlot = 0; S.keyWait = false;
}
function closeKeys() {
  if (S.keyFrom === MODE.SELECT) { S.mode = MODE.SELECT; return; }
  startAttract();
}

// The bindings screen is driven by raw arrows / Enter / Escape rather than by
// the bindings, so it is impossible to rebind your way out of being able to
// reach it and fix things.
function keysScreenKey(c) {
  if (S.keyWait) {
    if (c === 'Escape') { S.keyWait = false; return; }
    setBind(ACTIONS[S.keyIdx].key, S.keySlot, c);
    S.keyWait = false;
    return;
  }
  if (c === 'ArrowUp') {
    S.keyIdx = (S.keyIdx + ACTIONS.length - 1) % ACTIONS.length;
  } else if (c === 'ArrowDown') {
    S.keyIdx = (S.keyIdx + 1) % ACTIONS.length;
  } else if (c === 'ArrowLeft') {
    S.keySlot = (S.keySlot + BIND_SLOTS - 1) % BIND_SLOTS;
  } else if (c === 'ArrowRight') {
    S.keySlot = (S.keySlot + 1) % BIND_SLOTS;
  } else if (c === 'Enter' || c === 'Space') {
    S.keyWait = true;
  } else if (c === 'Backspace' || c === 'Delete') {
    clearBind(ACTIONS[S.keyIdx].key, S.keySlot);
  } else if (c === 'KeyR') {
    S.binds = defaultBinds();
    saveBinds();
  } else if (c === 'Escape' || c === 'KeyK') {
    closeKeys();
  }
}

function onKey(e, down) {
  const c = e.code;
  if (['ArrowLeft', 'ArrowRight', 'Space', 'ArrowUp', 'ArrowDown',
       'Backspace'].includes(c)) {
    e.preventDefault();
  }
  if (down && keys[c]) return;      // ignore auto-repeat
  keys[c] = down;
  if (!down) return;

  audioInit();
  // the bindings screen sees every key first, or capturing M would mute
  if (S.mode === MODE.KEYS) { keysScreenKey(c); return; }
  if (bound('mute', c)) { toggleMute(); return; }
  if (bound('pause', c) && (S.mode === MODE.PLAY || S.paused)) {
    S.paused = !S.paused; return;
  }
  if (c === 'KeyK' && (S.mode === MODE.SELECT || S.mode === MODE.ATTRACT
                       || S.mode === MODE.OVER)) {
    openKeys(S.mode === MODE.SELECT ? MODE.SELECT : MODE.ATTRACT);
    return;
  }
  // the boot screen previews whichever version is highlighted, so moving the
  // cursor switches the whole presentation live
  if (S.mode === MODE.SELECT) {
    const back = c === 'ArrowUp' || c === 'KeyW' || c === 'ArrowLeft';
    const fwd = c === 'ArrowDown' || c === 'KeyS' || c === 'ArrowRight';
    if (back || fwd) {
      // cycle through however many versions there are, in both directions
      S.selIdx = (S.selIdx + (fwd ? 1 : SKINS.length - 1)) % SKINS.length;
      applySkin(SKINS[S.selIdx]);
    } else if (c === 'Enter' || c === 'Space' || bound('start1', c)
               || bound('start2', c)) {
      applySkin(SKINS[S.selIdx]);
      startAttract();
    }
    return;
  }
  // X asks which skill tier before it starts, so 1 / 2 land here first
  if (S.mode === MODE.SKILL) {
    const back = c === 'ArrowUp' || c === 'KeyW' || c === 'ArrowLeft' || c === 'KeyA';
    const fwd = c === 'ArrowDown' || c === 'KeyS' || c === 'ArrowRight' || c === 'KeyD';
    if (back || fwd) {
      S.skill = (S.skill + (fwd ? 1 : SKILLS.length - 1)) % SKILLS.length;
      saveSkill(S.skill);
    } else if (c === 'Enter' || c === 'Space' || bound('start1', c)
               || bound('start2', c)) {
      if (bound('start2', c)) S.pendingTwo = true;
      startGame(S.pendingTwo);
    } else if (c === 'Escape' || c === 'KeyB') {
      startAttract();
    }
    return;
  }
  if (S.mode === MODE.ATTRACT || S.mode === MODE.OVER) {
    const two = bound('start2', c);
    if (bound('start1', c) || c === 'Enter' || two) {
      if (xr()) { S.pendingTwo = two; S.mode = MODE.SKILL; S.timer = 0; }
      else startGame(two);
    } else if (bound('version', c)) {          // step version from the attract
      S.selIdx = (S.selIdx + 1) % SKINS.length;
      applySkin(SKINS[S.selIdx]);
    }
    return;
  }
  // X: one key cycles the pod hold, another spends the selected one.  They
  // have to be separate -- if cycling also spent, you could never look through
  // the hold without emptying it.
  if (xr()) {
    if (bound('cycle', c)) { cycleHold(1); return; }
    if (bound('use', c)) { useHold(); return; }
  }
  if (bound('fire', c)) firePlayer();
}

if (typeof addEventListener === 'function') {
  addEventListener('keydown', e => onKey(e, true));
  addEventListener('keyup', e => onKey(e, false));
}

// A small pilot so the attract mode plays itself, as the cabinet does.
function demoInput() {
  // under X the pilot shows the trade off: it banks pods and spends one as
  // soon as the hold is full, so the attract loop escalates like a real game
  if (xr() && S.hold.length >= HOLD_MAX && (S.tick % 90) === 0) useHold();

  // sidestep an incoming shot before worrying about aiming
  let threat = null, best = 1e9;
  for (const b of S.eshots) {
    const d = Math.abs(b.x - S.px);
    if (b.y > 150 && d < 20 && d < best) { best = d; threat = b; }
  }
  if (threat) {
    S.px += threat.x > S.px ? -PLAYER_SPEED : PLAYER_SPEED;
    if (!S.pshot) firePlayer();
    return;
  }
  // prefer a diver, then whatever is lowest and nearest in the formation
  let target = null; best = 1e9;
  for (const a of S.aliens) {
    if (!a.alive) continue;
    const rank = (a.state !== 'form' ? 0 : 200)
               + Math.abs(a.x - S.px) * 2 - a.y;
    if (rank < best) { best = rank; target = a; }
  }
  if (!target) return;
  const dx = target.x - S.px;
  if (Math.abs(dx) > 1.5) S.px += dx > 0 ? PLAYER_SPEED : -PLAYER_SPEED;
  if (!S.pshot && Math.abs(dx) < 6) firePlayer();
}

// -------------------------------------------------------------------------
//  update
// -------------------------------------------------------------------------
function updateBooms() {
  for (let i = S.booms.length - 1; i >= 0; i--) {
    const b = S.booms[i];
    b.t++;
    if (b.t % 5 === 0) b.f++;
    if (b.f >= 4) S.booms.splice(i, 1);
  }
  for (let i = S.pops.length - 1; i >= 0; i--) {
    if (--S.pops[i].t <= 0) S.pops.splice(i, 1);
  }
}

function updateShots() {
  if (!xr()) {
    if (S.pshot) {
      S.pshot.y -= PSHOT_SPEED;
      if (S.pshot.y < HDR_H) S.pshot = null;
    }
  } else {
    for (let i = S.pshots.length - 1; i >= 0; i--) {
      const s = S.pshots[i];
      s.y -= s.vy;
      s.x += s.vx;
      if (s.y < HDR_H || s.x < 0 || s.x >= W) S.pshots.splice(i, 1);
    }
  }
  for (let i = S.eshots.length - 1; i >= 0; i--) {
    const b = S.eshots[i];
    b.x += b.vx; b.y += b.vy;
    if (b.y > PLAY_BOT || b.x < 0 || b.x >= W) S.eshots.splice(i, 1);
  }
}

function updateFormation() {
  S.formX += S.formDir * FORM_SPEED;
  if (S.formX >= FORM_AMP) { S.formX = FORM_AMP; S.formDir = -1; }
  if (S.formX <= -FORM_AMP) { S.formX = -FORM_AMP; S.formDir = 1; }
  // Flagships move before everything else: an escort has to see its leader's
  // sweep already published on the frame their arcs finish, or it would
  // compute a path of its own and the convoy would break up.
  for (const a of S.aliens) {
    if (!a.alive) continue;
    if (a.state === 'form') { a.x = slotX(a); a.y = slotY(a); }
    else if (a.kind === 'boss') updateDiver(a);
  }
  for (const a of S.aliens) {
    if (a.alive && a.state !== 'form' && a.kind !== 'boss') updateDiver(a);
  }
}

// X's own per-frame bookkeeping: pod fall and collection, cooldowns, the
// timed pickups, mercy frames and the combo lapse.
function updateX() {
  updateDrops();
  if (S.pcool > 0) S.pcool--;
  if (S.inv > 0) S.inv--;
  if (S.rapid > 0) S.rapid--;
  if (S.dbl > 0) S.dbl--;
  if (S.bannerT > 0 && --S.bannerT <= 0) S.banner = null;
  if (S.ebannerT > 0 && --S.ebannerT <= 0) S.ebanner = null;
  if (S.comboT > 0 && --S.comboT <= 0) S.combo = 0;
  for (const a of S.aliens) if (a.flash > 0) a.flash--;
}

function update() {
  S.tick++;
  if (S.paused) return;
  S.scroll += 0.35;

  switch (S.mode) {
    case MODE.SELECT:
    case MODE.SKILL:
    case MODE.KEYS:
      updateFormation();
      break;

    case MODE.ATTRACT:
      updateFormation();
      updateBooms();
      if (--S.timer <= 0) {
        S.attractPage++;
        if (S.attractPage === 2) { startDemo(); break; }
        if (S.attractPage > 2) S.attractPage = 0;
        S.timer = 300;
      }
      break;

    case MODE.READY:
      updateFormation();
      if (--S.timer <= 0) {
        S.mode = MODE.PLAY;
        A().thrumOn();
      }
      break;

    case MODE.PLAY: {
      if (S.demo) demoInput();
      else {
        if (LEFT()) S.px -= PLAYER_SPEED;
        if (RIGHT()) S.px += PLAYER_SPEED;
        if (held('fire')) firePlayer();
      }
      S.px = Math.max(PLAYER_MIN, Math.min(PLAYER_MAX, S.px));

      if (xr()) updateX();
      updateFormation();
      maybeLaunch();
      updateShots();
      collide();
      updateBooms();

      const left = aliveCount();
      A().setThrum(1 - left / 46);

      // the swarm settles once the shock of a downed flagship passes
      if (S.shock <= 0) S.flagshipHit = false;
      // and the pressure creeps up over the course of a wave
      if ((S.tick & 255) === 0) {
        const p = P();
        if (p.extraDiff < 7) p.extraDiff++;
      }

      if (left === 0) {
        S.mode = MODE.CLEAR;
        S.timer = 130;
        A().thrumOff();
        A().stageClear();
      }
      if (S.demo && --S.demoLeft <= 0) startAttract();
      break;
    }

    case MODE.DYING:
      updateFormation();
      updateShots();
      updateBooms();
      if (--S.timer <= 0) {
        if (S.demo) startAttract();
        else afterDeath();
      }
      break;

    case MODE.CLEAR:
      updateBooms();
      if (--S.timer <= 0) {
        P().stage++;
        P().extraDiff = 0;      // in-wave pressure resets, the base does not
        startStage(null);
        S.mode = MODE.READY;
        S.timer = 90;
      }
      break;

    case MODE.OVER:
      updateBooms();
      if (--S.timer <= 0) startAttract();
      break;
  }

  { const R = renderer(); if (R) R.step(S.aliens); }
}

// -------------------------------------------------------------------------
//  render
// -------------------------------------------------------------------------
function drawHeader() {
  // the label of whichever player is up blinks, as on the cabinet
  const blink = (S.tick >> 4) & 1;
  const live = S.mode !== MODE.ATTRACT;
  if (!(live && S.cur === 0 && blink)) text('1UP', 24, 0, 'r');
  text('HIGH SCORE', 72, 0, 'r');
  if (S.twoPlayer && !(live && S.cur === 1 && blink)) text('2UP', 176, 0, 'r');

  const p0 = S.players[0], p1 = S.players[1];
  textR(pad(p0 ? p0.score : 0, 6), 56, 8, 'w');
  textR(pad(S.hi, 6), 136, 8, 'w');
  if (S.twoPlayer) textR(pad(p1 ? p1.score : 0, 6), 208, 8, 'w');
}

function drawStatus() {
  const p = P();
  // lives, bottom left -- one ship per life still in reserve
  const n = Math.min(5, Math.max(0, p.lives - 1));
  for (let i = 0; i < n; i++) blit(ART.ship, 2 + i * 16, STATUS_Y, null);

  // stage flags, bottom right: a "10" flag for each ten, a pennant for each one
  let tens = Math.floor(p.stage / 10), ones = p.stage % 10;
  if (tens > 5) { tens = 5; ones = 0; }
  let x = W - 2;
  for (let i = 0; i < ones; i++) { x -= 8; blit(ART.flag1, x, STATUS_Y + 2, null); }
  for (let i = 0; i < tens; i++) { x -= 16; blit(ART.flag10, x, STATUS_Y, null); }
}

function drawEntities() {
  for (const a of S.aliens) {
    if (!a.alive) continue;
    blitC(alienArt(a), a.x, a.y, null);
  }
  if (S.mode === MODE.PLAY || S.mode === MODE.READY) {
    blitC(ART.ship, S.px, PLAYER_Y, null);
  }
  for (const s of S.pshots) blitC(ART.pshot, s.x, s.y, null);
  for (const b of S.eshots) blitC(ART.eshot, b.x, b.y, null);

  for (const b of S.booms) {
    const art = b.big ? BIGBOOM[b.f] : BOOM[b.f];
    if (art) blitC(art, b.x, b.y, null);
  }
  for (const p of S.pops) blitC(p.art, p.x, p.y, null);
}

const TITLE_Y = 60;

function drawAttract() {
  if (S.attractPage === 0) {
    textC('G A L A X I A N', TITLE_Y, 'c');
    textC('WE ARE THE GALAXIANS', TITLE_Y + 40, 'Y');
    textC('MISSION - DESTROY ALIENS', TITLE_Y + 56, 'Y');
    textC('PUSH 1 OR 2 PLAYER BUTTON', TITLE_Y + 96, 'w');
    textC('K FOR KEY BINDINGS', TITLE_Y + 112, 'c');
    textC('1979 NAMCO LTD', TITLE_Y + 132, 'r');
  } else {
    // What the flagship is worth depends on the escorts flying with it, so
    // the table shows the convoy rather than just a value.
    textC('- SCORE ADVANCE TABLE -', 40, 'c');

    const boss = FRAMES.boss.flap[0];
    const bossDive = FRAMES.boss.bank[1];
    const red = FRAMES.red.flap[0];
    const dead = BOOM[1];

    // [sprites shown], score text, text colour
    const rows = [
      [[[boss, 0]], '60', 'Y'],
      [[[bossDive, 0]], '150', 'Y'],
      [[[bossDive, 0], [red, 18]], '200', 'Y'],
      [[[bossDive, 0], [red, 18], [red, 36]], '300', 'Y'],
      [[[bossDive, 0], [dead, 18], [dead, 36]], '800', 'Y'],
      [[[red, 0]], '50   100', 'r'],
      [[[FRAMES.purple.flap[0], 0]], '40    80', 'p'],
      [[[FRAMES.blue.flap[0], 0]], '30    60', 'c'],
    ];

    let y = 62;
    for (const [group, label, c] of rows) {
      for (const [art, dx] of group) blitC(art, 32 + dx, y, null);
      textR(label + ' PTS', 216, y - 4, c);
      y += 20;
    }
    textC('SHOOT THE ESCORTS FIRST', 216, 'w');
  }
}

function drawOverlay() {
  if (S.mode === MODE.READY) {
    const p = S.cur + 1;
    textC('PLAYER ' + p, 120, 'c');
    if (P().lives === START_LIVES && P().stage === 1) textC('READY', 140, 'Y');
  }
  if (S.mode === MODE.CLEAR) textC('STAGE ' + P().stage, 128, 'Y');
  if (S.mode === MODE.OVER) textC('GAME OVER', 128, 'r');
  if (S.paused) textC('PAUSE', 128, 'w');
  if (S.demo && S.mode === MODE.PLAY) textC('DEMO', 24, 'w');
}

const VERSIONS = [
  { name: 'GALAXIAN', year: '1979', note: 'THE ORIGINAL ARCADE' },
  { name: 'GALAXIANS', year: '2026', note: 'REMASTERED' },
  { name: 'GALAXIANS', year: 'VECTOR', note: 'PHOSPHOR BEAM' },
  { name: 'GALAXIAN', year: 'X', note: 'WIDESCREEN - POWER-UPS - SKILL' },
];

function drawSelect() {
  textC('SELECT VERSION', 48, 'c');
  for (let i = 0; i < VERSIONS.length; i++) {
    const y = 76 + i * 30;
    const on = i === S.selIdx;
    const t = VERSIONS[i].name + ' ' + VERSIONS[i].year;
    textC(t, y, on ? 'Y' : 'w');
    textC(VERSIONS[i].note, y + 10, on ? 'c' : 'p');
    if (on && ((S.tick >> 3) & 1)) {
      const x0 = Math.round((W - t.length * 8) / 2);
      text('-', x0 - 16, y, 'r');
      text('-', x0 + t.length * 8 + 8, y, 'r');
    }
  }
  textC('ARROWS TO CHANGE', 200, 'w');
  textC('ENTER TO CONFIRM', 212, 'w');
  textC('K FOR KEY BINDINGS', 228, 'c');
}

// The bindings editor, in the arcade renderer's own 8x8 font.  Two columns of
// key names per action; the cursor picks a cell and ENTER listens for the next
// key pressed.
function drawKeys() {
  textC('KEY BINDINGS', 24, 'c');
  const x0 = 12, c0 = 108, c1 = 164;
  text('ACTION', x0, 38, 'p');
  text('KEY 1', c0, 38, 'p');
  text('KEY 2', c1, 38, 'p');
  for (let i = 0; i < ACTIONS.length; i++) {
    const a = ACTIONS[i];
    const y = 50 + i * 14;
    const on = i === S.keyIdx;
    text(a.name, x0, y, on ? 'Y' : 'w');
    for (let s = 0; s < BIND_SLOTS; s++) {
      const code = S.binds[a.key][s];
      const sel = on && s === S.keySlot;
      const listening = sel && S.keyWait;
      const cx = s ? c1 : c0;
      const label = listening ? (((S.tick >> 3) & 1) ? 'PRESS' : '')
                  : keyName(code);
      const col = listening ? 'Y'
                : !code && s === 0 ? 'r'
                : sel ? 'c' : on ? 'w' : 'p';
      if (sel) text('-', cx - 8, y, 'r');
      text(label, cx, y, col);
    }
  }
  textC('ARROWS MOVE   ENTER SET', 200, 'w');
  textC('BKSP CLEAR   R DEFAULTS', 212, 'w');
  textC('ESC TO GO BACK', 228, 'c');
}

function render() {
  const R = renderer();
  if (R) { renderModern(R); return; }
  clear();
  drawStars();
  drawHeader();
  if (S.mode === MODE.SELECT) drawSelect();
  else if (S.mode === MODE.KEYS) drawKeys();
  else if (S.mode === MODE.ATTRACT) drawAttract();
  else drawEntities();
  drawStatus();
  drawOverlay();
  flush();
}

// -------------------------------------------------------------------------
//  The modern renderers draw from the same state; everything they need is
//  gathered here so neither reaches into the simulation itself.
// -------------------------------------------------------------------------
function renderModern(R) {
  const p = P();
  R.render({
    canvas, ctx,
    mode: S.mode,
    aliens: S.aliens,
    px: S.px, py: PLAYER_Y,
    shipVisible: S.mode === MODE.PLAY || S.mode === MODE.READY,
    pshot: S.pshot, pshots: S.pshots, eshots: S.eshots, pops: S.pops,
    scroll: S.scroll,
    p0: S.players[0] ? S.players[0].score : 0,
    p1: S.players[1] ? S.players[1].score : 0,
    hi: S.hi, two: S.twoPlayer, cur: S.cur,
    lives: p.lives, stage: p.stage,
    overlay: modernOverlay,
    x: xr() ? xView() : null,
  });
}

// Everything the X presentation needs that the other renderers do not.  It is
// gathered here so the renderer never reaches into the simulation, same rule
// as the other two.
function xView() {
  return {
    drops: S.drops,
    powerups: POWERUPS,
    hold: S.hold, holdSel: S.holdSel, holdMax: HOLD_MAX,
    holdDefs: S.hold.map(powerupDef),
    enemyUpgrades: ENEMY_UPGRADES, eup: S.eup,
    ebanner: S.ebanner, ebannerT: S.ebannerT,
    weapon: S.weapon, maxWeapon: MAX_WEAPON,
    shield: S.shield, shieldMax: SHIELD_MAX,
    inv: S.inv, rapid: S.rapid, dbl: S.dbl,
    rapidMax: powerupDef('rapid').time, dblMax: powerupDef('score').time,
    combo: S.combo, comboMul: comboMul(), comboT: S.comboT, comboHold: COMBO_HOLD,
    banner: S.banner, bannerT: S.bannerT,
    skills: SKILLS, skill: S.skill, skillName: skill().name,
    demo: S.demo, paused: S.paused,
    attractPage: S.attractPage,
    selIdx: S.selIdx, versions: VERSIONS,
    // key bindings: the live names for the prompts, and the editor's state
    actions: ACTIONS, binds: S.binds, slots: BIND_SLOTS, keyName,
    keyIdx: S.keyIdx, keySlot: S.keySlot, keyWait: S.keyWait,
    cycleKey: keyName(S.binds.cycle[0]),
    useKey: keyName(S.binds.use[0]),
    versionKey: keyName(S.binds.version[0]),
    pauseKey: keyName(S.binds.pause[0]),
    muteKey: keyName(S.binds.mute[0]),
    track: A().trackName ? A().trackName() : '',
    alive: aliveCount(), total: 46, diving: diving(),
    startLives: startLives(),
    play: { left: PLAYER_MIN, right: PLAYER_MAX, top: HDR_H, bottom: PLAY_BOT },
  };
}

// Draw one alien for the tables and menus, whichever modern renderer is live.
function overlayShip(g, u, kind, x, y, scale, alpha) {
  g.save();
  g.globalAlpha = alpha === undefined ? 1 : alpha;
  g.translate(x * u.RES, y * u.RES);
  if (u.art && u.art[kind] && u.art[kind][0]) {
    const s = u.art[kind][0];
    g.scale(scale, scale);
    g.drawImage(s, -s.width / 2, -s.height / 2);
  } else if (u.drawAlienShape) {
    u.drawAlienShape(g, kind, 11 * u.RES * scale, 0, alpha);
  }
  g.restore();
}

function modernOverlay(g, u) {
  const { label, wordmark } = u;
  const centre = 112;
  if (S.mode === MODE.SELECT) {
    wordmark(g, 52);
    for (let i = 0; i < VERSIONS.length; i++) {
      const y = 104 + i * 31;
      const on = i === S.selIdx;
      if (on && g.createLinearGradient) {
        g.globalCompositeOperation = 'lighter';
        const grad = g.createLinearGradient(0, (y - 15) * u.RES, 0, (y + 9) * u.RES);
        grad.addColorStop(0, 'rgba(60,200,255,0)');
        grad.addColorStop(0.5, 'rgba(60,200,255,0.18)');
        grad.addColorStop(1, 'rgba(60,200,255,0)');
        g.fillStyle = grad;
        g.fillRect(14 * u.RES, (y - 15) * u.RES, 196 * u.RES, 24 * u.RES);
        g.globalCompositeOperation = 'source-over';
      }
      label(g, VERSIONS[i].name + ' ' + VERSIONS[i].year, centre, y, on ? 12 : 10,
            on ? '#ffffff' : 'rgba(170,200,240,0.6)', 'center',
            on ? '#4bd2ff' : null);
      label(g, VERSIONS[i].note, centre, y + 10, 6,
            on ? '#7fe6ff' : 'rgba(140,170,210,0.45)', 'center', null);
    }
    label(g, 'ARROWS TO CHANGE   ENTER TO CONFIRM', centre, 232, 6,
          'rgba(190,215,255,0.75)', 'center', null);
    label(g, 'K   KEY BINDINGS', centre, 244, 6, '#7fe6ff', 'center', null);
    return;
  }
  if (S.mode === MODE.KEYS) {
    label(g, 'KEY BINDINGS', centre, 30, 12, '#ffffff', 'center', '#4bd2ff');
    const c0 = 132, c1 = 190;
    label(g, 'ACTION', 20, 46, 6, 'rgba(150,185,230,0.6)', 'left', null);
    label(g, 'KEY 1', c0, 46, 6, 'rgba(150,185,230,0.6)', 'center', null);
    label(g, 'KEY 2', c1, 46, 6, 'rgba(150,185,230,0.6)', 'center', null);
    for (let i = 0; i < ACTIONS.length; i++) {
      const a = ACTIONS[i];
      const y = 60 + i * 15;
      const on = i === S.keyIdx;
      if (on && g.createLinearGradient) {
        g.globalCompositeOperation = 'lighter';
        g.fillStyle = 'rgba(60,200,255,0.13)';
        g.fillRect(14 * u.RES, (y - 10) * u.RES, 196 * u.RES, 14 * u.RES);
        g.globalCompositeOperation = 'source-over';
      }
      label(g, a.name, 20, y, 8, on ? '#ffffff' : 'rgba(175,205,240,0.7)',
            'left', on ? '#4bd2ff' : null);
      for (let s = 0; s < BIND_SLOTS; s++) {
        const code = S.binds[a.key][s];
        const sel = on && s === S.keySlot;
        const listening = sel && S.keyWait;
        const txt = listening ? (((S.tick >> 3) & 1) ? 'PRESS A KEY' : '')
                              : keyName(code);
        label(g, txt, s ? c1 : c0, y, 8,
              listening ? '#ffd36a'
              : !code && s === 0 ? '#ff6a8a'
              : sel ? '#7fe6ff' : 'rgba(175,205,240,0.7)',
              'center', sel ? '#2aa8d8' : null);
      }
    }
    label(g, 'ARROWS MOVE   ENTER SET   BKSP CLEAR', centre, 224, 6,
          'rgba(190,215,255,0.75)', 'center', null);
    label(g, 'R RESTORE DEFAULTS   ESC BACK', centre, 236, 6,
          'rgba(190,215,255,0.75)', 'center', null);
    return;
  }
  if (S.mode === MODE.ATTRACT) {
    if (S.attractPage === 0) {
      wordmark(g, 74);
      label(g, 'WE ARE THE GALAXIANS', centre, 128, 9, '#ffd36a', 'center', '#ff9a2a');
      label(g, 'MISSION: DESTROY ALIENS', centre, 143, 9, '#ffd36a', 'center', '#ff9a2a');
      const pulse = 0.6 + 0.4 * Math.sin(u.tick * 0.08);
      g.globalAlpha = pulse;
      label(g, 'PRESS 1 OR 2 TO PLAY', centre, 180, 9, '#ffffff', 'center', '#4bd2ff');
      g.globalAlpha = 1;
      label(g, keyName(S.binds.version[0]) + '  SWITCH VERSION     K  KEY BINDINGS',
            centre, 200, 6, 'rgba(180,205,245,0.7)', 'center', null);
      label(g, '1979 NAMCO  ·  HOMAGE BUILD', centre, 226, 6,
            'rgba(255,120,190,0.75)', 'center', null);
    } else {
      label(g, 'SCORE ADVANCE TABLE', centre, 44, 10, '#7fe6ff', 'center', '#2aa8d8');
      // [kind, values, escorts shown, escorts drawn as destroyed]
      const rows = [
        ['boss', ['60'], 0, false],
        ['boss', ['150'], 0, false],
        ['boss', ['200'], 1, false],
        ['boss', ['300'], 2, false],
        ['boss', ['800'], 2, true],
        ['red', ['50', '100'], 0, false],
        ['purple', ['40', '80'], 0, false],
        ['blue', ['30', '60'], 0, false],
      ];
      let y = 66;
      for (const [kind, vals, escorts, dim] of rows) {
        overlayShip(g, u, kind, 40, y, 0.5, 1);
        for (let e = 0; e < escorts; e++) {
          overlayShip(g, u, 'red', 58 + e * 15, y, 0.42, dim ? 0.22 : 1);
        }
        if (dim) {
          label(g, 'ESCORTS DOWN FIRST', 92, y + 3, 5,
                'rgba(255,150,130,0.95)', 'left', null);
        }
        label(g, vals.join('   ') + ' PTS', 208, y + 4, 9,
              kind === 'boss' ? '#ffcf4a'
            : kind === 'red' ? '#ff8a6a'
            : kind === 'purple' ? '#d18aff' : '#7fe6ff', 'right', null);
        y += 20;
      }
      label(g, 'SHOOT THE ESCORTS FIRST', centre, 232, 7,
            'rgba(255,255,255,0.85)', 'center', '#ff5cc0');
    }
    return;
  }
  if (S.mode === MODE.READY) {
    label(g, 'PLAYER ' + (S.cur + 1), centre, 118, 14, '#ffffff', 'center', '#4bd2ff');
    if (P().lives === START_LIVES && P().stage === 1) {
      label(g, 'READY', centre, 140, 11, '#ffd36a', 'center', '#ff9a2a');
    }
    // each level gets its own track, so say which one is coming up
    const tn = A().trackName ? A().trackName() : '';
    if (tn) {
      label(g, 'STAGE ' + P().stage, centre, 160, 8,
            'rgba(190,215,255,0.8)', 'center', null);
      label(g, tn, centre, 174, 9, '#7fe6ff', 'center', '#2aa8d8');
    }
  }
  if (S.mode === MODE.CLEAR) {
    label(g, 'STAGE ' + P().stage, centre, 130, 15, '#ffd36a', 'center', '#ff9a2a');
  }
  if (S.mode === MODE.OVER) {
    label(g, 'GAME OVER', centre, 130, 16, '#ff6a8a', 'center', '#ff2a5a');
  }
  if (S.paused) label(g, 'PAUSED', centre, 130, 13, '#ffffff', 'center', '#4bd2ff');
  if (S.demo && S.mode === MODE.PLAY) label(g, 'DEMO', centre, 34, 6, 'rgba(190,215,255,0.7)', 'center', null);
}

function flush() { ctx.putImageData(img, 0, 0); }

// -------------------------------------------------------------------------
//  presentation -- scale the 224x256 image up by whole pixels only, so every
//  game pixel stays a perfect square block however big the window is.
// -------------------------------------------------------------------------
// The displayed size is always a whole multiple of the 224x256 playfield, so
// the arcade renderer stays pixel-exact.  The modern renderer keeps the same
// on-screen size but backs it with a 4x buffer, so it supersamples.
function fitCanvas() {
  if (typeof innerWidth !== 'number') return;
  const R = renderer();
  if (R && R.FULL) { sizeFull(R); return; }   // X takes the whole window
  const s = Math.max(1, Math.floor(Math.min((innerWidth - 24) / W,
                                            (innerHeight - 56) / H)));
  canvas.style.width = (W * s) + 'px';
  canvas.style.height = (H * s) + 'px';
}
if (typeof addEventListener === 'function') {
  addEventListener('resize', fitCanvas);
  // the browser will not start audio until the page has been interacted with
  addEventListener("pointerdown", () => audioInit());
  fitCanvas();
}

// -------------------------------------------------------------------------
//  main loop -- fixed 60Hz step
// -------------------------------------------------------------------------
// boot on the version chooser, defaulting to whatever was picked last time
startAttract();
S.binds = loadBinds();
S.skill = loadSkill();
S.skin = loadSkin();
S.selIdx = Math.max(0, SKINS.indexOf(S.skin));
applySkin(S.skin);
S.mode = MODE.SELECT;

const STEP = 1000 / 60;
let acc = 0, last = 0;

function frame(now) {
  if (!last) last = now;
  acc += Math.min(100, now - last);
  last = now;
  let guard = 0;
  while (acc >= STEP && guard++ < 4) { update(); acc -= STEP; }
  render();
  requestAnimationFrame(frame);
}

if (typeof requestAnimationFrame === 'function') requestAnimationFrame(frame);
