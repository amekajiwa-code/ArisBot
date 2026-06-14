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

test('loadConfig: steam alert defaults (channel id absent → feature off)', () => {
  const c = loadConfig(base);
  assert.equal(c.steamAlertChannelId, null);
  assert.equal(c.steamAppId, '4398540');
  assert.equal(c.steamPollIntervalSec, 600);
  assert.equal(c.steamAlertThreshold, 5);
  assert.equal(c.steamAlertMinCount, 10);
});

test('loadConfig: steam alert values from env', () => {
  const c = loadConfig({
    ...base,
    STEAM_ALERT_CHANNEL_ID: '1512696743286931617',
    STEAM_APP_ID: '730',
    STEAM_POLL_INTERVAL_SEC: '120',
    STEAM_ALERT_THRESHOLD: '3',
    STEAM_ALERT_MIN_COUNT: '50',
  });
  assert.equal(c.steamAlertChannelId, '1512696743286931617');
  assert.equal(c.steamAppId, '730');
  assert.equal(c.steamPollIntervalSec, 120);
  assert.equal(c.steamAlertThreshold, 3);
  assert.equal(c.steamAlertMinCount, 50);
});

test('loadConfig: steam numeric vars fall back to defaults when not a number', () => {
  const c = loadConfig({
    ...base,
    STEAM_POLL_INTERVAL_SEC: 'abc',
    STEAM_ALERT_THRESHOLD: '',
    STEAM_ALERT_MIN_COUNT: 'x',
  });
  assert.equal(c.steamPollIntervalSec, 600);
  assert.equal(c.steamAlertThreshold, 5);
  assert.equal(c.steamAlertMinCount, 10);
});
