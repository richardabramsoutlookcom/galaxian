// Rule checks against the engine, run headless.   node build/selftest.js
//
// These assert the things the README claims about fidelity: the formation
// census, every point value, the flagship escort rules, the one-shot limit,
// the enemy bullet cap, dive wrap-and-return, and the extra life.
const fs = require('fs'), vm = require('vm'), path = require('path');

const ROOT = path.join(__dirname, '..');
const W = 224, H = 256;

function makeSandbox(seed) {
  const fakeCanvas = {
    width: W, height: H, style: {},
    getContext: () => ({
      createImageData: (w, h) => ({ width: w, height: h,
                                    data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: () => {},
    }),
  };
  const M = Object.create(Math);
  if (seed !== undefined) {
    let s = seed >>> 0;
    M.random = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }
  const sb = {
    // no createElement, so the modern renderer finds no canvas to bake into
    // and draws nothing -- exactly what we want for a simulation-only check
    document: { getElementById: () => fakeCanvas, body: null },
    addEventListener: () => {}, removeEventListener: () => {},
    requestAnimationFrame: () => {},
    setInterval: () => 0, clearInterval: () => {}, setTimeout: () => 0,
    performance: { now: () => 0 },
    // a real store, so binding / skin / high-score persistence can be tested
    localStorage: (() => { const m = new Map(); return {
      getItem: k => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => m.set(k, String(v)),
      removeItem: k => m.delete(k), clear: () => m.clear() }; })(),
    // X sizes itself to the window, so give it one
    innerWidth: 1600, innerHeight: 900, devicePixelRatio: 1,
    Math: M, Date, console, JSON, isNaN, parseInt, parseFloat, String, Number,
    Object, Array, Map, Set, Uint32Array, Uint8ClampedArray, Float64Array,
    Path2D: function () {},
  };
  sb.window = sb; sb.globalThis = sb;
  vm.createContext(sb);
  for (const f of ['src/art.js', 'src/audio.js', 'src/neoaudio.js',
                   'src/neo.js', 'src/vector.js', 'src/x.js', 'src/engine.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sb,
                    { filename: f });
  }
  return sb;
}

// -------------------------------------------------------------------------
//  A sandbox that can actually draw.
//
//  The plain sandbox has no document.createElement, so every modern renderer
//  finds no canvas to bake into and early-returns -- which once let a stale
//  reference survive a green run and only fail in the browser.  This one hands
//  out recording contexts, so every drawing call in neo / vector / x really
//  executes.  It proves "does not throw", not "looks right".
// -------------------------------------------------------------------------
function makeDrawSandbox(w, h) {
  const grad = { addColorStop() {} };
  function mkCtx(owner) {
    const g = {
      canvas: owner,
      fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: '', lineJoin: '',
      globalAlpha: 1, globalCompositeOperation: 'source-over',
      shadowBlur: 0, shadowColor: '', font: '', textAlign: '',
      textBaseline: '', letterSpacing: '0px', filter: 'none',
      save() {}, restore() {}, translate() {}, rotate() {}, scale() {},
      setTransform() {}, resetTransform() {}, transform() {},
      clearRect() {}, fillRect() {}, strokeRect() {}, rect() {},
      beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
      quadraticCurveTo() {}, bezierCurveTo() {}, arc() {}, arcTo() {},
      ellipse() {}, fill() {}, stroke() {}, clip() {},
      fillText() {}, strokeText() {},
      measureText: s => ({ width: String(s).length * 6 }),
      createLinearGradient: () => grad,
      createRadialGradient: () => grad,
      createPattern: () => null,
      drawImage() {},
      createImageData: (a, b) => ({ width: a, height: b,
                                    data: new Uint8ClampedArray(a * b * 4) }),
      putImageData() {}, getImageData: (a, b, c, d) =>
        ({ width: c, height: d, data: new Uint8ClampedArray(c * d * 4) }),
    };
    return g;
  }
  function mkCanvasObj(cw, ch) {
    const c = { width: cw || 300, height: ch || 150, style: {} };
    c.getContext = () => (c._ctx || (c._ctx = mkCtx(c)));
    return c;
  }
  const screen = mkCanvasObj(w, h);
  function P2D() {}
  P2D.prototype.moveTo = function () {};
  P2D.prototype.lineTo = function () {};
  P2D.prototype.closePath = function () {};
  P2D.prototype.arc = function () {};
  P2D.prototype.ellipse = function () {};

  const sb = {
    document: {
      getElementById: () => screen,
      createElement: () => mkCanvasObj(),
      body: { classList: { add() {}, remove() {} } },
    },
    addEventListener: () => {}, removeEventListener: () => {},
    requestAnimationFrame: () => {},
    setInterval: () => 0, clearInterval: () => {}, setTimeout: () => 0,
    performance: { now: () => 0 },
    localStorage: (() => { const m = new Map(); return {
      getItem: k => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => m.set(k, String(v)) }; })(),
    innerWidth: w, innerHeight: h, devicePixelRatio: 1,
    Math, Date, console, JSON, isNaN, parseInt, parseFloat, String, Number,
    Object, Array, Map, Set, Uint32Array, Uint8ClampedArray, Float64Array,
    Path2D: P2D,
  };
  sb.window = sb; sb.globalThis = sb;
  vm.createContext(sb);
  for (const f of ['src/art.js', 'src/audio.js', 'src/neoaudio.js',
                   'src/neo.js', 'src/vector.js', 'src/x.js', 'src/engine.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sb,
                    { filename: f });
  }
  return sb;
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? '  -- ' + detail : ''}`); }
}
function eq(name, got, want) {
  check(name, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

const sb = makeSandbox();
const run = src => vm.runInContext(src, sb);

console.log('\nformation');
run('startGame(false)');
const census = run(`(() => {
  const c = {};
  for (const a of S.aliens) c[a.kind] = (c[a.kind] || 0) + 1;
  return { total: S.aliens.length, ...c };
})()`);
eq('46 aliens in the wave', census.total, 46);
eq('2 flagships', census.boss, 2);
eq('6 red', census.red, 6);
eq('8 purple', census.purple, 8);
eq('30 blue', census.blue, 30);
eq('ten columns', run('COLS'), 10);
check('flagships sit on the top row',
      run('S.aliens.filter(a=>a.kind==="boss").every(a=>a.row===0)'));
check('blue occupy the three bottom rows',
      run('S.aliens.filter(a=>a.kind==="blue").every(a=>a.row>=3)'));

console.log('\npoint values');
function pts(kind, flying) {
  return run(`(() => {
    startGame(false);
    const p = S.players[0]; p.score = 0;
    const a = S.aliens.find(x => x.kind === '${kind}');
    a.state = '${flying ? 'dive' : 'form'}';
    killAlien(a);
    return p.score;
  })()`);
}
eq('blue in formation', pts('blue', false), 30);
eq('blue diving', pts('blue', true), 60);
eq('purple in formation', pts('purple', false), 40);
eq('purple diving', pts('purple', true), 80);
eq('red in formation', pts('red', false), 50);
eq('red diving', pts('red', true), 100);
eq('flagship in formation', pts('boss', false), 60);

console.log('\nflagship escort rules');
function bossScore(escorts, killedFirst) {
  return run(`(() => {
    startGame(false);
    const p = S.players[0]; p.score = 0;
    const boss = S.aliens.find(a => a.kind === 'boss');
    const g = { id: 1, launched: ${escorts}, alive: ${escorts} };
    boss.state = 'dive'; boss.group = g;
    const reds = S.aliens.filter(a => a.kind === 'red').slice(0, ${escorts});
    for (const r of reds) { r.state = 'dive'; r.group = g; r.isEscort = true; }
    if (${killedFirst}) for (const r of reds) killAlien(r);
    const before = p.score;
    killAlien(boss);
    return p.score - before;
  })()`);
}
eq('dives alone', bossScore(0, false), 150);
eq('one escort still flying', bossScore(1, false), 200);
eq('two escorts still flying', bossScore(2, false), 300);
eq('both escorts shot first', bossScore(2, true), 800);
check('the 800 sprite is shown for the jackpot',
      run(`(() => {
        startGame(false);
        const boss = S.aliens.find(a => a.kind === 'boss');
        const g = { id: 1, launched: 2, alive: 0 };
        boss.state = 'dive'; boss.group = g;
        S.pops.length = 0;
        killAlien(boss);
        return S.pops.length === 1 && S.pops[0].art === ART.score800;
      })()`));

console.log('\nshots');
run('startGame(false); S.mode = MODE.PLAY;');
run('firePlayer(); firePlayer(); firePlayer();');
check('only one player shot exists at a time', run('S.pshot !== null'));
eq('a second shot is refused while one flies',
   run('(() => { const a = S.pshot; firePlayer(); return S.pshot === a; })()'), true);
eq('enemy shot cap', run('MAX_ESHOTS'), 3);
const capped = run(`(() => {
  startGame(false); S.mode = MODE.PLAY;
  let peak = 0;
  for (let i = 0; i < 4000; i++) { update(); peak = Math.max(peak, S.eshots.length); }
  return peak;
})()`);
check('enemy shots never exceed the cap in play', capped <= 3, `peak ${capped}`);

console.log('\ndiving -- the arcade flight model');
const wrapped = run(`(() => {
  startGame(false); S.mode = MODE.PLAY;
  const a = S.aliens.find(x => x.kind === 'blue');
  const slotY0 = slotY(a), slotX0 = slotX(a);
  launch(a, 0);
  let sawArc = false, sawAttack = false, sawReturn = false, home = false;
  let climb = 0, faces = new Set(), descents = [];
  let prevY = a.y;
  for (let i = 0; i < 4000 && !home; i++) {
    if (a.state === 'arc') {
      sawArc = true;
      climb = Math.min(climb, a.y - slotY0);
    }
    if (a.state === 'attack') {
      if (!sawAttack) sawAttack = true;
      else descents.push(a.y - prevY);
    }
    if (a.state === 'return') sawReturn = true;
    if (sawReturn && a.state === 'form') home = true;
    faces.add(Math.round(a.face));
    prevY = a.y;
    updateFormation();
  }
  return { sawArc, sawAttack, sawReturn, home, climb,
           faceCount: faces.size,
           descentAlways1: descents.length > 40 && descents.every(d => d === 1),
           atSlot: Math.abs(a.x - slotX(a)) < 1 && Math.abs(a.y - slotY(a)) < 1 };
})()`);
check('a diver peels off along the arc', wrapped.sawArc);
check('the peel-off climbs before it dives', wrapped.climb <= -10,
      `rose ${-wrapped.climb}px, expected ~16`);
check('it then flies the attack sweep', wrapped.sawAttack);
check('descent is a constant 1px per frame', wrapped.descentAlways1);
check('it rotates through several facings', wrapped.faceCount >= 6,
      `${wrapped.faceCount} distinct facings`);
check('it re-enters from the top after passing the bottom', wrapped.sawReturn);
check('and flies back into its slot', wrapped.home && wrapped.atSlot);

// The sweep is a cosine about a fixed pivot -- it must cross the pivot and
// come back, never home in on the player.
const sweepShape = run(`(() => {
  startGame(false); S.mode = MODE.PLAY;
  const a = S.aliens.find(x => x.kind === 'purple');
  a.x = 40; S.px = 180;
  launch(a, 0);
  // run to the exact frame the arc hands over to the sweep, and sample there:
  // the arc has moved the alien, so the radius is set from where it ends up
  let r = 0, pivot = 0, atX = 0;
  for (let i = 0; i < 120; i++) {
    updateFormation();
    if (a.state === 'attack') { r = a.hh; pivot = a.pivot; atX = a.x; break; }
  }
  const want = Math.min(112, Math.max(48, Math.abs(atX - S.px) / 2 + 16));
  const xs = [];
  for (let i = 0; i < 200 && a.state === 'attack'; i++) { updateFormation(); xs.push(a.x); }
  return { r: Math.round(r * 100) / 100, want: Math.round(want * 100) / 100,
           pivot: Math.round(pivot), atX: Math.round(atX),
           min: Math.round(Math.min(...xs)), max: Math.round(Math.max(...xs)),
           startedRight: Math.abs(Math.abs(r) - want) < 0.001,
           towardPlayer: r > 0 === (atX > S.px) };
})()`);
check('the sweep radius is set from the distance to the player',
      sweepShape.startedRight, JSON.stringify(sweepShape));
check('and is aimed so the alien sweeps toward the player',
      sweepShape.towardPlayer, JSON.stringify(sweepShape));
check('the alien sweeps across the pivot rather than homing',
      sweepShape.min < sweepShape.pivot && sweepShape.max > sweepShape.pivot - 1,
      JSON.stringify(sweepShape));

// The convoy must fly as one rigid shape: escorts copy the flagship's sweep,
// so their offsets from it stay fixed for the whole run.
const convoy = run(`(() => {
  startGame(false); S.mode = MODE.PLAY; S.px = 112;
  const boss = S.aliens.find(a => a.kind === 'boss');
  launchBoss(boss, 0);
  const esc = S.aliens.filter(a => a.isEscort && a.alive);
  const offs = [];
  // only while the whole convoy is still in the steady dive -- each member
  // independently accelerates at the near-bottom line, so the shape breaks up
  // there, exactly as it does on the machine
  for (let i = 0; i < 400; i++) {
    updateFormation();
    const all = [boss].concat(esc);
    if (all.every(m => m.state === 'attack')) {
      offs.push(esc.map(e => [Math.round((e.x - boss.x) * 10) / 10,
                              Math.round((e.y - boss.y) * 10) / 10]));
    }
  }
  if (!offs.length) return { escorts: esc.length, rigid: false, samples: 0 };
  const first = JSON.stringify(offs[0]);
  const rigid = offs.every(o => JSON.stringify(o) === first);
  return { escorts: esc.length, rigid, samples: offs.length, offsets: offs[0] };
})()`);
eq('a flagship launches with two escorts', convoy.escorts, 2);
check('the convoy holds its shape for the whole run',
      convoy.rigid && convoy.samples > 80, JSON.stringify(convoy));

// Bombs are dropped at exact heights, so a diver drops at most `fireMul` of
// them and always at the same places.
const bombing = run(`(() => {
  startGame(false); S.mode = MODE.PLAY;
  const a = S.aliens.find(x => x.kind === 'blue');
  launch(a, 0);
  const at = [];
  const n0 = S.eshots.length;
  for (let i = 0; i < 400 && a.state !== 'return' && a.state !== 'form'; i++) {
    const before = S.eshots.length;
    updateFormation();
    if (S.eshots.length > before) at.push(Math.round(a.y));
  }
  return { at, fireMul: diff().fireMul };
})()`);
check('bombs are dropped at the exact ROM heights',
      bombing.at.length > 0
      && bombing.at.every(y => (157 - y) % 25 === 0 && y <= 157),
      JSON.stringify(bombing));
check('a diver drops no more bombs than the range multiplier allows',
      bombing.at.length <= bombing.fireMul, JSON.stringify(bombing));

console.log('\nprogression');
eq('extra life threshold', run('EXTRA_LIFE_AT'), 7000);
eq('starting lives', run('START_LIVES'), 3);
const extra = run(`(() => {
  startGame(false);
  const p = S.players[0];
  const before = p.lives;
  addScore(6999);
  const mid = p.lives;
  addScore(1);
  return { before, mid, after: p.lives };
})()`);
check('extra life awarded exactly once at 7000',
      extra.mid === extra.before && extra.after === extra.before + 1,
      JSON.stringify(extra));
check('a second award does not fire',
      run('(() => { const p = S.players[0]; const l = p.lives; addScore(9000); return p.lives === l; })()'));

const cleared = run(`(() => {
  startGame(false); S.mode = MODE.PLAY;
  for (const a of S.aliens) a.alive = false;
  const stageBefore = S.players[0].stage;
  let sawClear = false, refilled = -1;
  // sample the new wave the moment it is laid out; play a little longer and a
  // diver may legitimately have traded itself against the parked ship
  for (let i = 0; i < 400; i++) {
    update();
    if (S.mode === MODE.CLEAR) sawClear = true;
    if (sawClear && refilled < 0 && S.mode === MODE.READY) {
      refilled = S.aliens.filter(a => a.alive).length;
    }
  }
  return { sawClear, stageBefore, stageAfter: S.players[0].stage, refilled };
})()`);
check('clearing the wave ends the stage', cleared.sawClear);
eq('the stage number advances', cleared.stageAfter, cleared.stageBefore + 1);
eq('and a fresh wave of 46 appears', cleared.refilled, 46);

// regression: the demo used to share S.timer with the mode countdown, so the
// READY that follows a cleared wave zeroed it and threw the demo back to the
// title screen mid-wave.
const demoSurvives = run(`(() => {
  startDemo();
  const left0 = S.demoLeft;
  for (const a of S.aliens) a.alive = false;   // clear the wave under it
  for (let i = 0; i < 350; i++) update();
  return { mode: S.mode, demo: S.demo, left0, left: S.demoLeft,
           stage: S.players[0].stage };
})()`);
check('the demo survives a wave clear instead of bailing to the title',
      demoSurvives.demo === true && demoSurvives.mode !== 'attract',
      JSON.stringify(demoSurvives));
check('the demo still runs on its own clock',
      demoSurvives.left > 0 && demoSurvives.left < demoSurvives.left0);

console.log('\ntwo player');
run('startGame(true)');
eq('two independent players', run('S.players.length'), 2);
check('each keeps its own score, lives and stage',
      run(`(() => {
        S.players[0].score = 1234; S.players[0].stage = 3;
        S.players[1].score = 99;   S.players[1].stage = 1;
        return S.players[0].score !== S.players[1].score
            && S.players[0].stage !== S.players[1].stage;
      })()`));

// -------------------------------------------------------------------------
//  The whole point of the two versions is that only the presentation differs.
//  Run the identical seeded simulation under each skin and demand that every
//  position, score and state matches exactly, frame for frame.
// -------------------------------------------------------------------------
//  X is deliberately excluded: it is the one version that adds rules.
console.log('\n1979, 2026 and VECTOR are the same game');

function traceSkin(skin, seed) {
  const box = makeSandbox(seed);
  return vm.runInContext(`(() => {
    applySkin('${skin}');
    startGame(false);
    S.mode = MODE.PLAY;
    S.demo = true; S.demoLeft = 1e9;
    const marks = [];
    for (let i = 0; i < 2400; i++) {
      update();
      if (S.mode === 'dying') S.mode = 'play';
      if (i % 60 === 0) {
        let h = 0;
        for (const a of S.aliens) {
          h = (h * 31 + (a.alive ? 1 : 0)
                      + Math.round(a.x * 64)
                      + Math.round(a.y * 64) * 7
                      + Math.round(a.face * 16) * 13
                      + a.state.length * 101) | 0;
        }
        for (const b of S.eshots) h = (h * 31 + Math.round(b.x * 64) + Math.round(b.y * 64)) | 0;
        if (S.pshot) h = (h * 31 + Math.round(S.pshot.x) + Math.round(S.pshot.y) * 3) | 0;
        marks.push([h, S.players[0].score, S.players[0].lives,
                    S.players[0].stage, Math.round(S.px * 64), S.mode]);
      }
    }
    return { skin: S.skin, marks: JSON.stringify(marks) };
  })()`, box);
}

const runs = {};
for (const skin of ['retro', 'neo', 'vector']) {
  runs[skin] = traceSkin(skin, 987654321);
  eq(`the ${skin} skin is active in its run`, runs[skin].skin, skin);
}
for (const skin of ['neo', 'vector']) {
  const same = runs.retro.marks === runs[skin].marks;
  check(`2400 frames are identical between retro and ${skin}`, same,
        same ? '' : 'first divergence at sample ' +
          JSON.parse(runs.retro.marks).findIndex((m, i) =>
            JSON.stringify(m) !== JSON.stringify(JSON.parse(runs[skin].marks)[i])));
}
check('the run actually did something (not a trivial match)',
      JSON.parse(runs.retro.marks).some(m => m[1] > 0));

for (const f of ['src/neo.js', 'src/vector.js', 'src/x.js']) {
  check(`${f} never draws from the simulation random stream`,
        !fs.readFileSync(path.join(ROOT, f), 'utf8')
           .split('\n').filter(l => !l.trim().startsWith('//'))
           .join('\n').includes('Math.random'));
}

console.log('\nversion select');
const sel = run(`(() => {
  const seen = [];
  for (const s of SKINS) { applySkin(s); seen.push(S.skin); }
  applySkin('retro');
  return { seen, skins: SKINS.slice(), versions: VERSIONS.length };
})()`);
eq('four versions are offered', sel.skins.length, 4);
eq('and each has a menu entry', sel.versions, 4);
check('every skin can be selected',
      JSON.stringify(sel.seen) === JSON.stringify(sel.skins),
      JSON.stringify(sel));
check('the boot screen is its own mode', run('MODE.SELECT') === 'select');

// Drive the actual key handler, not applySkin -- the menu once had a
// two-option toggle left over from before the third version existed, so it
// could never reach the last entry even though the entry was on screen.
const press = k => `(() => {
  onKey({ code: '${k}', preventDefault() {} }, true);
  onKey({ code: '${k}', preventDefault() {} }, false);
  return S.skin;
})()`;
const keyNav = run(`(() => {
  applySkin(SKINS[0]); S.selIdx = 0; S.mode = MODE.SELECT;
  const down = [], up = [];
  for (let i = 0; i < SKINS.length + 1; i++) {
    onKey({ code: 'ArrowDown', preventDefault() {} }, true);
    onKey({ code: 'ArrowDown', preventDefault() {} }, false);
    down.push(S.skin);
  }
  applySkin(SKINS[0]); S.selIdx = 0; S.mode = MODE.SELECT;
  for (let i = 0; i < SKINS.length + 1; i++) {
    onKey({ code: 'ArrowUp', preventDefault() {} }, true);
    onKey({ code: 'ArrowUp', preventDefault() {} }, false);
    up.push(S.skin);
  }
  return { down, up, skins: SKINS.slice() };
})()`);
const N = keyNav.skins.length;
check('arrowing down reaches every version and wraps',
      new Set(keyNav.down.slice(0, N)).size === N
      && keyNav.down[N - 1] === keyNav.skins[0]
      && keyNav.down[0] === keyNav.skins[1],
      JSON.stringify(keyNav.down));
check('arrowing up walks the other way and wraps',
      new Set(keyNav.up.slice(0, N)).size === N
      && keyNav.up[0] === keyNav.skins[N - 1]
      && keyNav.up[N - 1] === keyNav.skins[0],
      JSON.stringify(keyNav.up));

const vKey = run(`(() => {
  applySkin(SKINS[0]); S.selIdx = 0; startAttract();
  const seen = [];
  for (let i = 0; i < SKINS.length; i++) {
    onKey({ code: 'KeyV', preventDefault() {} }, true);
    onKey({ code: 'KeyV', preventDefault() {} }, false);
    seen.push(S.skin);
  }
  return seen;
})()`);
check('V cycles every version from the attract screen',
      new Set(vKey).size === sel.skins.length, JSON.stringify(vKey));

check('confirming the menu keeps the highlighted version',
      run(`(() => {
        applySkin(SKINS[0]); S.selIdx = 0; S.mode = MODE.SELECT;
        for (let i = 0; i < SKINS.length - 1; i++) {
          onKey({ code: 'ArrowDown', preventDefault() {} }, true);
          onKey({ code: 'ArrowDown', preventDefault() {} }, false);
        }
        const picked = S.skin;
        onKey({ code: 'Enter', preventDefault() {} }, true);
        onKey({ code: 'Enter', preventDefault() {} }, false);
        return picked === SKINS[SKINS.length - 1] && S.skin === picked
               && S.mode === MODE.ATTRACT;
      })()`));
check('every modern skin shares the 2026 sound bank',
      run(`(() => {
        applySkin('neo'); const a = A() === NeoAudio;
        applySkin('vector'); const b = A() === NeoAudio;
        applySkin('x'); const d = A() === NeoAudio;
        applySkin('retro'); const c = A() === Sfx;
        return a && b && c && d;
      })()`));

console.log('\nsoundtracks');
const music = run(`(() => {
  const names = NeoAudio.trackList();
  const perStage = [];
  for (let s = 1; s <= names.length + 2; s++) {
    NeoAudio.setTrack(s);
    perStage.push(NeoAudio.trackName());
  }
  return { names, perStage, count: NeoAudio.trackCount() };
})()`);
check('there are several distinct tracks', music.count >= 4, `${music.count}`);
check('every track has a name and they are all different',
      new Set(music.names).size === music.names.length
      && music.names.every(n => n && n.length > 2), JSON.stringify(music.names));
check('each level gets its own track',
      music.perStage.slice(0, music.count).join('|') === music.names.join('|'),
      JSON.stringify(music.perStage));
check('tracks cycle once the list runs out',
      music.perStage[music.count] === music.names[0]
      && music.perStage[music.count + 1] === music.names[1],
      JSON.stringify(music.perStage));
check('starting a stage selects that stage’s track',
      run(`(() => {
        applySkin('neo');
        startGame(false);
        const a = NeoAudio.trackName();
        S.players[0].stage = 3; startStage(null);
        const b = NeoAudio.trackName();
        return a !== b && b === NeoAudio.trackList()[2];
      })()`));
check('the arcade version has no soundtrack to select',
      run(`(() => { Sfx.setTrack(4); return Sfx.trackName() === ''; })()`));

// -------------------------------------------------------------------------
//  GALAXIAN X.  It is the one version that changes the rules, so what is
//  tested here is that the rules exist under X and are completely absent
//  under the other three.
// -------------------------------------------------------------------------
console.log('\ngalaxian x');

const xbox = makeSandbox(4242);
const xrun = src => vm.runInContext(src, xbox);
xrun(`applySkin('x')`);

eq('X is the fourth skin', xrun('SKINS[3]'), 'x');
check('X declares itself full-screen', xrun('renderer().FULL === true'));
check('the other renderers do not',
      xrun(`(() => { applySkin('neo'); const a = !renderer().FULL;
                     applySkin('vector'); const b = !renderer().FULL;
                     applySkin('x'); return a && b; })()`));

eq('four skill tiers', xrun('SKILLS.length'), 4);
check('every tier is named and they are all different',
      xrun(`(() => { const n = SKILLS.map(s => s.name);
                     return new Set(n).size === n.length
                            && n.every(s => s && s.length > 2); })()`),
      JSON.stringify(xrun('SKILLS.map(s => s.name)')));
check('harder tiers pay more and give less',
      xrun(`(() => {
        for (let i = 1; i < SKILLS.length; i++) {
          const a = SKILLS[i - 1], b = SKILLS[i];
          if (!(b.scoreMul > a.scoreMul)) return false;
          if (!(b.delayMul < a.delayMul)) return false;
          if (!(b.maxEshots >= a.maxEshots)) return false;
          if (!(b.lives <= a.lives)) return false;
        }
        return true;
      })()`));

const skillPace = xrun(`(() => {
  const out = [];
  for (let i = 0; i < SKILLS.length; i++) {
    S.skill = i;
    startGame(false);
    const d = diff();
    out.push([d.delay, d.maxAttackers, maxEshots(), P().lives]);
  }
  S.skill = 1;
  return out;
})()`);
check('the skill tier drives launch pace, attacker count, bombs and ships',
      skillPace[0][0] > skillPace[3][0]
      && skillPace[0][1] < skillPace[3][1]
      && skillPace[0][2] < skillPace[3][2]
      && skillPace[0][3] > skillPace[3][3],
      JSON.stringify(skillPace));

check('the skill screen is its own mode and 1 goes there first',
      xrun(`(() => {
        startAttract();
        onKey({ code: 'Digit1', preventDefault() {} }, true);
        onKey({ code: 'Digit1', preventDefault() {} }, false);
        const a = S.mode === MODE.SKILL;
        onKey({ code: 'Enter', preventDefault() {} }, true);
        onKey({ code: 'Enter', preventDefault() {} }, false);
        return a && S.mode === MODE.READY;
      })()`));
check('and arrowing the skill screen reaches every tier and wraps',
      xrun(`(() => {
        startAttract(); S.mode = MODE.SKILL; S.skill = 0;
        const seen = [];
        for (let i = 0; i < SKILLS.length + 1; i++) {
          onKey({ code: 'ArrowRight', preventDefault() {} }, true);
          onKey({ code: 'ArrowRight', preventDefault() {} }, false);
          seen.push(S.skill);
        }
        return new Set(seen.slice(0, SKILLS.length)).size === SKILLS.length
               && seen[SKILLS.length - 1] === 0;
      })()`));
check('the classic versions never show the skill screen',
      xrun(`(() => {
        applySkin('retro'); startAttract();
        onKey({ code: 'Digit1', preventDefault() {} }, true);
        onKey({ code: 'Digit1', preventDefault() {} }, false);
        const straight = S.mode === MODE.READY;
        applySkin('x');
        return straight;
      })()`));

console.log('\nx weapons and power-ups');
eq('three weapon tiers', xrun('MAX_WEAPON'), 3);
const salvo = xrun(`(() => {
  const out = [];
  for (let w = 0; w < MAX_WEAPON; w++) {
    startGame(false); S.mode = MODE.PLAY; S.weapon = w; S.pcool = 0;
    firePlayer();
    out.push(S.pshots.length);
  }
  return out;
})()`);
check('each weapon tier puts more bolts in the air',
      salvo[0] === 1 && salvo[1] === 2 && salvo[2] === 3, JSON.stringify(salvo));
check('the cooldown holds the trigger between salvos',
      xrun(`(() => {
        startGame(false); S.mode = MODE.PLAY; S.weapon = 0; S.pcool = 0;
        firePlayer();
        const n = S.pshots.length;
        firePlayer(); firePlayer();
        return S.pcool > 0 && S.pshots.length === n;
      })()`));
check('and the bolt budget is capped',
      xrun(`(() => {
        startGame(false); S.mode = MODE.PLAY; S.weapon = 2;
        let peak = 0;
        for (let i = 0; i < 600; i++) {
          S.pcool = 0; firePlayer();
          peak = Math.max(peak, S.pshots.length);
          updateShots();
        }
        return peak <= X_INFLIGHT[2] + 2;
      })()`));

check('a shield charge soaks a hit instead of costing a life',
      xrun(`(() => {
        startGame(false); S.mode = MODE.PLAY;
        S.shield = 1; S.inv = 0;
        const lives = P().lives;
        killPlayer();
        return S.shield === 0 && S.mode === MODE.PLAY && P().lives === lives
               && S.inv > 0;
      })()`));
check('and once it is gone the next hit kills',
      xrun(`(() => {
        startGame(false); S.mode = MODE.PLAY; S.shield = 0; S.inv = 0;
        killPlayer();
        return S.mode === MODE.DYING;
      })()`));

check('a collected pod is stowed rather than spent',
      xrun(`(() => {
        startGame(false); S.mode = MODE.PLAY;
        const before = S.weapon;
        collect({ kind: 'beam', x: 100, y: 200 });
        return S.hold.length === 1 && S.hold[0] === 'beam'
               && S.weapon === before;
      })()`));
eq('the hold holds three', xrun('HOLD_MAX'), 3);
check('a fourth pod is banked as points instead of lost',
      xrun(`(() => {
        startGame(false); S.mode = MODE.PLAY;
        for (let i = 0; i < HOLD_MAX; i++) collect({ kind: 'beam', x: 0, y: 0 });
        const score = P().score;
        collect({ kind: 'rapid', x: 0, y: 0 });
        return S.hold.length === HOLD_MAX && P().score > score;
      })()`));
check('C cycles the hold in a loop',
      xrun(`(() => {
        startGame(false); S.mode = MODE.PLAY;
        for (const k of ['beam', 'rapid', 'nova']) collect({ kind: k, x: 0, y: 0 });
        S.holdSel = 0;
        const seen = [];
        for (let i = 0; i < 4; i++) {
          onKey({ code: 'KeyC', preventDefault() {} }, true);
          onKey({ code: 'KeyC', preventDefault() {} }, false);
          seen.push(S.holdSel);
        }
        return seen.join(',') === '1,2,0,1';
      })()`));
check('every power-up applies its effect when it is spent',
      xrun(`(() => {
        const res = {};
        for (const p of POWERUPS) {
          startGame(false); S.mode = MODE.PLAY;
          const before = { w: S.weapon, s: S.shield, r: S.rapid, d: S.dbl };
          collect({ kind: p.key, x: 100, y: 200 });
          S.holdSel = 0;
          useHold();
          res[p.key] =
              p.key === 'beam'   ? S.weapon > before.w
            : p.key === 'shield' ? S.shield > before.s
            : p.key === 'rapid'  ? S.rapid > before.r
            : p.key === 'score'  ? S.dbl > before.d
            : true;
          if (S.hold.length !== 0) res[p.key] = false;
        }
        return Object.keys(res).every(k => res[k]);
      })()`));
check('both default spend keys work, and the cycle key is not one of them',
      xrun(`(() => {
        const press = k => {
          onKey({ code: k, preventDefault() {} }, true);
          onKey({ code: k, preventDefault() {} }, false);
        };
        for (const k of S.binds.use.filter(Boolean)) {
          startGame(false); S.mode = MODE.PLAY;
          collect({ kind: 'shield', x: 0, y: 0 });
          press(k);
          if (S.hold.length !== 0) return false;
        }
        // cycling must only move the highlight, or the hold could never be
        // browsed without emptying it
        startGame(false); S.mode = MODE.PLAY;
        collect({ kind: 'shield', x: 0, y: 0 });
        press(S.binds.cycle[0]);
        return S.hold.length === 1;
      })()`));
check('and rebinding them moves both',
      xrun(`(() => {
        const press = k => {
          onKey({ code: k, preventDefault() {} }, true);
          onKey({ code: k, preventDefault() {} }, false);
        };
        setBind('use', 0, 'KeyU'); setBind('use', 1, '');
        setBind('cycle', 0, 'KeyY');
        startGame(false); S.mode = MODE.PLAY;
        for (const k of ['beam', 'shield']) collect({ kind: k, x: 0, y: 0 });
        S.holdSel = 0;
        press('KeyY');
        const cycled = S.holdSel === 1;
        press('KeyX');
        const oldDead = S.hold.length === 2;
        press('KeyU');
        const spent = S.hold.length === 1 && S.shield === 1;
        S.binds = defaultBinds(); saveBinds();
        return cycled && oldDead && spent;
      })()`));
check('X spends the selected pod, not the first one',
      xrun(`(() => {
        startGame(false); S.mode = MODE.PLAY;
        for (const k of ['beam', 'shield', 'nova']) collect({ kind: k, x: 0, y: 0 });
        S.holdSel = 1;
        onKey({ code: 'KeyX', preventDefault() {} }, true);
        onKey({ code: 'KeyX', preventDefault() {} }, false);
        return S.shield === 1 && S.hold.join(',') === 'beam,nova';
      })()`));
check('spending with an empty hold does nothing at all',
      xrun(`(() => {
        startGame(false); S.mode = MODE.PLAY;
        S.hold.length = 0;
        const ups = ENEMY_UPGRADES.reduce((n, e) => n + S.eup[e.key], 0);
        useHold();
        return ENEMY_UPGRADES.reduce((n, e) => n + S.eup[e.key], 0) === ups;
      })()`));

console.log('\nx escalation -- arming yourself arms the swarm');
check('spending a pod hands the swarm exactly one upgrade',
      xrun(`(() => {
        startGame(false); S.mode = MODE.PLAY;
        const sum = () => ENEMY_UPGRADES.reduce((n, e) => n + S.eup[e.key], 0);
        if (sum() !== 0) return false;
        collect({ kind: 'beam', x: 0, y: 0 });
        useHold();
        return sum() === 1;
      })()`));
check('the swarm never takes the same upgrade twice running',
      xrun(`(() => {
        startGame(false); S.mode = MODE.PLAY;
        let prev = null;
        for (let i = 0; i < 6; i++) {
          const before = ENEMY_UPGRADES.map(e => S.eup[e.key]);
          collect({ kind: 'shield', x: 0, y: 0 });
          useHold();
          const got = ENEMY_UPGRADES.find((e, j) => S.eup[e.key] > before[j]);
          if (!got) return false;
          if (prev && got.key === prev) return false;
          prev = got.key;
        }
        return true;
      })()`));
check('and it stops once every upgrade is maxed',
      xrun(`(() => {
        startGame(false); S.mode = MODE.PLAY;
        const cap = ENEMY_UPGRADES.reduce((n, e) => n + e.max, 0);
        for (let i = 0; i < cap + 10; i++) {
          collect({ kind: 'shield', x: 0, y: 0 });
          useHold();
        }
        return ENEMY_UPGRADES.every(e => S.eup[e.key] === e.max);
      })()`));
const escalated = xrun(`(() => {
  startGame(false); S.mode = MODE.PLAY;
  const base = { d: diff(), e: maxEshots() };
  for (const e of ENEMY_UPGRADES) S.eup[e.key] = e.max;
  return { base, hot: { d: diff(), e: maxEshots() } };
})()`);
check('a fully upgraded swarm attacks harder in every dimension',
      escalated.hot.d.maxAttackers > escalated.base.d.maxAttackers
      && escalated.hot.d.delay < escalated.base.d.delay
      && escalated.hot.d.fireMul > escalated.base.d.fireMul
      && escalated.hot.d.bossChance > escalated.base.d.bossChance
      && escalated.hot.e > escalated.base.e,
      JSON.stringify(escalated));
check('ARMOUR makes an alien take more than one shot',
      xrun(`(() => {
        startGame(false); S.mode = MODE.PLAY;
        S.eup.armour = 2;
        startStage(null);
        const a = S.aliens.find(x => x.kind === 'blue');
        const hp = a.hp;
        S.pshots.length = 0;
        let hits = 0;
        while (a.alive && hits < 10) {
          S.pshots.push({ x: a.x, y: a.y, vx: 0, vy: 6 });
          collide();
          hits++;
        }
        return hp === 3 && hits === 3 && !a.alive;
      })()`));
check('plating never applies under the classic versions',
      run(`(() => {
        applySkin('retro');
        startGame(false); S.mode = MODE.PLAY;
        const a = S.aliens.find(x => x.kind === 'blue');
        a.hp = 5;
        S.pshots.push({ x: a.x, y: a.y });
        collide();
        return !a.alive;
      })()`));
check('a new run resets the swarm upgrades and the hold',
      xrun(`(() => {
        startGame(false); S.mode = MODE.PLAY;
        for (let i = 0; i < 3; i++) { collect({ kind: 'beam', x: 0, y: 0 }); useHold(); }
        startGame(false);
        return S.hold.length === 0 && S.holdSel === 0
               && ENEMY_UPGRADES.every(e => S.eup[e.key] === 0)
               && S.aliens.every(a => a.hp === 1);
      })()`));
check('NOVA clears everything in the air but not the formation',
      xrun(`(() => {
        startGame(false); S.mode = MODE.PLAY;
        const flying = S.aliens.slice(0, 4);
        for (const a of flying) launch(a, 0);
        for (let i = 0; i < 90; i++) updateFormation();
        const airborne = S.aliens.filter(a => a.alive && a.state !== 'form').length;
        S.eshots.push({ x: 10, y: 10, vx: 0, vy: 1 });
        nova();
        const after = S.aliens.filter(a => a.alive && a.state !== 'form').length;
        return airborne > 0 && after === 0 && S.eshots.length === 0
               && S.aliens.filter(a => a.alive).length > 30;
      })()`));
check('a pod is collected by flying into it',
      xrun(`(() => {
        startGame(false); S.mode = MODE.PLAY; S.weapon = 0;
        S.drops.length = 0; S.hold.length = 0;
        S.drops.push({ kind: 'beam', x: S.px, y: PLAYER_Y - 4, vy: 0, t: 0 });
        updateDrops();
        return S.drops.length === 0 && S.hold.join(',') === 'beam';
      })()`));
check('pods fall past the ship and expire',
      xrun(`(() => {
        startGame(false); S.mode = MODE.PLAY;
        S.drops.length = 0;
        S.drops.push({ kind: 'beam', x: 5, y: 40, vy: DROP_SPEED, t: 0 });
        for (let i = 0; i < 600; i++) updateDrops();
        return S.drops.length === 0;
      })()`));

check('the combo multiplies the score and lapses on its own',
      xrun(`(() => {
        startGame(false); S.mode = MODE.PLAY;
        S.skill = 1; S.combo = 0; S.dbl = 0;
        const p = P();
        p.score = 0;
        const a = S.aliens.find(x => x.kind === 'blue');
        a.state = 'form';
        killAlien(a);
        const first = p.score;                 // 30 * x1 * skill 2 = 60
        for (let i = 0; i < 24; i++) {
          const b = S.aliens.find(x => x.alive && x.kind === 'blue');
          if (b) { b.state = 'form'; killAlien(b); }
        }
        const mul = comboMul();
        S.comboT = 1;
        updateX();
        return first === 60 && mul > 1 && S.combo === 0;
      })()`));

console.log('\nx rules are absent from the classic versions');
check('no pods ever drop under retro, neo or vector',
      run(`(() => {
        for (const skin of ['retro', 'neo', 'vector']) {
          applySkin(skin);
          startGame(false); S.mode = MODE.PLAY;
          S.drops.length = 0;
          for (let i = 0; i < 3000; i++) update();
          if (S.drops.length) return false;
        }
        applySkin('retro');
        return true;
      })()`));
check('the one-shot rule still holds under the classic versions',
      run(`(() => {
        for (const skin of ['retro', 'neo', 'vector']) {
          applySkin(skin);
          startGame(false); S.mode = MODE.PLAY;
          for (let i = 0; i < 40; i++) firePlayer();
          if (S.pshots.length > 1) return false;
        }
        applySkin('retro');
        return true;
      })()`));
check('a shield charge is ignored under the classic versions',
      run(`(() => {
        applySkin('retro');
        startGame(false); S.mode = MODE.PLAY;
        S.shield = 2;
        killPlayer();
        return S.mode === MODE.DYING && S.shield === 2;
      })()`));
check('the classic difficulty curve is untouched by the skill tier',
      run(`(() => {
        applySkin('retro');
        const seen = [];
        for (let i = 0; i < SKILLS.length; i++) {
          S.skill = i; startGame(false);
          seen.push(JSON.stringify(diff()) + '|' + maxEshots() + '|' + P().lives);
        }
        S.skill = 1;
        return new Set(seen).size === 1;
      })()`));
check('X keeps its high score in a separate slot',
      run(`(() => {
        applySkin('retro'); const a = hiKey();
        applySkin('x'); const b = hiKey();
        applySkin('retro');
        return a !== b && b.indexOf('x') >= 0;
      })()`));

console.log('\nx soundtrack');
const xmusic = run(`(() => {
  NeoAudio.setComplex(true);
  const names = NeoAudio.trackList();
  const count = NeoAudio.trackCount();
  const perStage = [];
  for (let s = 1; s <= names.length + 2; s++) {
    NeoAudio.setTrack(s);
    perStage.push(NeoAudio.trackName());
  }
  NeoAudio.setComplex(false);
  return { names, perStage, count, classic: NeoAudio.trackList() };
})()`);
check('X has its own, longer set of tracks',
      xmusic.count > xmusic.classic.length, `${xmusic.count} vs ${xmusic.classic.length}`);
check('none of them are recycled from the 2026 set',
      xmusic.names.every(n => xmusic.classic.indexOf(n) < 0),
      JSON.stringify(xmusic.names));
check('each X level gets its own track, cycling after the last',
      xmusic.perStage.slice(0, xmusic.count).join('|') === xmusic.names.join('|')
      && xmusic.perStage[xmusic.count] === xmusic.names[0],
      JSON.stringify(xmusic.perStage));
check('selecting X switches the arrangement, and leaving it switches back',
      run(`(() => {
        applySkin('neo'); const a = NeoAudio.isComplex();
        applySkin('x');   const b = NeoAudio.isComplex();
        applySkin('retro');
        return a === false && b === true;
      })()`));
check('every X track carries a full arrangement',
      run(`(() => {
        NeoAudio.setComplex(true);
        const ok = NeoAudio.trackList().length > 0;
        NeoAudio.setComplex(false);
        return ok;
      })()`)
      && require('fs').readFileSync(path.join(ROOT, 'src/neoaudio.js'), 'utf8')
           .split('XTRACKS = [')[1].split('\n  ];')[0]
           .split('name:').length - 1 >= 8);

// -------------------------------------------------------------------------
//  Key bindings.  Every input in the game goes through an action, so the
//  things to prove are that rebinding an action really moves the input, that
//  a code can only drive one action at a time, that it survives a reload, and
//  that the editor itself can never be locked out.
// -------------------------------------------------------------------------
console.log('\nkey bindings');
const kb = makeSandbox();
const krun = src => vm.runInContext(src, kb);
const kpress = (box, code) => vm.runInContext(
  `onKey({ code: '${code}', preventDefault() {} }, true);
   onKey({ code: '${code}', preventDefault() {} }, false);`, box);

check('every action has a default binding',
      krun(`ACTIONS.every(a => S.binds[a.key] && S.binds[a.key][0])`),
      JSON.stringify(krun('S.binds')));
eq('two slots per action', krun('BIND_SLOTS'), 2);
check('key codes are shown under names a person would use',
      krun(`[keyName('KeyA'), keyName('Digit1'), keyName('ArrowLeft'),
             keyName('Space'), keyName('ShiftLeft'), keyName('')].join('|')`)
      === 'A|1|LEFT|SPACE|LSHIFT|-',
      krun(`[keyName('KeyA'), keyName('Digit1'), keyName('ArrowLeft'),
             keyName('Space'), keyName('ShiftLeft'), keyName('')].join('|')`));

check('rebinding FIRE really moves the trigger',
      krun(`(() => {
        applySkin('retro');
        setBind('fire', 0, 'KeyF');
        setBind('fire', 1, '');
        startGame(false); S.mode = MODE.PLAY;
        onKey({ code: 'Space', preventDefault() {} }, true);
        const spaceDead = S.pshots.length === 0;
        onKey({ code: 'KeyF', preventDefault() {} }, true);
        const fWorks = S.pshots.length === 1;
        onKey({ code: 'KeyF', preventDefault() {} }, false);
        onKey({ code: 'Space', preventDefault() {} }, false);
        S.binds = defaultBinds();
        return spaceDead && fWorks;
      })()`));
check('rebinding MOVE LEFT moves the held-key check too',
      krun(`(() => {
        startGame(false); S.mode = MODE.PLAY;
        setBind('left', 0, 'KeyJ'); setBind('left', 1, '');
        onKey({ code: 'KeyJ', preventDefault() {} }, true);
        const moves = LEFT() === true;
        onKey({ code: 'ArrowLeft', preventDefault() {} }, true);
        onKey({ code: 'KeyJ', preventDefault() {} }, false);
        const oldDead = LEFT() === false;
        onKey({ code: 'ArrowLeft', preventDefault() {} }, false);
        S.binds = defaultBinds();
        return moves && oldDead;
      })()`));
check('a code can only drive one action, so binding it steals it',
      krun(`(() => {
        S.binds = defaultBinds();
        setBind('pause', 0, 'KeyM');        // M was SOUND
        const stolen = S.binds.mute[0] !== 'KeyM' && S.binds.pause[0] === 'KeyM';
        S.binds = defaultBinds();
        return stolen;
      })()`));
check('clearing a slot leaves it empty',
      krun(`(() => {
        S.binds = defaultBinds();
        clearBind('left', 1);
        const gone = S.binds.left[1] === '';
        S.binds = defaultBinds();
        return gone;
      })()`));
check('bindings survive a reload',
      krun(`(() => {
        S.binds = defaultBinds();
        setBind('fire', 0, 'KeyQ');
        const back = loadBinds();
        S.binds = defaultBinds(); saveBinds();
        return back.fire[0] === 'KeyQ';
      })()`));
check('a corrupt saved file falls back to the defaults',
      krun(`(() => {
        localStorage.setItem('galaxian.keys', '{ not json');
        const a = loadBinds();
        localStorage.setItem('galaxian.keys', '{"fire":"nonsense"}');
        const b = loadBinds();
        S.binds = defaultBinds(); saveBinds();
        return a.fire[0] === DEFAULT_BINDS.fire[0]
            && b.fire[0] === DEFAULT_BINDS.fire[0];
      })()`));

check('K opens the editor from the boot screen and ESC returns to it',
      krun(`(() => {
        S.mode = MODE.SELECT;
        onKey({ code: 'KeyK', preventDefault() {} }, true);
        onKey({ code: 'KeyK', preventDefault() {} }, false);
        const opened = S.mode === MODE.KEYS;
        onKey({ code: 'Escape', preventDefault() {} }, true);
        onKey({ code: 'Escape', preventDefault() {} }, false);
        return opened && S.mode === MODE.SELECT;
      })()`));
check('and from the attract screen, returning there',
      krun(`(() => {
        startAttract();
        onKey({ code: 'KeyK', preventDefault() {} }, true);
        onKey({ code: 'KeyK', preventDefault() {} }, false);
        const opened = S.mode === MODE.KEYS;
        onKey({ code: 'Escape', preventDefault() {} }, true);
        onKey({ code: 'Escape', preventDefault() {} }, false);
        return opened && S.mode === MODE.ATTRACT;
      })()`));
check('ENTER listens, and the next key pressed takes the slot',
      krun(`(() => {
        S.binds = defaultBinds();
        S.mode = MODE.KEYS; S.keyIdx = 2; S.keySlot = 0; S.keyWait = false;
        onKey({ code: 'Enter', preventDefault() {} }, true);
        onKey({ code: 'Enter', preventDefault() {} }, false);
        const listening = S.keyWait === true;
        onKey({ code: 'KeyG', preventDefault() {} }, true);
        onKey({ code: 'KeyG', preventDefault() {} }, false);
        const took = S.binds.fire[0] === 'KeyG' && S.keyWait === false;
        S.binds = defaultBinds(); saveBinds();
        return listening && took;
      })()`));
check('ESC cancels a capture rather than binding ESC',
      krun(`(() => {
        S.binds = defaultBinds();
        S.mode = MODE.KEYS; S.keyIdx = 2; S.keySlot = 0;
        S.keyWait = true;
        onKey({ code: 'Escape', preventDefault() {} }, true);
        onKey({ code: 'Escape', preventDefault() {} }, false);
        return S.keyWait === false && S.binds.fire[0] === DEFAULT_BINDS.fire[0];
      })()`));
check('R restores every default from inside the editor',
      krun(`(() => {
        S.mode = MODE.KEYS; S.keyWait = false;
        setBind('fire', 0, 'KeyQ'); setBind('left', 0, 'KeyW');
        onKey({ code: 'KeyR', preventDefault() {} }, true);
        onKey({ code: 'KeyR', preventDefault() {} }, false);
        return JSON.stringify(S.binds) === JSON.stringify(defaultBinds());
      })()`));
// The one failure mode that would be unrecoverable: rebinding the keys the
// editor itself needs.  It answers to raw arrows and Enter, never to bindings.
check('the editor cannot be locked out by rebinding its own keys',
      krun(`(() => {
        S.binds = defaultBinds();
        // hand every navigation key to a game action
        setBind('fire', 0, 'Enter');
        setBind('left', 0, 'ArrowUp');
        setBind('right', 0, 'ArrowDown');
        setBind('use', 0, 'Escape');
        S.mode = MODE.KEYS; S.keyIdx = 0; S.keySlot = 0; S.keyWait = false;
        onKey({ code: 'ArrowDown', preventDefault() {} }, true);
        onKey({ code: 'ArrowDown', preventDefault() {} }, false);
        const moved = S.keyIdx === 1;
        onKey({ code: 'ArrowRight', preventDefault() {} }, true);
        onKey({ code: 'ArrowRight', preventDefault() {} }, false);
        const slotMoved = S.keySlot === 1;
        onKey({ code: 'Escape', preventDefault() {} }, true);
        onKey({ code: 'Escape', preventDefault() {} }, false);
        const left = S.mode !== MODE.KEYS;
        S.binds = defaultBinds(); saveBinds();
        return moved && slotMoved && left;
      })()`));
check('the editor swallows every key, so capturing M does not mute',
      krun(`(() => {
        S.binds = defaultBinds();
        S.muted = false;
        S.mode = MODE.KEYS; S.keyIdx = 3; S.keySlot = 0; S.keyWait = true;
        onKey({ code: 'KeyM', preventDefault() {} }, true);
        onKey({ code: 'KeyM', preventDefault() {} }, false);
        const bound = S.binds.cycle[0] === 'KeyM';
        S.binds = defaultBinds(); saveBinds();
        return bound && S.muted === false;
      })()`));
check('X reads the live bindings for its on-screen prompts',
      krun(`(() => {
        applySkin('x');
        setBind('cycle', 0, 'KeyN');
        setBind('use', 0, 'KeyB');
        const v = xView();
        S.binds = defaultBinds(); saveBinds();
        applySkin('retro');
        return v.cycleKey === 'N' && v.useKey === 'B';
      })()`));

console.log('\nrendering');
check('a full frame renders without throwing',
      run('(() => { for (let i=0;i<120;i++){update();render();} return true; })()'));
check('X renders every screen without throwing',
      xrun(`(() => {
        applySkin('x');
        S.mode = MODE.SELECT; render();
        startAttract();
        for (const pg of [0, 1]) { S.attractPage = pg; render(); }
        S.mode = MODE.SKILL; render();
        startGame(false);
        for (let i = 0; i < 400; i++) { update(); render(); }
        S.mode = MODE.CLEAR; render();
        S.mode = MODE.OVER; render();
        S.paused = true; render(); S.paused = false;
        return true;
      })()`));
check('attract, table and demo pages all render',
      run(`(() => {
        startAttract();
        for (const pg of [0, 1]) { S.attractPage = pg; render(); }
        startDemo();
        for (let i=0;i<300;i++){ update(); render(); }
        return true;
      })()`));

// Every renderer, this time with a context that really records the calls, at
// several window shapes -- ultrawide, 16:9, 4:3 and portrait, because X lays
// itself out differently in each and the narrow one folds the HUD away.
console.log('\nrenderers actually drawing');
for (const [w, h, label] of [[2560, 1080, 'ultrawide'], [1600, 900, '16:9'],
                             [1024, 768, '4:3'], [700, 1000, 'portrait']]) {
  const box = makeDrawSandbox(w, h);
  const ok = vm.runInContext(`(() => {
    for (const skin of SKINS) {
      applySkin(skin);
      S.mode = MODE.SELECT; render();
      // the bindings editor, including a row mid-capture
      S.mode = MODE.KEYS; S.keyIdx = 2; S.keySlot = 1; render();
      S.keyWait = true; render(); S.keyWait = false;
      S.binds.fire[0] = ''; render(); S.binds = defaultBinds();
      startAttract();
      for (const pg of [0, 1]) { S.attractPage = pg; render(); }
      if (skin === 'x') { S.mode = MODE.SKILL; render(); }
      startGame(false);
      S.weapon = 2; S.shield = 2; S.rapid = 300; S.dbl = 300;
      S.drops.push({ kind: 'beam', x: 100, y: 60, vy: 0.6, t: 3 });
      S.banner = 'RAPID'; S.bannerT = 40;
      // the X-only widgets: a part-full hold, an escalated swarm, plating
      S.hold = ['beam', 'nova']; S.holdSel = 1;
      S.ebanner = 'BARRAGE'; S.ebannerT = 90;
      for (const e of ENEMY_UPGRADES) S.eup[e.key] = 1;
      for (const a of S.aliens) { a.hp = 2; a.flash = 4; }
      for (let i = 0; i < 300; i++) { update(); render(); }
      for (const m of [MODE.CLEAR, MODE.OVER, MODE.DYING]) { S.mode = m; render(); }
      S.paused = true; render(); S.paused = false;
    }
    applySkin('retro');
    return true;
  })()`, box);
  check(`every version draws a real frame at ${label} ${w}x${h}`, ok === true);
}
check('X lays out cockpit wings on a wide window but folds them on a narrow one',
      (() => {
        const wide = makeDrawSandbox(1920, 1080);
        const tall = makeDrawSandbox(600, 900);
        const q = box => vm.runInContext(
          `(() => { applySkin('x'); startGame(false); render();
                    return Xr.layoutInfo(); })()`, box);
        const a = q(wide), b = q(tall);
        return a.wide === true && b.wide === false
            && a.playW > 0 && b.playW > 0
            && a.panel > b.panel;
      })());

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
