import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLiveWatcher, buildAlert, newStreamers, idOf, COLORS } from '../src/live-watch.js';

const live = (id, over = {}) => ({
  id, streamer: `방송자${id}`, streamerId: `u${id}`,
  title: 'Deadly Trick 실황', url: `https://live.example/${id}`,
  views: 100, live: true, ...over,
});

// 보낸 알림을 받아적는 워처.
function watcher(over = {}) {
  const sent = [];
  const w = createLiveWatcher({
    send: async (p) => sent.push(p),
    categoryName: 'Deadly Trick',
    minViewers: 50,
    platform: '비리비리',
    color: COLORS.bilibili,
    matchTerms: ['Deadly Trick', 'デッドリートリック'],
    ...over,
  });
  return { w, sent, titles: () => sent.map((p) => p.embeds[0].title) };
}

// 시각을 손으로 돌리는 워처 — 재알림 억제(쿨다운) 검증용.
function clockWatcher(over = {}) {
  let t = 0;
  const sent = [];
  const w = createLiveWatcher({
    send: async (p) => sent.push(p),
    categoryName: 'Deadly Trick',
    minViewers: 50,
    platform: '비리비리',
    color: COLORS.bilibili,
    matchTerms: [],
    cooldownMs: 6 * 3600_000,
    now: () => t,
    ...over,
  });
  return { w, sent, tick: (ms = 60_000) => { t += ms; }, titles: () => sent.map((p) => p.embeds[0].title) };
}

test('idOf: 방송 키는 방송 id → 사람 id → URL 순으로 고른다', () => {
  assert.equal(idOf({ id: 'lv1', streamerId: 'u1' }), 'lv1');
  assert.equal(idOf({ streamerId: 'u1', url: 'x' }), 'u1');
  assert.equal(idOf({ url: 'x' }), 'x');
});

test('첫 push 는 기준선만 잡고 알림을 안 보낸다 (재시작해도 조용)', async () => {
  const { w, sent } = watcher();
  await w.push([live(1), live(2)]);
  assert.deepEqual(sent, []);
  assert.deepEqual([...w.known], ['1', '2']);
});

test('직전에 없던 방송만 알린다', async () => {
  const { w, titles } = watcher();
  await w.push([live(1)]);
  await w.push([live(1), live(2)]);

  assert.deepEqual(titles(), ['비리비리에서 방송자2님이 Deadly Trick 방송중!']);
});

test('시청자 하한 미만은 알리지 않고, 나중에 넘으면 그때 알린다', async () => {
  const { w, titles } = watcher();
  await w.push([]);
  await w.push([live(1, { views: 12 })]);
  assert.deepEqual(titles(), [], '12명은 하한(50) 미만');

  await w.push([live(1, { views: 300 })]);
  assert.deepEqual(titles(), ['비리비리에서 방송자1님이 Deadly Trick 방송중!']);
});

test('검색이 물어온 엉뚱한 방송은 걸러낸다', async () => {
  const { w, titles } = watcher();
  await w.push([]);
  await w.push([live(1, { title: '마인크래프트 건축' }), live(2, { title: 'デッドリートリック 実況' })]);

  assert.deepEqual(titles(), ['비리비리에서 방송자2님이 Deadly Trick 방송중!']);
});

test('matchTerms 가 비면 필터를 끈다', async () => {
  const { w, titles } = watcher({ matchTerms: [] });
  await w.push([]);
  await w.push([live(1, { title: '제목에 게임명 없음' })]);

  assert.equal(titles().length, 1);
});

test('다시보기·투고 영상(live:false)은 알림 대상이 아니다', async () => {
  const { w, titles } = watcher();
  await w.push([]);
  await w.push([live(1, { live: false })]);

  assert.deepEqual(titles(), []);
});

test('조회 실패(null)는 기준선을 흔들지 않는다', async () => {
  const { w, titles } = watcher();
  await w.push([live(1)]);
  await w.push(null);
  await w.push([live(1)]);

  assert.deepEqual(titles(), [], '실패 후 같은 방송이 그대로면 재알림 없음');
});

test('목록에서 잠깐 빠졌다 돌아와도 다시 알리지 않는다 (검색 순위 흔들림)', async () => {
  const { w, titles, tick } = clockWatcher();
  await w.push([]);
  await w.push([live(1)]);                          // 첫 알림
  for (let i = 0; i < 5; i++) {                     // 60초 폴링에서 깜빡임 반복
    tick(); await w.push([]);
    tick(); await w.push([live(1)]);
  }

  assert.deepEqual(titles(), ['비리비리에서 방송자1님이 Deadly Trick 방송중!']);
});

test('시청자수가 하한 경계에서 흔들려도 한 번만 알린다', async () => {
  const { w, titles, tick } = clockWatcher();
  await w.push([]);
  await w.push([live(1, { views: 55 })]);
  tick(); await w.push([live(1, { views: 45 })]);   // 하한(50) 아래로
  tick(); await w.push([live(1, { views: 60 })]);   // 다시 위로

  assert.equal(titles().length, 1);
});

test('쿨다운이 지나면 껐다 켠 방송을 다시 알린다', async () => {
  const { w, titles, tick } = clockWatcher();
  await w.push([]);
  await w.push([live(1)]);
  tick(6 * 3600_000 + 1000);
  await w.push([]);                                 // 방송 종료
  await w.push([live(1)]);                          // 다시 켬

  assert.equal(titles().length, 2);
});

test('알림 임베드는 다른 플랫폼과 같은 모양이다', () => {
  const payload = buildAlert(live(7), 'Deadly Trick', '니코니코', COLORS.niconico);

  assert.deepEqual(payload, {
    embeds: [{
      title: '니코니코에서 방송자7님이 Deadly Trick 방송중!',
      url: 'https://live.example/7',
      description: 'Deadly Trick 실황\nhttps://live.example/7',
      color: COLORS.niconico,
    }],
  });
});

test('링크가 없으면 제목만 담고 url 필드를 빼서 임베드가 깨지지 않게 한다', () => {
  const payload = buildAlert({ streamer: 'A', title: 't' }, '게임', '니코니코', 1);
  assert.equal(payload.embeds[0].url, undefined);
  assert.equal(payload.embeds[0].description, 't');
});

test('newStreamers: 기준선이 없으면 아무것도 알리지 않는다', () => {
  assert.deepEqual(newStreamers(null, [live(1)], 0), []);
});
