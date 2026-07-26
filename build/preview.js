// Headless render harness: runs the real engine against a stub canvas and
// writes a binary PPM, so frames can be inspected or diffed without a browser.
//
//   node build/preview.js <frames> <out.ppm> [script...]
//
// Script arguments are evaluated in the sandbox after load, e.g.
//   node build/preview.js 200 /tmp/a.ppm "startGame(false)"
//   node build/preview.js 60  /tmp/b.ppm "S.attractPage=1"
const fs = require('fs'), vm = require('vm'), path = require('path');

const ROOT = path.join(__dirname, '..');
const W = 224, H = 256;
const captured = { data: null };

const fakeCanvas = {
  width: W, height: H, style: {},
  getContext: () => ({
    createImageData: (w, h) => ({ width: w, height: h,
                                  data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: im => { captured.data = im.data; },
  }),
};

const sandbox = {
  document: { getElementById: () => fakeCanvas },
  addEventListener: () => {},
  removeEventListener: () => {},
  requestAnimationFrame: () => {},
  setInterval: () => 0,
  clearInterval: () => {},
  setTimeout: () => 0,
  performance: { now: () => 0 },
  localStorage: { getItem: () => null, setItem: () => {} },
  innerWidth: 700, innerHeight: 800,
  Math, Date, console, JSON, isNaN, parseInt, parseFloat, String, Number,
  Object, Array, Uint32Array, Uint8ClampedArray, Float64Array,
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

// deterministic "random" so runs reproduce exactly
let seed = 20250725;
const rnd = Object.create(Math);
rnd.random = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff;
                     return seed / 0x7fffffff; };
sandbox.Math = rnd;

for (const f of ['src/art.js', 'src/audio.js', 'src/engine.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox,
                  { filename: f });
}

const frames = parseInt(process.argv[2] || '1', 10);
const out = process.argv[3] || '/tmp/frame.ppm';
for (const cmd of process.argv.slice(4)) vm.runInContext(cmd, sandbox);

for (let i = 0; i < frames; i++) {
  vm.runInContext('update()', sandbox);
  vm.runInContext('render()', sandbox);
}

const d = captured.data;
if (!d) { console.error('nothing rendered'); process.exit(1); }
const head = Buffer.from(`P6\n${W} ${H}\n255\n`, 'ascii');
const rgb = Buffer.alloc(W * H * 3);
for (let i = 0; i < W * H; i++) {
  rgb[i * 3] = d[i * 4];
  rgb[i * 3 + 1] = d[i * 4 + 1];
  rgb[i * 3 + 2] = d[i * 4 + 2];
}
fs.writeFileSync(out, Buffer.concat([head, rgb]));
console.log('wrote', out, `(${frames} frames)`);
