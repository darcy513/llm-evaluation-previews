'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const Game = require(path.join(__dirname, '..', 'game.js'));

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

test('配置中恰好有四个靶子，且都位于画面和地面范围内', () => {
  const cfg = Game.CONFIG;
  assert.equal(cfg.TARGETS.length, 4, '应有 4 个靶子');
  for (const t of cfg.TARGETS) {
    assert.ok(t.x > 0 && t.x < cfg.WIDTH, '靶子 x 在画面内');
    assert.ok(t.y > 0 && t.y + t.r < cfg.GROUND_Y, '靶子应位于地面之上');
    assert.ok(t.r > 0, '靶子半径为正');
  }
});

test('createState 初始化四个未命中靶子、计时未开始', () => {
  const state = Game.createState();
  assert.equal(state.targets.length, 4);
  assert.equal(state.targets.every((t) => t.hit === false), true);
  assert.equal(state.shots, 0);
  assert.equal(state.timerRunning, false);
  assert.equal(state.finished, false);
});

test('computeShot：水平向右、零蓄力时速度为最小速度，满蓄力为最大速度', () => {
  const origin = { x: 0, y: 0 };
  const aim = { x: 100, y: 0 };
  const low = Game.computeShot(origin, aim, 0);
  const full = Game.computeShot(origin, aim, 1);
  assert.equal(low.vx, Game.CONFIG.MIN_SPEED);
  assert.equal(low.vy, 0);
  assert.equal(full.vx, Game.CONFIG.MIN_SPEED + Game.CONFIG.EXTRA_SPEED);
  assert.equal(full.vy, 0);
});

test('computeShot：蓄力值会被钳制在 0~1 之间', () => {
  const origin = { x: 0, y: 0 };
  const aim = { x: 100, y: 0 };
  const below = Game.computeShot(origin, aim, -3);
  const above = Game.computeShot(origin, aim, 99);
  assert.equal(below.vx, Game.CONFIG.MIN_SPEED);
  assert.equal(above.vx, Game.CONFIG.MIN_SPEED + Game.CONFIG.EXTRA_SPEED);
});

test('stepPhysics：箭矢进入靶环后判定命中并停止', () => {
  const state = Game.createState();
  const t = state.targets[0];
  state.arrows.push({ x: t.x, y: t.y - 10, vx: 0, vy: 300, angle: Math.PI / 2, stuck: false });
  const events = Game.stepPhysics(state, 1 / 30);
  assert.equal(t.hit, true);
  assert.equal(events.hits.length, 1);
  assert.equal(events.hits[0].target.id, t.id);
  assert.ok(t.stickArrow, '命中后应记录插在靶上的箭');
  assert.equal(state.arrows[0].stuck, true);
});

test('stepPhysics：箭矢落地后停止', () => {
  const state = Game.createState();
  state.arrows.push({
    x: 300,
    y: Game.CONFIG.GROUND_Y - 60,
    vx: 0,
    vy: 800,
    angle: Math.PI / 2,
    stuck: false,
  });
  const events = Game.stepPhysics(state, 1 / 10);
  assert.equal(events.grounds.length, 1);
  assert.equal(state.arrows[0].stuck, true);
  assert.ok(state.arrows[0].y <= Game.CONFIG.GROUND_Y - 5);
});

test('stepPhysics：四个靶子全部命中且计时已开始时判定通关', () => {
  const state = Game.createState();
  state.timerRunning = true;
  state.elapsed = 12.34;
  for (const t of state.targets) t.hit = true;
  const events = Game.stepPhysics(state, 1 / 60);
  assert.equal(events.completed, true);
  assert.equal(state.finished, true);
  assert.equal(state.finalTime, 12.34);
});

test('stepPhysics：计时未开始（尚未射箭）不会误判通关', () => {
  const state = Game.createState();
  for (const t of state.targets) t.hit = true;
  const events = Game.stepPhysics(state, 1 / 60);
  assert.equal(events.completed, false);
  assert.equal(state.finished, false);
});

function flightHitsTarget(aim, power, target) {
  const cfg = Game.CONFIG;
  const shot = Game.computeShot({ x: cfg.BOW_X, y: cfg.BOW_Y }, aim, power);
  const pull = 4 + power * 24;
  let x = cfg.BOW_X + Math.cos(shot.angle) * (cfg.ARROW_LEN - pull);
  let y = cfg.BOW_Y + Math.sin(shot.angle) * (cfg.ARROW_LEN - pull);
  let vx = shot.vx;
  let vy = shot.vy;
  const dt = 1 / 240;
  for (let t = 0; t <= 4; t += dt) {
    x += vx * dt;
    y += vy * dt;
    vy += cfg.GRAVITY * dt;
    if (Game.pointInTarget(x, y, target)) return true;
    if (y >= cfg.GROUND_Y - 5 || x > cfg.WIDTH + 120 || x < -120 || y < -320) return false;
  }
  return false;
}

test('可通关性：四个靶子都能通过某组瞄准点与蓄力值命中', () => {
  const cfg = Game.CONFIG;
  for (const t of cfg.TARGETS) {
    let found = false;
    search:
    for (let power = 0; power <= 1.0001; power += 0.05) {
      for (let ax = Math.max(0, t.x - 400); ax <= Math.min(cfg.WIDTH, t.x + 400); ax += 30) {
        for (let ay = Math.max(0, t.y - 260); ay <= Math.min(cfg.GROUND_Y, t.y + 260); ay += 30) {
          if (flightHitsTarget({ x: ax, y: ay }, power, t)) { found = true; break search; }
        }
      }
    }
    assert.equal(found, true, `靶子 (${t.x}, ${t.y}) 应存在可行瞄准方案`);
  }
});

test('排行榜：按用时升序排列，并只保留前 10 名', () => {
  let entries = [];
  for (let i = 0; i < 12; i++) {
    const r = Game.addLeaderboardEntry(entries, {
      name: '玩家' + i,
      time: 30 - i,
      shots: 5,
      date: '2025-01-01',
    });
    entries = r.entries;
  }
  assert.equal(entries.length, Game.CONFIG.MAX_LEADERBOARD);
  assert.equal(entries[0].time, 19); // 30-11，最快
  for (let i = 1; i < entries.length; i++) {
    assert.ok(entries[i - 1].time <= entries[i].time, '榜单应按用时递增');
  }
});

test('排行榜：更快成绩排名更靠前，并返回正确名次', () => {
  const first = Game.addLeaderboardEntry([], { name: '慢手', time: 20, shots: 4, date: '2025-01-01' });
  const second = Game.addLeaderboardEntry(first.entries, { name: '快手', time: 9.5, shots: 3, date: '2025-01-01' });
  assert.equal(second.rank, 0, '用时 9.5 秒应排第一');
  assert.equal(second.entries[0].name, '快手');
  assert.equal(second.entries[1].name, '慢手');
});

test('排行榜：空昵称回退为“玩家”，昵称长度不超过 12', () => {
  assert.equal(Game.sanitizeName('   '), '玩家');
  assert.equal(Game.sanitizeName('0123456789abcdef'), '0123456789ab');
});

test('排行榜：localStorage 存取往返一致', () => {
  const storage = memoryStorage();
  const entries = Game.addLeaderboardEntry([], {
    name: '神箭手',
    time: 7.25,
    shots: 4,
    date: '2025-01-01',
  }).entries;
  assert.equal(Game.saveLeaderboard(storage, entries), true);
  const loaded = Game.loadLeaderboard(storage);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].name, '神箭手');
  assert.equal(loaded[0].time, 7.25);
  assert.equal(loaded[0].shots, 4);
});

test('排行榜：损坏或不可用的存储不会抛出异常', () => {
  assert.deepEqual(Game.loadLeaderboard(null), []);
  assert.equal(Game.saveLeaderboard(null, []), false);
  const bad = { getItem: () => '{not valid json' };
  assert.deepEqual(Game.loadLeaderboard(bad), []);
});
