const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const hpText = document.getElementById("hpText");
const scoreText = document.getElementById("scoreText");
const comboText = document.getElementById("comboText");
const powerText = document.getElementById("powerText");
const audioToggle = document.getElementById("audioToggle");
const audioHint = document.getElementById("audioHint");
const controlButtons = Array.from(document.querySelectorAll(".control-button"));

const WORLD_WIDTH = 3600;
const WORLD_HEIGHT = 540;
const GROUND_Y = 468;
const GRAVITY = 0.45;

const keys = {};
const justPressed = {};

const palette = {
  sky: "#0b1f36",
  back: "#1e3d62",
  mid: "#5b87bb",
  metal: "#f3f8ff",
  glow: "#5dd6ff",
  warning: "#ffd166",
  enemy: "#ff7b72",
  boss: "#ff4d6d",
  bullet: "#d8f7ff",
  player: "#63c7ff",
  playerDark: "#1b84b8",
  ground: "#ffffff",
};

const audioState = {
  enabled: true,
  unlocked: false,
  ctx: null,
  master: null,
};

function setPressed(code, pressed) {
  keys[code] = pressed;
  if (pressed) {
    justPressed[code] = true;
  }
}

function ensureAudio() {
  if (!audioState.enabled) {
    return false;
  }

  if (!audioState.ctx) {
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) {
      audioHint.textContent = "이 브라우저는 Web Audio를 지원하지 않습니다.";
      return false;
    }
    audioState.ctx = new AudioCtor();
    audioState.master = audioState.ctx.createGain();
    audioState.master.gain.value = 1;
    audioState.master.connect(audioState.ctx.destination);
  }

  if (audioState.ctx.state === "suspended") {
    audioState.ctx.resume();
  }

  audioState.unlocked = true;
  audioHint.textContent = audioState.enabled ? "사운드 활성화됨" : "사운드 비활성화됨";
  return true;
}

function playTone(type, frequency, duration, volume, slide = 0) {
  if (!audioState.enabled || !ensureAudio()) {
    return;
  }

  const now = audioState.ctx.currentTime;
  const oscillator = audioState.ctx.createOscillator();
  const gain = audioState.ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, now);
  oscillator.frequency.linearRampToValueAtTime(Math.max(40, frequency + slide), now + duration);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(volume, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  oscillator.connect(gain);
  gain.connect(audioState.master);
  oscillator.start(now);
  oscillator.stop(now + duration + 0.02);
}

function playNoise(duration, volume) {
  if (!audioState.enabled || !ensureAudio()) {
    return;
  }

  const length = Math.floor(audioState.ctx.sampleRate * duration);
  const buffer = audioState.ctx.createBuffer(1, length, audioState.ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / length);
  }
  const source = audioState.ctx.createBufferSource();
  const filter = audioState.ctx.createBiquadFilter();
  const gain = audioState.ctx.createGain();
  source.buffer = buffer;
  filter.type = "highpass";
  filter.frequency.value = 900;
  gain.gain.value = volume;
  source.connect(filter);
  filter.connect(gain);
  gain.connect(audioState.master);
  source.start();
}

const sfx = {
  jump() {
    playTone("square", 360, 0.12, 0.035, 120);
  },
  shot() {
    playTone("square", 620, 0.08, 0.028, -180);
  },
  burstShot() {
    playTone("triangle", 760, 0.06, 0.02, -240);
  },
  hurt() {
    playNoise(0.12, 0.03);
    playTone("sawtooth", 180, 0.15, 0.025, -80);
  },
  pickup() {
    playTone("triangle", 520, 0.08, 0.025, 160);
    playTone("triangle", 760, 0.12, 0.02, 120);
  },
  enemyDown() {
    playTone("square", 260, 0.09, 0.022, -140);
  },
  bossDown() {
    playTone("sawtooth", 220, 0.18, 0.03, 180);
    setTimeout(() => playTone("triangle", 420, 0.24, 0.025, 260), 90);
  },
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function rectsOverlap(a, b) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function sign(value) {
  return value < 0 ? -1 : 1;
}

class Actor {
  constructor(x, y, width, height) {
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
    this.vx = 0;
    this.vy = 0;
    this.onGround = false;
  }

  get rect() {
    return { x: this.x, y: this.y, width: this.width, height: this.height };
  }
}

class Player extends Actor {
  constructor() {
    super(80, 340, 34, 48);
    this.speed = 3.2;
    this.jumpPower = -11.8;
    this.facing = 1;
    this.hp = 8;
    this.maxHp = 8;
    this.hitCount = 0;
    this.maxHits = 5;
    this.fireCooldown = 0;
    this.invincible = 0;
    this.burstTimer = 0;
    this.flash = 0;
  }

  update(platforms) {
    const movingLeft = keys.ArrowLeft;
    const movingRight = keys.ArrowRight;

    if (movingLeft && !movingRight) {
      this.vx = -this.speed;
      this.facing = -1;
    } else if (movingRight && !movingLeft) {
      this.vx = this.speed;
      this.facing = 1;
    } else {
      this.vx *= 0.72;
      if (Math.abs(this.vx) < 0.05) {
        this.vx = 0;
      }
    }

    if (justPressed.KeyZ && this.onGround) {
      this.vy = this.jumpPower;
      this.onGround = false;
      sfx.jump();
    }

    this.fireCooldown = Math.max(0, this.fireCooldown - 1);
    this.invincible = Math.max(0, this.invincible - 1);
    this.burstTimer = Math.max(0, this.burstTimer - 1);
    this.flash = Math.max(0, this.flash - 1);

    this.vy += GRAVITY;
    this.x += this.vx;
    resolveHorizontal(this, platforms);
    this.y += this.vy;
    this.onGround = false;
    resolveVertical(this, platforms);
    this.x = clamp(this.x, 0, WORLD_WIDTH - this.width);
  }

  shoot(projectiles) {
    if (!justPressed.KeyX || this.fireCooldown > 0) {
      return;
    }

    this.fireCooldown = this.burstTimer > 0 ? 9 : 15;
    const originY = this.y + 19;

    if (this.burstTimer > 0) {
      [-0.28, 0, 0.28].forEach((arc) => {
        projectiles.push(new Projectile(this.x + this.width / 2, originY, this.facing * 8.5, arc, true));
      });
      sfx.burstShot();
      return;
    }

    projectiles.push(new Projectile(this.x + this.width / 2, originY, this.facing * 8.8, 0, true));
    sfx.shot();
  }

  damage(amount) {
    if (this.invincible > 0) {
      return false;
    }
    this.hp -= amount;
    this.hitCount += 1;
    this.invincible = 60;
    this.flash = 10;
    this.vx = -this.facing * 3;
    this.vy = -4.5;
    sfx.hurt();
    return true;
  }
}

class Projectile {
  constructor(x, y, vx, arc, friendly) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = arc * 8;
    this.radius = friendly ? 6 : 6;
    this.friendly = friendly;
    this.life = 90;
  }

  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.life -= 1;
  }

  get rect() {
    return { x: this.x - this.radius, y: this.y - this.radius, width: this.radius * 2, height: this.radius * 2 };
  }
}

class Walker extends Actor {
  constructor(x, y) {
    super(x, y, 32, 34);
    this.hp = 3;
    this.direction = -1;
    this.value = 100;
    this.touchDamage = 1;
  }

  update(platforms) {
    this.vx = this.direction * 1.3;
    this.vy += GRAVITY;
    this.x += this.vx;
    const prevX = this.x;
    resolveHorizontal(this, platforms);
    if (Math.abs(this.x - prevX) < 0.01) {
      this.direction *= -1;
    }
    this.y += this.vy;
    this.onGround = false;
    resolveVertical(this, platforms);

    const footX = this.direction < 0 ? this.x - 2 : this.x + this.width + 2;
    const support = platforms.some((platform) => (
      footX >= platform.x &&
      footX <= platform.x + platform.width &&
      Math.abs(this.y + this.height - platform.y) < 10
    ));

    if (!support && this.onGround) {
      this.direction *= -1;
    }
  }
}

class Hopper extends Actor {
  constructor(x, y) {
    super(x, y, 30, 30);
    this.hp = 2;
    this.timer = 0;
    this.value = 100;
    this.touchDamage = 1;
  }

  update(platforms, player) {
    this.timer += 1;
    if (this.onGround && this.timer > 70) {
      this.timer = 0;
      this.vy = -8.4;
      this.vx = sign(player.x - this.x) * 2.1;
    }

    this.vy += GRAVITY;
    this.x += this.vx;
    resolveHorizontal(this, platforms);
    this.y += this.vy;
    this.onGround = false;
    resolveVertical(this, platforms);
    if (this.onGround) {
      this.vx *= 0.8;
    }
  }
}

class Turret extends Actor {
  constructor(x, y) {
    super(x, y, 30, 34);
    this.hp = 4;
    this.cooldown = 40;
    this.value = 150;
    this.touchDamage = 1;
  }

  update(platforms, player, enemyProjectiles) {
    this.vy += GRAVITY;
    this.y += this.vy;
    this.onGround = false;
    resolveVertical(this, platforms);

    this.cooldown -= 1;
    const dx = player.x - this.x;
    const dy = player.y - this.y;
    if (Math.abs(dx) < 340 && Math.abs(dy) < 140 && this.cooldown <= 0) {
      this.cooldown = 90;
      const mag = Math.hypot(dx, dy) || 1;
      enemyProjectiles.push(new Projectile(this.x + 15, this.y + 14, (dx / mag) * 4.2, (dy / mag) * 0.12, false));
    }
  }
}

class Boss extends Actor {
  constructor(x, y) {
    super(x, y, 96, 110);
    this.hp = 32;
    this.maxHp = 32;
    this.phaseTimer = 0;
    this.jumpCooldown = 70;
    this.shotCooldown = 55;
    this.value = 3000;
    this.touchDamage = 2;
    this.active = false;
  }

  update(platforms, player, enemyProjectiles) {
    if (!this.active) {
      return;
    }

    this.phaseTimer += 1;
    this.jumpCooldown -= 1;
    this.shotCooldown -= 1;

    if (this.onGround && this.jumpCooldown <= 0) {
      this.jumpCooldown = 85;
      this.vy = -8.8;
      this.vx = sign(player.x - this.x) * 2.4;
    }

    if (this.shotCooldown <= 0) {
      this.shotCooldown = this.hp < 14 ? 30 : 48;
      const dx = player.x - (this.x + this.width / 2);
      const dy = player.y - (this.y + this.height / 2);
      const mag = Math.hypot(dx, dy) || 1;
      enemyProjectiles.push(new Projectile(this.x + 14, this.y + 38, (dx / mag) * 4.8, (dy / mag) * 0.15, false));
      enemyProjectiles.push(new Projectile(this.x + this.width - 14, this.y + 38, (dx / mag) * 4.8, (dy / mag) * 0.15, false));
    }

    this.vy += GRAVITY;
    this.x += this.vx;
    resolveHorizontal(this, platforms);
    this.y += this.vy;
    this.onGround = false;
    resolveVertical(this, platforms);
    this.x = clamp(this.x, 3110, 3440 - this.width);
  }
}

class Pickup {
  constructor(x, y, type) {
    this.x = x;
    this.y = y;
    this.width = 20;
    this.height = 20;
    this.type = type;
    this.float = Math.random() * Math.PI * 2;
  }

  update() {
    this.float += 0.06;
  }

  get rect() {
    return { x: this.x, y: this.y + Math.sin(this.float) * 4, width: this.width, height: this.height };
  }
}

function resolveHorizontal(actor, platforms) {
  for (const platform of platforms) {
    if (!rectsOverlap(actor.rect, platform)) {
      continue;
    }
    if (actor.vx > 0) {
      actor.x = platform.x - actor.width;
    } else if (actor.vx < 0) {
      actor.x = platform.x + platform.width;
    }
    actor.vx = 0;
  }
}

function resolveVertical(actor, platforms) {
  for (const platform of platforms) {
    if (!rectsOverlap(actor.rect, platform)) {
      continue;
    }
    if (actor.vy > 0) {
      actor.y = platform.y - actor.height;
      actor.vy = 0;
      actor.onGround = true;
    } else if (actor.vy < 0) {
      actor.y = platform.y + platform.height;
      actor.vy = 0;
    }
  }
}

function buildPlatforms() {
  return [
    { x: 0, y: GROUND_Y, width: 1020, height: 72 },
    { x: 220, y: 384, width: 120, height: 18 },
    { x: 430, y: 330, width: 120, height: 18 },
    { x: 680, y: 280, width: 130, height: 18 },
    { x: 1060, y: 420, width: 200, height: 120 },
    { x: 1380, y: 380, width: 120, height: 18 },
    { x: 1560, y: 330, width: 140, height: 18 },
    { x: 1810, y: 286, width: 150, height: 18 },
    { x: 2060, y: 468, width: 250, height: 72 },
    { x: 2190, y: 358, width: 110, height: 18 },
    { x: 2370, y: 310, width: 130, height: 18 },
    { x: 2620, y: 260, width: 130, height: 18 },
    { x: 2860, y: 468, width: 360, height: 72 },
    { x: 3100, y: 398, width: 330, height: 18 },
    { x: 3000, y: 468, width: 600, height: 72 },
  ];
}

function buildEnemies() {
  return [
    new Walker(520, 296),
    new Hopper(860, 250),
    new Turret(1140, 386),
    new Walker(1450, 346),
    new Hopper(1885, 250),
    new Turret(2235, 324),
    new Walker(2425, 276),
    new Hopper(2680, 226),
  ];
}

function buildPickups() {
  return [
    new Pickup(260, 350, "gear"),
    new Pickup(785, 246, "burst"),
    new Pickup(1595, 294, "heal"),
    new Pickup(2395, 276, "gear"),
    new Pickup(2645, 226, "heal"),
  ];
}

function makeState() {
  return {
    cameraX: 0,
    player: new Player(),
    platforms: buildPlatforms(),
    enemies: buildEnemies(),
    boss: new Boss(3210, 288),
    pickups: buildPickups(),
    projectiles: [],
    enemyProjectiles: [],
    score: 0,
    combo: 1,
    comboTimer: 0,
    bossCleared: false,
    gameOver: false,
    win: false,
    message: "STAGE START",
    messageTimer: 120,
  };
}

let state = makeState();

function addScore(base, airborne = false) {
  const aerial = airborne ? 50 : 0;
  state.score += base + aerial + (state.combo - 1) * 40;
  state.combo = clamp(state.combo + 1, 1, 6);
  state.comboTimer = 180;
}

function spawnDrop(x, y) {
  const roll = Math.random();
  if (roll < 0.18) {
    state.pickups.push(new Pickup(x, y, "heal"));
  } else if (roll < 0.3) {
    state.pickups.push(new Pickup(x, y, "gear"));
  }
}

function hitEnemy(enemy, damage = 1) {
  enemy.hp -= damage;
  if (enemy.hp > 0) {
    return;
  }
  const airborne = !state.player.onGround;
  addScore(enemy.value, airborne);
  spawnDrop(enemy.x, enemy.y);
  if (enemy === state.boss) {
    sfx.bossDown();
    state.bossCleared = true;
    state.score += 3000 + state.player.hp * 120;
    state.win = true;
    state.gameOver = true;
    state.message = "CORE SHUTDOWN";
    state.messageTimer = 9999;
    return;
  }
  sfx.enemyDown();
  state.enemies = state.enemies.filter((entry) => entry !== enemy);
}

function collectPickup(pickup) {
  sfx.pickup();
  if (pickup.type === "heal") {
    state.player.hp = clamp(state.player.hp + 2, 0, state.player.maxHp);
    state.message = "ENERGY +2";
    state.messageTimer = 60;
  } else if (pickup.type === "burst") {
    state.player.burstTimer = 480;
    state.message = "BURST CHIP";
    state.messageTimer = 60;
  } else if (pickup.type === "gear") {
    state.score += 250;
    state.message = "GEAR +250";
    state.messageTimer = 45;
  }
}

function update() {
  if (justPressed.KeyR) {
    state = makeState();
  }

  if (state.gameOver) {
    state.messageTimer = Math.max(0, state.messageTimer - 1);
    clearJustPressed();
    draw();
    return;
  }

  state.player.update(state.platforms);
  state.player.shoot(state.projectiles);

  for (const projectile of state.projectiles) {
    projectile.update();
  }
  for (const projectile of state.enemyProjectiles) {
    projectile.update();
  }

  state.projectiles = state.projectiles.filter((projectile) => (
    projectile.life > 0 &&
    projectile.x > -40 &&
    projectile.x < WORLD_WIDTH + 40 &&
    projectile.y > -40 &&
    projectile.y < WORLD_HEIGHT + 40
  ));
  state.enemyProjectiles = state.enemyProjectiles.filter((projectile) => (
    projectile.life > 0 &&
    projectile.x > -40 &&
    projectile.x < WORLD_WIDTH + 40 &&
    projectile.y > -40 &&
    projectile.y < WORLD_HEIGHT + 40
  ));

  for (const enemy of state.enemies) {
    if (enemy instanceof Walker) {
      enemy.update(state.platforms);
    } else if (enemy instanceof Hopper) {
      enemy.update(state.platforms, state.player);
    } else if (enemy instanceof Turret) {
      enemy.update(state.platforms, state.player, state.enemyProjectiles);
    }
  }

  if (state.player.x > 3010) {
    state.boss.active = true;
    if (state.message !== "SCRAP BRAIN") {
      state.message = "SCRAP BRAIN";
      state.messageTimer = 90;
    }
  }

  state.boss.update(state.platforms, state.player, state.enemyProjectiles);

  for (const pickup of state.pickups) {
    pickup.update();
  }

  for (const projectile of state.projectiles) {
    for (const enemy of state.enemies) {
      if (rectsOverlap(projectile.rect, enemy.rect)) {
        projectile.life = 0;
        hitEnemy(enemy);
      }
    }

    if (state.boss.active && rectsOverlap(projectile.rect, state.boss.rect)) {
      projectile.life = 0;
      hitEnemy(state.boss);
    }
  }

  for (const projectile of state.enemyProjectiles) {
    if (rectsOverlap(projectile.rect, state.player.rect) && state.player.damage(1)) {
      projectile.life = 0;
    }
  }

  for (const enemy of state.enemies) {
    if (rectsOverlap(enemy.rect, state.player.rect)) {
      state.player.damage(enemy.touchDamage);
    }
  }

  if (state.boss.active && rectsOverlap(state.boss.rect, state.player.rect)) {
    state.player.damage(state.boss.touchDamage);
  }

  state.pickups = state.pickups.filter((pickup) => {
    if (rectsOverlap(pickup.rect, state.player.rect)) {
      collectPickup(pickup);
      return false;
    }
    return true;
  });

  if (state.comboTimer > 0) {
    state.comboTimer -= 1;
  } else {
    state.combo = 1;
  }

  if (state.player.hp <= 0 || state.player.hitCount >= state.player.maxHits || state.player.y > WORLD_HEIGHT + 80) {
    state.gameOver = true;
    state.win = false;
    state.message = "SYSTEM DOWN";
    state.messageTimer = 9999;
  }

  state.messageTimer = Math.max(0, state.messageTimer - 1);
  state.cameraX = clamp(state.player.x - canvas.width * 0.4, 0, WORLD_WIDTH - canvas.width);
  updateHud();
  clearJustPressed();
  draw();
}

function updateHud() {
  hpText.textContent = `${state.player.hp} / ${state.player.maxHp}  HIT ${state.player.hitCount}/${state.player.maxHits}`;
  scoreText.textContent = String(state.score).padStart(5, "0");
  comboText.textContent = `x${state.combo}`;
  powerText.textContent = state.player.burstTimer > 0 ? "BURST" : "NORMAL";
}

function clearJustPressed() {
  Object.keys(justPressed).forEach((key) => {
    justPressed[key] = false;
  });
}

function drawBackground(cameraX) {
  ctx.fillStyle = palette.sky;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const skyGradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  skyGradient.addColorStop(0, "rgba(120, 210, 255, 0.14)");
  skyGradient.addColorStop(0.55, "rgba(65, 138, 214, 0.08)");
  skyGradient.addColorStop(1, "rgba(8, 18, 30, 0)");
  ctx.fillStyle = skyGradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#091727";
  for (let i = 0; i < 18; i += 1) {
    const x = ((i * 240) - cameraX * 0.2) % (canvas.width + 260);
    ctx.fillRect(x, 240, 80, 180);
    ctx.fillRect(x + 26, 180, 28, 60);
  }

  ctx.fillStyle = palette.back;
  for (let i = 0; i < 16; i += 1) {
    const x = ((i * 300) - cameraX * 0.45) % (canvas.width + 320);
    ctx.fillRect(x, 280, 150, 170);
  }

  ctx.fillStyle = palette.mid;
  for (let i = 0; i < 14; i += 1) {
    const x = ((i * 340) - cameraX * 0.7) % (canvas.width + 360);
    ctx.fillRect(x, 320, 220, 160);
  }

  ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
  for (let i = 0; i < 12; i += 1) {
    const x = ((i * 420) - cameraX * 0.85) % (canvas.width + 440);
    ctx.fillRect(x + 20, 340, 16, 140);
    ctx.fillRect(x, 372, 62, 12);
  }
}

function drawPlatforms(cameraX) {
  for (const platform of state.platforms) {
    const x = platform.x - cameraX;
    ctx.fillStyle = palette.ground;
    ctx.fillRect(x, platform.y, platform.width, platform.height);
    ctx.fillStyle = "rgba(115, 150, 185, 0.9)";
    ctx.fillRect(x, platform.y, platform.width, 6);
    ctx.fillStyle = "rgba(20, 36, 58, 0.16)";
    ctx.fillRect(x, platform.y + platform.height - 8, platform.width, 8);
  }
}

function drawPlayer(cameraX) {
  const player = state.player;
  if (player.invincible > 0 && Math.floor(player.invincible / 4) % 2 === 0) {
    return;
  }
  const x = player.x - cameraX;
  ctx.fillStyle = palette.playerDark;
  ctx.fillRect(x + 8, player.y, 18, 10);
  ctx.fillRect(x + 5, player.y + 12, 24, 26);
  ctx.fillRect(x, player.y + 16, 8, 16);
  ctx.fillRect(x + 26, player.y + 16, 8, 16);
  ctx.fillRect(x + 6, player.y + 38, 9, 10);
  ctx.fillRect(x + 19, player.y + 38, 9, 10);
  ctx.fillStyle = palette.player;
  ctx.fillRect(x + 10, player.y + 2, 14, 8);
  ctx.fillRect(x + 7, player.y + 14, 20, 22);
  ctx.fillStyle = "#e8ffff";
  ctx.fillRect(x + (player.facing > 0 ? 22 : 4), player.y + 20, 10, 7);
}

function drawEnemy(enemy, cameraX) {
  const x = enemy.x - cameraX;
  if (enemy instanceof Boss) {
    ctx.fillStyle = "#6b2236";
    ctx.fillRect(x, enemy.y, enemy.width, enemy.height);
    ctx.fillStyle = palette.boss;
    ctx.fillRect(x + 8, enemy.y + 8, enemy.width - 16, enemy.height - 16);
    ctx.fillStyle = "#ffe8ef";
    ctx.fillRect(x + 16, enemy.y + 30, 18, 10);
    ctx.fillRect(x + 62, enemy.y + 30, 18, 10);
    ctx.fillStyle = "#111";
    ctx.fillRect(x + 10, enemy.y - 18, 76, 10);
    ctx.fillStyle = "#393";
    ctx.fillRect(x + 12, enemy.y - 16, 72 * (enemy.hp / enemy.maxHp), 6);
    return;
  }

  ctx.fillStyle = "#63232f";
  ctx.fillRect(x, enemy.y, enemy.width, enemy.height);
  ctx.fillStyle = palette.enemy;
  ctx.fillRect(x + 3, enemy.y + 3, enemy.width - 6, enemy.height - 6);
}

function drawProjectiles(cameraX) {
  for (const projectile of state.projectiles) {
    ctx.fillStyle = palette.bullet;
    ctx.beginPath();
    ctx.arc(projectile.x - cameraX, projectile.y, projectile.radius, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const projectile of state.enemyProjectiles) {
    ctx.fillStyle = palette.warning;
    ctx.beginPath();
    ctx.arc(projectile.x - cameraX, projectile.y, projectile.radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPickups(cameraX) {
  for (const pickup of state.pickups) {
    const rect = pickup.rect;
    const x = rect.x - cameraX;
    const color = pickup.type === "heal" ? "#8be9a8" : pickup.type === "burst" ? "#5dd6ff" : "#ffd166";
    ctx.fillStyle = color;
    ctx.fillRect(x, rect.y, rect.width, rect.height);
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.fillRect(x + 5, rect.y + 5, rect.width - 10, rect.height - 10);
  }
}

function drawOverlay() {
  if (state.messageTimer > 0) {
    ctx.fillStyle = "rgba(0, 0, 0, 0.34)";
    ctx.fillRect(280, 34, 400, 54);
    ctx.strokeStyle = "rgba(93, 214, 255, 0.6)";
    ctx.strokeRect(280, 34, 400, 54);
    ctx.fillStyle = "#eff7ff";
    ctx.font = "bold 28px Segoe UI";
    ctx.textAlign = "center";
    ctx.fillText(state.message, canvas.width / 2, 69);
  }

  if (!state.gameOver) {
    return;
  }

  ctx.fillStyle = "rgba(5, 10, 18, 0.72)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = "center";
  ctx.fillStyle = state.win ? "#8be9a8" : "#ff9c9c";
  ctx.font = "bold 46px Segoe UI";
  ctx.fillText(state.win ? "MISSION CLEAR" : "GAME OVER", canvas.width / 2, 200);
  ctx.fillStyle = "#eff7ff";
  ctx.font = "24px Segoe UI";
  ctx.fillText(`Final Score ${state.score}`, canvas.width / 2, 252);
  ctx.fillText("R 키로 즉시 재시작", canvas.width / 2, 294);
}

function draw() {
  drawBackground(state.cameraX);
  drawPlatforms(state.cameraX);
  drawPickups(state.cameraX);
  for (const enemy of state.enemies) {
    drawEnemy(enemy, state.cameraX);
  }
  if (state.boss.active || state.bossCleared) {
    drawEnemy(state.boss, state.cameraX);
  }
  drawProjectiles(state.cameraX);
  drawPlayer(state.cameraX);
  drawOverlay();
}

window.addEventListener("keydown", (event) => {
  ensureAudio();
  setPressed(event.code, true);
  if (["ArrowLeft", "ArrowRight", "KeyZ", "KeyX", "KeyR", "Space"].includes(event.code)) {
    event.preventDefault();
  }
});

window.addEventListener("keyup", (event) => {
  setPressed(event.code, false);
});

audioToggle.addEventListener("click", () => {
  audioState.enabled = !audioState.enabled;
  if (audioState.enabled) {
    ensureAudio();
  } else {
    audioHint.textContent = "사운드 비활성화됨";
  }
  audioToggle.textContent = audioState.enabled ? "SOUND ON" : "SOUND OFF";
});

function loop() {
  update();
  requestAnimationFrame(loop);
}

function bindControlButton(button) {
  const code = button.dataset.key;
  const release = () => setPressed(code, false);
  const press = (event) => {
    event.preventDefault();
    ensureAudio();
    setPressed(code, true);
  };

  button.addEventListener("pointerdown", press);
  button.addEventListener("pointerup", release);
  button.addEventListener("pointercancel", release);
  button.addEventListener("pointerleave", release);
  button.addEventListener("touchstart", press, { passive: false });
  button.addEventListener("touchend", release, { passive: false });
  button.addEventListener("touchcancel", release, { passive: false });
}

controlButtons.forEach(bindControlButton);

canvas.addEventListener("pointerdown", () => {
  ensureAudio();
});

canvas.addEventListener("touchstart", (event) => {
  event.preventDefault();
  ensureAudio();
}, { passive: false });

window.addEventListener("blur", () => {
  Object.keys(keys).forEach((key) => {
    keys[key] = false;
  });
  clearJustPressed();
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    return;
  }

  Object.keys(keys).forEach((key) => {
    keys[key] = false;
  });
  clearJustPressed();
});

updateHud();
draw();
loop();
