/* =========================================================================
   AETHEL v2 — A Lâmina Estilhaçada
   game.js — Motor de RPG 2D com mapas e correções
   ========================================================================= */
(function () {
'use strict';

/* =========================================================================
   0. UTILITÁRIOS
   ========================================================================= */
const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const pick = arr => arr[(Math.random() * arr.length) | 0];
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

/* =========================================================================
   1. CONFIGURAÇÃO — CAMPO DE VISÃO AUMENTADO
   ========================================================================= */
const VW = 1600, VH = 900;                 // resolução lógica ampliada
const SPAWN = { x: 700, y: 900 };

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
canvas.width = VW; canvas.height = VH;

const lightCanvas = document.createElement('canvas');
lightCanvas.width = VW; lightCanvas.height = VH;
const lctx = lightCanvas.getContext('2d');

const G = {
  time: 0,
  running: false,
  paused: false,
  over: false,
  potions: 3,
  relicEquipped: true,
  legendaryEquipped: true,
  bossEngaged: false,
  currentMap: 0,
  transitioning: false,
  enemies: [],
  npcs: [],
  portals: [],
  decor: []
};

/* =========================================================================
   2. INPUT
   ========================================================================= */
const keys = Object.create(null);
const mouse = { x: VW / 2, y: VH / 2, wx: 0, wy: 0, down: false };

window.addEventListener('keydown', e => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
  if (!keys[e.code]) onKeyDown(e.code);
  keys[e.code] = true;
  Audio.unlock();
});
window.addEventListener('keyup', e => { keys[e.code] = false; });

canvas.addEventListener('mousemove', e => {
  const r = canvas.getBoundingClientRect();
  mouse.x = (e.clientX - r.left) * (VW / r.width);
  mouse.y = (e.clientY - r.top) * (VH / r.height);
  mouse.wx = mouse.x + camera.x;
  mouse.wy = mouse.y + camera.y;
});
canvas.addEventListener('mousedown', e => { if (e.button === 0) { mouse.down = true; Audio.unlock(); } });
window.addEventListener('mouseup', () => { mouse.down = false; });
canvas.addEventListener('contextmenu', e => e.preventDefault());

function onKeyDown(code) {
  // Diálogo tem prioridade
  if (Dialogue.active) {
    if (code === 'Escape') { Dialogue.close(); return; }
    if (code === 'KeyE' || code === 'Space' || code === 'Enter') {
      if (Dialogue.typing) Dialogue.skip();
      else if (Dialogue.node && Dialogue.node.options && Dialogue.node.options[0]) Dialogue.choose(Dialogue.node.options[0]);
    }
    if (code === 'Digit1' || code === 'Digit2' || code === 'Digit3') {
      const idx = parseInt(code.slice(5), 10) - 1;
      if (Dialogue.node && Dialogue.node.options && Dialogue.node.options[idx]) Dialogue.choose(Dialogue.node.options[idx]);
    }
    return;
  }
  if (code === 'KeyI') { toggleInventory(); return; }
  if (code === 'Escape') {
    if (!document.getElementById('inventory').classList.contains('hidden')) toggleInventory();
    return;
  }
  if (code === 'Digit1') usePotion();
  if (code === 'KeyE') tryInteract();
}

/* =========================================================================
   3. ÁUDIO PROCEDURAL
   ========================================================================= */
const Audio = {
  ctx: null, master: null, step: 0, nextNote: 0, tempo: 1, enabled: false,

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.22;
    this.master.connect(this.ctx.destination);
    this.nextNote = this.ctx.currentTime + 0.1;
    this.enabled = true;
  },

  tone(freq, when, dur, type, vol) {
    if (!this.ctx) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, when);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(vol, when + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    o.connect(g); g.connect(this.master);
    o.start(when); o.stop(when + dur + 0.05);
  },

  sweep(f0, f1, dur, type, vol) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type || 'sawtooth';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.03);
  },

  noise(dur, vol, filterFreq) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = filterFreq || 1200;
    const g = this.ctx.createGain(); g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t);
  },

  sfx(name) {
    if (!this.ctx) return;
    switch (name) {
      case 'swing':   this.noise(0.12, 0.10, 2600); this.sweep(760, 320, 0.13, 'triangle', 0.05); break;
      case 'hit':     this.noise(0.09, 0.18, 900); this.sweep(200, 70, 0.12, 'square', 0.09); break;
      case 'ice':     this.sweep(1400, 2200, 0.20, 'sine', 0.07); break;
      case 'hurt':    this.sweep(320, 90, 0.28, 'sawtooth', 0.12); break;
      case 'slam':    this.noise(0.45, 0.35, 260); this.sweep(110, 34, 0.5, 'sine', 0.25); break;
      case 'drink':   this.sweep(300, 900, 0.45, 'sine', 0.10); break;
      case 'shatter': this.noise(0.4, 0.22, 5200); this.sweep(2200, 600, 0.3, 'triangle', 0.07); break;
      case 'crow':    this.noise(0.18, 0.08, 3200); break;
      case 'nova':    this.sweep(180, 1400, 0.35, 'sine', 0.12); this.noise(0.3, 0.12, 4000); break;
      case 'die':     this.sweep(420, 60, 0.9, 'sawtooth', 0.16); break;
      case 'portal':  this.sweep(400, 1600, 0.5, 'sine', 0.12); break;
    }
  },

  update() {
    if (!this.ctx || !this.enabled || !G.running) return;
    const beat = 0.62 / this.tempo;
    while (this.nextNote < this.ctx.currentTime + 0.3) {
      this.playBeat(this.nextNote);
      this.nextNote += beat;
      this.step++;
    }
  },

  playBeat(t) {
    const scale = [0, 3, 5, 7, 10, 12, 15];
    const root = 110;
    const step = this.step;
    if (step % 4 === 0) this.tone(root * 0.5, t, 1.0, 'sine', 0.20);
    if (step % 8 === 6) this.tone(root * 0.75, t, 0.7, 'sine', 0.10);
    const n = scale[(step * 3) % scale.length];
    this.tone(root * Math.pow(2, n / 12) * 2, t, 0.35, 'triangle', 0.045);
    if (step % 8 === 4) this.tone(root * Math.pow(2, 7 / 12), t, 0.6, 'sawtooth', 0.022);
  }
};

/* =========================================================================
   4. CÂMERA
   ========================================================================= */
const camera = {
  x: 0, y: 0, shakeX: 0, shakeY: 0, shakeMag: 0, shakeTime: 0,
  worldW: 3000, worldH: 1800,

  follow(target, dt) {
    const tx = clamp(target.x - VW / 2, 0, this.worldW - VW);
    const ty = clamp(target.y - VH / 2, 0, this.worldH - VH);
    const k = 1 - Math.pow(0.0009, dt);
    this.x = lerp(this.x, tx, k);
    this.y = lerp(this.y, ty, k);
  },

  shake(mag, time) {
    this.shakeMag = Math.max(this.shakeMag, mag);
    this.shakeTime = Math.max(this.shakeTime, time);
  },

  updateShake(dt) {
    if (this.shakeTime > 0) {
      this.shakeTime -= dt;
      const m = this.shakeMag * Math.min(1, this.shakeTime * 2.2);
      this.shakeX = (Math.random() * 2 - 1) * m;
      this.shakeY = (Math.random() * 2 - 1) * m;
      if (this.shakeTime <= 0) { this.shakeMag = 0; this.shakeX = 0; this.shakeY = 0; }
    } else { this.shakeX = 0; this.shakeY = 0; }
  }
};

/* =========================================================================
   5. PARTÍCULAS
   ========================================================================= */
const particles = [];
const MAX_PARTICLES = 1100;

function P(o) {
  if (particles.length >= MAX_PARTICLES) return;
  particles.push({
    type: o.type || 'spark',
    x: o.x, y: o.y,
    vx: o.vx || 0, vy: o.vy || 0,
    life: o.life || 1, maxLife: o.life || 1,
    size: o.size || 3,
    color: o.color || '#ffffff',
    grav: o.grav || 0,
    drag: o.drag === undefined ? 0.94 : o.drag,
    rot: o.rot || 0,
    rotV: o.rotV || 0,
    add: o.add !== false,
    grow: o.grow || 0
  });
}

function burstIce(x, y, n, spread, speed) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, TAU);
    const s = rand(0.3, 1) * speed;
    P({
      type: 'ice', x, y,
      vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      life: rand(0.35, 0.85), size: rand(2, 5),
      color: pick(['#bff6ff', '#7fe4ff', '#39b8e8', '#e8fdff']),
      drag: 0.90, grav: 60
    });
  }
}

function burstSparks(x, y, n, color, speed) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, TAU);
    const s = rand(0.2, 1) * speed;
    P({
      type: 'spark', x, y,
      vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      life: rand(0.2, 0.6), size: rand(1.5, 3.5),
      color: color || pick(['#ffe6a8', '#ffb347', '#fff']),
      drag: 0.88, grav: 140
    });
  }
}

function burstShards(x, y, n, colors) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, TAU);
    const s = rand(60, 460);
    P({
      type: 'shard', x, y,
      vx: Math.cos(a) * s, vy: Math.sin(a) * s - rand(40, 160),
      life: rand(0.8, 1.9), size: rand(4, 12),
      color: pick(colors || ['#9fe8ff', '#c9a7ff', '#ffd166', '#7dffb0', '#ff7fa8']),
      grav: 520, drag: 0.985,
      rot: rand(0, TAU), rotV: rand(-9, 9),
      add: true
    });
  }
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    const k = Math.pow(p.drag, dt * 60);
    p.vx *= k; p.vy *= k;
    p.vy += p.grav * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.rotV * dt;
    p.size += p.grow * dt;
  }
}

function drawParticles(g) {
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    const a = clamp(p.life / p.maxLife, 0, 1);
    g.globalCompositeOperation = p.add ? 'lighter' : 'source-over';
    g.globalAlpha = a;

    switch (p.type) {
      case 'spark': {
        g.strokeStyle = p.color;
        g.lineWidth = p.size;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(p.x, p.y);
        g.lineTo(p.x - p.vx * 0.022, p.y - p.vy * 0.022);
        g.stroke();
        break;
      }
      case 'ice': {
        g.save();
        g.translate(p.x, p.y);
        g.rotate(p.rot);
        g.fillStyle = p.color;
        g.beginPath();
        g.moveTo(0, -p.size);
        g.lineTo(p.size * 0.55, 0);
        g.lineTo(0, p.size);
        g.lineTo(-p.size * 0.55, 0);
        g.closePath();
        g.fill();
        g.restore();
        break;
      }
      case 'shard': {
        g.save();
        g.translate(p.x, p.y);
        g.rotate(p.rot);
        g.fillStyle = p.color;
        g.beginPath();
        g.moveTo(0, -p.size);
        g.lineTo(p.size * 0.8, p.size * 0.7);
        g.lineTo(-p.size * 0.8, p.size * 0.7);
        g.closePath();
        g.fill();
        g.restore();
        break;
      }
      case 'crow': {
        g.save();
        g.translate(p.x, p.y);
        const flap = Math.sin(G.time * 22 + p.rot) * 0.5;
        g.strokeStyle = p.color;
        g.lineWidth = 2.4;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(-p.size, 0);
        g.quadraticCurveTo(-p.size * 0.4, -p.size * (0.7 + flap), 0, 0);
        g.quadraticCurveTo(p.size * 0.4, -p.size * (0.7 + flap), p.size, 0);
        g.stroke();
        g.restore();
        break;
      }
      case 'ring': {
        g.strokeStyle = p.color;
        g.lineWidth = 3 * a;
        g.beginPath(); g.arc(p.x, p.y, p.size, 0, TAU); g.stroke();
        break;
      }
      case 'leaf': {
        g.save();
        g.translate(p.x, p.y);
        g.rotate(p.rot);
        g.fillStyle = p.color;
        g.beginPath();
        g.ellipse(0, 0, p.size, p.size * 0.5, 0, 0, TAU);
        g.fill();
        g.restore();
        break;
      }
      default: {
        g.fillStyle = p.color;
        g.beginPath(); g.arc(p.x, p.y, p.size * a, 0, TAU); g.fill();
      }
    }
  }
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
}

/* =========================================================================
   6. CAMADAS DE PARALLAX
   ========================================================================= */
function makeLayer(w, h, drawFn) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  drawFn(g, w, h);
  return c;
}

const LW = 1600, LH = 1000;
let skyLayer, mountainLayer, farForest, nearForest, foreLayer, groundTile, groundPattern;
let villageGroundTile, villageGroundPattern;

function wrap(g, W, x, fn) {
  fn(x);
  if (x < 220) fn(x + W);
  if (x > W - 220) fn(x - W);
}

function buildLayers() {
  /* ---------- CÉU (floresta) ---------- */
  skyLayer = makeLayer(LW, LH, (g) => {
    const grad = g.createLinearGradient(0, 0, 0, LH);
    grad.addColorStop(0.00, '#04050e');
    grad.addColorStop(0.30, '#0b1030');
    grad.addColorStop(0.58, '#1d1a42');
    grad.addColorStop(0.80, '#352a52');
    grad.addColorStop(1.00, '#4d3a5e');
    g.fillStyle = grad;
    g.fillRect(0, 0, LW, LH);

    for (let i = 0; i < 520; i++) {
      const x = Math.random() * LW;
      const y = Math.random() * LH * 0.68;
      const r = Math.random() * 1.6 + 0.2;
      g.globalAlpha = (Math.random() * 0.8 + 0.1) * (1 - y / (LH * 0.8));
      g.fillStyle = Math.random() < 0.18 ? '#9fd8ff' : '#ffffff';
      g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    }
    g.globalAlpha = 1;

    const mx = LW * 0.76, my = LH * 0.16, mr = 68;
    const mg = g.createRadialGradient(mx, my, 0, mx, my, mr * 5);
    mg.addColorStop(0, 'rgba(200, 222, 255, 0.34)');
    mg.addColorStop(0.35, 'rgba(140, 175, 255, 0.12)');
    mg.addColorStop(1, 'rgba(120, 150, 255, 0)');
    g.fillStyle = mg;
    g.beginPath(); g.arc(mx, my, mr * 5, 0, TAU); g.fill();
    g.fillStyle = '#e2ecff';
    g.beginPath(); g.arc(mx, my, mr, 0, TAU); g.fill();
    g.fillStyle = 'rgba(178, 200, 255, 0.38)';
    g.beginPath(); g.arc(mx - 20, my - 15, 14, 0, TAU); g.fill();
    g.beginPath(); g.arc(mx + 22, my + 18, 9, 0, TAU); g.fill();

    for (let i = 0; i < 20; i++) {
      const x = Math.random() * LW;
      const y = LH * 0.28 + Math.random() * LH * 0.36;
      const rw = 150 + Math.random() * 320;
      const rh = 18 + Math.random() * 34;
      const cg = g.createRadialGradient(x, y, 0, x, y, rw);
      cg.addColorStop(0, 'rgba(95, 88, 150, 0.20)');
      cg.addColorStop(1, 'rgba(95, 88, 150, 0)');
      g.fillStyle = cg;
      g.beginPath(); g.ellipse(x, y, rw, rh, 0, 0, TAU); g.fill();
    }
  });

  /* ---------- MONTANHAS ---------- */
  mountainLayer = makeLayer(LW, LH, (g) => {
    const drawRidge = (baseY, hMin, hMax, color, k1, k2, ph) => {
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(0, LH);
      for (let x = 0; x <= LW; x += 8) {
        const t = (x / LW) * TAU;
        const h = hMin + (hMax - hMin) * (0.5 + 0.5 * Math.sin(t * k1 + ph) * Math.sin(t * k2 + ph * 1.7));
        g.lineTo(x, baseY - Math.abs(h));
      }
      g.lineTo(LW, LH);
      g.closePath();
      g.fill();
    };
    drawRidge(LH * 0.72, 40, 240, '#161a35', 2, 3, 0.4);
    drawRidge(LH * 0.78, 25, 170, '#1b2140', 3, 5, 1.9);
    drawRidge(LH * 0.84, 12, 110, '#212a4c', 4, 7, 3.1);

    const fog = g.createLinearGradient(0, LH * 0.68, 0, LH * 0.95);
    fog.addColorStop(0, 'rgba(90, 120, 180, 0)');
    fog.addColorStop(0.5, 'rgba(90, 120, 180, 0.16)');
    fog.addColorStop(1, 'rgba(60, 80, 130, 0.05)');
    g.fillStyle = fog;
    g.fillRect(0, LH * 0.68, LW, LH * 0.32);
  });

  /* ---------- FLORESTA DISTANTE ---------- */
  farForest = makeLayer(LW, LH, (g) => {
    for (let i = 0; i < 110; i++) {
      const x = Math.random() * LW;
      const baseY = LH * 0.86;
      const h = rand(50, 160);
      const w = rand(18, 38);
      const col = `rgba(${randInt(18, 30)}, ${randInt(30, 48)}, ${randInt(38, 58)}, 0.85)`;
      wrap(g, LW, x, (px) => {
        g.fillStyle = col;
        g.beginPath();
        g.moveTo(px, baseY);
        g.lineTo(px + w * 0.5, baseY - h);
        g.lineTo(px - w * 0.5, baseY);
        g.closePath();
        g.fill();
      });
    }
    const fog = g.createLinearGradient(0, LH * 0.72, 0, LH);
    fog.addColorStop(0, 'rgba(40, 60, 100, 0)');
    fog.addColorStop(1, 'rgba(30, 45, 80, 0.55)');
    g.fillStyle = fog;
    g.fillRect(0, LH * 0.72, LW, LH * 0.28);
  });

  /* ---------- FLORESTA PRÓXIMA ---------- */
  nearForest = makeLayer(LW, LH, (g) => {
    for (let i = 0; i < 48; i++) {
      const x = Math.random() * LW;
      const baseY = LH * 0.98;
      const h = rand(220, 440);
      const trunkW = rand(18, 38);
      wrap(g, LW, x, (px) => {
        const tg = g.createLinearGradient(px - trunkW, 0, px + trunkW, 0);
        tg.addColorStop(0, '#0c1118');
        tg.addColorStop(0.5, '#151d26');
        tg.addColorStop(1, '#080c12');
        g.fillStyle = tg;
        g.beginPath();
        g.moveTo(px - trunkW * 0.5, baseY);
        g.quadraticCurveTo(px - trunkW * 0.75, baseY - h * 0.6, px - trunkW * 0.28, baseY - h);
        g.lineTo(px + trunkW * 0.28, baseY - h);
        g.quadraticCurveTo(px + trunkW * 0.75, baseY - h * 0.6, px + trunkW * 0.5, baseY);
        g.closePath();
        g.fill();

        for (let k = 0; k < 6; k++) {
          const cx = px + rand(-80, 80);
          const cy = baseY - h + rand(-45, 70);
          const cr = rand(42, 88);
          const fg = g.createRadialGradient(cx, cy, 0, cx, cy, cr);
          fg.addColorStop(0, 'rgba(24, 48, 44, 0.95)');
          fg.addColorStop(1, 'rgba(10, 22, 26, 0)');
          g.fillStyle = fg;
          g.beginPath(); g.arc(cx, cy, cr, 0, TAU); g.fill();
        }
      });
    }
    for (let i = 0; i < 240; i++) {
      const x = Math.random() * LW;
      const y = LH * 0.55 + Math.random() * LH * 0.42;
      g.fillStyle = `rgba(${randInt(40, 70)}, ${randInt(80, 120)}, ${randInt(60, 90)}, ${rand(0.15, 0.5)})`;
      g.beginPath(); g.ellipse(x, y, rand(1.5, 3.5), rand(1, 2), rand(0, TAU), 0, TAU); g.fill();
    }
  });

  /* ---------- PRIMEIRO PLANO ---------- */
  foreLayer = makeLayer(LW, LH, (g) => {
    for (let i = 0; i < 30; i++) {
      const top = i < 15;
      const x = Math.random() * LW;
      const y = top ? rand(-35, 100) : rand(LH - 145, LH + 25);
      const r = rand(70, 170);
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, 'rgba(6, 12, 10, 0.92)');
      grad.addColorStop(1, 'rgba(6, 12, 10, 0)');
      g.fillStyle = grad;
      g.beginPath(); g.ellipse(x, y, r * 1.4, r * 0.7, rand(-0.3, 0.3), 0, TAU); g.fill();
    }
  });

  /* ---------- CHÃO FLORESTA ---------- */
  groundTile = makeLayer(256, 256, (g) => {
    g.fillStyle = '#18241c';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 220; i++) {
      const x = Math.random() * 256, y = Math.random() * 256;
      const r = Math.random() * 12 + 3;
      g.fillStyle = `rgba(${randInt(26, 52)}, ${randInt(52, 86)}, ${randInt(36, 62)}, 0.35)`;
      g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    }
    for (let i = 0; i < 480; i++) {
      const x = Math.random() * 256, y = Math.random() * 256;
      g.strokeStyle = `rgba(${randInt(50, 90)}, ${randInt(100, 160)}, ${randInt(70, 110)}, ${rand(0.18, 0.5)})`;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + rand(-3, 3), y - rand(3, 9));
      g.stroke();
    }
  });
  groundPattern = ctx.createPattern(groundTile, 'repeat');

  /* ---------- CHÃO VILA ---------- */
  villageGroundTile = makeLayer(256, 256, (g) => {
    g.fillStyle = '#3a2f24';
    g.fillRect(0, 0, 256, 256);
    // paralelepípedos
    for (let y = 0; y < 256; y += 32) {
      for (let x = 0; x < 256; x += 32) {
        const off = (y / 32) % 2 === 0 ? 0 : 16;
        const px = (x + off) % 256;
        g.fillStyle = `rgba(${randInt(60, 90)}, ${randInt(50, 75)}, ${randInt(40, 60)}, 0.9)`;
        g.fillRect(px + 1, y + 1, 30, 30);
        g.strokeStyle = 'rgba(20, 15, 10, 0.6)';
        g.lineWidth = 1;
        g.strokeRect(px + 1, y + 1, 30, 30);
        // detalhes
        for (let k = 0; k < 4; k++) {
          g.fillStyle = `rgba(${randInt(40, 70)}, ${randInt(35, 55)}, ${randInt(25, 45)}, 0.4)`;
          g.beginPath();
          g.arc(px + rand(4, 28), y + rand(4, 28), rand(1, 3), 0, TAU);
          g.fill();
        }
      }
    }
  });
  villageGroundPattern = ctx.createPattern(villageGroundTile, 'repeat');
}

/* =========================================================================
   7. DESENHO DE CAMADAS
   ========================================================================= */
function drawLayer(layer, fx, fy, alpha) {
  const w = layer.width;
  const yOff = -160 - camera.y * fy;
  let ox = -(camera.x * fx) % w;
  if (ox > 0) ox -= w;
  ctx.globalAlpha = alpha === undefined ? 1 : alpha;
  for (let x = ox; x < VW; x += w) {
    ctx.drawImage(layer, Math.round(x), Math.round(yOff));
  }
  ctx.globalAlpha = 1;
}

/* =========================================================================
   8. JOGADOR
   ========================================================================= */
class Player {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.r = 16;
    this.baseSpeed = 255;
    this.facing = 0;

    this.maxHp = 100; this.hp = 100;
    this.maxMana = 60; this.mana = 60;

    this.attackCd = 0;
    this.attackTime = -1;
    this.attackDur = 0.34;
    this.hitDone = false;
    this.swingDir = 1;

    this.dashCd = 0;
    this.dashTime = 0;
    this.dashDX = 0; this.dashDY = 0;
    this.invuln = 0;
    this.hitFlash = 0;

    this.novaCd = 0;
    this.rage = 0;
    this.maxRage = 12;

    this.walkPhase = 0;
    this.moving = false;
    this.dead = false;
    this.respawnT = 0;
    this.hurtT = 0;
  }

  update(dt) {
    if (this.dead) {
      this.respawnT -= dt;
      if (this.respawnT <= 0) this.respawn();
      return;
    }

    this.attackCd = Math.max(0, this.attackCd - dt);
    this.dashCd = Math.max(0, this.dashCd - dt);
    this.novaCd = Math.max(0, this.novaCd - dt);
    this.invuln = Math.max(0, this.invuln - dt);
    this.hitFlash = Math.max(0, this.hitFlash - dt * 4);
    this.hurtT = Math.max(0, this.hurtT - dt);
    if (this.rage > 0) this.rage = Math.max(0, this.rage - dt);
    this.mana = Math.min(this.maxMana, this.mana + 7 * dt);

    let ix = 0, iy = 0;
    if (keys['KeyA'] || keys['ArrowLeft']) ix--;
    if (keys['KeyD'] || keys['ArrowRight']) ix++;
    if (keys['KeyW'] || keys['ArrowUp']) iy--;
    if (keys['KeyS'] || keys['ArrowDown']) iy++;

    const mlen = Math.hypot(ix, iy);
    if (mlen > 0) { ix /= mlen; iy /= mlen; }
    this.moving = mlen > 0;

    if (mouse.down) {
      this.facing = Math.atan2(mouse.wy - this.y, mouse.wx - this.x);
    } else if (this.moving) {
      this.facing = Math.atan2(iy, ix);
    }

    const wantDash = keys['ShiftLeft'] || keys['ShiftRight'];
    if (wantDash && this.dashCd <= 0 && this.dashTime <= 0) {
      const dx = this.moving ? ix : Math.cos(this.facing);
      const dy = this.moving ? iy : Math.sin(this.facing);
      this.dashDX = dx; this.dashDY = dy;
      this.dashTime = 0.18;
      this.dashCd = 0.85;
      this.invuln = Math.max(this.invuln, 0.38);
      Audio.sfx('swing');

      if (G.relicEquipped) {
        Audio.sfx('crow');
        for (let i = 0; i < 16; i++) {
          P({
            type: 'crow',
            x: this.x + rand(-24, 24),
            y: this.y + rand(-24, 12),
            vx: -dx * rand(60, 260) + rand(-80, 80),
            vy: -dy * rand(60, 260) + rand(-90, 40),
            life: rand(0.5, 1.0),
            size: rand(7, 14),
            color: 'rgba(30,26,48,0.95)',
            drag: 0.93, grav: -20, add: false, rot: rand(0, TAU)
          });
        }
      }
    }

    if (this.dashTime > 0) {
      this.dashTime -= dt;
      this.x += this.dashDX * 940 * dt;
      this.y += this.dashDY * 940 * dt;
      if (G.relicEquipped && Math.random() < 0.7) {
        P({
          type: 'crow',
          x: this.x + rand(-18, 18), y: this.y + rand(-18, 10),
          vx: rand(-90, 90), vy: rand(-110, -20),
          life: rand(0.35, 0.75), size: rand(6, 11),
          color: 'rgba(22,18,38,0.9)', drag: 0.92, add: false, rot: rand(0, TAU)
        });
      }
    } else {
      const spd = this.baseSpeed * (this.rage > 0 ? 1.32 : 1);
      this.vx = ix * spd;
      this.vy = iy * spd;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
    }

    if (this.moving) this.walkPhase += dt * 11;

    this.x = clamp(this.x, 40, camera.worldW - 40);
    this.y = clamp(this.y, 60, camera.worldH - 40);

    const wantAttack = keys['KeyJ'] || keys['Space'] || mouse.down;
    if (wantAttack && this.attackCd <= 0 && this.attackTime < 0) this.startAttack();

    if (this.attackTime >= 0) {
      this.attackTime += dt;
      const t = this.attackTime / this.attackDur;

      if (!this.hitDone && t > 0.34) {
        this.hitDone = true;
        this.applyHit();
      }

      if (t < 0.8 && G.legendaryEquipped) {
        const ang = this.swordAngle();
        const tipX = this.x + Math.cos(ang) * 62;
        const tipY = this.y - 8 + Math.sin(ang) * 62;
        P({
          type: 'ice', x: tipX, y: tipY,
          vx: rand(-40, 40), vy: rand(-40, 10),
          life: rand(0.25, 0.55), size: rand(2, 4.5),
          color: pick(['#bff6ff', '#7fe4ff', '#59c8f0']),
          drag: 0.9, grav: 40
        });
      }
      if (t >= 1) this.attackTime = -1;
    }

    if (keys['KeyQ'] && this.novaCd <= 0 && this.mana >= 20) {
      this.castNova();
    }
  }

  swordAngle() {
    if (this.attackTime >= 0) {
      const t = this.attackTime / this.attackDur;
      return this.facing - 1.45 * this.swingDir + (t * 2.9 * this.swingDir);
    }
    return this.facing + 0.55;
  }

  startAttack() {
    this.attackCd = 0.40;
    this.attackTime = 0;
    this.hitDone = false;
    this.swingDir *= -1;
    Audio.sfx('swing');

    for (const n of G.npcs) {
      if (n.onPlayerAttackNear) n.onPlayerAttackNear(this);
    }
  }

  applyHit() {
    const range = 92;
    const arc = 1.25;
    const baseDmg = 26 * (this.rage > 0 ? 1.5 : 1);
    const targets = [boss, ...G.enemies, ...G.npcs].filter(t => t && !t.dead);

    for (const t of targets) {
      const d = Math.hypot(t.x - this.x, t.y - this.y);
      if (d > range + (t.r || 20)) continue;
      const a = Math.atan2(t.y - this.y, t.x - this.x);
      if (Math.abs(angDiff(a, this.facing)) > arc) continue;

      if (t.takeDamage) {
        t.takeDamage(baseDmg, Math.atan2(t.y - this.y, t.x - this.x));
        Audio.sfx('hit');
        burstSparks(
          this.x + Math.cos(a) * (d * 0.8),
          this.y + Math.sin(a) * (d * 0.8),
          10, '#ffe6a8', 320
        );
        if (G.legendaryEquipped) {
          burstIce(
            this.x + Math.cos(a) * (d * 0.8),
            this.y + Math.sin(a) * (d * 0.8),
            8, 0, 260
          );
        }
        camera.shake(4, 0.12);
      }
    }
  }

  castNova() {
    this.mana -= 20;
    this.novaCd = 2.8;
    Audio.sfx('nova');
    camera.shake(10, 0.3);

    P({
      type: 'ring', x: this.x, y: this.y,
      life: 0.55, size: 20, color: 'rgba(140, 230, 255, 0.9)',
      grow: 320, add: true, drag: 1
    });

    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * TAU;
      P({
        type: 'ice',
        x: this.x + Math.cos(a) * 20,
        y: this.y + Math.sin(a) * 20,
        vx: Math.cos(a) * rand(240, 520),
        vy: Math.sin(a) * rand(240, 520),
        life: rand(0.4, 0.9), size: rand(3, 6),
        color: pick(['#bff6ff', '#7fe4ff', '#ffffff']),
        drag: 0.9, grav: 30
      });
    }

    const targets = [boss, ...G.enemies].filter(t => t && !t.dead);
    for (const t of targets) {
      const d = Math.hypot(t.x - this.x, t.y - this.y);
      if (d < 170) {
        t.takeDamage(38 * (this.rage > 0 ? 1.5 : 1), Math.atan2(t.y - this.y, t.x - this.x));
        if (t.slow) t.slow = 1.5;
      }
    }
  }

  takeDamage(dmg, ang) {
    if (this.invuln > 0 || this.dead) return;
    this.hp -= dmg;
    this.hitFlash = 1;
    this.hurtT = 0.35;
    this.invuln = 0.6;
    camera.shake(9, 0.28);
    Audio.sfx('hurt');
    this.x = clamp(this.x + Math.cos(ang) * 24, 40, camera.worldW - 40);
    this.y = clamp(this.y + Math.sin(ang) * 24, 60, camera.worldH - 40);
    burstSparks(this.x, this.y, 12, '#ff6b6b', 260);

    if (this.hp <= 0) { this.hp = 0; this.die(); }
  }

  die() {
    this.dead = true;
    this.respawnT = 2.4;
    Audio.sfx('die');
    camera.shake(16, 0.6);
    burstShards(this.x, this.y, 40, ['#ff8f6b', '#ffd166', '#ffffff']);
  }

  respawn() {
    this.dead = false;
    this.hp = this.maxHp;
    this.mana = this.maxMana;
    this.x = SPAWN.x; this.y = SPAWN.y;
    this.invuln = 2;
    burstSparks(this.x, this.y, 30, '#9fe8ff', 300);
  }

  draw(g) {
    g.save();
    g.globalAlpha = 0.38;
    g.fillStyle = '#000';
    g.beginPath(); g.ellipse(this.x, this.y + 16, 19, 7, 0, 0, TAU); g.fill();
    g.restore();

    if (this.dead) {
      g.save();
      g.globalAlpha = 0.5;
      g.fillStyle = '#7a2230';
      g.beginPath(); g.ellipse(this.x, this.y + 6, 22, 10, 0, 0, TAU); g.fill();
      g.restore();
      return;
    }

    const bob = Math.sin(this.walkPhase) * 2;
    const flip = Math.cos(this.facing) >= 0 ? 1 : -1;

    if (this.rage > 0) {
      const rg = g.createRadialGradient(this.x, this.y, 4, this.x, this.y, 52);
      rg.addColorStop(0, 'rgba(255, 60, 40, 0.28)');
      rg.addColorStop(1, 'rgba(255, 60, 40, 0)');
      g.fillStyle = rg;
      g.beginPath(); g.arc(this.x, this.y, 52, 0, TAU); g.fill();
    }

    if (this.invuln > 0 && Math.floor(G.time * 22) % 2 === 0) g.globalAlpha = 0.45;

    g.save();
    g.translate(this.x, this.y + bob);
    g.scale(flip, 1);

    const capeSway = Math.sin(G.time * 5 + this.walkPhase) * 4;
    g.fillStyle = '#1d2a52';
    g.beginPath();
    g.moveTo(-6, -16);
    g.quadraticCurveTo(-20 + capeSway, 2, -14 + capeSway, 18);
    g.quadraticCurveTo(0, 12, 8, 18);
    g.quadraticCurveTo(10, 0, 6, -16);
    g.closePath();
    g.fill();

    g.strokeStyle = '#2b3350';
    g.lineWidth = 6;
    g.lineCap = 'round';
    const legSwing = Math.sin(this.walkPhase) * 7;
    g.beginPath(); g.moveTo(-4, 8); g.lineTo(-4 + legSwing, 20); g.stroke();
    g.beginPath(); g.moveTo(4, 8); g.lineTo(4 - legSwing, 20); g.stroke();

    const bg = g.createLinearGradient(-12, -18, 12, 10);
    bg.addColorStop(0, '#5a7fb5');
    bg.addColorStop(0.5, '#33507d');
    bg.addColorStop(1, '#1c2c48');
    g.fillStyle = bg;
    g.beginPath();
    g.roundRect(-11, -18, 22, 28, 7);
    g.fill();

    g.fillStyle = 'rgba(160, 210, 255, 0.35)';
    g.beginPath(); g.roundRect(-7, -14, 14, 10, 4); g.fill();

    g.fillStyle = '#141a2c';
    g.beginPath(); g.arc(0, -25, 11, 0, TAU); g.fill();
    g.fillStyle = '#e8c9a0';
    g.beginPath(); g.arc(1, -24, 7.5, 0, TAU); g.fill();
    g.fillStyle = this.rage > 0 ? '#ff6a4a' : '#9fe8ff';
    g.beginPath(); g.arc(4, -25, 1.9, 0, TAU); g.fill();

    g.restore();
    g.globalAlpha = 1;

    const ang = this.swordAngle();
    g.save();
    g.translate(this.x + Math.cos(this.facing) * 3, this.y - 8 + bob);
    g.rotate(ang);

    if (G.legendaryEquipped) {
      g.shadowColor = '#5fe3ff';
      g.shadowBlur = 22;
    }

    const bladeGrad = g.createLinearGradient(8, 0, 66, 0);
    bladeGrad.addColorStop(0, '#8fd9f0');
    bladeGrad.addColorStop(0.5, '#e9fdff');
    bladeGrad.addColorStop(1, '#4fbfe6');
    g.fillStyle = bladeGrad;
    g.beginPath();
    g.moveTo(10, -3.4);
    g.lineTo(58, -2.2);
    g.lineTo(68, 0);
    g.lineTo(58, 2.2);
    g.lineTo(10, 3.4);
    g.closePath();
    g.fill();

    g.strokeStyle = 'rgba(90, 220, 255, 0.9)';
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(24, -2.6); g.lineTo(31, 1.4); g.lineTo(38, -2.0);
    g.moveTo(44, 2.0); g.lineTo(50, -1.0);
    g.stroke();

    g.shadowBlur = 0;
    g.fillStyle = '#b39355';
    g.beginPath(); g.roundRect(4, -6, 6, 12, 2); g.fill();
    g.fillStyle = '#4a3520';
    g.beginPath(); g.roundRect(-6, -2.4, 12, 4.8, 2); g.fill();

    if (G.legendaryEquipped) {
      const pulse = 0.55 + Math.sin(G.time * 7) * 0.35;
      g.globalCompositeOperation = 'lighter';
      const tipG = g.createRadialGradient(66, 0, 0, 66, 0, 26);
      tipG.addColorStop(0, `rgba(160, 245, 255, ${0.8 * pulse})`);
      tipG.addColorStop(1, 'rgba(80, 200, 255, 0)');
      g.fillStyle = tipG;
      g.beginPath(); g.arc(66, 0, 26, 0, TAU); g.fill();
      g.globalCompositeOperation = 'source-over';
    }

    g.restore();

    if (this.hitFlash > 0) {
      g.save();
      g.globalAlpha = this.hitFlash * 0.55;
      g.fillStyle = '#ff5a5a';
      g.beginPath(); g.arc(this.x, this.y - 6, 30, 0, TAU); g.fill();
      g.restore();
    }
  }
}

/* =========================================================================
   9. BOSS
   ========================================================================= */
class Morgath {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.r = 95;
    this.maxHp = 1400;
    this.hp = 1400;
    this.phase = 1;
    this.dead = false;
    this.deathT = 0;
    this.state = 'idle';
    this.stateT = 0;
    this.hitDone = false;
    this.hitFlash = 0;
    this.spikes = [];
    this.projectiles = [];
    this.rings = [];
    this.target = null;
    this.contactCd = 0;
  }

  setState(s) {
    this.state = s;
    this.stateT = 0;
    this.hitDone = false;
    if (s === 'slam') this.target = null;
  }

  update(dt, p) {
    this.stateT += dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt * 3);
    this.contactCd = Math.max(0, this.contactCd - dt);

    if (this.dead) {
      this.deathT += dt;
      if (this.deathT < 3 && Math.random() < 0.5) {
        burstSparks(
          this.x + rand(-90, 90), this.y + rand(-160, 40),
          randInt(1, 3), pick(['#ff8a5c', '#7dff9b', '#ffd166']), 220
        );
      }
      return;
    }

    const dx = p.x - this.x, dy = p.y - this.y;
    const d = Math.hypot(dx, dy) || 1;

    if (d < this.r + 20 && this.contactCd <= 0 && !p.dead) {
      p.takeDamage(this.phase === 2 ? 16 : 11, Math.atan2(p.y - this.y, p.x - this.x));
      this.contactCd = 0.9;
    }

    switch (this.state) {
      case 'idle': {
        const spd = this.phase === 2 ? 62 : 38;
        if (d > 175) {
          this.x += (dx / d) * spd * dt;
          this.y += (dy / d) * spd * dt;
        }
        const wait = this.phase === 2 ? 0.85 : 1.65;
        if (this.stateT > wait) {
          if (this.phase === 2) {
            const r = Math.random();
            this.setState(r < 0.55 ? 'slam' : (r < 0.82 ? 'volley' : 'frenzy'));
          } else {
            this.setState('slam');
          }
        }
        break;
      }
      case 'slam': {
        if (this.stateT < 0.05 && !this.target) {
          this.target = { x: p.x, y: p.y };
        }
        if (this.stateT > 0.95 && !this.hitDone) {
          this.hitDone = true;
          this.doSlam();
        }
        if (this.stateT > 1.55) this.setState('idle');
        break;
      }
      case 'volley': {
        if (this.stateT > 0.55 && !this.hitDone) {
          this.hitDone = true;
          this.doVolley(p);
        }
        if (this.stateT > 1.1) this.setState('idle');
        break;
      }
      case 'frenzy': {
        if (this.stateT > 1.9) this.setState('idle');
        break;
      }
    }

    for (let i = this.spikes.length - 1; i >= 0; i--) {
      const s = this.spikes[i];
      s.t += dt;
      if (!s.hit && s.t < 0.22 && !p.dead) {
        if (Math.hypot(p.x - s.x, p.y - s.y) < 42) {
          s.hit = true;
          p.takeDamage(this.phase === 2 ? 16 : 12, Math.atan2(p.y - s.y, p.x - s.x));
        }
      }
      if (s.t > 1.25) this.spikes.splice(i, 1);
    }

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      pr.life -= dt;
      pr.t += dt;
      const ax = p.x - pr.x, ay = p.y - pr.y;
      const ad = Math.hypot(ax, ay) || 1;
      pr.vx += (ax / ad) * 130 * dt;
      pr.vy += (ay / ad) * 130 * dt;
      const sp = Math.hypot(pr.vx, pr.vy);
      const maxSp = 240;
      if (sp > maxSp) { pr.vx = pr.vx / sp * maxSp; pr.vy = pr.vy / sp * maxSp; }
      pr.x += pr.vx * dt;
      pr.y += pr.vy * dt;

      P({
        type: 'spark', x: pr.x, y: pr.y,
        vx: rand(-20, 20), vy: rand(-20, 20),
        life: 0.35, size: 2,
        color: this.phase === 2 ? '#ff6a4a' : '#7dff9b',
        drag: 0.9, grav: -10
      });

      if (Math.hypot(p.x - pr.x, p.y - pr.y) < 26 && !p.dead) {
        p.takeDamage(13, Math.atan2(p.y - pr.y, p.x - pr.x));
        pr.life = 0;
        burstSparks(pr.x, pr.y, 14, '#ff8a5c', 260);
      }
      if (pr.life <= 0) this.projectiles.splice(i, 1);
    }

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const rg = this.rings[i];
      rg.t += dt;
      rg.r += 420 * dt;
      if (!rg.hit && Math.abs(Math.hypot(p.x - rg.x, p.y - rg.y) - rg.r) < 30 && !p.dead) {
        rg.hit = true;
        p.takeDamage(18, Math.atan2(p.y - rg.y, p.x - rg.x));
      }
      if (rg.r > 620) this.rings.splice(i, 1);
    }
  }

  doSlam() {
    Audio.sfx('slam');
    camera.shake(22, 0.6);
    const t = this.target || { x: this.x, y: this.y };
    const step = 74;
    for (let x = t.x - 6 * step; x <= t.x + 6 * step; x += step) {
      this.spikes.push({ x, y: t.y, t: 0, hit: false });
    }
    for (let y = t.y - 4 * step; y <= t.y + 4 * step; y += step) {
      this.spikes.push({ x: t.x, y, t: 0, hit: false });
    }
    for (let i = 0; i < 40; i++) {
      const a = rand(0, TAU);
      P({
        type: 'spark',
        x: t.x, y: t.y,
        vx: Math.cos(a) * rand(100, 460),
        vy: Math.sin(a) * rand(60, 300),
        life: rand(0.35, 0.8), size: rand(2, 5),
        color: pick(['#8a6a3a', '#c9a06a', '#5c4326']),
        drag: 0.9, grav: 420, add: false
      });
    }
  }

  doVolley(p) {
    Audio.sfx('ice');
    for (let i = 0; i < 5; i++) {
      const a = Math.atan2(p.y - this.y, p.x - this.x) + rand(-0.7, 0.7);
      this.projectiles.push({
        x: this.x + Math.cos(a) * 70,
        y: this.y + Math.sin(a) * 70,
        vx: Math.cos(a) * 180,
        vy: Math.sin(a) * 180,
        life: 4.5, t: 0
      });
    }
  }

  doFrenzy() {
    Audio.sfx('slam');
    camera.shake(28, 0.9);
    this.rings.push({ x: this.x, y: this.y, r: 40, t: 0, hit: false });
    this.rings.push({ x: this.x, y: this.y, r: 140, t: 0, hit: false });
    for (let i = 0; i < 60; i++) {
      const a = rand(0, TAU);
      P({
        type: 'shard', x: this.x, y: this.y,
        vx: Math.cos(a) * rand(120, 520),
        vy: Math.sin(a) * rand(120, 520),
        life: rand(0.6, 1.4), size: rand(4, 10),
        color: pick(['#ff6a4a', '#ffb347', '#8a3a1a']),
        grav: 400, rot: rand(0, TAU), rotV: rand(-8, 8)
      });
    }
  }

  takeDamage(dmg, ang) {
    if (this.dead) return;
    this.hp -= dmg;
    this.hitFlash = 1;
    burstSparks(this.x + rand(-50, 50), this.y + rand(-90, 10), 8, '#ffd166', 240);
    if (this.phase === 1 && this.hp <= this.maxHp * 0.5) this.enterPhase2();
    if (this.hp <= 0) { this.hp = 0; this.die(); }
  }

  enterPhase2() {
    this.phase = 2;
    Audio.tempo = 1.55;
    camera.shake(26, 1.2);
    Audio.sfx('slam');
    this.setState('frenzy');
    this.doFrenzy();
    for (let i = 0; i < 120; i++) {
      const a = rand(0, TAU);
      P({
        type: 'spark', x: this.x, y: this.y,
        vx: Math.cos(a) * rand(80, 560),
        vy: Math.sin(a) * rand(80, 560),
        life: rand(0.5, 1.3), size: rand(2, 5),
        color: pick(['#ff4a2a', '#ff8a5c', '#ffd166']),
        drag: 0.92, grav: 120
      });
    }
  }

  die() {
    this.dead = true;
    this.deathT = 0;
    G.over = true;
    Audio.tempo = 0.8;
    Audio.sfx('die');
    camera.shake(30, 1.6);
    for (let i = 0; i < 160; i++) {
      const a = rand(0, TAU);
      P({
        type: pick(['shard', 'spark', 'ice']),
        x: this.x + rand(-60, 60),
        y: this.y + rand(-120, 40),
        vx: Math.cos(a) * rand(60, 640),
        vy: Math.sin(a) * rand(60, 640) - 120,
        life: rand(0.9, 2.2), size: rand(3, 11),
        color: pick(['#7dff9b', '#ffd166', '#ff8a5c', '#bff6ff']),
        grav: 420, rot: rand(0, TAU), rotV: rand(-9, 9)
      });
    }
    document.getElementById('bossbar').classList.add('hidden');
  }

  draw(g) {
    const t = G.time;
    const p2 = this.phase === 2;
    const glowColor = p2 ? '#ff5a3c' : '#7dff9b';
    const bodyColor = p2 ? '#3a1f1a' : '#2e2318';

    g.save();
    g.globalAlpha = 0.45;
    g.fillStyle = '#000';
    g.beginPath(); g.ellipse(this.x, this.y + this.r * 0.55, this.r * 1.2, this.r * 0.42, 0, 0, TAU); g.fill();
    g.restore();

    if (p2) {
      const ag = g.createRadialGradient(this.x, this.y - 60, 0, this.x, this.y - 60, 240);
      ag.addColorStop(0, 'rgba(255, 70, 40, 0.16)');
      ag.addColorStop(1, 'rgba(255, 70, 40, 0)');
      g.fillStyle = ag;
      g.beginPath(); g.arc(this.x, this.y - 60, 240, 0, TAU); g.fill();
    }

    g.save();
    g.translate(this.x, this.y);

    if (this.dead) {
      g.rotate(Math.min(0.5, this.deathT * 0.3));
      g.globalAlpha = Math.max(0, 1 - this.deathT / 3);
    }

    const breathe = Math.sin(t * 1.6) * 6;

    g.strokeStyle = '#1a1208';
    g.lineWidth = 18;
    g.lineCap = 'round';
    for (let s = -1; s <= 1; s += 2) {
      g.beginPath();
      g.moveTo(s * 38, 20);
      g.quadraticCurveTo(s * 72, 62, s * 98, 80);
      g.stroke();
      g.beginPath();
      g.moveTo(s * 52, 40);
      g.quadraticCurveTo(s * 92, 58, s * 118, 44);
      g.stroke();
    }

    g.fillStyle = bodyColor;
    g.beginPath();
    g.moveTo(-72, 60);
    g.quadraticCurveTo(-92, -60, -52, -122 + breathe);
    g.quadraticCurveTo(0, -152 + breathe, 52, -122 + breathe);
    g.quadraticCurveTo(92, -60, 72, 60);
    g.closePath();
    g.fill();

    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = 4;
    for (let i = -2; i <= 2; i++) {
      g.beginPath();
      g.moveTo(i * 20, 52);
      g.quadraticCurveTo(i * 28 + Math.sin(t * 1.4 + i) * 6, -40, i * 16, -112 + breathe);
      g.stroke();
    }

    g.fillStyle = p2 ? 'rgba(140, 50, 40, 0.4)' : 'rgba(80, 160, 90, 0.35)';
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      g.beginPath();
      g.ellipse(Math.cos(a) * 54, -60 + Math.sin(a) * 42 + breathe, 17, 10, a, 0, TAU);
      g.fill();
    }

    const swingT = this.state === 'slam' ? Math.min(1, this.stateT / 0.95) : 0;
    const swing = Math.sin(swingT * Math.PI) * 1.25 + Math.sin(t * 1.2) * 0.12;
    for (let s = -1; s <= 1; s += 2) {
      g.save();
      g.translate(s * 62, -84 + breathe);
      g.rotate(s * swing);
      g.strokeStyle = '#241a10';
      g.lineWidth = 22;
      g.beginPath();
      g.moveTo(0, 0);
      g.quadraticCurveTo(s * 52, 32, s * 84, 74);
      g.stroke();
      g.fillStyle = '#3a2a18';
      g.beginPath(); g.arc(s * 84, 74, 17, 0, TAU); g.fill();
      g.restore();
    }

    g.fillStyle = '#241a10';
    g.beginPath(); g.ellipse(0, -142 + breathe, 47, 41, 0, 0, TAU); g.fill();

    g.strokeStyle = '#241a10';
    g.lineWidth = 7;
    for (let s = -1; s <= 1; s += 2) {
      g.beginPath();
      g.moveTo(s * 20, -172 + breathe);
      g.quadraticCurveTo(s * 52, -212 + breathe, s * 32, -244 + breathe);
      g.stroke();
      g.beginPath();
      g.moveTo(s * 32, -216 + breathe);
      g.lineTo(s * 64, -226 + breathe);
      g.stroke();
    }

    g.save();
    g.shadowColor = glowColor;
    g.shadowBlur = 32;
    g.fillStyle = glowColor;
    g.beginPath(); g.ellipse(-17, -148 + breathe, 9, 5.5, 0.22, 0, TAU); g.fill();
    g.beginPath(); g.ellipse(17, -148 + breathe, 9, 5.5, -0.22, 0, TAU); g.fill();
    g.restore();

    if (this.hitFlash > 0.01) {
      g.globalAlpha = this.hitFlash * 0.35;
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.ellipse(0, -50, 82, 150, 0, 0, TAU);
      g.fill();
      g.globalAlpha = 1;
    }

    g.restore();

    if (this.state === 'slam' && this.target) {
      const prog = Math.min(1, this.stateT / 0.95);
      g.save();
      g.globalAlpha = 0.25 + prog * 0.4;
      g.strokeStyle = '#ff4a2a';
      g.lineWidth = 4;
      g.setLineDash([16, 12]);
      g.beginPath();
      g.moveTo(this.target.x - 460, this.target.y);
      g.lineTo(this.target.x + 460, this.target.y);
      g.moveTo(this.target.x, this.target.y - 320);
      g.lineTo(this.target.x, this.target.y + 320);
      g.stroke();
      g.setLineDash([]);
      g.globalAlpha = 0.15 + prog * 0.25;
      g.fillStyle = '#ff4a2a';
      g.beginPath(); g.arc(this.target.x, this.target.y, 60 * prog, 0, TAU); g.fill();
      g.restore();
    }

    for (const s of this.spikes) {
      const rise = Math.min(1, s.t / 0.16);
      const fall = Math.max(0, (s.t - 0.85) / 0.4);
      const h = 58 * rise * (1 - fall);
      if (h <= 1) continue;
      g.save();
      g.globalAlpha = 0.95 * (1 - fall);
      g.fillStyle = p2 ? '#4a2218' : '#3a2a1a';
      g.beginPath();
      g.moveTo(s.x - 15, s.y);
      g.lineTo(s.x, s.y - h);
      g.lineTo(s.x + 15, s.y);
      g.closePath();
      g.fill();
      g.globalAlpha = 0.55 * (1 - fall);
      g.strokeStyle = glowColor;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(s.x - 6, s.y);
      g.lineTo(s.x, s.y - h * 0.92);
      g.stroke();
      g.restore();
    }

    for (const pr of this.projectiles) {
      g.save();
      g.shadowColor = glowColor;
      g.shadowBlur = 24;
      g.fillStyle = p2 ? '#ff6a4a' : '#7dff9b';
      g.beginPath(); g.arc(pr.x, pr.y, 11 + Math.sin(pr.t * 12) * 2, 0, TAU); g.fill();
      g.restore();
    }

    for (const rg of this.rings) {
      g.save();
      g.globalAlpha = clamp(1 - rg.r / 620, 0, 1) * 0.8;
      g.strokeStyle = p2 ? '#ff6a4a' : '#7dff9b';
      g.lineWidth = 8;
      g.beginPath(); g.arc(rg.x, rg.y, rg.r, 0, TAU); g.stroke();
      g.restore();
    }
  }
}

/* =========================================================================
   10. INIMIGOS
   ========================================================================= */
class MossStalker {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.r = 22;
    this.maxHp = 48; this.hp = 48;
    this.state = 'hide';
    this.alpha = 0.12;
    this.t = rand(0, 4);
    this.hitFlash = 0;
    this.dead = false;
    this.leapVX = 0; this.leapVY = 0;
    this.z = 0; this.vz = 0;
    this.attackCd = 0;
    this.slow = 0;
  }

  update(dt, p) {
    if (this.dead) return;
    this.t += dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt * 3);
    this.attackCd = Math.max(0, this.attackCd - dt);
    if (this.slow > 0) this.slow -= dt;

    const dx = p.x - this.x, dy = p.y - this.y;
    const d = Math.hypot(dx, dy) || 1;

    switch (this.state) {
      case 'hide': {
        this.alpha = lerp(this.alpha, 0.12 + Math.sin(this.t * 2) * 0.03, dt * 3);
        if (d < 320 && !p.dead) {
          this.state = 'chase';
          burstSparks(this.x, this.y, 16, '#7dff9b', 200);
          Audio.sfx('crow');
        }
        break;
      }
      case 'chase': {
        this.alpha = lerp(this.alpha, 1, dt * 8);
        const spd = (this.slow > 0 ? 90 : 168);
        this.x += (dx / d) * spd * dt;
        this.y += (dy / d) * spd * dt;
        if (d < 150 && this.attackCd <= 0) {
          this.state = 'leap';
          this.leapVX = (dx / d) * 420;
          this.leapVY = (dy / d) * 420;
          this.vz = 300;
          this.z = 0;
          this.attackCd = 1.6;
        }
        break;
      }
      case 'leap': {
        this.x += this.leapVX * dt;
        this.y += this.leapVY * dt;
        this.vz -= 900 * dt;
        this.z += this.vz * dt;
        if (this.z <= 0) {
          this.z = 0;
          this.state = 'chase';
          camera.shake(4, 0.1);
          burstSparks(this.x, this.y, 10, '#5c8a4a', 200);
          if (Math.hypot(p.x - this.x, p.y - this.y) < 60 && !p.dead) {
            p.takeDamage(11, Math.atan2(p.y - this.y, p.x - this.x));
          }
        }
        break;
      }
    }

    this.x = clamp(this.x, 30, camera.worldW - 30);
    this.y = clamp(this.y, 30, camera.worldH - 30);
  }

  takeDamage(dmg, ang) {
    if (this.dead) return;
    this.hp -= dmg;
    this.hitFlash = 1;
    if (this.state === 'hide') this.state = 'chase';
    this.x += Math.cos(ang) * 18;
    this.y += Math.sin(ang) * 18;
    burstSparks(this.x, this.y, 8, '#7dff9b', 200);
    if (this.hp <= 0) this.die();
  }

  die() {
    this.dead = true;
    Audio.sfx('hit');
    burstSparks(this.x, this.y, 26, '#7dff9b', 320);
    for (let i = 0; i < 10; i++) {
      P({
        type: 'shard', x: this.x, y: this.y,
        vx: rand(-200, 200), vy: rand(-260, -40),
        life: rand(0.6, 1.2), size: rand(3, 7),
        color: '#4a7a3a', grav: 500, rot: rand(0, TAU), rotV: rand(-6, 6), add: false
      });
    }
  }

  draw(g) {
    if (this.dead) return;
    const bob = Math.sin(this.t * 6) * 2;
    g.save();
    g.globalAlpha = 0.3 * this.alpha;
    g.fillStyle = '#000';
    g.beginPath(); g.ellipse(this.x, this.y + 14, 22, 8, 0, 0, TAU); g.fill();
    g.restore();

    g.save();
    g.globalAlpha = this.alpha;
    g.translate(this.x, this.y - this.z + bob);

    const bodyGrad = g.createLinearGradient(0, -20, 0, 20);
    bodyGrad.addColorStop(0, '#3d5c34');
    bodyGrad.addColorStop(1, '#1b2a18');
    g.fillStyle = bodyGrad;
    g.beginPath();
    g.ellipse(0, 0, 24, 14, 0, 0, TAU);
    g.fill();

    g.strokeStyle = '#16200f';
    g.lineWidth = 4;
    g.lineCap = 'round';
    for (let i = -1; i <= 1; i += 2) {
      g.beginPath(); g.moveTo(i * 10, 8); g.lineTo(i * 14, 18); g.stroke();
    }

    g.fillStyle = '#33502c';
    g.beginPath(); g.ellipse(20, -6, 12, 10, 0.2, 0, TAU); g.fill();
    g.fillStyle = '#22381d';
    g.beginPath(); g.moveTo(16, -14); g.lineTo(20, -24); g.lineTo(25, -12); g.closePath(); g.fill();

    g.shadowColor = '#a8ff7d';
    g.shadowBlur = 16;
    g.fillStyle = '#c6ff9a';
    g.beginPath(); g.arc(24, -8, 2.4, 0, TAU); g.fill();
    g.shadowBlur = 0;

    g.fillStyle = 'rgba(110, 200, 110, 0.45)';
    for (let i = 0; i < 5; i++) {
      g.beginPath();
      g.ellipse(rand(-18, 8), rand(-12, 6), rand(4, 8), rand(2, 4), rand(0, TAU), 0, TAU);
      g.fill();
    }

    if (this.hitFlash > 0.01) {
      g.globalAlpha = this.alpha * this.hitFlash * 0.7;
      g.fillStyle = '#ffffff';
      g.beginPath(); g.ellipse(0, 0, 26, 18, 0, 0, TAU); g.fill();
    }

    g.restore();
    g.globalAlpha = 1;
  }
}

class GlassGolem {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.r = 26;
    this.maxHp = 95; this.hp = 95;
    this.dead = false;
    this.hitFlash = 0;
    this.t = rand(0, 5);
    this.state = 'idle';
    this.stateT = 0;
    this.beamAngle = 0;
    this.beamTarget = null;
    this.fireCd = 2.2;
    this.slow = 0;
  }

  update(dt, p) {
    if (this.dead) return;
    this.t += dt;
    this.stateT += dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt * 3);
    if (this.slow > 0) this.slow -= dt;

    const dx = p.x - this.x, dy = p.y - this.y;
    const d = Math.hypot(dx, dy) || 1;

    if (this.state === 'idle') {
      const ideal = 260;
      const spd = (d > ideal + 40 ? 74 : d < ideal - 60 ? -70 : 0) * (this.slow > 0 ? 0.5 : 1);
      this.x += (dx / d) * spd * dt;
      this.y += (dy / d) * spd * dt + Math.sin(this.t * 1.8) * 12 * dt;

      this.fireCd -= dt;
      if (this.fireCd <= 0 && d < 640) {
        this.state = 'charge';
        this.stateT = 0;
        this.beamTarget = { x: p.x, y: p.y };
        this.beamAngle = Math.atan2(p.y - this.y, p.x - this.x);
      }
    } else if (this.state === 'charge') {
      if (this.stateT > 1.15) {
        this.state = 'fire';
        this.stateT = 0;
        this.fire();
      }
    } else if (this.state === 'fire') {
      if (this.stateT > 0.2) {
        this.state = 'idle';
        this.stateT = 0;
        this.fireCd = rand(2.0, 3.0);
      }
    }

    this.x = clamp(this.x, 30, camera.worldW - 30);
    this.y = clamp(this.y, 30, camera.worldH - 30);
  }

  fire() {
    Audio.sfx('ice');
    camera.shake(6, 0.2);
    const a = this.beamAngle;
    const len = 900;
    const ex = this.x + Math.cos(a) * len;
    const ey = this.y + Math.sin(a) * len;

    const p = player;
    const t = clamp(((p.x - this.x) * Math.cos(a) + (p.y - this.y) * Math.sin(a)) / len, 0, 1);
    const px = this.x + Math.cos(a) * len * t;
    const py = this.y + Math.sin(a) * len * t;
    if (Math.hypot(p.x - px, p.y - py) < 26 && !p.dead) {
      p.takeDamage(19, a);
    }

    for (let i = 0; i < 36; i++) {
      const tt = Math.random();
      P({
        type: 'spark',
        x: lerp(this.x, ex, tt),
        y: lerp(this.y, ey, tt),
        vx: rand(-60, 60), vy: rand(-60, 60),
        life: rand(0.2, 0.55), size: rand(1.5, 3.5),
        color: pick(['#9fe8ff', '#d9f7ff', '#5fbfe8']),
        drag: 0.9
      });
    }
  }

  takeDamage(dmg, ang) {
    if (this.dead) return;
    this.hp -= dmg;
    this.hitFlash = 1;
    burstSparks(this.x, this.y, 10, '#9fe8ff', 260);
    if (this.hp <= 0) this.die();
  }

  die() {
    this.dead = true;
    Audio.sfx('shatter');
    camera.shake(10, 0.35);
    burstShards(this.x, this.y, 160, ['#9fe8ff', '#c9a7ff', '#ffd166', '#7dffb0', '#ff7fa8']);
    P({ type: 'ring', x: this.x, y: this.y, life: 0.5, size: 16, grow: 380, color: 'rgba(159,232,255,0.9)', drag: 1 });
  }

  draw(g) {
    if (this.dead) return;
    const float = Math.sin(this.t * 1.9) * 6;

    g.save();
    g.globalAlpha = 0.28;
    g.fillStyle = '#000';
    g.beginPath(); g.ellipse(this.x, this.y + 34, 24, 9, 0, 0, TAU); g.fill();
    g.restore();

    g.save();
    g.translate(this.x, this.y + float);

    if (this.state === 'charge') {
      const prog = Math.min(1, this.stateT / 1.15);
      g.save();
      g.globalAlpha = 0.15 + prog * 0.55;
      g.strokeStyle = '#9fe8ff';
      g.lineWidth = 2 + prog * 4;
      g.setLineDash([14, 10]);
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(Math.cos(this.beamAngle) * 900, Math.sin(this.beamAngle) * 900);
      g.stroke();
      g.setLineDash([]);
      g.restore();
    }

    const cg = g.createLinearGradient(-26, -34, 26, 34);
    cg.addColorStop(0, 'rgba(180, 240, 255, 0.9)');
    cg.addColorStop(0.45, 'rgba(90, 160, 220, 0.75)');
    cg.addColorStop(1, 'rgba(120, 90, 200, 0.8)');
    g.fillStyle = cg;
    g.shadowColor = '#9fe8ff';
    g.shadowBlur = 22;

    g.beginPath();
    g.moveTo(0, -34);
    g.lineTo(24, -12);
    g.lineTo(20, 22);
    g.lineTo(0, 34);
    g.lineTo(-20, 22);
    g.lineTo(-24, -12);
    g.closePath();
    g.fill();

    g.shadowBlur = 0;

    g.strokeStyle = 'rgba(255,255,255,0.5)';
    g.lineWidth = 1.4;
    g.beginPath();
    g.moveTo(0, -34); g.lineTo(0, 34);
    g.moveTo(-24, -12); g.lineTo(20, 22);
    g.moveTo(24, -12); g.lineTo(-20, 22);
    g.stroke();

    const pulse = 0.7 + Math.sin(this.t * 6) * 0.3;
    g.globalCompositeOperation = 'lighter';
    const ng = g.createRadialGradient(0, 0, 0, 0, 0, 26);
    ng.addColorStop(0, `rgba(220, 255, 255, ${0.9 * pulse})`);
    ng.addColorStop(1, 'rgba(120, 200, 255, 0)');
    g.fillStyle = ng;
    g.beginPath(); g.arc(0, 0, 26, 0, TAU); g.fill();
    g.globalCompositeOperation = 'source-over';

    if (this.hitFlash > 0.01) {
      g.globalAlpha = this.hitFlash * 0.7;
      g.fillStyle = '#ffffff';
      g.beginPath(); g.arc(0, 0, 30, 0, TAU); g.fill();
    }

    g.restore();

    if (this.state === 'fire') {
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = 0.9;
      const ex = Math.cos(this.beamAngle) * 900;
      const ey = Math.sin(this.beamAngle) * 900;
      const lg = g.createLinearGradient(this.x, this.y, this.x + ex, this.y + ey);
      lg.addColorStop(0, 'rgba(220, 255, 255, 1)');
      lg.addColorStop(0.6, 'rgba(120, 220, 255, 0.7)');
      lg.addColorStop(1, 'rgba(120, 220, 255, 0)');
      g.strokeStyle = lg;
      g.lineWidth = 18;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(this.x, this.y);
      g.lineTo(this.x + ex, this.y + ey);
      g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.9)';
      g.lineWidth = 5;
      g.beginPath();
      g.moveTo(this.x, this.y);
      g.lineTo(this.x + ex, this.y + ey);
      g.stroke();
      g.restore();
    }
  }
}

/* =========================================================================
   11. NPCs
   ========================================================================= */
class Galdur {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.r = 22;
    this.t = rand(0, 5);
    this.panic = 0;
    this.dead = false;
    this.lanterns = [
      { a: 0, rad: 42, hue: '#ffb347' },
      { a: 2.1, rad: 52, hue: '#7fe4ff' },
      { a: 4.2, rad: 36, hue: '#ff7fa8' }
    ];
  }

  update(dt) {
    this.t += dt;
    if (this.panic > 0) this.panic = Math.max(0, this.panic - dt);
    for (const l of this.lanterns) l.a += dt * (this.panic > 0 ? 7 : 1.4);
  }

  onPlayerAttackNear(p) {
    if (Math.hypot(p.x - this.x, p.y - this.y) < 230) {
      if (this.panic <= 0) Audio.sfx('crow');
      this.panic = 2.4;
    }
  }

  interact() { Dialogue.start(DIALOGUES.galdur); }

  draw(g) {
    const bob = Math.sin(this.t * 2) * 3;
    const shake = this.panic > 0 ? Math.sin(this.t * 40) * 3.5 : 0;

    g.save();
    g.globalAlpha = 0.3;
    g.fillStyle = '#000';
    g.beginPath(); g.ellipse(this.x, this.y + 16, 20, 7, 0, 0, TAU); g.fill();
    g.restore();

    for (const l of this.lanterns) {
      const lx = this.x + Math.cos(l.a) * l.rad + shake;
      const ly = this.y - 34 + Math.sin(l.a) * 16 + bob;
      const lg = g.createRadialGradient(lx, ly, 0, lx, ly, 58);
      lg.addColorStop(0, l.hue === '#ffb347' ? 'rgba(255,179,71,0.30)' : l.hue === '#7fe4ff' ? 'rgba(127,228,255,0.28)' : 'rgba(255,127,168,0.26)');
      lg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = lg;
      g.beginPath(); g.arc(lx, ly, 58, 0, TAU); g.fill();

      g.fillStyle = l.hue;
      g.shadowColor = l.hue;
      g.shadowBlur = 16;
      g.beginPath(); g.arc(lx, ly, 3.4, 0, TAU); g.fill();
      g.shadowBlur = 0;
    }

    g.save();
    g.translate(this.x + shake, this.y + bob);

    g.fillStyle = '#4a3520';
    g.beginPath(); g.ellipse(-6, -4, 24, 26, 0, 0, TAU); g.fill();
    g.fillStyle = '#5c4326';
    g.beginPath(); g.ellipse(-6, -10, 19, 16, 0, 0, TAU); g.fill();

    g.fillStyle = '#5d7a4a';
    g.beginPath(); g.ellipse(6, 4, 13, 15, 0, 0, TAU); g.fill();

    g.fillStyle = '#6d8f57';
    g.beginPath(); g.arc(10, -16, 11, 0, TAU); g.fill();

    g.fillStyle = '#5d7a4a';
    g.beginPath(); g.moveTo(2, -20); g.lineTo(-9, -28); g.lineTo(4, -26); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(18, -20); g.lineTo(29, -28); g.lineTo(16, -26); g.closePath(); g.fill();

    g.fillStyle = this.panic > 0 ? '#ffffff' : '#ffe066';
    const eyeR = this.panic > 0 ? 4 : 2.4;
    g.beginPath(); g.arc(7, -18, eyeR, 0, TAU); g.fill();
    g.beginPath(); g.arc(15, -18, eyeR, 0, TAU); g.fill();

    if (this.panic > 0) {
      g.fillStyle = '#000';
      g.beginPath(); g.arc(7, -18, 1.6, 0, TAU); g.fill();
      g.beginPath(); g.arc(15, -18, 1.6, 0, TAU); g.fill();
      g.fillStyle = 'rgba(160, 220, 255, 0.85)';
      g.beginPath(); g.arc(22, -24 + Math.sin(this.t * 12) * 2, 2.2, 0, TAU); g.fill();
    }

    g.restore();
  }
}

class Elara {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.r = 20;
    this.t = rand(0, 5);
    this.dead = false;
  }

  update(dt) { this.t += dt; }
  interact() { Dialogue.start(DIALOGUES.elara); }

  draw(g) {
    g.save();
    g.globalAlpha = 0.3;
    g.fillStyle = '#000';
    g.beginPath(); g.ellipse(this.x, this.y + 16, 20, 7, 0, 0, TAU); g.fill();
    g.restore();

    const fg = g.createRadialGradient(this.x + 30, this.y + 4, 0, this.x + 30, this.y + 4, 110);
    fg.addColorStop(0, 'rgba(255, 160, 60, 0.22)');
    fg.addColorStop(1, 'rgba(255, 160, 60, 0)');
    g.fillStyle = fg;
    g.beginPath(); g.arc(this.x + 30, this.y + 4, 110, 0, TAU); g.fill();

    const flick = Math.sin(this.t * 14) * 3;
    g.save();
    g.globalCompositeOperation = 'lighter';
    const fireG = g.createRadialGradient(this.x + 34, this.y + 6, 0, this.x + 34, this.y + 6, 20);
    fireG.addColorStop(0, 'rgba(255, 220, 140, 0.9)');
    fireG.addColorStop(0.5, 'rgba(255, 130, 40, 0.5)');
    fireG.addColorStop(1, 'rgba(255, 90, 20, 0)');
    g.fillStyle = fireG;
    g.beginPath(); g.ellipse(this.x + 34, this.y + 6 + flick * 0.3, 16, 22 + flick, 0, 0, TAU); g.fill();
    g.restore();

    g.save();
    g.translate(this.x, this.y);

    g.fillStyle = '#3a4058';
    g.beginPath(); g.roundRect(-12, -12, 24, 26, 8); g.fill();

    g.fillStyle = '#5a2a2a';
    g.beginPath();
    g.moveTo(-12, -10);
    g.quadraticCurveTo(-22, 6, -16, 16);
    g.lineTo(0, 16);
    g.lineTo(0, -10);
    g.closePath();
    g.fill();

    g.fillStyle = '#e8c9a0';
    g.beginPath(); g.arc(0, -22, 9.5, 0, TAU); g.fill();
    g.fillStyle = '#a8442a';
    g.beginPath(); g.arc(0, -25, 10, Math.PI, TAU); g.fill();
    g.beginPath(); g.ellipse(-8, -22, 4, 9, 0.2, 0, TAU); g.fill();

    const polish = Math.sin(this.t * 3.2);
    g.save();
    g.translate(16, 2);
    g.rotate(-0.3);
    g.fillStyle = '#7a5f42';
    g.beginPath(); g.ellipse(0, 0, 11, 14, 0, 0, TAU); g.fill();
    g.strokeStyle = '#a08050';
    g.lineWidth = 2;
    g.beginPath(); g.ellipse(0, 0, 11, 14, 0, 0, TAU); g.stroke();
    g.fillStyle = 'rgba(120, 90, 60, 0.85)';
    g.beginPath(); g.arc(-3, -4, 3.5, 0, TAU); g.fill();
    g.beginPath(); g.arc(4, 5, 2.6, 0, TAU); g.fill();
    g.restore();

    g.strokeStyle = '#2c3248';
    g.lineWidth = 5;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(8, -6);
    g.lineTo(14 + polish * 5, 4 + Math.cos(this.t * 3.2) * 4);
    g.stroke();

    if (polish > 0.6) {
      g.save();
      g.globalCompositeOperation = 'lighter';
      const pg = g.createRadialGradient(17, 2, 0, 17, 2, 22);
      pg.addColorStop(0, 'rgba(255, 240, 200, 0.7)');
      pg.addColorStop(1, 'rgba(255, 240, 200, 0)');
      g.fillStyle = pg;
      g.beginPath(); g.arc(17, 2, 22, 0, TAU); g.fill();
      g.restore();
    }

    g.restore();
  }
}

/* =========================================================================
   12. PORTAL (transição de mapa)
   ========================================================================= */
class Portal {
  constructor(x, y, targetMap, label) {
    this.x = x; this.y = y;
    this.targetMap = targetMap;
    this.label = label;
    this.r = 40;
    this.t = 0;
  }
  update(dt) { this.t += dt; }
  draw(g) {
    const pulse = 0.6 + Math.sin(this.t * 3) * 0.4;
    g.save();
    g.globalCompositeOperation = 'lighter';

    const gg = g.createRadialGradient(this.x, this.y, 0, this.x, this.y, 90);
    gg.addColorStop(0, `rgba(120, 220, 255, ${0.35 * pulse})`);
    gg.addColorStop(0.6, `rgba(80, 160, 255, ${0.15 * pulse})`);
    gg.addColorStop(1, 'rgba(40, 80, 200, 0)');
    g.fillStyle = gg;
    g.beginPath(); g.arc(this.x, this.y, 90, 0, TAU); g.fill();

    g.strokeStyle = `rgba(180, 240, 255, ${0.7 * pulse})`;
    g.lineWidth = 3;
    for (let i = 0; i < 3; i++) {
      const r = 30 + i * 12 + Math.sin(this.t * 2 + i) * 4;
      g.beginPath();
      g.ellipse(this.x, this.y, r, r * 0.55, this.t * 0.5, 0, TAU);
      g.stroke();
    }

    g.restore();

    // Rótulo
    g.save();
    g.font = 'bold 16px Georgia';
    g.textAlign = 'center';
    g.fillStyle = 'rgba(200, 235, 255, 0.95)';
    g.shadowColor = 'rgba(0,0,0,0.9)';
    g.shadowBlur = 8;
    g.fillText(this.label, this.x, this.y - 62);
    g.restore();
  }
}

/* =========================================================================
   13. MAPAS
   ========================================================================= */
const MAPS = [
  {
    name: 'VILA DE AETHEL',
    sub: 'Refúgio dos sobreviventes',
    worldW: 2200, worldH: 1500,
    spawn: { x: 500, y: 900 },
    groundPattern: 'village',
    sky: false,  // usa chão de vila, sem parallax de floresta pesado
    enemies: [],
    npcs: ['galdur', 'elara'],
    portals: [{ x: 1950, y: 750, target: 1, label: '→ FLORESTA SOMBRIA' }]
  },
  {
    name: 'FLORESTA SOMBRIA',
    sub: 'Onde as raízes respiram',
    worldW: 3200, worldH: 2000,
    spawn: { x: 300, y: 900 },
    groundPattern: 'forest',
    sky: true,
    enemies: ['stalker', 'stalker', 'golem', 'stalker', 'golem'],
    npcs: [],
    portals: [{ x: 200, y: 900, target: 0, label: '← VILA DE AETHEL' }],
    boss: { x: 2500, y: 950 }
  }
];

let boss = null;
let player = null;
let galdur = null, elara = null;

/* =========================================================================
   14. DIÁLOGOS
   ========================================================================= */
const DIALOGUES = {
  galdur: {
    speaker: 'Galdur, o Colecionador de Restos',
    color: '#c8a24a',
    nodes: {
      start: {
        text: 'Ah! Um vivo! Um vivo de verdade! Fique longe das minhas lanternas, elas mordem. Quer dizer... elas não mordem. Mas mordem.',
        options: [
          { text: 'O que você faz aqui, goblin?', next: 'oficio' },
          { text: 'Já viu Morgath?', next: 'morgath' },
          { text: 'Adeus.', next: null }
        ]
      },
      oficio: {
        text: 'Eu coleciono o que o vale descarta. Ossos com memória, moedas que choram, dedos que apontam para o norte. Tudo tem preço. Tudo tem dono. Menos eu.',
        options: [
          { text: 'E as lanternas?', next: 'lanternas' },
          { text: 'Voltemos.', next: 'start' }
        ]
      },
      lanternas: {
        text: 'Cada uma guarda a última respiração de alguém. A dourada é da minha irmã. A azul... a azul eu não acendo faz tempo. Não pergunte.',
        options: [
          { text: 'Sinto muito.', next: 'start' },
          { text: 'Adeus.', next: null }
        ]
      },
      morgath: {
        text: 'Ele era um bosque. Um bosque bonito, com pássaros e tudo. Aí as raízes beberam algo errado, e o bosque levantou e começou a andar. Você vai lá, né? Vai. Todo mundo vai.',
        options: [
          { text: 'Como o derroto?', next: 'dica' },
          { text: 'Voltemos.', next: 'start' }
        ]
      },
      dica: {
        text: 'Quando ele bate no chão, o chão devolve espinhos em cruz. Não fique parado. E quando os olhos dele ficarem vermelhos... bem. Aí reza, ou corre. Eu recomendo os dois.',
        options: [
          { text: 'Obrigado, Galdur.', next: null }
        ]
      }
    }
  },
  elara: {
    speaker: 'Elara, a Cavaleira Desonrada',
    color: '#8fb6e8',
    nodes: {
      start: {
        text: 'Não olhe para o escudo. Ele já foi dourado. Agora é isto: ferro, ferrugem e a paciência de quem não tem mais nada para fazer.',
        options: [
          { text: 'Por que foi desonrada?', next: 'honra' },
          { text: 'O que há além do vale?', next: 'alem' },
          { text: 'Você luta?', next: 'luta' },
          { text: 'Deixe-me em paz.', next: null }
        ]
      },
      honra: {
        text: 'Recusei uma ordem. Uma ordem simples: queimar uma aldeia para que a praga não se espalhasse. Salvei trezentas pessoas. Perdi meu nome. Foi uma troca justa, eu acho.',
        options: [
          { text: 'Foi justa.', next: 'justa' },
          { text: 'E se tivessem razão?', next: 'razao' }
        ]
      },
      justa: {
        text: 'Justa. Sim. É a primeira vez em nove anos que ouço isso de outra boca. Guarde essa palavra, andarilho. Ela vale mais que aço.',
        options: [
          { text: 'Voltemos.', next: 'start' }
        ]
      },
      razao: {
        text: 'Então eu teria matado trezentas pessoas por um "talvez". A praga se espalhou mesmo assim, sabia? Só que agora eu não estava lá para conter. Não existe resposta boa aqui.',
        options: [
          { text: 'Voltemos.', next: 'start' }
        ]
      },
      alem: {
        text: 'Além do vale? Névoa. E depois da névoa, mais névoa. E depois... dizem que há uma cidade de vidro onde as pessoas não têm sombra. Eu nunca cheguei lá.',
        options: [
          { text: 'Voltemos.', next: 'start' }
        ]
      },
      luta: {
        text: 'Eu lutava. Agora eu sento e polir esse escudo é a única coisa que me resta. Se você cair lá na frente... eu ainda sei segurar uma espada. Talvez.',
        options: [
          { text: 'Voltemos.', next: 'start' }
        ]
      }
    }
  }
};

/* =========================================================================
   15. DIÁLOGO — CORRIGIDO
   ========================================================================= */
const Dialogue = {
  active: false,
  typing: false,
  tree: null,
  node: null,
  full: '',
  shown: 0,
  el: {},

  init() {
    this.el.panel = document.getElementById('dialogue');
    this.el.name = document.getElementById('dlgName');
    this.el.text = document.getElementById('dlgText');
    this.el.options = document.getElementById('dlgOptions');
    this.el.portrait = document.getElementById('dlgPortrait');
  },

  start(tree) {
    this.tree = tree;
    this.active = true;
    this.el.panel.classList.remove('hidden');
    G.paused = true;
    this.show('start');
  },

  show(id) {
    this.node = this.tree.nodes[id];
    this.el.name.textContent = this.tree.speaker;
    this.el.name.style.color = this.tree.color;
    this.el.portrait.style.background =
      `radial-gradient(circle at 40% 30%, ${this.tree.color}, #0a0a12 72%)`;
    this.full = this.node.text;
    this.shown = 0;
    this.typing = true;
    this.el.text.textContent = '';
    this.el.options.innerHTML = '';
  },

  update(dt) {
    if (!this.active || !this.typing) return;
    this.shown += dt * 62;
    if (this.shown >= this.full.length) {
      this.shown = this.full.length;
      this.typing = false;
      this.buildOptions();
    }
    this.el.text.textContent = this.full.slice(0, Math.floor(this.shown));
  },

  skip() {
    if (!this.typing) return;
    this.shown = this.full.length;
    this.typing = false;
    this.el.text.textContent = this.full;
    this.buildOptions();
  },

  buildOptions() {
    this.el.options.innerHTML = '';
    const opts = this.node.options || [{ text: '(Fim)', next: null }];
    opts.forEach(o => {
      const b = document.createElement('button');
      b.className = 'dlgopt';
      b.textContent = o.text;
      b.addEventListener('click', () => this.choose(o));
      this.el.options.appendChild(b);
    });
  },

  choose(o) {
    if (o.action) o.action();
    if (o.next) this.show(o.next);
    else this.close();
  },

  close() {
    this.active = false;
    this.typing = false;
    this.el.panel.classList.add('hidden');
    G.paused = false;
  }
};

/* =========================================================================
   16. INVENTÁRIO / POÇÕES
   ========================================================================= */
function toggleInventory() {
  const inv = document.getElementById('inventory');
  const isHidden = inv.classList.contains('hidden');
  if (isHidden) {
    inv.classList.remove('hidden');
    G.paused = true;
    Audio.sfx('ice');
  } else {
    inv.classList.add('hidden');
    G.paused = false;
  }
}

function usePotion() {
  if (G.potions <= 0 || !player || player.dead) return;
  G.potions--;
  document.getElementById('potioncount').textContent = G.potions;
  document.getElementById('potioncountinv').textContent = G.potions;

  player.hp = Math.min(player.maxHp, player.hp + 22);
  player.rage = Math.min(player.maxRage, player.rage + 9);
  player.invuln = Math.max(player.invuln, 0.4);

  Audio.sfx('drink');
  camera.shake(5, 0.25);

  for (let i = 0; i < 40; i++) {
    const a = rand(0, TAU);
    P({
      type: 'spark',
      x: player.x, y: player.y - 10,
      vx: Math.cos(a) * rand(40, 220),
      vy: Math.sin(a) * rand(40, 220) - 60,
      life: rand(0.4, 1.0), size: rand(2, 4.5),
      color: pick(['#ff5d4a', '#ffb347', '#ff2a2a']),
      drag: 0.92, grav: 60
    });
  }
}

/* =========================================================================
   17. INTERAÇÃO
   ========================================================================= */
function tryInteract() {
  if (G.paused || G.transitioning || !player || player.dead) return;
  let best = null, bestD = 130;
  for (const n of G.npcs) {
    const d = Math.hypot(n.x - player.x, n.y - player.y);
    if (d < bestD) { bestD = d; best = n; }
  }
  if (best && best.interact) best.interact();
}

/* =========================================================================
   18. SISTEMA DE MAPAS
   ========================================================================= */
const MapSystem = {
  current: 0,
  transitionCooldown: 0,

  load(index) {
    this.current = index;
    G.currentMap = index;
    G.transitioning = true;
    G.paused = true;

    const map = MAPS[index];
    camera.worldW = map.worldW;
    camera.worldH = map.worldH;

    // limpa entidades antigas
    G.enemies = [];
    G.npcs = [];
    G.portals = [];
    boss = null;
    particles.length = 0;

    // posiciona jogador
    if (!player) player = new Player(map.spawn.x, map.spawn.y);
    else {
      player.x = map.spawn.x;
      player.y = map.spawn.y;
      player.vx = 0; player.vy = 0;
      player.invuln = 1.5;
    }

    // spawn de NPCs
    if (index === 0) {
      galdur = new Galdur(520, 760);
      elara = new Elara(860, 1160);
      G.npcs = [galdur, elara];
    } else {
      galdur = null; elara = null;
    }

    // spawn de inimigos
    if (index === 1) {
      G.enemies = [
        new MossStalker(900, 500),
        new MossStalker(1400, 1400),
        new GlassGolem(1800, 700),
        new MossStalker(1200, 1100),
        new GlassGolem(2100, 1300)
      ];
      boss = new Morgath(2500, 950);
    }

    // portais
    for (const p of map.portals) {
      G.portals.push(new Portal(p.x, p.y, p.target, p.label));
    }

    // câmera
    camera.x = clamp(player.x - VW / 2, 0, map.worldW - VW);
    camera.y = clamp(player.y - VH / 2, 0, map.worldH - VH);

    // HUD do mapa
    document.getElementById('maptitle').textContent = map.name;
    document.getElementById('mapsub').textContent = map.sub;

    // flash de transição
    showTransition(map.name, map.sub, () => {
      G.transitioning = false;
      G.paused = false;
    });

    Audio.sfx('portal');
  },

  update(dt) {
    if (this.transitionCooldown > 0) this.transitionCooldown -= dt;

    for (const p of G.portals) {
      p.update(dt);
      if (this.transitionCooldown <= 0 &&
          Math.hypot(player.x - p.x, player.y - p.y) < p.r) {
        this.transitionCooldown = 2;
        this.load(p.targetMap);
        return;
      }
    }
  }
};

function showTransition(name, sub, done) {
  const trans = document.getElementById('transition');
  document.getElementById('transname').textContent = name;
  document.getElementById('transsub').textContent = sub;
  trans.classList.remove('hidden');
  setTimeout(() => {
    trans.classList.add('hidden');
    setTimeout(() => { if (done) done(); }, 400);
  }, 1500);
}

/* =========================================================================
   19. HUD — minimapa e atualizações
   ========================================================================= */
const hudCache = { hp: -1, mana: -1, rage: -1, boss: -1, potions: -1 };
let hudEls = null;
let minimapCanvas, minimapCtx;

function initHUD() {
  hudEls = {
    hpfill: document.getElementById('hpfill'),
    hptext: document.getElementById('hptext'),
    manafill: document.getElementById('manafill'),
    manatext: document.getElementById('manatext'),
    ragefill: document.getElementById('ragefill'),
    bossfill: document.getElementById('bossfill'),
    bossbar: document.getElementById('bossbar'),
    rage: document.getElementById('rageoverlay')
  };
  minimapCanvas = document.getElementById('minimap');
  minimapCtx = minimapCanvas.getContext('2d');
}

function updateHUD() {
  if (!hudEls || !player) return;

  const hp = Math.round(player.hp);
  if (hp !== hudCache.hp) {
    hudCache.hp = hp;
    hudEls.hpfill.style.width = (hp / player.maxHp * 100) + '%';
    hudEls.hptext.textContent = `${hp} / ${player.maxHp}`;
  }

  const mp = Math.round(player.mana);
  if (mp !== hudCache.mana) {
    hudCache.mana = mp;
    hudEls.manafill.style.width = (mp / player.maxMana * 100) + '%';
    hudEls.manatext.textContent = `${mp} / ${player.maxMana}`;
  }

  const ragePct = Math.round(player.rage / player.maxRage * 100);
  if (ragePct !== hudCache.rage) {
    hudCache.rage = ragePct;
    hudEls.ragefill.style.width = ragePct + '%';
  }

  const engaged = boss && !boss.dead &&
    Math.hypot(boss.x - player.x, boss.y - player.y) < 1000;
  G.bossEngaged = !!engaged;
  hudEls.bossbar.classList.toggle('hidden', !engaged);

  if (engaged) {
    const pct = Math.round(boss.hp / boss.maxHp * 100);
    if (pct !== hudCache.boss) {
      hudCache.boss = pct;
      hudEls.bossfill.style.width = pct + '%';
    }
  }

  hudEls.rage.classList.toggle('on', player.rage > 0);
}

function drawMinimap() {
  if (!minimapCtx || !player) return;
  const mw = minimapCanvas.width, mh = minimapCanvas.height;
  const map = MAPS[MapSystem.current];
  const sx = mw / map.worldW, sy = mh / map.worldH;

  minimapCtx.clearRect(0, 0, mw, mh);

  // fundo
  minimapCtx.fillStyle = 'rgba(20, 28, 40, 0.85)';
  minimapCtx.fillRect(0, 0, mw, mh);

  // chão
  minimapCtx.fillStyle = MapSystem.current === 0 ? 'rgba(70, 55, 40, 0.7)' : 'rgba(24, 40, 30, 0.7)';
  minimapCtx.fillRect(2, 2, mw - 4, mh - 4);

  // portais
  for (const p of G.portals) {
    minimapCtx.fillStyle = 'rgba(120, 220, 255, 0.9)';
    minimapCtx.beginPath();
    minimapCtx.arc(p.x * sx, p.y * sy, 3, 0, TAU);
    minimapCtx.fill();
  }

  // NPCs
  for (const n of G.npcs) {
    minimapCtx.fillStyle = 'rgba(255, 210, 120, 0.95)';
    minimapCtx.beginPath();
    minimapCtx.arc(n.x * sx, n.y * sy, 2.5, 0, TAU);
    minimapCtx.fill();
  }

  // inimigos
  for (const e of G.enemies) {
    if (e.dead) continue;
    minimapCtx.fillStyle = 'rgba(255, 90, 60, 0.9)';
    minimapCtx.beginPath();
    minimapCtx.arc(e.x * sx, e.y * sy, 2, 0, TAU);
    minimapCtx.fill();
  }

  // boss
  if (boss && !boss.dead) {
    minimapCtx.fillStyle = 'rgba(255, 50, 30, 1)';
    minimapCtx.beginPath();
    minimapCtx.arc(boss.x * sx, boss.y * sy, 4, 0, TAU);
    minimapCtx.fill();
  }

  // jogador (com seta de direção)
  const px = player.x * sx, py = player.y * sy;
  minimapCtx.save();
  minimapCtx.translate(px, py);
  minimapCtx.rotate(player.facing);
  minimapCtx.fillStyle = 'rgba(200, 240, 255, 1)';
  minimapCtx.beginPath();
  minimapCtx.moveTo(4, 0);
  minimapCtx.lineTo(-3, -3);
  minimapCtx.lineTo(-3, 3);
  minimapCtx.closePath();
  minimapCtx.fill();
  minimapCtx.restore();
}

/* =========================================================================
   20. ÁGUA
   ========================================================================= */
const pond = { x: 1330, y: 1400, rx: 330, ry: 140 };

function drawWater(g) {
  if (MapSystem.current !== 1) return;
  g.save();
  g.beginPath();
  g.ellipse(pond.x, pond.y, pond.rx, pond.ry, 0, 0, TAU);
  g.clip();

  const wg = g.createLinearGradient(pond.x, pond.y - pond.ry, pond.x, pond.y + pond.ry);
  wg.addColorStop(0, '#0b1c2e');
  wg.addColorStop(0.5, '#123049');
  wg.addColorStop(1, '#08131f');
  g.fillStyle = wg;
  g.fillRect(pond.x - pond.rx, pond.y - pond.ry, pond.rx * 2, pond.ry * 2);

  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 26; i++) {
    const t = G.time * 1.2 + i * 0.7;
    const y = pond.y - pond.ry * 0.75 + (i / 26) * pond.ry * 1.5;
    const w = 30 + Math.sin(t * 2.2 + i) * 26;
    const x = pond.x + Math.sin(t * 0.8 + i * 1.7) * pond.rx * 0.65;
    g.globalAlpha = 0.06 + Math.abs(Math.sin(t * 3 + i)) * 0.12;
    g.fillStyle = '#8fd8ff';
    g.beginPath();
    g.ellipse(x, y, w, 2.2, 0, 0, TAU);
    g.fill();
  }
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';

  if (player && !player.dead) {
    const rx = pond.x + (player.x - pond.x) * 0.35;
    const ry = pond.y + (pond.y - player.y) * 0.18;
    if (Math.hypot(rx - pond.x, (ry - pond.y) * 2.4) < pond.rx * 0.9) {
      g.globalAlpha = 0.18;
      g.fillStyle = '#9fe8ff';
      g.beginPath(); g.ellipse(rx, ry, 16, 8, 0, 0, TAU); g.fill();
      g.globalAlpha = 1;
    }
  }

  g.restore();

  g.save();
  g.strokeStyle = 'rgba(120, 190, 240, 0.28)';
  g.lineWidth = 3;
  g.beginPath();
  g.ellipse(pond.x, pond.y, pond.rx, pond.ry, 0, 0, TAU);
  g.stroke();
  g.restore();
}

/* =========================================================================
   21. ILUMINAÇÃO
   ========================================================================= */
function drawLighting() {
  const p2 = boss && boss.phase === 2 && !boss.dead;

  lctx.setTransform(1, 0, 0, 1, 0, 0);
  lctx.globalCompositeOperation = 'source-over';
  lctx.fillStyle = p2 ? 'rgba(26, 2, 6, 0.86)' : 'rgba(4, 6, 18, 0.78)';
  lctx.fillRect(0, 0, VW, VH);

  lctx.globalCompositeOperation = 'destination-out';

  const lightAt = (wx, wy, radius, strength) => {
    const sx = wx - camera.x + camera.shakeX;
    const sy = wy - camera.y + camera.shakeY;
    const grad = lctx.createRadialGradient(sx, sy, 0, sx, sy, radius);
    grad.addColorStop(0, `rgba(255,255,255,${strength})`);
    grad.addColorStop(0.55, `rgba(255,255,255,${strength * 0.42})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    lctx.fillStyle = grad;
    lctx.beginPath();
    lctx.arc(sx, sy, radius, 0, TAU);
    lctx.fill();
  };

  if (player && !player.dead) {
    lightAt(player.x, player.y - 10, 240, 0.95);
    lightAt(player.x, player.y - 10, 100, 0.7);
  }

  if (boss && !boss.dead) {
    lightAt(boss.x, boss.y - 70, p2 ? 320 : 260, 0.85);
  }

  if (galdur) {
    for (const l of galdur.lanterns) {
      lightAt(
        galdur.x + Math.cos(l.a) * l.rad,
        galdur.y - 34 + Math.sin(l.a) * 16,
        120, 0.55
      );
    }
  }

  if (elara) lightAt(elara.x + 34, elara.y + 6, 190, 0.8);

  for (const e of G.enemies) {
    if (e instanceof GlassGolem && !e.dead) lightAt(e.x, e.y, 130, 0.5);
  }

  for (const p of G.portals) {
    lightAt(p.x, p.y, 130, 0.7);
  }

  lctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(lightCanvas, 0, 0);

  // brilhos aditivos
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  const glowAt = (wx, wy, radius, color) => {
    const sx = wx - camera.x + camera.shakeX;
    const sy = wy - camera.y + camera.shakeY;
    const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, radius);
    grad.addColorStop(0, color);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(sx, sy, radius, 0, TAU);
    ctx.fill();
  };

  if (player && G.legendaryEquipped && !player.dead) {
    const pulse = 0.10 + Math.sin(G.time * 5) * 0.04;
    glowAt(player.x, player.y - 10, 70, `rgba(90, 210, 255, ${pulse})`);
  }
  if (boss && !boss.dead) {
    glowAt(boss.x, boss.y - 140, 130,
      boss.phase === 2 ? 'rgba(255, 70, 40, 0.20)' : 'rgba(110, 255, 150, 0.14)');
  }
  if (elara) glowAt(elara.x + 34, elara.y + 6, 90, 'rgba(255, 150, 60, 0.16)');

  ctx.restore();
}

/* =========================================================================
   22. RENDERIZAÇÃO
   ========================================================================= */
function render() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, VW, VH);

  const map = MAPS[MapSystem.current];

  // fundo
  if (map.sky) {
    drawLayer(skyLayer, 0.03, 0.03, 0.9);
    drawLayer(mountainLayer, 0.12, 0.05, 1);
    drawLayer(farForest, 0.28, 0.08, 1);
    drawLayer(nearForest, 0.55, 0.12, 1);
  } else {
    // vila — céu noturno mais simples
    const grad = ctx.createLinearGradient(0, 0, 0, VH);
    grad.addColorStop(0, '#0a0d20');
    grad.addColorStop(0.5, '#1a1d38');
    grad.addColorStop(1, '#2a2540');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, VW, VH);

    // estrelas
    ctx.save();
    for (let i = 0; i < 80; i++) {
      const x = (i * 173 + 40) % VW;
      const y = (i * 97) % (VH * 0.6);
      const tw = 0.4 + Math.abs(Math.sin(G.time + i)) * 0.6;
      ctx.globalAlpha = tw;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x - camera.x * 0.05, y, 1.2, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  const camX = camera.x - camera.shakeX;
  const camY = camera.y - camera.shakeY;

  ctx.save();
  ctx.translate(-camX, -camY);

  // chão
  ctx.fillStyle = map.groundPattern === 'village' ? villageGroundPattern : groundPattern;
  ctx.fillRect(camX - 60, camY - 60, VW + 120, VH + 120);

  // água
  drawWater(ctx);

  // névoa rasteira
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 14; i++) {
    const t = G.time * 0.25 + i * 1.9;
    const x = camX + ((i * 137 + Math.sin(t) * 90) % (VW + 300)) - 150;
    const y = camY + 120 + ((i * 211) % (VH - 200));
    const r = 160 + Math.sin(t * 1.4 + i) * 50;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(110, 150, 220, 0.030)');
    grad.addColorStop(1, 'rgba(110, 150, 220, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  }
  ctx.restore();

  // partículas de ambiente (folhas na floresta)
  if (map.sky && Math.random() < 0.3) {
    P({
      type: 'leaf',
      x: camX + rand(0, VW),
      y: camY + rand(-50, 100),
      vx: rand(-30, 30), vy: rand(20, 60),
      life: rand(4, 8), size: rand(3, 6),
      color: pick(['rgba(120, 160, 90, 0.7)', 'rgba(90, 130, 70, 0.7)', 'rgba(150, 180, 100, 0.6)']),
      drag: 0.99, grav: 15, rot: rand(0, TAU), rotV: rand(-2, 2),
      add: false
    });
  }

  // entidades ordenadas por Y
  const drawables = [];
  if (player) drawables.push(player);
  if (boss && !boss.dead) drawables.push(boss);
  for (const e of G.enemies) if (!e.dead) drawables.push(e);
  for (const n of G.npcs) drawables.push(n);
  drawables.sort((a, b) => a.y - b.y);

  // portais embaixo
  for (const p of G.portals) p.draw(ctx);

  for (const d of drawables) d.draw(ctx);

  drawParticles(ctx);

  // indicador de interação
  if (!Dialogue.active && !G.paused && !G.transitioning && player && !player.dead) {
    for (const n of G.npcs) {
      const d = Math.hypot(n.x - player.x, n.y - player.y);
      if (d < 130) {
        ctx.save();
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = 'rgba(12, 16, 28, 0.9)';
        ctx.strokeStyle = 'rgba(200, 220, 255, 0.8)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(n.x - 13, n.y - 74 + Math.sin(G.time * 4) * 3, 26, 26, 6);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#e8f0ff';
        ctx.font = 'bold 16px Georgia';
        ctx.textAlign = 'center';
        ctx.fillText('E', n.x, n.y - 55 + Math.sin(G.time * 4) * 3);
        ctx.restore();
      }
    }
  }

  ctx.restore();

  if (map.sky) drawLayer(foreLayer, 1.35, 0.08, 1);

  drawLighting();

  // tinta vermelha fase 2
  if (boss && boss.phase === 2 && !boss.dead) {
    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    ctx.fillStyle = 'rgba(160, 20, 10, 0.16)';
    ctx.fillRect(0, 0, VW, VH);
    ctx.restore();
  }

  // vitória
  if (G.over) {
    ctx.save();
    ctx.fillStyle = 'rgba(4, 6, 14, 0.55)';
    ctx.fillRect(0, 0, VW, VH);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#e9e2cd';
    ctx.font = 'bold 54px Georgia';
    ctx.shadowColor = 'rgba(120, 220, 255, 0.8)';
    ctx.shadowBlur = 30;
    ctx.fillText('O VALE SILENCIA', VW / 2, VH / 2 - 10);
    ctx.font = '22px Georgia';
    ctx.shadowBlur = 12;
    ctx.fillStyle = 'rgba(200, 215, 240, 0.85)';
    ctx.fillText('Morgath, o Algoz das Raízes, caiu. A lâmina estilhaçada ainda canta.', VW / 2, VH / 2 + 44);
    ctx.restore();
  }
}

/* =========================================================================
   23. LOOP PRINCIPAL
   ========================================================================= */
let lastTime = performance.now();

function loop(now) {
  let dt = (now - lastTime) / 1000;
  lastTime = now;
  dt = Math.min(dt, 1 / 20);

  update(dt);
  render();

  requestAnimationFrame(loop);
}

function update(dt) {
  G.time += dt;

  Audio.update();
  // CORREÇÃO: o diálogo sempre atualiza, mesmo com G.paused
  Dialogue.update(dt);
  camera.updateShake(dt);

  if (!G.running || G.transitioning) return;

  // Com pausa (diálogo/inventário) só atualiza o loop básico
  if (G.paused) return;

  if (G.over) return;

  updateParticles(dt);

  if (player) player.update(dt);
  if (boss && MapSystem.current === 1) boss.update(dt, player);

  for (const e of G.enemies) e.update(dt, player);
  for (const n of G.npcs) n.update(dt);

  MapSystem.update(dt);

  camera.follow(player, dt);
  updateHUD();
  drawMinimap();

  // remove inimigos mortos
  for (let i = G.enemies.length - 1; i >= 0; i--) {
    if (G.enemies[i].dead && G.enemies[i].deadT !== undefined) {
      G.enemies[i].deadT += dt;
      if (G.enemies[i].deadT > 4) G.enemies.splice(i, 1);
    } else if (G.enemies[i].dead) {
      G.enemies[i].deadT = 0;
    }
  }
}

/* =========================================================================
   24. BOOTSTRAP
   ========================================================================= */
function boot() {
  buildLayers();
  Dialogue.init();
  initHUD();

  // Inicia no mapa 0 (vila)
  MapSystem.load(0);

  // Remove o flash inicial de transição para o primeiro mapa
  document.getElementById('transition').classList.add('hidden');
  G.transitioning = false;

  document.getElementById('startbtn').addEventListener('click', () => {
    document.getElementById('startscreen').classList.add('hidden');
    G.running = true;
    G.paused = false;
    Audio.unlock();
    Audio.sfx('nova');
    if (player) burstIce(player.x, player.y, 40, 0, 320);
  });

  document.querySelector('[data-item="potion"]').addEventListener('click', () => {
    usePotion();
  });

  requestAnimationFrame(loop);
}

boot();

})();
