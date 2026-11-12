/* =========================================================================
   AETHEL v3 — Vila, Economia, Missões, 4 Mapas e New Game+
   ========================================================================= */
(function () {
'use strict';

/* ==================== UTILS ==================== */
const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const pick = arr => arr[(Math.random() * arr.length) | 0];
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

/* ==================== CONFIG ==================== */
const VW = 1600, VH = 900;
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
canvas.width = VW; canvas.height = VH;

const lightCanvas = document.createElement('canvas');
lightCanvas.width = VW; lightCanvas.height = VH;
const lctx = lightCanvas.getContext('2d');

const G = {
  time: 0, running: false, paused: false, over: false,
  relicEquipped: true, legendaryEquipped: true, bossEngaged: false,
  currentMap: 0, transitioning: false,
  enemies: [], npcs: [], portals: [], decor: [], pickups: [],
  quests: {}, boulderBroken: false, newGamePlus: 0, totalGoldEarned: 0
};

/* ==================== INVENTÁRIO & ITENS ==================== */
const ITEMS = {
  potion:   { name: 'Cálice de Sangue', icon: 'potion', buy: 15, sell: 5, desc: 'Cura 22 HP e ativa fúria' },
  iron_ore: { name: 'Minério de Ferro', icon: 'ore', sell: 8, desc: 'Material de forja' },
  dynamite: { name: 'Dinamite', icon: 'bomb', sell: 0, desc: 'Explode rochas obstruindo passagens' }
};

const Inventory = {
  gold: 0,
  items: { potion: 3 },
  add(id, n = 1) { this.items[id] = (this.items[id] || 0) + n; refreshInventory(); },
  remove(id, n = 1) {
    this.items[id] = Math.max(0, (this.items[id] || 0) - n);
    if (this.items[id] === 0) delete this.items[id];
    refreshInventory();
  },
  count(id) { return this.items[id] || 0; },
  addGold(n) {
    this.gold = Math.max(0, this.gold + n);
    if (n > 0) G.totalGoldEarned += n;
    refreshGold();
  }
};

function refreshGold() {
  const gc = document.getElementById('goldcount');
  if (gc) gc.textContent = Inventory.gold;
  const ig = document.getElementById('invgold');
  if (ig) ig.textContent = Inventory.gold;
  const sg = document.getElementById('shopgold');
  if (sg) sg.textContent = Inventory.gold;
  const pc = document.getElementById('potioncount');
  if (pc) pc.textContent = Inventory.count('potion');
}

function refreshInventory() {
  const box = document.getElementById('invitems');
  if (!box) return;
  box.innerHTML = '';
  const keys = Object.keys(Inventory.items);
  if (keys.length === 0) {
    box.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:#888;font-style:italic;padding:20px;">Inventário vazio</div>';
    return;
  }
  for (const id of keys) {
    const def = ITEMS[id];
    if (!def) continue;
    const el = document.createElement('div');
    el.className = 'item';
    el.innerHTML = `
      <div class="itemicon ${def.icon}"></div>
      <div class="itemname">${def.name}</div>
      <div class="itemcount">x ${Inventory.items[id]}</div>
    `;
    box.appendChild(el);
  }
}

/* ==================== MISSÕES ==================== */
const Quests = {
  active: [],
  completed: [],
  add(id, title, current = 0, target = 1) {
    if (this.active.some(q => q.id === id) || this.completed.includes(id)) return;
    this.active.push({ id, title, current, target });
    this.render();
  },
  update(id, current) {
    const q = this.active.find(q => q.id === id);
    if (q) { q.current = current; this.render(); }
  },
  complete(id) {
    const idx = this.active.findIndex(q => q.id === id);
    if (idx < 0) return;
    const q = this.active[idx];
    this.active.splice(idx, 1);
    this.completed.push(id);
    showToast(`✓ ${q.title}`);
    this.render();
  },
  isActive(id) { return this.active.some(q => q.id === id); },
  isComplete(id) { return this.completed.includes(id); },
  render() {
    const panel = document.getElementById('questpanel');
    const text = document.getElementById('questtext');
    if (!panel || !text) return;
    if (this.active.length === 0) { panel.classList.add('hidden'); return; }
    panel.classList.remove('hidden');
    const q = this.active[0];
    text.innerHTML = q.target > 1
      ? `${q.title}<br><span style="color:#ffe8a8">${q.current} / ${q.target}</span>`
      : q.title;
  }
};

function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), 2200);
}

/* ==================== INPUT ==================== */
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
  if (Dialogue.active) {
    if (code === 'Escape') { Dialogue.close(); return; }
    if (code === 'KeyE' || code === 'Space' || code === 'Enter') {
      if (Dialogue.typing) Dialogue.skip();
      else if (Dialogue.node && Dialogue.node.options && Dialogue.node.options[0]) Dialogue.choose(Dialogue.node.options[0]);
    }
    if (/^Digit[1-4]$/.test(code)) {
      const idx = parseInt(code.slice(5), 10) - 1;
      if (Dialogue.node && Dialogue.node.options && Dialogue.node.options[idx]) Dialogue.choose(Dialogue.node.options[idx]);
    }
    return;
  }

  if (Shop.active) {
    if (code === 'Escape' || code === 'KeyE') Shop.close();
    return;
  }

  if (code === 'KeyI') { toggleInventory(); return; }
  if (code === 'Escape') {
    const inv = document.getElementById('inventory');
    if (!inv.classList.contains('hidden')) toggleInventory();
    return;
  }
  if (code === 'Digit1') usePotion();
  if (code === 'KeyE') tryInteract();
}

/* ==================== ÁUDIO ==================== */
const Audio = {
  ctx: null, master: null, step: 0, nextNote: 0, tempo: 1, enabled: false,
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.20;
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
      case 'coin':    this.sweep(1200, 1800, 0.15, 'sine', 0.10); break;
      case 'buy':     this.sweep(600, 1200, 0.2, 'triangle', 0.10); break;
      case 'boom':    this.noise(0.8, 0.5, 200); this.sweep(80, 20, 0.9, 'sine', 0.35); break;
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
    if (step % 4 === 0) this.tone(root * 0.5, t, 1.0, 'sine', 0.18);
    const n = scale[(step * 3) % scale.length];
    this.tone(root * Math.pow(2, n / 12) * 2, t, 0.35, 'triangle', 0.04);
  }
};

/* ==================== CÂMERA ==================== */
const camera = {
  x: 0, y: 0, shakeX: 0, shakeY: 0, shakeMag: 0, shakeTime: 0,
  worldW: 3000, worldH: 1800,
  follow(target, dt) {
    const tx = clamp(target.x - VW / 2, 0, Math.max(0, this.worldW - VW));
    const ty = clamp(target.y - VH / 2, 0, Math.max(0, this.worldH - VH));
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

/* ==================== PARTÍCULAS ==================== */
const particles = [];
const MAX_PARTICLES = 1000;
function P(o) {
  if (particles.length >= MAX_PARTICLES) return;
  particles.push({
    type: o.type || 'spark', x: o.x, y: o.y,
    vx: o.vx || 0, vy: o.vy || 0,
    life: o.life || 1, maxLife: o.life || 1,
    size: o.size || 3, color: o.color || '#fff',
    grav: o.grav || 0, drag: o.drag === undefined ? 0.94 : o.drag,
    rot: o.rot || 0, rotV: o.rotV || 0, add: o.add !== false, grow: o.grow || 0
  });
}
function burstSparks(x, y, n, color, speed) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, TAU), s = rand(0.2, 1) * speed;
    P({ type: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: rand(0.2, 0.6), size: rand(1.5, 3.5),
        color: color || '#ffe6a8', drag: 0.88, grav: 140 });
  }
}
function burstIce(x, y, n, spread, speed) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, TAU), s = rand(0.3, 1) * speed;
    P({ type: 'ice', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: rand(0.35, 0.85), size: rand(2, 5),
        color: pick(['#bff6ff', '#7fe4ff', '#39b8e8']), drag: 0.9, grav: 60 });
  }
}
function burstShards(x, y, n, colors) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, TAU), s = rand(60, 460);
    P({ type: 'shard', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - rand(40, 160),
        life: rand(0.8, 1.9), size: rand(4, 12),
        color: pick(colors || ['#9fe8ff', '#c9a7ff', '#ffd166', '#7dffb0']),
        grav: 520, drag: 0.985, rot: rand(0, TAU), rotV: rand(-9, 9) });
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
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.rot += p.rotV * dt;
    p.size += p.grow * dt;
  }
}
function drawParticles(g) {
  for (const p of particles) {
    const a = clamp(p.life / p.maxLife, 0, 1);
    g.globalCompositeOperation = p.add ? 'lighter' : 'source-over';
    g.globalAlpha = a;
    if (p.type === 'spark') {
      g.strokeStyle = p.color; g.lineWidth = p.size; g.lineCap = 'round';
      g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x - p.vx * 0.022, p.y - p.vy * 0.022); g.stroke();
    } else if (p.type === 'ice' || p.type === 'shard') {
      g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.fillStyle = p.color;
      g.beginPath(); g.moveTo(0, -p.size); g.lineTo(p.size * 0.6, 0);
      g.lineTo(0, p.size); g.lineTo(-p.size * 0.6, 0); g.closePath(); g.fill(); g.restore();
    } else if (p.type === 'crow') {
      g.save(); g.translate(p.x, p.y);
      const flap = Math.sin(G.time * 22 + p.rot) * 0.5;
      g.strokeStyle = p.color; g.lineWidth = 2.4; g.lineCap = 'round';
      g.beginPath(); g.moveTo(-p.size, 0);
      g.quadraticCurveTo(-p.size * 0.4, -p.size * (0.7 + flap), 0, 0);
      g.quadraticCurveTo(p.size * 0.4, -p.size * (0.7 + flap), p.size, 0);
      g.stroke(); g.restore();
    } else if (p.type === 'ring') {
      g.strokeStyle = p.color; g.lineWidth = 3 * a;
      g.beginPath(); g.arc(p.x, p.y, p.size, 0, TAU); g.stroke();
    } else if (p.type === 'leaf') {
      g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.fillStyle = p.color;
      g.beginPath(); g.ellipse(0, 0, p.size, p.size * 0.5, 0, 0, TAU); g.fill(); g.restore();
    } else if (p.type === 'coin') {
      g.save(); g.translate(p.x, p.y); g.rotate(p.rot);
      g.fillStyle = '#ffe066'; g.shadowColor = '#ffb000'; g.shadowBlur = 12;
      g.beginPath(); g.ellipse(0, 0, p.size, p.size * 0.7, 0, 0, TAU); g.fill();
      g.restore();
    } else {
      g.fillStyle = p.color; g.beginPath(); g.arc(p.x, p.y, p.size * a, 0, TAU); g.fill();
    }
  }
  g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
}

/* ==================== CAMADAS ==================== */
function makeLayer(w, h, drawFn) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  drawFn(g, w, h);
  return c;
}
const LW = 1600, LH = 1000;
let skyLayer, mountainLayer, farForest, nearForest, foreLayer;
let groundTile, groundPattern, villageGroundTile, villageGroundPattern, caveGroundTile, caveGroundPattern;

function buildLayers() {
  /* CÉU */
  skyLayer = makeLayer(LW, LH, (g) => {
    const grad = g.createLinearGradient(0, 0, 0, LH);
    grad.addColorStop(0, '#04050e'); grad.addColorStop(0.3, '#0b1030');
    grad.addColorStop(0.58, '#1d1a42'); grad.addColorStop(0.8, '#352a52'); grad.addColorStop(1, '#4d3a5e');
    g.fillStyle = grad; g.fillRect(0, 0, LW, LH);
    for (let i = 0; i < 480; i++) {
      const x = Math.random() * LW, y = Math.random() * LH * 0.68, r = Math.random() * 1.5 + 0.2;
      g.globalAlpha = (Math.random() * 0.8 + 0.1) * (1 - y / (LH * 0.8));
      g.fillStyle = Math.random() < 0.18 ? '#9fd8ff' : '#fff';
      g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    }
    g.globalAlpha = 1;
    const mx = LW * 0.76, my = LH * 0.16, mr = 68;
    const mg = g.createRadialGradient(mx, my, 0, mx, my, mr * 5);
    mg.addColorStop(0, 'rgba(200,222,255,0.34)'); mg.addColorStop(1, 'rgba(120,150,255,0)');
    g.fillStyle = mg; g.beginPath(); g.arc(mx, my, mr * 5, 0, TAU); g.fill();
    g.fillStyle = '#e2ecff'; g.beginPath(); g.arc(mx, my, mr, 0, TAU); g.fill();
  });

  /* MONTANHAS */
  mountainLayer = makeLayer(LW, LH, (g) => {
    const drawRidge = (baseY, hMin, hMax, color, k1, k2, ph) => {
      g.fillStyle = color; g.beginPath(); g.moveTo(0, LH);
      for (let x = 0; x <= LW; x += 8) {
        const t = (x / LW) * TAU;
        const h = hMin + (hMax - hMin) * (0.5 + 0.5 * Math.sin(t * k1 + ph) * Math.sin(t * k2 + ph * 1.7));
        g.lineTo(x, baseY - Math.abs(h));
      }
      g.lineTo(LW, LH); g.closePath(); g.fill();
    };
    drawRidge(LH * 0.72, 40, 240, '#161a35', 2, 3, 0.4);
    drawRidge(LH * 0.78, 25, 170, '#1b2140', 3, 5, 1.9);
    drawRidge(LH * 0.84, 12, 110, '#212a4c', 4, 7, 3.1);
  });

  /* FLORESTA DISTANTE */
  farForest = makeLayer(LW, LH, (g) => {
    for (let i = 0; i < 100; i++) {
      const x = Math.random() * LW, baseY = LH * 0.86, h = rand(50, 160), w = rand(18, 38);
      g.fillStyle = `rgba(${randInt(18,30)}, ${randInt(30,48)}, ${randInt(38,58)}, 0.85)`;
      g.beginPath(); g.moveTo(x, baseY); g.lineTo(x + w * 0.5, baseY - h); g.lineTo(x - w * 0.5, baseY); g.closePath(); g.fill();
    }
  });

  /* FLORESTA PRÓXIMA */
  nearForest = makeLayer(LW, LH, (g) => {
    for (let i = 0; i < 44; i++) {
      const x = Math.random() * LW, baseY = LH * 0.98, h = rand(220, 440), tw = rand(18, 38);
      const tg = g.createLinearGradient(x - tw, 0, x + tw, 0);
      tg.addColorStop(0, '#0c1118'); tg.addColorStop(0.5, '#151d26'); tg.addColorStop(1, '#080c12');
      g.fillStyle = tg;
      g.beginPath();
      g.moveTo(x - tw * 0.5, baseY);
      g.quadraticCurveTo(x - tw * 0.75, baseY - h * 0.6, x - tw * 0.28, baseY - h);
      g.lineTo(x + tw * 0.28, baseY - h);
      g.quadraticCurveTo(x + tw * 0.75, baseY - h * 0.6, x + tw * 0.5, baseY);
      g.closePath(); g.fill();
      for (let k = 0; k < 5; k++) {
        const cx = x + rand(-80, 80), cy = baseY - h + rand(-45, 70), cr = rand(42, 88);
        const fg = g.createRadialGradient(cx, cy, 0, cx, cy, cr);
        fg.addColorStop(0, 'rgba(24,48,44,0.95)'); fg.addColorStop(1, 'rgba(10,22,26,0)');
        g.fillStyle = fg; g.beginPath(); g.arc(cx, cy, cr, 0, TAU); g.fill();
      }
    }
  });

  /* PRIMEIRO PLANO */
  foreLayer = makeLayer(LW, LH, (g) => {
    for (let i = 0; i < 28; i++) {
      const top = i < 14, x = Math.random() * LW;
      const y = top ? rand(-35, 100) : rand(LH - 145, LH + 25);
      const r = rand(70, 170);
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, 'rgba(6,12,10,0.92)'); grad.addColorStop(1, 'rgba(6,12,10,0)');
      g.fillStyle = grad;
      g.beginPath(); g.ellipse(x, y, r * 1.4, r * 0.7, rand(-0.3, 0.3), 0, TAU); g.fill();
    }
  });

  /* CHÃO FLORESTA */
  groundTile = makeLayer(256, 256, (g) => {
    g.fillStyle = '#18241c'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 200; i++) {
      const x = Math.random() * 256, y = Math.random() * 256;
      g.fillStyle = `rgba(${randInt(26,52)}, ${randInt(52,86)}, ${randInt(36,62)}, 0.35)`;
      g.beginPath(); g.arc(x, y, rand(3, 15), 0, TAU); g.fill();
    }
    for (let i = 0; i < 400; i++) {
      const x = Math.random() * 256, y = Math.random() * 256;
      g.strokeStyle = `rgba(${randInt(50,90)}, ${randInt(100,160)}, ${randInt(70,110)}, ${rand(0.18,0.5)})`;
      g.lineWidth = 1; g.beginPath(); g.moveTo(x, y); g.lineTo(x + rand(-3, 3), y - rand(3, 9)); g.stroke();
    }
  });
  groundPattern = ctx.createPattern(groundTile, 'repeat');

  /* CHÃO VILA */
  villageGroundTile = makeLayer(256, 256, (g) => {
    g.fillStyle = '#3a2f24'; g.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 32) {
      for (let x = 0; x < 256; x += 32) {
        const off = (y / 32) % 2 === 0 ? 0 : 16;
        const px = (x + off) % 256;
        g.fillStyle = `rgba(${randInt(60,90)}, ${randInt(50,75)}, ${randInt(40,60)}, 0.9)`;
        g.fillRect(px + 1, y + 1, 30, 30);
        g.strokeStyle = 'rgba(20,15,10,0.6)'; g.lineWidth = 1; g.strokeRect(px + 1, y + 1, 30, 30);
      }
    }
  });
  villageGroundPattern = ctx.createPattern(villageGroundTile, 'repeat');

  /* CHÃO CAVERNA */
  caveGroundTile = makeLayer(256, 256, (g) => {
    g.fillStyle = '#12101c'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 180; i++) {
      const x = Math.random() * 256, y = Math.random() * 256;
      g.fillStyle = `rgba(${randInt(30,55)}, ${randInt(25,45)}, ${randInt(60,90)}, 0.4)`;
      g.beginPath(); g.arc(x, y, rand(3, 14), 0, TAU); g.fill();
    }
    for (let i = 0; i < 60; i++) {
      const x = Math.random() * 256, y = Math.random() * 256;
      g.strokeStyle = `rgba(${randInt(80,140)}, ${randInt(50,90)}, ${randInt(120,180)}, ${rand(0.15,0.4)})`;
      g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(x, y);
      g.lineTo(x + rand(-5, 5), y + rand(-8, 8));
      g.stroke();
    }
  });
  caveGroundPattern = ctx.createPattern(caveGroundTile, 'repeat');
}

function drawLayer(layer, fx, fy, alpha) {
  const w = layer.width;
  const yOff = -160 - camera.y * fy;
  let ox = -(camera.x * fx) % w;
  if (ox > 0) ox -= w;
  ctx.globalAlpha = alpha === undefined ? 1 : alpha;
  for (let x = ox; x < VW; x += w) ctx.drawImage(layer, Math.round(x), Math.round(yOff));
  ctx.globalAlpha = 1;
}

/* ==================== PLAYER ==================== */
class Player {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.r = 16;
    this.baseSpeed = 255;
    this.facing = 0;
    this.maxHp = 100; this.hp = 100;
    this.maxMana = 60; this.mana = 60;
    this.attackCd = 0; this.attackTime = -1; this.attackDur = 0.34;
    this.hitDone = false; this.swingDir = 1;
    this.dashCd = 0; this.dashTime = 0; this.dashDX = 0; this.dashDY = 0;
    this.invuln = 0; this.hitFlash = 0;
    this.novaCd = 0; this.rage = 0; this.maxRage = 12;
    this.walkPhase = 0; this.moving = false;
    this.dead = false; this.respawnT = 0; this.hurtT = 0;
    this.upgrades = { steelSword: false, ironArmor: false, swiftBoots: false };
  }

  applyUpgrades() {
    const baseHp = 100;
    this.maxHp = baseHp + (this.upgrades.ironArmor ? 30 : 0);
    this.hp = Math.min(this.hp, this.maxHp);
    this.baseSpeed = 255 * (this.upgrades.swiftBoots ? 1.2 : 1);
  }

  damageBonus() { return this.upgrades.steelSword ? 15 : 0; }

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

    if (mouse.down) this.facing = Math.atan2(mouse.wy - this.y, mouse.wx - this.x);
    else if (this.moving) this.facing = Math.atan2(iy, ix);

    const wantDash = keys['ShiftLeft'] || keys['ShiftRight'];
    if (wantDash && this.dashCd <= 0 && this.dashTime <= 0) {
      const dx = this.moving ? ix : Math.cos(this.facing);
      const dy = this.moving ? iy : Math.sin(this.facing);
      this.dashDX = dx; this.dashDY = dy;
      this.dashTime = 0.18; this.dashCd = 0.85;
      this.invuln = Math.max(this.invuln, 0.38);
      Audio.sfx('swing');
      if (G.relicEquipped) {
        Audio.sfx('crow');
        for (let i = 0; i < 12; i++) {
          P({ type: 'crow', x: this.x + rand(-24, 24), y: this.y + rand(-24, 12),
              vx: -dx * rand(60, 260) + rand(-80, 80), vy: -dy * rand(60, 260) + rand(-90, 40),
              life: rand(0.5, 1.0), size: rand(7, 14),
              color: 'rgba(30,26,48,0.95)', drag: 0.93, grav: -20, add: false, rot: rand(0, TAU) });
        }
      }
    }
    if (this.dashTime > 0) {
      this.dashTime -= dt;
      this.x += this.dashDX * 940 * dt;
      this.y += this.dashDY * 940 * dt;
    } else {
      const spd = this.baseSpeed * (this.rage > 0 ? 1.32 : 1);
      this.x += ix * spd * dt;
      this.y += iy * spd * dt;
    }
    if (this.moving) this.walkPhase += dt * 11;

    this.x = clamp(this.x, 40, camera.worldW - 40);
    this.y = clamp(this.y, 60, camera.worldH - 40);

    const wantAttack = keys['KeyJ'] || keys['Space'] || mouse.down;
    if (wantAttack && this.attackCd <= 0 && this.attackTime < 0) this.startAttack();
    if (this.attackTime >= 0) {
      this.attackTime += dt;
      const t = this.attackTime / this.attackDur;
      if (!this.hitDone && t > 0.34) { this.hitDone = true; this.applyHit(); }
      if (t < 0.8 && G.legendaryEquipped) {
        const ang = this.swordAngle();
        P({ type: 'ice', x: this.x + Math.cos(ang) * 62, y: this.y - 8 + Math.sin(ang) * 62,
            vx: rand(-40, 40), vy: rand(-40, 10), life: rand(0.25, 0.55), size: rand(2, 4.5),
            color: pick(['#bff6ff', '#7fe4ff', '#59c8f0']), drag: 0.9, grav: 40 });
      }
      if (t >= 1) this.attackTime = -1;
    }

    if (keys['KeyQ'] && this.novaCd <= 0 && this.mana >= 20) this.castNova();
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
    for (const n of G.npcs) if (n.onPlayerAttackNear) n.onPlayerAttackNear(this);
  }

  applyHit() {
    const range = 92, arc = 1.25;
    const baseDmg = (26 + this.damageBonus()) * (this.rage > 0 ? 1.5 : 1);
    const targets = [boss, ...G.enemies, ...G.npcs].filter(t => t && !t.dead);
    for (const t of targets) {
      const d = Math.hypot(t.x - this.x, t.y - this.y);
      if (d > range + (t.r || 20)) continue;
      const a = Math.atan2(t.y - this.y, t.x - this.x);
      if (Math.abs(angDiff(a, this.facing)) > arc) continue;
      if (t.takeDamage) {
        t.takeDamage(baseDmg, Math.atan2(t.y - this.y, t.x - this.x));
        Audio.sfx('hit');
        burstSparks(this.x + Math.cos(a) * (d * 0.8), this.y + Math.sin(a) * (d * 0.8), 10, '#ffe6a8', 320);
        if (G.legendaryEquipped) burstIce(this.x + Math.cos(a) * (d * 0.8), this.y + Math.sin(a) * (d * 0.8), 8, 0, 260);
        camera.shake(4, 0.12);
      }
    }
  }

  castNova() {
    this.mana -= 20; this.novaCd = 2.8;
    Audio.sfx('nova'); camera.shake(10, 0.3);
    P({ type: 'ring', x: this.x, y: this.y, life: 0.55, size: 20,
        color: 'rgba(140,230,255,0.9)', grow: 320, add: true, drag: 1 });
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * TAU;
      P({ type: 'ice', x: this.x + Math.cos(a) * 20, y: this.y + Math.sin(a) * 20,
          vx: Math.cos(a) * rand(240, 520), vy: Math.sin(a) * rand(240, 520),
          life: rand(0.4, 0.9), size: rand(3, 6),
          color: pick(['#bff6ff', '#7fe4ff', '#fff']), drag: 0.9, grav: 30 });
    }
    const targets = [boss, ...G.enemies].filter(t => t && !t.dead);
    for (const t of targets) {
      const d = Math.hypot(t.x - this.x, t.y - this.y);
      if (d < 170) {
        t.takeDamage((38 + this.damageBonus()) * (this.rage > 0 ? 1.5 : 1),
                     Math.atan2(t.y - this.y, t.x - this.x));
        if (t.slow !== undefined) t.slow = 1.5;
      }
    }
  }

  takeDamage(dmg, ang) {
    if (this.invuln > 0 || this.dead) return;
    this.hp -= dmg;
    this.hitFlash = 1; this.hurtT = 0.35; this.invuln = 0.6;
    camera.shake(9, 0.28); Audio.sfx('hurt');
    this.x = clamp(this.x + Math.cos(ang) * 24, 40, camera.worldW - 40);
    this.y = clamp(this.y + Math.sin(ang) * 24, 60, camera.worldH - 40);
    burstSparks(this.x, this.y, 12, '#ff6b6b', 260);
    if (this.hp <= 0) { this.hp = 0; this.die(); }
  }

  die() {
    this.dead = true; this.respawnT = 2.4;
    Audio.sfx('die'); camera.shake(16, 0.6);
    burstShards(this.x, this.y, 40, ['#ff8f6b', '#ffd166', '#fff']);
  }

  respawn() {
    this.dead = false;
    this.hp = this.maxHp; this.mana = this.maxMana;
    const map = MAPS[MapSystem.current];
    this.x = map.spawn.x; this.y = map.spawn.y;
    this.invuln = 2;
    burstSparks(this.x, this.y, 30, '#9fe8ff', 300);
  }

  draw(g) {
    g.save(); g.globalAlpha = 0.38; g.fillStyle = '#000';
    g.beginPath(); g.ellipse(this.x, this.y + 16, 19, 7, 0, 0, TAU); g.fill(); g.restore();
    if (this.dead) {
      g.save(); g.globalAlpha = 0.5; g.fillStyle = '#7a2230';
      g.beginPath(); g.ellipse(this.x, this.y + 6, 22, 10, 0, 0, TAU); g.fill(); g.restore();
      return;
    }
    const bob = Math.sin(this.walkPhase) * 2;
    const flip = Math.cos(this.facing) >= 0 ? 1 : -1;

    if (this.rage > 0) {
      const rg = g.createRadialGradient(this.x, this.y, 4, this.x, this.y, 52);
      rg.addColorStop(0, 'rgba(255,60,40,0.28)'); rg.addColorStop(1, 'rgba(255,60,40,0)');
      g.fillStyle = rg; g.beginPath(); g.arc(this.x, this.y, 52, 0, TAU); g.fill();
    }
    if (this.invuln > 0 && Math.floor(G.time * 22) % 2 === 0) g.globalAlpha = 0.45;

    g.save(); g.translate(this.x, this.y + bob); g.scale(flip, 1);
    const capeSway = Math.sin(G.time * 5 + this.walkPhase) * 4;
    g.fillStyle = '#1d2a52';
    g.beginPath();
    g.moveTo(-6, -16); g.quadraticCurveTo(-20 + capeSway, 2, -14 + capeSway, 18);
    g.quadraticCurveTo(0, 12, 8, 18); g.quadraticCurveTo(10, 0, 6, -16);
    g.closePath(); g.fill();

    g.strokeStyle = '#2b3350'; g.lineWidth = 6; g.lineCap = 'round';
    const legSwing = Math.sin(this.walkPhase) * 7;
    g.beginPath(); g.moveTo(-4, 8); g.lineTo(-4 + legSwing, 20); g.stroke();
    g.beginPath(); g.moveTo(4, 8); g.lineTo(4 - legSwing, 20); g.stroke();

    const bg = g.createLinearGradient(-12, -18, 12, 10);
    bg.addColorStop(0, this.upgrades.ironArmor ? '#8a95b5' : '#5a7fb5');
    bg.addColorStop(0.5, this.upgrades.ironArmor ? '#505a7d' : '#33507d');
    bg.addColorStop(1, this.upgrades.ironArmor ? '#2a3050' : '#1c2c48');
    g.fillStyle = bg;
    g.beginPath(); g.roundRect(-11, -18, 22, 28, 7); g.fill();

    g.fillStyle = 'rgba(160, 210, 255, 0.35)';
    g.beginPath(); g.roundRect(-7, -14, 14, 10, 4); g.fill();

    g.fillStyle = '#141a2c'; g.beginPath(); g.arc(0, -25, 11, 0, TAU); g.fill();
    g.fillStyle = '#e8c9a0'; g.beginPath(); g.arc(1, -24, 7.5, 0, TAU); g.fill();
    g.fillStyle = this.rage > 0 ? '#ff6a4a' : '#9fe8ff';
    g.beginPath(); g.arc(4, -25, 1.9, 0, TAU); g.fill();
    g.restore();
    g.globalAlpha = 1;

    const ang = this.swordAngle();
    g.save();
    g.translate(this.x + Math.cos(this.facing) * 3, this.y - 8 + bob);
    g.rotate(ang);
    if (G.legendaryEquipped) { g.shadowColor = '#5fe3ff'; g.shadowBlur = 22; }
    const bladeGrad = g.createLinearGradient(8, 0, 66, 0);
    bladeGrad.addColorStop(0, '#8fd9f0'); bladeGrad.addColorStop(0.5, '#e9fdff'); bladeGrad.addColorStop(1, '#4fbfe6');
    g.fillStyle = bladeGrad;
    g.beginPath();
    g.moveTo(10, -3.4); g.lineTo(58, -2.2); g.lineTo(68, 0); g.lineTo(58, 2.2); g.lineTo(10, 3.4);
    g.closePath(); g.fill();
    g.strokeStyle = 'rgba(90,220,255,0.9)'; g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(24, -2.6); g.lineTo(31, 1.4); g.lineTo(38, -2.0);
    g.stroke();
    g.shadowBlur = 0;
    g.fillStyle = '#b39355'; g.beginPath(); g.roundRect(4, -6, 6, 12, 2); g.fill();
    g.fillStyle = '#4a3520'; g.beginPath(); g.roundRect(-6, -2.4, 12, 4.8, 2); g.fill();
    if (G.legendaryEquipped) {
      const pulse = 0.55 + Math.sin(G.time * 7) * 0.35;
      g.globalCompositeOperation = 'lighter';
      const tipG = g.createRadialGradient(66, 0, 0, 66, 0, 26);
      tipG.addColorStop(0, `rgba(160,245,255,${0.8 * pulse})`);
      tipG.addColorStop(1, 'rgba(80,200,255,0)');
      g.fillStyle = tipG; g.beginPath(); g.arc(66, 0, 26, 0, TAU); g.fill();
      g.globalCompositeOperation = 'source-over';
    }
    g.restore();
    if (this.hitFlash > 0) {
      g.save(); g.globalAlpha = this.hitFlash * 0.55;
      g.fillStyle = '#ff5a5a'; g.beginPath(); g.arc(this.x, this.y - 6, 30, 0, TAU); g.fill(); g.restore();
    }
  }
}

/* ==================== BOSS ==================== */
class Morgath {
  constructor(x, y) {
    this.x = x; this.y = y; this.r = 95;
    this.maxHp = 1400; this.hp = 1400;
    this.phase = 1; this.dead = false; this.deathT = 0;
    this.state = 'idle'; this.stateT = 0; this.hitDone = false;
    this.hitFlash = 0; this.spikes = []; this.projectiles = []; this.rings = [];
    this.target = null; this.contactCd = 0;
  }
  setState(s) { this.state = s; this.stateT = 0; this.hitDone = false; if (s === 'slam') this.target = null; }

  update(dt, p) {
    this.stateT += dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt * 3);
    this.contactCd = Math.max(0, this.contactCd - dt);
    if (this.dead) { this.deathT += dt; return; }
    const dx = p.x - this.x, dy = p.y - this.y, d = Math.hypot(dx, dy) || 1;
    if (d < this.r + 20 && this.contactCd <= 0 && !p.dead) {
      p.takeDamage(this.phase === 2 ? 16 : 11, Math.atan2(p.y - this.y, p.x - this.x));
      this.contactCd = 0.9;
    }
    switch (this.state) {
      case 'idle': {
        const spd = this.phase === 2 ? 62 : 38;
        if (d > 175) { this.x += (dx / d) * spd * dt; this.y += (dy / d) * spd * dt; }
        const wait = this.phase === 2 ? 0.85 : 1.65;
        if (this.stateT > wait) {
          if (this.phase === 2) {
            const r = Math.random();
            this.setState(r < 0.55 ? 'slam' : (r < 0.82 ? 'volley' : 'frenzy'));
          } else this.setState('slam');
        }
        break;
      }
      case 'slam': {
        if (this.stateT < 0.05 && !this.target) this.target = { x: p.x, y: p.y };
        if (this.stateT > 0.95 && !this.hitDone) { this.hitDone = true; this.doSlam(); }
        if (this.stateT > 1.55) this.setState('idle');
        break;
      }
      case 'volley': {
        if (this.stateT > 0.55 && !this.hitDone) { this.hitDone = true; this.doVolley(p); }
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
      if (!s.hit && s.t < 0.22 && !p.dead && Math.hypot(p.x - s.x, p.y - s.y) < 42) {
        s.hit = true;
        p.takeDamage(this.phase === 2 ? 16 : 12, Math.atan2(p.y - s.y, p.x - s.x));
      }
      if (s.t > 1.25) this.spikes.splice(i, 1);
    }
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      pr.life -= dt; pr.t += dt;
      const ax = p.x - pr.x, ay = p.y - pr.y, ad = Math.hypot(ax, ay) || 1;
      pr.vx += (ax / ad) * 130 * dt; pr.vy += (ay / ad) * 130 * dt;
      const sp = Math.hypot(pr.vx, pr.vy), maxSp = 240;
      if (sp > maxSp) { pr.vx = pr.vx / sp * maxSp; pr.vy = pr.vy / sp * maxSp; }
      pr.x += pr.vx * dt; pr.y += pr.vy * dt;
      if (Math.hypot(p.x - pr.x, p.y - pr.y) < 26 && !p.dead) {
        p.takeDamage(13, Math.atan2(p.y - pr.y, p.x - pr.x));
        pr.life = 0; burstSparks(pr.x, pr.y, 14, '#ff8a5c', 260);
      }
      if (pr.life <= 0) this.projectiles.splice(i, 1);
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const rg = this.rings[i];
      rg.t += dt; rg.r += 420 * dt;
      if (!rg.hit && Math.abs(Math.hypot(p.x - rg.x, p.y - rg.y) - rg.r) < 30 && !p.dead) {
        rg.hit = true; p.takeDamage(18, Math.atan2(p.y - rg.y, p.x - rg.x));
      }
      if (rg.r > 620) this.rings.splice(i, 1);
    }
  }

  doSlam() {
    Audio.sfx('slam'); camera.shake(22, 0.6);
    const t = this.target || { x: this.x, y: this.y };
    const step = 74;
    for (let x = t.x - 6 * step; x <= t.x + 6 * step; x += step) this.spikes.push({ x, y: t.y, t: 0, hit: false });
    for (let y = t.y - 4 * step; y <= t.y + 4 * step; y += step) this.spikes.push({ x: t.x, y, t: 0, hit: false });
    for (let i = 0; i < 30; i++) {
      const a = rand(0, TAU);
      P({ type: 'spark', x: t.x, y: t.y, vx: Math.cos(a) * rand(100, 460), vy: Math.sin(a) * rand(60, 300),
          life: rand(0.35, 0.8), size: rand(2, 5), color: pick(['#8a6a3a', '#c9a06a', '#5c4326']),
          drag: 0.9, grav: 420, add: false });
    }
  }
  doVolley(p) {
    Audio.sfx('ice');
    for (let i = 0; i < 5; i++) {
      const a = Math.atan2(p.y - this.y, p.x - this.x) + rand(-0.7, 0.7);
      this.projectiles.push({ x: this.x + Math.cos(a) * 70, y: this.y + Math.sin(a) * 70,
        vx: Math.cos(a) * 180, vy: Math.sin(a) * 180, life: 4.5, t: 0 });
    }
  }
  doFrenzy() {
    Audio.sfx('slam'); camera.shake(28, 0.9);
    this.rings.push({ x: this.x, y: this.y, r: 40, t: 0, hit: false });
    this.rings.push({ x: this.x, y: this.y, r: 140, t: 0, hit: false });
  }
  takeDamage(dmg, ang) {
    if (this.dead) return;
    this.hp -= dmg; this.hitFlash = 1;
    burstSparks(this.x + rand(-50, 50), this.y + rand(-90, 10), 8, '#ffd166', 240);
    if (this.phase === 1 && this.hp <= this.maxHp * 0.5) this.enterPhase2();
    if (this.hp <= 0) { this.hp = 0; this.die(); }
  }
  enterPhase2() {
    this.phase = 2; Audio.tempo = 1.55;
    camera.shake(26, 1.2); Audio.sfx('slam');
    this.setState('frenzy'); this.doFrenzy();
  }
  die() {
    this.dead = true; this.deathT = 0;
    Audio.tempo = 0.8; Audio.sfx('die'); camera.shake(30, 1.6);
    burstShards(this.x, this.y, 100, ['#7dff9b', '#ffd166', '#ff8a5c', '#bff6ff']);
    document.getElementById('bossbar').classList.add('hidden');
    setTimeout(() => showVictoryScreen(), 2000);
  }
  draw(g) {
    const t = G.time, p2 = this.phase === 2;
    const glowColor = p2 ? '#ff5a3c' : '#7dff9b';
    const bodyColor = p2 ? '#3a1f1a' : '#2e2318';
    g.save(); g.globalAlpha = 0.45; g.fillStyle = '#000';
    g.beginPath(); g.ellipse(this.x, this.y + this.r * 0.55, this.r * 1.2, this.r * 0.42, 0, 0, TAU); g.fill(); g.restore();
    g.save(); g.translate(this.x, this.y);
    if (this.dead) { g.rotate(Math.min(0.5, this.deathT * 0.3)); g.globalAlpha = Math.max(0, 1 - this.deathT / 3); }
    const breathe = Math.sin(t * 1.6) * 6;
    g.strokeStyle = '#1a1208'; g.lineWidth = 18; g.lineCap = 'round';
    for (let s = -1; s <= 1; s += 2) {
      g.beginPath(); g.moveTo(s * 38, 20); g.quadraticCurveTo(s * 72, 62, s * 98, 80); g.stroke();
    }
    g.fillStyle = bodyColor;
    g.beginPath();
    g.moveTo(-72, 60); g.quadraticCurveTo(-92, -60, -52, -122 + breathe);
    g.quadraticCurveTo(0, -152 + breathe, 52, -122 + breathe);
    g.quadraticCurveTo(92, -60, 72, 60); g.closePath(); g.fill();
    const swingT = this.state === 'slam' ? Math.min(1, this.stateT / 0.95) : 0;
    const swing = Math.sin(swingT * Math.PI) * 1.25 + Math.sin(t * 1.2) * 0.12;
    for (let s = -1; s <= 1; s += 2) {
      g.save(); g.translate(s * 62, -84 + breathe); g.rotate(s * swing);
      g.strokeStyle = '#241a10'; g.lineWidth = 22;
      g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(s * 52, 32, s * 84, 74); g.stroke();
      g.fillStyle = '#3a2a18'; g.beginPath(); g.arc(s * 84, 74, 17, 0, TAU); g.fill();
      g.restore();
    }
    g.fillStyle = '#241a10'; g.beginPath(); g.ellipse(0, -142 + breathe, 47, 41, 0, 0, TAU); g.fill();
    g.save(); g.shadowColor = glowColor; g.shadowBlur = 32; g.fillStyle = glowColor;
    g.beginPath(); g.ellipse(-17, -148 + breathe, 9, 5.5, 0.22, 0, TAU); g.fill();
    g.beginPath(); g.ellipse(17, -148 + breathe, 9, 5.5, -0.22, 0, TAU); g.fill();
    g.restore();
    if (this.hitFlash > 0.01) {
      g.globalAlpha = this.hitFlash * 0.35; g.fillStyle = '#fff';
      g.beginPath(); g.ellipse(0, -50, 82, 150, 0, 0, TAU); g.fill(); g.globalAlpha = 1;
    }
    g.restore();
    for (const s of this.spikes) {
      const rise = Math.min(1, s.t / 0.16), fall = Math.max(0, (s.t - 0.85) / 0.4);
      const h = 58 * rise * (1 - fall);
      if (h <= 1) continue;
      g.save(); g.globalAlpha = 0.95 * (1 - fall);
      g.fillStyle = p2 ? '#4a2218' : '#3a2a1a';
      g.beginPath(); g.moveTo(s.x - 15, s.y); g.lineTo(s.x, s.y - h); g.lineTo(s.x + 15, s.y); g.closePath(); g.fill();
      g.restore();
    }
    for (const pr of this.projectiles) {
      g.save(); g.shadowColor = glowColor; g.shadowBlur = 24;
      g.fillStyle = p2 ? '#ff6a4a' : '#7dff9b';
      g.beginPath(); g.arc(pr.x, pr.y, 11, 0, TAU); g.fill(); g.restore();
    }
    for (const rg of this.rings) {
      g.save(); g.globalAlpha = clamp(1 - rg.r / 620, 0, 1) * 0.8;
      g.strokeStyle = p2 ? '#ff6a4a' : '#7dff9b'; g.lineWidth = 8;
      g.beginPath(); g.arc(rg.x, rg.y, rg.r, 0, TAU); g.stroke(); g.restore();
    }
  }
}

/* ==================== INIMIGOS — VIDA REDUZIDA E MELEE ==================== */
const ENEMY_VISION = 180;

class MossStalker {
  constructor(x, y) {
    this.x = x; this.y = y; this.r = 22;
    this.maxHp = 48; this.hp = 48;
    this.state = 'hide'; this.alpha = 0.12;
    this.t = rand(0, 4); this.hitFlash = 0; this.dead = false;
    this.leapVX = 0; this.leapVY = 0; this.z = 0; this.vz = 0;
    this.attackCd = 0; this.slow = 0;
  }
  update(dt, p) {
    if (this.dead) return;
    this.t += dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt * 3);
    this.attackCd = Math.max(0, this.attackCd - dt);
    if (this.slow > 0) this.slow -= dt;
    const dx = p.x - this.x, dy = p.y - this.y, d = Math.hypot(dx, dy) || 1;
    if (this.state === 'hide') {
      this.alpha = lerp(this.alpha, 0.12, dt * 3);
      if (d < ENEMY_VISION && !p.dead) {
        this.state = 'chase';
        burstSparks(this.x, this.y, 12, '#7dff9b', 200);
      }
    } else if (this.state === 'chase') {
      this.alpha = lerp(this.alpha, 1, dt * 8);
      const spd = this.slow > 0 ? 90 : 168;
      this.x += (dx / d) * spd * dt; this.y += (dy / d) * spd * dt;
      if (d < 100 && this.attackCd <= 0) {
        this.state = 'leap';
        this.leapVX = (dx / d) * 420; this.leapVY = (dy / d) * 420;
        this.vz = 300; this.z = 0; this.attackCd = 1.6;
      }
    } else if (this.state === 'leap') {
      this.x += this.leapVX * dt; this.y += this.leapVY * dt;
      this.vz -= 900 * dt; this.z += this.vz * dt;
      if (this.z <= 0) {
        this.z = 0; this.state = 'chase';
        if (Math.hypot(p.x - this.x, p.y - this.y) < 60 && !p.dead)
          p.takeDamage(11, Math.atan2(p.y - this.y, p.x - this.x));
      }
    }
  }
  takeDamage(dmg, ang) {
    if (this.dead) return;
    this.hp -= dmg; this.hitFlash = 1;
    if (this.state === 'hide') this.state = 'chase';
    this.x += Math.cos(ang) * 18; this.y += Math.sin(ang) * 18;
    burstSparks(this.x, this.y, 8, '#7dff9b', 200);
    if (this.hp <= 0) this.die();
  }
  die() {
    this.dead = true;
    Audio.sfx('hit');
    burstSparks(this.x, this.y, 20, '#7dff9b', 320);
    dropLoot(this.x, this.y, { gold: randInt(2, 5), oreChance: 0.4 });
  }
  draw(g) {
    if (this.dead) return;
    const bob = Math.sin(this.t * 6) * 2;
    g.save(); g.globalAlpha = 0.3 * this.alpha;
    g.fillStyle = '#000'; g.beginPath(); g.ellipse(this.x, this.y + 14, 22, 8, 0, 0, TAU); g.fill(); g.restore();
    g.save(); g.globalAlpha = this.alpha;
    g.translate(this.x, this.y - this.z + bob);
    const bg = g.createLinearGradient(0, -20, 0, 20);
    bg.addColorStop(0, '#3d5c34'); bg.addColorStop(1, '#1b2a18');
    g.fillStyle = bg; g.beginPath(); g.ellipse(0, 0, 24, 14, 0, 0, TAU); g.fill();
    g.fillStyle = '#33502c'; g.beginPath(); g.ellipse(20, -6, 12, 10, 0.2, 0, TAU); g.fill();
    g.shadowColor = '#a8ff7d'; g.shadowBlur = 16; g.fillStyle = '#c6ff9a';
    g.beginPath(); g.arc(24, -8, 2.4, 0, TAU); g.fill(); g.shadowBlur = 0;
    if (this.hitFlash > 0.01) {
      g.globalAlpha = this.alpha * this.hitFlash * 0.7; g.fillStyle = '#fff';
      g.beginPath(); g.ellipse(0, 0, 26, 18, 0, 0, TAU); g.fill();
    }
    g.restore(); g.globalAlpha = 1;
  }
}

class GlassGolem {
  constructor(x, y) {
    this.x = x; this.y = y; this.r = 26;
    this.maxHp = 95; this.hp = 95;
    this.dead = false; this.hitFlash = 0; this.t = rand(0, 5);
    this.state = 'idle'; this.stateT = 0;
    this.chargeCd = 1.5; this.slow = 0;
    this.chargeVX = 0; this.chargeVY = 0;
  }
  update(dt, p) {
    if (this.dead) return;
    this.t += dt; this.stateT += dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt * 3);
    this.chargeCd = Math.max(0, this.chargeCd - dt);
    if (this.slow > 0) this.slow -= dt;
    const dx = p.x - this.x, dy = p.y - this.y, d = Math.hypot(dx, dy) || 1;

    if (this.state === 'idle') {
      const spd = (d > 100 ? 80 : -20) * (this.slow > 0 ? 0.5 : 1);
      if (d < ENEMY_VISION) {
        this.x += (dx / d) * spd * dt;
        this.y += (dy / d) * spd * dt;
      }
      if (d < 140 && this.chargeCd <= 0) {
        this.state = 'charge'; this.stateT = 0;
        this.chargeVX = (dx / d) * 480; this.chargeVY = (dy / d) * 480;
        Audio.sfx('ice'); camera.shake(4, 0.15);
      }
    } else if (this.state === 'charge') {
      this.x += this.chargeVX * dt; this.y += this.chargeVY * dt;
      if (Math.hypot(p.x - this.x, p.y - this.y) < 40 && !p.dead) {
        p.takeDamage(20, Math.atan2(p.y - this.y, p.x - this.x));
        this.state = 'idle'; this.stateT = 0; this.chargeCd = 2.5;
        burstSparks(this.x, this.y, 15, '#9fe8ff', 300);
      }
      if (this.stateT > 0.45) { this.state = 'idle'; this.stateT = 0; this.chargeCd = 2.0; }
    }
    this.x = clamp(this.x, 30, camera.worldW - 30);
    this.y = clamp(this.y, 30, camera.worldH - 30);
  }
  takeDamage(dmg, ang) {
    if (this.dead) return;
    this.hp -= dmg; this.hitFlash = 1;
    burstSparks(this.x, this.y, 10, '#9fe8ff', 260);
    if (this.hp <= 0) this.die();
  }
  die() {
    this.dead = true;
    Audio.sfx('shatter');
    camera.shake(10, 0.35);
    burstShards(this.x, this.y, 100, ['#9fe8ff', '#c9a7ff', '#ffd166', '#7dffb0', '#ff7fa8']);
    dropLoot(this.x, this.y, { gold: randInt(6, 12), oreChance: 0.7 });
  }
  draw(g) {
    if (this.dead) return;
    const float = Math.sin(this.t * 1.9) * 6;
    g.save(); g.globalAlpha = 0.28; g.fillStyle = '#000';
    g.beginPath(); g.ellipse(this.x, this.y + 34, 24, 9, 0, 0, TAU); g.fill(); g.restore();
    g.save(); g.translate(this.x, this.y + float);
    const cg = g.createLinearGradient(-26, -34, 26, 34);
    cg.addColorStop(0, 'rgba(180,240,255,0.9)');
    cg.addColorStop(0.45, 'rgba(90,160,220,0.75)');
    cg.addColorStop(1, 'rgba(120,90,200,0.8)');
    g.fillStyle = cg; g.shadowColor = '#9fe8ff'; g.shadowBlur = 22;
    g.beginPath();
    g.moveTo(0, -34); g.lineTo(24, -12); g.lineTo(20, 22);
    g.lineTo(0, 34); g.lineTo(-20, 22); g.lineTo(-24, -12); g.closePath(); g.fill();
    g.shadowBlur = 0;
    g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 1.4;
    g.beginPath();
    g.moveTo(0, -34); g.lineTo(0, 34);
    g.moveTo(-24, -12); g.lineTo(20, 22);
    g.moveTo(24, -12); g.lineTo(-20, 22); g.stroke();
    const pulse = 0.7 + Math.sin(this.t * 6) * 0.3;
    g.globalCompositeOperation = 'lighter';
    const ng = g.createRadialGradient(0, 0, 0, 0, 0, 26);
    ng.addColorStop(0, `rgba(220,255,255,${0.9 * pulse})`);
    ng.addColorStop(1, 'rgba(120,200,255,0)');
    g.fillStyle = ng; g.beginPath(); g.arc(0, 0, 26, 0, TAU); g.fill();
    g.globalCompositeOperation = 'source-over';
    if (this.hitFlash > 0.01) {
      g.globalAlpha = this.hitFlash * 0.7; g.fillStyle = '#fff';
      g.beginPath(); g.arc(0, 0, 30, 0, TAU); g.fill();
    }
    g.restore();
  }
}

/* NOVO INIMIGO — Morcego da Caverna */
class CaveBat {
  constructor(x, y) {
    this.x = x; this.y = y; this.r = 18;
    this.maxHp = 30; this.hp = 30;
    this.dead = false; this.hitFlash = 0; this.t = rand(0, 5);
    this.state = 'idle';
    this.diveCd = 1.2;
    this.wobble = 0;
  }
  update(dt, p) {
    if (this.dead) return;
    this.t += dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt * 3);
    this.diveCd = Math.max(0, this.diveCd - dt);
    const dx = p.x - this.x, dy = p.y - this.y, d = Math.hypot(dx, dy) || 1;

    if (this.state === 'idle') {
      // movimento errático
      this.wobble += dt * 5;
      this.x += Math.cos(this.wobble * 2) * 40 * dt;
      this.y += Math.sin(this.wobble * 3) * 30 * dt;
      if (d < ENEMY_VISION && !p.dead) this.state = 'dive';
    } else if (this.state === 'dive') {
      const speed = 340;
      this.x += (dx / d) * speed * dt;
      this.y += (dy / d) * speed * dt;
      if (d < 30 && !p.dead) {
        p.takeDamage(8, Math.atan2(p.y - this.y, p.x - this.x));
        this.state = 'retreat'; this.t = 0;
      } else if (d > ENEMY_VISION + 50) {
        this.state = 'idle';
      }
    } else if (this.state === 'retreat') {
      this.x -= (dx / d) * 200 * dt;
      this.y -= (dy / d) * 200 * dt;
      if (this.t > 1) this.state = 'dive';
    }
    this.x = clamp(this.x, 30, camera.worldW - 30);
    this.y = clamp(this.y, 30, camera.worldH - 30);
  }
  takeDamage(dmg, ang) {
    if (this.dead) return;
    this.hp -= dmg; this.hitFlash = 1;
    burstSparks(this.x, this.y, 8, '#a080ff', 220);
    if (this.hp <= 0) this.die();
  }
  die() {
    this.dead = true;
    Audio.sfx('crow');
    burstSparks(this.x, this.y, 15, '#a080ff', 300);
    dropLoot(this.x, this.y, { gold: randInt(3, 6), oreChance: 0.15 });
  }
  draw(g) {
    if (this.dead) return;
    const flap = Math.sin(this.t * 20) * 6;
    g.save(); g.translate(this.x, this.y);
    g.fillStyle = this.hitFlash > 0.3 ? '#fff' : '#2a1a3a';
    g.beginPath(); g.ellipse(0, 0, 10, 8, 0, 0, TAU); g.fill();
    g.fillStyle = '#1a0f28';
    g.beginPath();
    g.moveTo(-6, -2); g.lineTo(-22, -8 - flap); g.lineTo(-8, 2); g.closePath(); g.fill();
    g.beginPath();
    g.moveTo(6, -2); g.lineTo(22, -8 - flap); g.lineTo(8, 2); g.closePath(); g.fill();
    g.shadowColor = '#ff5a5a'; g.shadowBlur = 8; g.fillStyle = '#ff4a4a';
    g.beginPath(); g.arc(-3, -1, 1.8, 0, TAU); g.fill();
    g.beginPath(); g.arc(3, -1, 1.8, 0, TAU); g.fill();
    g.restore();
  }
}

/* NOVO INIMIGO — Caranguejo de Cristal */
class CrystalCrab {
  constructor(x, y) {
    this.x = x; this.y = y; this.r = 28;
    this.maxHp = 120; this.hp = 120;
    this.dead = false; this.hitFlash = 0; this.t = rand(0, 5);
    this.state = 'idle'; this.attackCd = 0;
    this.legPhase = 0;
  }
  update(dt, p) {
    if (this.dead) return;
    this.t += dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt * 3);
    this.attackCd = Math.max(0, this.attackCd - dt);
    const dx = p.x - this.x, dy = p.y - this.y, d = Math.hypot(dx, dy) || 1;

    if (d < ENEMY_VISION && !p.dead) {
      if (d > 60) {
        this.x += (dx / d) * 70 * dt;
        this.y += (dy / d) * 70 * dt;
        this.legPhase += dt * 8;
      }
      if (d < 70 && this.attackCd <= 0) {
        p.takeDamage(18, Math.atan2(p.y - this.y, p.x - this.x));
        this.attackCd = 1.2;
        burstSparks(this.x, this.y, 8, '#9fe8ff', 200);
      }
    }
    this.x = clamp(this.x, 30, camera.worldW - 30);
    this.y = clamp(this.y, 30, camera.worldH - 30);
  }
  takeDamage(dmg, ang) {
    if (this.dead) return;
    this.hp -= dmg - 3; // defesa
    this.hitFlash = 1;
    burstSparks(this.x, this.y, 8, '#9fe8ff', 260);
    if (this.hp <= 0) this.die();
  }
  die() {
    this.dead = true;
    Audio.sfx('shatter');
    burstShards(this.x, this.y, 80, ['#9fe8ff', '#c9a7ff', '#7dffb0']);
    dropLoot(this.x, this.y, { gold: randInt(8, 15), oreChance: 0.5 });
  }
  draw(g) {
    if (this.dead) return;
    g.save(); g.translate(this.x, this.y);
    const legW = Math.sin(this.legPhase) * 3;
    g.strokeStyle = '#4a3a5a'; g.lineWidth = 3; g.lineCap = 'round';
    for (let s = -1; s <= 1; s += 2) {
      for (let i = 0; i < 3; i++) {
        const lx = i * 8 - 8;
        g.beginPath();
        g.moveTo(lx, 12);
        g.lineTo(lx + s * (14 + legW), 24);
        g.stroke();
      }
    }
    const shellGrad = g.createRadialGradient(-4, -6, 0, 0, 0, 30);
    shellGrad.addColorStop(0, '#c9a7ff');
    shellGrad.addColorStop(0.6, '#6a4ac0');
    shellGrad.addColorStop(1, '#2a1a5a');
    g.fillStyle = this.hitFlash > 0.3 ? '#fff' : shellGrad;
    g.beginPath(); g.ellipse(0, 0, 26, 20, 0, 0, TAU); g.fill();
    g.fillStyle = '#ff4a8a';
    g.beginPath(); g.arc(-8, -6, 2.2, 0, TAU); g.fill();
    g.beginPath(); g.arc(8, -6, 2.2, 0, TAU); g.fill();
    // pinças
    g.strokeStyle = '#6a4ac0'; g.lineWidth = 5;
    g.beginPath(); g.moveTo(-22, -2); g.lineTo(-32, -12); g.stroke();
    g.beginPath(); g.moveTo(22, -2); g.lineTo(32, -12); g.stroke();
    g.restore();
  }
}

/* NOVO INIMIGO — Troll da Caverna */
class CaveTroll {
  constructor(x, y) {
    this.x = x; this.y = y; this.r = 40;
    this.maxHp = 180; this.hp = 180;
    this.dead = false; this.hitFlash = 0; this.t = rand(0, 5);
    this.state = 'idle'; this.stateT = 0; this.attackCd = 0;
    this.slamTarget = null;
  }
  update(dt, p) {
    if (this.dead) return;
    this.t += dt; this.stateT += dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt * 3);
    this.attackCd = Math.max(0, this.attackCd - dt);
    const dx = p.x - this.x, dy = p.y - this.y, d = Math.hypot(dx, dy) || 1;

    if (this.state === 'idle') {
      if (d < ENEMY_VISION && !p.dead) {
        if (d > 90) {
          this.x += (dx / d) * 90 * dt;
          this.y += (dy / d) * 90 * dt;
        }
        if (d < 130 && this.attackCd <= 0) {
          this.state = 'windup'; this.stateT = 0;
          this.slamTarget = { x: p.x, y: p.y };
        }
      }
    } else if (this.state === 'windup') {
      if (this.stateT > 0.7) {
        this.state = 'slam'; this.stateT = 0;
        Audio.sfx('slam'); camera.shake(12, 0.4);
        if (this.slamTarget && Math.hypot(p.x - this.slamTarget.x, p.y - this.slamTarget.y) < 90 && !p.dead) {
          p.takeDamage(25, Math.atan2(p.y - this.y, p.x - this.x));
        }
        for (let i = 0; i < 20; i++) {
          const a = rand(0, TAU);
          P({ type: 'spark', x: this.slamTarget.x, y: this.slamTarget.y,
              vx: Math.cos(a) * rand(80, 300), vy: Math.sin(a) * rand(60, 200),
              life: rand(0.3, 0.7), size: rand(2, 5),
              color: pick(['#8a6a3a', '#c9a06a', '#5c4326']), drag: 0.9, grav: 400, add: false });
        }
      }
    } else if (this.state === 'slam') {
      if (this.stateT > 0.6) { this.state = 'idle'; this.stateT = 0; this.attackCd = 1.5; }
    }
  }
  takeDamage(dmg, ang) {
    if (this.dead) return;
    this.hp -= dmg; this.hitFlash = 1;
    burstSparks(this.x, this.y, 10, '#8a6a3a', 260);
    if (this.hp <= 0) this.die();
  }
  die() {
    this.dead = true;
    Audio.sfx('slam'); camera.shake(15, 0.5);
    burstShards(this.x, this.y, 120, ['#8a6a3a', '#5c4326', '#3a2a1a']);
    dropLoot(this.x, this.y, { gold: randInt(15, 25), oreChance: 0.9 });
  }
  draw(g) {
    if (this.dead) return;
    const breathe = Math.sin(this.t * 2) * 3;
    g.save(); g.globalAlpha = 0.4; g.fillStyle = '#000';
    g.beginPath(); g.ellipse(this.x, this.y + 30, 42, 14, 0, 0, TAU); g.fill(); g.restore();
    g.save(); g.translate(this.x, this.y + breathe);
    if (this.state === 'windup') {
      g.globalAlpha = 0.4 + Math.sin(this.stateT * 20) * 0.3;
    }
    g.fillStyle = this.hitFlash > 0.3 ? '#fff' : '#3a5a3a';
    g.beginPath(); g.ellipse(0, 0, 32, 38, 0, 0, TAU); g.fill();
    g.fillStyle = '#2a4a2a';
    g.beginPath(); g.arc(0, -30, 22, 0, TAU); g.fill();
    g.fillStyle = '#ff5a2a';
    g.beginPath(); g.arc(-8, -32, 3, 0, TAU); g.fill();
    g.beginPath(); g.arc(8, -32, 3, 0, TAU); g.fill();
    // braços
    g.strokeStyle = '#3a5a3a'; g.lineWidth = 12; g.lineCap = 'round';
    g.beginPath(); g.moveTo(-28, -6); g.lineTo(-46, 14); g.stroke();
    g.beginPath(); g.moveTo(28, -6); g.lineTo(46, 14); g.stroke();
    g.restore();
  }
}

/* ==================== DROP DE LOOT ==================== */
function dropLoot(x, y, opts) {
  const goldAmount = opts.gold || 0;
  for (let i = 0; i < goldAmount; i++) {
    P({
      type: 'coin',
      x: x + rand(-15, 15), y: y + rand(-10, 5),
      vx: rand(-80, 80), vy: rand(-150, -60),
      life: 0.8, size: rand(3, 5), color: '#ffe066',
      drag: 0.92, grav: 400, rot: 0, rotV: rand(-10, 10)
    });
  }
  Inventory.addGold(goldAmount);

  if (opts.oreChance && Math.random() < opts.oreChance) {
    Inventory.add('iron_ore', 1);
    showToast('+1 Minério de Ferro');
    if (Quests.isActive('iron_quest')) {
      Quests.update('iron_quest', Inventory.count('iron_ore'));
    }
  }
}

/* ==================== NPCs ==================== */
class Galdur {
  constructor(x, y) {
    this.x = x; this.y = y; this.r = 22;
    this.t = rand(0, 5); this.panic = 0; this.dead = false;
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
    g.save(); g.globalAlpha = 0.3; g.fillStyle = '#000';
    g.beginPath(); g.ellipse(this.x, this.y + 16, 20, 7, 0, 0, TAU); g.fill(); g.restore();
    for (const l of this.lanterns) {
      const lx = this.x + Math.cos(l.a) * l.rad + shake;
      const ly = this.y - 34 + Math.sin(l.a) * 16 + bob;
      const lg = g.createRadialGradient(lx, ly, 0, lx, ly, 58);
      lg.addColorStop(0, l.hue === '#ffb347' ? 'rgba(255,179,71,0.30)' :
                            l.hue === '#7fe4ff' ? 'rgba(127,228,255,0.28)' : 'rgba(255,127,168,0.26)');
      lg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = lg; g.beginPath(); g.arc(lx, ly, 58, 0, TAU); g.fill();
      g.fillStyle = l.hue; g.shadowColor = l.hue; g.shadowBlur = 16;
      g.beginPath(); g.arc(lx, ly, 3.4, 0, TAU); g.fill();
      g.shadowBlur = 0;
    }
    g.save(); g.translate(this.x + shake, this.y + bob);
    g.fillStyle = '#4a3520'; g.beginPath(); g.ellipse(-6, -4, 24, 26, 0, 0, TAU); g.fill();
    g.fillStyle = '#5c4326'; g.beginPath(); g.ellipse(-6, -10, 19, 16, 0, 0, TAU); g.fill();
    g.fillStyle = '#5d7a4a'; g.beginPath(); g.ellipse(6, 4, 13, 15, 0, 0, TAU); g.fill();
    g.fillStyle = '#6d8f57'; g.beginPath(); g.arc(10, -16, 11, 0, TAU); g.fill();
    g.fillStyle = '#5d7a4a';
    g.beginPath(); g.moveTo(2, -20); g.lineTo(-9, -28); g.lineTo(4, -26); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(18, -20); g.lineTo(29, -28); g.lineTo(16, -26); g.closePath(); g.fill();
    g.fillStyle = this.panic > 0 ? '#fff' : '#ffe066';
    const eyeR = this.panic > 0 ? 4 : 2.4;
    g.beginPath(); g.arc(7, -18, eyeR, 0, TAU); g.fill();
    g.beginPath(); g.arc(15, -18, eyeR, 0, TAU); g.fill();
    g.restore();
  }
}

class Elara {
  constructor(x, y) {
    this.x = x; this.y = y; this.r = 20;
    this.t = rand(0, 5); this.dead = false;
  }
  update(dt) { this.t += dt; }
  interact() { Dialogue.start(DIALOGUES.elara); }
  draw(g) {
    g.save(); g.globalAlpha = 0.3; g.fillStyle = '#000';
    g.beginPath(); g.ellipse(this.x, this.y + 16, 20, 7, 0, 0, TAU); g.fill(); g.restore();
    const fg = g.createRadialGradient(this.x + 30, this.y + 4, 0, this.x + 30, this.y + 4, 110);
    fg.addColorStop(0, 'rgba(255,160,60,0.22)'); fg.addColorStop(1, 'rgba(255,160,60,0)');
    g.fillStyle = fg; g.beginPath(); g.arc(this.x + 30, this.y + 4, 110, 0, TAU); g.fill();
    const flick = Math.sin(this.t * 14) * 3;
    g.save(); g.globalCompositeOperation = 'lighter';
    const fireG = g.createRadialGradient(this.x + 34, this.y + 6, 0, this.x + 34, this.y + 6, 20);
    fireG.addColorStop(0, 'rgba(255,220,140,0.9)');
    fireG.addColorStop(0.5, 'rgba(255,130,40,0.5)');
    fireG.addColorStop(1, 'rgba(255,90,20,0)');
    g.fillStyle = fireG;
    g.beginPath(); g.ellipse(this.x + 34, this.y + 6 + flick * 0.3, 16, 22 + flick, 0, 0, TAU); g.fill();
    g.restore();
    g.save(); g.translate(this.x, this.y);
    g.fillStyle = '#3a4058'; g.beginPath(); g.roundRect(-12, -12, 24, 26, 8); g.fill();
    g.fillStyle = '#5a2a2a';
    g.beginPath();
    g.moveTo(-12, -10); g.quadraticCurveTo(-22, 6, -16, 16);
    g.lineTo(0, 16); g.lineTo(0, -10); g.closePath(); g.fill();
    g.fillStyle = '#e8c9a0'; g.beginPath(); g.arc(0, -22, 9.5, 0, TAU); g.fill();
    g.fillStyle = '#a8442a'; g.beginPath(); g.arc(0, -25, 10, Math.PI, TAU); g.fill();
    g.restore();
  }
}

/* NOVO NPC — Brock, o Ferreiro */
class Brock {
  constructor(x, y) {
    this.x = x; this.y = y; this.r = 24;
    this.t = rand(0, 5); this.dead = false;
  }
  update(dt) { this.t += dt; }
  interact() {
    // Se quest iron_quest ainda não começou, começa
    if (!Quests.isActive('iron_quest') && !Quests.isComplete('iron_quest') && !G.quests.brockIntro) {
      G.quests.brockIntro = true;
      Dialogue.start(DIALOGUES.brock_intro);
    } else if (Quests.isActive('iron_quest') && Inventory.count('iron_ore') >= 3) {
      // Completar quest
      Inventory.remove('iron_ore', 3);
      Inventory.add('dynamite', 1);
      Quests.complete('iron_quest');
      Dialogue.start(DIALOGUES.brock_complete);
    } else {
      Dialogue.start(DIALOGUES.brock);
    }
  }
  draw(g) {
    const bob = Math.sin(this.t * 1.8) * 2;
    const hammerSwing = Math.sin(this.t * 3) * 0.4;
    g.save(); g.globalAlpha = 0.3; g.fillStyle = '#000';
    g.beginPath(); g.ellipse(this.x, this.y + 16, 22, 8, 0, 0, TAU); g.fill(); g.restore();
    // bigorna ao lado
    g.save(); g.translate(this.x + 30, this.y + 8);
    g.fillStyle = '#1a1a20';
    g.beginPath(); g.roundRect(-12, -8, 24, 16, 2); g.fill();
    g.fillStyle = '#2a2a35';
    g.beginPath(); g.roundRect(-14, -10, 28, 4, 2); g.fill();
    g.restore();
    // faíscas ocasionais
    if (Math.random() < 0.15) {
      burstSparks(this.x + 30, this.y + 2, 3, '#ffb347', 100);
    }
    g.save(); g.translate(this.x, this.y + bob);
    // corpo robusto
    g.fillStyle = '#4a2a1a';
    g.beginPath(); g.roundRect(-14, -14, 28, 32, 6); g.fill();
    g.fillStyle = '#6a3a1a';
    g.beginPath(); g.roundRect(-10, -10, 20, 20, 4); g.fill();
    // cabeça
    g.fillStyle = '#d0a070'; g.beginPath(); g.arc(0, -22, 11, 0, TAU); g.fill();
    g.fillStyle = '#1a1a1a'; g.beginPath(); g.arc(0, -26, 11, Math.PI, TAU); g.fill();
    // barba
    g.fillStyle = '#5a2a10';
    g.beginPath(); g.arc(0, -18, 9, 0, Math.PI); g.fill();
    // olhos
    g.fillStyle = '#ffe066';
    g.beginPath(); g.arc(-4, -22, 1.5, 0, TAU); g.fill();
    g.beginPath(); g.arc(4, -22, 1.5, 0, TAU); g.fill();
    // martelo
    g.save(); g.translate(16, -6); g.rotate(-0.6 + hammerSwing);
    g.strokeStyle = '#3a2a15'; g.lineWidth = 4; g.lineCap = 'round';
    g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -18); g.stroke();
    g.fillStyle = '#4a4a55'; g.beginPath(); g.roundRect(-6, -22, 12, 8, 1); g.fill();
    g.restore();
    g.restore();
  }
}

/* ==================== DIÁLOGOS ==================== */
const DIALOGUES = {
  galdur: {
    speaker: 'Galdur, o Mercador de Restos',
    color: '#c8a24a',
    nodes: {
      start: {
        text: 'Ah! Um vivo! Quer comprar? Quer vender? Eu compro até o que você ainda não roubou!',
        options: [
          { text: 'Ver mercadorias', action: () => { Dialogue.close(); setTimeout(() => Shop.open('galdur'), 200); } },
          { text: 'Sobre Morgath...', next: 'morgath' },
          { text: 'Sair', next: null }
        ]
      },
      morgath: {
        text: 'Ele era um bosque. Aí as raízes beberam algo errado. Você vai lá no final, né? Todo mundo vai.',
        options: [{ text: 'Voltar', next: 'start' }]
      }
    }
  },
  elara: {
    speaker: 'Elara, a Cavaleira Desonrada',
    color: '#8fb6e8',
    nodes: {
      start: {
        text: 'O escudo já foi dourado. Agora é ferro, ferrugem e paciência. A caverna? Pedra enorme bloqueia. Precisa de dinamite — fale com Brock, o ferreiro.',
        options: [
          { text: 'O que há na caverna?', next: 'caverna' },
          { text: 'Adeus', next: null }
        ]
      },
      caverna: {
        text: 'Cristais amaldiçoados. E além dela... o trono de Morgath. Dizem que a luz não chega lá. Você precisa de coragem.',
        options: [{ text: 'Voltar', next: 'start' }]
      }
    }
  },
  brock: {
    speaker: 'Brock, o Ferreiro',
    color: '#d0a070',
    nodes: {
      start: {
        text: 'Precisa de aço? Eu forjo. Mas primeiro traga minério — não trabalho de graça.',
        options: [
          { text: 'Ver upgrades', action: () => { Dialogue.close(); setTimeout(() => Shop.open('brock'), 200); } },
          { text: 'Sair', next: null }
        ]
      }
    }
  },
  brock_intro: {
    speaker: 'Brock, o Ferreiro',
    color: '#d0a070',
    nodes: {
      start: {
        text: 'Você é novo aqui. Aquela pedra enorme na floresta? Bloqueia a caverna. Preciso de 3 minérios de ferro pra forjar dinamite. Traga e eu te dou.',
        options: [
          { text: 'Aceito a missão', action: () => {
            Quests.add('iron_quest', 'Colete 3 minérios de ferro na floresta', Inventory.count('iron_ore'), 3);
            Dialogue.close();
          }},
          { text: 'Depois', next: null }
        ]
      }
    }
  },
  brock_complete: {
    speaker: 'Brock, o Ferreiro',
    color: '#d0a070',
    nodes: {
      start: {
        text: 'Boa! Aqui está a dinamite. Use na pedra da caverna — pressione E perto dela. E cuidado lá dentro.',
        options: [
          { text: 'Obrigado, Brock', action: () => {
            Quests.add('dynamite_quest', 'Use a dinamite na pedra da caverna', 0, 1);
            Dialogue.close();
          }}
        ]
      }
    }
  }
};

/* ==================== SHOP ==================== */
const SHOP_DATA = {
  galdur: {
    name: 'Galdur — Mercador',
    buy: [
      { id: 'potion', price: 15 },
      { id: 'iron_ore', price: 20 }
    ],
    sell: ['potion', 'iron_ore']
  },
  brock: {
    name: 'Brock — Ferraria',
    upgrades: [
      { id: 'steelSword', name: 'Espada de Aço', price: 60, desc: '+15 dano por golpe' },
      { id: 'ironArmor', name: 'Armadura de Ferro', price: 80, desc: '+30 HP máximo' },
      { id: 'swiftBoots', name: 'Botas Velozes', price: 70, desc: '+20% velocidade' }
    ]
  }
};

const Shop = {
  active: false, current: null, tab: 'buy',
  open(id) {
    this.active = true; this.current = id; this.tab = 'buy';
    G.paused = true;
    document.getElementById('shop').classList.remove('hidden');
    document.getElementById('shopname').textContent = SHOP_DATA[id].name;
    this.render();
    document.querySelectorAll('.shoptab').forEach(t => {
      t.onclick = () => { this.tab = t.dataset.tab; this.render(); };
    });
  },
  close() {
    this.active = false; G.paused = false;
    document.getElementById('shop').classList.add('hidden');
  },
  render() {
    document.querySelectorAll('.shoptab').forEach(t =>
      t.classList.toggle('active', t.dataset.tab === this.tab));
    document.getElementById('shopgold').textContent = Inventory.gold;
    const list = document.getElementById('shoplist');
    list.innerHTML = '';
    const data = SHOP_DATA[this.current];

    if (this.tab === 'buy') {
      if (data.buy) {
        for (const entry of data.buy) {
          const def = ITEMS[entry.id];
          const can = Inventory.gold >= entry.price;
          const el = document.createElement('div');
          el.className = 'shopitem' + (can ? '' : ' disabled');
          el.innerHTML = `
            <div class="shopicon ${def.icon}"></div>
            <div class="shopinfo">
              <div class="shopitemname">${def.name}</div>
              <div class="shopitemdesc">${def.desc}</div>
            </div>
            <div class="shopprice">${entry.price} ouro</div>
          `;
          if (can) el.onclick = () => this.buyItem(entry.id, entry.price);
          list.appendChild(el);
        }
      }
      if (data.upgrades) {
        for (const up of data.upgrades) {
          const owned = player.upgrades[up.id];
          const can = !owned && Inventory.gold >= up.price;
          const el = document.createElement('div');
          el.className = 'shopitem' + (can ? '' : ' disabled');
          el.innerHTML = `
            <div class="shopicon upgrade">+</div>
            <div class="shopinfo">
              <div class="shopitemname">${up.name}${owned ? ' (Comprado)' : ''}</div>
              <div class="shopitemdesc">${up.desc}</div>
            </div>
            <div class="shopprice">${owned ? '—' : up.price + ' ouro'}</div>
          `;
          if (can) el.onclick = () => this.buyUpgrade(up);
          list.appendChild(el);
        }
      }
    } else {
      if (data.sell) {
        let hasAny = false;
        for (const id of data.sell) {
          if (Inventory.count(id) > 0) {
            hasAny = true;
            const def = ITEMS[id];
            const el = document.createElement('div');
            el.className = 'shopitem';
            el.innerHTML = `
              <div class="shopicon ${def.icon}"></div>
              <div class="shopinfo">
                <div class="shopitemname">${def.name} (x${Inventory.count(id)})</div>
                <div class="shopitemdesc">${def.desc}</div>
              </div>
              <div class="shopprice">+${def.sell} ouro</div>
            `;
            el.onclick = () => this.sellItem(id, def.sell);
            list.appendChild(el);
          }
        }
        if (!hasAny) list.innerHTML = '<div style="text-align:center;color:#888;padding:20px;font-style:italic;">Você não tem nada para vender</div>';
      }
    }
  },
  buyItem(id, price) {
    if (Inventory.gold < price) return;
    Inventory.addGold(-price);
    Inventory.add(id, 1);
    Audio.sfx('buy');
    this.render();
  },
  sellItem(id, price) {
    if (Inventory.count(id) <= 0) return;
    Inventory.remove(id, 1);
    Inventory.addGold(price);
    Audio.sfx('coin');
    this.render();
  },
  buyUpgrade(up) {
    if (Inventory.gold < up.price || player.upgrades[up.id]) return;
    Inventory.addGold(-up.price);
    player.upgrades[up.id] = true;
    player.applyUpgrades();
    Audio.sfx('buy');
    showToast(`Upgrade adquirido: ${up.name}`);
    this.render();
  }
};

/* ==================== DIÁLOGO ==================== */
const Dialogue = {
  active: false, typing: false, tree: null, node: null, full: '', shown: 0, el: {},
  init() {
    this.el.panel = document.getElementById('dialogue');
    this.el.name = document.getElementById('dlgName');
    this.el.text = document.getElementById('dlgText');
    this.el.options = document.getElementById('dlgOptions');
    this.el.portrait = document.getElementById('dlgPortrait');
  },
  start(tree) {
    this.tree = tree; this.active = true;
    this.el.panel.classList.remove('hidden');
    G.paused = true;
    this.show('start');
  },
  show(id) {
    this.node = this.tree.nodes[id];
    this.el.name.textContent = this.tree.speaker;
    this.el.name.style.color = this.tree.color;
    this.el.portrait.style.background = `radial-gradient(circle at 40% 30%, ${this.tree.color}, #0a0a12 72%)`;
    this.full = this.node.text; this.shown = 0; this.typing = true;
    this.el.text.textContent = '';
    this.el.options.innerHTML = '';
  },
  update(dt) {
    if (!this.active || !this.typing) return;
    this.shown += dt * 62;
    if (this.shown >= this.full.length) {
      this.shown = this.full.length; this.typing = false; this.buildOptions();
    }
    this.el.text.textContent = this.full.slice(0, Math.floor(this.shown));
  },
  skip() {
    if (!this.typing) return;
    this.shown = this.full.length; this.typing = false;
    this.el.text.textContent = this.full;
    this.buildOptions();
  },
  buildOptions() {
    this.el.options.innerHTML = '';
    const opts = this.node.options || [{ text: '(Fim)', next: null }];
    opts.forEach(o => {
      const b = document.createElement('button');
      b.className = 'dlgopt'; b.textContent = o.text;
      b.addEventListener('click', () => this.choose(o));
      this.el.options.appendChild(b);
    });
  },
  choose(o) {
    if (o.action) { o.action(); return; }
    if (o.next) this.show(o.next);
    else this.close();
  },
  close() {
    this.active = false; this.typing = false;
    this.el.panel.classList.add('hidden');
    G.paused = false;
  }
};

/* ==================== INVENTÁRIO UI ==================== */
function toggleInventory() {
  const inv = document.getElementById('inventory');
  if (inv.classList.contains('hidden')) {
    inv.classList.remove('hidden');
    refreshInventory();
    G.paused = true;
    Audio.sfx('ice');
  } else {
    inv.classList.add('hidden');
    G.paused = false;
  }
}

function usePotion() {
  if (Inventory.count('potion') <= 0 || !player || player.dead) return;
  Inventory.remove('potion', 1);
  player.hp = Math.min(player.maxHp, player.hp + 22);
  player.rage = Math.min(player.maxRage, player.rage + 9);
  player.invuln = Math.max(player.invuln, 0.4);
  Audio.sfx('drink'); camera.shake(5, 0.25);
  for (let i = 0; i < 30; i++) {
    const a = rand(0, TAU);
    P({ type: 'spark', x: player.x, y: player.y - 10,
        vx: Math.cos(a) * rand(40, 220), vy: Math.sin(a) * rand(40, 220) - 60,
        life: rand(0.4, 1.0), size: rand(2, 4.5),
        color: pick(['#ff5d4a', '#ffb347', '#ff2a2a']), drag: 0.92, grav: 60 });
  }
}

/* ==================== INTERAÇÃO ==================== */
function tryInteract() {
  if (G.paused || G.transitioning || !player || player.dead) return;
  let best = null, bestD = 130;
  for (const n of G.npcs) {
    const d = Math.hypot(n.x - player.x, n.y - player.y);
    if (d < bestD) { bestD = d; best = n; }
  }
  if (best) { best.interact(); return; }

  // Boulder
  if (MapSystem.current === 1 && !G.boulderBroken) {
    const bd = Math.hypot(player.x - BOULDER.x, player.y - BOULDER.y);
    if (bd < 100 && Inventory.count('dynamite') > 0) {
      blowBoulder();
      return;
    }
  }
}

function blowBoulder() {
  if (G.boulderBroken) return;
  Inventory.remove('dynamite', 1);
  G.boulderBroken = true;
  Quests.complete('dynamite_quest');
  Audio.sfx('boom');
  camera.shake(30, 1.2);
  for (let i = 0; i < 100; i++) {
    const a = rand(0, TAU), s = rand(100, 700);
    P({ type: 'shard', x: BOULDER.x, y: BOULDER.y,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s - rand(100, 300),
        life: rand(1, 2.5), size: rand(4, 14),
        color: pick(['#6a6050', '#8a8070', '#4a4030', '#ffe066']),
        grav: 500, rot: rand(0, TAU), rotV: rand(-10, 10), add: false });
  }
  showToast('💥 A passagem foi aberta!');
  MapSystem.refreshPortals();
}

/* ==================== PORTAL ==================== */
class Portal {
  constructor(x, y, targetMap, label, blocked) {
    this.x = x; this.y = y;
    this.targetMap = targetMap;
    this.label = label;
    this.blocked = blocked || false;
    this.r = 50; this.t = 0;
  }
  update(dt) { this.t += dt; }
  draw(g) {
    if (this.blocked) {
      // desenha pedra no lugar
      g.save(); g.translate(this.x, this.y);
      g.fillStyle = '#3a3024';
      g.beginPath(); g.ellipse(0, 0, 65, 55, 0, 0, TAU); g.fill();
      g.fillStyle = '#4a4030';
      g.beginPath(); g.ellipse(-15, -12, 30, 25, 0.3, 0, TAU); g.fill();
      g.beginPath(); g.ellipse(20, 10, 25, 20, -0.2, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.4)'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(-30, -20); g.lineTo(-10, 0); g.lineTo(10, -10); g.stroke();
      g.font = 'bold 16px Georgia'; g.textAlign = 'center';
      g.fillStyle = 'rgba(255,150,80,0.85)';
      g.fillText('PEDRA BLOQUEANDO', 0, -75);
      g.restore();
      return;
    }
    const pulse = 0.6 + Math.sin(this.t * 3) * 0.4;
    g.save(); g.globalCompositeOperation = 'lighter';
    const gg = g.createRadialGradient(this.x, this.y, 0, this.x, this.y, 90);
    gg.addColorStop(0, `rgba(120,220,255,${0.35 * pulse})`);
    gg.addColorStop(0.6, `rgba(80,160,255,${0.15 * pulse})`);
    gg.addColorStop(1, 'rgba(40,80,200,0)');
    g.fillStyle = gg; g.beginPath(); g.arc(this.x, this.y, 90, 0, TAU); g.fill();
    g.strokeStyle = `rgba(180,240,255,${0.7 * pulse})`; g.lineWidth = 3;
    for (let i = 0; i < 3; i++) {
      const r = 30 + i * 12 + Math.sin(this.t * 2 + i) * 4;
      g.beginPath(); g.ellipse(this.x, this.y, r, r * 0.55, this.t * 0.5, 0, TAU); g.stroke();
    }
    g.restore();
    g.save();
    g.font = 'bold 16px Georgia'; g.textAlign = 'center';
    g.fillStyle = 'rgba(200,235,255,0.95)'; g.shadowColor = 'rgba(0,0,0,0.9)'; g.shadowBlur = 8;
    g.fillText(this.label, this.x, this.y - 62);
    g.restore();
  }
}

const BOULDER = { x: 3050, y: 950 };

/* ==================== MAPAS ==================== */
const MAPS = [
  {
    name: 'VILA DE AETHEL', sub: 'Refúgio dos sobreviventes',
    worldW: 2200, worldH: 1500, spawn: { x: 500, y: 900 },
    groundPattern: 'village', sky: false, ambient: 'dark',
    enemies: [], npcs: ['galdur', 'elara', 'brock'],
    buildings: [
      { type: 'blacksmith', x: 380, y: 500, w: 220, h: 180 },
      { type: 'shop',       x: 1450, y: 500, w: 240, h: 190 },
      { type: 'house1',     x: 780, y: 400, w: 180, h: 150 },
      { type: 'house2',     x: 1050, y: 420, w: 180, h: 150 },
      { type: 'well',       x: 900, y: 800, w: 100, h: 100 }
    ],
    portals: [{ x: 1950, y: 750, target: 1, label: '→ FLORESTA SOMBRIA' }]
  },
  {
    name: 'FLORESTA SOMBRIA', sub: 'Onde as raízes respiram',
    worldW: 3400, worldH: 2000, spawn: { x: 300, y: 900 },
    groundPattern: 'forest', sky: true, ambient: 'dark',
    enemies: ['stalker', 'stalker', 'golem', 'stalker', 'golem', 'stalker'],
    npcs: [],
    portals: [
      { x: 200, y: 900, target: 0, label: '← VILA DE AETHEL' },
      { x: 3050, y: 950, target: 2, label: '→ CAVERNA DE CRISTAL', blocked: true }
    ],
    boulder: true
  },
  {
    name: 'CAVERNA DE CRISTAL', sub: 'A escuridão que pulsa',
    worldW: 3000, worldH: 1800, spawn: { x: 300, y: 900 },
    groundPattern: 'cave', sky: false, ambient: 'cave',
    enemies: ['bat', 'bat', 'crab', 'troll', 'bat', 'crab', 'troll'],
    npcs: [],
    portals: [
      { x: 200, y: 900, target: 1, label: '← FLORESTA' },
      { x: 2750, y: 900, target: 3, label: '→ TRONO DE MORGATH' }
    ]
  },
  {
    name: 'TRONO DE MORGATH', sub: 'Onde o vale apodrece',
    worldW: 1800, worldH: 1200, spawn: { x: 300, y: 600 },
    groundPattern: 'forest', sky: true, ambient: 'dark',
    enemies: [], npcs: [],
    portals: [{ x: 150, y: 600, target: 2, label: '← CAVERNA' }],
    boss: { x: 1200, y: 600 }
  }
];

let boss = null, player = null, galdur = null, elara = null, brock = null;

/* ==================== CONSTRUÇÕES ==================== */
function drawBuildings(g) {
  const map = MAPS[MapSystem.current];
  if (!map.buildings) return;
  for (const b of map.buildings) {
    if (b.type === 'blacksmith') drawBlacksmith(g, b);
    else if (b.type === 'shop') drawShop(g, b);
    else if (b.type === 'house1' || b.type === 'house2') drawHouse(g, b);
    else if (b.type === 'well') drawWell(g, b);
  }
}

function drawBlacksmith(g, b) {
  const x = b.x, y = b.y, w = b.w, h = b.h;
  // parede
  const wg = g.createLinearGradient(x, y - h, x, y);
  wg.addColorStop(0, '#5a3a25'); wg.addColorStop(1, '#2a1a10');
  g.fillStyle = wg; g.fillRect(x - w/2, y - h, w, h);
  // telhado
  g.fillStyle = '#2a1a10';
  g.beginPath();
  g.moveTo(x - w/2 - 15, y - h);
  g.lineTo(x, y - h - 60);
  g.lineTo(x + w/2 + 15, y - h);
  g.closePath(); g.fill();
  // porta
  g.fillStyle = '#1a0f08';
  g.fillRect(x - 25, y - 70, 50, 70);
  // janela com brilho
  const flicker = 0.7 + Math.sin(G.time * 8) * 0.15;
  const gg = g.createRadialGradient(x + 60, y - h * 0.6, 0, x + 60, y - h * 0.6, 40);
  gg.addColorStop(0, `rgba(255,150,50,${flicker})`);
  gg.addColorStop(1, 'rgba(255,80,20,0)');
  g.fillStyle = gg; g.beginPath(); g.arc(x + 60, y - h * 0.6, 40, 0, TAU); g.fill();
  g.fillStyle = '#ff8a3a';
  g.fillRect(x + 48, y - h * 0.7, 24, 24);
  // chaminé com fumaça
  g.fillStyle = '#3a2818';
  g.fillRect(x - w/2 + 30, y - h - 70, 24, 40);
  if (Math.random() < 0.4) {
    P({ type: 'spark', x: x - w/2 + 42 + rand(-8, 8), y: y - h - 80,
        vx: rand(-20, 20), vy: rand(-50, -20), life: rand(1, 2), size: rand(4, 8),
        color: 'rgba(80,70,60,0.5)', grav: -10, drag: 0.97, add: false });
  }
  // placa
  g.fillStyle = 'rgba(20,10,5,0.9)';
  g.fillRect(x - 55, y - h - 45, 110, 26);
  g.strokeStyle = '#8a6a3a'; g.lineWidth = 2;
  g.strokeRect(x - 55, y - h - 45, 110, 26);
  g.font = 'bold 14px Georgia'; g.textAlign = 'center';
  g.fillStyle = '#ffd68a'; g.fillText('FERRARIA', x, y - h - 26);
}

function drawShop(g, b) {
  const x = b.x, y = b.y, w = b.w, h = b.h;
  const wg = g.createLinearGradient(x, y - h, x, y);
  wg.addColorStop(0, '#5a4a30'); wg.addColorStop(1, '#2a2010');
  g.fillStyle = wg; g.fillRect(x - w/2, y - h, w, h);
  g.fillStyle = '#1a1008';
  g.beginPath();
  g.moveTo(x - w/2 - 20, y - h);
  g.lineTo(x, y - h - 55);
  g.lineTo(x + w/2 + 20, y - h);
  g.closePath(); g.fill();
  // porta
  g.fillStyle = '#1a0f08'; g.fillRect(x - 30, y - 80, 60, 80);
  // janelas iluminadas
  for (let s = -1; s <= 1; s += 2) {
    const wx = x + s * 65;
    const gg = g.createRadialGradient(wx, y - h * 0.55, 0, wx, y - h * 0.55, 35);
    gg.addColorStop(0, 'rgba(255,220,120,0.85)'); gg.addColorStop(1, 'rgba(255,180,60,0)');
    g.fillStyle = gg; g.beginPath(); g.arc(wx, y - h * 0.55, 35, 0, TAU); g.fill();
    g.fillStyle = '#ffe080';
    g.fillRect(wx - 15, y - h * 0.7, 30, 30);
    g.strokeStyle = '#3a2818'; g.lineWidth = 2;
    g.strokeRect(wx - 15, y - h * 0.7, 30, 30);
  }
  // toldo
  g.fillStyle = '#8a3a2a';
  g.fillRect(x - w/2, y - h - 3, w, 12);
  // caixas
  g.fillStyle = '#4a3520';
  g.fillRect(x - w/2 - 35, y - 30, 30, 30);
  g.fillRect(x - w/2 - 35, y - 55, 25, 25);
  // placa
  g.fillStyle = 'rgba(30,15,10,0.9)';
  g.fillRect(x - 55, y - h - 40, 110, 28);
  g.strokeStyle = '#d4a030'; g.lineWidth = 2;
  g.strokeRect(x - 55, y - h - 40, 110, 28);
  g.font = 'bold 14px Georgia'; g.textAlign = 'center';
  g.fillStyle = '#ffe8a8'; g.fillText('MERCADOR', x, y - h - 20);
}

function drawHouse(g, b) {
  const x = b.x, y = b.y, w = b.w, h = b.h;
  const wg = g.createLinearGradient(x, y - h, x, y);
  wg.addColorStop(0, '#4a3a2a'); wg.addColorStop(1, '#2a1a10');
  g.fillStyle = wg; g.fillRect(x - w/2, y - h, w, h);
  g.fillStyle = '#2a1a10';
  g.beginPath();
  g.moveTo(x - w/2 - 15, y - h);
  g.lineTo(x, y - h - 55);
  g.lineTo(x + w/2 + 15, y - h);
  g.closePath(); g.fill();
  g.fillStyle = '#1a0f08'; g.fillRect(x - 25, y - 65, 50, 65);
  // janela
  const gg = g.createRadialGradient(x + 45, y - h * 0.6, 0, x + 45, y - h * 0.6, 30);
  gg.addColorStop(0, 'rgba(255,200,100,0.75)'); gg.addColorStop(1, 'rgba(255,160,50,0)');
  g.fillStyle = gg; g.beginPath(); g.arc(x + 45, y - h * 0.6, 30, 0, TAU); g.fill();
  g.fillStyle = '#ffd68a'; g.fillRect(x + 35, y - h * 0.7, 20, 20);
  // chaminé
  g.fillStyle = '#3a2818';
  g.fillRect(x + 30, y - h - 60, 20, 30);
}

function drawWell(g, b) {
  const x = b.x, y = b.y;
  g.save(); g.translate(x, y);
  // base
  g.fillStyle = '#3a3025';
  g.beginPath(); g.ellipse(0, 0, 45, 20, 0, 0, TAU); g.fill();
  g.fillStyle = '#2a2018';
  g.beginPath(); g.ellipse(0, -5, 38, 16, 0, 0, TAU); g.fill();
  // água brilhando
  const wg = g.createRadialGradient(0, -5, 0, 0, -5, 30);
  wg.addColorStop(0, 'rgba(120,200,255,0.6)'); wg.addColorStop(1, 'rgba(60,120,200,0)');
  g.fillStyle = wg; g.beginPath(); g.ellipse(0, -5, 30, 12, 0, 0, TAU); g.fill();
  // telhado
  g.fillStyle = '#4a3520';
  g.fillRect(-40, -60, 4, 55);
  g.fillRect(36, -60, 4, 55);
  g.beginPath();
  g.moveTo(-45, -60); g.lineTo(0, -85); g.lineTo(45, -60);
  g.closePath(); g.fill();
  g.restore();
}

/* ==================== MAP SYSTEM ==================== */
const MapSystem = {
  current: 0, transitionCooldown: 0,
  load(index) {
    this.current = index;
    G.currentMap = index;
    G.transitioning = true;
    G.paused = true;
    const map = MAPS[index];
    camera.worldW = map.worldW;
    camera.worldH = map.worldH;

    G.enemies = []; G.npcs = []; G.portals = [];
    boss = null; particles.length = 0; galdur = elara = brock = null;

    if (!player) player = new Player(map.spawn.x, map.spawn.y);
    else {
      player.x = map.spawn.x; player.y = map.spawn.y;
      player.invuln = 1.5;
    }
    player.applyUpgrades();

    // NPCs
    if (index === 0) {
      galdur = new Galdur(1500, 780);
      elara = new Elara(900, 1100);
      brock = new Brock(430, 780);
      G.npcs = [galdur, elara, brock];
    }

    // Inimigos
    for (const type of map.enemies) {
      let e = null;
      const ex = rand(400, map.worldW - 400);
      const ey = rand(300, map.worldH - 300);
      if (type === 'stalker') e = new MossStalker(ex, ey);
      else if (type === 'golem') e = new GlassGolem(ex, ey);
      else if (type === 'bat') e = new CaveBat(ex, ey);
      else if (type === 'crab') e = new CrystalCrab(ex, ey);
      else if (type === 'troll') e = new CaveTroll(ex, ey);
      if (e) G.enemies.push(e);
    }

    // Boss
    if (map.boss) boss = new Morgath(map.boss.x, map.boss.y);

    // Portais
    this.refreshPortals();

    // HUD
    document.getElementById('maptitle').textContent = map.name;
    document.getElementById('mapsub').textContent = map.sub;

    camera.x = clamp(player.x - VW / 2, 0, Math.max(0, map.worldW - VW));
    camera.y = clamp(player.y - VH / 2, 0, Math.max(0, map.worldH - VH));

    showTransition(map.name, map.sub, () => {
      G.transitioning = false; G.paused = false;
    });
    Audio.sfx('portal');

    // Quests por mapa
    if (index === 3 && !Quests.isComplete('boss_quest')) {
      Quests.add('boss_quest', 'Derrote Morgath no trono', 0, 1);
    }
  },

  refreshPortals() {
    G.portals = [];
    const map = MAPS[this.current];
    for (const p of map.portals) {
      let blocked = false;
      if (p.targetMap === 2 && this.current === 1) {
        blocked = !G.boulderBroken;
      }
      G.portals.push(new Portal(p.x, p.y, p.targetMap, p.label, blocked));
    }
  },

  update(dt) {
    if (this.transitionCooldown > 0) this.transitionCooldown -= dt;
    for (const p of G.portals) {
      p.update(dt);
      if (!p.blocked && this.transitionCooldown <= 0 &&
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
  }, 1200);
}

/* ==================== HUD & MINIMAP ==================== */
const hudCache = { hp: -1, mana: -1, rage: -1, boss: -1 };
let hudEls = null, minimapCanvas, minimapCtx;

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
  minimapCtx.fillStyle = 'rgba(20,28,40,0.85)'; minimapCtx.fillRect(0, 0, mw, mh);
  const groundColor = MapSystem.current === 0 ? 'rgba(70,55,40,0.7)' :
                      MapSystem.current === 2 ? 'rgba(30,20,50,0.7)' : 'rgba(24,40,30,0.7)';
  minimapCtx.fillStyle = groundColor; minimapCtx.fillRect(2, 2, mw - 4, mh - 4);

  // construções
  if (map.buildings) {
    for (const b of map.buildings) {
      minimapCtx.fillStyle = 'rgba(140,100,60,0.9)';
      minimapCtx.fillRect(b.x * sx - 3, b.y * sy - 3, 6, 6);
    }
  }

  for (const p of G.portals) {
    minimapCtx.fillStyle = p.blocked ? 'rgba(120,80,50,0.9)' : 'rgba(120,220,255,0.9)';
    minimapCtx.beginPath(); minimapCtx.arc(p.x * sx, p.y * sy, 3, 0, TAU); minimapCtx.fill();
  }
  for (const n of G.npcs) {
    minimapCtx.fillStyle = 'rgba(255,210,120,0.95)';
    minimapCtx.beginPath(); minimapCtx.arc(n.x * sx, n.y * sy, 2.5, 0, TAU); minimapCtx.fill();
  }
  for (const e of G.enemies) {
    if (e.dead) continue;
    minimapCtx.fillStyle = 'rgba(255,90,60,0.9)';
    minimapCtx.beginPath(); minimapCtx.arc(e.x * sx, e.y * sy, 2, 0, TAU); minimapCtx.fill();
  }
  if (boss && !boss.dead) {
    minimapCtx.fillStyle = 'rgba(255,50,30,1)';
    minimapCtx.beginPath(); minimapCtx.arc(boss.x * sx, boss.y * sy, 4, 0, TAU); minimapCtx.fill();
  }
  minimapCtx.save();
  minimapCtx.translate(player.x * sx, player.y * sy);
  minimapCtx.rotate(player.facing);
  minimapCtx.fillStyle = 'rgba(200,240,255,1)';
  minimapCtx.beginPath(); minimapCtx.moveTo(4, 0); minimapCtx.lineTo(-3, -3);
  minimapCtx.lineTo(-3, 3); minimapCtx.closePath(); minimapCtx.fill();
  minimapCtx.restore();
}

/* ==================== ILUMINAÇÃO ==================== */
function drawLighting() {
  const map = MAPS[MapSystem.current];
  const p2 = boss && boss.phase === 2 && !boss.dead;

  lctx.setTransform(1, 0, 0, 1, 0, 0);
  lctx.globalCompositeOperation = 'source-over';
  let ambientDark = 0.78;
  if (map.ambient === 'cave') ambientDark = 0.94;
  if (p2) ambientDark = 0.90;
  lctx.fillStyle = p2 ? `rgba(26,2,6,${ambientDark})` : `rgba(4,6,18,${ambientDark})`;
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
    lctx.beginPath(); lctx.arc(sx, sy, radius, 0, TAU); lctx.fill();
  };

  if (player && !player.dead) {
    lightAt(player.x, player.y - 10, 240, 0.95);
    lightAt(player.x, player.y - 10, 100, 0.7);
  }
  if (boss && !boss.dead) lightAt(boss.x, boss.y - 70, p2 ? 320 : 260, 0.85);

  // construções iluminadas
  if (map.buildings) {
    for (const b of map.buildings) {
      if (b.type === 'blacksmith') lightAt(b.x, b.y - b.h * 0.5, 160, 0.6);
      else if (b.type === 'shop') lightAt(b.x, b.y - b.h * 0.5, 140, 0.5);
      else if (b.type === 'house1' || b.type === 'house2') lightAt(b.x, b.y - b.h * 0.5, 110, 0.4);
      else if (b.type === 'well') lightAt(b.x, b.y, 80, 0.3);
    }
  }

  if (galdur) for (const l of galdur.lanterns)
    lightAt(galdur.x + Math.cos(l.a) * l.rad, galdur.y - 34 + Math.sin(l.a) * 16, 100, 0.5);
  if (elara) lightAt(elara.x + 34, elara.y + 6, 180, 0.75);
  if (brock) lightAt(brock.x + 30, brock.y, 130, 0.6);

  for (const e of G.enemies) {
    if (e instanceof GlassGolem && !e.dead) lightAt(e.x, e.y, 130, 0.5);
    if (e instanceof CrystalCrab && !e.dead) lightAt(e.x, e.y, 100, 0.4);
    if (e instanceof CaveBat && !e.dead) lightAt(e.x, e.y, 50, 0.3);
  }
  for (const p of G.portals) if (!p.blocked) lightAt(p.x, p.y, 130, 0.7);

  lctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(lightCanvas, 0, 0);

  // brilhos aditivos
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  const glowAt = (wx, wy, radius, color) => {
    const sx = wx - camera.x + camera.shakeX;
    const sy = wy - camera.y + camera.shakeY;
    const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, radius);
    grad.addColorStop(0, color); grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(sx, sy, radius, 0, TAU); ctx.fill();
  };
  if (player && G.legendaryEquipped && !player.dead) {
    const pulse = 0.10 + Math.sin(G.time * 5) * 0.04;
    glowAt(player.x, player.y - 10, 70, `rgba(90,210,255,${pulse})`);
  }
  if (boss && !boss.dead) {
    glowAt(boss.x, boss.y - 140, 130,
      boss.phase === 2 ? 'rgba(255,70,40,0.20)' : 'rgba(110,255,150,0.14)');
  }
  ctx.restore();
}

/* ==================== RENDER ==================== */
function render() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, VW, VH);
  const map = MAPS[MapSystem.current];

  if (map.sky) {
    drawLayer(skyLayer, 0.03, 0.03, 0.9);
    drawLayer(mountainLayer, 0.12, 0.05, 1);
    drawLayer(farForest, 0.28, 0.08, 1);
    drawLayer(nearForest, 0.55, 0.12, 1);
  } else {
    const grad = ctx.createLinearGradient(0, 0, 0, VH);
    if (map.ambient === 'cave') {
      grad.addColorStop(0, '#050510'); grad.addColorStop(0.5, '#0a0820');
      grad.addColorStop(1, '#1a0830');
    } else {
      grad.addColorStop(0, '#0a0d20'); grad.addColorStop(0.5, '#1a1d38');
      grad.addColorStop(1, '#2a2540');
    }
    ctx.fillStyle = grad; ctx.fillRect(0, 0, VW, VH);
    for (let i = 0; i < 80; i++) {
      const x = (i * 173 + 40) % VW;
      const y = (i * 97) % (VH * 0.6);
      ctx.globalAlpha = 0.4 + Math.abs(Math.sin(G.time + i)) * 0.6;
      ctx.fillStyle = map.ambient === 'cave' ? '#9a80ff' : '#fff';
      ctx.beginPath(); ctx.arc(x - camera.x * 0.05, y, 1.2, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  const camX = camera.x - camera.shakeX;
  const camY = camera.y - camera.shakeY;
  ctx.save(); ctx.translate(-camX, -camY);

  const gp = map.groundPattern === 'village' ? villageGroundPattern :
             map.groundPattern === 'cave' ? caveGroundPattern : groundPattern;
  ctx.fillStyle = gp;
  ctx.fillRect(camX - 60, camY - 60, VW + 120, VH + 120);

  // construções (chão)
  drawBuildings(ctx);

  // névoa
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 10; i++) {
    const t = G.time * 0.25 + i * 1.9;
    const x = camX + ((i * 137 + Math.sin(t) * 90) % (VW + 300)) - 150;
    const y = camY + 120 + ((i * 211) % (VH - 200));
    const r = 160 + Math.sin(t * 1.4 + i) * 50;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(110,150,220,0.025)');
    grad.addColorStop(1, 'rgba(110,150,220,0)');
    ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  }
  ctx.restore();

  // folhas ambientes
  if (map.sky && Math.random() < 0.25) {
    P({ type: 'leaf', x: camX + rand(0, VW), y: camY + rand(-50, 100),
        vx: rand(-30, 30), vy: rand(20, 60),
        life: rand(4, 8), size: rand(3, 6),
        color: pick(['rgba(120,160,90,0.7)', 'rgba(90,130,70,0.7)']),
        drag: 0.99, grav: 15, rot: rand(0, TAU), rotV: rand(-2, 2), add: false });
  }

  // entidades ordenadas
  const drawables = [];
  if (player) drawables.push(player);
  if (boss && !boss.dead) drawables.push(boss);
  for (const e of G.enemies) if (!e.dead) drawables.push(e);
  for (const n of G.npcs) drawables.push(n);
  drawables.sort((a, b) => a.y - b.y);

  for (const p of G.portals) p.draw(ctx);
  for (const d of drawables) d.draw(ctx);
  drawParticles(ctx);

  // Indicador de interação
  if (!Dialogue.active && !G.paused && !G.transitioning && player && !player.dead) {
    // NPCs
    for (const n of G.npcs) {
      if (Math.hypot(n.x - player.x, n.y - player.y) < 130) {
        drawInteractIcon(ctx, n.x, n.y - 80);
      }
    }
    // Boulder
    if (MapSystem.current === 1 && !G.boulderBroken &&
        Math.hypot(player.x - BOULDER.x, player.y - BOULDER.y) < 100 &&
        Inventory.count('dynamite') > 0) {
      drawInteractIcon(ctx, BOULDER.x, BOULDER.y - 90);
    }
  }

  ctx.restore();
  if (map.sky) drawLayer(foreLayer, 1.35, 0.08, 1);
  drawLighting();

  if (boss && boss.phase === 2 && !boss.dead) {
    ctx.save(); ctx.globalCompositeOperation = 'overlay';
    ctx.fillStyle = 'rgba(160,20,10,0.16)';
    ctx.fillRect(0, 0, VW, VH); ctx.restore();
  }
}

function drawInteractIcon(g, x, y) {
  g.save(); g.globalAlpha = 0.9;
  g.fillStyle = 'rgba(12,16,28,0.9)';
  g.strokeStyle = 'rgba(200,220,255,0.8)';
  g.lineWidth = 2;
  const yo = Math.sin(G.time * 4) * 3;
  g.beginPath(); g.roundRect(x - 13, y + yo, 26, 26, 6);
  g.fill(); g.stroke();
  g.fillStyle = '#e8f0ff'; g.font = 'bold 16px Georgia';
  g.textAlign = 'center'; g.fillText('E', x, y + 18 + yo);
  g.restore();
}

/* ==================== VITÓRIA / NEW GAME+ ==================== */
function showVictoryScreen() {
  G.paused = true;
  Quests.complete('boss_quest');
  document.getElementById('vtotalgold').textContent = Inventory.gold;
  const upCount = Object.values(player.upgrades).filter(v => v).length;
  document.getElementById('vupgrades').textContent = upCount;
  document.getElementById('victory').classList.remove('hidden');
}

function startNewGamePlus() {
  G.newGamePlus++;
  document.getElementById('victory').classList.add('hidden');
  G.over = false;

  // Reset progresso
  G.quests = {};
  G.boulderBroken = false;
  Quests.active = []; Quests.completed = [];
  Quests.render();

  // Mantém inventory e gold
  if (Inventory.count('dynamite') > 0) Inventory.remove('dynamite', Inventory.count('dynamite'));

  // Recria player mantendo upgrades
  const oldUpgrades = { ...player.upgrades };
  const oldGold = Inventory.gold;
  const oldItems = { ...Inventory.items };

  player = new Player(0, 0);
  player.upgrades = oldUpgrades;
  player.applyUpgrades();
  player.hp = player.maxHp;
  player.mana = player.maxMana;

  Inventory.gold = oldGold;
  Inventory.items = oldItems;
  refreshGold(); refreshInventory();

  // Vai para vila
  MapSystem.current = 0;
  MapSystem.load(0);
  showToast('Novo Jogo+ iniciado — você mantém seus equipamentos');
}

/* ==================== LOOP ==================== */
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
  Dialogue.update(dt);
  camera.updateShake(dt);

  if (!G.running || G.transitioning) return;
  if (G.paused) return;

  updateParticles(dt);
  if (player) player.update(dt);
  if (boss && !boss.dead) boss.update(dt, player);
  for (const e of G.enemies) e.update(dt, player);
  for (const n of G.npcs) n.update(dt);

  MapSystem.update(dt);
  camera.follow(player, dt);
  updateHUD();
  drawMinimap();

  for (let i = G.enemies.length - 1; i >= 0; i--) {
    if (G.enemies[i].dead) {
      G.enemies[i].deadT = (G.enemies[i].deadT || 0) + dt;
      if (G.enemies[i].deadT > 4) G.enemies.splice(i, 1);
    }
  }
}

/* ==================== BOOT ==================== */
function boot() {
  buildLayers();
  Dialogue.init();
  initHUD();

  MapSystem.load(0);
  document.getElementById('transition').classList.add('hidden');
  G.transitioning = false;
  refreshGold();

  document.getElementById('startbtn').addEventListener('click', () => {
    document.getElementById('startscreen').classList.add('hidden');
    G.running = true; G.paused = false;
    Audio.unlock(); Audio.sfx('nova');
    if (player) burstIce(player.x, player.y, 40, 0, 320);
  });

  document.getElementById('newgameplusbtn').addEventListener('click', startNewGamePlus);

  // Fechar loja ao clicar fora (Escape já trata)
  requestAnimationFrame(loop);
}

boot();

})();
