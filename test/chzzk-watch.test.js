import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newStreamers, buildAlert, createChzzkWatcher } from '../src/chzzk-watch.js';

// Compact live object as produced by src/chzzk.js (keyed by channelId).
const live = (channelId, name, opts = {}) => ({
  channelId,
  channelName: name,
  liveTitle: opts.title ?? '',
  concurrentUserCount: opts.viewers ?? 0,
});

// newStreamers(known, lives, minViewers) — live now (≥ minViewers) but not in the known set.

test('newStreamers: no baseline yet → none', () => {
  assert.deepEqual(newStreamers(null, [live('c1', 'A')]), []);
});

test('newStreamers: returns channels not in the known set', () => {
  const fresh = newStreamers(new Set(['c1']), [live('c1', 'A'), live('c2', 'B')]);
  assert.deepEqual(fresh.map((x) => x.channelId), ['c2']);
});

test('newStreamers: already-known channels are excluded', () => {
  assert.deepEqual(newStreamers(new Set(['c1', 'c2']), [live('c1', 'A'), live('c2', 'B')]), []);
});

test('newStreamers: filters out lives below minViewers', () => {
  const fresh = newStreamers(new Set(), [live('c1', 'A', { viewers: 0 }), live('c2', 'B', { viewers: 5 })], 3);
  assert.deepEqual(fresh.map((x) => x.channelId), ['c2']);
});

// buildAlert — "{platform}에서 {channelName}님이 {categoryName} 방송중!" 임베드 + 마지막 줄에 라이브 링크.

test('buildAlert: "{platform}에서 {channelName}님이 {categoryName} 방송중!" with the link last', () => {
  const payload = buildAlert(live('abc123', '아리스', { title: '데일리 트릭 한판' }), 'Deadly Trick', '치지직');
  assert.ok(Array.isArray(payload.embeds), 'has embeds array');
  const e = payload.embeds[0];
  assert.equal(e.title, '치지직에서 아리스님이 Deadly Trick 방송중!');
  assert.equal(e.url, 'https://chzzk.naver.com/live/abc123');
  assert.equal(e.description, '데일리 트릭 한판\nhttps://chzzk.naver.com/live/abc123');
  assert.equal(typeof e.color, 'number');
});

test('buildAlert: description is just the link when the live has no title', () => {
  const e = buildAlert(live('abc123', '아리스', { title: '' }), 'Deadly Trick', '치지직').embeds[0];
  assert.equal(e.description, 'https://chzzk.naver.com/live/abc123');
});

// ── 워처 동작 ──────────────────────────────────────────────
// fetchLives 가 sequence 를 한 틱에 하나씩 내보내고(배열 = 카테고리 라이브 목록, null = 실패),
// send 스파이가 payload 를 기록.
function harness(ticks, { categoryName = 'Deadly Trick', minViewers = 0 } = {}) {
  const seq = [...ticks];
  const sent = [];
  const watcher = createChzzkWatcher({
    fetchLives: async () => (seq.length ? seq.shift() : null),
    send: async (payload) => { sent.push(payload); },
    categoryName,
    minViewers,
  });
  return { watcher, sent };
}
const titleOf = (p) => p.embeds[0].title;

test('watcher: first tick seeds the baseline and announces nothing', async () => {
  const { watcher, sent } = harness([[live('c1', 'A')]]);
  await watcher.tick();
  assert.equal(sent.length, 0);
});

test('watcher: a newly-live channel is announced once', async () => {
  const { watcher, sent } = harness([[live('c1', 'A')], [live('c1', 'A'), live('c2', 'B')]]);
  await watcher.tick(); // baseline: A
  await watcher.tick(); // B appears → announce
  assert.equal(sent.length, 1);
  assert.equal(titleOf(sent[0]), '치지직에서 B님이 Deadly Trick 방송중!');
});

test('watcher: a channel still live across ticks is not announced again', async () => {
  const { watcher, sent } = harness([[live('c1', 'A')], [live('c1', 'A')], [live('c1', 'A')]]);
  await watcher.tick();
  await watcher.tick();
  await watcher.tick();
  assert.equal(sent.length, 0);
});

test('watcher: null fetch is skipped and the baseline is preserved', async () => {
  const { watcher, sent } = harness([[live('c1', 'A')], null, [live('c1', 'A'), live('c2', 'B')]]);
  await watcher.tick(); // baseline {A}
  await watcher.tick(); // null → skip, baseline still {A}
  await watcher.tick(); // B new → announce (A not re-announced)
  assert.equal(sent.length, 1);
  assert.equal(titleOf(sent[0]), '치지직에서 B님이 Deadly Trick 방송중!');
});

test('watcher: a channel that goes offline and returns is announced again', async () => {
  const { watcher, sent } = harness([[live('c1', 'A')], [], [live('c1', 'A')]]);
  await watcher.tick(); // baseline {A}
  await watcher.tick(); // A gone → known {}
  await watcher.tick(); // A back → announce
  assert.equal(sent.length, 1);
  assert.equal(titleOf(sent[0]), '치지직에서 A님이 Deadly Trick 방송중!');
});

test('watcher: multiple new channels in one tick each get an announcement', async () => {
  const { watcher, sent } = harness([[], [live('c1', 'A'), live('c2', 'B')]]);
  await watcher.tick(); // baseline {}
  await watcher.tick(); // A, B new → 2 announces
  assert.equal(sent.length, 2);
});

test('watcher: lives below minViewers are ignored until they cross it', async () => {
  const { watcher, sent } = harness(
    [[live('c1', 'A', { viewers: 0 })], [live('c1', 'A', { viewers: 5 })]],
    { minViewers: 3 },
  );
  await watcher.tick(); // baseline: A below min → known {}
  await watcher.tick(); // A now 5 ≥ 3 and not known → announce
  assert.equal(sent.length, 1);
  assert.equal(titleOf(sent[0]), '치지직에서 A님이 Deadly Trick 방송중!');
});
