import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchPlayerCount } from '../src/steam.js';

const okResponse = (body) => ({ ok: true, status: 200, json: async () => body });

test('fetchPlayerCount: result:1 returns player_count', async () => {
  const fetch = async () => okResponse({ response: { player_count: 12, result: 1 } });
  assert.equal(await fetchPlayerCount(4398540, { fetch }), 12);
});

test('fetchPlayerCount: hits the GetNumberOfCurrentPlayers endpoint with the appid', async () => {
  let calledUrl;
  const fetch = async (url) => {
    calledUrl = url;
    return okResponse({ response: { player_count: 3, result: 1 } });
  };
  await fetchPlayerCount(4398540, { fetch });
  assert.match(calledUrl, /GetNumberOfCurrentPlayers/);
  assert.match(calledUrl, /appid=4398540/);
});

test('fetchPlayerCount: result:0 (no data) returns null', async () => {
  const fetch = async () => okResponse({ response: { result: 0 } });
  assert.equal(await fetchPlayerCount(4398540, { fetch }), null);
});

test('fetchPlayerCount: non-200 returns null', async () => {
  const fetch = async () => ({ ok: false, status: 429, json: async () => ({}) });
  assert.equal(await fetchPlayerCount(4398540, { fetch }), null);
});

test('fetchPlayerCount: malformed JSON returns null', async () => {
  const fetch = async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } });
  assert.equal(await fetchPlayerCount(4398540, { fetch }), null);
});

test('fetchPlayerCount: network error returns null', async () => {
  const fetch = async () => { throw new Error('ECONNRESET'); };
  assert.equal(await fetchPlayerCount(4398540, { fetch }), null);
});
