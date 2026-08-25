/* 弓箭射击模拟游戏
 * 纯逻辑部分（物理、碰撞、排行榜排序等）可在 Node.js 中直接 require 进行单元测试；
 * 在浏览器中会自动挂载 window.ArcheryGame 并初始化游戏。
 */
(function (global) {
  'use strict';

  const CONFIG = Object.freeze({
    WIDTH: 960,
    HEIGHT: 600,
    GROUND_Y: 535,
    BOW_X: 170,
    BOW_Y: 478,
    ARROW_LEN: 54,
    GRAVITY: 600,          // px / s^2
    MIN_SPEED: 520,        // 最小初速 px / s
    EXTRA_SPEED: 680,      // 满蓄力额外初速
    MAX_CHARGE: 1.5,       // 满蓄力所需秒数
    MAX_ARROWS: 80,        // 场上最多箭矢数
    MAX_LEADERBOARD: 10,
    LEADERBOARD_KEY: 'archery-shooting-leaderboard-v1',
    // 四个固定靶位，保证每次开局条件一致，排行榜公平
    TARGETS: Object.freeze([
      Object.freeze({ x: 380, y: 245, r: 34 }),
      Object.freeze({ x: 610, y: 330, r: 40 }),
      Object.freeze({ x: 805, y: 180, r: 28 }),
      Object.freeze({ x: 500, y: 118, r: 24 }),
    ]),
  });

  function clamp(value, min, max) {
    return value < min ? min : (value > max ? max : value);
  }

  function pointInTarget(px, py, target) {
    const dx = px - target.x;
    const dy = py - target.y;
    return dx * dx + dy * dy <= target.r * target.r;
  }

  // 根据瞄点和蓄力值计算箭矢初速度
  function computeShot(origin, aim, power, cfg = CONFIG) {
    const dx = aim.x - origin.x;
    const dy = aim.y - origin.y;
    const dist = Math.hypot(dx, dy);
    const angle = dist > 1e-6 ? Math.atan2(dy, dx) : 0;
    const p = clamp(Number(power) || 0, 0, 1);
    const speed = cfg.MIN_SPEED + p * cfg.EXTRA_SPEED;
    return {
      angle: angle,
      speed: speed,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
    };
  }

  function createState(cfg = CONFIG) {
    return {
      targets: cfg.TARGETS.map((t, i) => ({
        id: i,
        x: t.x,
        y: t.y,
        r: t.r,
        hit: false,
        stickArrow: null,
      })),
      arrows: [],
      shots: 0,           // 射出的箭数
      timerRunning: false, // 第一箭射出后开始计时
      elapsed: 0,          // 当前用时（秒）
      finalTime: null,     // 完成时的总用时
      finished: false,
    };
  }

  // 物理步进：重力、靶子命中、落地、出界清理、通关判定
  function stepPhysics(state, dt, cfg = CONFIG) {
    const events = { hits: [], grounds: [], completed: false };
    if (!state || state.finished) return events;

    const safeDt = clamp(Number(dt) || 0, 0, 0.1);
    const steps = Math.max(1, Math.ceil(safeDt / (1 / 180)));
    const sub = safeDt / steps;

    for (let s = 0; s < steps; s++) {
      for (const arrow of state.arrows) {
        if (arrow.stuck) continue;
        arrow.x += arrow.vx * sub;
        arrow.y += arrow.vy * sub;
        arrow.vy += cfg.GRAVITY * sub;
        arrow.angle = Math.atan2(arrow.vy, arrow.vx);

        if (arrow.y >= cfg.GROUND_Y - 5) {
          arrow.y = cfg.GROUND_Y - 5;
          arrow.stuck = true;
          arrow.inGround = true;
          events.grounds.push(arrow);
          continue;
        }

        for (const target of state.targets) {
          if (target.hit) continue;
          if (pointInTarget(arrow.x, arrow.y, target)) {
            target.hit = true;
            arrow.stuck = true;
            target.stickArrow = { x: arrow.x, y: arrow.y, angle: arrow.angle };
            events.hits.push({ target, arrow, x: arrow.x, y: arrow.y });
            break;
          }
        }
      }
    }

    // 保留已停止（插在靶上/落地的）箭矢，移除飞出画面的箭矢
    state.arrows = state.arrows.filter((a) =>
      a.stuck ||
      (a.x > -120 && a.x < cfg.WIDTH + 120 && a.y > -320 && a.y < cfg.HEIGHT + 220)
    );

    if (!state.finished && state.timerRunning && state.targets.every((t) => t.hit)) {
      state.finished = true;
      if (state.finalTime == null) state.finalTime = state.elapsed;
      events.completed = true;
    }
    return events;
  }

  // ---------- 排行榜纯逻辑 ----------

  function sanitizeName(raw) {
    const s = String(raw == null ? '' : raw).trim();
    return s ? s.slice(0, 12) : '玩家';
  }

  function normalizeEntry(entry) {
    return {
      name: sanitizeName(entry && entry.name),
      time: Math.max(0, Number(entry && entry.time) || 0),
      shots: Math.max(1, Math.round(Number(entry && entry.shots)) || 1),
      date: entry && entry.date ? String(entry.date) : new Date().toLocaleDateString('zh-CN'),
    };
  }

  // 加入一条成绩并按用时升序排列（用时相同则比较箭数、昵称），只保留前 max 名
  function addLeaderboardEntry(entries, entry, max = CONFIG.MAX_LEADERBOARD) {
    const list = (Array.isArray(entries) ? entries : []).map(normalizeEntry);
    const normalized = normalizeEntry(entry);
    list.push(normalized);
    list.sort((a, b) =>
      a.time - b.time ||
      a.shots - b.shots ||
      a.name.localeCompare(b.name, 'zh-CN')
    );
    const trimmed = list.slice(0, Math.max(1, Math.floor(max) || 10));
    return { entries: trimmed, entry: normalized, rank: trimmed.indexOf(normalized) };
  }

  function loadLeaderboard(storage, key = CONFIG.LEADERBOARD_KEY) {
    try {
      if (!storage || typeof storage.getItem !== 'function') return [];
      const raw = storage.getItem(key);
      if (!raw) return [];
      const data = JSON.parse(raw);
      if (!Array.isArray(data)) return [];
      return data.map(normalizeEntry).filter((e) => Number.isFinite(e.time));
    } catch (err) {
      return [];
    }
  }

  function saveLeaderboard(storage, entries, key = CONFIG.LEADERBOARD_KEY) {
    try {
      if (!storage || typeof storage.setItem !== 'function') return false;
      storage.setItem(key, JSON.stringify(entries));
      return true;
    } catch (err) {
      return false;
    }
  }

  const api = {
    CONFIG,
    createState,
    stepPhysics,
    computeShot,
    pointInTarget,
    sanitizeName,
    normalizeEntry,
    addLeaderboardEntry,
    loadLeaderboard,
    saveLeaderboard,
  };

  global.ArcheryGame = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document !== 'undefined') initGame(api);

  // ---------- 浏览器端游戏实现 ----------

  function initGame(G) {
    const canvas = document.getElementById('game');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const cfg = G.CONFIG;

    const timerEl = document.getElementById('timer');
    const hitsEl = document.getElementById('hits');
    const shotsEl = document.getElementById('shots');
    const powerBarEl = document.getElementById('powerbar');
    const resultModal = document.getElementById('resultModal');
    const leaderboardModal = document.getElementById('leaderboardModal');
    const helpModal = document.getElementById('helpModal');
    const finalTimeEl = document.getElementById('finalTime');
    const finalShotsEl = document.getElementById('finalShots');
    const rankInfoEl = document.getElementById('rankInfo');
    const storageNoteEl = document.getElementById('storageNote');
    const nameInput = document.getElementById('nameInput');
    const saveBtn = document.getElementById('saveScore');
    const leaderboardBody = document.getElementById('leaderboardBody');
    const leaderboardEmpty = document.getElementById('leaderboardEmpty');

    let storage = null;
    try {
      const probe = '__archery_probe__';
      window.localStorage.setItem(probe, '1');
      window.localStorage.removeItem(probe);
      storage = window.localStorage;
    } catch (err) {
      storage = null;
    }

    let state = G.createState(cfg);
    let leaderboard = G.loadLeaderboard(storage, cfg.LEADERBOARD_KEY);
    let aimPoint = { x: cfg.BOW_X + 260, y: cfg.BOW_Y - 170 };
    let aiming = false;
    let drawStart = 0;
    let power = 0;
    let particles = [];
    let lastTime = performance.now();
    let lastRank = -1;
    let scoreSaved = false;
    let audioCtx = null;

    const clouds = [
      { x: 120, y: 82, s: 1.0 },
      { x: 400, y: 128, s: 0.72 },
      { x: 660, y: 68, s: 1.18 },
      { x: 70, y: 196, s: 0.55 },
    ];

    // ---------- 输入 ----------

    function toCanvasPoint(e) {
      const rect = canvas.getBoundingClientRect();
      return {
        x: (e.clientX - rect.left) * (cfg.WIDTH / rect.width),
        y: (e.clientY - rect.top) * (cfg.HEIGHT / rect.height),
      };
    }

    function onPointerDown(e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (state.finished) return;
      e.preventDefault();
      aimPoint = toCanvasPoint(e);
      aiming = true;
      drawStart = performance.now();
      power = 0;
      ensureAudio();
    }

    function onPointerMove(e) {
      aimPoint = toCanvasPoint(e);
    }

    function onPointerUp(e) {
      if (!aiming) return;
      aiming = false;
      fireArrow();
    }

    function onPointerCancel() {
      aiming = false;
    }

    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    function fireArrow() {
      if (state.finished) return;
      const shot = G.computeShot({ x: cfg.BOW_X, y: cfg.BOW_Y }, aimPoint, power, cfg);
      const pull = 4 + power * 24;
      const tipX = cfg.BOW_X + Math.cos(shot.angle) * (cfg.ARROW_LEN - pull);
      const tipY = cfg.BOW_Y + Math.sin(shot.angle) * (cfg.ARROW_LEN - pull);
      if (state.arrows.length >= cfg.MAX_ARROWS) state.arrows.shift();
      state.arrows.push({
        x: tipX,
        y: tipY,
        vx: shot.vx,
        vy: shot.vy,
        angle: shot.angle,
        stuck: false,
      });
      state.shots += 1;
      if (!state.timerRunning && !state.finished) {
        state.timerRunning = true;
        state.elapsed = 0;
      }
      playTone(210, 0.06, 'triangle', 0.045);
      updateHud();
    }

    // ---------- 音效 ----------

    function ensureAudio() {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!audioCtx && AC) audioCtx = new AC();
        if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
      } catch (err) {
        audioCtx = null;
      }
    }

    function playTone(freq, dur, type, vol) {
      if (!audioCtx) return;
      try {
        const t = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = type || 'sine';
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(vol || 0.05, t);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(t);
        osc.stop(t + dur + 0.03);
      } catch (err) { /* 音效失败不影响游戏 */ }
    }

    // ---------- 粒子 ----------

    function spawnBurst(x, y, colors) {
      for (let i = 0; i < 22; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 60 + Math.random() * 240;
        particles.push({
          x: x,
          y: y,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp - 40,
          life: 0.45 + Math.random() * 0.45,
          maxLife: 0.9,
          color: colors[i % colors.length],
          size: 2 + Math.random() * 3,
        });
      }
    }

    function updateParticles(dt) {
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 420 * dt;
        p.life -= dt;
        if (p.life <= 0) particles.splice(i, 1);
      }
    }

    function drawParticles() {
      for (const p of particles) {
        ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // ---------- 绘制 ----------

    function drawScenery(now) {
      const sky = ctx.createLinearGradient(0, 0, 0, cfg.HEIGHT);
      sky.addColorStop(0, '#a9d9ff');
      sky.addColorStop(0.65, '#dff2ff');
      sky.addColorStop(1, '#f3fbff');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, cfg.WIDTH, cfg.HEIGHT);

      // 太阳
      const sun = ctx.createRadialGradient(840, 70, 6, 840, 70, 95);
      sun.addColorStop(0, 'rgba(255,244,180,1)');
      sun.addColorStop(0.25, 'rgba(255,230,130,0.9)');
      sun.addColorStop(1, 'rgba(255,230,130,0)');
      ctx.fillStyle = sun;
      ctx.beginPath();
      ctx.arc(840, 70, 95, 0, Math.PI * 2);
      ctx.fill();

      // 云
      for (const c of clouds) {
        const cx = ((c.x + now * 0.004 * c.s) % (cfg.WIDTH + 220)) - 110;
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.beginPath();
        ctx.ellipse(cx, c.y, 42 * c.s, 15 * c.s, 0, 0, Math.PI * 2);
        ctx.ellipse(cx - 30 * c.s, c.y + 4 * c.s, 28 * c.s, 11 * c.s, 0, 0, Math.PI * 2);
        ctx.ellipse(cx + 32 * c.s, c.y + 3 * c.s, 30 * c.s, 12 * c.s, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      // 远山
      ctx.fillStyle = '#bcdbb2';
      ctx.beginPath();
      ctx.moveTo(0, cfg.GROUND_Y);
      ctx.lineTo(0, 300);
      ctx.quadraticCurveTo(140, 220, 300, 290);
      ctx.quadraticCurveTo(460, 190, 620, 270);
      ctx.quadraticCurveTo(800, 200, cfg.WIDTH, 285);
      ctx.lineTo(cfg.WIDTH, cfg.GROUND_Y);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#a4cd99';
      ctx.beginPath();
      ctx.moveTo(0, cfg.GROUND_Y);
      ctx.lineTo(0, 350);
      ctx.quadraticCurveTo(210, 270, 430, 340);
      ctx.quadraticCurveTo(680, 270, cfg.WIDTH, 335);
      ctx.lineTo(cfg.WIDTH, cfg.GROUND_Y);
      ctx.closePath();
      ctx.fill();

      // 草地
      const grass = ctx.createLinearGradient(0, cfg.GROUND_Y, 0, cfg.HEIGHT);
      grass.addColorStop(0, '#79c75d');
      grass.addColorStop(1, '#4f9c3f');
      ctx.fillStyle = grass;
      ctx.fillRect(0, cfg.GROUND_Y, cfg.WIDTH, cfg.HEIGHT - cfg.GROUND_Y);

      // 草地横纹
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      for (let y = cfg.GROUND_Y + 9; y < cfg.HEIGHT; y += 17) {
        ctx.fillRect(0, y, cfg.WIDTH, 5);
      }

      // 草丛
      ctx.strokeStyle = 'rgba(34,88,30,0.55)';
      ctx.lineWidth = 2;
      for (let x = 40; x < cfg.WIDTH; x += 95) {
        const y = cfg.GROUND_Y + 22 + ((x * 13) % 37);
        ctx.beginPath();
        ctx.moveTo(x, y + 9);
        ctx.lineTo(x - 5, y);
        ctx.moveTo(x + 3, y + 9);
        ctx.lineTo(x + 5, y - 2);
        ctx.moveTo(x + 6, y + 9);
        ctx.lineTo(x + 12, y + 1);
        ctx.stroke();
      }

      ctx.strokeStyle = 'rgba(50,95,40,0.7)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, cfg.GROUND_Y);
      ctx.lineTo(cfg.WIDTH, cfg.GROUND_Y);
      ctx.stroke();
    }

    function drawTarget(t) {
      // 影子
      ctx.save();
      ctx.translate(t.x, cfg.GROUND_Y + 9);
      ctx.scale(1, 0.28);
      ctx.fillStyle = 'rgba(25,60,20,0.24)';
      ctx.beginPath();
      ctx.arc(0, 0, t.r * 0.95, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // 木桩
      ctx.strokeStyle = '#8a5a2b';
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(t.x, cfg.GROUND_Y - 5);
      ctx.lineTo(t.x, t.y - t.r * 0.15);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(t.x - 2, cfg.GROUND_Y - 5);
      ctx.lineTo(t.x - 2, t.y - t.r * 0.2);
      ctx.stroke();

      // 靶环
      const rings = [
        { frac: 1, color: '#f6f3e8' },
        { frac: 0.82, color: '#303038' },
        { frac: 0.62, color: '#2f7fd1' },
        { frac: 0.42, color: '#e33b3b' },
        { frac: 0.2, color: '#f5c542' },
      ];
      if (t.hit) ctx.globalAlpha = 0.6;
      for (const ring of rings) {
        ctx.fillStyle = ring.color;
        ctx.beginPath();
        ctx.arc(t.x, t.y, t.r * ring.frac, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#3d2f1d';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2);
      ctx.stroke();

      if (t.hit) {
        // 命中裂纹
        ctx.strokeStyle = 'rgba(75,35,20,0.5)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(t.x - t.r * 0.75, t.y - t.r * 0.55);
        ctx.lineTo(t.x + t.r * 0.7, t.y + t.r * 0.5);
        ctx.moveTo(t.x + t.r * 0.7, t.y - t.r * 0.6);
        ctx.lineTo(t.x - t.r * 0.7, t.y + t.r * 0.55);
        ctx.stroke();
        // 绿色命中标记
        ctx.fillStyle = '#2fae4e';
        ctx.beginPath();
        ctx.arc(t.x + t.r * 0.78, t.y - t.r * 0.78, 11, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(t.x + t.r * 0.78 - 5, t.y - t.r * 0.78);
        ctx.lineTo(t.x + t.r * 0.78 - 1, t.y - t.r * 0.78 + 4);
        ctx.lineTo(t.x + t.r * 0.78 + 6, t.y - t.r * 0.78 - 4);
        ctx.stroke();
      }

      if (t.hit && t.stickArrow) {
        drawArrowAt(t.stickArrow.x, t.stickArrow.y, t.stickArrow.angle, 1);
      }
    }

    function drawArrowAt(x, y, angle, alpha) {
      ctx.save();
      ctx.globalAlpha = alpha == null ? 1 : alpha;
      ctx.translate(x, y);
      ctx.rotate(angle);

      // 箭杆
      ctx.strokeStyle = '#9a6b3f';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-cfg.ARROW_LEN, 0);
      ctx.lineTo(0, 0);
      ctx.stroke();

      // 箭头
      ctx.fillStyle = '#d9dce2';
      ctx.beginPath();
      ctx.moveTo(9, 0);
      ctx.lineTo(-1, -3);
      ctx.lineTo(-1, 3);
      ctx.closePath();
      ctx.fill();

      // 尾羽
      ctx.fillStyle = '#e33b3b';
      ctx.beginPath();
      ctx.moveTo(-cfg.ARROW_LEN + 2, 0);
      ctx.lineTo(-cfg.ARROW_LEN + 13, -5);
      ctx.lineTo(-cfg.ARROW_LEN + 11, 0);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#2f7fd1';
      ctx.beginPath();
      ctx.moveTo(-cfg.ARROW_LEN + 2, 0);
      ctx.lineTo(-cfg.ARROW_LEN + 13, 5);
      ctx.lineTo(-cfg.ARROW_LEN + 11, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    function drawBow(angle, chargePower) {
      ctx.save();
      ctx.translate(cfg.BOW_X, cfg.BOW_Y);
      ctx.rotate(angle);

      const pull = 4 + chargePower * 24;

      // 弓臂
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#7a4a21';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(30, -36);
      ctx.quadraticCurveTo(16, -22, 0, 0);
      ctx.quadraticCurveTo(16, 22, 30, 36);
      ctx.stroke();
      ctx.strokeStyle = '#a9763f';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(30, -36);
      ctx.quadraticCurveTo(16, -22, 0, 0);
      ctx.quadraticCurveTo(16, 22, 30, 36);
      ctx.stroke();

      // 弓弦
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      if (chargePower > 0.01) {
        ctx.moveTo(30, -36);
        ctx.lineTo(-pull, 0);
        ctx.lineTo(30, 36);
      } else {
        ctx.moveTo(30, -36);
        ctx.lineTo(30, 36);
      }
      ctx.stroke();

      // 握把
      ctx.strokeStyle = '#5d3a18';
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(-5, -3);
      ctx.lineTo(-5, 3);
      ctx.stroke();

      // 搭在弓上的箭
      if (chargePower > 0.01) {
        ctx.strokeStyle = '#b97b3e';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(-pull, 0);
        ctx.lineTo(cfg.ARROW_LEN - pull, 0);
        ctx.stroke();
        ctx.fillStyle = '#d9dce2';
        ctx.beginPath();
        ctx.moveTo(cfg.ARROW_LEN - pull + 9, 0);
        ctx.lineTo(cfg.ARROW_LEN - pull - 1, -3);
        ctx.lineTo(cfg.ARROW_LEN - pull - 1, 3);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }

    function drawTrajectory() {
      const shot = G.computeShot({ x: cfg.BOW_X, y: cfg.BOW_Y }, aimPoint, power, cfg);
      const pull = 4 + power * 24;
      let x = cfg.BOW_X + Math.cos(shot.angle) * (cfg.ARROW_LEN - pull);
      let y = cfg.BOW_Y + Math.sin(shot.angle) * (cfg.ARROW_LEN - pull);

      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      for (let t = 0; t <= 0.85; t += 0.045) {
        const px = x + shot.vx * t;
        const py = y + shot.vy * t + 0.5 * cfg.GRAVITY * t * t;
        if (py > cfg.GROUND_Y - 5) break;
        let hitPreview = false;
        for (const target of state.targets) {
          if (!target.hit && G.pointInTarget(px, py, target)) { hitPreview = true; break; }
        }
        ctx.globalAlpha = 0.95 - t * 0.75;
        ctx.beginPath();
        ctx.arc(px, py, t === 0 ? 2.6 : 1.7, 0, Math.PI * 2);
        ctx.fill();
        if (hitPreview) break;
      }
      ctx.restore();
    }

    function drawCrosshair() {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.92)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(aimPoint.x, aimPoint.y, 9, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(aimPoint.x - 16, aimPoint.y);
      ctx.lineTo(aimPoint.x - 5, aimPoint.y);
      ctx.moveTo(aimPoint.x + 5, aimPoint.y);
      ctx.lineTo(aimPoint.x + 16, aimPoint.y);
      ctx.moveTo(aimPoint.x, aimPoint.y - 16);
      ctx.lineTo(aimPoint.x, aimPoint.y - 5);
      ctx.moveTo(aimPoint.x, aimPoint.y + 5);
      ctx.lineTo(aimPoint.x, aimPoint.y + 16);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.beginPath();
      ctx.arc(aimPoint.x, aimPoint.y, 1.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    function draw(now) {
      ctx.clearRect(0, 0, cfg.WIDTH, cfg.HEIGHT);
      drawScenery(now);

      const aimAngle = Math.atan2(aimPoint.y - cfg.BOW_Y, aimPoint.x - cfg.BOW_X);
      drawBow(aimAngle, aiming ? power : 0);

      for (const target of state.targets) drawTarget(target);
      for (const arrow of state.arrows) {
        // 插在靶上的箭已在 drawTarget 中绘制，其余（飞行中/落地）在这里绘制
        if (!state.targets.some((t) => t.stickArrow === arrow)) {
          drawArrowAt(arrow.x, arrow.y, arrow.angle, 1);
        }
      }

      if (aiming && !state.finished) drawTrajectory();
      drawParticles();
      drawCrosshair();
      updateHud();
    }

    // ---------- HUD / 弹窗 ----------

    function updateHud() {
      const shown = state.finished && state.finalTime != null ? state.finalTime : state.elapsed;
      timerEl.textContent = shown.toFixed(2) + ' s';
      const hitCount = state.targets.filter((t) => t.hit).length;
      hitsEl.textContent = hitCount + ' / ' + state.targets.length;
      shotsEl.textContent = String(state.shots);
      powerBarEl.style.width = (aiming ? power * 100 : 0).toFixed(1) + '%';
    }

    function openModal(el) {
      if (!el) return;
      el.classList.remove('hidden');
    }

    function closeModals() {
      for (const el of [resultModal, leaderboardModal, helpModal]) {
        if (el) el.classList.add('hidden');
      }
    }

    function onCompleted() {
      updateHud();
      playTone(660, 0.14, 'triangle', 0.07);
      window.setTimeout(() => playTone(880, 0.22, 'triangle', 0.07), 130);
      window.setTimeout(() => {
        finalTimeEl.textContent = state.finalTime.toFixed(2) + ' 秒';
        finalShotsEl.textContent = String(state.shots);
        rankInfoEl.textContent = '';
        nameInput.value = '玩家';
        saveBtn.disabled = false;
        saveBtn.textContent = '保存成绩';
        openModal(resultModal);
        window.setTimeout(() => {
          nameInput.focus();
          nameInput.select();
        }, 80);
      }, 480);
    }

    function saveScore() {
      if (!state.finished || state.finalTime == null || scoreSaved) return;
      const result = G.addLeaderboardEntry(leaderboard, {
        name: nameInput.value,
        time: state.finalTime,
        shots: state.shots,
        date: new Date().toLocaleDateString('zh-CN'),
      });
      leaderboard = result.entries;
      lastRank = result.rank;
      const persisted = G.saveLeaderboard(storage, leaderboard, cfg.LEADERBOARD_KEY);
      scoreSaved = true;
      saveBtn.disabled = true;
      saveBtn.textContent = '已保存';
      rankInfoEl.textContent = lastRank >= 0
        ? '🏆 恭喜！你排在第 ' + (lastRank + 1) + ' 名'
        : '成绩未进入前 ' + cfg.MAX_LEADERBOARD + ' 名，继续加油！';
      if (!persisted) {
        rankInfoEl.textContent += '（当前浏览器无法使用本地存储，成绩仅本次会话有效）';
      }
      renderLeaderboard();
    }

    function renderLeaderboard() {
      leaderboardBody.innerHTML = '';
      leaderboardEmpty.classList.toggle('hidden', leaderboard.length > 0);
      leaderboard.forEach((entry, i) => {
        const tr = document.createElement('tr');
        if (i === lastRank) tr.className = 'me';

        const rankTd = document.createElement('td');
        rankTd.textContent = i === 0 ? '🥇' : (i === 1 ? '🥈' : (i === 2 ? '🥉' : String(i + 1)));

        const nameTd = document.createElement('td');
        nameTd.textContent = entry.name;

        const timeTd = document.createElement('td');
        timeTd.textContent = entry.time.toFixed(2) + ' 秒';

        const shotsTd = document.createElement('td');
        shotsTd.textContent = entry.shots + ' 箭';

        const dateTd = document.createElement('td');
        dateTd.textContent = entry.date;

        tr.append(rankTd, nameTd, timeTd, shotsTd, dateTd);
        leaderboardBody.appendChild(tr);
      });
      storageNoteEl.textContent = storage
        ? '排行榜保存在当前浏览器的本地存储中。'
        : '⚠ 当前浏览器无法使用本地存储，排行榜不会跨会话保留。';
    }

    function resetGame() {
      state = G.createState(cfg);
      particles.length = 0;
      aiming = false;
      power = 0;
      scoreSaved = false;
      lastRank = -1;
      closeModals();
      updateHud();
    }

    document.getElementById('leaderboardBtn').addEventListener('click', () => {
      renderLeaderboard();
      openModal(leaderboardModal);
    });
    document.getElementById('helpBtn').addEventListener('click', () => openModal(helpModal));
    document.getElementById('newGameBtn').addEventListener('click', () => {
      if (state.shots > 0 && !state.finished && !window.confirm('当前一局尚未完成，确定重新开始吗？')) return;
      resetGame();
    });
    document.getElementById('playAgain').addEventListener('click', resetGame);
    saveBtn.addEventListener('click', saveScore);
    document.getElementById('closeResult').addEventListener('click', () => resultModal.classList.add('hidden'));
    document.getElementById('closeLeaderboard').addEventListener('click', () => leaderboardModal.classList.add('hidden'));
    document.getElementById('closeHelp').addEventListener('click', () => helpModal.classList.add('hidden'));
    document.getElementById('clearLeaderboard').addEventListener('click', () => {
      if (!window.confirm('确定清空排行榜吗？此操作不可恢复。')) return;
      leaderboard = [];
      lastRank = -1;
      G.saveLeaderboard(storage, [], cfg.LEADERBOARD_KEY);
      renderLeaderboard();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeModals();
      if (e.key === 'Enter' && !resultModal.classList.contains('hidden') && !saveBtn.disabled) saveScore();
    });

    // ---------- 主循环 ----------

    function frame(now) {
      const dt = clamp((now - lastTime) / 1000, 0, 0.04);
      lastTime = now;

      if (aiming && !state.finished) {
        power = clamp((now - drawStart) / 1000 / cfg.MAX_CHARGE, 0, 1);
      } else if (!aiming) {
        power = 0;
      }

      if (state.timerRunning && !state.finished) state.elapsed += dt;

      const events = G.stepPhysics(state, dt, cfg);
      for (const hit of events.hits) {
        spawnBurst(hit.x, hit.y, ['#f5c542', '#e33b3b', '#ffffff']);
        playTone(760 + Math.random() * 160, 0.09, 'triangle', 0.055);
      }
      if (events.completed) onCompleted();

      updateParticles(dt);
      draw(now);
      requestAnimationFrame(frame);
    }

    updateHud();
    requestAnimationFrame(frame);
  }
})(typeof window !== 'undefined' ? window : globalThis);
