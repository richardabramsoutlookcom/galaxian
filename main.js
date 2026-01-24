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

// Sprite sheet loading
const spriteSheet = new Image();
spriteSheet.src = "assets/sprites.png";
let spritesLoaded = false;
spriteSheet.onload = () => { spritesLoaded = true; };

// Sprite definitions from the Galaxian sprite sheet (x, y, width, height)
// The sprite sheet is 205x192 pixels
// Layout: enemies in top rows (boss yellow, red, purple, blue), player ship below, then fonts
const SPRITE_DEFS = {
  // Boss/Flagship sprites (yellow) - top row, animation frames with wings up/down
  boss: [
    { x: 0, y: 0, w: 16, h: 16 },    // wings up
    { x: 16, y: 0, w: 16, h: 16 },   // wings down
  ],
  // Red enemies - second row
  red: [
    { x: 0, y: 16, w: 16, h: 16 },
    { x: 16, y: 16, w: 16, h: 16 },
  ],
  // Purple enemies - third row
  purple: [
    { x: 0, y: 32, w: 16, h: 16 },
    { x: 16, y: 32, w: 16, h: 16 },
  ],
  // Blue enemies - fourth row
  blue: [
    { x: 0, y: 48, w: 16, h: 16 },
    { x: 16, y: 48, w: 16, h: 16 },
  ],
  // Player ship (Galaxip) - appears after enemy rows
  player: [
    { x: 64, y: 48, w: 16, h: 16 },
  ],
  // Bullets - small sprites
  playerBullet: { x: 110, y: 48, w: 4, h: 8 },
  enemyBullet: { x: 144, y: 48, w: 4, h: 8 },
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
};

function initAudio() {
  if (audio.ctx) return;
  audio.ctx = new (window.AudioContext || window.webkitAudioContext)();
  audio.master = audio.ctx.createGain();
  audio.master.gain.value = 0.12;
  audio.musicGain = audio.ctx.createGain();
  audio.sfxGain = audio.ctx.createGain();
  audio.musicGain.gain.value = 0.06;
  audio.sfxGain.gain.value = 0.2;
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

function startMusic() {
  if (!audio.ctx || audio.musicTimer) return;
  const lead = [523, 0, 659, 0, 784, 659, 587, 659, 784, 0, 880, 784, 659, 587, 523, 0];
  const bass = [131, 0, 147, 0, 165, 0, 147, 0];
  audio.musicTimer = setInterval(() => {
    if (state.mode === MODE_GAMEOVER) return;
    const step = audio.musicStep;
    const leadNote = lead[step % lead.length];
    const bassNote = bass[step % bass.length];
    const duration = state.mode === MODE_PLAY ? 0.14 : 0.18;
    if (leadNote > 0) {
      playTone({ freq: leadNote, duration, gain: 0.07, type: "square", channel: "music" });
    }
    if (bassNote > 0 && step % 2 === 0) {
      playTone({ freq: bassNote, duration: 0.2, gain: 0.05, type: "triangle", channel: "music" });
    }
    audio.musicStep += 1;
  }, 130);
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
function drawAnimatedSprite(spriteType, x, y, scale = 2) {
  if (!spritesLoaded) return;
  const frames = SPRITE_DEFS[spriteType];
  if (!frames || frames.length === 0) return;
  const frameIndex = state.animFrame % frames.length;
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
  // Authentic Galaxian formation layout
  const rows = [
    { count: 2, points: 150, diveChance: 0.42, sprite: "boss" },    // 2 flagships
    { count: 6, points: 80, diveChance: 0.36, sprite: "red" },      // 6 red
    { count: 8, points: 50, diveChance: 0.32, sprite: "purple" },   // 8 purple
    { count: 10, points: 30, diveChance: 0.28, sprite: "blue" },    // 10 blue
    { count: 10, points: 30, diveChance: 0.28, sprite: "blue" },    // 10 blue
  ];

  state.enemies = [];
  const baseSpacing = 36;
  let y = 100;

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
          baseX: bossPositions[i],
          baseY: y,
          x: bossPositions[i],
          y,
          w: 32,
          h: 32,
          row: rowIndex,
          points: row.points,
          diveChance: row.diveChance,
          alive: true,
          diving: false,
          sprite: row.sprite,
          phase: Math.random() * Math.PI * 2,
        });
      }
    } else {
      for (let i = 0; i < row.count; i += 1) {
        state.enemies.push({
          baseX: startX + i * spacing,
          baseY: y,
          x: startX + i * spacing,
          y,
          w: 32,
          h: 32,
          row: rowIndex,
          points: row.points,
          diveChance: row.diveChance,
          alive: true,
          diving: false,
          sprite: row.sprite,
          phase: Math.random() * Math.PI * 2,
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

function pickDivePattern() {
  const patterns = ["swoop", "loop", "zig"];
  return patterns[Math.floor(Math.random() * patterns.length)];
}

function spawnDive(enemy) {
  enemy.diving = true;
  const duration = clamp(1.9 - (state.wave - 1) * 0.06, 1.1, 1.9);
  const dive = {
    enemy,
    t: 0,
    duration,
    startX: enemy.x,
    startY: enemy.y,
    curve: (Math.random() > 0.5 ? 1 : -1) * (70 + Math.random() * 40),
    pattern: pickDivePattern(),
    done: false,
  };
  state.dives.push(dive);
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
    playTone({ freq: 880, duration: 0.12, gain: 0.12, sweep: 520 });
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
  const candidates = state.enemies.filter((e) => e.alive && !e.diving);
  if (candidates.length > 0) {
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    const diveBoost = Math.min(0.2, (state.wave - 1) * 0.02);
    if (Math.random() < pick.diveChance + diveBoost) {
      spawnDive(pick);
    }
    if (Math.random() < 0.85 + Math.min(0.1, (state.wave - 1) * 0.02)) {
      state.enemyBullets.push({
        x: pick.x,
        y: pick.y + 10,
        vy: 220 + (state.wave - 1) * 10,
        r: 2,
      });
      playTone({ freq: 330, duration: 0.08, gain: 0.09, sweep: 220 });
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
        enemy.diving = false;
        bullet.y = -999;
        updateScore(enemy.points);
        playNoise(0.12, 0.2);
        state.explosions.push({
          x: enemy.x,
          y: enemy.y,
          life: 0.35,
          radius: 4,
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
          playTone({ freq: 520, duration: 0.12, gain: 0.12, sweep: 880 });
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
  playNoise(0.2, 0.3);
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
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  for (const star of state.stars) {
    ctx.fillStyle = star.color;
    const size = star.speed > 40 ? 2 : 1;
    ctx.fillRect(star.x, star.y, size, size);
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
    if (spritesLoaded) {
      drawSpriteFromSheet(SPRITE_DEFS.playerBullet, bullet.x, bullet.y, 2);
    } else {
      ctx.fillStyle = "#ffe96b";
      ctx.fillRect(Math.round(bullet.x - 1), Math.round(bullet.y - 6), 2, 8);
    }
  }
  for (const bullet of state.enemyBullets) {
    if (spritesLoaded) {
      drawSpriteFromSheet(SPRITE_DEFS.enemyBullet, bullet.x, bullet.y, 2);
    } else {
      ctx.fillStyle = "#e7e7e7";
      ctx.fillRect(Math.round(bullet.x - 1), Math.round(bullet.y - 6), 2, 8);
    }
  }
}

function drawExplosions() {
  for (const exp of state.explosions) {
    const alpha = Math.max(0, exp.life / 0.5);
    ctx.strokeStyle = `rgba(255, 206, 53, ${alpha})`;
    ctx.beginPath();
    for (let i = 0; i < 8; i += 1) {
      const ang = (i / 8) * Math.PI * 2;
      const r1 = exp.radius * 0.4;
      const r2 = exp.radius;
      ctx.moveTo(exp.x + Math.cos(ang) * r1, exp.y + Math.sin(ang) * r1);
      ctx.lineTo(exp.x + Math.cos(ang) * r2, exp.y + Math.sin(ang) * r2);
    }
    ctx.stroke();
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
  ctx.fillText("2UP", W - 22, 20);

  ctx.textAlign = "left";
  ctx.fillText(`CREDIT ${state.credits.toString().padStart(2, "0")}`, 12, H - 10);
  if (state.player.powerType) {
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffce35";
    ctx.fillText(`POWER ${state.player.powerType.toUpperCase()}`, W / 2, H - 10);
  }
}

function drawAttract() {
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = "center";
  ctx.fillStyle = "#ffce35";
  ctx.font = "18px 'Press Start 2P', monospace";
  ctx.fillText("GALAXIAN", W / 2, H / 2 - 40);
  ctx.font = "10px 'Press Start 2P', monospace";
  ctx.fillStyle = "#ffffff";
  ctx.fillText("1UP START", W / 2, H / 2);
  ctx.fillStyle = state.blink > 0.5 ? "#ffffff" : "#8e8e8e";
  ctx.fillText("INSERT COIN", W / 2, H / 2 + 24);
  ctx.fillStyle = state.credits > 0 ? "#ffffff" : "#8e8e8e";
  ctx.fillText("PRESS SPACE", W / 2, H / 2 + 44);
}

function drawGameOver() {
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#ffce35";
  ctx.textAlign = "center";
  ctx.font = "18px 'Press Start 2P', monospace";
  ctx.fillText("GAME OVER", W / 2, H / 2 - 10);
  ctx.fillStyle = state.credits > 0 ? "#ffffff" : "#8e8e8e";
  ctx.font = "10px 'Press Start 2P', monospace";
  ctx.fillText("PRESS SPACE", W / 2, H / 2 + 18);
  ctx.fillStyle = state.blink > 0.5 ? "#ffffff" : "#8e8e8e";
  ctx.fillText("INSERT COIN", W / 2, H / 2 + 36);
}

function updateGame(dt) {
  state.blink += dt;
  if (state.blink > 1) state.blink = 0;

  // Update animation frame (toggle every 0.3 seconds for wing flapping)
  state.animTimer += dt;
  if (state.animTimer > 0.3) {
    state.animTimer = 0;
    state.animFrame = (state.animFrame + 1) % 2;
  }

  updateStars(dt);
  updateFormation(dt);
  updateDives(dt);
  updateExplosions(dt);
  updatePowerups(dt);

  if (state.mode === MODE_PLAY) {
    updatePlayer(dt);
    updateBullets(dt);
    enemyFire(dt);
    resolveHits();
    checkPowerupPickup();

    const aliveCount = state.enemies.filter((e) => e.alive).length;
    if (aliveCount === 0) {
      state.wave += 1;
      state.lives = Math.min(4, state.lives + 1);
      resetHUD();
      makeFormation();
    }
  }
}

function drawGame() {
  drawStars();
  drawEnemies();
  drawPlayer();
  drawBullets();
  drawExplosions();
  drawPowerups();
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
  state.mode = MODE_PLAY;
  updateScore(0);
  resetHUD();
  makeFormation();
}

function insertCoin() {
  state.credits = Math.min(99, state.credits + 1);
  playTone({ freq: 660, duration: 0.1, gain: 0.12, sweep: 990 });
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

function checkPowerupPickup() {
  if (!state.player.alive) return;
  for (const p of state.powerups) {
    if (Math.abs(state.player.x - p.x) < 14 && Math.abs(state.player.y - p.y) < 14) {
      state.player.powerType = p.type;
      state.player.powerTimer = p.duration;
      p.life = 0;
      playTone({ freq: 990, duration: 0.12, gain: 0.12, sweep: 1320 });
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

initStars();
updateScore(0);
resetHUD();
makeFormation();
requestAnimationFrame(loop);

