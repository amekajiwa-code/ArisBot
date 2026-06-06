import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { loadConfig, ConfigError } from '../src/config.js';

const base = {
  DISCORD_BOT_TOKEN: 'tok',
  ALLOWED_USER_ID: '123',
  PROJECT_DIR: os.tmpdir(),
};

test('loadConfig returns config for valid env', () => {
  const c = loadConfig(base);
  assert.equal(c.discordToken, 'tok');
  assert.equal(c.allowedUserId, '123');
  assert.equal(c.projectDir, os.tmpdir());
  assert.equal(c.notifyPort, 8787);
  assert.equal(c.notifySecret, null);
  assert.equal(c.maxPrompt, 4000);
});

test('loadConfig throws ConfigError when a required var is missing', () => {
  assert.throws(() => loadConfig({ ...base, DISCORD_BOT_TOKEN: '' }), ConfigError);
  assert.throws(() => loadConfig({ ...base, ALLOWED_USER_ID: '' }), ConfigError);
  assert.throws(() => loadConfig({ ...base, PROJECT_DIR: '' }), ConfigError);
});

test('loadConfig throws when PROJECT_DIR is not an existing directory', () => {
  assert.throws(
    () => loadConfig({ ...base, PROJECT_DIR: os.tmpdir() + '/__aris_nope_zzz__' }),
    ConfigError,
  );
});

test('loadConfig guards NOTIFY_PORT against NaN', () => {
  const withAbc = loadConfig({ ...base, NOTIFY_PORT: 'abc' });
  assert.equal(withAbc.notifyPort, 8787);

  const with9000 = loadConfig({ ...base, NOTIFY_PORT: '9000' });
  assert.equal(with9000.notifyPort, 9000);
});
