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
      { user_id: '1', user_name: 'Aris', user_login: 'aris', viewer_count: 42, title: 'live!' },
    ] })],
  ]);
  const client = createTwitchClient({ clientId: 'c', clientSecret: 's', fetch });

  const streams = await client.fetchStreams('777');

  assert.deepEqual(streams, [
    { userId: '1', userName: 'Aris', login: 'aris', viewerCount: 42, title: 'live!' },
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
