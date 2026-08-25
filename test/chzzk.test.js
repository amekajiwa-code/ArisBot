import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createChzzkClient, summarizeDepth } from '../src/chzzk.js';

// Raw /open/v1/lives item (flat channelId/channelName, as the OFFICIAL API returns).
const item = (channelId, name, category, opts = {}) => ({
  liveId: opts.liveId ?? 1,
  liveTitle: opts.title ?? 't',
  concurrentUserCount: opts.viewers ?? 0,
  categoryType: 'GAME',
  liveCategory: category,
  liveCategoryValue: opts.categoryValue ?? category,
  channelId,
  channelName: name,
});

// A fetch returning one fixed body, recording calls.
function fakeOk(body) {
  const calls = [];
  const fetch = async (url, opts) => {
    calls.push({ url, opts });
    return { ok: true, status: 200, json: async () => body };
  };
  return { fetch, calls };
}

// A fetch serving sequential pages; `next` query param is the page index.
function paged(seq) {
  const calls = [];
  const fetch = async (url, opts) => {
    calls.push({ url, opts });
    const next = new URL(url).searchParams.get('next');
    const idx = next ? Number(next) : 0;
    const p = seq[idx];
    return { ok: true, status: 200, json: async () => ({ content: { data: p.data, page: { next: p.next } } }) };
  };
  return { fetch, calls };
}

test('client: fetchLivesPage maps content.data and exposes page.next, with client-auth headers', async () => {
  const { fetch, calls } = fakeOk({
    code: 200,
    content: {
      data: [item('c1', 'A', 'Deadly_Trick', { viewers: 5, title: 'hi', categoryValue: '데일리 트릭' })],
      page: { next: 'NX' },
    },
  });
  const client = createChzzkClient({ clientId: 'id', clientSecret: 'sec', fetch });

  const { lives, next } = await client.fetchLivesPage();

  assert.equal(next, 'NX');
  assert.deepEqual(lives, [{
    channelId: 'c1', channelName: 'A', liveTitle: 'hi', concurrentUserCount: 5,
    liveCategory: 'Deadly_Trick', liveCategoryValue: '데일리 트릭', categoryType: 'GAME',
  }]);
  assert.equal(calls[0].opts.headers['Client-Id'], 'id');
  assert.equal(calls[0].opts.headers['Client-Secret'], 'sec');
  assert.equal(calls[0].opts.headers['Content-Type'], 'application/json');
  assert.ok(calls[0].url.startsWith('https://openapi.chzzk.naver.com/open/v1/lives'));
});

test('client: fetchCategoryLives paginates and keeps only the target category', async () => {
  const { fetch } = paged([
    { data: [item('c1', 'A', 'League_of_Legends'), item('c2', 'B', 'Deadly_Trick')], next: '1' },
    { data: [item('c3', 'C', 'Deadly_Trick'), item('c4', 'D', 'Just_Chatting')], next: null },
  ]);
  const client = createChzzkClient({ clientId: 'id', clientSecret: 'sec', fetch });

  const found = await client.fetchCategoryLives('Deadly_Trick', { maxPages: 10 });

  assert.deepEqual(found.map((l) => l.channelId), ['c2', 'c3']);
});

test('client: fetchCategoryLives respects the maxPages cap', async () => {
  const { fetch, calls } = paged([
    { data: [item('c2', 'B', 'Deadly_Trick')], next: '1' },
    { data: [item('c3', 'C', 'Deadly_Trick')], next: '2' },
    { data: [item('c4', 'D', 'Deadly_Trick')], next: null },
  ]);
  const client = createChzzkClient({ clientId: 'id', clientSecret: 'sec', fetch });

  const found = await client.fetchCategoryLives('Deadly_Trick', { maxPages: 2 });

  assert.deepEqual(found.map((l) => l.channelId), ['c2', 'c3']);
  assert.equal(calls.length, 2);
});

test('client: fetchCategoryLives stops when there is no next cursor', async () => {
  const { fetch, calls } = paged([
    { data: [item('c2', 'B', 'Deadly_Trick')], next: null },
  ]);
  const client = createChzzkClient({ clientId: 'id', clientSecret: 'sec', fetch });

  const found = await client.fetchCategoryLives('Deadly_Trick', { maxPages: 10 });

  assert.equal(found.length, 1);
  assert.equal(calls.length, 1);
});

// ── summarizeDepth: "상위 N개만 훑는" 한계가 알림에 영향이 있는지 판단
const page = (...counts) => counts.map((c) => ({ concurrentUserCount: c }));

test('summarizeDepth: 끝자락이 하한 아래면 커버된 것으로 본다', () => {
  const s = summarizeDepth([page(500, 300), page(120, 80), page(45, 20)], 50);

  assert.equal(s.scanned, 6);
  assert.equal(s.lowest, 20);
  assert.equal(s.covered, true, '20명 < 50명 → 그 아래는 볼 필요 없음');
  assert.equal(s.pagesNeeded, 3, '하한 아래로 처음 내려간 페이지');
  assert.deepEqual(s.rows.map((r) => [r.page, r.cumulative, r.lowest]), [
    [1, 2, 300], [2, 4, 80], [3, 6, 20],
  ]);
});

test('summarizeDepth: 끝까지 하한 위면 더 훑어야 한다고 본다', () => {
  const s = summarizeDepth([page(900, 700), page(300, 120)], 50);

  assert.equal(s.covered, false, '120명으로 끝났으면 아래에 50명 넘는 방송이 남아 있을 수 있다');
  assert.equal(s.pagesNeeded, null);
});

test('summarizeDepth: 하한과 같은 값은 아직 커버가 아니다 (하한은 이상 조건)', () => {
  assert.equal(summarizeDepth([page(80, 50)], 50).covered, false);
  assert.equal(summarizeDepth([page(80, 49)], 50).covered, true);
});

test('summarizeDepth: 빈 페이지는 세지 않는다', () => {
  const s = summarizeDepth([page(100, 60), [], page(10)], 50);
  assert.deepEqual(s.rows.map((r) => r.page), [1, 3]);
  assert.equal(s.scanned, 3);
});

test('summarizeDepth: 스캔 결과가 아예 없으면 판단하지 않는다', () => {
  const s = summarizeDepth([], 50);
  assert.equal(s.lowest, null);
  assert.equal(s.covered, false);
});
