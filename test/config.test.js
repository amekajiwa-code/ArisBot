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
  assert.equal(c.steamGameName, 'DEADLY TRICK DEMO');
  assert.equal(c.steamPollIntervalSec, 600);
  assert.equal(c.steamAlertThreshold, 5);
  assert.equal(c.steamAlertMinCount, 10);
});

test('loadConfig: STEAM_GAME_NAME overrides the default', () => {
  const c = loadConfig({ ...base, STEAM_GAME_NAME: 'My Game' });
  assert.equal(c.steamGameName, 'My Game');
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

test('loadConfig: twitch alert defaults (no credentials → feature off)', () => {
  const c = loadConfig(base);
  assert.equal(c.twitchClientId, null);
  assert.equal(c.twitchClientSecret, null);
  assert.equal(c.twitchAlertChannelId, null);
  assert.equal(c.twitchCategoryName, 'Deadly Trick');
  assert.equal(c.twitchGameId, null);
  assert.equal(c.twitchPollIntervalSec, 600);
  assert.equal(c.twitchAlertMinViewers, 0);
});

test('loadConfig: twitch alert channel falls back to the steam channel when unset', () => {
  const c = loadConfig({ ...base, STEAM_ALERT_CHANNEL_ID: '999' });
  assert.equal(c.twitchAlertChannelId, '999');
});

test('loadConfig: TWITCH_ALERT_CHANNEL_ID overrides the steam fallback', () => {
  const c = loadConfig({ ...base, STEAM_ALERT_CHANNEL_ID: '999', TWITCH_ALERT_CHANNEL_ID: '111' });
  assert.equal(c.twitchAlertChannelId, '111');
});

test('loadConfig: twitch alert values from env', () => {
  const c = loadConfig({
    ...base,
    TWITCH_CLIENT_ID: 'cid',
    TWITCH_CLIENT_SECRET: 'sec',
    TWITCH_CATEGORY_NAME: 'Just Chatting',
    TWITCH_GAME_ID: '509658',
    TWITCH_POLL_INTERVAL_SEC: '120',
    TWITCH_ALERT_MIN_VIEWERS: '3',
  });
  assert.equal(c.twitchClientId, 'cid');
  assert.equal(c.twitchClientSecret, 'sec');
  assert.equal(c.twitchCategoryName, 'Just Chatting');
  assert.equal(c.twitchGameId, '509658');
  assert.equal(c.twitchPollIntervalSec, 120);
  assert.equal(c.twitchAlertMinViewers, 3);
});

test('loadConfig: chzzk alert defaults (no credentials → feature off)', () => {
  const c = loadConfig(base);
  assert.equal(c.chzzkClientId, null);
  assert.equal(c.chzzkClientSecret, null);
  assert.equal(c.chzzkAlertChannelId, null);
  assert.equal(c.chzzkCategoryId, 'Deadly_Trick');
  assert.equal(c.chzzkCategoryName, 'Deadly Trick');
  assert.equal(c.chzzkPollIntervalSec, 600);
  assert.equal(c.chzzkAlertMinViewers, 0);
  assert.equal(c.chzzkMaxPages, 10);
});

test('loadConfig: chzzk alert channel falls back to the steam channel when unset', () => {
  const c = loadConfig({ ...base, STEAM_ALERT_CHANNEL_ID: '999' });
  assert.equal(c.chzzkAlertChannelId, '999');
});

test('loadConfig: CHZZK_ALERT_CHANNEL_ID overrides the steam fallback', () => {
  const c = loadConfig({ ...base, STEAM_ALERT_CHANNEL_ID: '999', CHZZK_ALERT_CHANNEL_ID: '222' });
  assert.equal(c.chzzkAlertChannelId, '222');
});

test('loadConfig: chzzk alert values from env', () => {
  const c = loadConfig({
    ...base,
    CHZZK_CLIENT_ID: 'cid',
    CHZZK_CLIENT_SECRET: 'sec',
    CHZZK_CATEGORY_ID: 'League_of_Legends',
    CHZZK_CATEGORY_NAME: '리그 오브 레전드',
    CHZZK_POLL_INTERVAL_SEC: '120',
    CHZZK_ALERT_MIN_VIEWERS: '3',
    CHZZK_MAX_PAGES: '25',
  });
  assert.equal(c.chzzkClientId, 'cid');
  assert.equal(c.chzzkClientSecret, 'sec');
  assert.equal(c.chzzkCategoryId, 'League_of_Legends');
  assert.equal(c.chzzkCategoryName, '리그 오브 레전드');
  assert.equal(c.chzzkPollIntervalSec, 120);
  assert.equal(c.chzzkAlertMinViewers, 3);
  assert.equal(c.chzzkMaxPages, 25);
});
