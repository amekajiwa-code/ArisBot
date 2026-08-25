import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTwitchClient } from '../src/twitch.js';

// A fake fetch that routes by URL substring and records every call.
function fakeFetch(routes) {
  const calls = [];
  const fetch = async (url, opts) => {
    calls.push({ url, opts });
    for (const [match, respond] of routes) {
      if (url.includes(match)) return respond();
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return { fetch, calls };
}
const ok = (body) => ({ ok: true, status: 200, json: async () => body });

test('client: requests an app token then resolves a game id by name', async () => {
  const { fetch, calls } = fakeFetch([
    ['oauth2/token', () => ok({ access_token: 'TIB', expires_in: 3600 })],
    ['/games', () => ok({ data: [{ id: '777', name: 'Deadly Trick' }] })],
  ]);
  const client = createTwitchClient({ clientId: 'cid', clientSecret: 'sec', fetch });

  const id = await client.resolveGameId('Deadly Trick');

  assert.equal(id, '777');
  assert.ok(calls[0].url.includes('grant_type=client_credentials'));
  assert.equal(calls[0].opts.method, 'POST');
  assert.equal(calls[1].opts.headers.Authorization, 'Bearer TIB');
  assert.equal(calls[1].opts.headers['Client-Id'], 'cid');
});

test('client: resolveGameId returns null when the category is unknown', async () => {
  const { fetch } = fakeFetch([
    ['oauth2/token', () => ok({ access_token: 'T', expires_in: 3600 })],
    ['/games', () => ok({ data: [] })],
  ]);
  const client = createTwitchClient({ clientId: 'c', clientSecret: 's', fetch });
  assert.equal(await client.resolveGameId('Nope'), null);
});

test('client: fetchStreams maps the Helix payload to compact stream objects', async () => {
  const { fetch } = fakeFetch([
    ['oauth2/token', () => ok({ access_token: 'T', expires_in: 3600 })],
    ['/streams', () => ok({ data: [
      {
        user_id: '1', user_name: 'Aris', user_login: 'aris',
        viewer_count: 42, title: 'live!', started_at: '2026-08-25T09:00:00Z',
      },
    ] })],
  ]);
  const client = createTwitchClient({ clientId: 'c', clientSecret: 's', fetch });

  const streams = await client.fetchStreams('777');

  assert.deepEqual(streams, [
    {
      userId: '1', userName: 'Aris', login: 'aris',
      viewerCount: 42, title: 'live!', startedAt: '2026-08-25T09:00:00Z',
    },
  ]);
});

test('client: reuses the cached token across calls', async () => {
  let tokenHits = 0;
  const { fetch } = fakeFetch([
    ['oauth2/token', () => { tokenHits++; return ok({ access_token: 'T', expires_in: 3600 }); }],
    ['/streams', () => ok({ data: [] })],
    ['/games', () => ok({ data: [] })],
  ]);
  const client = createTwitchClient({ clientId: 'c', clientSecret: 's', fetch });

  await client.fetchStreams('1');
  await client.resolveGameId('x');

  assert.equal(tokenHits, 1);
});

test('client: refreshes the token once on a 401 and retries the request', async () => {
  let tokenHits = 0;
  let streamHits = 0;
  const { fetch } = fakeFetch([
    ['oauth2/token', () => { tokenHits++; return ok({ access_token: `T${tokenHits}`, expires_in: 3600 }); }],
    ['/streams', () => {
      streamHits++;
      if (streamHits === 1) return { ok: false, status: 401, json: async () => ({}) };
      return ok({ data: [] });
    }],
  ]);
  const client = createTwitchClient({ clientId: 'c', clientSecret: 's', fetch });

  const streams = await client.fetchStreams('1');

  assert.deepEqual(streams, []);
  assert.equal(tokenHits, 2);  // initial + refresh
  assert.equal(streamHits, 2); // initial 401 + retry
});

test('client: fetchVideos lists a category\'s past broadcasts newest-first', async () => {
  const { fetch, calls } = fakeFetch([
    ['oauth2/token', () => ok({ access_token: 'T', expires_in: 3600 })],
    ['/videos', () => ok({ data: [{
      id: 'v9', user_id: '1', user_name: 'Aris', user_login: 'aris',
      title: '어제 방송', url: 'https://www.twitch.tv/videos/v9',
      published_at: '2026-08-24T09:00:00Z', view_count: 300, duration: '3h20m',
    }] })],
  ]);
  const client = createTwitchClient({ clientId: 'c', clientSecret: 's', fetch });

  const videos = await client.fetchVideos('777');

  const u = new URL(calls[1].url);
  assert.equal(u.searchParams.get('game_id'), '777');
  assert.equal(u.searchParams.get('period'), 'week');
  assert.equal(u.searchParams.get('sort'), 'time');
  assert.equal(u.searchParams.get('type'), 'archive');
  assert.deepEqual(videos, [{
    id: 'v9', userId: '1', userName: 'Aris', login: 'aris',
    title: '어제 방송', url: 'https://www.twitch.tv/videos/v9',
    publishedAt: '2026-08-24T09:00:00Z', viewCount: 300, duration: '3h20m',
  }]);
});

test('client: fetchVideos follows the pagination cursor up to maxPages', async () => {
  let page = 0;
  const { fetch, calls } = fakeFetch([
    ['oauth2/token', () => ok({ access_token: 'T', expires_in: 3600 })],
    ['/videos', () => {
      page++;
      return ok({
        data: [{ id: `v${page}`, user_id: String(page), user_name: `U${page}`, user_login: `u${page}` }],
        pagination: { cursor: `c${page}` },
      });
    }],
  ]);
  const client = createTwitchClient({ clientId: 'c', clientSecret: 's', fetch });

  const videos = await client.fetchVideos('777', { maxPages: 3 });

  assert.deepEqual(videos.map((v) => v.id), ['v1', 'v2', 'v3']);
  assert.equal(new URL(calls[3].url).searchParams.get('after'), 'c2');
});

test('client: fetchStreams pages only when asked, and stops without a cursor', async () => {
  let hits = 0;
  const { fetch } = fakeFetch([
    ['oauth2/token', () => ok({ access_token: 'T', expires_in: 3600 })],
    ['/streams', () => { hits++; return ok({ data: [{ user_id: String(hits) }] }); }],
  ]);
  const client = createTwitchClient({ clientId: 'c', clientSecret: 's', fetch });

  await client.fetchStreams('777', { maxPages: 5 });

  assert.equal(hits, 1);   // no pagination.cursor in the response → single page
});
