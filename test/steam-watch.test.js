import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldNotify, formatMessage, createSteamWatcher } from '../src/steam-watch.js';

// Build a watcher whose fetchCount yields the given sequence (one per tick),
// and a send spy that records every alert text.
function harness(sequence, { threshold = 5, minCount = 10, appId = 1 } = {}) {
  const seq = [...sequence];
  const sent = [];
  const watcher = createSteamWatcher({
    fetchCount: async () => (seq.length ? seq.shift() : null),
    send: async (text) => { sent.push(text); },
    threshold,
    minCount,
    appId,
  });
  return { watcher, sent };
}

// shouldNotify(lastNotified, current, threshold, minCount)

test('shouldNotify: no baseline yet → false', () => {
  assert.equal(shouldNotify(null, 12, 5, 10), false);
});

test('shouldNotify: change below threshold → false', () => {
  assert.equal(shouldNotify(12, 16, 5, 10), false); // +4
  assert.equal(shouldNotify(20, 16, 5, 10), false); // -4
});

test('shouldNotify: change exactly at threshold (current ≥ min) → true', () => {
  assert.equal(shouldNotify(12, 17, 5, 10), true); // +5
  assert.equal(shouldNotify(20, 15, 5, 10), true); // -5
});

test('shouldNotify: change above threshold → true', () => {
  assert.equal(shouldNotify(12, 30, 5, 10), true); // +18
});

test('shouldNotify: no change → false', () => {
  assert.equal(shouldNotify(12, 12, 5, 10), false);
});

test('shouldNotify: current below minCount → false even if delta ≥ threshold', () => {
  assert.equal(shouldNotify(14, 7, 5, 10), false);  // -7 but 7 < 10
  assert.equal(shouldNotify(3, 9, 5, 10), false);   // +6 but 9 < 10
});

test('shouldNotify: current exactly at minCount with delta ≥ threshold → true', () => {
  assert.equal(shouldNotify(4, 10, 5, 10), true); // +6, current == min
});

test('formatMessage: rising count shows signed +delta and the app link', () => {
  const msg = formatMessage({ current: 17, last: 12, appId: 4398540 });
  assert.match(msg, /17명/);
  assert.match(msg, /직전 알림 12명/);
  assert.match(msg, /\+5/);
  assert.match(msg, /steamdb\.info\/app\/4398540/);
});

test('formatMessage: falling count shows signed -delta', () => {
  const msg = formatMessage({ current: 15, last: 20, appId: 4398540 });
  assert.match(msg, /15명/);
  assert.match(msg, /-5/);
});

test('watcher: first tick sets the baseline and sends nothing', async () => {
  const { watcher, sent } = harness([12]);
  await watcher.tick();
  assert.equal(sent.length, 0);
  assert.equal(watcher.lastNotified, 12);
});

test('watcher: crossing threshold sends once and rebaselines', async () => {
  const { watcher, sent } = harness([12, 17, 19]);
  await watcher.tick(); // baseline 12, no send
  await watcher.tick(); // 17 (+5) → send, baseline 17
  await watcher.tick(); // 19 (+2) → quiet
  assert.equal(sent.length, 1);
  assert.match(sent[0], /17명/);
  assert.equal(watcher.lastNotified, 17);
});

test('watcher: a big jump alerts once with the full delta', async () => {
  const { watcher, sent } = harness([12, 30]);
  await watcher.tick();
  await watcher.tick();
  assert.equal(sent.length, 1);
  assert.match(sent[0], /\+18/);
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

test('watcher: stays quiet while below minCount even past threshold', async () => {
  const { watcher, sent } = harness([12, 4]);
  await watcher.tick(); // baseline 12
  await watcher.tick(); // 4 (-8) but 4 < 10 → no send, baseline unchanged
  assert.equal(sent.length, 0);
  assert.equal(watcher.lastNotified, 12);
});
