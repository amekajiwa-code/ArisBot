import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldNotify, buildAlert, createSteamWatcher } from '../src/steam-watch.js';

// shouldNotify(lastNotified, current, threshold, minCount) — 증가(돌파)일 때만 true

test('shouldNotify: no baseline yet → false', () => {
  assert.equal(shouldNotify(null, 12, 5, 10), false);
});

test('shouldNotify: increase below threshold → false', () => {
  assert.equal(shouldNotify(12, 16, 5, 10), false); // +4
});

test('shouldNotify: increase at/over threshold (current ≥ min) → true', () => {
  assert.equal(shouldNotify(12, 17, 5, 10), true); // +5
  assert.equal(shouldNotify(12, 30, 5, 10), true); // +18
});

test('shouldNotify: any decrease → false (upward only)', () => {
  assert.equal(shouldNotify(20, 16, 5, 10), false); // -4
  assert.equal(shouldNotify(20, 15, 5, 10), false); // -5
  assert.equal(shouldNotify(30, 12, 5, 10), false); // -18
});

test('shouldNotify: no change → false', () => {
  assert.equal(shouldNotify(12, 12, 5, 10), false);
});

test('shouldNotify: increase but current below minCount → false', () => {
  assert.equal(shouldNotify(3, 9, 5, 10), false); // +6 but 9 < 10
});

test('shouldNotify: increase reaching exactly minCount → true', () => {
  assert.equal(shouldNotify(4, 10, 5, 10), true); // +6, current == min
});

// buildAlert — 증가 전용 "돌파" 임베드(봇 메시지) 페이로드 + SteamDB 링크

test('buildAlert: returns an embed payload with title, steamdb url, 돌파 설명', () => {
  const payload = buildAlert({ current: 17, last: 12, gameName: 'DEADLY TRICK DEMO', appId: 4398540 });
  assert.ok(Array.isArray(payload.embeds), 'has embeds array');
  const e = payload.embeds[0];
  assert.equal(e.title, '🎮 DEADLY TRICK DEMO');
  assert.equal(e.url, 'https://steamdb.info/app/4398540/');
  assert.equal(e.description, '동접자 17명 돌파(+5)');
  assert.equal(typeof e.color, 'number');
});

// ── 워처 동작 ──────────────────────────────────────────────
// fetchCount 가 sequence 를 한 틱에 하나씩 내보내고, send 스파이가 payload 를 기록.
function harness(sequence, { threshold = 5, minCount = 10, gameName = 'GAME', appId = 1 } = {}) {
  const seq = [...sequence];
  const sent = [];
  const watcher = createSteamWatcher({
    fetchCount: async () => (seq.length ? seq.shift() : null),
    send: async (payload) => { sent.push(payload); },
    threshold,
    minCount,
    gameName,
    appId,
  });
  return { watcher, sent };
}

const desc = (payload) => payload.embeds[0].description;

test('watcher: first tick sets the baseline and sends nothing', async () => {
  const { watcher, sent } = harness([12]);
  await watcher.tick();
  assert.equal(sent.length, 0);
  assert.equal(watcher.lastNotified, 12);
});

test('watcher: crossing threshold upward sends once and rebaselines', async () => {
  const { watcher, sent } = harness([12, 17, 19], { gameName: 'DEADLY TRICK DEMO', appId: 4398540 });
  await watcher.tick(); // baseline 12, no send
  await watcher.tick(); // 17 (+5) → send, baseline 17
  await watcher.tick(); // 19 (+2) → quiet, baseline still 17
  assert.equal(sent.length, 1);
  assert.equal(sent[0].embeds[0].title, '🎮 DEADLY TRICK DEMO');
  assert.equal(desc(sent[0]), '동접자 17명 돌파(+5)');
  assert.equal(sent[0].embeds[0].url, 'https://steamdb.info/app/4398540/');
  assert.equal(watcher.lastNotified, 17);
});

test('watcher: a big upward jump alerts once with the full delta', async () => {
  const { watcher, sent } = harness([12, 30]);
  await watcher.tick();
  await watcher.tick();
  assert.equal(sent.length, 1);
  assert.match(desc(sent[0]), /돌파\(\+18\)/);
  assert.equal(watcher.lastNotified, 30);
});

test('watcher: null fetch is skipped, baseline preserved', async () => {
  const { watcher, sent } = harness([12, null, 17]);
  await watcher.tick(); // baseline 12
  await watcher.tick(); // null → skip
  assert.equal(watcher.lastNotified, 12);
  await watcher.tick(); // 17 (+5) → send
  assert.equal(sent.length, 1);
});

test('watcher: a decrease never alerts and silently rebaselines down', async () => {
  const { watcher, sent } = harness([20, 12], { minCount: 1 });
  await watcher.tick(); // baseline 20
  await watcher.tick(); // 12 (drop) → no send, baseline follows down to 12
  assert.equal(sent.length, 0);
  assert.equal(watcher.lastNotified, 12);
});

test('watcher: rebaseline after a drop lets a later rise alert again', async () => {
  const { watcher, sent } = harness([20, 12, 17]);
  await watcher.tick(); // baseline 20
  await watcher.tick(); // 12 (drop) → silent, baseline 12
  await watcher.tick(); // 17 (+5 from 12, ≥ min) → send, baseline 17
  assert.equal(sent.length, 1);
  assert.match(desc(sent[0]), /17명 돌파\(\+5\)/);
  assert.equal(watcher.lastNotified, 17);
});

test('watcher: stays quiet while increase keeps it below minCount', async () => {
  const { watcher, sent } = harness([3, 9], { threshold: 5, minCount: 10 });
  await watcher.tick(); // baseline 3
  await watcher.tick(); // 9 (+6) but 9 < 10 → no send
  assert.equal(sent.length, 0);
});
