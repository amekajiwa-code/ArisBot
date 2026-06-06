import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commandDefs } from '../src/commands.js';

test('defines exactly /start and /talk', () => {
  const names = commandDefs.map((c) => c.name).sort();
  assert.deepEqual(names, ['start', 'talk']);
});

test('/talk has a required message option', () => {
  const talk = commandDefs.find((c) => c.name === 'talk');
  const opt = talk.options.find((o) => o.name === 'message');
  assert.ok(opt, 'message option exists');
  assert.equal(opt.required, true);
});
