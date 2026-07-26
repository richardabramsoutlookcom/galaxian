// -------------------------------------------------------------------------
//  Galaxian -- sound.
//
//  Everything here is synthesised from scratch with Web Audio: oscillators,
//  sweeps and filtered noise.  No samples and no ROM audio -- this is an
//  imitation of the cabinet's sound, built by ear, not a reproduction of its
//  circuit.
//
//  Safe to load headless: if there is no AudioContext every entry point is a
//  no-op, so build/preview.js can run the engine without a browser.
// -------------------------------------------------------------------------
const Sfx = (() => {
  const AC = typeof AudioContext !== 'undefined' ? AudioContext
           : (typeof webkitAudioContext !== 'undefined' ? webkitAudioContext : null);

  let ctx = null, master = null, muted = false;
  let noiseBuf = null;

  // --- the pulsing background thrum ---------------------------------------
  // A two-note descending figure that repeats.  On the real machine it speeds
  // up as the wave is cleared; here `setThrum(0..1)` takes the fraction of the
  // wave already destroyed and shortens the period accordingly.
  let thrumTimer = null, thrumStep = 0, thrumRate = 0;

  function init() {
    if (ctx || !AC) return;
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.25;
      master.connect(ctx.destination);

      // one second of white noise, reused by every percussive sound
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) { ctx = null; }
  }

  const ready = () => {
    if (!ctx) return false;
    if (ctx.state === 'suspended') ctx.resume();
    return !muted;
  };

  const now = () => ctx.currentTime;

  // A tone with an optional frequency sweep and a short percussive envelope.
  function tone({ type = 'square', f0, f1, dur, gain = 0.3, delay = 0,
                  attack = 0.005 }) {
    if (!ready()) return null;
    const t = now() + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== undefined && f1 !== f0) {
      o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
    return o;
  }

  // Filtered noise -- the basis of every explosion.
  function noise({ dur, gain = 0.4, f0 = 2200, f1 = 120, q = 1, delay = 0 }) {
    if (!ready()) return;
    const t = now() + delay;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = q;
    bp.frequency.setValueAtTime(f0, t);
    bp.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp); bp.connect(g); g.connect(master);
    src.start(t); src.stop(t + dur + 0.02);
  }

  // --- background thrum ---------------------------------------------------
  function thrumTick() {
    if (!ready()) return;
    // alternating low pair, the classic Galaxian "heartbeat"
    const base = 55 + thrumRate * 26;
    const f = thrumStep % 2 === 0 ? base : base * 0.75;
    tone({ type: 'square', f0: f, f1: f * 0.92, dur: 0.11, gain: 0.22 });
    thrumStep++;
  }

  function scheduleThrum() {
    if (thrumTimer) clearInterval(thrumTimer);
    if (!ctx) return;
    // 620ms when the wave is untouched, down to ~150ms with one alien left
    const period = 620 - 470 * thrumRate;
    thrumTimer = setInterval(thrumTick, period);
  }

  return {
    init,

    // `cleared` is 0..1 -- the fraction of the wave already destroyed
    setThrum(cleared) {
      const r = Math.max(0, Math.min(1, cleared));
      if (Math.abs(r - thrumRate) < 0.02 && thrumTimer) return;
      thrumRate = r;
      scheduleThrum();
    },
    // the cabinet had one heartbeat and no soundtrack, so these are no-ops.
    // The X cues are here for the same reason: the engine calls the sound bank
    // without asking which one it got.
    setTrack() {},
    trackName() { return ''; },
    setComplex() {},
    pickup() {}, nova() {}, shieldHit() {},
    cycle() {}, arm() {}, escalate() {}, plating() {},

    thrumOn() { if (!thrumTimer) scheduleThrum(); },
    thrumOff() { if (thrumTimer) { clearInterval(thrumTimer); thrumTimer = null; } },

    // player's shot: a short bright downward chirp
    shoot() { tone({ type: 'square', f0: 1500, f1: 320, dur: 0.13, gain: 0.22 }); },

    // an alien is hit
    boom() {
      noise({ dur: 0.34, gain: 0.5, f0: 2600, f1: 160, q: 0.8 });
      tone({ type: 'square', f0: 340, f1: 70, dur: 0.26, gain: 0.16 });
    },

    // the flagship is hit -- deeper and longer
    bossBoom() {
      noise({ dur: 0.55, gain: 0.6, f0: 1900, f1: 90, q: 0.7 });
      tone({ type: 'sawtooth', f0: 260, f1: 45, dur: 0.5, gain: 0.2 });
    },

    // the player's ship is destroyed
    death() {
      noise({ dur: 1.0, gain: 0.65, f0: 1400, f1: 60, q: 0.5 });
      tone({ type: 'sawtooth', f0: 420, f1: 40, dur: 0.9, gain: 0.28 });
      tone({ type: 'square', f0: 180, f1: 30, dur: 1.0, gain: 0.2, delay: 0.05 });
    },

    // an alien peels out of the formation -- the descending swoop whine
    dive(isBoss) {
      tone({ type: 'sawtooth', f0: isBoss ? 900 : 1250, f1: isBoss ? 150 : 260,
             dur: isBoss ? 0.75 : 0.55, gain: 0.13 });
    },

    extraLife() {
      const seq = [523, 659, 784, 1047];
      seq.forEach((f, i) => tone({ f0: f, dur: 0.16, gain: 0.24, delay: i * 0.11 }));
    },

    stageClear() {
      const seq = [392, 523, 659, 784, 1047];
      seq.forEach((f, i) => tone({ f0: f, dur: 0.14, gain: 0.22, delay: i * 0.09 }));
    },

    start() {
      const seq = [262, 330, 392, 523, 659, 784];
      seq.forEach((f, i) => tone({ f0: f, dur: 0.13, gain: 0.24, delay: i * 0.1 }));
    },

    gameOver() {
      const seq = [523, 415, 330, 262, 196];
      seq.forEach((f, i) => tone({ type: 'square', f0: f, dur: 0.28, gain: 0.24,
                                   delay: i * 0.2 }));
    },

    setMuted(m) {
      muted = m;
      if (master) master.gain.value = muted ? 0 : 0.25;
    },
    toggleMute() {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 0.25;
      return muted;
    },
    isMuted() { return muted; },
  };
})();
