const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const scoreLeft = document.getElementById("scoreLeft");
const scoreRight = document.getElementById("scoreRight");
const livesEl = document.getElementById("lives");
const flagsEl = document.getElementById("flags");

const W = canvas.width;
const H = canvas.height;
const STAR_COUNT = 130;

const keys = new Set();
let lastTime = 0;

const MODE_ATTRACT = "attract";
const MODE_PLAY = "play";
const MODE_GAMEOVER = "gameover";

// Sprite sheet loading with transparency processing
const spriteSheetRaw = new Image();
let spriteSheet = null;
let spritesLoaded = false;

spriteSheetRaw.onload = () => {
  // Create offscreen canvas to process sprite sheet
  const offscreen = document.createElement("canvas");
  offscreen.width = spriteSheetRaw.width;
  offscreen.height = spriteSheetRaw.height;
  const offCtx = offscreen.getContext("2d");

  // Draw original sprite sheet
  offCtx.drawImage(spriteSheetRaw, 0, 0);

  // Get image data and make background transparent
  const imageData = offCtx.getImageData(0, 0, offscreen.width, offscreen.height);
  const data = imageData.data;

  // The background color is very dark (close to black)
  // Make any pixel with RGB all below threshold transparent
  const threshold = 20;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    // If pixel is very dark (background), make it transparent
    if (r < threshold && g < threshold && b < threshold) {
      data[i + 3] = 0; // Set alpha to 0
    }
  }

  offCtx.putImageData(imageData, 0, 0);

  // Create new image from processed canvas
  spriteSheet = offscreen;
  spritesLoaded = true;
};
spriteSheetRaw.src = "assets/sprites.png";

// Sprite definitions from the Galaxian sprite sheet (x, y, width, height)
// The sprite sheet has enemy types in rows with multiple animation frames
// Each enemy has several animation frames for wing flapping/movement
const SPRITE_DEFS = {
  // Boss/Flagship sprites (yellow) - top row, multiple animation frames
  boss: [
    { x: 0, y: 0, w: 16, h: 16 },
    { x: 16, y: 0, w: 16, h: 16 },
    { x: 32, y: 0, w: 16, h: 16 },
    { x: 48, y: 0, w: 16, h: 16 },
  ],
  // Red enemies - second row
  red: [
    { x: 0, y: 16, w: 16, h: 16 },
    { x: 16, y: 16, w: 16, h: 16 },
    { x: 32, y: 16, w: 16, h: 16 },
    { x: 48, y: 16, w: 16, h: 16 },
  ],
  // Purple enemies - third row
  purple: [
    { x: 0, y: 32, w: 16, h: 16 },
    { x: 16, y: 32, w: 16, h: 16 },
    { x: 32, y: 32, w: 16, h: 16 },
    { x: 48, y: 32, w: 16, h: 16 },
  ],
  // Blue enemies - fourth row (cyan colored in sprite sheet)
  blue: [
    { x: 0, y: 48, w: 16, h: 16 },
    { x: 16, y: 48, w: 16, h: 16 },
    { x: 32, y: 48, w: 16, h: 16 },
    { x: 48, y: 48, w: 16, h: 16 },
  ],
  // Player ship (Galaxip) - green/teal colored ship
  player: [
    { x: 64, y: 48, w: 16, h: 16 },
  ],
  // Bullets - player (yellow) and enemy (white/red)
  playerBullet: { x: 120, y: 0, w: 3, h: 8 },
  enemyBullet: { x: 152, y: 0, w: 3, h: 8 },
  // Flag for wave indicator
  flag: { x: 80, y: 48, w: 8, h: 16 },
};

const state = {
  score: 0,
  highScore: 0,
  lives: 3,
  wave: 1,
  credits: 0,
  mode: MODE_ATTRACT,
  blink: 0,
  animFrame: 0,
  animTimer: 0,
  player: {
    x: W * 0.5,
    y: H - 70,
    w: 32,
    h: 32,
    speed: 210,
    cooldown: 0,
    alive: true,
    invuln: 0,
    powerType: null,
    powerTimer: 0,
  },
  bullets: [],
  enemyBullets: [],
  enemies: [],
  dives: [],
  explosions: [],
  powerups: [],
  bonusTexts: [],
  stars: [],
  formation: {
    offsetX: 0,
    offsetY: 80,
    dir: 1,
    speed: 15,
    sway: 0,
  },
  nextDive: 1.2,
};

const audio = {
  ctx: null,
  master: null,
  musicGain: null,
  sfxGain: null,
  unlocked: false,
  musicTimer: null,
  musicStep: 0,
  flyingSounds: [],
  droneOsc: null,
  droneGain: null,
};

function initAudio() {
  if (audio.ctx) return;
  audio.ctx = new (window.AudioContext || window.webkitAudioContext)();
  audio.master = audio.ctx.createGain();
  audio.master.gain.value = 0.15;
  audio.musicGain = audio.ctx.createGain();
  audio.sfxGain = audio.ctx.createGain();
  audio.musicGain.gain.value = 0.08;
  audio.sfxGain.gain.value = 0.25;
  audio.master.connect(audio.ctx.destination);
  audio.musicGain.connect(audio.master);
  audio.sfxGain.connect(audio.master);
}

function playTone({ freq, duration, type = "square", gain = 0.12, sweep, channel = "sfx" }) {
  if (!audio.ctx || audio.ctx.state !== "running") return;
  const now = audio.ctx.currentTime;
  const osc = audio.ctx.createOscillator();
  const amp = audio.ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  if (sweep) {
    osc.frequency.linearRampToValueAtTime(sweep, now + duration);
  }
  amp.gain.setValueAtTime(0.0001, now);
  amp.gain.exponentialRampToValueAtTime(gain, now + 0.02);
  amp.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  osc.connect(amp);
  amp.connect(channel === "music" ? audio.musicGain : audio.sfxGain);
  osc.start(now);
  osc.stop(now + duration + 0.02);
}

function playNoise(duration, gain) {
  if (!audio.ctx || audio.ctx.state !== "running") return;
  const now = audio.ctx.currentTime;
  const buffer = audio.ctx.createBuffer(1, audio.ctx.sampleRate * duration, audio.ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  }
  const noise = audio.ctx.createBufferSource();
  const amp = audio.ctx.createGain();
  noise.buffer = buffer;
  amp.gain.value = gain;
  noise.connect(amp);
  amp.connect(audio.sfxGain);
  noise.start(now);
}

// Authentic Galaxian sound effects based on original arcade
function playCreditSound() {
  if (!audio.ctx || audio.ctx.state !== "running") return;
  const now = audio.ctx.currentTime;
  // Ascending arpeggio - credit insert sound
  const notes = [523, 659, 784, 1047];
  notes.forEach((freq, i) => {
    const osc = audio.ctx.createOscillator();
    const amp = audio.ctx.createGain();
    osc.type = "square";
    osc.frequency.value = freq;
    amp.gain.setValueAtTime(0.15, now + i * 0.06);
    amp.gain.exponentialRampToValueAtTime(0.001, now + i * 0.06 + 0.08);
    osc.connect(amp);
    amp.connect(audio.sfxGain);
    osc.start(now + i * 0.06);
    osc.stop(now + i * 0.06 + 0.1);
  });
}

function playGameStartTune() {
  if (!audio.ctx || audio.ctx.state !== "running") return;
  const now = audio.ctx.currentTime;
  // Classic Galaxian start tune - triumphant fanfare
  const melody = [
    { freq: 392, dur: 0.12 },  // G4
    { freq: 523, dur: 0.12 },  // C5
    { freq: 659, dur: 0.12 },  // E5
    { freq: 784, dur: 0.25 },  // G5
    { freq: 659, dur: 0.12 },  // E5
    { freq: 784, dur: 0.35 },  // G5
  ];
  let t = 0;
  melody.forEach((note) => {
    const osc = audio.ctx.createOscillator();
    const amp = audio.ctx.createGain();
    osc.type = "square";
    osc.frequency.value = note.freq;
    amp.gain.setValueAtTime(0.0001, now + t);
    amp.gain.exponentialRampToValueAtTime(0.18, now + t + 0.015);
    amp.gain.exponentialRampToValueAtTime(0.0001, now + t + note.dur);
    osc.connect(amp);
    amp.connect(audio.sfxGain);
    osc.start(now + t);
    osc.stop(now + t + note.dur + 0.02);
    t += note.dur;
  });
}

function playShootSound() {
  if (!audio.ctx || audio.ctx.state !== "running") return;
  const now = audio.ctx.currentTime;
  // Sharp descending zap - authentic shoot sound
  const osc = audio.ctx.createOscillator();
  const amp = audio.ctx.createGain();
  osc.type = "square";
  osc.frequency.setValueAtTime(1200, now);
  osc.frequency.exponentialRampToValueAtTime(300, now + 0.08);
  amp.gain.setValueAtTime(0.2, now);
  amp.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
  osc.connect(amp);
  amp.connect(audio.sfxGain);
  osc.start(now);
  osc.stop(now + 0.12);
}

function playEnemyHitSound(isBoss = false) {
  if (!audio.ctx || audio.ctx.state !== "running") return;
  const now = audio.ctx.currentTime;
  // Explosive burst with different pitch for boss
  const baseFreq = isBoss ? 150 : 200;

  // Noise component
  const bufferSize = audio.ctx.sampleRate * 0.15;
  const buffer = audio.ctx.createBuffer(1, bufferSize, audio.ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 0.5);
  }
  const noise = audio.ctx.createBufferSource();
  const noiseAmp = audio.ctx.createGain();
  noise.buffer = buffer;
  noiseAmp.gain.setValueAtTime(isBoss ? 0.35 : 0.25, now);
  noiseAmp.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
  noise.connect(noiseAmp);
  noiseAmp.connect(audio.sfxGain);
  noise.start(now);

  // Tone component
  const osc = audio.ctx.createOscillator();
  const amp = audio.ctx.createGain();
  osc.type = "square";
  osc.frequency.setValueAtTime(baseFreq, now);
  osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.3, now + 0.12);
  amp.gain.setValueAtTime(0.15, now);
  amp.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
  osc.connect(amp);
  amp.connect(audio.sfxGain);
  osc.start(now);
  osc.stop(now + 0.15);
}

function playPlayerDeathSound() {
  if (!audio.ctx || audio.ctx.state !== "running") return;
  const now = audio.ctx.currentTime;
  // Extended explosion - dramatic player death
  const duration = 0.4;
  const bufferSize = audio.ctx.sampleRate * duration;
  const buffer = audio.ctx.createBuffer(1, bufferSize, audio.ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    const env = Math.pow(1 - i / bufferSize, 0.3);
    data[i] = (Math.random() * 2 - 1) * env;
  }
  const noise = audio.ctx.createBufferSource();
  const noiseAmp = audio.ctx.createGain();
  noise.buffer = buffer;
  noiseAmp.gain.value = 0.4;
  noise.connect(noiseAmp);
  noiseAmp.connect(audio.sfxGain);
  noise.start(now);

  // Descending tone sweep
  const osc = audio.ctx.createOscillator();
  const amp = audio.ctx.createGain();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(400, now);
  osc.frequency.exponentialRampToValueAtTime(50, now + duration);
  amp.gain.setValueAtTime(0.2, now);
  amp.gain.exponentialRampToValueAtTime(0.001, now + duration);
  osc.connect(amp);
  amp.connect(audio.sfxGain);
  osc.start(now);
  osc.stop(now + duration + 0.05);
}

function playExtraLifeSound() {
  if (!audio.ctx || audio.ctx.state !== "running") return;
  const now = audio.ctx.currentTime;
  // Triumphant ascending arpeggio
  const notes = [523, 659, 784, 1047, 1319];
  notes.forEach((freq, i) => {
    const osc = audio.ctx.createOscillator();
    const amp = audio.ctx.createGain();
    osc.type = "square";
    osc.frequency.value = freq;
    amp.gain.setValueAtTime(0.0001, now + i * 0.08);
    amp.gain.exponentialRampToValueAtTime(0.15, now + i * 0.08 + 0.01);
    amp.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.08 + 0.1);
    osc.connect(amp);
    amp.connect(audio.sfxGain);
    osc.start(now + i * 0.08);
    osc.stop(now + i * 0.08 + 0.12);
  });
}

function playFlyingSound(enemy) {
  if (!audio.ctx || audio.ctx.state !== "running") return;
  const now = audio.ctx.currentTime;
  // Swooping sound for diving enemies - warbling oscillator
  const osc = audio.ctx.createOscillator();
  const lfo = audio.ctx.createOscillator();
  const lfoGain = audio.ctx.createGain();
  const amp = audio.ctx.createGain();

  osc.type = "square";
  osc.frequency.value = 180;

  lfo.type = "sine";
  lfo.frequency.value = 8;
  lfoGain.gain.value = 60;

  lfo.connect(lfoGain);
  lfoGain.connect(osc.frequency);

  amp.gain.setValueAtTime(0.0001, now);
  amp.gain.exponentialRampToValueAtTime(0.12, now + 0.05);
  amp.gain.setValueAtTime(0.12, now + 1.2);
  amp.gain.exponentialRampToValueAtTime(0.0001, now + 1.8);

  osc.connect(amp);
  amp.connect(audio.musicGain);

  osc.start(now);
  lfo.start(now);
  osc.stop(now + 2);
  lfo.stop(now + 2);

  const sound = { osc, lfo, amp, enemy };
  audio.flyingSounds.push(sound);
  setTimeout(() => {
    const idx = audio.flyingSounds.indexOf(sound);
    if (idx !== -1) audio.flyingSounds.splice(idx, 1);
  }, 2000);
}

function playEnemyShootSound() {
  if (!audio.ctx || audio.ctx.state !== "running") return;
  const now = audio.ctx.currentTime;
  // Lower pitched enemy fire
  const osc = audio.ctx.createOscillator();
  const amp = audio.ctx.createGain();
  osc.type = "square";
  osc.frequency.setValueAtTime(400, now);
  osc.frequency.exponentialRampToValueAtTime(200, now + 0.06);
  amp.gain.setValueAtTime(0.1, now);
  amp.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
  osc.connect(amp);
  amp.connect(audio.sfxGain);
  osc.start(now);
  osc.stop(now + 0.1);
}

function startMusic() {
  if (!audio.ctx) return;
  startBackgroundDrone();
}

function startBackgroundDrone() {
  if (!audio.ctx || audio.droneOsc) return;
  const now = audio.ctx.currentTime;

  // Create pulsating drone - authentic Galaxian background sound
  audio.droneOsc = audio.ctx.createOscillator();
  audio.droneGain = audio.ctx.createGain();

  // LFO for pulsation
  const lfo = audio.ctx.createOscillator();
  const lfoGain = audio.ctx.createGain();

  audio.droneOsc.type = "square";
  audio.droneOsc.frequency.value = 55; // Low A

  lfo.type = "square";
  lfo.frequency.value = 3.5; // Pulse rate
  lfoGain.gain.value = 0.04;

  lfo.connect(lfoGain);
  lfoGain.connect(audio.droneGain.gain);

  audio.droneGain.gain.value = 0.05;
  audio.droneOsc.connect(audio.droneGain);
  audio.droneGain.connect(audio.musicGain);

  audio.droneOsc.start(now);
  lfo.start(now);

  // Store LFO reference for cleanup
  audio.droneLfo = lfo;

  // Also add rhythmic pulse for more tension during gameplay
  if (!audio.musicTimer) {
    audio.musicTimer = setInterval(() => {
      if (state.mode === MODE_GAMEOVER || !audio.ctx || audio.ctx.state !== "running") return;

      // Pulsing bass notes that increase tension
      const aliveEnemies = state.enemies.filter(e => e.alive).length;
      const tension = 1 - (aliveEnemies / 36); // More tension as enemies die

      if (state.mode === MODE_PLAY) {
        // Faster pulse as fewer enemies remain
        const freq = 65 + tension * 20;
        playTone({
          freq,
          duration: 0.08,
          gain: 0.04 + tension * 0.02,
          type: "square",
          channel: "music"
        });

        // Secondary pulse on off-beats
        if (audio.musicStep % 2 === 1) {
          playTone({
            freq: freq * 1.5,
            duration: 0.04,
            gain: 0.025,
            type: "square",
            channel: "music"
          });
        }
      } else {
        // Attract mode - slower, mysterious pulse
        playTone({
          freq: 55,
          duration: 0.1,
          gain: 0.035,
          type: "square",
          channel: "music"
        });
      }
      audio.musicStep += 1;
    }, state.mode === MODE_PLAY ? 180 : 280);
  }
}

function stopDrone() {
  if (audio.droneOsc) {
    audio.droneOsc.stop();
    audio.droneOsc = null;
  }
  if (audio.droneLfo) {
    audio.droneLfo.stop();
    audio.droneLfo = null;
  }
  audio.droneGain = null;
}

function updateDroneSpeed() {
  if (!audio.musicTimer) return;
  clearInterval(audio.musicTimer);
  audio.musicTimer = null;

  const interval = state.mode === MODE_PLAY ? 180 : 280;
  audio.musicTimer = setInterval(() => {
    if (state.mode === MODE_GAMEOVER || !audio.ctx || audio.ctx.state !== "running") return;

    const aliveEnemies = state.enemies.filter(e => e.alive).length;
    const tension = 1 - (aliveEnemies / 36);

    if (state.mode === MODE_PLAY) {
      const freq = 65 + tension * 20;
      playTone({
        freq,
        duration: 0.08,
        gain: 0.04 + tension * 0.02,
        type: "square",
        channel: "music"
      });
      if (audio.musicStep % 2 === 1) {
        playTone({
          freq: freq * 1.5,
          duration: 0.04,
          gain: 0.025,
          type: "square",
          channel: "music"
        });
      }
    } else {
      playTone({
        freq: 55,
        duration: 0.1,
        gain: 0.035,
        type: "square",
        channel: "music"
      });
    }
    audio.musicStep += 1;
  }, interval);
}

function unlockAudio() {
  if (audio.unlocked) return;
  initAudio();
  audio.ctx.resume().then(() => {
    audio.unlocked = true;
    startMusic();
  });
}

function initStars() {
  state.stars = Array.from({ length: STAR_COUNT }, () => ({
    x: Math.random() * W,
    y: Math.random() * H,
    speed: 12 + Math.random() * 40,
    color: randomStarColor(),
  }));
}

function randomStarColor() {
  const colors = ["#b6d8ff", "#ffd27d", "#ff8f8f", "#b5ffcb", "#b39cff"];
  return colors[Math.floor(Math.random() * colors.length)];
}

// Draw sprite from sprite sheet
function drawSpriteFromSheet(spriteDef, x, y, scale = 2) {
  if (!spritesLoaded) return;
  const w = spriteDef.w * scale;
  const h = spriteDef.h * scale;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    spriteSheet,
    spriteDef.x, spriteDef.y, spriteDef.w, spriteDef.h,
    Math.round(x - w / 2), Math.round(y - h / 2), w, h
  );
}

// Draw animated sprite (picks frame based on animation state)
function drawAnimatedSprite(spriteType, x, y, scale = 2, customFrame = null) {
  if (!spritesLoaded) return;
  const frames = SPRITE_DEFS[spriteType];
  if (!frames || frames.length === 0) return;
  const frameIndex = customFrame !== null ? customFrame % frames.length : state.animFrame % frames.length;
  drawSpriteFromSheet(frames[frameIndex], x, y, scale);
}

function resetHUD() {
  livesEl.innerHTML = "";
  for (let i = 0; i < state.lives - 1; i += 1) {
    const life = document.createElement("div");
    life.className = "life-ship";
    livesEl.appendChild(life);
  }
  flagsEl.innerHTML = "";
  for (let i = 0; i < Math.min(state.wave, 4); i += 1) {
    const flag = document.createElement("div");
    flag.className = "flag";
    flagsEl.appendChild(flag);
  }
}

function updateScore(points) {
  state.score += points;
  if (state.score > state.highScore) {
    state.highScore = state.score;
  }
  scoreLeft.textContent = state.highScore.toString().padStart(5, "0");
  scoreRight.textContent = state.score.toString().padStart(5, "0");
}

function makeFormation() {
  // Authentic Galaxian formation layout with proper scoring
  // Points: formation / diving values based on original arcade
  const rows = [
    { count: 2, formationPts: 60, divingPts: 150, diveChance: 0.5, sprite: "boss" },    // 2 flagships
    { count: 6, formationPts: 50, divingPts: 100, diveChance: 0.4, sprite: "red" },     // 6 red (escorts)
    { count: 8, formationPts: 40, divingPts: 80, diveChance: 0.35, sprite: "purple" },  // 8 purple
    { count: 10, formationPts: 30, divingPts: 60, diveChance: 0.3, sprite: "blue" },    // 10 blue
    { count: 10, formationPts: 30, divingPts: 60, diveChance: 0.3, sprite: "blue" },    // 10 blue
  ];

  state.enemies = [];
  state.activeDiveGroup = null; // Track flagship + escort dive groups
  const baseSpacing = 36;
  let y = 100;
  let enemyId = 0;

  rows.forEach((row, rowIndex) => {
    const spacing = baseSpacing;
    const totalWidth = (row.count - 1) * spacing;
    let startX = W * 0.5 - totalWidth / 2;

    // Special positioning for boss row - they sit above specific red enemies
    if (rowIndex === 0) {
      // Position bosses above the 2nd and 5th red enemies (index 1 and 4)
      const redSpacing = baseSpacing;
      const redTotalWidth = 5 * redSpacing;
      const redStartX = W * 0.5 - redTotalWidth / 2;
      const bossPositions = [
        redStartX + 1 * redSpacing,  // above 2nd red
        redStartX + 4 * redSpacing,  // above 5th red
      ];
      for (let i = 0; i < row.count; i += 1) {
        state.enemies.push({
          id: enemyId++,
          baseX: bossPositions[i],
          baseY: y,
          x: bossPositions[i],
          y,
          w: 32,
          h: 32,
          row: rowIndex,
          formationPts: row.formationPts,
          divingPts: row.divingPts,
          diveChance: row.diveChance,
          alive: true,
          diving: false,
          sprite: row.sprite,
          phase: Math.random() * Math.PI * 2,
          escortGroup: null, // Will be set when diving with escorts
          bossIndex: i, // 0 = left boss, 1 = right boss
        });
      }
    } else {
      for (let i = 0; i < row.count; i += 1) {
        state.enemies.push({
          id: enemyId++,
          baseX: startX + i * spacing,
          baseY: y,
          x: startX + i * spacing,
          y,
          w: 32,
          h: 32,
          row: rowIndex,
          formationPts: row.formationPts,
          divingPts: row.divingPts,
          diveChance: row.diveChance,
          alive: true,
          diving: false,
          sprite: row.sprite,
          phase: Math.random() * Math.PI * 2,
          escortGroup: null,
          // Track which boss this red enemy is an escort for
          escortForBoss: rowIndex === 1 ? (i < 3 ? 0 : 1) : null,
        });
      }
    }
    y += 32;
  });

  state.formation.offsetX = 0;
  state.formation.sway = 0;
  state.formation.dir = 1;
  state.nextDive = 1.1;
}

// Calculate score for killing an enemy - authentic Galaxian scoring
function calculateEnemyScore(enemy) {
  const basePoints = enemy.diving ? enemy.divingPts : enemy.formationPts;

  // Special flagship escort bonus scoring
  if (enemy.sprite === "boss" && enemy.diving && enemy.escortGroup) {
    const group = enemy.escortGroup;
    const escortsKilledFirst = group.escorts.filter(e => !e.alive).length;
    const escortsTotal = group.escorts.length;

    if (escortsTotal === 2 && escortsKilledFirst === 2) {
      // Both escorts killed before flagship = 800 points!
      return 800;
    } else if (escortsTotal >= 1 && escortsKilledFirst >= 1) {
      // At least one escort killed = 300 points
      return 300;
    } else if (escortsTotal >= 1) {
      // Has escorts but flagship killed first = 200 points
      return 200;
    }
  }

  return basePoints;
}

function pickDivePattern() {
  const patterns = ["swoop", "loop", "zig"];
  return patterns[Math.floor(Math.random() * patterns.length)];
}

function spawnDive(enemy) {
  enemy.diving = true;
  const duration = clamp(1.9 - (state.wave - 1) * 0.06, 1.1, 1.9);
  const curve = (Math.random() > 0.5 ? 1 : -1) * (70 + Math.random() * 40);
  const pattern = pickDivePattern();

  const dive = {
    enemy,
    t: 0,
    duration,
    startX: enemy.x,
    startY: enemy.y,
    curve,
    pattern,
    done: false,
  };
  state.dives.push(dive);
  playFlyingSound(enemy);

  // Flagship escort mechanics - bosses bring red escorts!
  if (enemy.sprite === "boss") {
    const escorts = [];
    const redEnemies = state.enemies.filter(
      e => e.alive && !e.diving && e.sprite === "red" && e.escortForBoss === enemy.bossIndex
    );

    // Take up to 2 escorts
    const numEscorts = Math.min(2, redEnemies.length);
    for (let i = 0; i < numEscorts; i++) {
      const escort = redEnemies[i];
      escort.diving = true;
      escorts.push(escort);

      // Escort dives with slight offset from boss
      const escortDive = {
        enemy: escort,
        t: -0.15 * (i + 1), // Slight delay
        duration: duration + 0.1,
        startX: escort.x,
        startY: escort.y,
        curve: curve * (i === 0 ? 0.7 : -0.7), // Flanking pattern
        pattern,
        done: false,
      };
      state.dives.push(escortDive);
      playFlyingSound(escort);
    }

    // Create escort group for bonus scoring
    if (escorts.length > 0) {
      const group = { boss: enemy, escorts };
      enemy.escortGroup = group;
      escorts.forEach(e => e.escortGroup = group);
      state.activeDiveGroup = group;
    }
  }
}

// When escorts lose their flagship, they scatter
function scatterEscorts(group) {
  if (!group || !group.escorts) return;
  group.escorts.forEach(escort => {
    if (escort.alive && escort.diving) {
      // Escorts scatter - stop shooting and flee
      escort.scattering = true;
    }
  });
}

// Show floating bonus text for high scores
function showBonusText(x, y, points) {
  state.bonusTexts.push({
    x,
    y,
    text: points.toString(),
    color: "#ffff66",
    life: 1.2,
    vy: -40,
  });
}

// Show wave notification
function showWaveNotification(wave) {
  state.bonusTexts.push({
    x: W / 2,
    y: H / 2,
    text: `WAVE ${wave}`,
    color: "#00ff88",
    life: 2.0,
    vy: -20,
    isWave: true,
  });
  playWaveClearSound();
}

function playWaveClearSound() {
  if (!audio.ctx || audio.ctx.state !== "running") return;
  const now = audio.ctx.currentTime;
  // Triumphant wave clear jingle
  const notes = [392, 523, 659, 784, 880, 1047];
  notes.forEach((freq, i) => {
    const osc = audio.ctx.createOscillator();
    const amp = audio.ctx.createGain();
    osc.type = "square";
    osc.frequency.value = freq;
    amp.gain.setValueAtTime(0.0001, now + i * 0.07);
    amp.gain.exponentialRampToValueAtTime(0.12, now + i * 0.07 + 0.01);
    amp.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.07 + 0.12);
    osc.connect(amp);
    amp.connect(audio.sfxGain);
    osc.start(now + i * 0.07);
    osc.stop(now + i * 0.07 + 0.15);
  });
}

function updateBonusTexts(dt) {
  state.bonusTexts = state.bonusTexts.filter(t => t.life > 0);
  for (const text of state.bonusTexts) {
    text.y += text.vy * dt;
    text.life -= dt;
  }
}

function drawBonusTexts() {
  ctx.textAlign = "center";
  for (const t of state.bonusTexts) {
    const alpha = Math.min(1, t.life);
    if (t.isWave) {
      ctx.font = "16px 'Press Start 2P', monospace";
      ctx.shadowColor = "#00ff88";
      ctx.shadowBlur = 15;
      ctx.fillStyle = `rgba(100, 255, 150, ${alpha})`;
    } else {
      ctx.font = "10px 'Press Start 2P', monospace";
      ctx.shadowColor = "#ffcc00";
      ctx.shadowBlur = 8;
      ctx.fillStyle = `rgba(255, 255, 100, ${alpha})`;
    }
    ctx.fillText(t.text, t.x, t.y);
    ctx.shadowBlur = 0;
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function updateStars(dt) {
  for (const star of state.stars) {
    star.y += star.speed * dt;
    if (star.y > H) {
      star.y = -2;
      star.x = Math.random() * W;
      star.speed = 12 + Math.random() * 40;
      star.color = randomStarColor();
    }
  }
}

function updateFormation(dt) {
  const swaySpeed = 0.9;
  state.formation.sway += swaySpeed * dt * state.formation.dir;
  if (Math.abs(state.formation.sway) > 1.6) {
    state.formation.dir *= -1;
  }

  const maxOffset = 70;
  state.formation.offsetX = Math.sin(state.formation.sway) * maxOffset;

  state.enemies.forEach((enemy) => {
    if (!enemy.alive || enemy.diving) return;
    const bob = Math.sin(state.formation.sway + enemy.phase) * 3;
    enemy.x = enemy.baseX + state.formation.offsetX;
    enemy.y = enemy.baseY + bob;
  });
}

function updateDives(dt) {
  state.dives = state.dives.filter((dive) => !dive.done);
  for (const dive of state.dives) {
    dive.t += dt;
    const enemy = dive.enemy;
    if (!enemy.alive) {
      dive.done = true;
      enemy.diving = false;
      continue;
    }
    const u = Math.min(1, dive.t / dive.duration);
    let pathX = dive.startX;
    let pathY = dive.startY + u * 360;

    if (dive.pattern === "swoop") {
      pathX = dive.startX + Math.sin(u * Math.PI) * dive.curve;
    } else if (dive.pattern === "loop") {
      pathX = dive.startX + Math.sin(u * Math.PI * 2) * dive.curve;
    } else {
      pathX = dive.startX + Math.sin(u * Math.PI * 3) * dive.curve * 0.6;
    }

    enemy.x = pathX;
    enemy.y = pathY;

    if (dive.t > dive.duration) {
      enemy.baseX = clamp(enemy.x, 80, W - 80);
      enemy.baseY = clamp(120 + enemy.row * 40, 120, 320);
      enemy.y = enemy.baseY;
      enemy.x = enemy.baseX;
      enemy.diving = false;
      dive.done = true;
    }
  }
}

function updateExplosions(dt) {
  state.explosions = state.explosions.filter((exp) => exp.life > 0);
  for (const exp of state.explosions) {
    exp.life -= dt;
    exp.radius += dt * 60;
  }
}

function updatePowerups(dt) {
  state.powerups = state.powerups.filter((p) => p.y < H + 20 && p.life > 0);
  for (const p of state.powerups) {
    p.y += p.vy * dt;
    p.life -= dt;
  }
}

function updatePlayer(dt) {
  if (!state.player.alive || state.mode !== MODE_PLAY) return;
  const speed = state.player.speed;
  if (keys.has("ArrowLeft")) {
    state.player.x -= speed * dt;
  }
  if (keys.has("ArrowRight")) {
    state.player.x += speed * dt;
  }
  state.player.x = clamp(state.player.x, 30, W - 30);

  state.player.cooldown = Math.max(0, state.player.cooldown - dt);
  state.player.invuln = Math.max(0, state.player.invuln - dt);
  if (state.player.powerTimer > 0) {
    state.player.powerTimer = Math.max(0, state.player.powerTimer - dt);
    if (state.player.powerTimer === 0) {
      state.player.powerType = null;
    }
  }
  if (keys.has("Space") && state.player.cooldown <= 0) {
    const power = state.player.powerType;
    const cooldown = power === "rapid" ? 0.15 : power === "spread" ? 0.35 : 0.3;
    if (power === "spread") {
      const spreads = [-120, 0, 120];
      spreads.forEach((vx) => {
        state.bullets.push({
          x: state.player.x,
          y: state.player.y - 12,
          vx,
          vy: -340,
          r: 2,
        });
      });
    } else {
      state.bullets.push({
        x: state.player.x,
        y: state.player.y - 12,
        vx: 0,
        vy: -360,
        r: 2,
      });
    }
    state.player.cooldown = cooldown;
    playShootSound();
  }
}

function updateBullets(dt) {
  state.bullets = state.bullets.filter((b) => b.y > -10 && b.x > -10 && b.x < W + 10);
  state.enemyBullets = state.enemyBullets.filter((b) => b.y < H + 20);
  for (const bullet of state.bullets) {
    bullet.y += bullet.vy * dt;
    bullet.x += (bullet.vx || 0) * dt;
  }
  for (const bullet of state.enemyBullets) {
    bullet.y += bullet.vy * dt;
  }
}

function enemyFire(dt) {
  if (state.enemies.length === 0) return;
  state.nextDive -= dt;
  if (state.nextDive > 0) return;

  // Candidates for diving - not currently diving and not scattering
  const candidates = state.enemies.filter((e) => e.alive && !e.diving && !e.scattering);
  if (candidates.length > 0) {
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    const diveBoost = Math.min(0.2, (state.wave - 1) * 0.02);
    if (Math.random() < pick.diveChance + diveBoost) {
      spawnDive(pick);
    }

    // Scattering escorts don't shoot
    if (!pick.scattering && Math.random() < 0.85 + Math.min(0.1, (state.wave - 1) * 0.02)) {
      state.enemyBullets.push({
        x: pick.x,
        y: pick.y + 10,
        vy: 220 + (state.wave - 1) * 10,
        r: 2,
      });
      playEnemyShootSound();
    }
  }
  state.nextDive = clamp(1.1 - (state.wave - 1) * 0.07, 0.45, 1.1) + Math.random() * 0.4;
}

function hitTest(a, b) {
  return (
    Math.abs(a.x - b.x) < (a.w + b.r) * 0.5 &&
    Math.abs(a.y - b.y) < (a.h + b.r) * 0.5
  );
}

function resolveHits() {
  for (const bullet of state.bullets) {
    for (const enemy of state.enemies) {
      if (!enemy.alive) continue;
      if (hitTest(enemy, bullet)) {
        enemy.alive = false;
        bullet.y = -999;

        // Calculate score using authentic Galaxian scoring
        const points = calculateEnemyScore(enemy);
        updateScore(points);

        // Show bonus points for high-value kills
        if (points >= 200) {
          showBonusText(enemy.x, enemy.y, points);
        }

        // If flagship killed, scatter escorts
        if (enemy.sprite === "boss" && enemy.escortGroup) {
          scatterEscorts(enemy.escortGroup);
        }

        enemy.diving = false;
        playEnemyHitSound(enemy.sprite === "boss");
        state.explosions.push({
          x: enemy.x,
          y: enemy.y,
          life: enemy.sprite === "boss" ? 0.5 : 0.35,
          radius: enemy.sprite === "boss" ? 8 : 4,
        });
        if (state.mode === MODE_PLAY && Math.random() < 0.12) {
          spawnPowerup(enemy.x, enemy.y);
        }
      }
    }
  }

  if (state.player.alive && state.player.invuln <= 0) {
    for (const bullet of state.enemyBullets) {
      if (Math.abs(state.player.x - bullet.x) < 10 && Math.abs(state.player.y - bullet.y) < 12) {
        bullet.y = H + 40;
        if (state.player.powerType === "shield") {
          state.player.powerType = null;
          state.player.powerTimer = 0;
          playTone({ freq: 520, duration: 0.12, gain: 0.15, sweep: 880 });
        } else {
          killPlayer();
        }
        break;
      }
    }
  }
}

function killPlayer() {
  state.lives -= 1;
  state.player.alive = false;
  state.player.invuln = 1.2;
  playPlayerDeathSound();
  state.explosions.push({
    x: state.player.x,
    y: state.player.y,
    life: 0.5,
    radius: 6,
  });
  resetHUD();
  setTimeout(() => {
    if (state.lives <= 0) {
      state.mode = MODE_GAMEOVER;
    } else {
      state.player.alive = true;
      state.player.x = W * 0.5;
    }
  }, 800);
}

function drawStars() {
  // Deep space background with subtle gradient
  const gradient = ctx.createLinearGradient(0, 0, 0, H);
  gradient.addColorStop(0, "#000005");
  gradient.addColorStop(0.5, "#020208");
  gradient.addColorStop(1, "#000003");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, W, H);

  for (const star of state.stars) {
    const size = star.speed > 40 ? 2.5 : star.speed > 25 ? 1.5 : 1;
    // Add subtle glow to brighter stars
    if (size > 1.5) {
      ctx.fillStyle = star.color + "40";
      ctx.beginPath();
      ctx.arc(star.x, star.y, size + 1, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = star.color;
    ctx.fillRect(Math.floor(star.x), Math.floor(star.y), size, size);
  }
}

function drawPlayer() {
  if (!state.player.alive) return;
  const { x, y } = state.player;

  // Flash when invulnerable
  if (state.player.invuln > 0 && Math.floor(state.player.invuln * 10) % 2 === 0) {
    return;
  }

  drawSpriteFromSheet(SPRITE_DEFS.player[0], x, y, 2);

  if (state.player.powerType === "shield") {
    ctx.strokeStyle = "rgba(120, 200, 255, 0.8)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 20, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 1;
  }
}

function drawEnemies() {
  for (const enemy of state.enemies) {
    if (!enemy.alive) continue;
    drawAnimatedSprite(enemy.sprite, enemy.x, enemy.y, 2);
  }
}

function drawBullets() {
  for (const bullet of state.bullets) {
    // Bullet trail glow
    const gradient = ctx.createLinearGradient(bullet.x, bullet.y - 2, bullet.x, bullet.y + 16);
    gradient.addColorStop(0, "rgba(255, 255, 100, 0.8)");
    gradient.addColorStop(0.3, "rgba(255, 200, 50, 0.4)");
    gradient.addColorStop(1, "rgba(255, 150, 0, 0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(bullet.x - 3, bullet.y - 2, 6, 18);

    if (spritesLoaded) {
      drawSpriteFromSheet(SPRITE_DEFS.playerBullet, bullet.x, bullet.y, 2);
    } else {
      ctx.fillStyle = "#ffe96b";
      ctx.fillRect(Math.round(bullet.x - 2), Math.round(bullet.y - 6), 4, 10);
    }
  }
  for (const bullet of state.enemyBullets) {
    // Enemy bullet glow
    ctx.fillStyle = "rgba(255, 100, 100, 0.3)";
    ctx.beginPath();
    ctx.arc(bullet.x, bullet.y, 6, 0, Math.PI * 2);
    ctx.fill();

    if (spritesLoaded) {
      drawSpriteFromSheet(SPRITE_DEFS.enemyBullet, bullet.x, bullet.y, 2);
    } else {
      ctx.fillStyle = "#ff8888";
      ctx.fillRect(Math.round(bullet.x - 2), Math.round(bullet.y - 6), 4, 10);
    }
  }
}

function drawExplosions() {
  for (const exp of state.explosions) {
    const progress = 1 - exp.life / 0.5;
    const alpha = Math.max(0, 1 - progress * 0.8);

    // Multi-color explosion effect
    const colors = [
      `rgba(255, 255, 255, ${alpha})`,
      `rgba(255, 220, 100, ${alpha * 0.9})`,
      `rgba(255, 140, 50, ${alpha * 0.7})`,
      `rgba(255, 60, 60, ${alpha * 0.5})`,
    ];

    // Central flash
    if (progress < 0.3) {
      const flashAlpha = (0.3 - progress) / 0.3;
      ctx.fillStyle = `rgba(255, 255, 255, ${flashAlpha * 0.8})`;
      ctx.beginPath();
      ctx.arc(exp.x, exp.y, exp.radius * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Expanding star burst
    ctx.lineWidth = 2;
    for (let ring = 0; ring < 3; ring++) {
      const ringProgress = Math.max(0, progress - ring * 0.1);
      const ringAlpha = Math.max(0, alpha * (1 - ring * 0.3));
      ctx.strokeStyle = colors[ring];
      ctx.beginPath();
      const numPoints = 8 + ring * 4;
      for (let i = 0; i < numPoints; i += 1) {
        const ang = (i / numPoints) * Math.PI * 2 + ring * 0.2 + progress * 2;
        const r1 = exp.radius * (0.2 + ringProgress * 0.3);
        const r2 = exp.radius * (0.8 + ring * 0.4);
        ctx.moveTo(exp.x + Math.cos(ang) * r1, exp.y + Math.sin(ang) * r1);
        ctx.lineTo(exp.x + Math.cos(ang) * r2, exp.y + Math.sin(ang) * r2);
      }
      ctx.stroke();
    }

    // Particle sparks
    ctx.fillStyle = `rgba(255, 200, 100, ${alpha})`;
    for (let i = 0; i < 12; i++) {
      const ang = (i / 12) * Math.PI * 2 + exp.radius * 0.1;
      const dist = exp.radius * (0.6 + Math.sin(i * 1.5 + progress * 8) * 0.3);
      const size = 2 + Math.sin(i * 2) * 1;
      ctx.fillRect(
        exp.x + Math.cos(ang) * dist - size / 2,
        exp.y + Math.sin(ang) * dist - size / 2,
        size,
        size
      );
    }
    ctx.lineWidth = 1;
  }
}

function drawPowerups() {
  for (const p of state.powerups) {
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#111";
    ctx.font = "8px 'Press Start 2P', monospace";
    ctx.textAlign = "center";
    ctx.fillText(p.label, p.x, p.y + 3);
  }
}

function drawHUD() {
  ctx.fillStyle = "#cfd2d8";
  ctx.textAlign = "left";
  ctx.font = "10px 'Press Start 2P', monospace";
  ctx.fillText("1UP", 22, 20);
  ctx.textAlign = "right";
  ctx.fillText("HIGH SCORE", W - 22, 20);

  // Wave indicator
  ctx.textAlign = "center";
  ctx.fillStyle = "#ffce35";
  ctx.font = "8px 'Press Start 2P', monospace";
  ctx.fillText(`WAVE ${state.wave}`, W / 2, 20);

  ctx.font = "10px 'Press Start 2P', monospace";
  ctx.textAlign = "left";
  ctx.fillStyle = "#cfd2d8";
  ctx.fillText(`CREDIT ${state.credits.toString().padStart(2, "0")}`, 12, H - 10);

  if (state.player.powerType) {
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffce35";
    ctx.fillText(`POWER ${state.player.powerType.toUpperCase()}`, W / 2, H - 10);
  }
}

function drawAttract() {
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = "center";

  // Rainbow-ish title like original arcade
  const titleY = H / 2 - 60;
  ctx.font = "24px 'Press Start 2P', monospace";

  // Glow behind title
  ctx.shadowColor = "#ffcc00";
  ctx.shadowBlur = 20;
  ctx.fillStyle = "#ffce35";
  ctx.fillText("GALAXIAN", W / 2, titleY);
  ctx.shadowBlur = 0;

  // Subtitle
  ctx.font = "8px 'Press Start 2P', monospace";
  ctx.fillStyle = "#8888ff";
  ctx.fillText("© 1979 NAMCO", W / 2, titleY + 20);

  // Score table
  ctx.font = "8px 'Press Start 2P', monospace";
  const tableY = H / 2 - 10;
  ctx.fillStyle = "#ffcc00";
  ctx.fillText("- SCORE TABLE -", W / 2, tableY);

  ctx.fillStyle = "#ffff00";
  ctx.fillText("FLAGSHIP   150 PTS", W / 2, tableY + 20);
  ctx.fillStyle = "#ff4444";
  ctx.fillText("RED        80 PTS", W / 2, tableY + 35);
  ctx.fillStyle = "#cc66ff";
  ctx.fillText("PURPLE     50 PTS", W / 2, tableY + 50);
  ctx.fillStyle = "#6688ff";
  ctx.fillText("BLUE       30 PTS", W / 2, tableY + 65);

  ctx.font = "10px 'Press Start 2P', monospace";
  ctx.fillStyle = "#00ff00";
  ctx.fillText("PUSH C TO INSERT COIN", W / 2, H / 2 + 100);

  ctx.fillStyle = state.blink > 0.5 ? "#ffffff" : "#666666";
  ctx.fillText("PUSH SPACE TO START", W / 2, H / 2 + 120);

  // Touch instructions
  ctx.font = "7px 'Press Start 2P', monospace";
  ctx.fillStyle = "#888888";
  ctx.fillText("TOUCH: TAP TO START/COIN", W / 2, H / 2 + 145);
  ctx.fillText("DRAG TO MOVE & SHOOT", W / 2, H / 2 + 158);

  // Credit display
  ctx.font = "10px 'Press Start 2P', monospace";
  ctx.fillStyle = state.credits > 0 ? "#00ff00" : "#ff6666";
  ctx.fillText(`CREDIT ${state.credits}`, W / 2, H / 2 + 180);
}

function drawGameOver() {
  ctx.fillStyle = "rgba(0,0,0,0.7)";
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = "center";

  // Game Over with glow
  ctx.shadowColor = "#ff0000";
  ctx.shadowBlur = 15;
  ctx.fillStyle = "#ff4444";
  ctx.font = "20px 'Press Start 2P', monospace";
  ctx.fillText("GAME OVER", W / 2, H / 2 - 40);
  ctx.shadowBlur = 0;

  // Final score display
  ctx.font = "10px 'Press Start 2P', monospace";
  ctx.fillStyle = "#ffffff";
  ctx.fillText("YOUR SCORE", W / 2, H / 2);
  ctx.fillStyle = "#ffce35";
  ctx.font = "16px 'Press Start 2P', monospace";
  ctx.fillText(state.score.toString().padStart(5, "0"), W / 2, H / 2 + 25);

  // High score
  if (state.score >= state.highScore && state.score > 0) {
    ctx.fillStyle = state.blink > 0.5 ? "#00ff00" : "#00aa00";
    ctx.font = "8px 'Press Start 2P', monospace";
    ctx.fillText("NEW HIGH SCORE!", W / 2, H / 2 + 45);
  }

  ctx.font = "10px 'Press Start 2P', monospace";
  ctx.fillStyle = "#00ff00";
  ctx.fillText("PUSH C TO INSERT COIN", W / 2, H / 2 + 80);

  ctx.fillStyle = state.credits > 0 ? "#ffffff" : "#666666";
  ctx.fillText("PUSH SPACE TO CONTINUE", W / 2, H / 2 + 100);

  ctx.fillStyle = state.credits > 0 ? "#00ff00" : "#ff6666";
  ctx.fillText(`CREDIT ${state.credits}`, W / 2, H / 2 + 130);
}

function updateGame(dt) {
  state.blink += dt;
  if (state.blink > 1) state.blink = 0;

  // Update animation frame (cycle every 0.15 seconds for smoother wing flapping)
  state.animTimer += dt;
  if (state.animTimer > 0.15) {
    state.animTimer = 0;
    state.animFrame = (state.animFrame + 1) % 4;
  }

  updateStars(dt);
  updateFormation(dt);
  updateDives(dt);
  updateExplosions(dt);
  updatePowerups(dt);
  updateBonusTexts(dt);

  if (state.mode === MODE_PLAY) {
    updatePlayer(dt);
    updateBullets(dt);
    enemyFire(dt);
    resolveHits();
    checkPowerupPickup();

    const aliveCount = state.enemies.filter((e) => e.alive).length;
    if (aliveCount === 0) {
      state.wave += 1;
      showWaveNotification(state.wave);
      const oldLives = state.lives;
      state.lives = Math.min(4, state.lives + 1);
      if (state.lives > oldLives) {
        playExtraLifeSound();
      }
      resetHUD();
      makeFormation();
    }
  }
}

function drawScanlines() {
  // CRT scanline effect for authentic arcade look
  ctx.fillStyle = "rgba(0, 0, 0, 0.08)";
  for (let y = 0; y < H; y += 3) {
    ctx.fillRect(0, y, W, 1);
  }

  // Subtle vignette effect
  const vignette = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.8);
  vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
  vignette.addColorStop(1, "rgba(0, 0, 0, 0.3)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, W, H);
}

function drawGlowEffect(x, y, color, radius) {
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, color + "60");
  gradient.addColorStop(0.5, color + "20");
  gradient.addColorStop(1, color + "00");
  ctx.fillStyle = gradient;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}

function drawGame() {
  drawStars();

  // Add glow behind enemies for RGB arcade effect
  for (const enemy of state.enemies) {
    if (!enemy.alive) continue;
    let glowColor;
    switch (enemy.sprite) {
      case "boss": glowColor = "#ffcc00"; break;
      case "red": glowColor = "#ff4444"; break;
      case "purple": glowColor = "#aa44ff"; break;
      default: glowColor = "#4488ff";
    }
    drawGlowEffect(enemy.x, enemy.y, glowColor, 20);
  }

  // Player glow
  if (state.player.alive && state.player.invuln <= 0) {
    drawGlowEffect(state.player.x, state.player.y, "#00ff88", 25);
  }

  drawEnemies();
  drawPlayer();
  drawBullets();
  drawExplosions();
  drawPowerups();
  drawBonusTexts();

  // Add scanlines on top
  drawScanlines();

  drawHUD();

  if (state.mode === MODE_ATTRACT) {
    drawAttract();
  } else if (state.mode === MODE_GAMEOVER) {
    drawGameOver();
  }
}

function loop(timestamp) {
  const dt = Math.min(0.02, (timestamp - lastTime) / 1000 || 0);
  lastTime = timestamp;
  updateGame(dt);
  drawGame();
  requestAnimationFrame(loop);
}

function startGame() {
  if (state.credits <= 0) return;
  state.credits -= 1;
  state.score = 0;
  state.lives = 3;
  state.wave = 1;
  state.player.alive = true;
  state.player.x = W * 0.5;
  state.player.powerType = null;
  state.player.powerTimer = 0;
  state.bullets = [];
  state.enemyBullets = [];
  state.dives = [];
  state.powerups = [];
  state.bonusTexts = [];
  state.activeDiveGroup = null;
  state.mode = MODE_PLAY;
  playGameStartTune();
  updateDroneSpeed();
  updateScore(0);
  resetHUD();
  makeFormation();
}

function insertCoin() {
  state.credits = Math.min(99, state.credits + 1);
  playCreditSound();
}

function spawnPowerup(x, y) {
  const types = [
    { type: "rapid", label: "R", color: "#ffd25a", duration: 7 },
    { type: "spread", label: "S", color: "#ff8de3", duration: 8 },
    { type: "shield", label: "B", color: "#7ad5ff", duration: 6 },
  ];
  const pick = types[Math.floor(Math.random() * types.length)];
  state.powerups.push({
    x,
    y,
    vy: 60,
    life: 7,
    ...pick,
  });
}

function playPowerupSound() {
  if (!audio.ctx || audio.ctx.state !== "running") return;
  const now = audio.ctx.currentTime;
  // Quick ascending blip for powerup pickup
  const notes = [660, 880, 1100];
  notes.forEach((freq, i) => {
    const osc = audio.ctx.createOscillator();
    const amp = audio.ctx.createGain();
    osc.type = "square";
    osc.frequency.value = freq;
    amp.gain.setValueAtTime(0.12, now + i * 0.04);
    amp.gain.exponentialRampToValueAtTime(0.001, now + i * 0.04 + 0.06);
    osc.connect(amp);
    amp.connect(audio.sfxGain);
    osc.start(now + i * 0.04);
    osc.stop(now + i * 0.04 + 0.08);
  });
}

function checkPowerupPickup() {
  if (!state.player.alive) return;
  for (const p of state.powerups) {
    if (Math.abs(state.player.x - p.x) < 14 && Math.abs(state.player.y - p.y) < 14) {
      state.player.powerType = p.type;
      state.player.powerTimer = p.duration;
      p.life = 0;
      playPowerupSound();
      break;
    }
  }
}

window.addEventListener("keydown", (event) => {
  unlockAudio();
  if (["ArrowLeft", "ArrowRight", "Space"].includes(event.code)) {
    event.preventDefault();
  }
  const key = event.code === "Space" ? "Space" : event.key;
  keys.add(key);

  if (key.toLowerCase() === "c") {
    insertCoin();
  }
  if (key === "Space") {
    if (state.mode === MODE_ATTRACT || state.mode === MODE_GAMEOVER) {
      startGame();
    }
  }
});

window.addEventListener("keyup", (event) => {
  const key = event.code === "Space" ? "Space" : event.key;
  keys.delete(key);
});

canvas.addEventListener("pointerdown", unlockAudio);
window.addEventListener("touchstart", unlockAudio, { passive: true });

// Mobile touch controls
let touchStartX = null;
let touchActive = false;

canvas.addEventListener("touchstart", (e) => {
  e.preventDefault();
  unlockAudio();
  touchActive = true;
  const touch = e.touches[0];
  touchStartX = touch.clientX;

  // Tap to start game or insert coin
  if (state.mode === MODE_ATTRACT || state.mode === MODE_GAMEOVER) {
    if (state.credits <= 0) {
      insertCoin();
    } else {
      startGame();
    }
  }
}, { passive: false });

canvas.addEventListener("touchmove", (e) => {
  e.preventDefault();
  if (!touchActive || state.mode !== MODE_PLAY) return;
  const touch = e.touches[0];
  const rect = canvas.getBoundingClientRect();
  const canvasX = (touch.clientX - rect.left) / rect.width * W;

  // Move player towards touch position
  if (canvasX < state.player.x - 20) {
    keys.add("ArrowLeft");
    keys.delete("ArrowRight");
  } else if (canvasX > state.player.x + 20) {
    keys.add("ArrowRight");
    keys.delete("ArrowLeft");
  } else {
    keys.delete("ArrowLeft");
    keys.delete("ArrowRight");
  }

  // Auto-fire while dragging
  keys.add("Space");
}, { passive: false });

canvas.addEventListener("touchend", (e) => {
  touchActive = false;
  keys.delete("ArrowLeft");
  keys.delete("ArrowRight");

  // Auto-fire while touching for mobile
  if (state.mode === MODE_PLAY && state.player.alive) {
    keys.add("Space");
    setTimeout(() => keys.delete("Space"), 50);
  }
});

initStars();
updateScore(0);
resetHUD();
makeFormation();
requestAnimationFrame(loop);

