import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAuthorized } from '../src/gate.js';

const A = { allowedUserId: 'u1', boundChannelId: 'c1' };

test('authorized when user + channel match and channel is bound', () => {
  assert.equal(isAuthorized({ userId: 'u1', channelId: 'c1', ...A }), true);
});

test('rejects wrong user', () => {
  assert.equal(isAuthorized({ userId: 'u2', channelId: 'c1', ...A }), false);
});

test('rejects wrong channel', () => {
  assert.equal(isAuthorized({ userId: 'u1', channelId: 'c2', ...A }), false);
});

test('rejects when no channel is bound', () => {
  assert.equal(
    isAuthorized({ userId: 'u1', channelId: 'c1', allowedUserId: 'u1', boundChannelId: null }),
    false,
  );
});
