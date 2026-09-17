(() => {
"use strict";

/* ============================================================
   과일 정의 — 반지름, 3단 색상, 장식 패턴
   ============================================================ */
const FRUITS = [
  {name:"체리",     r:13, c1:"#FF8A96", c2:"#E8324A", c3:"#8E0F22", d:"cherry"},
  {name:"딸기",     r:17, c1:"#FF8C7E", c2:"#E32E42", c3:"#90101F", d:"strawberry"},
  {name:"포도",     r:22, c1:"#C1A8F5", c2:"#7B4FC9", c3:"#3C1F6B", d:"grape"},
  {name:"한라봉",   r:27, c1:"#FFCB6B", c2:"#F2901B", c3:"#A8500A", d:"citrus"},
  {name:"감",       r:33, c1:"#FFB273", c2:"#EE6A1C", c3:"#9E3A08", d:"persimmon"},
  {name:"사과",     r:40, c1:"#FF8272", c2:"#D42033", c3:"#7C0E1D", d:"apple"},
  {name:"배",       r:47, c1:"#F7ECA0", c2:"#D6C455", c3:"#8A7420", d:"pear"},
  {name:"복숭아",   r:55, c1:"#FFC4D0", c2:"#EE7E96", c3:"#B3435F", d:"peach"},
  {name:"파인애플", r:64, c1:"#FFE27A", c2:"#E5AC1E", c3:"#96690A", d:"pineapple"},
  {name:"멜론",     r:74, c1:"#DDF0A0", c2:"#97C247", c3:"#557A22", d:"melon"},
  {name:"수박",     r:84, c1:"#62B85A", c2:"#2E7D36", c3:"#10381A", d:"watermelon"},
];
const MERGE_SCORE = [1,3,6,10,15,21,28,36,45,55,100];
const DROPPABLE   = 5;   // 체리~감 까지만 손에 들어온다

/* ============================================================
   무대 크기 / 물리 상수 (좌표는 항상 논리 단위)
   ============================================================ */
const W = 420, H = 620;
const DANGER_Y = 112;
const HOLD_Y   = 54;
const GRAVITY  = 2100;
const REST     = 0.05;
const FRICTION = 0.45;
const SUBSTEPS = 3;
const ITER     = 10;
const MAX_SPEED= 1700;
const DROP_CD  = 0.42;
const OVER_TIME= 1.5;
const GRACE    = 0.55;

/* ============================================================
   DOM
   ============================================================ */
const boardEl   = document.getElementById("board");
const cv        = document.getElementById("game");
const ctx       = cv.getContext("2d");
const scoreEl   = document.getElementById("score");
const scoreMEl  = document.getElementById("scoreM");
const bestEl    = document.getElementById("best");
const bestFruitEl = document.getElementById("bestFruit");
const nextName  = document.getElementById("nextName");
const nextCv    = document.getElementById("nextCanvas");
const nextCvM   = document.getElementById("nextCanvasM");
const chainEl   = document.getElementById("chain");
const chainMEl  = document.getElementById("chainM");
const overEl    = document.getElementById("over");
const overTitle = document.getElementById("overTitle");
const overSub   = document.getElementById("overSub");
const finalEl   = document.getElementById("finalScore");

/* ============================================================
   저장소 (샌드박스에서 막힐 수 있으므로 감싸둔다)
   ============================================================ */
const store = {
  get(k, f){ try { const v = localStorage.getItem(k); return v === null ? f : v; } catch(e){ return f; } },
  set(k, v){ try { localStorage.setItem(k, v); } catch(e){} }
};

/* ============================================================
   상태
   ============================================================ */
let bodies = [], particles = [], pops = [];
let score = 0;
let best = parseInt(store.get("suika.best", "0"), 10) || 0;
let bestFruit = parseInt(store.get("suika.bestFruit", "0"), 10) || 0;
let unlocked = new Array(FRUITS.length).fill(false);
let queue = [rndLevel(), rndLevel()];
let heldX = W / 2;
let cooldown = 0;
let running = true;
let dangerPulse = 0;
let shake = 0;
let uid = 1;

function rndLevel(){ return Math.floor(Math.random() * DROPPABLE); }

/* ============================================================
   사운드 — 첫 입력 때 생성
   ============================================================ */
let ac = null, soundOn = store.get("suika.sound", "1") === "1";
function audio(){
  if (!soundOn) return null;
  if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch(e){ return null; } }
  if (ac.state === "suspended") ac.resume();
  return ac;
}
function blip(freq, dur, type, vol){
  const a = audio(); if (!a) return;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type || "sine";
  o.frequency.setValueAtTime(freq, a.currentTime);
  o.frequency.exponentialRampToValueAtTime(freq * 0.78, a.currentTime + dur);
  g.gain.setValueAtTime(0, a.currentTime);
  g.gain.linearRampToValueAtTime(vol || 0.16, a.currentTime + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
  o.connect(g); g.connect(a.destination);
  o.start(); o.stop(a.currentTime + dur + 0.02);
}
function sndDrop(){ blip(180, 0.1, "triangle", 0.1); }
function sndMerge(lv){ blip(320 * Math.pow(1.1, lv), 0.22, "sine", 0.17);
                       setTimeout(() => blip(480 * Math.pow(1.1, lv), 0.16, "sine", 0.08), 45); }
function sndOver(){ [440, 330, 247, 165].forEach((f, i) => setTimeout(() => blip(f, 0.3, "triangle", 0.14), i * 130)); }

/* ============================================================
   물리 — 원만 다루는 순차 임펄스 솔버
   ============================================================ */
function addBody(level, x, y, vx, vy){
  const f = FRUITS[level];
  const m = f.r * f.r * 0.01;
  bodies.push({
    id: uid++, level, x, y, vx: vx || 0, vy: vy || 0,
    r: f.r, m, im: 1 / m,
    ii: 1 / (0.5 * m * f.r * f.r),
    ang: (Math.random() - 0.5) * 0.6, av: 0,
    age: 0, overTime: 0, scale: 1, dead: false
  });
  if (!unlocked[level]) { unlocked[level] = true; paintChain(level); }
  if (level > bestFruit) { bestFruit = level; store.set("suika.bestFruit", String(level));
                           bestFruitEl.textContent = FRUITS[level].name; }
  return bodies[bodies.length - 1];
}

function integrate(dt){
  for (const b of bodies){
    b.vy += GRAVITY * dt;
    b.vx *= 1 - 0.35 * dt;
    b.vy *= 1 - 0.12 * dt;
    b.av *= 1 - 1.6 * dt;
    const sp = Math.hypot(b.vx, b.vy);
    if (sp > MAX_SPEED){ const k = MAX_SPEED / sp; b.vx *= k; b.vy *= k; }
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.ang += b.av * dt;
    b.age += dt;
    if (b.scale < 1) b.scale = Math.min(1, b.scale + dt * 5.5);
  }
}

// 두 원 사이 충돌 해소 (위치 보정 + 법선/마찰 임펄스)
function resolvePair(a, b){
  let nx = b.x - a.x, ny = b.y - a.y;
  const rad = a.r + b.r;
  const d2 = nx * nx + ny * ny;
  if (d2 >= rad * rad) return;      // 제곱 비교로 대부분의 쌍을 sqrt 없이 거른다
  let d = Math.sqrt(d2);
  if (d < 1e-6){ nx = 0; ny = -1; d = 0.01; } else { nx /= d; ny /= d; }

  const pen = rad - d;
  const inv = a.im + b.im;
  if (pen > 0.01){
    const corr = (pen - 0.01) * 0.85 / inv;
    a.x -= nx * corr * a.im; a.y -= ny * corr * a.im;
    b.x += nx * corr * b.im; b.y += ny * corr * b.im;
  }

  // 접점에서의 상대 속도 (원이므로 접점 벡터는 법선과 평행)
  const rax = nx * a.r,  ray = ny * a.r;
  const rbx = -nx * b.r, rby = -ny * b.r;
  let rvx = (b.vx - b.av * rby) - (a.vx - a.av * ray);
  let rvy = (b.vy + b.av * rbx) - (a.vy + a.av * rax);

  const vn = rvx * nx + rvy * ny;
  if (vn > 0) return;
  const jn = -(1 + REST) * vn / inv;
  a.vx -= nx * jn * a.im; a.vy -= ny * jn * a.im;
  b.vx += nx * jn * b.im; b.vy += ny * jn * b.im;

  // 마찰 — 접선 성분이 회전을 만든다
  const tx = -ny, ty = nx;
  rvx = (b.vx - b.av * rby) - (a.vx - a.av * ray);
  rvy = (b.vy + b.av * rbx) - (a.vy + a.av * rax);
  const vt = rvx * tx + rvy * ty;
  const kt = inv + a.r * a.r * a.ii + b.r * b.r * b.ii;
  let jt = -vt / kt;
  const max = FRICTION * jn;
  jt = Math.max(-max, Math.min(max, jt));
  a.vx -= tx * jt * a.im; a.vy -= ty * jt * a.im;
  b.vx += tx * jt * b.im; b.vy += ty * jt * b.im;
  a.av -= (rax * (ty * jt) - ray * (tx * jt)) * a.ii;
  b.av += (rbx * (ty * jt) - rby * (tx * jt)) * b.ii;
}

function resolveWalls(b){
  // 좌우 벽 + 바닥 (위는 열려 있다)
  const hit = (nx, ny, pen) => {
    if (pen <= 0) return;
    b.x += nx * pen; b.y += ny * pen;
    const rx = -nx * b.r, ry = -ny * b.r;
    let rvx = b.vx - b.av * ry, rvy = b.vy + b.av * rx;
    const vn = rvx * nx + rvy * ny;
    if (vn < 0){
      const jn = -(1 + REST) * vn / b.im;
      b.vx += nx * jn * b.im; b.vy += ny * jn * b.im;
      const tx = -ny, ty = nx;
      rvx = b.vx - b.av * ry; rvy = b.vy + b.av * rx;
      const vt = rvx * tx + rvy * ty;
      let jt = -vt / (b.im + b.r * b.r * b.ii);
      const max = FRICTION * jn;
      jt = Math.max(-max, Math.min(max, jt));
      b.vx += tx * jt * b.im; b.vy += ty * jt * b.im;
      b.av += (rx * (ty * jt) - ry * (tx * jt)) * b.ii;
    }
  };
  hit(1, 0, b.r - b.x);
  hit(-1, 0, b.x - (W - b.r));
  hit(0, -1, b.y - (H - b.r));
}

function solve(){
  for (let it = 0; it < ITER; it++){
    for (let i = 0; i < bodies.length; i++){
      for (let j = i + 1; j < bodies.length; j++) resolvePair(bodies[i], bodies[j]);
    }
    for (const b of bodies) resolveWalls(b);
  }
}

/* ============================================================
   합치기
   ============================================================ */
function doMerges(){
  const gone = new Set();
  for (let i = 0; i < bodies.length; i++){
    const a = bodies[i];
    if (gone.has(a.id)) continue;
    for (let j = i + 1; j < bodies.length; j++){
      const b = bodies[j];
      if (gone.has(b.id) || b.level !== a.level) continue;
      const dx = b.x - a.x, dy = b.y - a.y, rad = a.r + b.r;
      if (dx * dx + dy * dy > rad * rad) continue;

      gone.add(a.id); gone.add(b.id);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const lv = a.level;
      addScore(MERGE_SCORE[lv], mx, my);

      if (lv === FRUITS.length - 1){
        burst(mx, my, FRUITS[lv].c2, 34, 3.2);
        burst(mx, my, "#FF5C74", 22, 2.4);
        shake = 13; sndMerge(lv + 2);
      } else {
        const nb = addBody(lv + 1, mx, my,
                           (a.vx + b.vx) / 2, (a.vy + b.vy) / 2);
        nb.scale = 0.5;
        nb.av = (a.av + b.av) / 2;
        burst(mx, my, FRUITS[lv].c2, 12 + lv, 1.6 + lv * 0.12);
        shake = Math.min(9, 2 + lv * 0.8);
        sndMerge(lv);
      }
      break;
    }
  }
  if (gone.size) bodies = bodies.filter(b => !gone.has(b.id));
}

function addScore(n, x, y){
  score += n;
  scoreEl.textContent = scoreMEl.textContent = score;
  scoreEl.classList.add("bump"); scoreMEl.classList.add("bump");
  setTimeout(() => { scoreEl.classList.remove("bump"); scoreMEl.classList.remove("bump"); }, 130);
  pops.push({ x, y, n, life: 0.9 });
  if (score > best){ best = score; bestEl.textContent = best; store.set("suika.best", String(best)); }
}

/* ============================================================
   이펙트
   ============================================================ */
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
function burst(x, y, color, n, spd){
  if (reduced) return;
  for (let i = 0; i < n; i++){
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
    const s = (60 + Math.random() * 110) * spd;
    particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 40,
                     r: 1.6 + Math.random() * 2.8, life: 0.45 + Math.random() * 0.4, t: 0, color });
  }
}
function stepFx(dt){
  for (const p of particles){
    p.t += dt; p.vy += 900 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.96;
  }
  particles = particles.filter(p => p.t < p.life);
  for (const p of pops){ p.life -= dt; p.y -= 34 * dt; }
  pops = pops.filter(p => p.life > 0);
}

/* ============================================================
   과일 그리기
   ============================================================ */
function sphere(g, r, f){
  const grd = g.createRadialGradient(-r * 0.34, -r * 0.38, r * 0.06, 0, 0, r * 1.05);
  grd.addColorStop(0, f.c1); grd.addColorStop(0.52, f.c2); grd.addColorStop(1, f.c3);
  g.fillStyle = grd;
  g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
}
function gloss(g, r){
  g.save();
  g.globalAlpha = 0.3;
  g.fillStyle = "#fff";
  g.beginPath();
  g.ellipse(-r * 0.36, -r * 0.42, r * 0.26, r * 0.16, -0.7, 0, Math.PI * 2);
  g.fill();
  g.restore();
}
function face(g, r, f){
  const ey = r * 0.1, ex = r * 0.3, s = Math.max(1.1, r * 0.082);
  g.fillStyle = "rgba(24,14,10,.82)";
  g.beginPath(); g.arc(-ex, ey, s, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc( ex, ey, s, 0, Math.PI * 2); g.fill();
  g.fillStyle = "rgba(255,255,255,.75)";
  g.beginPath(); g.arc(-ex - s * 0.3, ey - s * 0.35, s * 0.34, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc( ex - s * 0.3, ey - s * 0.35, s * 0.34, 0, Math.PI * 2); g.fill();
  if (r >= 24){
    g.strokeStyle = "rgba(24,14,10,.6)";
    g.lineWidth = Math.max(1, r * 0.045);
    g.lineCap = "round";
    g.beginPath(); g.arc(0, r * 0.2, r * 0.17, 0.25 * Math.PI, 0.75 * Math.PI); g.stroke();
  }
  // 발그레
  g.save(); g.globalAlpha = 0.22; g.fillStyle = "#FF5C72";
  g.beginPath(); g.ellipse(-ex * 1.55, ey + r * 0.2, r * 0.13, r * 0.08, 0, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.ellipse( ex * 1.55, ey + r * 0.2, r * 0.13, r * 0.08, 0, 0, Math.PI * 2); g.fill();
  g.restore();
}
function leaf(g, r, x, y, rot, size, col){
  g.save(); g.translate(x, y); g.rotate(rot);
  g.fillStyle = col || "#3F8B3B";
  g.beginPath();
  g.moveTo(0, 0);
  g.quadraticCurveTo(size * 0.55, -size * 0.5, size * 1.25, 0);
  g.quadraticCurveTo(size * 0.55, size * 0.5, 0, 0);
  g.fill();
  g.restore();
}
function stem(g, r, h, w, col){
  g.strokeStyle = col || "#6B4A22";
  g.lineWidth = w; g.lineCap = "round";
  g.beginPath(); g.moveTo(0, -r * 0.88);
  g.quadraticCurveTo(r * 0.12, -r - h * 0.6, r * 0.3, -r - h); g.stroke();
}

function drawFruit(g, level, x, y, r, ang, alpha){
  const f = FRUITS[level];
  g.save();
  g.translate(x, y); g.rotate(ang);
  if (alpha !== undefined) g.globalAlpha = alpha;

  // 접지 그림자
  g.save(); g.rotate(-ang); g.globalAlpha = (alpha === undefined ? 1 : alpha) * 0.3;
  g.fillStyle = "#000";
  g.beginPath(); g.ellipse(0, r * 0.82, r * 0.78, r * 0.2, 0, 0, Math.PI * 2); g.fill();
  g.restore();

  if (f.d === "cherry"){ stem(g, r, r * 0.95, Math.max(1.3, r * 0.14), "#7A9A3A");
                         leaf(g, r, r * 0.26, -r * 1.7, -0.5, r * 0.5); }
  if (f.d === "apple")  { stem(g, r, r * 0.34, Math.max(1.6, r * 0.09));
                          leaf(g, r, r * 0.22, -r * 1.12, -0.42, r * 0.42); }
  if (f.d === "peach")  { leaf(g, r, r * 0.1, -r * 0.98, -0.75, r * 0.4); }
  if (f.d === "pear")   { stem(g, r, r * 0.3, Math.max(1.5, r * 0.08)); }
  if (f.d === "pineapple"){
    g.fillStyle = "#4E9247";
    for (let i = -2; i <= 2; i++){
      g.save(); g.translate(0, -r * 0.9); g.rotate(i * 0.34);
      g.beginPath(); g.moveTo(-r * 0.09, 0);
      g.quadraticCurveTo(0, -r * 0.5, r * 0.09, 0); g.fill();
      g.restore();
    }
  }
  if (f.d === "watermelon"){ stem(g, r, r * 0.22, Math.max(2, r * 0.07), "#5C7A34"); }

  sphere(g, r, f);

  // 껍질 무늬 — 원 안쪽으로만
  g.save();
  g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.clip();
  switch (f.d){
    case "strawberry": {
      g.fillStyle = "rgba(255,238,170,.85)";
      for (let ring = 0; ring < 3; ring++){
        const rr = r * (0.3 + ring * 0.27), n = 5 + ring * 3;
        for (let i = 0; i < n; i++){
          const a = (i / n) * Math.PI * 2 + ring * 0.5;
          g.save(); g.translate(Math.cos(a) * rr, Math.sin(a) * rr); g.rotate(a);
          g.beginPath(); g.ellipse(0, 0, r * 0.055, r * 0.032, 0, 0, Math.PI * 2); g.fill();
          g.restore();
        }
      }
      break;
    }
    case "grape": {
      g.globalAlpha = 0.5;
      const pts = [[0,-0.45],[-0.42,-0.16],[0.42,-0.16],[-0.24,0.3],[0.24,0.3],[0,0.62]];
      for (const [px, py] of pts){
        const gr = g.createRadialGradient(px * r - r * 0.1, py * r - r * 0.12, r * 0.02,
                                          px * r, py * r, r * 0.34);
        gr.addColorStop(0, "rgba(220,205,255,.9)"); gr.addColorStop(1, "rgba(50,26,92,.25)");
        g.fillStyle = gr;
        g.beginPath(); g.arc(px * r, py * r, r * 0.3, 0, Math.PI * 2); g.fill();
      }
      break;
    }
    case "citrus": {
      g.strokeStyle = "rgba(255,255,255,.14)"; g.lineWidth = r * 0.05;
      for (let i = 0; i < 8; i++){
        const a = (i / 8) * Math.PI * 2;
        g.beginPath(); g.moveTo(0, 0);
        g.lineTo(Math.cos(a) * r, Math.sin(a) * r); g.stroke();
      }
      g.fillStyle = "rgba(140,64,6,.16)";
      for (let i = 0; i < 26; i++){
        const a = i * 2.399, rr = r * Math.sqrt(i / 26) * 0.92;
        g.beginPath(); g.arc(Math.cos(a) * rr, Math.sin(a) * rr, r * 0.035, 0, Math.PI * 2); g.fill();
      }
      break;
    }
    case "persimmon": {
      g.fillStyle = "#4C7A2E";
      for (let i = 0; i < 5; i++){
        const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
        g.save(); g.translate(0, -r * 0.62); g.rotate(a);
        g.beginPath(); g.moveTo(0, 0);
        g.quadraticCurveTo(r * 0.2, -r * 0.1, r * 0.46, 0);
        g.quadraticCurveTo(r * 0.2, r * 0.13, 0, 0); g.fill();
        g.restore();
      }
      g.fillStyle = "#6D4318";
      g.beginPath(); g.arc(0, -r * 0.62, r * 0.09, 0, Math.PI * 2); g.fill();
      break;
    }
    case "pear": {
      g.fillStyle = "rgba(130,105,30,.3)";
      for (let i = 0; i < 30; i++){
        const a = i * 2.399, rr = r * Math.sqrt(i / 30) * 0.95;
        g.beginPath(); g.arc(Math.cos(a) * rr, Math.sin(a) * rr, r * 0.026, 0, Math.PI * 2); g.fill();
      }
      break;
    }
    case "peach": {
      g.strokeStyle = "rgba(170,50,80,.28)"; g.lineWidth = r * 0.06; g.lineCap = "round";
      g.beginPath(); g.moveTo(0, -r * 0.95);
      g.quadraticCurveTo(r * 0.22, 0, 0, r * 0.95); g.stroke();
      g.globalAlpha = 0.35;
      const gr = g.createRadialGradient(r * 0.3, -r * 0.3, r * 0.05, r * 0.3, -r * 0.3, r * 0.9);
      gr.addColorStop(0, "#FF5E85"); gr.addColorStop(1, "rgba(255,94,133,0)");
      g.fillStyle = gr; g.fillRect(-r, -r, r * 2, r * 2);
      break;
    }
    case "pineapple": {
      g.strokeStyle = "rgba(120,80,8,.34)"; g.lineWidth = r * 0.045;
      for (let i = -6; i <= 6; i++){
        g.beginPath(); g.moveTo(-r, i * r * 0.26 - r); g.lineTo(r, i * r * 0.26 + r); g.stroke();
        g.beginPath(); g.moveTo(-r, -i * r * 0.26 + r); g.lineTo(r, -i * r * 0.26 - r); g.stroke();
      }
      break;
    }
    case "melon": {
      g.strokeStyle = "rgba(255,255,255,.4)"; g.lineWidth = r * 0.035; g.lineCap = "round";
      for (let i = 0; i < 9; i++){
        const a = (i / 9) * Math.PI * 2;
        g.beginPath();
        g.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        g.quadraticCurveTo(Math.cos(a + 1.1) * r * 0.25, Math.sin(a + 1.1) * r * 0.25,
                           Math.cos(a + 2.3) * r, Math.sin(a + 2.3) * r);
        g.stroke();
      }
      break;
    }
    case "watermelon": {
      g.fillStyle = "rgba(9,38,18,.75)";
      for (let i = -3; i <= 3; i++){
        const cx = i * r * 0.33;
        g.beginPath();
        g.moveTo(cx - r * 0.07, -r * 1.05);
        g.quadraticCurveTo(cx + r * 0.16, 0, cx - r * 0.07, r * 1.05);
        g.quadraticCurveTo(cx + r * 0.02, 0, cx + r * 0.1, -r * 1.05);
        g.fill();
      }
      break;
    }
  }
  // 안쪽 그림자로 입체감 마무리
  const rim = g.createRadialGradient(0, 0, r * 0.62, 0, 0, r);
  rim.addColorStop(0, "rgba(0,0,0,0)"); rim.addColorStop(1, "rgba(0,0,0,.28)");
  g.fillStyle = rim; g.fillRect(-r, -r, r * 2, r * 2);
  g.restore();

  gloss(g, r);
  face(g, r, f);
  g.restore();
}

/* ============================================================
   화면 맞추기 (논리 420x620 → 실제 픽셀)
   ============================================================ */
let sx = 1, sy = 1;
function fitCanvas(){
  const rect = boardEl.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  cv.width  = Math.round(rect.width  * dpr);
  cv.height = Math.round(rect.height * dpr);
  sx = cv.width / W; sy = cv.height / H;
}
new ResizeObserver(fitCanvas).observe(boardEl);
fitCanvas();

/* ============================================================
   렌더
   ============================================================ */
function render(){
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cv.width, cv.height);
  const ox = shake ? (Math.random() - 0.5) * shake : 0;
  const oy = shake ? (Math.random() - 0.5) * shake : 0;
  ctx.setTransform(sx, 0, 0, sy, ox * sx, oy * sy);

  // 위험선
  const warn = dangerPulse > 0;
  ctx.save();
  ctx.setLineDash([7, 9]);
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = warn
    ? "rgba(240,67,94," + (0.45 + 0.45 * Math.sin(performance.now() / 110)) + ")"
    : "rgba(140,166,131,.3)";
  ctx.beginPath(); ctx.moveTo(0, DANGER_Y); ctx.lineTo(W, DANGER_Y); ctx.stroke();
  ctx.restore();

  // 낙하 가이드
  if (running && cooldown <= 0){
    const f = FRUITS[queue[0]];
    ctx.save();
    ctx.setLineDash([3, 8]);
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = "rgba(220,235,204,.22)";
    ctx.beginPath(); ctx.moveTo(heldX, HOLD_Y + f.r); ctx.lineTo(heldX, H); ctx.stroke();
    ctx.restore();
  }

  for (const b of bodies) drawFruit(ctx, b.level, b.x, b.y, b.r * b.scale, b.ang);

  for (const p of particles){
    ctx.globalAlpha = Math.max(0, 1 - p.t / p.life);
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;

  for (const p of pops){
    ctx.globalAlpha = Math.min(1, p.life * 1.8);
    ctx.fillStyle = "#DCEBCC";
    ctx.font = "800 20px Futura, 'Avenir Next', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("+" + p.n, p.x, p.y);
  }
  ctx.globalAlpha = 1;

  // 손에 든 과일 — 쿨다운 끝자락에 톡 나타난다
  if (running){
    const t = cooldown <= 0 ? 1 : 1 - cooldown / (DROP_CD * 0.55);
    if (t > 0){
      const e = t * t * (3 - 2 * t);
      drawFruit(ctx, queue[0], heldX, HOLD_Y, FRUITS[queue[0]].r * e, 0, e);
    }
  }
}

/* ============================================================
   루프
   ============================================================ */
let last = performance.now(), acc = 0;
function frame(now){
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000; last = now;
  if (dt > 0.25) dt = 0.25;
  acc += dt;
  const FIXED = 1 / 60;
  let steps = 0;
  while (acc >= FIXED && steps < 5){
    acc -= FIXED; steps++;
    if (running){
      const sub = FIXED / SUBSTEPS;
      for (let s = 0; s < SUBSTEPS; s++){ integrate(sub); solve(); }
      doMerges();
      checkOver(FIXED);
      if (cooldown > 0) cooldown -= FIXED;
    }
    stepFx(FIXED);
    if (shake > 0) shake = Math.max(0, shake - FIXED * 34);
  }
  render();
}

function checkOver(dt){
  let warn = false, lose = false;
  for (const b of bodies){
    if (b.age < GRACE) { b.overTime = 0; continue; }
    if (b.y - b.r < DANGER_Y){
      b.overTime += dt;
      warn = true;
      if (b.overTime > OVER_TIME) lose = true;
    } else if (b.y - b.r < DANGER_Y + 34){
      warn = true;
      b.overTime = 0;
    } else b.overTime = 0;
  }
  dangerPulse = warn ? 1 : 0;
  if (lose) gameOver();
}

function gameOver(){
  running = false;
  sndOver();
  finalEl.textContent = score;
  const newBest = score >= best && score > 0;
  overTitle.textContent = newBest ? "최고 기록 경신" : "상자가 넘쳤어요";
  overSub.textContent = newBest
    ? "지금까지 중 제일 잘했어요"
    : "최고 " + best + "점까지 " + Math.max(0, best - score) + "점 남았어요";
  overEl.classList.add("show");
}

/* ============================================================
   입력
   ============================================================ */
function clampX(x, level){
  const r = FRUITS[level].r;
  return Math.max(r + 1, Math.min(W - r - 1, x));
}
function toLogicalX(clientX){
  const rect = boardEl.getBoundingClientRect();
  return (clientX - rect.left) / rect.width * W;
}
function aim(clientX){
  if (!running) return;
  heldX = clampX(toLogicalX(clientX), queue[0]);
}
function drop(){
  if (!running || cooldown > 0) return;
  const lv = queue.shift();
  queue.push(rndLevel());
  addBody(lv, clampX(heldX, lv), HOLD_Y, 0, 60);
  cooldown = DROP_CD;
  sndDrop();
  paintNext();
  heldX = clampX(heldX, queue[0]);
}

boardEl.addEventListener("pointermove", e => aim(e.clientX));
boardEl.addEventListener("pointerdown", e => { boardEl.focus(); aim(e.clientX); audio(); });
boardEl.addEventListener("pointerup", e => { aim(e.clientX); drop(); });
boardEl.addEventListener("pointercancel", () => {});
boardEl.addEventListener("keydown", e => {
  const step = e.shiftKey ? 4 : 18;
  if (e.key === "ArrowLeft"){ heldX = clampX(heldX - step, queue[0]); e.preventDefault(); }
  else if (e.key === "ArrowRight"){ heldX = clampX(heldX + step, queue[0]); e.preventDefault(); }
  else if (e.key === " " || e.key === "Enter" || e.key === "ArrowDown"){ drop(); e.preventDefault(); }
});

/* ============================================================
   HUD
   ============================================================ */
function buildChain(el, small){
  el.innerHTML = "";
  FRUITS.forEach((f, i) => {
    const d = document.createElement("i");
    const s = (small ? 7 : 9) + i * (small ? 1.1 : 1.35);
    d.style.width = d.style.height = s.toFixed(1) + "px";
    d.title = f.name;
    el.appendChild(d);
  });
}
function paintChain(level){
  [chainEl, chainMEl].forEach(el => {
    const d = el.children[level];
    if (!d) return;
    d.style.background = FRUITS[level].c2;
    d.classList.add("on", "pop");
    setTimeout(() => d.classList.remove("pop"), 300);
  });
}
function resetChain(){
  [chainEl, chainMEl].forEach(el => {
    for (const d of el.children){ d.classList.remove("on", "pop"); d.style.background = ""; }
  });
}
function drawPreview(canvas, level, pad){
  const g = canvas.getContext("2d");
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, canvas.width, canvas.height);
  const half = canvas.width / 2;
  const r = (half - pad) * (0.56 + level * 0.09);
  drawFruit(g, level, half, half + r * 0.06, r, 0);
}
function paintNext(){
  const lv = queue[0];
  nextName.textContent = FRUITS[lv].name;
  drawPreview(nextCv, lv, 26);
  drawPreview(nextCvM, lv, 14);
}

/* ============================================================
   초기화 / 다시 시작
   ============================================================ */
function reset(){
  bodies = []; particles = []; pops = [];
  score = 0; cooldown = 0; running = true; shake = 0; dangerPulse = 0;
  unlocked.fill(false);
  queue = [rndLevel(), rndLevel()];
  heldX = W / 2;
  scoreEl.textContent = scoreMEl.textContent = "0";
  overEl.classList.remove("show");
  resetChain();
  paintNext();
  boardEl.focus();
}

document.getElementById("restartBtn").addEventListener("click", reset);
document.getElementById("againBtn").addEventListener("click", reset);

const soundBtn = document.getElementById("soundBtn");
function paintSound(){
  soundBtn.textContent = soundOn ? "소리 켜짐" : "소리 꺼짐";
  soundBtn.setAttribute("aria-pressed", String(soundOn));
}
soundBtn.addEventListener("click", () => {
  soundOn = !soundOn;
  store.set("suika.sound", soundOn ? "1" : "0");
  paintSound();
  if (soundOn) blip(520, 0.12, "sine", 0.12);
});

buildChain(chainEl, false);
buildChain(chainMEl, true);
bestEl.textContent = best;
bestFruitEl.textContent = FRUITS[bestFruit].name;
paintSound();
paintNext();
requestAnimationFrame(frame);

})();
