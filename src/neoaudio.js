// -------------------------------------------------------------------------
//  GALAXIANS 2026 -- sound.
//
//  Exposes exactly the same interface as Sfx in audio.js, so the engine can
//  swap between the two without knowing which is playing.  Everything is
//  synthesised live: a proper bus with convolution reverb and a tempo-synced
//  delay, layered effects, and a synthwave soundtrack whose intensity rises as
//  the wave is cleared.
//
//  `thrumOn` / `setThrum` / `thrumOff` map onto the soundtrack, which is what
//  the retro build uses them for too.
// -------------------------------------------------------------------------
const NeoAudio = (() => {
  const AC = typeof AudioContext !== 'undefined' ? AudioContext
           : (typeof webkitAudioContext !== 'undefined' ? webkitAudioContext : null);

  let ctx = null, muted = false;
  let master, comp, dry, revIn, delIn, noiseBuf, duck;

  // --- music state --------------------------------------------------------
  let timer = null, step = 0, nextTime = 0, intensity = 0, musicOn = false;
  let track = null, SPB = 60 / 132 / 4, delayNode = null;
  // X runs the deeper arrangement: eight-bar forms with sections, a sidechain
  // duck under the kick, sixteenth bass patterns and a counter-melody.
  let complex = false;
  const LOOKAHEAD = 0.12;

  function init() {
    if (ctx || !AC) return;
    try {
      ctx = new AC();

      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.9;

      comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 22;
      comp.ratio.value = 5;
      comp.attack.value = 0.004;
      comp.release.value = 0.22;
      comp.connect(master);
      master.connect(ctx.destination);

      dry = ctx.createGain();
      dry.gain.value = 1;
      dry.connect(comp);

      // A second dry path for the sequencer only.  The X arrangement pulls it
      // down on every kick, so the bass and pads breathe around the beat
      // without the game's own effects being ducked with them.
      duck = ctx.createGain();
      duck.gain.value = 1;
      duck.connect(comp);

      // convolution reverb from a procedurally decayed noise burst
      const rev = ctx.createConvolver();
      rev.buffer = makeIR(2.6, 3.1);
      const revGain = ctx.createGain();
      revGain.gain.value = 0.5;
      revIn = ctx.createGain();
      revIn.gain.value = 1;
      revIn.connect(rev); rev.connect(revGain); revGain.connect(comp);

      // tempo-synced feedback delay, rolled off so it sits behind everything
      const del = ctx.createDelay(1.5);
      delayNode = del;
      del.delayTime.value = SPB * 3;
      const fb = ctx.createGain();
      fb.gain.value = 0.38;
      const damp = ctx.createBiquadFilter();
      damp.type = 'lowpass';
      damp.frequency.value = 2000;
      const delOut = ctx.createGain();
      delOut.gain.value = 0.42;
      delIn = ctx.createGain();
      delIn.gain.value = 1;
      delIn.connect(del);
      del.connect(damp); damp.connect(fb); fb.connect(del);
      del.connect(delOut); delOut.connect(comp);

      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) { ctx = null; }
  }

  function makeIR(sec, decay) {
    const n = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < n; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
      }
    }
    return buf;
  }

  const ready = () => {
    if (!ctx) return false;
    if (ctx.state === 'suspended') ctx.resume();
    return true;
  };
  const now = () => ctx.currentTime;

  // --- voice helpers ------------------------------------------------------
  function env(g, t, a, d, peak, sus, rel) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, sus), t + a + d);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d + rel);
  }

  // A detuned pair of oscillators through a filter -- the workhorse voice.
  function voice(o) {
    if (!ready()) return;
    const t = (o.at !== undefined ? o.at : now()) + (o.delay || 0);
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    f.type = o.filter || 'lowpass';
    f.frequency.setValueAtTime(o.cut || 3000, t);
    if (o.cutEnd !== undefined) {
      f.frequency.exponentialRampToValueAtTime(Math.max(60, o.cutEnd),
                                               t + (o.cutTime || o.dur));
    }
    f.Q.value = o.q || 1;

    const n = o.voices || 2;
    for (let i = 0; i < n; i++) {
      const osc = ctx.createOscillator();
      osc.type = o.type || 'sawtooth';
      osc.frequency.setValueAtTime(o.f0, t);
      if (o.f1 !== undefined) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t + o.dur);
      }
      osc.detune.value = (i - (n - 1) / 2) * (o.spread === undefined ? 12 : o.spread);
      osc.connect(f);
      osc.start(t);
      osc.stop(t + o.dur + (o.rel || 0.05) + 0.05);
    }
    env(g, t, o.a || 0.005, o.d || o.dur * 0.6, (o.gain || 0.2) / Math.sqrt(n),
        (o.sus !== undefined ? o.sus : (o.gain || 0.2) * 0.3) / Math.sqrt(n),
        o.rel || 0.08);
    f.connect(g);
    g.connect(o.duck ? duck : dry);
    if (o.rev) { const s = ctx.createGain(); s.gain.value = o.rev; g.connect(s); s.connect(revIn); }
    if (o.del) { const s = ctx.createGain(); s.gain.value = o.del; g.connect(s); s.connect(delIn); }
  }

  // FM bell -- a carrier whose frequency is pushed by a modulator, used for
  // the X arrangement's counter-melody so it does not sound like another saw.
  function bell(o) {
    if (!ready()) return;
    const t = (o.at !== undefined ? o.at : now()) + (o.delay || 0);
    const car = ctx.createOscillator();
    const mod = ctx.createOscillator();
    const mg = ctx.createGain();
    const g = ctx.createGain();
    car.type = 'sine'; mod.type = 'sine';
    car.frequency.setValueAtTime(o.f0, t);
    mod.frequency.setValueAtTime(o.f0 * (o.ratio || 2.01), t);
    mg.gain.setValueAtTime(o.f0 * (o.index || 3), t);
    mg.gain.exponentialRampToValueAtTime(o.f0 * 0.05, t + o.dur);
    mod.connect(mg); mg.connect(car.frequency);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.gain || 0.1, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    car.connect(g); g.connect(o.duck ? duck : dry);
    if (o.rev) { const s = ctx.createGain(); s.gain.value = o.rev; g.connect(s); s.connect(revIn); }
    if (o.del) { const s = ctx.createGain(); s.gain.value = o.del; g.connect(s); s.connect(delIn); }
    car.start(t); mod.start(t);
    car.stop(t + o.dur + 0.05); mod.stop(t + o.dur + 0.05);
  }

  function noise(o) {
    if (!ready()) return;
    const t = (o.at !== undefined ? o.at : now()) + (o.delay || 0);
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    src.playbackRate.value = o.rate || 1;
    const f = ctx.createBiquadFilter();
    f.type = o.filter || 'bandpass';
    f.Q.value = o.q || 1;
    f.frequency.setValueAtTime(o.f0, t);
    if (o.f1 !== undefined) {
      f.frequency.exponentialRampToValueAtTime(Math.max(30, o.f1), t + o.dur);
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(o.gain || 0.3, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    src.connect(f); f.connect(g); g.connect(o.duck ? duck : dry);
    if (o.rev) { const s = ctx.createGain(); s.gain.value = o.rev; g.connect(s); s.connect(revIn); }
    if (o.del) { const s = ctx.createGain(); s.gain.value = o.del; g.connect(s); s.connect(delIn); }
    src.start(t); src.stop(t + o.dur + 0.05);
  }

  // sub-bass thump: a sine dropping fast, the body of every impact
  function thump(o) {
    if (!ready()) return;
    const t = (o.at !== undefined ? o.at : now()) + (o.delay || 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(o.f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(12, o.f1), t + o.dur);
    g.gain.setValueAtTime(o.gain || 0.6, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    osc.connect(g); g.connect(dry);
    osc.start(t); osc.stop(t + o.dur + 0.05);
  }

  // -----------------------------------------------------------------------
  //  soundtrack
  //
  //  One track per level, cycling.  Each is a key, a tempo, a four-bar
  //  progression, a lead motif and a rhythmic feel, so the levels sound
  //  genuinely different rather than just faster.
  // -----------------------------------------------------------------------
  const SEMI = { C: -9, 'C#': -8, D: -7, 'D#': -6, E: -5, F: -4, 'F#': -3,
                 G: -2, 'G#': -1, A: 0, 'A#': 1, B: 2 };
  // note name + octave -> Hz, A4 = 440
  function nf(name, oct) {
    return 440 * Math.pow(2, (SEMI[name] + (oct - 4) * 12) / 12);
  }
  // a bar: bass an octave below the chord root, plus the triad above it
  function bar(name, oct, minor) {
    const r = nf(name, oct);
    return {
      root: r / 2,
      chord: [r, r * Math.pow(2, (minor ? 3 : 4) / 12), r * Math.pow(2, 7 / 12)],
    };
  }
  const m = (n, o) => bar(n, o, true);      // minor triad
  const M = (n, o) => bar(n, o, false);     // major triad

  const A4 = 440, A3 = 220;          // reference pitches for the jingles
  const MINOR = [0, 2, 3, 5, 7, 8, 10, 12];
  const DORIAN = [0, 2, 3, 5, 7, 9, 10, 12];
  const PHRYG = [0, 1, 3, 5, 7, 8, 10, 12];

  const TRACKS = [
    {
      name: 'NEON DAWN', bpm: 132, key: 'A', scale: MINOR, leadRoot: nf('A', 4),
      prog: [m('A', 3), M('F', 3), M('C', 4), M('G', 3)],
      lead: [0, -1, 4, -1, 7, -1, 4, -1, 5, -1, -1, 4, 2, -1, 0, -1],
      hat: 2, bassLift: [10, 14], wave: 'sawtooth',
    },
    {
      name: 'HYPERDRIVE', bpm: 144, key: 'D', scale: DORIAN, leadRoot: nf('D', 5),
      prog: [m('D', 3), M('C', 4), M('A#', 3), M('C', 4)],
      lead: [7, -1, 7, 5, -1, 4, -1, 2, 4, -1, 5, -1, 7, -1, -1, -1],
      hat: 1, bassLift: [6, 10, 14], wave: 'sawtooth',
    },
    {
      name: 'ION STORM', bpm: 124, key: 'C', scale: PHRYG, leadRoot: nf('C', 5),
      prog: [m('C', 3), M('G#', 3), M('D#', 4), M('A#', 3)],
      lead: [0, -1, -1, 1, -1, 3, -1, -1, 5, -1, 3, -1, 1, -1, 0, -1],
      hat: 2, bassLift: [12], wave: 'square',
    },
    {
      name: 'STARFALL', bpm: 152, key: 'E', scale: MINOR, leadRoot: nf('E', 5),
      prog: [m('E', 3), M('G', 3), M('D', 4), m('A', 3)],
      lead: [12, -1, 10, -1, 7, -1, 10, -1, 12, -1, 14, -1, 12, -1, 10, -1],
      hat: 1, bassLift: [4, 12], wave: 'sawtooth',
    },
    {
      name: 'EVENT HORIZON', bpm: 116, key: 'F#', scale: MINOR, leadRoot: nf('F#', 4),
      prog: [m('F#', 3), M('D', 4), M('A', 3), M('E', 4)],
      lead: [0, -1, -1, -1, 3, -1, -1, -1, 7, -1, -1, 5, -1, -1, 3, -1],
      hat: 4, bassLift: [14], wave: 'sawtooth',
    },
    {
      name: 'OVERDRIVE', bpm: 160, key: 'G', scale: PHRYG, leadRoot: nf('G', 5),
      prog: [m('G', 3), M('D#', 4), M('F', 4), m('G', 3)],
      lead: [0, 0, -1, 3, 3, -1, 5, -1, 7, 7, -1, 5, 3, -1, 0, -1],
      hat: 1, bassLift: [2, 6, 10, 14], wave: 'square',
    },
  ];

  // -----------------------------------------------------------------------
  //  GALAXIAN X soundtrack
  //
  //  The 2026 tracks are one four-bar loop that gets busier.  These are
  //  eight-bar forms that actually go somewhere: a section wheel (intro,
  //  groove, lift, break) turns every two bars, the bass runs a sixteenth
  //  pattern rather than plain eighths, an FM counter-melody answers the lead,
  //  the drums fill at the end of each phrase, and the whole melodic bus is
  //  ducked under the kick.
  //
  //  `pat` strings are one character per sixteenth:  x = hit, o = accent,
  //  . = rest.  `bass` is scale degrees, -1 for a rest.
  // -----------------------------------------------------------------------
  const XTRACKS = [
    {
      name: 'EVENT ZERO', bpm: 128, key: 'A', scale: MINOR, leadRoot: nf('A', 4),
      prog: [m('A', 3), m('A', 3), M('F', 3), M('F', 3),
             M('C', 4), M('C', 4), M('G', 3), M('G', 3)],
      kick: 'o..x..o...x.o...', snare: '....o.......o...',
      hat:  'x.x.xoxxx.x.xox.', ride: '..x...x...x...x.',
      bass: [0, -1, 0, 7, -1, 0, 12, -1, 0, -1, 10, -1, 7, -1, 5, -1],
      lead: [0, -1, 4, -1, 7, -1, 4, -1, 5, -1, -1, 4, 2, -1, 0, -1],
      counter: [-1, -1, 12, -1, -1, 10, -1, -1, 7, -1, -1, -1, 9, -1, -1, -1],
      wave: 'sawtooth', sub: true,
    },
    {
      name: 'MACH SEVEN', bpm: 150, key: 'D', scale: DORIAN, leadRoot: nf('D', 5),
      prog: [m('D', 3), M('C', 4), m('D', 3), M('A#', 3),
             M('F', 3), M('C', 4), m('D', 3), M('A#', 3)],
      kick: 'o..x..o.o...x..x', snare: '....o.......o..o',
      hat:  'xxxxxxxxxxxxxxxx', ride: 'x...x...x...x...',
      bass: [0, 0, -1, 0, 7, -1, 0, 0, -1, 5, -1, 7, 0, -1, 3, -1],
      lead: [7, -1, 7, 5, -1, 4, -1, 2, 4, -1, 5, -1, 7, -1, -1, -1],
      counter: [-1, 14, -1, -1, 12, -1, -1, -1, 11, -1, -1, 9, -1, -1, 7, -1],
      wave: 'sawtooth', sub: true,
    },
    {
      name: 'BLACK SIGNAL', bpm: 118, key: 'C', scale: PHRYG, leadRoot: nf('C', 5),
      prog: [m('C', 3), M('G#', 3), M('D#', 4), M('A#', 3),
             m('C', 3), M('A#', 3), M('G#', 3), M('G', 3)],
      kick: 'o.....o...o.....', snare: '....o.......o...',
      hat:  '..x...x...x...x.', ride: 'x.x.x.x.x.x.x.x.',
      bass: [0, -1, -1, 0, -1, 3, -1, -1, 0, -1, -1, 1, -1, 0, -1, -1],
      lead: [0, -1, -1, 1, -1, 3, -1, -1, 5, -1, 3, -1, 1, -1, 0, -1],
      counter: [-1, -1, -1, 8, -1, -1, 7, -1, -1, -1, 5, -1, -1, 3, -1, -1],
      wave: 'sawtooth', sub: false,
    },
    {
      name: 'AFTERBURN', bpm: 158, key: 'E', scale: MINOR, leadRoot: nf('E', 5),
      prog: [m('E', 3), M('G', 3), M('D', 4), m('A', 3),
             m('E', 3), M('C', 4), M('D', 4), M('G', 3)],
      kick: 'o..o..x.o..x..o.', snare: '....o.......o.o.',
      hat:  'x.xxx.xxx.xxx.xx', ride: '..x...x...x...x.',
      bass: [0, 7, -1, 0, 12, -1, 7, 0, -1, 10, 7, -1, 5, -1, 3, -1],
      lead: [12, -1, 10, -1, 7, -1, 10, -1, 12, -1, 14, -1, 12, -1, 10, -1],
      counter: [-1, -1, 19, -1, -1, 17, -1, -1, 16, -1, -1, 14, -1, -1, 12, -1],
      wave: 'sawtooth', sub: true,
    },
    {
      name: 'SINGULARITY', bpm: 112, key: 'F#', scale: MINOR, leadRoot: nf('F#', 4),
      prog: [m('F#', 3), M('D', 4), M('A', 3), M('E', 4),
             m('F#', 3), m('C#', 4), M('D', 4), M('E', 4)],
      kick: 'o.......o.......', snare: '....o.......o...',
      hat:  '....x.......x...', ride: 'x...x...x...x...',
      bass: [0, -1, -1, -1, 7, -1, -1, -1, 0, -1, -1, 5, -1, -1, 3, -1],
      lead: [0, -1, -1, -1, 3, -1, -1, -1, 7, -1, -1, 5, -1, -1, 3, -1],
      counter: [12, -1, -1, -1, -1, -1, 10, -1, -1, -1, -1, -1, 9, -1, -1, -1],
      wave: 'sawtooth', sub: true,
    },
    {
      name: 'TERMINAL VELOCITY', bpm: 168, key: 'G', scale: PHRYG,
      leadRoot: nf('G', 5),
      prog: [m('G', 3), M('D#', 4), M('F', 4), m('G', 3),
             m('G', 3), M('C#', 4), M('D#', 4), M('F', 4)],
      kick: 'o.o.x.o.o.o.x.o.', snare: '....o..o....o.oo',
      hat:  'xxxxxxxxxxxxxxxx', ride: 'x.x.x.x.x.x.x.x.',
      bass: [0, 0, 3, 0, -1, 0, 5, 0, -1, 0, 3, -1, 7, -1, 5, 3],
      lead: [0, 0, -1, 3, 3, -1, 5, -1, 7, 7, -1, 5, 3, -1, 0, -1],
      counter: [-1, 12, -1, 15, -1, -1, 17, -1, -1, 15, -1, -1, 12, -1, -1, -1],
      wave: 'square', sub: true,
    },
    {
      name: 'LAST LIGHT', bpm: 138, key: 'D', scale: MINOR, leadRoot: nf('D', 5),
      prog: [m('D', 3), M('A#', 3), M('F', 3), M('C', 4),
             m('D', 3), m('G', 3), M('A#', 3), M('C', 4)],
      kick: 'o..x..o...x.o..o', snare: '....o.......o...',
      hat:  'x.x.x.xxx.x.x.xx', ride: '..x...x...x...x.',
      bass: [0, -1, 7, -1, 0, 12, -1, 7, -1, 0, -1, 10, 7, -1, 5, -1],
      lead: [7, -1, 5, -1, 3, -1, 5, 7, -1, 10, -1, 7, 5, -1, 3, -1],
      counter: [-1, -1, 14, -1, -1, 12, -1, -1, 10, -1, -1, 12, -1, -1, -1, -1],
      wave: 'sawtooth', sub: true,
    },
    {
      name: 'GALAXIAN X', bpm: 146, key: 'A', scale: PHRYG, leadRoot: nf('A', 5),
      prog: [m('A', 3), M('F', 3), M('A#', 3), M('E', 3),
             m('A', 3), M('F', 3), M('G', 3), M('E', 3)],
      kick: 'o..x..o.o..x..x.', snare: '....o..x....o.oo',
      hat:  'xxx.xxx.xxx.xxxx', ride: 'x...x...x...x...',
      bass: [0, 0, -1, 1, -1, 0, 7, -1, 0, -1, 5, -1, 3, 1, 0, -1],
      lead: [0, -1, 1, -1, 3, -1, 1, 0, -1, 5, -1, 3, 1, -1, 0, -1],
      counter: [12, -1, -1, 13, -1, -1, 15, -1, -1, -1, 13, -1, -1, 12, -1, -1],
      wave: 'square', sub: true,
    },
  ];

  // Section wheel, one entry per two bars of the eight-bar form: how much of
  // the arrangement is switched on regardless of how the wave is going.
  //   [drums, bass, arp, lead, counter, pad]
  const SECTIONS = [
    [0.55, 1, 0.35, 0, 0.4, 1],     // intro
    [1.00, 1, 1.00, 1, 0.6, 1],     // groove
    [1.00, 1, 1.00, 1, 1.0, 1],     // lift
    [0.35, 0, 0.60, 0, 1.0, 1],     // break
  ];

  function useTrack(t) {
    track = t;
    SPB = 60 / t.bpm / 4;
    if (delayNode) delayNode.delayTime.value = SPB * 3;
  }
  useTrack(TRACKS[0]);

  const activeList = () => (complex ? XTRACKS : TRACKS);

  // scale degree -> Hz above a root
  function deg(rootHz, sc, d) {
    const semi = sc[((d % sc.length) + sc.length) % sc.length]
               + 12 * Math.floor(d / sc.length);
    return rootHz * Math.pow(2, semi / 12);
  }

  // The kick pushes the melodic bus down and lets it back up over an eighth,
  // which is the single biggest thing that makes a synth mix feel produced.
  function sidechain(t, depth) {
    if (!duck) return;
    duck.gain.cancelScheduledValues(t);
    duck.gain.setValueAtTime(1, t);
    duck.gain.linearRampToValueAtTime(1 - depth, t + 0.012);
    duck.gain.linearRampToValueAtTime(1, t + SPB * 2.0);
  }

  function scheduleX(i, t) {
    const T = track;
    const bar = (i >> 4) % T.prog.length;
    const s = i & 15;
    const p = T.prog[bar];
    const I = intensity;
    const sec = SECTIONS[(bar >> 1) % SECTIONS.length];
    const [dLvl, bLvl, aLvl, lLvl, cLvl] = sec;
    const last = bar === T.prog.length - 1;      // the phrase-ending bar
    const D = { duck: true };

    // --- drums ---
    const kickHit = T.kick[s];
    if (kickHit !== '.' && (dLvl > 0.5 || kickHit === 'o')) {
      const hard = kickHit === 'o';
      thump({ at: t, f0: hard ? 165 : 140, f1: 40,
              dur: hard ? 0.30 : 0.22, gain: hard ? 0.95 : 0.6 });
      noise({ at: t, f0: 2200, f1: 380, dur: 0.026, gain: 0.16, q: 0.7 });
      sidechain(t, (hard ? 0.42 : 0.26) * (0.6 + 0.4 * I));
    }
    if (T.snare[s] !== '.') {
      noise({ at: t, f0: 2600, f1: 950, dur: 0.17, gain: 0.34 * (0.6 + 0.4 * dLvl),
              q: 0.6, rev: 0.30 });
      noise({ at: t, f0: 380, f1: 200, dur: 0.09, gain: 0.16, q: 1.2,
              filter: 'lowpass' });
      voice({ at: t, type: 'triangle', f0: 230, f1: 150, dur: 0.09, gain: 0.12,
              voices: 1, cut: 3000, ...D });
    }
    const hatOn = I > 0.55 || dLvl > 0.9;
    if (T.hat[s] !== '.' && (hatOn || s % 4 === 0)) {
      const open = s % 8 === 6;
      noise({ at: t, f0: 9500, f1: 6800, dur: open ? 0.11 : 0.03,
              gain: (open ? 0.10 : 0.07) * dLvl, q: 1.4, filter: 'highpass' });
    }
    if (T.ride[s] !== '.' && I > 0.35 && dLvl > 0.9) {
      noise({ at: t, f0: 7200, f1: 5400, dur: 0.24, gain: 0.045, q: 2.2,
              filter: 'highpass', rev: 0.3 });
    }
    // tom fill across the last half-bar of a phrase
    if (last && s >= 12) {
      const n = s - 12;
      thump({ at: t, f0: 260 - n * 42, f1: 70 - n * 8, dur: 0.16, gain: 0.5 });
      if (s === 15) {
        noise({ at: t, f0: 800, f1: 11000, dur: SPB * 4, gain: 0.10, q: 0.7,
                rev: 0.5 });
      }
    }

    // --- bass: a sixteenth pattern, with a sine sub underneath ---
    if (bLvl > 0) {
      const d = T.bass[s];
      if (d >= 0) {
        const f = deg(p.root, T.scale, d);
        voice({ at: t, type: T.wave, f0: f, dur: SPB * 1.35,
                gain: 0.30, voices: 2, spread: 9,
                cut: 240 + 900 * I, cutEnd: 140 + 320 * I, q: 8,
                a: 0.005, d: 0.08, sus: 0.1, rel: 0.08, ...D });
        if (T.sub && s % 2 === 0) {
          voice({ at: t, type: 'sine', f0: f / 2, dur: SPB * 1.6, gain: 0.26,
                  voices: 1, cut: 200, q: 0.7, a: 0.008, d: 0.12, sus: 0.12,
                  rel: 0.1, ...D });
        }
      }
    }

    // --- arpeggio: sixteenths through the delay, wider as the wave thins ---
    if (aLvl > 0 && I > 0.08) {
      const tone = p.chord[(i * 3 + (s & 3)) % p.chord.length]
                 * ((s % 8 === 7) ? 2 : 1);
      voice({ at: t, type: 'square', f0: tone, dur: 0.09,
              gain: (0.075 + 0.05 * I) * aLvl, voices: 2, spread: 18,
              cut: 1500 + 3600 * I, q: 4,
              a: 0.003, d: 0.045, sus: 0.001, rel: 0.055,
              del: 0.44, rev: 0.2, ...D });
    }

    // --- pad: a seventh chord, one long note per bar ---
    if (s === 0) {
      const seventh = p.chord[0] * Math.pow(2, 10 / 12);
      for (const f of p.chord.concat([seventh])) {
        voice({ at: t, type: 'sawtooth', f0: f / 2, dur: SPB * 15,
                gain: 0.045 + 0.028 * I, voices: 3, spread: 24,
                cut: 620 + 1700 * I, q: 1.2,
                a: 0.5, d: SPB * 8, sus: 0.03, rel: 0.7, rev: 0.6, ...D });
      }
    }

    // --- lead: supersaw, once the section and the wave both allow it ---
    if (lLvl > 0 && I > 0.45) {
      const d = T.lead[s];
      if (d >= 0) {
        voice({ at: t, type: 'sawtooth', f0: deg(T.leadRoot, T.scale, d),
                dur: 0.15, gain: 0.095, voices: 5, spread: 26,
                cut: 3400, q: 3, a: 0.008, d: 0.09, sus: 0.02, rel: 0.16,
                del: 0.5, rev: 0.35, ...D });
      }
    }

    // --- counter-melody: an FM bell answering in the gaps ---
    if (cLvl > 0.3) {
      const d = T.counter[s];
      if (d >= 0) {
        bell({ at: t, f0: deg(T.leadRoot, T.scale, d), dur: 0.55,
               gain: 0.075 * cLvl, ratio: 2.01, index: 2.4,
               del: 0.4, rev: 0.5, ...D });
      }
    }
  }

  function schedule(i, t) {
    const T = track;
    const bar = (i >> 4) % T.prog.length;
    const s = i & 15;                       // sixteenth within the bar
    const p = T.prog[bar];
    const I = intensity;

    // --- drums ---
    if (s % 8 === 0) {                      // kick on 1 and 3
      thump({ at: t, f0: 150, f1: 42, dur: 0.28, gain: 0.85 });
      noise({ at: t, f0: 1800, f1: 400, dur: 0.03, gain: 0.18, q: 0.7 });
    }
    if (I > 0.45 && (s === 14 || s === 6)) {
      thump({ at: t, f0: 130, f1: 44, dur: 0.18, gain: 0.5 });
    }
    if (s % 8 === 4) {                      // snare on 2 and 4
      noise({ at: t, f0: 2400, f1: 900, dur: 0.16, gain: 0.34, q: 0.6, rev: 0.28 });
      voice({ at: t, type: 'triangle', f0: 220, f1: 150, dur: 0.1, gain: 0.14,
              voices: 1, cut: 3000 });
    }
    // hats: each track has its own base division, doubling when it gets busy
    const hatEvery = I > 0.6 ? Math.max(1, T.hat >> 1) : T.hat;
    if (s % hatEvery === 0) {
      noise({ at: t, f0: 9000, f1: 6500, dur: s % 4 === 2 ? 0.06 : 0.032,
              gain: s % 4 === 0 ? 0.12 : 0.075, q: 1.4, filter: 'highpass' });
    }

    // --- bass: root on eighths, lifting an octave on the track's accents ---
    if (s % 2 === 0) {
      const oct = T.bassLift.indexOf(s) >= 0 ? 2 : 1;
      voice({ at: t, type: T.wave, f0: p.root * oct, dur: SPB * 1.7,
              gain: 0.34, voices: 2, spread: 8,
              cut: 260 + 700 * I, cutEnd: 150 + 260 * I, q: 7,
              a: 0.006, d: 0.09, sus: 0.1, rel: 0.09 });
    }

    // --- arpeggio: sixteenth plucks through the chord, into the delay ---
    if (I > 0.12) {
      const tone = p.chord[(i * 3 + (s & 3)) % p.chord.length]
                 * ((s % 8 === 7) ? 2 : 1);
      voice({ at: t, type: 'square', f0: tone, dur: 0.1,
              gain: 0.09 + 0.05 * I, voices: 2, spread: 16,
              cut: 1600 + 3200 * I, q: 4,
              a: 0.003, d: 0.05, sus: 0.001, rel: 0.06,
              del: 0.42, rev: 0.2 });
    }

    // --- pad: one long detuned chord per bar ---
    if (s === 0) {
      for (const f of p.chord) {
        voice({ at: t, type: 'sawtooth', f0: f / 2, dur: SPB * 15,
                gain: 0.055 + 0.03 * I, voices: 3, spread: 22,
                cut: 700 + 1500 * I, q: 1.2,
                a: 0.4, d: SPB * 8, sus: 0.03, rel: 0.6, rev: 0.55 });
      }
    }

    // --- lead motif, only once the wave is thinning out ---
    if (I > 0.62) {
      const d = T.lead[s];
      if (d >= 0) {
        const sc = T.scale;
        const semi = sc[d % sc.length] + 12 * Math.floor(d / sc.length);
        voice({ at: t, type: 'sawtooth', f0: T.leadRoot * Math.pow(2, semi / 12),
                dur: 0.16, gain: 0.1, voices: 3, spread: 20,
                cut: 3200, q: 3, a: 0.01, d: 0.1, sus: 0.02, rel: 0.14,
                del: 0.5, rev: 0.35 });
      }
    }
  }

  function pump() {
    if (!ctx || !musicOn) return;
    while (nextTime < ctx.currentTime + LOOKAHEAD) {
      if (nextTime < ctx.currentTime) nextTime = ctx.currentTime + 0.02;
      (complex ? scheduleX : schedule)(step, nextTime);
      step++;
      nextTime += SPB;
    }
  }

  return {
    init,

    setThrum(cleared) { intensity = Math.max(0, Math.min(1, cleared)); },

    // X swaps in the deeper arrangement and its own set of tracks
    setComplex(on) {
      const want = !!on;
      if (want === complex) return;
      complex = want;
      // the track we were on belongs to the other list; the engine follows
      // this with setTrack(stage), which lands on the right one
      useTrack(activeList()[0]);
      step = 0;
      if (duck) duck.gain.value = 1;
      if (musicOn && ctx) nextTime = ctx.currentTime + 0.05;
    },
    isComplex() { return complex; },

    // one track per level, cycling once they run out
    setTrack(stage) {
      const list = activeList();
      const t = list[Math.max(0, (stage | 0) - 1) % list.length];
      if (t === track) return;
      useTrack(t);
      step = 0;                     // restart the loop on the new bar line
      if (musicOn && ctx) nextTime = ctx.currentTime + 0.05;
    },
    trackName() { return track ? track.name : ''; },
    trackCount() { return activeList().length; },
    trackList() { return activeList().map(t => t.name); },

    thrumOn() {
      init();
      if (!ctx || musicOn) return;
      musicOn = true;
      nextTime = ctx.currentTime + 0.06;
      if (timer) clearInterval(timer);
      timer = setInterval(pump, 25);
    },
    thrumOff() {
      musicOn = false;
      if (timer) { clearInterval(timer); timer = null; }
    },

    // --- effects ----------------------------------------------------------
    shoot() {
      voice({ type: 'sawtooth', f0: 2400, f1: 420, dur: 0.13, gain: 0.16,
              voices: 2, spread: 30, cut: 6000, cutEnd: 900, q: 6,
              a: 0.002, d: 0.07, sus: 0.001, rel: 0.05, del: 0.16 });
      noise({ f0: 5200, f1: 1200, dur: 0.06, gain: 0.1, q: 1.2 });
    },

    boom() {
      thump({ f0: 190, f1: 34, dur: 0.42, gain: 0.55 });
      noise({ f0: 3200, f1: 220, dur: 0.42, gain: 0.4, q: 0.7, rev: 0.4 });
      voice({ type: 'sawtooth', f0: 420, f1: 60, dur: 0.26, gain: 0.12,
              voices: 2, cut: 2400, cutEnd: 300, q: 3, rel: 0.15 });
    },

    bossBoom() {
      thump({ f0: 220, f1: 26, dur: 0.85, gain: 0.8 });
      noise({ f0: 2600, f1: 120, dur: 0.8, gain: 0.5, q: 0.6, rev: 0.65 });
      voice({ type: 'sawtooth', f0: 300, f1: 40, dur: 0.6, gain: 0.18,
              voices: 3, spread: 25, cut: 2000, cutEnd: 200, q: 4, rel: 0.35,
              rev: 0.4 });
      voice({ type: 'square', f0: 1600, f1: 200, dur: 0.3, gain: 0.08,
              voices: 2, cut: 5000, cutEnd: 600, q: 5, delay: 0.03, del: 0.3 });
    },

    death() {
      thump({ f0: 260, f1: 18, dur: 1.5, gain: 0.9 });
      noise({ f0: 4000, f1: 60, dur: 1.4, gain: 0.55, q: 0.5, rev: 0.8 });
      voice({ type: 'sawtooth', f0: 520, f1: 30, dur: 1.2, gain: 0.22,
              voices: 4, spread: 40, cut: 3000, cutEnd: 120, q: 6, rel: 0.5,
              rev: 0.6 });
      // the reversed-swell tail
      voice({ type: 'triangle', f0: 60, f1: 300, dur: 0.9, gain: 0.1,
              voices: 2, cut: 1200, delay: 0.35, a: 0.5, rev: 0.7 });
    },

    dive(isBoss) {
      voice({ type: 'sawtooth', f0: isBoss ? 1300 : 1900,
              f1: isBoss ? 190 : 340, dur: isBoss ? 0.85 : 0.6,
              gain: isBoss ? 0.12 : 0.08, voices: 3, spread: 26,
              cut: 4200, cutEnd: 500, q: 9,
              a: 0.02, d: 0.3, sus: 0.01, rel: 0.2, rev: 0.3, del: 0.18 });
    },

    // --- X cues -----------------------------------------------------------
    // A pod collected: a short rising arpeggio, keyed off which pod it was so
    // the five pickups are tellable apart without looking.
    pickup(kind) {
      const base = { beam: 523.25, rapid: 587.33, shield: 440,
                     score: 659.25, nova: 349.23 }[kind] || 523.25;
      [0, 7, 12].forEach((s, i) =>
        voice({ type: 'triangle', f0: base * Math.pow(2, s / 12), dur: 0.14,
                gain: 0.15, voices: 2, spread: 10, cut: 6000, q: 2,
                delay: i * 0.045, a: 0.004, d: 0.07, sus: 0.01, rel: 0.12,
                rev: 0.35, del: 0.25 }));
      bell({ f0: base * 2, dur: 0.5, gain: 0.09, ratio: 3.01, index: 2,
             delay: 0.09, rev: 0.5, del: 0.3 });
      noise({ f0: 3000, f1: 11000, dur: 0.18, gain: 0.07, q: 1.1 });
    },

    // Cycling the hold: a dry tick, quiet enough to hold down.
    cycle() {
      voice({ type: 'square', f0: 1400, f1: 1900, dur: 0.05, gain: 0.07,
              voices: 1, cut: 5000, q: 1, a: 0.002, d: 0.02, sus: 0.001,
              rel: 0.03 });
    },

    // Spending a pod: the loadout comes online.
    arm(kind) {
      const base = { beam: 261.63, rapid: 293.66, shield: 220,
                     score: 329.63, nova: 174.61 }[kind] || 261.63;
      [0, 7, 12, 19].forEach((s, i) =>
        voice({ type: 'sawtooth', f0: base * Math.pow(2, s / 12), dur: 0.3,
                gain: 0.16, voices: 4, spread: 20, cut: 800, cutEnd: 6500,
                cutTime: 0.35, q: 4, delay: i * 0.05, a: 0.01, d: 0.15,
                sus: 0.04, rel: 0.25, rev: 0.45, del: 0.3 }));
      thump({ f0: 120, f1: 45, dur: 0.35, gain: 0.55 });
    },

    // The swarm's answer: a descending minor-second sting, deliberately ugly.
    escalate() {
      [0, -1, -5, -12].forEach((s, i) =>
        voice({ type: 'sawtooth', f0: 330 * Math.pow(2, s / 12), dur: 0.5,
                gain: 0.15, voices: 4, spread: 34, cut: 2600, cutEnd: 420,
                cutTime: 0.6, q: 5, delay: i * 0.09, a: 0.02, d: 0.25,
                sus: 0.05, rel: 0.35, rev: 0.6 }));
      noise({ f0: 260, f1: 90, dur: 0.9, gain: 0.22, q: 0.8, rev: 0.7 });
      thump({ f0: 90, f1: 26, dur: 0.9, gain: 0.7, delay: 0.18 });
    },

    // A shot stopped by ARMOUR plating: metallic, and clearly not a kill.
    plating() {
      noise({ f0: 4200, f1: 2600, dur: 0.07, gain: 0.16, q: 3.2,
              filter: 'bandpass' });
      bell({ f0: 1500, dur: 0.16, gain: 0.07, ratio: 1.73, index: 5 });
    },

    // A shield charge soaking a hit: a hard bright clang, then a ring-down.
    shieldHit() {
      noise({ f0: 5500, f1: 900, dur: 0.22, gain: 0.3, q: 1.6, rev: 0.5 });
      bell({ f0: 880, dur: 0.9, gain: 0.16, ratio: 1.41, index: 4,
             rev: 0.7, del: 0.2 });
      voice({ type: 'sawtooth', f0: 300, f1: 900, dur: 0.3, gain: 0.1,
              voices: 3, spread: 22, cut: 900, cutEnd: 5000, cutTime: 0.3,
              q: 4, a: 0.004, d: 0.12, sus: 0.02, rel: 0.2 });
      thump({ f0: 140, f1: 40, dur: 0.3, gain: 0.4 });
    },

    // NOVA: a downward sweep into a wall of sub and noise.
    nova() {
      noise({ f0: 12000, f1: 120, dur: 1.1, gain: 0.5, q: 0.5, rev: 0.85 });
      thump({ f0: 300, f1: 18, dur: 1.6, gain: 0.95 });
      voice({ type: 'sawtooth', f0: 1800, f1: 60, dur: 1.0, gain: 0.22,
              voices: 5, spread: 42, cut: 6000, cutEnd: 200, q: 7, rel: 0.5,
              rev: 0.7 });
      [0, 5, 7, 12].forEach((s, i) =>
        bell({ f0: 220 * Math.pow(2, s / 12), dur: 1.4, gain: 0.10,
               ratio: 2.01, index: 3, delay: 0.05 + i * 0.04, rev: 0.8,
               del: 0.4 }));
    },

    extraLife() {
      [0, 4, 7, 12, 16].forEach((s, i) =>
        voice({ type: 'sawtooth', f0: A4 * Math.pow(2, s / 12), dur: 0.22,
                gain: 0.16, voices: 3, spread: 18, cut: 5000, q: 2,
                delay: i * 0.075, a: 0.01, d: 0.12, sus: 0.02, rel: 0.2,
                rev: 0.45, del: 0.35 }));
    },

    stageClear() {
      [0, 3, 7, 10, 12, 15].forEach((s, i) =>
        voice({ type: 'sawtooth', f0: A3 * Math.pow(2, s / 12), dur: 0.2,
                gain: 0.15, voices: 3, spread: 20, cut: 4600, q: 2,
                delay: i * 0.085, a: 0.008, d: 0.12, sus: 0.02, rel: 0.25,
                rev: 0.5, del: 0.4 }));
      noise({ f0: 400, f1: 9000, dur: 0.6, gain: 0.12, q: 0.8, rev: 0.5 });
    },

    start() {
      noise({ f0: 120, f1: 7000, dur: 0.9, gain: 0.18, q: 0.9, rev: 0.5 });
      [0, 7, 12].forEach((s, i) =>
        voice({ type: 'sawtooth', f0: A3 * Math.pow(2, s / 12), dur: 0.5,
                gain: 0.18, voices: 4, spread: 24, cut: 900, cutEnd: 5000,
                cutTime: 0.6, q: 3, delay: i * 0.1, a: 0.05, d: 0.3,
                sus: 0.05, rel: 0.4, rev: 0.5 }));
      thump({ f0: 200, f1: 40, dur: 0.7, gain: 0.8, delay: 0.28 });
    },

    gameOver() {
      [0, -3, -7, -12, -17].forEach((s, i) =>
        voice({ type: 'sawtooth', f0: A3 * Math.pow(2, s / 12), dur: 0.6,
                gain: 0.17, voices: 3, spread: 24, cut: 2600, cutEnd: 400,
                cutTime: 0.7, q: 3, delay: i * 0.22, a: 0.02, d: 0.35,
                sus: 0.04, rel: 0.4, rev: 0.65 }));
      thump({ f0: 90, f1: 20, dur: 1.6, gain: 0.7, delay: 0.9 });
    },

    setMuted(m) {
      muted = m;
      if (master) master.gain.value = muted ? 0 : 0.9;
    },
    isMuted() { return muted; },
  };
})();
