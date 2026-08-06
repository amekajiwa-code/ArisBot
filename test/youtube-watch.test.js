import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesTerms, newStreamers, buildAlert, createYouTubeWatcher } from '../src/youtube-watch.js';

// Compact live object as produced by src/youtube.js (keyed by videoId).
const live = (videoId, name, opts = {}) => ({
  videoId,
  channelName: name,
  title: opts.title ?? '',
  description: opts.description ?? '',
  liveViewers: opts.viewers ?? 0,
});

// matchesTerms(live, terms) — YouTube 검색은 관련성 기반이라 키워드가 없는 영상도 섞인다.
// 제목/설명에 실제로 키워드가 있는지 한 번 더 거른다.

test('matchesTerms: matches a term in the title', () => {
  assert.equal(matchesTerms(live('v1', 'A', { title: 'I Died and Nobody Saw It | Deadly Trick' }), ['Deadly Trick']), true);
});

test('matchesTerms: matches a term in the description', () => {
  const l = live('v1', 'A', { title: '오늘의 합방', description: '게임: 데들리 트릭' });
  assert.equal(matchesTerms(l, ['Deadly Trick', '데들리 트릭']), true);
});

test('matchesTerms: term matching ignores case', () => {
  assert.equal(matchesTerms(live('v1', 'A', { title: 'DEADLY TRICK 8인' }), ['Deadly Trick']), true);
});

test('matchesTerms: a live mentioning none of the terms is rejected', () => {
  assert.equal(matchesTerms(live('v1', 'A', { title: 'Deadly Premonition 실황' }), ['Deadly Trick']), false);
});

test('matchesTerms: an empty term list disables the filter', () => {
  assert.equal(matchesTerms(live('v1', 'A', { title: '아무거나' }), []), true);
});

// newStreamers(known, lives, minViewers) — live now (≥ minViewers) but not in the known set.

test('newStreamers: no baseline yet → none', () => {
  assert.deepEqual(newStreamers(null, [live('v1', 'A')]), []);
});

test('newStreamers: returns videos not in the known set', () => {
  const fresh = newStreamers(new Set(['v1']), [live('v1', 'A'), live('v2', 'B')]);
  assert.deepEqual(fresh.map((x) => x.videoId), ['v2']);
});

test('newStreamers: already-known videos are excluded', () => {
  assert.deepEqual(newStreamers(new Set(['v1', 'v2']), [live('v1', 'A'), live('v2', 'B')]), []);
});

test('newStreamers: filters out lives below minViewers', () => {
  const fresh = newStreamers(new Set(), [live('v1', 'A', { viewers: 0 }), live('v2', 'B', { viewers: 5 })], 3);
  assert.deepEqual(fresh.map((x) => x.videoId), ['v2']);
});

// buildAlert — "{platform}에서 {channelName}님이 {categoryName} 방송중!" 임베드 + 마지막 줄에 방송 링크.

test('buildAlert: "{platform}에서 {channelName}님이 {categoryName} 방송중!" with the link last', () => {
  const payload = buildAlert(live('vid1', '아리스', { title: '데들리 트릭 한판' }), 'Deadly Trick', 'YouTube');
  assert.ok(Array.isArray(payload.embeds), 'has embeds array');
  const e = payload.embeds[0];
  assert.equal(e.title, 'YouTube에서 아리스님이 Deadly Trick 방송중!');
  assert.equal(e.url, 'https://youtu.be/vid1');
  assert.equal(e.description, '데들리 트릭 한판\nhttps://youtu.be/vid1');
  assert.equal(typeof e.color, 'number');
});

test('buildAlert: description is just the link when the live has no title', () => {
  const e = buildAlert(live('vid1', '아리스', { title: '' }), 'Deadly Trick', 'YouTube').embeds[0];
  assert.equal(e.description, 'https://youtu.be/vid1');
});

// ── 워처 동작 ──────────────────────────────────────────────
// fetchLives 가 sequence 를 한 틱에 하나씩 내보내고(배열 = 토픽 라이브 목록, null = 실패),
// send 스파이가 payload 를 기록.
function harness(ticks, { categoryName = 'Deadly Trick', minViewers = 0, matchTerms = [] } = {}) {
  const seq = [...ticks];
  const sent = [];
  const watcher = createYouTubeWatcher({
    fetchLives: async () => (seq.length ? seq.shift() : null),
    send: async (payload) => { sent.push(payload); },
    categoryName,
    minViewers,
    matchTerms,
  });
  return { watcher, sent };
}
const titleOf = (p) => p.embeds[0].title;

test('watcher: first tick seeds the baseline and announces nothing', async () => {
  const { watcher, sent } = harness([[live('v1', 'A')]]);
  await watcher.tick();
  assert.equal(sent.length, 0);
});

test('watcher: a newly-live video is announced once, defaulting to the YouTube platform label', async () => {
  const { watcher, sent } = harness([[live('v1', 'A')], [live('v1', 'A'), live('v2', 'B')]]);
  await watcher.tick(); // baseline: A
  await watcher.tick(); // B appears → announce
  assert.equal(sent.length, 1);
  assert.equal(titleOf(sent[0]), 'YouTube에서 B님이 Deadly Trick 방송중!');
});

test('watcher: a video still live across ticks is not announced again', async () => {
  const { watcher, sent } = harness([[live('v1', 'A')], [live('v1', 'A')], [live('v1', 'A')]]);
  await watcher.tick();
  await watcher.tick();
  await watcher.tick();
  assert.equal(sent.length, 0);
});

test('watcher: null fetch is skipped and the baseline is preserved', async () => {
  const { watcher, sent } = harness([[live('v1', 'A')], null, [live('v1', 'A'), live('v2', 'B')]]);
  await watcher.tick(); // baseline {v1}
  await watcher.tick(); // null → skip, baseline still {v1}
  await watcher.tick(); // v2 new → announce (A not re-announced)
  assert.equal(sent.length, 1);
  assert.equal(titleOf(sent[0]), 'YouTube에서 B님이 Deadly Trick 방송중!');
});

test('watcher: a streamer who goes offline and returns with a new video id is announced again', async () => {
  const { watcher, sent } = harness([[live('v1', 'A')], [], [live('v2', 'A')]]);
  await watcher.tick(); // baseline {v1}
  await watcher.tick(); // gone → known {}
  await watcher.tick(); // new video id → announce
  assert.equal(sent.length, 1);
  assert.equal(titleOf(sent[0]), 'YouTube에서 A님이 Deadly Trick 방송중!');
});

test('watcher: multiple new videos in one tick each get an announcement', async () => {
  const { watcher, sent } = harness([[], [live('v1', 'A'), live('v2', 'B')]]);
  await watcher.tick(); // baseline {}
  await watcher.tick(); // A, B new → 2 announces
  assert.equal(sent.length, 2);
});

test('watcher: a search hit mentioning none of the match terms is never announced', async () => {
  const { watcher, sent } = harness(
    [[], [live('v1', 'A', { title: 'Deadly Premonition 실황' }), live('v2', 'B', { title: 'Deadly Trick 8인' })]],
    { matchTerms: ['Deadly Trick'] },
  );
  await watcher.tick(); // baseline {}
  await watcher.tick(); // only B mentions the game
  assert.equal(sent.length, 1);
  assert.equal(titleOf(sent[0]), 'YouTube에서 B님이 Deadly Trick 방송중!');
});

test('watcher: an unmatched live stays unannounced even after it is filtered out of the baseline', async () => {
  const { watcher, sent } = harness(
    [[live('v1', 'A', { title: '무관한 방송' })], [live('v1', 'A', { title: '무관한 방송' })]],
    { matchTerms: ['Deadly Trick'] },
  );
  await watcher.tick();
  await watcher.tick();
  assert.equal(sent.length, 0);
});

test('watcher: lives below minViewers are ignored until they cross it', async () => {
  const { watcher, sent } = harness(
    [[live('v1', 'A', { viewers: 0 })], [live('v1', 'A', { viewers: 5 })]],
    { minViewers: 3 },
  );
  await watcher.tick(); // baseline: below min → known {}
  await watcher.tick(); // now 5 ≥ 3 and not known → announce
  assert.equal(sent.length, 1);
  assert.equal(titleOf(sent[0]), 'YouTube에서 A님이 Deadly Trick 방송중!');
});
