/* 3D 双时区腕表 · 3D Dual-Time Wristwatch
 * 依赖：vendor/three.min.js（全局 THREE）
 * 特性：真实时间驱动、平滑扫秒、时分秒三针、日期/星期双窗口、
 *       6 点位 24 小时第二时区小表盘、可交互轨道相机。
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------- 基础
  var canvas = document.getElementById('watch-canvas');
  var statusEl = document.getElementById('status');
  var renderer;

  function setStatus(text) {
    if (statusEl) { statusEl.textContent = text; }
  }

  function fatal(msg) {
    setStatus('启动失败：' + msg);
    if (document.body) {
      var p = document.createElement('div');
      p.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);color:#fff;' +
        'background:rgba(20,25,35,.9);padding:18px 24px;border-radius:12px;z-index:99;max-width:80vw;text-align:center';
      p.textContent = msg;
      document.body.appendChild(p);
    }
    throw new Error(msg);
  }

  if (typeof THREE === 'undefined') { fatal('未找到 Three.js，请确认 vendor/three.min.js 存在。'); }

  try {
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false });
  } catch (err) {
    fatal('无法创建 WebGL 渲染器：' + err.message);
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  var scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0e16);
  scene.fog = new THREE.Fog(0x0a0e16, 120, 300);

  var camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.5, 500);

  // ---------------------------------------------------------------- 材质
  var mat = {
    steelBrushed: new THREE.MeshStandardMaterial({ color: 0xd7dce3, metalness: 1.0, roughness: 0.32 }),
    steelPolished: new THREE.MeshStandardMaterial({ color: 0xeef2f7, metalness: 1.0, roughness: 0.14 }),
    steelDark: new THREE.MeshStandardMaterial({ color: 0x6a7380, metalness: 1.0, roughness: 0.45 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xf0c67c, metalness: 1.0, roughness: 0.24 }),
    dialBody: new THREE.MeshStandardMaterial({ color: 0x0d1320, metalness: 0.2, roughness: 0.85 }),
    hourHand: new THREE.MeshStandardMaterial({ color: 0xe9edf3, metalness: 1.0, roughness: 0.22 }),
    minuteHand: new THREE.MeshStandardMaterial({ color: 0xf4f7fb, metalness: 1.0, roughness: 0.18 }),
    secondHand: new THREE.MeshStandardMaterial({ color: 0xe8553f, metalness: 0.55, roughness: 0.30 }),
    subHourHand: new THREE.MeshStandardMaterial({ color: 0xf0c67c, metalness: 1.0, roughness: 0.26 }),
    subMinuteHand: new THREE.MeshStandardMaterial({ color: 0xf4f7fb, metalness: 1.0, roughness: 0.20 }),
    subSecondHand: new THREE.MeshStandardMaterial({ color: 0xe8553f, metalness: 0.55, roughness: 0.30 }),
    glass: new THREE.MeshStandardMaterial({
      color: 0xcfe0f2, metalness: 0.0, roughness: 0.04,
      transparent: true, opacity: 0.09, depthWrite: false, side: THREE.FrontSide,
    }),
  };

  function canvasTexture(cv, srgb) {
    var tex = new THREE.CanvasTexture(cv);
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    if (srgb) { tex.colorSpace = THREE.SRGBColorSpace; }
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return tex;
  }

  function makeCanvas(w, h) {
    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    return cv;
  }

  // ---------------------------------------------------------------- 环境反射
  function buildEnvironment() {
    var cv = makeCanvas(1024, 512);
    var g = cv.getContext('2d');
    var grad = g.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0.00, '#c9d6e8');
    grad.addColorStop(0.32, '#5f7189');
    grad.addColorStop(0.60, '#1c2432');
    grad.addColorStop(1.00, '#080b11');
    g.fillStyle = grad;
    g.fillRect(0, 0, 1024, 512);

    function blob(x, y, r, color) {
      var rg = g.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, color);
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = rg;
      g.fillRect(0, 0, 1024, 512);
    }
    blob(230, 95, 180, 'rgba(255,255,255,0.95)');
    blob(760, 130, 220, 'rgba(220,236,255,0.85)');
    blob(512, 70, 130, 'rgba(255,255,255,0.55)');
    blob(110, 360, 260, 'rgba(255,236,200,0.28)');

    var tex = new THREE.CanvasTexture(cv);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;

    var envScene = new THREE.Scene();
    var sphere = new THREE.Mesh(
      new THREE.SphereGeometry(60, 32, 16),
      new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide })
    );
    envScene.add(sphere);

    var pmrem = new THREE.PMREMGenerator(renderer);
    var rt = pmrem.fromScene(envScene, 0.035);
    scene.environment = rt.texture;
    pmrem.dispose();
    tex.dispose();
  }
  buildEnvironment();

  // ---------------------------------------------------------------- 灯光
  scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x0a0d14, 0.55));

  var keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
  keyLight.position.set(34, 42, 62);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.camera.near = 5;
  keyLight.shadow.camera.far = 180;
  keyLight.shadow.camera.left = -42;
  keyLight.shadow.camera.right = 42;
  keyLight.shadow.camera.top = 42;
  keyLight.shadow.camera.bottom = -42;
  keyLight.shadow.bias = -0.00025;
  keyLight.shadow.normalBias = 0.02;
  scene.add(keyLight);
  scene.add(keyLight.target);

  var fillLight = new THREE.DirectionalLight(0x9db8e8, 0.75);
  fillLight.position.set(-30, 18, 34);
  scene.add(fillLight);

  var rimLight = new THREE.DirectionalLight(0xffe2b0, 1.1);
  rimLight.position.set(0, 26, -40);
  scene.add(rimLight);

  // 背景投影幕布
  var backdrop = new THREE.Mesh(
    new THREE.PlaneGeometry(240, 170),
    new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.28 })
  );
  backdrop.position.z = -32;
  backdrop.receiveShadow = true;
  scene.add(backdrop);

  // ---------------------------------------------------------------- 时区工具
  var FALLBACK_ZONES = [
    'UTC', 'Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Tokyo', 'Asia/Singapore',
    'Asia/Dubai', 'Asia/Kolkata', 'Europe/London', 'Europe/Paris',
    'Europe/Berlin', 'Europe/Moscow', 'Africa/Cairo', 'America/New_York',
    'America/Chicago', 'America/Denver', 'America/Los_Angeles',
    'America/Sao_Paulo', 'Australia/Sydney', 'Pacific/Auckland',
  ];

  var MONTH_NAMES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  var fmtCache = Object.create(null);
  function formatterFor(zone) {
    if (!fmtCache[zone]) {
      fmtCache[zone] = new Intl.DateTimeFormat('en-GB', {
        timeZone: zone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      });
    }
    return fmtCache[zone];
  }

  function partsFor(zone, date) {
    var parts = formatterFor(zone).formatToParts(date);
    var out = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0, weekday: '', monthName: '' };
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      switch (p.type) {
        case 'year': out.year = parseInt(p.value, 10); break;
        case 'month': out.month = parseInt(p.value, 10); out.monthName = MONTH_NAMES[out.month - 1] || ''; break;
        case 'day': out.day = parseInt(p.value, 10); out.dayText = p.value; break;
        case 'weekday': out.weekday = p.value.toUpperCase(); break;
        case 'hour': out.hour = parseInt(p.value, 10) % 24; break;
        case 'minute': out.minute = parseInt(p.value, 10); break;
        case 'second': out.second = parseInt(p.value, 10); break;
      }
    }
    return out;
  }

  // 每 200ms 重新读取一次墙钟时间，帧间用毫秒增量平滑插值。
  // baseSec 记录“捕获瞬间”的真实墙钟秒数（整数秒 + 当前毫秒），
  // 从而在缓存刷新时不会出现秒针回跳。
  var wallCache = Object.create(null);
  function getWall(zone, nowMs) {
    var c = wallCache[zone];
    if (c && nowMs - c.capturedAtMs < 200) { return c; }
    var capturedAtMs = Date.now();
    var parts = partsFor(zone, new Date(capturedAtMs));
    c = {
      zone: zone,
      capturedAtMs: capturedAtMs,
      parts: parts,
      baseSec: parts.second + (capturedAtMs % 1000) / 1000,
    };
    wallCache[zone] = c;
    return c;
  }

  function smoothClock(zone, nowMs) {
    var c = getWall(zone, nowMs);
    var elapsed = Math.max(0, nowMs - c.capturedAtMs);
    var sec = c.baseSec + elapsed / 1000;
    var minute = c.parts.minute + sec / 60;
    var hour = c.parts.hour + minute / 60;
    return { parts: c.parts, sec: sec, minute: minute, hour: hour, ms: (sec % 1) * 1000 };
  }

  function tzOffsetMinutes(zone, nowMs) {
    var p = partsFor(zone, new Date(nowMs));
    var wallAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    var roundedNow = Math.floor(nowMs / 1000) * 1000;
    return Math.round((wallAsUtc - roundedNow) / 60000);
  }

  function offsetLabel(zone, nowMs) {
    var min = tzOffsetMinutes(zone, nowMs || Date.now());
    var sign = min < 0 ? '-' : '+';
    var abs = Math.abs(min);
    var hh = ('0' + Math.floor(abs / 60)).slice(-2);
    var mm = ('0' + (abs % 60)).slice(-2);
    return 'UTC' + sign + hh + ':' + mm;
  }

  function shortZoneName(zone) {
    if (!zone) { return 'LOCAL'; }
    if (zone === 'UTC') { return 'UTC'; }
    var name = zone.split('/').pop().replace(/_/g, ' ').toUpperCase();
    return name.length > 13 ? name.slice(0, 12) + '…' : name;
  }

  // ---------------------------------------------------------------- 表盘贴图
  var DIAL_RADIUS = 16.2;
  var DIAL_SCALE = 512 / DIAL_RADIUS; // 1024 贴图中每单位像素数

  function makeDialTexture() {
    var cv = makeCanvas(1024, 1024);
    var g = cv.getContext('2d');
    var cx = 512, cy = 512;

    var grad = g.createRadialGradient(cx, cy, 40, cx, cy, 520);
    grad.addColorStop(0.00, '#26314a');
    grad.addColorStop(0.38, '#151c2e');
    grad.addColorStop(0.80, '#0a0f1a');
    grad.addColorStop(1.00, '#05080f');
    g.fillStyle = grad;
    g.fillRect(0, 0, 1024, 1024);

    // 太阳纹
    g.save();
    g.translate(cx, cy);
    for (var r = 0; r < 360; r += 6) {
      g.strokeStyle = r % 30 === 0 ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.018)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(Math.sin(r * Math.PI / 180) * 510, -Math.cos(r * Math.PI / 180) * 510);
      g.stroke();
    }
    g.restore();

    // 分钟刻度环
    function px(a, radius) { return cx + Math.sin(a) * radius; }
    function py(a, radius) { return cy - Math.cos(a) * radius; }
    for (var m = 0; m < 60; m++) {
      var a = m * Math.PI / 30;
      var major = m % 5 === 0;
      g.strokeStyle = major ? 'rgba(232,238,248,0.95)' : 'rgba(190,202,222,0.55)';
      g.lineWidth = major ? 8 : 3.2;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(px(a, major ? 484 : 498), py(a, major ? 484 : 498));
      g.lineTo(px(a, major ? 446 : 470), py(a, major ? 446 : 470));
      g.stroke();
    }

    // 12 点数字
    g.fillStyle = 'rgba(240,244,252,0.96)';
    g.font = '600 118px "SF Pro Display","Helvetica Neue",Arial,sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('12', cx, cy - 338);

    // 品牌文字
    g.fillStyle = 'rgba(214,224,240,0.92)';
    g.font = '600 54px "SF Pro Display","Helvetica Neue",Arial,sans-serif';
    g.fillText('CHRONO DUAL', cx, cy - 196);
    g.fillStyle = 'rgba(150,164,186,0.72)';
    g.font = '500 25px "SF Pro Display","Helvetica Neue",Arial,sans-serif';
    g.fillText('A U T O M A T I C', cx, cy - 132);

    // 日期窗口标签
    g.fillStyle = 'rgba(240,196,124,0.95)';
    g.font = '600 30px "SF Pro Display","Helvetica Neue",Arial,sans-serif';
    g.textAlign = 'center';
    g.fillText('TZ1', cx + DIAL_SCALE * 10.2, cy - 78);
    g.fillStyle = 'rgba(142,220,255,0.95)';
    g.fillText('TZ2', cx - DIAL_SCALE * 10.2, cy - 78);

    // 底部小字
    g.fillStyle = 'rgba(150,164,186,0.55)';
    g.font = '500 22px "SF Pro Display","Helvetica Neue",Arial,sans-serif';
    g.fillText('SWISS MADE', cx, cy + 480);

    return canvasTexture(cv, true);
  }

  function makeSubdialTexture() {
    var cv = makeCanvas(512, 512);
    var g = cv.getContext('2d');
    var cx = 256, cy = 256;

    var grad = g.createRadialGradient(cx, cy, 12, cx, cy, 256);
    grad.addColorStop(0.00, '#182234');
    grad.addColorStop(0.62, '#0b101c');
    grad.addColorStop(1.00, '#04060b');
    g.fillStyle = grad;
    g.fillRect(0, 0, 512, 512);

    function px(a, radius) { return cx + Math.sin(a) * radius; }
    function py(a, radius) { return cy - Math.cos(a) * radius; }

    // 60 分钟内圈刻度
    for (var m = 0; m < 60; m++) {
      var am = m * Math.PI / 30;
      g.strokeStyle = m % 5 === 0 ? 'rgba(216,226,240,0.85)' : 'rgba(150,164,186,0.4)';
      g.lineWidth = m % 5 === 0 ? 4 : 2;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(px(am, 180), py(am, 180));
      g.lineTo(px(am, 170), py(am, 170));
      g.stroke();
    }

    // 24 小时外圈刻度 + 数字
    for (var h = 0; h < 24; h++) {
      var a = h * Math.PI / 12;
      var major = h % 6 === 0;
      g.strokeStyle = major ? 'rgba(240,196,124,0.95)' : 'rgba(210,220,238,0.6)';
      g.lineWidth = major ? 6 : 3;
      g.beginPath();
      g.moveTo(px(a, 230), py(a, 230));
      g.lineTo(px(a, major ? 202 : 214), py(a, major ? 202 : 214));
      g.stroke();
      if (major) {
        g.fillStyle = 'rgba(240,196,124,0.95)';
        g.font = '600 34px "SF Pro Display","Helvetica Neue",Arial,sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(h === 0 ? '24' : String(h), px(a, 174), py(a, 174));
      }
    }

    g.fillStyle = 'rgba(142,220,255,0.8)';
    g.font = '600 22px "SF Pro Display","Helvetica Neue",Arial,sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('24H', cx, cy);

    return canvasTexture(cv, true);
  }

  function makeDateTexture(parts, zone, secondary) {
    var cv = makeCanvas(512, 256);
    var g = cv.getContext('2d');

    g.fillStyle = '#f6f2e7';
    g.fillRect(0, 0, 512, 256);
    g.strokeStyle = secondary ? 'rgba(111,211,255,0.7)' : 'rgba(232,182,76,0.75)';
    g.lineWidth = 6;
    g.strokeRect(8, 8, 496, 240);

    g.fillStyle = '#1b2230';
    g.textBaseline = 'middle';

    // 大日期
    g.textAlign = 'left';
    g.font = '700 150px "SF Pro Display","Helvetica Neue",Arial,sans-serif';
    g.fillText(parts.dayText || ('0' + parts.day).slice(-2), 26, 150);

    // 右侧信息
    g.textAlign = 'left';
    g.fillStyle = '#8a6d3b';
    g.font = '600 26px "SF Pro Display","Helvetica Neue",Arial,sans-serif';
    g.fillText(shortZoneName(zone), 236, 48);

    g.fillStyle = '#1b2230';
    g.font = '700 78px "SF Pro Display","Helvetica Neue",Arial,sans-serif';
    g.fillText(parts.weekday || '---', 232, 128);

    g.fillStyle = '#3d4656';
    g.font = '600 40px "SF Pro Display","Helvetica Neue",Arial,sans-serif';
    var monthLine = parts.monthName || '';
    if (secondary) {
      monthLine += '  ' + (parts.hour >= 12 ? 'PM' : 'AM');
    }
    g.fillText(monthLine, 236, 202);

    var tex = canvasTexture(cv, true);
    return tex;
  }

  // ---------------------------------------------------------------- 几何构建
  function makeHandShape(length, tail, halfWidth, tipHalf) {
    var s = new THREE.Shape();
    s.moveTo(0, length);
    s.lineTo(tipHalf, length - 1.35);
    s.lineTo(halfWidth, length * 0.34);
    s.lineTo(halfWidth, -tail);
    s.lineTo(-halfWidth, -tail);
    s.lineTo(-halfWidth, length * 0.34);
    s.lineTo(-tipHalf, length - 1.35);
    s.closePath();
    return s;
  }

  function handMesh(opts) {
    var shape = makeHandShape(opts.length, opts.tail, opts.halfWidth, opts.tipHalf);
    var geo = new THREE.ExtrudeGeometry(shape, {
      depth: opts.depth,
      bevelEnabled: true,
      bevelThickness: 0.05,
      bevelSize: 0.05,
      bevelSegments: 2,
      curveSegments: 28,
    });
    geo.translate(0, 0, -opts.depth / 2);
    var mesh = new THREE.Mesh(geo, opts.material);
    mesh.castShadow = true;
    return mesh;
  }

  function hub(radius, depth, material, z) {
    var geo = new THREE.CylinderGeometry(radius, radius, depth, 48);
    geo.rotateX(Math.PI / 2);
    var mesh = new THREE.Mesh(geo, material);
    mesh.position.z = z;
    mesh.castShadow = true;
    return mesh;
  }

  function buildWatch() {
    var root = new THREE.Group();
    root.name = 'watch';

    // ---- 不锈钢表壳（车削截面）----
    var caseProfile = [
      new THREE.Vector2(0.001, -5.8),
      new THREE.Vector2(9.0, -5.8),
      new THREE.Vector2(14.8, -5.55),
      new THREE.Vector2(19.2, -4.9),
      new THREE.Vector2(21.0, -3.7),
      new THREE.Vector2(21.9, -1.8),
      new THREE.Vector2(22.1, 0.6),
      new THREE.Vector2(21.6, 2.7),
      new THREE.Vector2(20.2, 4.3),
      new THREE.Vector2(19.1, 5.1),
      new THREE.Vector2(18.7, 5.35),
      new THREE.Vector2(16.3, 5.35),
      new THREE.Vector2(16.3, 5.05),
    ];
    var caseGeo = new THREE.LatheGeometry(caseProfile, 128);
    caseGeo.rotateX(Math.PI / 2);
    var watchCase = new THREE.Mesh(caseGeo, mat.steelBrushed);
    watchCase.castShadow = true;
    watchCase.receiveShadow = true;
    root.add(watchCase);

    // 表圈
    var bezel = new THREE.Mesh(new THREE.TorusGeometry(17.6, 1.15, 24, 128), mat.steelPolished);
    bezel.position.z = 5.35;
    bezel.castShadow = true;
    root.add(bezel);

    // 表盘背板 + 表盘贴图
    var dialBack = new THREE.Mesh(new THREE.CylinderGeometry(16.05, 16.05, 1.3, 96), mat.dialBody);
    dialBack.geometry.rotateX(Math.PI / 2);
    dialBack.position.z = 4.35;
    dialBack.receiveShadow = true;
    root.add(dialBack);

    var dialFace = new THREE.Mesh(
      new THREE.CircleGeometry(DIAL_RADIUS, 128),
      new THREE.MeshBasicMaterial({ map: makeDialTexture() })
    );
    dialFace.position.z = 5.12;
    dialFace.receiveShadow = true;
    root.add(dialFace);

    // ---- 3D 时标 ----
    var indices = root;
    var skipped = { 3: true, 6: true, 9: true };
    for (var h = 0; h < 12; h++) {
      if (skipped[h]) { continue; }
      var isQuarter = (h === 0);
      var w = isQuarter ? 1.7 : 1.05;
      var len = isQuarter ? 3.1 : 2.4;
      var dep = 0.55;
      var marker = new THREE.Mesh(
        new THREE.BoxGeometry(w, len, dep),
        isQuarter ? mat.gold : mat.steelPolished
      );
      var ang = h * Math.PI / 6;
      marker.position.set(Math.sin(ang) * 13.15, Math.cos(ang) * 13.15, 5.42);
      marker.rotation.z = -ang;
      marker.castShadow = true;
      indices.add(marker);
    }

    // ---- 主表盘指针（锚点在原点，绕 Z 轴旋转）----
    var mainHands = {
      hour: handMesh({ length: 10.7, tail: 2.1, halfWidth: 1.15, tipHalf: 0.22, depth: 0.48, material: mat.hourHand }),
      minute: handMesh({ length: 14.7, tail: 2.4, halfWidth: 0.78, tipHalf: 0.16, depth: 0.4, material: mat.minuteHand }),
      second: handMesh({ length: 15.9, tail: 3.6, halfWidth: 0.14, tipHalf: 0.07, depth: 0.26, material: mat.secondHand }),
    };
    mainHands.hour.position.z = 5.66;
    mainHands.minute.position.z = 5.84;
    mainHands.second.position.z = 6.02;

    // 秒针尾配重（作为秒针子对象，随秒针一起旋转）
    var counter = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.34, 24), mat.steelPolished);
    counter.geometry.rotateX(Math.PI / 2);
    counter.position.set(0, -2.3, 0);
    counter.castShadow = true;
    mainHands.second.add(counter);

    root.add(mainHands.hour, mainHands.minute, mainHands.second);
    root.userData.mainHands = mainHands;

    root.add(hub(1.45, 0.72, mat.steelPolished, 5.98));
    root.add(hub(0.88, 0.5, mat.steelPolished, 6.14));
    root.add(hub(0.42, 0.4, mat.gold, 6.3));

    // ---- 蓝宝石玻璃表镜（浅球冠）----
    var crystalGeo = new THREE.SphereGeometry(48, 128, 64, 0, Math.PI * 2, 0, 0.35);
    crystalGeo.rotateX(Math.PI / 2);
    var crystal = new THREE.Mesh(crystalGeo, mat.glass);
    crystal.position.z = 5.28;
    root.add(crystal);

    // ---- 日期/星期窗口（TZ1 右侧，TZ2 左侧）----
    function makeWindow(x, tex, accent) {
      var grp = new THREE.Group();
      grp.position.set(x, 0, 0);

      var card = new THREE.Mesh(
        new THREE.PlaneGeometry(6.4, 2.5),
        new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })
      );
      card.position.z = 5.34;
      grp.add(card);

      var frameMat = accent === 'blue' ? mat.steelPolished : mat.gold;
      var bw = 6.7, bh = 2.8, bd = 0.34, bt = 0.22;
      var top = new THREE.Mesh(new THREE.BoxGeometry(bw, bt, bd), frameMat);
      top.position.z = 5.52;
      var bottom = top.clone();
      var left = new THREE.Mesh(new THREE.BoxGeometry(bt, bh, bd), frameMat);
      left.position.z = 5.52;
      var right = left.clone();
      top.position.y = bh / 2 - bt / 2;
      bottom.position.y = -(bh / 2 - bt / 2);
      left.position.x = -(bw / 2 - bt / 2);
      right.position.x = bw / 2 - bt / 2;
      grp.add(top, bottom, left, right);
      grp.traverse(function (o) { if (o.isMesh) { o.castShadow = true; } });
      return grp;
    }
    var windowTz1 = makeWindow(10.2, makeDateTexture({ day: 1, dayText: '01', weekday: 'MON', monthName: 'JAN' }, 'LOCAL', false), 'gold');
    var windowTz2 = makeWindow(-10.2, makeDateTexture({ day: 1, dayText: '01', weekday: 'MON', monthName: 'JAN' }, 'UTC', true), 'blue');
    root.add(windowTz1, windowTz2);
    root.userData.windows = { tz1: windowTz1, tz2: windowTz2 };

    // ---- 第二时区 24 小时小表盘 ----
    var sub = new THREE.Group();
    sub.position.set(0, -7.35, 0);

    var subBack = new THREE.Mesh(
      new THREE.CircleGeometry(5.5, 96),
      new THREE.MeshBasicMaterial({ map: makeSubdialTexture() })
    );
    subBack.position.z = 5.16;
    sub.add(subBack);

    var subRing = new THREE.Mesh(new THREE.TorusGeometry(5.5, 0.24, 16, 96), mat.steelPolished);
    subRing.position.z = 5.44;
    subRing.castShadow = true;
    sub.add(subRing);

    var subHands = {
      hour: handMesh({ length: 3.3, tail: 0.7, halfWidth: 0.4, tipHalf: 0.08, depth: 0.22, material: mat.subHourHand }),
      minute: handMesh({ length: 4.75, tail: 0.8, halfWidth: 0.24, tipHalf: 0.05, depth: 0.18, material: mat.subMinuteHand }),
      second: handMesh({ length: 5.0, tail: 1.1, halfWidth: 0.06, tipHalf: 0.03, depth: 0.12, material: mat.subSecondHand }),
    };
    subHands.hour.position.z = 5.52;
    subHands.minute.position.z = 5.66;
    subHands.second.position.z = 5.8;
    sub.add(subHands.hour, subHands.minute, subHands.second);
    sub.add(hub(0.52, 0.36, mat.steelPolished, 5.78));
    root.add(sub);
    root.userData.subHands = subHands;

    // ---- 表冠 ----
    var crownGroup = new THREE.Group();
    var crownBody = new THREE.Mesh(new THREE.CylinderGeometry(3.1, 3.1, 4.6, 48), mat.steelBrushed);
    crownBody.geometry.rotateZ(Math.PI / 2);
    crownBody.position.set(24.6, 0, 0);
    crownBody.castShadow = true;
    crownGroup.add(crownBody);
    for (var gi = 0; gi < 4; gi++) {
      var groove = new THREE.Mesh(new THREE.CylinderGeometry(3.28, 3.28, 0.55, 48), mat.steelDark);
      groove.geometry.rotateZ(Math.PI / 2);
      groove.position.set(23.0 + gi * 1.05, 0, 0);
      crownGroup.add(groove);
    }
    var crownCap = new THREE.Mesh(new THREE.CylinderGeometry(3.45, 3.45, 1.1, 48), mat.steelPolished);
    crownCap.geometry.rotateZ(Math.PI / 2);
    crownCap.position.set(26.0, 0, 0);
    crownCap.castShadow = true;
    crownGroup.add(crownCap);
    root.add(crownGroup);

    // ---- 表耳 ----
    var lugGeo = new THREE.BoxGeometry(3.0, 4.6, 2.9);
    [[-7.4, 22.6], [7.4, 22.6], [-7.4, -22.6], [7.4, -22.6]].forEach(function (p) {
      var lug = new THREE.Mesh(lugGeo, mat.steelBrushed);
      lug.position.set(p[0], p[1], -2.1);
      lug.castShadow = true;
      root.add(lug);
    });

    // ---- 不锈钢链带 ----
    var strap = new THREE.Group();
    for (var i = 0; i < 9; i++) {
      var link = new THREE.Mesh(new THREE.BoxGeometry(12.2, 2.75, 2.1), i % 2 === 0 ? mat.steelBrushed : mat.steelPolished);
      link.position.set(0, 22.6 + i * 2.9, -3.6 - i * 0.52);
      link.rotation.x = (i % 2 === 0 ? 0.03 : -0.03);
      link.castShadow = true;
      strap.add(link);

      var linkB = link.clone();
      linkB.position.y = -link.position.y;
      linkB.rotation.x = -link.rotation.x;
      strap.add(linkB);
    }
    var claspGeo = new THREE.BoxGeometry(14.4, 3.6, 2.8);
    [1, -1].forEach(function (s) {
      var clasp = new THREE.Mesh(claspGeo, mat.steelPolished);
      clasp.position.set(0, s * 49.8, -8.4);
      clasp.castShadow = true;
      strap.add(clasp);
    });
    root.add(strap);

    return root;
  }

  var watch = buildWatch();
  scene.add(watch);

  // ---------------------------------------------------------------- 时区选择 UI
  var localZone = (Intl.DateTimeFormat().resolvedOptions() || {}).timeZone || 'UTC';
  var tz1Zone = localZone;
  var tz2Zone = 'UTC';

  var CURATED = [
    ['本地时间', localZone],
    ['UTC 协调世界时', 'UTC'],
    ['北京 · 中国', 'Asia/Shanghai'],
    ['香港 · 中国', 'Asia/Hong_Kong'],
    ['东京 · 日本', 'Asia/Tokyo'],
    ['新加坡', 'Asia/Singapore'],
    ['迪拜 · 阿联酋', 'Asia/Dubai'],
    ['伦敦 · 英国', 'Europe/London'],
    ['巴黎 · 法国', 'Europe/Paris'],
    ['柏林 · 德国', 'Europe/Berlin'],
    ['纽约 · 美国', 'America/New_York'],
    ['洛杉矶 · 美国', 'America/Los_Angeles'],
    ['芝加哥 · 美国', 'America/Chicago'],
    ['悉尼 · 澳大利亚', 'Australia/Sydney'],
    ['奥克兰 · 新西兰', 'Pacific/Auckland'],
  ];

  function allZones() {
    if (typeof Intl.supportedValuesOf === 'function') {
      try {
        var zones = Intl.supportedValuesOf('timeZone');
        if (zones && zones.length) { return zones; }
      } catch (e) { /* 忽略并回退 */ }
    }
    return FALLBACK_ZONES;
  }

  function populateSelect(sel, zones, extra) {
    var seen = Object.create(null);
    function add(zone, label, group) {
      if (!zone || seen[zone]) { return; }
      seen[zone] = true;
      var opt = document.createElement('option');
      opt.value = zone;
      opt.textContent = (label || zone) + ' · ' + offsetLabel(zone);
      group.appendChild(opt);
    }
    var g1 = document.createElement('optgroup');
    g1.label = '常用时区';
    sel.appendChild(g1);
    CURATED.forEach(function (c) { add(c[1], c[0], g1); });
    if (extra && extra.length) {
      var g2 = document.createElement('optgroup');
      g2.label = '全部 IANA 时区';
      sel.appendChild(g2);
      var nowMs = Date.now();
      extra.slice().map(function (zone) {
        return { zone: zone, offset: tzOffsetMinutes(zone, nowMs) };
      }).sort(function (a, b) {
        return a.offset !== b.offset ? a.offset - b.offset : (a.zone < b.zone ? -1 : 1);
      }).forEach(function (item) { add(item.zone, item.zone.replace('_', ' '), g2); });
    }
  }

  var sel1 = document.getElementById('tz1-select');
  var sel2 = document.getElementById('tz2-select');
  var zones = allZones();
  var extraZones = zones.filter(function (z) { return !CURATED.some(function (c) { return c[1] === z; }); });
  populateSelect(sel1, zones, extraZones);
  populateSelect(sel2, zones, extraZones);
  sel1.value = tz1Zone;
  sel2.value = tz2Zone;

  sel1.addEventListener('change', function () {
    tz1Zone = sel1.value;
    wallCache[tz1Zone] = null;
  });
  sel2.addEventListener('change', function () {
    tz2Zone = sel2.value;
    wallCache[tz2Zone] = null;
  });

  // ---------------------------------------------------------------- 相机交互
  var sph = { theta: 0.55, phi: 1.12, radius: 78, targetTheta: 0.55, targetPhi: 1.12, targetRadius: 78 };
  var autoRotate = true;
  var dragging = false;
  var pointerId = null;
  var lastX = 0, lastY = 0;

  function applyCamera() {
    var r = sph.radius, t = sph.theta, p = sph.phi;
    camera.position.set(
      r * Math.sin(p) * Math.sin(t),
      r * Math.cos(p),
      r * Math.sin(p) * Math.cos(t)
    );
    camera.lookAt(0, 0, 0);
  }
  applyCamera();

  canvas.addEventListener('pointerdown', function (e) {
    dragging = true;
    pointerId = e.pointerId;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.classList.add('dragging');
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!dragging || e.pointerId !== pointerId) { return; }
    var dx = e.clientX - lastX;
    var dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    sph.theta -= dx * 0.006;
    sph.phi = Math.min(1.52, Math.max(0.28, sph.phi - dy * 0.005));
  });
  function endDrag(e) {
    if (e.pointerId !== pointerId) { return; }
    dragging = false;
    pointerId = null;
    canvas.classList.remove('dragging');
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    sph.radius = Math.min(120, Math.max(46, sph.radius * (1 + e.deltaY * 0.0011)));
  }, { passive: false });
  canvas.addEventListener('dblclick', function () {
    sph.theta = 0.55; sph.phi = 1.12; sph.radius = 78;
  });

  document.getElementById('auto-rotate').addEventListener('change', function (e) {
    autoRotate = e.target.checked;
  });
  document.getElementById('reset-view').addEventListener('click', function () {
    sph.theta = 0.55; sph.phi = 1.12; sph.radius = 78;
  });

  window.addEventListener('resize', function () {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // ---------------------------------------------------------------- 指针动画
  var HOUR_TO_RAD = Math.PI / 6;
  function clockAngle(hourFraction) {
    return -hourFraction * Math.PI * 2;
  }

  function setMainHands(clock) {
    mainHandRef.hour.rotation.z = clockAngle(clock.hour / 12);
    mainHandRef.minute.rotation.z = clockAngle(clock.minute / 60);
    mainHandRef.second.rotation.z = clockAngle(clock.sec / 60);
  }

  function setSubHands(clock) {
    subHandRef.hour.rotation.z = clockAngle(clock.hour / 24);
    subHandRef.minute.rotation.z = clockAngle(clock.minute / 60);
    subHandRef.second.rotation.z = clockAngle(clock.sec / 60);
  }

  var mainHandRef = watch.userData.mainHands;
  var subHandRef = watch.userData.subHands;

  // ---------------------------------------------------------------- UI 数字时钟
  var elTz1Time = document.getElementById('tz1-time');
  var elTz1Ms = document.getElementById('tz1-ms');
  var elTz1Date = document.getElementById('tz1-date');
  var elTz2Time = document.getElementById('tz2-time');
  var elTz2Ms = document.getElementById('tz2-ms');
  var elTz2Date = document.getElementById('tz2-date');

  function pad2(n) { return ('0' + Math.floor(n)).slice(-2); }
  function dateKey(p) { return p.year + '-' + p.month + '-' + p.day + '-' + p.weekday; }

  var lastUiUpdate = 0;
  var lastWindowKey1 = '', lastWindowKey2 = '';

  function updateUi(nowMs) {
    var c1 = smoothClock(tz1Zone, nowMs);
    var c2 = smoothClock(tz2Zone, nowMs);

    // 3D 日期窗口只在跨日/切换时区时重绘
    var key1 = tz1Zone + '|' + dateKey(c1.parts);
    if (key1 !== lastWindowKey1) {
      lastWindowKey1 = key1;
      var card1 = watch.userData.windows.tz1.children[0];
      card1.material.map.dispose();
      card1.material.map = makeDateTexture(c1.parts, tz1Zone, false);
      card1.material.needsUpdate = true;
    }
    var key2 = tz2Zone + '|' + dateKey(c2.parts) + '|' + (c2.parts.hour >= 12 ? 1 : 0);
    if (key2 !== lastWindowKey2) {
      lastWindowKey2 = key2;
      var card2 = watch.userData.windows.tz2.children[0];
      card2.material.map.dispose();
      card2.material.map = makeDateTexture(c2.parts, tz2Zone, true);
      card2.material.needsUpdate = true;
    }

    if (nowMs - lastUiUpdate > 80) {
      lastUiUpdate = nowMs;
      elTz1Time.textContent = pad2(c1.hour) + ':' + pad2(c1.minute) + ':' + pad2(c1.sec);
      elTz1Ms.textContent = '.' + ('0' + Math.floor((c1.sec % 1) * 100)).slice(-2);
      elTz1Date.textContent = c1.parts.year + ' 年 ' + c1.parts.month + ' 月 ' + c1.parts.day + ' 日 · ' + c1.parts.weekday +
        ' · ' + offsetLabel(tz1Zone, nowMs);
      elTz2Time.textContent = pad2(c2.hour) + ':' + pad2(c2.minute) + ':' + pad2(c2.sec);
      elTz2Ms.textContent = '.' + ('0' + Math.floor((c2.sec % 1) * 100)).slice(-2);
      elTz2Date.textContent = c2.parts.year + ' 年 ' + c2.parts.month + ' 月 ' + c2.parts.day + ' 日 · ' + c2.parts.weekday +
        ' · ' + offsetLabel(tz2Zone, nowMs);
    }

    setMainHands(c1);
    setSubHands(c2);
  }

  // ---------------------------------------------------------------- 渲染循环
  var lastFrame = performance.now();
  var fpsFrames = 0, fpsTime = 0;

  function frame(now) {
    var nowMs = Date.now();
    var dt = Math.min(0.06, (now - lastFrame) / 1000);
    lastFrame = now;

    if (autoRotate && !dragging) {
      sph.theta += dt * 0.14;
    }
    applyCamera();

    try {
      updateUi(nowMs);
      renderer.render(scene, camera);
    } catch (err) {
      setStatus('渲染错误：' + err.message);
      console.error(err);
    }

    fpsFrames++;
    fpsTime += dt;
    if (fpsTime >= 0.8) {
      var fps = Math.round(fpsFrames / fpsTime);
      setStatus('WebGL · ' + fps + ' FPS · 拖拽旋转 / 滚轮缩放');
      fpsFrames = 0; fpsTime = 0;
    }

    requestAnimationFrame(frame);
  }

  setStatus('3D 双时区腕表已启动');
  requestAnimationFrame(frame);

  // 供自动化测试/调试使用的只读快照接口
  window.__watchDebug = {
    zones: function () { return { tz1: tz1Zone, tz2: tz2Zone }; },
    handAngles: function () {
      return {
        main: {
          hour: mainHandRef.hour.rotation.z,
          minute: mainHandRef.minute.rotation.z,
          second: mainHandRef.second.rotation.z,
        },
        sub: {
          hour: subHandRef.hour.rotation.z,
          minute: subHandRef.minute.rotation.z,
          second: subHandRef.second.rotation.z,
        },
      };
    },
    clock: function () {
      var nowMs = Date.now();
      return {
        tz1: smoothClock(tz1Zone, nowMs),
        tz2: smoothClock(tz2Zone, nowMs),
      };
    },
    windowInfo: function () {
      function sample(grp) {
        var card = grp.children[0];
        var cv = card.material.map.image;
        var data = cv.getContext('2d').getImageData(8, 8, 1, 1).data;
        return {
          pos: card.getWorldPosition(new THREE.Vector3()).toArray(),
          textureTopLeft: Array.prototype.slice.call(data, 0, 4),
        };
      }
      return { tz1: sample(watch.userData.windows.tz1), tz2: sample(watch.userData.windows.tz2) };
    },
  };
})();
