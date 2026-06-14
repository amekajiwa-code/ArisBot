import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createChzzkClient } from '../src/chzzk.js';

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
