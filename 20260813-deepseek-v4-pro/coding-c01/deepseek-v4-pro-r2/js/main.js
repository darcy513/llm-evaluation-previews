import * as THREE from 'three';
import { OrbitControls } from '../vendor/OrbitControls.js';

/* ============================================================
   《极光》AURORA — 世代星舰三维模型
   依据小说原文数据：
   脊柱 10 km；两环（Ring A 旧世界 / Ring B 新世界）；
   每环 12 个生态舱，舱体 4 km × 1 km；六根辐条 + 六边形内环；
   艏部惯性约束聚变引擎（D/He3，每秒 2 次微爆，0.005 g 减速）；
   0.83 g 离心重力；巡航 0.1 c，目标天仓五（11.9 光年）。
   ============================================================ */

/* ---------- 常量（单位：米） ---------- */
const SPINE_RADIUS = 220;
const SPINE_LENGTH = 10000;
const BIOME_RADIUS = 500;
const BIOME_LENGTH = 4000;
const RING_RADIUS = 8400;          // 每环 54 km 周长对应的中心半径
const RING_A_Z = -2000;
const RING_B_Z = 2000;
const RING_A_STEP = 0;             // 初始相位
const RING_B_STEP = Math.PI / 12;  // 双环错开半个舱位
const SPOKE_COUNT = 6;
const INNER_RING_RADIUS = 860;

/* ---------- 12 个气候带与两侧生物圈命名 ---------- */
const ZONES = {
  permafrost:      { key:'permafrost',      zh:'极地冰川', hull:'#8fa6b8', accent:'#dfeefb', ground:'#e9f2f7' },
  taiga:           { key:'taiga',           zh:'泰加林',   hull:'#35544a', accent:'#9fc5b0', ground:'#2c473b' },
  rangeland:       { key:'rangeland',       zh:'草原',     hull:'#6f7048', accent:'#cfd58a', ground:'#9a9c62' },
  steppes:         { key:'steppes',         zh:'干草原',   hull:'#8a7848', accent:'#e6d29a', ground:'#c6ac72' },
  chaparral:       { key:'chaparral',       zh:'灌木林',   hull:'#85674a', accent:'#e2b184', ground:'#a67b52' },
  savannah:        { key:'savannah',        zh:'稀树草原', hull:'#8b8140', accent:'#ead98f', ground:'#b8a954' },
  tropicalSeasonal:{ key:'tropicalSeasonal',zh:'热带季雨林',hull:'#3c6b4a', accent:'#9bd39a', ground:'#3f7a4c' },
  tropicalRain:    { key:'tropicalRain',    zh:'热带雨林', hull:'#1f5c46', accent:'#5fd08e', ground:'#18523d' },
  temperateRain:   { key:'temperateRain',   zh:'温带雨林', hull:'#2f5f5c', accent:'#85c9bd', ground:'#2b514c' },
  temperateDeciduous:{key:'temperateDeciduous',zh:'温带落叶林',hull:'#5f6a42', accent:'#e0a15e', ground:'#6d784a' },
  alpine:          { key:'alpine',          zh:'高山',     hull:'#6b7078', accent:'#c9d2da', ground:'#7d7f76' },
  farmland:        { key:'farmland',        zh:'温带农田', hull:'#87743e', accent:'#f0d68a', ground:'#b39a55' },
};

const RING_ORDER_A = [
  { zone:'temperateRain',    name:'塔斯马尼亚' },
  { zone:'alpine',           name:'喜马拉雅' },
  { zone:'farmland',         name:'扬子' },
  { zone:'taiga',            name:'西伯利亚' },
  { zone:'chaparral',        name:'伊朗' },
  { zone:'steppes',          name:'蒙古' },
  { zone:'rangeland',        name:'大草原' },
  { zone:'temperateDeciduous',name:'巴尔干' },
  { zone:'savannah',         name:'肯尼亚' },
  { zone:'tropicalSeasonal', name:'孟加拉' },
  { zone:'tropicalRain',     name:'印度尼西亚' },
  { zone:'permafrost',       name:'旧世界·极地冰川' },
];
const RING_ORDER_B = [
  { zone:'temperateDeciduous',name:'新斯科舍' },
  { zone:'alpine',           name:'谢拉' },
  { zone:'farmland',         name:'北美草原' },
  { zone:'taiga',            name:'拉布拉多' },
  { zone:'rangeland',        name:'潘帕斯' },
  { zone:'chaparral',        name:'索诺拉' },
  { zone:'savannah',         name:'皮埃蒙特' },
  { zone:'tropicalSeasonal', name:'哥斯达黎加' },
  { zone:'tropicalRain',     name:'亚马逊' },
  { zone:'temperateRain',    name:'奥林匹亚' },
  { zone:'steppes',          name:'巴塔哥尼亚' },
  { zone:'permafrost',       name:'新世界·极地冰川' },
];

/* ---------- 工具 ---------- */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function rr(rng, a, b) { return a + (b - a) * rng(); }
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) + amt, g = ((n >> 8) & 255) + amt, b = (n & 255) + amt;
  r = Math.max(0, Math.min(255, r)); g = Math.max(0, Math.min(255, g)); b = Math.max(0, Math.min(255, b));
  return `rgb(${r},${g},${b})`;
}
function canvasTexture(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/* 径向光晕贴图（引擎、恒星、指示灯共用） */
function glowTexture(inner, outer) {
  return canvasTexture(256, 256, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w/2, h/2, 2, w/2, h/2, w/2);
    g.addColorStop(0, inner); g.addColorStop(0.25, inner);
    g.addColorStop(1, outer);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  });
}
const GLOW_WARM = glowTexture('rgba(255,246,214,1)', 'rgba(255,150,40,0)');
const GLOW_CYAN = glowTexture('rgba(190,245,255,1)', 'rgba(40,150,220,0)');
const GLOW_BLUE = glowTexture('rgba(170,210,255,1)', 'rgba(50,90,200,0)');
const GLOW_RED  = glowTexture('rgba(255,150,130,1)', 'rgba(200,30,20,0)');

function makeSprite(map, color, scale, opacity = 1) {
  const m = new THREE.SpriteMaterial({ map, color, transparent:true, opacity, blending:THREE.AdditiveBlending, depthWrite:false });
  const s = new THREE.Sprite(m); s.scale.setScalar(scale); return s;
}

/* 舱体金属蒙皮 + 舷窗贴图 */
function hullTextures(zone, seed) {
  const base = zone.hull;
  // 先固定舷窗掩码，保证 map 与 emissiveMap 完全对齐
  const winRng = mulberry32(seed + 999);
  const wins = [];
  for (let col = 0; col < 48; col++) {
    for (let row = 0; row < 10; row++) {
      if (winRng() < 0.22) continue;
      const x = 18 + col * 21, y = 26 + row * 46;
      const blue = winRng() < 0.12;
      wins.push({ x, y, blue });
    }
  }
  const map = canvasTexture(1024, 512, (ctx, w, h) => {
    ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
    // 面板与焊缝
    ctx.strokeStyle = 'rgba(0,0,0,0.38)'; ctx.lineWidth = 3;
    for (let i = 0; i <= 16; i++) { const x = i * w / 16; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let j = 0; j <= 8; j++) { const y = j * h / 8; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1;
    for (let i = 0; i <= 16; i++) { const x = i * w / 16 + 1; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    // 旧化与色带
    const rng = mulberry32(seed);
    for (let i = 0; i < 70; i++) {
      ctx.fillStyle = `rgba(${rng()<0.5?'255,255,255':'0,0,0'},${(rng()*0.05+0.015).toFixed(3)})`;
      ctx.fillRect(rr(rng,0,w), rr(rng,0,h), rr(rng,20,140), rr(rng,4,26));
    }
    // 舷窗（暖黄，少量蓝）
    for (const wd of wins) {
      ctx.fillStyle = wd.blue ? 'rgba(140,210,255,0.9)' : 'rgba(255,214,150,0.92)';
      ctx.fillRect(wd.x, wd.y, 7, 12);
      ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(wd.x, wd.y, 7, 3);
    }
    // 舱段标号
    ctx.fillStyle = 'rgba(230,240,255,0.42)'; ctx.font = 'bold 42px monospace';
    ctx.fillText(String(seed % 24).padStart(2, '0'), 40, 72);
  });
  const glow = canvasTexture(1024, 512, (ctx, w, h) => {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
    for (const wd of wins) {
      ctx.fillStyle = wd.blue ? '#b8e6ff' : '#ffe0a6';
      ctx.fillRect(wd.x, wd.y, 7, 12);
    }
  });
  return { map, glow };
}

/* 文字标签 */
function textSprite(main, sub, color = '#ffffff', width = 640) {
  const h = 180;
  const tex = canvasTexture(width, h, (ctx) => {
    ctx.clearRect(0, 0, width, h);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 10;
    ctx.fillStyle = color; ctx.font = 'bold 58px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(main, width/2, 58);
    if (sub) { ctx.fillStyle = 'rgba(220,235,255,0.75)'; ctx.font = '34px "PingFang SC","Microsoft YaHei",sans-serif'; ctx.fillText(sub, width/2, 126); }
  }, true);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: true }));
  sp.scale.set(width / 4, h / 4, 1);
  return sp;
}

/* 恒星点贴图 */
function starPointTexture() {
  return canvasTexture(64, 64, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w/2, h/2, 0, w/2, h/2, w/2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.6, 'rgba(180,210,255,0.25)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  });
}

/* 脊柱蒙皮贴图 */
function spineTextures() {
  const winRng = mulberry32(777);
  const wins = [];
  for (let col = 0; col < 12; col++) {
    for (let row = 0; row < 96; row++) {
      if (winRng() < 0.3) continue;
      const x = 30 + col * 82, y = 24 + row * 21;
      wins.push({ x, y, blue: winRng() < 0.15 });
    }
  }
  const map = canvasTexture(1024, 2048, (ctx, w, h) => {
    ctx.fillStyle = '#3a4350'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 5;
    for (let i = 0; i <= 8; i++) { const x = i * w / 8; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let j = 0; j <= 24; j++) { const y = j * h / 24; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    for (const wd of wins) {
      ctx.fillStyle = wd.blue ? 'rgba(150,220,255,0.85)' : 'rgba(255,210,140,0.9)';
      ctx.fillRect(wd.x, wd.y, 9, 11);
    }
    ctx.fillStyle = 'rgba(210,225,255,0.35)'; ctx.font = 'bold 60px monospace';
    for (let j = 0; j < 5; j++) ctx.fillText('AURORA · SPINE ' + (j+1), 120, 340 + j * 430);
  });
  const glow = canvasTexture(1024, 2048, (ctx, w, h) => {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
    for (const wd of wins) {
      ctx.fillStyle = wd.blue ? '#9bd8ff' : '#ffdca0';
      ctx.fillRect(wd.x, wd.y, 9, 11);
    }
  });
  return { map, glow };
}

/* 弧形舱内表面：轴沿 X，φ 为绕 X 轴角度，φ=π 为底部 */
function curvedPatchGeometry(R, L, phi0, phi1, segL, segP, uRepeat = 1) {
  const pos = [], nrm = [], uv = [], idx = [];
  for (let j = 0; j <= segP; j++) {
    const phi = phi0 + (phi1 - phi0) * j / segP;
    const cy = Math.cos(phi), sy = Math.sin(phi);
    for (let i = 0; i <= segL; i++) {
      const x = -L/2 + L * i / segL;
      pos.push(x, R * cy, R * sy);
      nrm.push(0, cy, sy);           // 外法线
      uv.push((i / segL) * uRepeat, j / segP);
    }
  }
  for (let j = 0; j < segP; j++) {
    for (let i = 0; i < segL; i++) {
      const a = j * (segL + 1) + i, b = a + segL + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/* 地面上某点与朝向（内法线 = 上） */
function surfacePoint(x, phi, R) { return new THREE.Vector3(x, R * Math.cos(phi), R * Math.sin(phi)); }
function surfaceUp(phi) { return new THREE.Vector3(0, -Math.cos(phi), -Math.sin(phi)); }

/* 深空背景 */
function buildStarfield() {
  const group = new THREE.Group();
  const starTex = starPointTexture();
  const layers = [
    { count: 2600, rMin: 16000, rMax: 48000, size: 520, speed: 6,  colorA: 0xffffff, colorB: 0x9fc4ff, opacity: 0.95 },
    { count: 3400, rMin: 48000, rMax: 90000, size: 760, speed: 14, colorA: 0xffffff, colorB: 0xffe3b0, opacity: 0.85 },
    { count: 2200, rMin: 90000, rMax: 140000,size: 900, speed: 22, colorA: 0xffffff, colorB: 0xb9d9ff, opacity: 0.7 },
  ];
  for (const L of layers) {
    const positions = new Float32Array(L.count * 3);
    const colors = new Float32Array(L.count * 3);
    const rng = mulberry32(L.count * 17 + 1);
    for (let i = 0; i < L.count; i++) {
      // 球壳随机点
      const u = rng() * 2 - 1, th = rng() * Math.PI * 2;
      const r = rr(rng, L.rMin, L.rMax);
      const s = Math.sqrt(1 - u * u);
      positions[i*3] = r * s * Math.cos(th);
      positions[i*3+1] = r * s * Math.sin(th);
      positions[i*3+2] = r * u;
      const c = new THREE.Color().lerpColors(new THREE.Color(L.colorA), new THREE.Color(L.colorB), rng());
      colors[i*3] = c.r; colors[i*3+1] = c.g; colors[i*3+2] = c.b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({ size: L.size, map: starTex, vertexColors: true, transparent: true, opacity: L.opacity, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true });
    const pts = new THREE.Points(geo, mat);
    pts.userData = { rMin: L.rMin, rMax: L.rMax, speed: L.speed, wrap: L.rMax };
    group.add(pts);
  }
  // 天仓五：正前方明亮目标星
  const tauCeti = makeSprite(GLOW_WARM, 0xfff2cc, 5200, 0.95);
  tauCeti.position.set(0, 0, -100000);
  group.add(tauCeti);
  const tauCore = makeSprite(GLOW_WARM, 0xffffff, 900, 1);
  tauCore.position.copy(tauCeti.position);
  group.add(tauCore);
  // 星云薄纱
  const nebColors = [0x16325e, 0x2a1d55, 0x0d3a4a, 0x3a1f45, 0x143a2e];
  const rng = mulberry32(4321);
  for (let i = 0; i < 9; i++) {
    const s = makeSprite(GLOW_BLUE, nebColors[i % nebColors.length], rr(rng, 22000, 52000), rr(rng, 0.05, 0.12));
    const a = rr(rng, 0, Math.PI * 2), el = rr(rng, -0.5, 0.5), r = rr(rng, 52000, 110000);
    s.position.set(r * Math.cos(a) * Math.cos(el), r * Math.sin(el), r * Math.sin(a) * Math.cos(el) - 20000);
    s.userData = { spin: rr(rng, -0.004, 0.004) };
    group.add(s);
  }
  return group;
}

/* ============================================================
   外景飞船
   ============================================================ */
function buildBiomeCylinder(zoneInfo, seed, index) {
  const group = new THREE.Group();
  const zone = ZONES[zoneInfo.zone];
  const { map, glow } = hullTextures(zone, seed);

  const sideMat = new THREE.MeshStandardMaterial({
    map, color: 0xffffff, emissive: 0xffffff, emissiveMap: glow, emissiveIntensity: 0.85,
    roughness: 0.55, metalness: 0.45,
  });
  const capMat = new THREE.MeshStandardMaterial({ color: shade(zone.hull, -36), roughness: 0.7, metalness: 0.5 });
  const hullGeo = new THREE.CylinderGeometry(BIOME_RADIUS, BIOME_RADIUS, BIOME_LENGTH, 56, 6);
  const hull = new THREE.Mesh(hullGeo, [sideMat, capMat, capMat]);
  group.add(hull);

  // 穹顶太阳线（内侧面，朝向脊柱）——外表面以发光带呈现
  const sunGeo = new THREE.CylinderGeometry(BIOME_RADIUS + 4, BIOME_RADIUS + 4, BIOME_LENGTH - 60, 48, 1, true,
    -Math.PI/2 - 0.17, 0.34);
  const sunMat = new THREE.MeshBasicMaterial({ color: 0xffe6ae, transparent: true, opacity: 0.82, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false });
  const sun = new THREE.Mesh(sunGeo, sunMat);
  group.add(sun);
  group.userData.sunline = sun;

  // 地板下方储藏的燃料/水屏蔽层（外侧面）
  const floorGeo = new THREE.CylinderGeometry(BIOME_RADIUS + 8, BIOME_RADIUS + 8, BIOME_LENGTH - 80, 40, 1, true,
    Math.PI/2 - 0.42, 0.84);
  const floorMat = new THREE.MeshStandardMaterial({ color: shade(zone.hull, -54), roughness: 0.85, metalness: 0.3, transparent: true, opacity: 0.9 });
  group.add(new THREE.Mesh(floorGeo, floorMat));

  // 舱段端环与联锁门
  const ringGeo = new THREE.TorusGeometry(BIOME_RADIUS + 2, 10, 10, 48);
  const ringMat = new THREE.MeshStandardMaterial({ color: 0x141b24, roughness: 0.6, metalness: 0.7 });
  for (const y of [-BIOME_LENGTH/2 + 8, BIOME_LENGTH/2 - 8]) {
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.y = y; ring.rotation.x = Math.PI/2;
    group.add(ring);
  }
  const portalMat = new THREE.MeshBasicMaterial({ color: 0x77d8ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
  for (const y of [-BIOME_LENGTH/2 + 26, BIOME_LENGTH/2 - 26]) {
    const p = new THREE.Mesh(new THREE.TorusGeometry(88, 12, 10, 32), portalMat);
    p.position.y = y; p.position.x = BIOME_RADIUS - 20; p.rotation.y = Math.PI/2;
    group.add(p);
  }

  // 生物圈名签（朝外侧）
  const label = textSprite(zoneInfo.name, 'RING ' + (zoneInfo.ring === 'A' ? 'A · 旧世界' : 'B · 新世界') + ' · ' + zone.zh, '#dcecff', 768);
  label.position.set(BIOME_RADIUS + 120, 0, 0);
  label.scale.set(430, 115, 1);
  group.add(label);

  return group;
}

function buildRing(ringId, zPos, step, ringOrder) {
  const ring = new THREE.Group();
  ring.position.z = zPos;
  ring.userData.speed = ringId === 'A' ? 0.025 : -0.025;   // 双环反向旋转

  for (let i = 0; i < 12; i++) {
    const a = i * Math.PI / 6 + step;
    const info = ringOrder[i];
    const seed = (ringId === 'A' ? 100 : 200) + i * 7 + 3;
    const bio = buildBiomeCylinder({ zone: info.zone, name: info.name, ring: ringId }, seed, i);

    const outward = new THREE.Vector3(Math.cos(a), Math.sin(a), 0);
    const tangent = new THREE.Vector3(-Math.sin(a), Math.cos(a), 0);
    const m = new THREE.Matrix4().makeBasis(outward, tangent, new THREE.Vector3(0, 0, 1));
    bio.quaternion.setFromRotationMatrix(m);
    bio.position.set(RING_RADIUS * Math.cos(a), RING_RADIUS * Math.sin(a), 0);
    ring.add(bio);
  }

  // 舱间隧道（相邻舱端部，15° 斜接）
  for (let i = 0; i < 12; i++) {
    const a0 = i * Math.PI / 6 + step, a1 = ((i + 1) % 12) * Math.PI / 6 + step;
    const t0 = new THREE.Vector3(-Math.sin(a0), Math.cos(a0), 0);
    const t1 = new THREE.Vector3(-Math.sin(a1), Math.cos(a1), 0);
    const p0 = new THREE.Vector3(RING_RADIUS * Math.cos(a0), RING_RADIUS * Math.sin(a0), 0).addScaledVector(t0, BIOME_LENGTH/2);
    const p1 = new THREE.Vector3(RING_RADIUS * Math.cos(a1), RING_RADIUS * Math.sin(a1), 0).addScaledVector(t1, -BIOME_LENGTH/2);
    const mid = p0.clone().add(p1).multiplyScalar(0.5);
    const dir = p1.clone().sub(p0);
    const len = dir.length();
    const tunGeo = new THREE.CylinderGeometry(120, 130, len, 18);
    const tunMat = new THREE.MeshStandardMaterial({ color: 0x232c36, roughness: 0.7, metalness: 0.6 });
    const tun = new THREE.Mesh(tunGeo, tunMat);
    tun.position.copy(mid);
    tun.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    ring.add(tun);
    const lgt = new THREE.Mesh(new THREE.TorusGeometry(126, 6, 8, 24),
      new THREE.MeshBasicMaterial({ color: 0x87d8ff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
    lgt.position.copy(mid);
    lgt.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.normalize());
    ring.add(lgt);
  }

  // 六根辐条（连到六边形内环附近）
  const spokeMat = new THREE.MeshStandardMaterial({ color: 0x4c5560, roughness: 0.6, metalness: 0.65 });
  const spokeGlowMat = new THREE.MeshBasicMaterial({ color: 0x9be0ff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false });
  for (let s = 0; s < SPOKE_COUNT; s++) {
    const a = s * Math.PI / 3 + step + Math.PI / 6;
    const dir = new THREE.Vector3(Math.cos(a), Math.sin(a), 0);
    const r0 = INNER_RING_RADIUS + 60, r1 = RING_RADIUS - 740;
    const len = r1 - r0;
    const geo = new THREE.CylinderGeometry(52, 72, len, 18);
    const spoke = new THREE.Mesh(geo, spokeMat);
    spoke.position.copy(dir.clone().multiplyScalar((r0 + r1) / 2));
    spoke.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    ring.add(spoke);
    for (let k = 0; k < 5; k++) {
      const t = r0 + len * (0.12 + k * 0.19);
      const band = new THREE.Mesh(new THREE.TorusGeometry(56, 4, 8, 24), spokeGlowMat);
      band.position.copy(dir.clone().multiplyScalar(t));
      band.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
      ring.add(band);
    }
    // 内端旋转轴套
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(95, 95, 120, 20), spokeMat);
    collar.position.copy(dir.clone().multiplyScalar(r0 - 55));
    collar.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    ring.add(collar);
  }
  return ring;
}

function buildHexInnerRing(zPos) {
  const g = new THREE.Group();
  g.position.z = zPos;
  const mat = new THREE.MeshStandardMaterial({ color: 0x39434f, roughness: 0.55, metalness: 0.7 });
  const hexR = INNER_RING_RADIUS;
  const segLen = hexR * Math.sqrt(3);
  for (let s = 0; s < 6; s++) {
    const a = s * Math.PI / 3 + Math.PI / 6;
    const mid = new THREE.Vector3(hexR * Math.cos(a), hexR * Math.sin(a), 0);
    const dir = new THREE.Vector3(-Math.sin(a), Math.cos(a), 0);
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(58, 58, segLen - 20, 16), mat);
    seg.position.copy(mid);
    seg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    g.add(seg);
    // 连接到脊柱的短撑
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(22, 34, hexR - SPINE_RADIUS - 40, 12), mat);
    strut.position.copy(mid.clone().multiplyScalar(0.5 + SPINE_RADIUS/(2*hexR)));
    strut.quaternion.copy(seg.quaternion);
    g.add(strut);
  }
  return g;
}

function buildSpine() {
  const g = new THREE.Group();
  const { map, glow } = spineTextures();
  const sideMat = new THREE.MeshStandardMaterial({ map, color: 0xffffff, emissive: 0xffffff, emissiveMap: glow, emissiveIntensity: 0.8, roughness: 0.5, metalness: 0.55 });
  const main = new THREE.Mesh(new THREE.CylinderGeometry(SPINE_RADIUS, SPINE_RADIUS, SPINE_LENGTH, 40, 8), sideMat);
  main.rotation.x = Math.PI / 2;
  g.add(main);

  const ribMat = new THREE.MeshStandardMaterial({ color: 0x1c242e, roughness: 0.5, metalness: 0.8 });
  for (let z = -4800; z <= 4800; z += 800) {
    const rib = new THREE.Mesh(new THREE.TorusGeometry(SPINE_RADIUS + 14, 12, 10, 40), ribMat);
    rib.position.z = z;
    g.add(rib);
  }
  // 燃料包层罐体（沿脊柱）
  const tankMat = new THREE.MeshStandardMaterial({ color: 0x59636f, roughness: 0.4, metalness: 0.7 });
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3 + Math.PI / 6;
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(82, 82, 7200, 20), tankMat);
    tank.position.set(SPINE_RADIUS + 110 * Math.cos(a), SPINE_RADIUS + 110 * Math.sin(a), 0);
    tank.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1));
    g.add(tank);
    for (const zz of [-2600, 0, 2600]) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(84, 6, 8, 20),
        new THREE.MeshBasicMaterial({ color: 0x8ccfff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
      band.position.copy(tank.position); band.position.z = zz;
      g.add(band);
    }
  }
  // 两座固定六边形内环
  g.add(buildHexInnerRing(RING_A_Z));
  g.add(buildHexInnerRing(RING_B_Z));
  // 连接两座内环的四根纵向支杆
  const strutMat = new THREE.MeshStandardMaterial({ color: 0x2b3440, roughness: 0.6, metalness: 0.7 });
  for (let s = 0; s < 4; s++) {
    const a = s * Math.PI / 2 + Math.PI / 4;
    const pos = new THREE.Vector3(INNER_RING_RADIUS * Math.cos(a) * 0.8, INNER_RING_RADIUS * Math.sin(a) * 0.8, 0);
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(40, 40, 4000, 14), strutMat);
    strut.position.copy(pos);
    strut.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1));
    g.add(strut);
  }
  // 两条外环间大桁架（对应文中 Costa Rica—Bengal / Patagonia—Siberia 连接）
  for (let k = 0; k < 2; k++) {
    const a = (k === 0 ? 1.15 : 4.28) + RING_B_STEP;
    const x = RING_RADIUS * Math.cos(a), y = RING_RADIUS * Math.sin(a);
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(60, 60, 4100, 14), strutMat);
    strut.position.set(x, y, 0);
    strut.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1));
    g.add(strut);
  }
  return g;
}

function buildBowEngine() {
  const g = new THREE.Group();
  // 船艏推板
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(1250, 1550, 320, 48),
    new THREE.MeshStandardMaterial({ color: 0x2b313a, roughness: 0.75, metalness: 0.6 }));
  plate.rotation.x = Math.PI / 2; plate.position.z = -4650;
  g.add(plate);
  // 磁屏蔽场线圈
  for (let i = 0; i < 3; i++) {
    const coil = new THREE.Mesh(new THREE.TorusGeometry(1500 - i * 260, 55, 12, 60),
      new THREE.MeshStandardMaterial({ color: 0x1d3448, roughness: 0.4, metalness: 0.85 }));
    coil.position.z = -4300 - i * 260;
    g.add(coil);
    const halo = new THREE.Mesh(new THREE.TorusGeometry(1500 - i * 260, 10, 8, 60),
      new THREE.MeshBasicMaterial({ color: 0x51c8ff, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false }));
    halo.position.copy(coil.position);
    g.add(halo);
  }
  // 聚变微爆引擎喷口（朝 -Z 前向，减速用）
  const nozzles = [];
  const nozzleMat = new THREE.MeshStandardMaterial({ color: 0x252d37, roughness: 0.35, metalness: 0.9 });
  const rimMat = new THREE.MeshBasicMaterial({ color: 0x9adfff, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false });
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2;
    const noz = new THREE.Mesh(new THREE.CylinderGeometry(110, 430, 760, 28, 1, true), nozzleMat);
    noz.position.set(360 * Math.cos(a), 360 * Math.sin(a), -5050);
    noz.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1));
    g.add(noz);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(432, 10, 8, 36), rimMat);
    rim.position.copy(noz.position); rim.position.z = -5050 + 378;
    g.add(rim);
    nozzles.push(noz);
  }
  g.userData.nozzles = nozzles;
  g.userData.rimMat = rimMat;

  // 前向闪光
  const flash = makeSprite(GLOW_WARM, 0xfff1c8, 3200, 0.0);
  flash.position.set(0, 0, -5700);
  g.add(flash);
  g.userData.flash = flash;
  const light = new THREE.PointLight(0xffd9a0, 0, 9000, 1.8);
  light.position.copy(flash.position);
  g.add(light);
  g.userData.light = light;
  return g;
}

function buildStern() {
  const g = new THREE.Group();
  const hullMat = new THREE.MeshStandardMaterial({ color: 0x3c4652, roughness: 0.55, metalness: 0.65 });
  // 艉部轮渡港
  const dock = new THREE.Mesh(new THREE.CylinderGeometry(300, 340, 760, 20), hullMat);
  dock.rotation.x = Math.PI/2; dock.position.z = 4950;
  g.add(dock);
  for (let i = 0; i < 3; i++) {
    const a = i * Math.PI * 2 / 3;
    const port = new THREE.Mesh(new THREE.CylinderGeometry(70, 70, 80, 16), hullMat);
    port.position.set(250 * Math.cos(a), 250 * Math.sin(a), 5200);
    port.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(Math.cos(a), Math.sin(a), 0));
    g.add(port);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(72, 6, 8, 20),
      new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
    rim.position.copy(port.position); rim.position.z = 5242;
    g.add(rim);
  }
  // 散热鳍
  const finMat = new THREE.MeshStandardMaterial({ color: 0x27333f, roughness: 0.5, metalness: 0.8 });
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI/4;
    const fin = new THREE.Mesh(new THREE.BoxGeometry(2600, 12, 180), finMat);
    fin.position.set(1500 * Math.cos(a), 1500 * Math.sin(a), 5150);
    fin.rotation.z = -a;
    g.add(fin);
    const edge = new THREE.Mesh(new THREE.BoxGeometry(2600, 2, 3),
      new THREE.MeshBasicMaterial({ color: 0x54a8ff, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }));
    edge.position.copy(fin.position); edge.position.y += 7;
    edge.rotation.z = fin.rotation.z;
    g.add(edge);
  }
  // 检疫穿梭机（Jochi 的小艇，停靠艉部）
  const shuttle = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(24, 60, 8, 16), hullMat);
  body.rotation.z = Math.PI/2;
  shuttle.add(body);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(24, 50, 16),
    new THREE.MeshStandardMaterial({ color: 0x555e68, roughness: 0.4, metalness: 0.8 }));
  nose.position.y = 55; shuttle.add(nose);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(8, 8, 120, 8), hullMat);
  arm.position.set(40, 0, 0); arm.rotation.z = Math.PI/2;
  g.add(arm);
  shuttle.position.set(250, 60, 5500);
  g.add(shuttle);
  g.userData.shuttle = shuttle;
  // 红色航行灯
  const beacon = makeSprite(GLOW_RED, 0xff6655, 150, 0.9);
  beacon.position.set(0, 120, 5350);
  g.add(beacon);
  g.userData.beacon = beacon;
  return g;
}

function buildShip() {
  const ship = new THREE.Group();
  ship.add(buildSpine());
  ship.add(buildBowEngine());
  ship.add(buildStern());
  const ringA = buildRing('A', RING_A_Z, RING_A_STEP, RING_ORDER_A);
  const ringB = buildRing('B', RING_B_Z, RING_B_STEP, RING_ORDER_B);
  ship.add(ringA); ship.add(ringB);

  // 侧向航行灯
  const navL = makeSprite(GLOW_RED, 0xff5544, 260, 0.9);
  navL.position.set(-RING_RADIUS - 900, 0, 0);
  const navR = makeSprite(GLOW_CYAN, 0x44ffcc, 260, 0.9);
  navR.position.set(RING_RADIUS + 900, 0, 0);
  ship.add(navL, navR);
  ship.userData = { ringA, ringB, navL, navR, bow: null };
  ship.userData.bow = ship.children.find(c => c.userData && c.userData.flash);
  return ship;
}

/* ============================================================
   内部场景
   ============================================================ */
function skyPatchTexture(cfg) {
  return canvasTexture(64, 512, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, cfg.skyTop);
    g.addColorStop(0.5, cfg.skyMid);
    g.addColorStop(1, cfg.skyTop);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    // 云纹
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    for (let i = 0; i < 14; i++) ctx.fillRect(0, Math.random() * h, w, Math.random() * 30 + 4);
  });
}

function groundPatchTexture(cfg, rngSeed) {
  return canvasTexture(1024, 512, (ctx, w, h) => {
    ctx.fillStyle = cfg.ground; ctx.fillRect(0, 0, w, h);
    const rng = mulberry32(rngSeed);
    // 大地色斑块
    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = `rgba(${rng()<0.5?'255,255,255':'0,0,0'},${(rng()*0.10+0.02).toFixed(3)})`;
      ctx.beginPath();
      ctx.ellipse(rr(rng,0,w), rr(rng,0,h), rr(rng,8,90), rr(rng,6,40), rr(rng,0,Math.PI), 0, Math.PI*2);
      ctx.fill();
    }
    // 农田/地块条带
    ctx.strokeStyle = 'rgba(0,0,0,0.16)'; ctx.lineWidth = 3;
    for (let i = 0; i < 12; i++) {
      const y = i * h / 12;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    // 道路（沿舱长方向）
    ctx.fillStyle = 'rgba(40,36,30,0.35)';
    ctx.fillRect(0, h*0.46, w, 26);
  });
}

function cloudTexture() {
  return canvasTexture(256, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < 12; i++) {
      const x = Math.random() * w, y = Math.random() * h, r = Math.random() * 26 + 10;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.85)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.fill();
    }
  });
}
const CLOUD_TEX = cloudTexture();

function addTrees(group, cfg, rng) {
  const n = cfg.treeCount;
  const trunkGeo = new THREE.CylinderGeometry(1.6, 2.6, 16, 6);
  const folGeo = new THREE.ConeGeometry(10, 26, 8);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5b4430, roughness: 0.9 });
  const folMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, n);
  const fols = new THREE.InstancedMesh(folGeo, folMat, n);
  const cA = new THREE.Color(cfg.treeColorA), cB = new THREE.Color(cfg.treeColorB), cC = new THREE.Color(cfg.treeColorC);
  const Y = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < n; i++) {
    let x, phi;
    for (let tries = 0; tries < 20; tries++) {
      x = rr(rng, -cfg.halfLen + 35, cfg.halfLen - 35);
      phi = rr(rng, cfg.phi0 + 0.06, cfg.phi1 - 0.06);
      const inWater = cfg.water && phi > cfg.water.phi0 && phi < cfg.water.phi1 && x > cfg.water.x0 && x < cfg.water.x1;
      if (!inWater) break;
    }
    const p = surfacePoint(x, phi, cfg.R - 2);
    const up = surfaceUp(phi);
    const q = new THREE.Quaternion().setFromUnitVectors(Y, up);
    const yaw = new THREE.Quaternion().setFromAxisAngle(Y, rr(rng, 0, Math.PI * 2));
    q.multiply(yaw);
    const s = rr(rng, cfg.treeScaleMin, cfg.treeScaleMax);
    const m1 = new THREE.Matrix4().compose(p.clone().addScaledVector(up, 8 * s), q, new THREE.Vector3(s, s, s));
    trunks.setMatrixAt(i, m1);
    const m2 = new THREE.Matrix4().compose(p.clone().addScaledVector(up, (22 - 3) * s), q, new THREE.Vector3(s, s, s));
    fols.setMatrixAt(i, m2);
    const c = cA.clone().lerp(cB, rng()).lerp(cC, rng() * 0.5);
    fols.setColorAt(i, c);
  }
  group.add(trunks, fols);
}

function addBuilding(group, cfg, rng) {
  const b = new THREE.Group();
  const type = cfg.buildingType;
  const wallMat = new THREE.MeshStandardMaterial({ color: cfg.buildingColor, roughness: 0.7 });
  const roofMat = new THREE.MeshStandardMaterial({ color: cfg.roofColor, roughness: 0.6, metalness: 0.2 });
  const winMat = new THREE.MeshBasicMaterial({ color: 0xffd58a });
  if (type === 'yurt') {
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(6, 6.5, 4.5, 12), wallMat);
    b.add(wall);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(7.2, 4.6, 12), roofMat);
    roof.position.y = 4.4; b.add(roof);
    for (let i = 0; i < 3; i++) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, 0.4), winMat);
      const a = rr(rng, 0, Math.PI*2);
      w.position.set(Math.cos(a) * 6.2, 1.2, Math.sin(a) * 6.2);
      w.lookAt(0, 1.2, 0);
      b.add(w);
    }
  } else if (type === 'cube') {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(8, 6, 7), wallMat);
    wall.position.y = 3; b.add(wall);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(6.4, 3.2, 4), roofMat);
    roof.position.y = 7.4; roof.rotation.y = Math.PI/4; b.add(roof);
    for (const sx of [-1, 1]) for (const sy of [1.5, 4.5]) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.6, 0.4), winMat);
      w.position.set(sx * 2.2, sy, 3.55); b.add(w);
    }
  } else { // house
    const wall = new THREE.Mesh(new THREE.BoxGeometry(10, 6, 8), wallMat);
    wall.position.y = 3; b.add(wall);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(7.4, 3.6, 4), roofMat);
    roof.position.y = 7.6; roof.rotation.y = Math.PI/4; b.add(roof);
    for (const sx of [-1, 0, 1]) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.8, 0.4), winMat);
      w.position.set(sx * 3, 2.4, 4.05); b.add(w);
    }
  }
  let x, phi;
  for (let tries = 0; tries < 20; tries++) {
    x = rr(rng, cfg.villageX0, cfg.villageX1);
    phi = rng() < 0.5 ? cfg.phi0 + rr(rng, 0.12, 0.42) : cfg.phi1 - rr(rng, 0.12, 0.42);
    if (!(cfg.water && phi > cfg.water.phi0 && phi < cfg.water.phi1 && x > cfg.water.x0 && x < cfg.water.x1)) break;
  }
  const p = surfacePoint(x, phi, cfg.R - 2);
  const up = surfaceUp(phi);
  b.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
  b.rotateY(rr(rng, 0, Math.PI * 2));
  b.position.copy(p.clone().addScaledVector(up, 0.4));
  group.add(b);
}

function buildBiomeChamber(cfg) {
  const g = new THREE.Group();
  const R = cfg.R, L = cfg.halfLen * 2;
  cfg.phi0 = Math.PI - 1.12; cfg.phi1 = Math.PI + 1.12;

  // 外层舱壳
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(R, R, L, 72, 4, true),
    new THREE.MeshStandardMaterial({ color: cfg.shellColor, roughness: 0.95, metalness: 0.05, side: THREE.BackSide }));
  shell.rotation.z = -Math.PI / 2;
  g.add(shell);

  // 端墙与锁门
  const capMat = new THREE.MeshStandardMaterial({ color: cfg.shellColor, roughness: 0.9, side: THREE.DoubleSide });
  for (const s of [-1, 1]) {
    const cap = new THREE.Mesh(new THREE.CircleGeometry(R, 64), capMat);
    cap.position.x = s * L / 2;
    cap.rotation.y = s > 0 ? Math.PI / 2 : -Math.PI / 2;
    g.add(cap);
    const portal = new THREE.Mesh(new THREE.TorusGeometry(120, 14, 10, 40),
      new THREE.MeshBasicMaterial({ color: 0x71d8ff, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false }));
    portal.position.copy(cap.position); portal.position.y = -R + 80;
    portal.rotation.y = cap.rotation.y;
    g.add(portal);
  }

  // 天空顶棚（φ 顶部）
  const skyMat = new THREE.MeshBasicMaterial({ map: skyPatchTexture(cfg), side: THREE.BackSide, toneMapped: false });
  const sky = new THREE.Mesh(curvedPatchGeometry(R - 2, L - 8, -1.06, 1.06, 80, 16), skyMat);
  g.add(sky);
  cfg._skyMat = skyMat;

  // 地板（φ 底部，舱体向外侧）
  const groundMat = new THREE.MeshStandardMaterial({ map: groundPatchTexture(cfg, cfg.seed), side: THREE.BackSide, roughness: 0.92 });
  const ground = new THREE.Mesh(curvedPatchGeometry(R - 6, L - 10, cfg.phi0, cfg.phi1, 80, 24, 2), groundMat);
  g.add(ground);

  // 湖泊 / 海面
  let water = null;
  if (cfg.water) {
    const wMat = new THREE.MeshStandardMaterial({ color: cfg.water.color, side: THREE.BackSide, roughness: 0.12, metalness: 0.45, transparent: true, opacity: 0.85, emissive: cfg.water.color, emissiveIntensity: 0.12 });
    water = new THREE.Mesh(curvedPatchGeometry(R - 9, cfg.water.x1 - cfg.water.x0, cfg.water.phi0, cfg.water.phi1, 40, 14), wMat);
    water.position.x = (cfg.water.x0 + cfg.water.x1) / 2;
    g.add(water);
    cfg._waterMat = wMat;
  }

  // 太阳线：沿顶部穹顶的长灯带 + 自东向西移动的日灯
  const sunBase = new THREE.Mesh(curvedPatchGeometry(R - 4, L - 30, -0.055, 0.055, 60, 8),
    new THREE.MeshBasicMaterial({ color: 0xffe3a6, side: THREE.BackSide, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false }));
  g.add(sunBase);
  const sunLamp = new THREE.Mesh(curvedPatchGeometry(R - 3, 150, -0.075, 0.075, 16, 8),
    new THREE.MeshBasicMaterial({ color: 0xfff6d8, side: THREE.BackSide, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
  g.add(sunLamp);
  const sunLight = new THREE.PointLight(cfg.sunColor, 1.4, 1800, 1.6);
  g.add(sunLight);
  cfg._sunLamp = sunLamp; cfg._sunLight = sunLight;

  const rng = mulberry32(cfg.seed);
  // 丘陵
  const hillMat = new THREE.MeshStandardMaterial({ color: cfg.hillColor, roughness: 0.95 });
  for (let i = 0; i < 12; i++) {
    const x = rr(rng, -cfg.halfLen + 60, cfg.halfLen - 60);
    const phi = rr(rng, cfg.phi0 + 0.1, cfg.phi1 - 0.1);
    const p = surfacePoint(x, phi, R - 8);
    const up = surfaceUp(phi);
    const hill = new THREE.Mesh(new THREE.SphereGeometry(rr(rng, 26, 75), 16, 12), hillMat);
    hill.scale.y = 0.35;
    hill.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
    hill.position.copy(p.clone().addScaledVector(up, 8));
    g.add(hill);
  }
  addTrees(g, cfg, rng);

  // 聚落（书中：村镇多位于舱体中段近中线处）
  const buildings = new THREE.Group();
  const houseCount = cfg.houseCount;
  for (let i = 0; i < houseCount; i++) addBuilding(buildings, cfg, rng);
  g.add(buildings);
  // 道路
  const pathMat = new THREE.MeshStandardMaterial({ color: 0x5a5548, roughness: 0.9, side: THREE.BackSide });
  const path = new THREE.Mesh(curvedPatchGeometry(R - 7, cfg.villageX1 - cfg.villageX0, Math.PI - 0.04, Math.PI + 0.04, 30, 8), pathMat);
  path.position.x = (cfg.villageX0 + cfg.villageX1) / 2;
  g.add(path);

  // 环形列车轨道与车厢
  const railPhi = Math.PI + 0.16;
  const railPoints = [];
  for (let x = -cfg.halfLen + 20; x <= cfg.halfLen - 20; x += 40) railPoints.push(surfacePoint(x, railPhi, R - 5));
  const railMat = new THREE.MeshStandardMaterial({ color: 0x20262e, roughness: 0.5, metalness: 0.8 });
  for (const off of [-2.2, 2.2]) {
    const pts = railPoints.map(p => p.clone().addScaledVector(surfaceUp(railPhi), 1.4).add(new THREE.Vector3(0, 0, off)));
    const rail = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 80, 0.7, 8, false), railMat);
    g.add(rail);
  }
  const tram = new THREE.Group();
  const tramMat = new THREE.MeshStandardMaterial({ color: 0xd9e2ec, roughness: 0.4, metalness: 0.6 });
  const tramBody = new THREE.Mesh(new THREE.BoxGeometry(8, 5.4, 17), tramMat);
  tram.add(tramBody);
  const tramWin = new THREE.Mesh(new THREE.BoxGeometry(7.2, 1.8, 14),
    new THREE.MeshBasicMaterial({ color: 0xffe2a0 }));
  tramWin.position.y = 0.6; tram.add(tramWin);
  const tramLight = new THREE.PointLight(0xffe2a0, 40, 120, 2);
  tram.add(tramLight);
  g.add(tram);
  cfg._tram = tram; cfg._tramPhi = railPhi;

  // 云
  const clouds = [];
  for (let i = 0; i < 14; i++) {
    const cl = new THREE.Sprite(new THREE.SpriteMaterial({ map: CLOUD_TEX, transparent: true, opacity: rr(rng, 0.16, 0.34), depthWrite: false }));
    cl.position.set(rr(rng, -L/2, L/2), rr(rng, 240, 440), rr(rng, -80, 80));
    cl.scale.set(rr(rng, 90, 220), rr(rng, 36, 90), 1);
    cl.userData.speed = rr(rng, 2, 6);
    g.add(cl); clouds.push(cl);
  }
  cfg._clouds = clouds;

  // 舱内基础光
  const hemi = new THREE.HemisphereLight(cfg.skyMid, 0x202018, 0.35);
  g.add(hemi);
  const amb = new THREE.AmbientLight(0x304560, 0.4);
  g.add(amb);
  return g;
}

function animateBiomeChamber(cfg, t, dt) {
  const R = cfg.R;
  // 太阳线移动（自东向西）与昼夜
  const x = Math.sin(t * cfg.daySpeed) * (cfg.halfLen - 140);
  const lampP = surfacePoint(x, 0, R - 3);
  cfg._sunLamp.position.copy(lampP);
  cfg._sunLight.position.copy(lampP);
  const day = (Math.sin(t * cfg.daySpeed) + 1) / 2; // 1 = 正午，0 = 午夜
  const night = 1 - day;
  const skyC = cfg._skyMat.color;
  skyC.set(cfg.skyTop).lerp(cfg.skyNight, night * 0.75);
  cfg._sunLight.intensity = 0.5 + day * 2.4;
  if (cfg._waterMat) {
    cfg._waterMat.opacity = 0.78 + 0.08 * Math.sin(t * 2.1);
    cfg._waterMat.emissiveIntensity = 0.08 + 0.1 * day;
  }
  // 环线列车
  const span = cfg.halfLen * 2 - 60;
  const px = ((t * 30 + cfg.halfLen) % span) - (span / 2);
  const p = surfacePoint(px, cfg._tramPhi, R - 5);
  const up = surfaceUp(cfg._tramPhi);
  cfg._tram.position.copy(p.clone().addScaledVector(up, 3.6));
  cfg._tram.up.copy(up);
  cfg._tram.lookAt(p.clone().add(new THREE.Vector3(1, 0, 0)));
  // 云
  for (const cl of cfg._clouds) {
    cl.position.x += cl.userData.speed * dt;
    if (cl.position.x > cfg.halfLen) cl.position.x = -cfg.halfLen;
  }
}

/* ---------- 脊柱舰桥（观测/指挥舱） ---------- */
function buildBridge() {
  const g = new THREE.Group();
  const R = 52, L = 170;
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(R, R, L, 48, 4, true),
    new THREE.MeshStandardMaterial({ color: 0x1a2330, roughness: 0.8, side: THREE.BackSide }));
  shell.rotation.x = Math.PI / 2;
  g.add(shell);
  // 地板
  const floor = new THREE.Mesh(new THREE.CylinderGeometry(R - 2, R - 2, 6, 40),
    new THREE.MeshStandardMaterial({ color: 0x28303c, roughness: 0.6, metalness: 0.4 }));
  floor.position.y = -R + 12; floor.rotation.x = Math.PI / 2;
  g.add(floor);
  // 星窗（书中的脊柱舷窗）
  const starCanvas = canvasTexture(512, 160, (ctx, w, h) => {
    ctx.fillStyle = '#010309'; ctx.fillRect(0, 0, w, h);
    const rng = mulberry32(4);
    for (let i = 0; i < 500; i++) {
      ctx.fillStyle = `rgba(${rng()<0.8?'255,255,255':'150,210,255'},${(rng()*0.7+0.3).toFixed(2)})`;
      const s = rng() * 1.6 + 0.2;
      ctx.fillRect(rng()*w, rng()*h, s, s);
    }
  }, true);
  for (let side = 0; side < 4; side++) {
    const a = side * Math.PI / 2;
    const win = new THREE.Mesh(new THREE.PlaneGeometry(120, 34),
      new THREE.MeshBasicMaterial({ map: starCanvas, side: THREE.DoubleSide, toneMapped: false }));
    win.position.set(Math.cos(a) * (R - 2), 26, Math.sin(a) * (R - 2));
    win.rotation.y = -a + Math.PI / 2;
    g.add(win);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(2, 36, 1),
      new THREE.MeshStandardMaterial({ color: 0x39434e, roughness: 0.4, metalness: 0.8 }));
    frame.position.copy(win.position); frame.rotation.y = win.rotation.y;
    g.add(frame);
  }
  // 全息星图：天仓五系统
  const holo = new THREE.Group();
  const star = makeSprite(GLOW_WARM, 0xffdf9e, 26, 0.9);
  holo.add(star);
  const orbit = new THREE.Mesh(new THREE.TorusGeometry(12, 0.35, 8, 64),
    new THREE.MeshBasicMaterial({ color: 0x66e0ff, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
  holo.add(orbit);
  const moon = new THREE.Mesh(new THREE.SphereGeometry(2.6, 24, 16),
    new THREE.MeshStandardMaterial({ color: 0x86a2b0, roughness: 0.7, emissive: 0x24404e, emissiveIntensity: 0.3 }));
  moon.position.x = 12; holo.add(moon);
  holo.position.y = 6;
  g.add(holo);
  // 控制台环
  const consoleMat = new THREE.MeshStandardMaterial({ color: 0x232b36, roughness: 0.4, metalness: 0.6 });
  const screenMat = new THREE.MeshBasicMaterial({ color: 0x9fdcff });
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    const con = new THREE.Mesh(new THREE.BoxGeometry(9, 3.4, 5), consoleMat);
    con.position.set(Math.cos(a) * 17, -R + 16.6, Math.sin(a) * 17);
    con.rotation.y = -a;
    g.add(con);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(6.5, 2), screenMat);
    scr.position.copy(con.position); scr.position.y += 1.6;
    scr.rotation.y = con.rotation.y;
    g.add(scr);
  }
  // 飞船 AI 核心
  const core = new THREE.Group();
  const coreBall = new THREE.Mesh(new THREE.SphereGeometry(4.6, 32, 24),
    new THREE.MeshStandardMaterial({ color: 0x081018, roughness: 0.2, metalness: 0.9, emissive: 0x1c8fb0, emissiveIntensity: 0.35 }));
  core.add(coreBall);
  const coreRing = new THREE.Mesh(new THREE.TorusGeometry(7.4, 0.35, 8, 48),
    new THREE.MeshBasicMaterial({ color: 0x66e0ff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
  core.add(coreRing);
  core.position.set(0, 6, 0);
  g.add(core);
  g.userData = { holo, core, coreBall, coreRing, screens: [] };
  const lights = [new THREE.PointLight(0x66e0ff, 130, 180, 1.8), new THREE.AmbientLight(0x3b5f82, 1.1)];
  lights[0].position.set(0, 8, 0);
  g.add(...lights);
  return g;
}
function animateBridge(ud, t) {
  ud.holo.rotation.y = t * 0.5;
  ud.coreRing.rotation.x = t * 0.8; ud.coreRing.rotation.y = t * 0.6;
  const p = (Math.sin(t * 2.3) + 1) / 2;
  ud.coreBall.material.emissiveIntensity = 0.2 + p * 0.7;
}

/* ---------- 聚变引擎舱（脊柱涡轮室 + 反应堆） ---------- */
function buildEngineRoom() {
  const g = new THREE.Group();
  const R = 70, L = 180;
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(R, R, L, 48, 4, true),
    new THREE.MeshStandardMaterial({ color: 0x111820, roughness: 0.85, side: THREE.BackSide }));
  shell.rotation.x = Math.PI / 2;
  g.add(shell);
  const floor = new THREE.Mesh(new THREE.CylinderGeometry(R - 2, R - 2, 6, 40),
    new THREE.MeshStandardMaterial({ color: 0x1d242d, roughness: 0.6, metalness: 0.4 }));
  floor.position.y = -R + 8; floor.rotation.x = Math.PI / 2;
  g.add(floor);
  // 中央聚变堆
  const reactor = new THREE.Group();
  const torus = new THREE.Mesh(new THREE.TorusGeometry(24, 7, 12, 48),
    new THREE.MeshStandardMaterial({ color: 0x2a3038, roughness: 0.3, metalness: 0.9 }));
  reactor.add(torus);
  const plasma = new THREE.Mesh(new THREE.TorusGeometry(24, 4, 8, 48),
    new THREE.MeshBasicMaterial({ color: 0x8ff0ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  reactor.add(plasma);
  const core = new THREE.Mesh(new THREE.SphereGeometry(10, 24, 18),
    new THREE.MeshStandardMaterial({ color: 0x0a0e14, roughness: 0.25, metalness: 0.8, emissive: 0x35d4ff, emissiveIntensity: 0.5 }));
  reactor.add(core);
  reactor.position.y = 6;
  g.add(reactor);
  // 涡轮风扇
  const fans = [];
  for (const z of [-60, 60]) {
    const fan = new THREE.Group();
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(8, 8, 7, 20),
      new THREE.MeshStandardMaterial({ color: 0x3a4550, roughness: 0.35, metalness: 0.85 }));
    hub.rotation.x = Math.PI / 2; fan.add(hub);
    for (let i = 0; i < 9; i++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(26, 6, 1.2),
        new THREE.MeshStandardMaterial({ color: 0x596470, roughness: 0.35, metalness: 0.8 }));
      blade.position.x = Math.cos(i / 9 * Math.PI * 2) * 20;
      blade.position.y = Math.sin(i / 9 * Math.PI * 2) * 20;
      blade.rotation.z = -i / 9 * Math.PI * 2;
      fan.add(blade);
    }
    fan.position.set(0, 0, z);
    g.add(fan); fans.push(fan);
  }
  // 管路
  const pipeMat = new THREE.MeshStandardMaterial({ color: 0x4b5561, roughness: 0.4, metalness: 0.7 });
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, L, 10), pipeMat);
    pipe.position.set(Math.cos(a) * (R - 12), Math.sin(a) * 6, 0);
    pipe.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1));
    g.add(pipe);
  }
  // 燃料微丸注入器
  const pelletRail = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 42, 8), pipeMat);
  pelletRail.position.set(0, 36, 20); pelletRail.rotation.x = Math.PI/2;
  g.add(pelletRail);
  const pellet = new THREE.Mesh(new THREE.SphereGeometry(2.2, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xffe1a0 }));
  g.add(pellet);
  // 警报灯
  const beacons = [];
  for (let i = 0; i < 4; i++) {
    const b = makeSprite(GLOW_RED, 0xff6a55, 9, 0.8);
    b.position.set(Math.cos(i * Math.PI/2) * (R - 6), 30, Math.sin(i * Math.PI/2) * (R - 6));
    g.add(b); beacons.push(b);
  }
  const light = new THREE.PointLight(0x66e0ff, 90, 220, 1.6);
  light.position.set(0, 6, 0);
  g.add(light);
  const amb = new THREE.AmbientLight(0x243c56, 0.6);
  g.add(amb);
  g.userData = { reactor, plasma, core, fans, pellet, light, beacons };
  return g;
}
function animateEngineRoom(ud, t) {
  ud.reactor.rotation.y = t * 0.4;
  ud.reactor.rotation.x = Math.sin(t * 0.6) * 0.15;
  for (const f of ud.fans) f.rotation.z = t * 9;
  const pulse = 0.5 + 0.5 * Math.sin(t * Math.PI * 4);
  ud.plasma.material.opacity = 0.55 + pulse * 0.4;
  ud.core.material.emissiveIntensity = 0.3 + pulse * 1.3;
  ud.light.intensity = 55 + pulse * 70;
  // 每秒 2 发的燃料微丸
  const cyc = (t * 2) % 1;
  const y = 36 - cyc * 42;
  ud.pellet.position.set(0, y, 20);
  ud.pellet.material.opacity = cyc < 0.85 ? 1 : 0.1;
  for (const b of ud.beacons) b.material.opacity = 0.2 + 0.8 * Math.abs(Math.sin(t * 6));
}

/* ---------- 六号辐条 + 六边形内环 ---------- */
function buildSpoke() {
  const g = new THREE.Group();
  const R = 2.8, L = 130;
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(R, R, L, 28, 4, true),
    new THREE.MeshStandardMaterial({ color: 0x283340, roughness: 0.7, metalness: 0.3, side: THREE.BackSide }));
  g.add(shell);
  const step = 1.7;
  const stairMat = new THREE.MeshStandardMaterial({ color: 0x56626e, roughness: 0.5, metalness: 0.7 });
  for (let i = 0; i < 68; i++) {
    const a = i * 0.9;
    const y = -L/2 + 4 + i * step;
    const stair = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.18, 1.7), stairMat);
    stair.position.set(Math.cos(a) * (R - 0.7), y, Math.sin(a) * (R - 0.7));
    stair.rotation.y = -a;
    g.add(stair);
    if (i % 3 === 0) {
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.2, 5), stairMat);
      rail.position.set(Math.cos(a) * (R - 1.5), y + 1, Math.sin(a) * (R - 1.5));
      rail.rotation.z = Math.PI / 2; rail.rotation.y = -a;
      g.add(rail);
    }
  }
  // 舷窗（外太空星点）
  const starCanvas = canvasTexture(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#02040c'; ctx.fillRect(0, 0, w, h);
    const rng = mulberry32(9);
    for (let i = 0; i < 120; i++) {
      ctx.fillStyle = `rgba(255,255,255,${rng()*0.7+0.3})`;
      const s = rng() * 2 + 0.4;
      ctx.fillRect(rng()*w, rng()*h, s, s);
    }
  }, true);
  for (let i = 0; i < 16; i++) {
    const a = i * 0.72 + 0.3;
    const y = -L/2 + 8 + i * 7.4;
    const win = new THREE.Mesh(new THREE.CircleGeometry(0.85, 16),
      new THREE.MeshBasicMaterial({ map: starCanvas, side: THREE.DoubleSide, toneMapped: false }));
    win.position.set(Math.cos(a) * (R - 0.15), y, Math.sin(a) * (R - 0.15));
    win.lookAt(0, y, 0);
    g.add(win);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.88, 0.06, 6, 18),
      new THREE.MeshBasicMaterial({ color: 0x8bd8ff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    rim.position.copy(win.position); rim.lookAt(0, y, 0);
    g.add(rim);
  }
  // 顶部：六边形内环室
  const topRoom = new THREE.Group();
  const roomMat = new THREE.MeshStandardMaterial({ color: 0x232d38, roughness: 0.6, metalness: 0.5, side: THREE.BackSide });
  const room = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 5, 6), roomMat);
  topRoom.add(room);
  const doorMat = new THREE.MeshBasicMaterial({ color: 0x77d8ff, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false });
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3 + Math.PI/6;
    const door = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 3.2), doorMat);
    door.position.set(Math.cos(a) * 6.2, 0.5, Math.sin(a) * 6.2);
    door.rotation.y = -a + Math.PI;
    topRoom.add(door);
  }
  const label = textSprite('内环 · 六边形通道', '六根辐条 / 燃料舱室 / 十二条通道', '#cfe9ff', 480);
  label.position.y = 4.4;
  label.scale.set(15, 5.4, 1);
  topRoom.add(label);
  topRoom.position.y = L/2 + 2.5;
  g.add(topRoom);
  const light = new THREE.PointLight(0x9bd8ff, 34, 55, 1.8);
  light.position.y = 0;
  g.add(light);
  const amb = new THREE.AmbientLight(0x3b546e, 1.25);
  g.add(amb);
  g.userData = { light };
  return g;
}
function animateSpoke(ud, t) {
  ud.light.intensity = 14 + 7 * Math.sin(t * 2.5);
}

/* ============================================================
   场景装配
   ============================================================ */
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.35;
document.body.appendChild(renderer.domElement);
renderer.domElement.id = 'scene';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x01030a);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 1, 180000);
camera.position.set(8000, 5200, 14500);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.minDistance = 500;
controls.maxDistance = 90000;
controls.target.set(0, 0, 0);
controls.zoomSpeed = 1.05;

const starfield = buildStarfield();
const ship = buildShip();
const interiorRoot = new THREE.Group();
scene.add(starfield, ship, interiorRoot);

// 收集太阳线灯带
ship.userData.sunlines = [];
for (const ring of [ship.userData.ringA, ship.userData.ringB]) {
  for (const c of ring.children) {
    if (c.userData && c.userData.sunline) ship.userData.sunlines.push(c.userData.sunline);
  }
}

// 外部光照（深空环境：低照度、高对比、强主光）
scene.add(new THREE.HemisphereLight(0xbdd6ff, 0x101625, 0.9));
scene.add(new THREE.AmbientLight(0x33445e, 1.55));
const sunLight = new THREE.DirectionalLight(0xfff1d6, 3.4);
sunLight.position.set(9000, 6500, -15000);
scene.add(sunLight);
const rimLight = new THREE.DirectionalLight(0x7fb2ff, 1.5);
rimLight.position.set(-11000, -4500, 13000);
scene.add(rimLight);
const fillLight = new THREE.DirectionalLight(0x9aa8c0, 0.9);
fillLight.position.set(2000, 3000, 18000);
scene.add(fillLight);

/* ---------- 内部场景定义 ---------- */
function biomeCfg(id, over) {
  return Object.assign({
    id, R: 500, halfLen: 400, seed: 1000 + id.length * 77,
    shellColor: '#0a1118', skyTop: '#0a2440', skyMid: '#3f83b8', skyNight: '#07111f',
    sunColor: 0xffe0a0, daySpeed: 0.16,
    ground: '#5c7147', hillColor: '#6d7a4e',
    water: null,
    treeColorA: '#c97a2e', treeColorB: '#a4b542', treeColorC: '#4f7a3a',
    treeCount: 220, treeScaleMin: 0.7, treeScaleMax: 1.7,
    buildingType: 'house', buildingColor: '#c9b18a', roofColor: '#7a4a3a',
    houseCount: 16, villageX0: -110, villageX1: 140,
  }, over);
}

function makeLocation(id, group, cam, target, opts) {
  return { id, group, cameraPos: new THREE.Vector3(...cam), target: new THREE.Vector3(...target), ...opts };
}

const locNova = biomeCfg('nova-scotia', {
  seed: 20240707, shellColor: '#0b1219', skyTop: '#0b2a4a', skyMid: '#4a8fc0', skyNight: '#081321',
  ground: '#5d7044', hillColor: '#6d7849',
  water: { color: '#2f6d8c', phi0: Math.PI - 0.17, phi1: Math.PI + 0.17, x0: -150, x1: 180 },
  treeColorA: '#c9792f', treeColorB: '#a9b84a', treeColorC: '#4e7b3b', treeCount: 260, treeScaleMax: 1.9,
  houseCount: 20,
});
const locMongolia = biomeCfg('mongolia', {
  seed: 303030, shellColor: '#0c131a', skyTop: '#0c2940', skyMid: '#5fa0c4', skyNight: '#0a1420',
  ground: '#c4a75e', hillColor: '#b09450', water: null,
  treeColorA: '#8a6b30', treeColorB: '#b7a052', treeColorC: '#6d5a2a', treeCount: 40, treeScaleMin: 0.6, treeScaleMax: 1.2,
  buildingType: 'yurt', buildingColor: '#e8e2d0', roofColor: '#c9b990', houseCount: 26,
  villageX0: -130, villageX1: 160,
});
const locLabrador = biomeCfg('labrador', {
  seed: 555777, shellColor: '#0b141d', skyTop: '#0a2336', skyMid: '#6fa4c4', skyNight: '#09131e',
  ground: '#dce8ef', hillColor: '#c2d3dc',
  water: { color: '#74b0c2', phi0: Math.PI - 0.16, phi1: Math.PI + 0.16, x0: -190, x1: 130 },
  treeColorA: '#2f5d48', treeColorB: '#3f7a5c', treeColorC: '#244e3e', treeCount: 150, treeScaleMin: 0.8, treeScaleMax: 1.6,
  buildingType: 'cube', buildingColor: '#dbe6ea', roofColor: '#8a3f35', houseCount: 18,
  villageX0: -150, villageX1: 170,
});
for (const cfg of [locNova, locMongolia, locLabrador]) {
  const group = buildBiomeChamber(cfg);
  if (cfg.id === 'labrador') {
    // 冰川末端墙
    const glacier = new THREE.Mesh(new THREE.BoxGeometry(60, 300, 700),
      new THREE.MeshStandardMaterial({ color: 0xcfeaf2, roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.92 }));
    glacier.position.set(-cfg.halfLen + 40, -170, 0);
    group.add(glacier);
    const glow = new THREE.Mesh(new THREE.BoxGeometry(61, 300, 700),
      new THREE.MeshBasicMaterial({ color: 0x9adcff, transparent: true, opacity: 0.06, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.position.copy(glacier.position);
    group.add(glow);
  }
  group.visible = false;
  interiorRoot.add(group);
}

const bridgeGroup = buildBridge();
const engineGroup = buildEngineRoom();
const spokeGroup = buildSpoke();
bridgeGroup.visible = engineGroup.visible = spokeGroup.visible = false;
interiorRoot.add(bridgeGroup, engineGroup, spokeGroup);

const LOCATIONS = {
  'nova-scotia': makeLocation('nova-scotia', null, [60, -355, 225], [300, -430, 0], {
    title: '生物圈 · 新斯科舍（Ring B）', desc: '温带落叶林生态舱：长池、秋色山林与「Fetch」小镇。太阳线沿穹顶自东向西移动，环线列车贴着舱底行驶。鼠标拖拽可 360° 观察舱壁、村镇与湖面。', minDist: 8, maxDist: 1800, near: 2, far: 60000, cfg: locNova,
  }),
  'mongolia': makeLocation('mongolia', null, [60, -355, -225], [300, -430, 0], {
    title: '生物圈 · 蒙古（Ring A）', desc: '旧世界干草原生态舱：金色草场与蒙古包聚落。小说中 Freya 的旅行从这里经过；舱顶太阳线、舱底农田与环形列车全部按文本还原。', minDist: 8, maxDist: 1800, near: 2, far: 60000, cfg: locMongolia,
  }),
  'labrador': makeLocation('labrador', null, [60, -355, 225], [260, -430, 0], {
    title: '生物圈 · 拉布拉多（Ring B）', desc: '泰加林、冰川与冰封盐湖生态舱。这里是小说中「五鬼」传说与驯鹿营地所在地，冰湖、彩屋和冰川裂谷均按文本意象重建。', minDist: 8, maxDist: 1800, near: 2, far: 60000, cfg: locLabrador,
  }),
  'bridge': makeLocation('bridge', bridgeGroup, [0, -6, 82], [0, 8, 0], {
    title: '脊柱 · 观测舰桥', desc: '位于 10 km 中央脊柱内：星图全息台显示天仓五系统，AI 核心悬停中央，四面星窗可望见深空与两座旋转的生物圈环。', minDist: 1.5, maxDist: 140, near: 0.4, far: 8000, animate: (t) => animateBridge(bridgeGroup.userData, t),
  }),
  'engine': makeLocation('engine', engineGroup, [0, 8, 84], [0, 6, 0], {
    title: '聚变引擎舱（脊柱）', desc: '惯性约束聚变反应堆与涡轮室：D/He3 燃料微丸每秒 2 发注入，反应堆脉冲发光，两台涡轮持续旋转——正是小说中让飞船以 0.005 g 减速二十年的心脏。', minDist: 1.5, maxDist: 150, near: 0.4, far: 8000, animate: (t) => animateEngineRoom(engineGroup.userData, t),
  }),
  'spoke': makeLocation('spoke', spokeGroup, [0.3, -42, 1.1], [0, 22, 0], {
    title: '六号辐条 · 六边形内环', desc: '小说中 Freya 与 Euan 攀爬的辐条：内壁螺旋梯、星光舷窗，顶部连接存放燃料的六边形内环舱室与十二道锁门。', minDist: 0.15, maxDist: 90, near: 0.05, far: 8000, animate: (t) => animateSpoke(spokeGroup.userData, t),
  }),
};
// interiorRoot 子顺序：三座生态舱、舰桥、引擎舱、辐条
const rootKids = interiorRoot.children;
LOCATIONS['nova-scotia'].group = rootKids[0];
LOCATIONS['mongolia'].group = rootKids[1];
LOCATIONS['labrador'].group = rootKids[2];
LOCATIONS['bridge'].group = rootKids[3];
LOCATIONS['engine'].group = rootKids[4];
LOCATIONS['spoke'].group = rootKids[5];

/* ---------- 模式切换 ---------- */
let mode = 'exterior';
let activeLoc = 'nova-scotia';

function updateModeButtons() {
  document.getElementById('btn-exterior').classList.toggle('active', mode === 'exterior');
  document.getElementById('btn-interior').classList.toggle('active', mode === 'interior');
  document.getElementById('locationbar').classList.toggle('visible', mode === 'interior');
}
function setInfo(title, desc) {
  document.getElementById('info-title').textContent = title;
  document.getElementById('info-desc').textContent = desc;
}
function showLocation(id) {
  activeLoc = id;
  const loc = LOCATIONS[id];
  for (const key in LOCATIONS) LOCATIONS[key].group.visible = (key === id);
  camera.near = loc.near; camera.far = loc.far;
  camera.updateProjectionMatrix();
  controls.minDistance = loc.minDist;
  controls.maxDistance = loc.maxDist;
  controls.target.copy(loc.target);
  camera.position.copy(loc.cameraPos);
  controls.update();
  setInfo(loc.title, loc.desc);
  document.querySelectorAll('#locationbar button').forEach(b => {
    b.classList.toggle('active', b.dataset.loc === id);
  });
}
function setMode(m) {
  mode = m;
  updateModeButtons();
  if (m === 'exterior') {
    ship.visible = true;
    interiorRoot.visible = false;
    camera.near = 10; camera.far = 180000;
    camera.updateProjectionMatrix();
    controls.minDistance = 500; controls.maxDistance = 90000;
    controls.target.set(0, 0, 0);
    camera.position.set(8000, 5200, 14500);
    controls.update();
    setInfo('外部全景 · 深空巡航', '鼠标左键拖拽 360° 旋转观察，滚轮缩放，右键平移。双环反向旋转；船艏聚变引擎正以每秒 2 次微型核爆减速，磁屏蔽场在船艏清空星际介质。');
  } else {
    ship.visible = false;
    interiorRoot.visible = true;
    showLocation(activeLoc);
  }
}

document.getElementById('btn-exterior').addEventListener('click', () => setMode('exterior'));
document.getElementById('btn-interior').addEventListener('click', () => setMode('interior'));
document.querySelectorAll('#locationbar button').forEach(b => {
  b.addEventListener('click', () => { setMode('interior'); showLocation(b.dataset.loc); });
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

/* ---------- 动画循环 ---------- */
const clock = new THREE.Clock();
let missionTime = 161.089;
let pulseTimer = 0;
let shipFlash = 0;

function animateExterior(dt, t) {
  ship.userData.ringA.rotation.z += ship.userData.ringA.userData.speed * dt;
  ship.userData.ringB.rotation.z += ship.userData.ringB.userData.speed * dt;
  const pulse = 0.6 + 0.4 * Math.sin(t * 0.8);
  for (const s of ship.userData.sunlines) s.material.opacity = 0.55 + pulse * 0.35;

  // 船艏聚变微爆：每秒 2 次
  pulseTimer += dt;
  shipFlash = Math.max(0, shipFlash - dt * 2.2);
  if (pulseTimer >= 0.5) {
    pulseTimer -= 0.5;
    shipFlash = 1;
    const bow = ship.userData.bow;
    bow.userData.light.intensity = 2600 * (0.7 + Math.random() * 0.6);
    bow.userData.rimMat.opacity = 0.55 + Math.random() * 0.45;
  }
  const bow = ship.userData.bow;
  const fl = bow.userData.flash;
  fl.material.opacity = shipFlash * 0.85;
  fl.scale.setScalar(2200 + shipFlash * 2400);
  bow.userData.light.intensity *= Math.max(0, 1 - dt * 3.2);

  // 航行灯
  ship.userData.navL.material.opacity = 0.4 + 0.6 * (Math.sin(t * 4.2) > 0 ? 1 : 0);
  ship.userData.navR.material.opacity = 0.4 + 0.6 * (Math.sin(t * 4.2 + Math.PI) > 0 ? 1 : 0);
  ship.userData.ringA.userData.speed = 0.025 + Math.sin(t * 0.13) * 0.004;
  ship.userData.ringB.userData.speed = -0.025 - Math.sin(t * 0.17) * 0.004;
  const stern = ship.children.find(c => c.userData && c.userData.beacon);
  if (stern) {
    stern.userData.beacon.material.opacity = 0.35 + 0.65 * (Math.sin(t * 2.8) > -0.2 ? 1 : 0.1);
    stern.userData.shuttle.position.y = 60 + Math.sin(t * 0.9) * 2.5;
  }

  // 星场相对运动（飞船向 -Z 前进，星点向 +Z 漂移）
  for (const pts of starfield.children) {
    if (!pts.isPoints) continue;
    const ud = pts.userData;
    const arr = pts.geometry.attributes.position.array;
    for (let i = 2; i < arr.length; i += 3) {
      arr[i] += ud.speed * dt;
      if (arr[i] > ud.rMax) arr[i] -= ud.rMax * 2;
    }
    pts.geometry.attributes.position.needsUpdate = true;
  }
  // 星云缓缓旋转
  for (const sp of starfield.children) {
    if (sp.isSprite && sp.userData.spin !== undefined) sp.material.rotation += sp.userData.spin * dt;
  }
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);
  const t = clock.elapsedTime;
  missionTime += dt * 0.0012; // 任务时钟缓慢推进
  document.getElementById('mission').textContent = missionTime.toFixed(3);

  if (mode === 'exterior') {
    animateExterior(dt, t);
  } else {
    const loc = LOCATIONS[activeLoc];
    if (loc.cfg) animateBiomeChamber(loc.cfg, t, dt);
    if (loc.animate) loc.animate(t);
  }
  controls.update();
  renderer.render(scene, camera);
}

/* ---------- 启动 ---------- */
setMode('exterior');
window.addEventListener('load', () => {
  setTimeout(() => document.getElementById('loading').classList.add('hide'), 350);
});
animate();

// 调试与自动化测试接口
window.__AURORA = { THREE, scene, camera, controls, ship, interiorRoot, starfield, LOCATIONS, setMode, showLocation,
  get mode() { return mode; }, get activeLoc() { return activeLoc; } };
