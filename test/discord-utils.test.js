import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitMessage } from '../src/discord-utils.js';

test('short text stays a single chunk', () => {
  assert.deepEqual(splitMessage('hello'), ['hello']);
});

test('keeps chunks within the limit on newline boundaries', () => {
  const chunks = splitMessage('a\nb\nc', 3);
  assert.ok(chunks.every((c) => c.length <= 3));
  assert.equal(chunks.join('\n'), 'a\nb\nc');
});

test('hard-splits a single oversized line', () => {
  assert.deepEqual(splitMessage('x'.repeat(10), 4), ['xxxx', 'xxxx', 'xx']);
});

test('empty string yields one empty chunk', () => {
  assert.deepEqual(splitMessage(''), ['']);
});
