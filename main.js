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

const state = {
  score: 0,
  highScore: 0,
  lives: 3,
  wave: 1,
  credits: 0,
  mode: MODE_ATTRACT,
  blink: 0,
  player: {
    x: W * 0.5,
    y: H - 70,
    w: 18,
    h: 18,
    speed: 210,
    cooldown: 0,
    alive: true,
    invuln: 0,
  },
  bullets: [],
  enemyBullets: [],
  enemies: [],
  dives: [],
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
  unlocked: false,
  musicTimer: null,
  musicStep: 0,
};

function initAudio() {
  if (audio.ctx) return;
  audio.ctx = new (window.AudioContext || window.webkitAudioContext)();
  audio.master = audio.ctx.createGain();
  audio.master.gain.value = 0.08;
  audio.master.connect(audio.ctx.destination);
}

function playTone({ freq, duration, type = "square", gain = 0.12, sweep }) {
  if (!audio.ctx) return;
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
  amp.connect(audio.master);
  osc.start(now);
  osc.stop(now + duration + 0.02);
}

function playNoise(duration, gain) {
  if (!audio.ctx) return;
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
  amp.connect(audio.master);
  noise.start(now);
}

function startMusic() {
  if (!audio.ctx || audio.musicTimer) return;
  const melody = [523, 659, 783, 659, 587, 659, 783, 880];
  audio.musicTimer = setInterval(() => {
    if (state.mode === MODE_GAMEOVER) return;
    const note = melody[audio.musicStep % melody.length];
    const duration = state.mode === MODE_PLAY ? 0.16 : 0.22;
    playTone({ freq: note, duration, gain: 0.05, type: "square" });
    audio.musicStep += 1;
  }, 140);
}

function unlockAudio() {
  if (audio.unlocked) return;
  initAudio();
  audio.ctx.resume();
  audio.unlocked = true;
  startMusic();
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
  const rows = [
    { count: 1, color: "#ffe04e", points: 150, diveChance: 0.42 },
    { count: 4, color: "#ff3f3f", points: 80, diveChance: 0.36 },
    { count: 6, color: "#a749ff", points: 50, diveChance: 0.32 },
    { count: 6, color: "#35d4ff", points: 30, diveChance: 0.28 },
    { count: 6, color: "#35d4ff", points: 30, diveChance: 0.28 },
  ];

  state.enemies = [];
  let y = 120;
  rows.forEach((row, rowIndex) => {
    const spacing = 40;
    const totalWidth = (row.count - 1) * spacing;
    const startX = W * 0.5 - totalWidth / 2;
    for (let i = 0; i < row.count; i += 1) {
      state.enemies.push({
        baseX: startX + i * spacing,
        baseY: y,
        x: startX + i * spacing,
        y,
        w: 22,
        h: 18,
        row: rowIndex,
        color: row.color,
        points: row.points,
        diveChance: row.diveChance,
        alive: true,
        diving: false,
        phase: Math.random() * Math.PI * 2,
      });
    }
    y += 40;
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
  const dive = {
    enemy,
    t: 0,
    duration: 1.9,
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
  if (keys.has("Space") && state.player.cooldown <= 0) {
    state.bullets.push({
      x: state.player.x,
      y: state.player.y - 12,
      vy: -360,
      r: 2,
    });
    state.player.cooldown = 0.3;
    playTone({ freq: 880, duration: 0.12, gain: 0.08, sweep: 520 });
  }
}

function updateBullets(dt) {
  state.bullets = state.bullets.filter((b) => b.y > -10);
  state.enemyBullets = state.enemyBullets.filter((b) => b.y < H + 20);
  for (const bullet of state.bullets) {
    bullet.y += bullet.vy * dt;
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
    if (Math.random() < pick.diveChance) {
      spawnDive(pick);
    }
    if (Math.random() < 0.85) {
      state.enemyBullets.push({
        x: pick.x,
        y: pick.y + 10,
        vy: 220,
        r: 2,
      });
      playTone({ freq: 330, duration: 0.08, gain: 0.05, sweep: 220 });
    }
  }
  state.nextDive = 0.9 + Math.random() * 1.1;
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
        playNoise(0.12, 0.12);
      }
    }
  }

  if (state.player.alive && state.player.invuln <= 0) {
    for (const bullet of state.enemyBullets) {
      if (Math.abs(state.player.x - bullet.x) < 10 && Math.abs(state.player.y - bullet.y) < 12) {
        bullet.y = H + 40;
        killPlayer();
        break;
      }
    }
  }
}

function killPlayer() {
  state.lives -= 1;
  state.player.alive = false;
  state.player.invuln = 1.2;
  playNoise(0.2, 0.2);
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
    ctx.fillRect(star.x, star.y, 2, 2);
  }
}

function drawPlayer() {
  if (!state.player.alive) return;
  const { x, y } = state.player;
  ctx.fillStyle = "#ffce35";
  ctx.beginPath();
  ctx.moveTo(x, y - 10);
  ctx.lineTo(x + 8, y + 8);
  ctx.lineTo(x - 8, y + 8);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#2e7bff";
  ctx.fillRect(x - 4, y - 2, 8, 6);
  ctx.fillStyle = "#ff3f3f";
  ctx.fillRect(x - 2, y + 6, 4, 6);
}

function drawEnemies() {
  for (const enemy of state.enemies) {
    if (!enemy.alive) continue;
    ctx.fillStyle = enemy.color;
    ctx.beginPath();
    ctx.moveTo(enemy.x, enemy.y - 8);
    ctx.lineTo(enemy.x + 10, enemy.y);
    ctx.lineTo(enemy.x + 8, enemy.y + 8);
    ctx.lineTo(enemy.x, enemy.y + 4);
    ctx.lineTo(enemy.x - 8, enemy.y + 8);
    ctx.lineTo(enemy.x - 10, enemy.y);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#1b1b1b";
    ctx.fillRect(enemy.x - 2, enemy.y, 4, 4);
  }
}

function drawBullets() {
  ctx.fillStyle = "#ffe96b";
  for (const bullet of state.bullets) {
    ctx.fillRect(bullet.x - 1, bullet.y - 6, 2, 8);
  }
  ctx.fillStyle = "#e7e7e7";
  for (const bullet of state.enemyBullets) {
    ctx.fillRect(bullet.x - 1, bullet.y - 6, 2, 8);
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

  updateStars(dt);
  updateFormation(dt);
  updateDives(dt);

  if (state.mode === MODE_PLAY) {
    updatePlayer(dt);
    updateBullets(dt);
    enemyFire(dt);
    resolveHits();

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
  state.bullets = [];
  state.enemyBullets = [];
  state.dives = [];
  state.mode = MODE_PLAY;
  updateScore(0);
  resetHUD();
  makeFormation();
}

function insertCoin() {
  state.credits = Math.min(99, state.credits + 1);
  playTone({ freq: 660, duration: 0.1, gain: 0.08, sweep: 990 });
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

initStars();
updateScore(0);
resetHUD();
makeFormation();
requestAnimationFrame(loop);
