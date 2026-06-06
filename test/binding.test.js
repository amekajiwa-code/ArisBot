import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBindingStore } from '../src/binding.js';

test('get returns null when no binding file exists', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'aris-'));
  const store = createBindingStore(path.join(dir, 'binding.json'));
  assert.equal(store.get(), null);
  rmSync(dir, { recursive: true, force: true });
});

test('set then get returns the channel id (roundtrip + update)', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'aris-'));
  const store = createBindingStore(path.join(dir, 'binding.json'));
  store.set('chan-1');
  assert.equal(store.get(), 'chan-1');
  store.set('chan-2');
  assert.equal(store.get(), 'chan-2');
  rmSync(dir, { recursive: true, force: true });
});
