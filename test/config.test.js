import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, ConfigError } from '../src/config.js';

const base = {
  DISCORD_BOT_TOKEN: 'tok',
};

test('loadConfig returns config for valid env', () => {
  const c = loadConfig(base);
  assert.equal(c.discordToken, 'tok');
});

test('loadConfig throws ConfigError when DISCORD_BOT_TOKEN is missing', () => {
  assert.throws(() => loadConfig({ ...base, DISCORD_BOT_TOKEN: '' }), ConfigError);
  assert.throws(() => loadConfig({}), ConfigError);
});

test('loadConfig: steam alert defaults (channel id absent → feature off)', () => {
  const c = loadConfig(base);
  assert.equal(c.steamAlertChannelId, null);
  assert.equal(c.steamAppId, '3088400');
  assert.equal(c.steamGameName, 'Deadly Trick');
  assert.equal(c.steamPollIntervalSec, 600);
  assert.equal(c.steamAlertThreshold, 25);
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
  assert.equal(c.steamAlertThreshold, 25);
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
  assert.equal(c.twitchAlertMinViewers, 50);
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
  assert.equal(c.chzzkAlertMinViewers, 50);
  assert.equal(c.chzzkMaxPages, 50);
});

test('loadConfig: chzzk alert channel falls back to the steam channel when unset', () => {
  const c = loadConfig({ ...base, STEAM_ALERT_CHANNEL_ID: '999' });
  assert.equal(c.chzzkAlertChannelId, '999');
});

test('loadConfig: CHZZK_ALERT_CHANNEL_ID overrides the steam fallback', () => {
  const c = loadConfig({ ...base, STEAM_ALERT_CHANNEL_ID: '999', CHZZK_ALERT_CHANNEL_ID: '222' });
  assert.equal(c.chzzkAlertChannelId, '222');
});

test('loadConfig: youtube alert defaults (no api key → feature off)', () => {
  const c = loadConfig(base);
  assert.equal(c.youtubeApiKey, null);
  assert.equal(c.youtubeAlertChannelId, null);
  assert.equal(c.youtubeSearchQuery, '"Deadly Trick"|"데들리 트릭"|"デッドリートリック"');
  assert.deepEqual(c.youtubeMatchTerms, ['Deadly Trick', '데들리 트릭', 'デッドリートリック']);
  assert.equal(c.youtubeCategoryName, 'Deadly Trick');
  assert.equal(c.youtubePollIntervalSec, 900);
  assert.equal(c.youtubeAlertMinViewers, 30);
});

test('loadConfig: youtube alert channel falls back to the steam channel when unset', () => {
  const c = loadConfig({ ...base, STEAM_ALERT_CHANNEL_ID: '999' });
  assert.equal(c.youtubeAlertChannelId, '999');
});

test('loadConfig: YOUTUBE_ALERT_CHANNEL_ID overrides the steam fallback', () => {
  const c = loadConfig({ ...base, STEAM_ALERT_CHANNEL_ID: '999', YOUTUBE_ALERT_CHANNEL_ID: '333' });
  assert.equal(c.youtubeAlertChannelId, '333');
});

test('loadConfig: youtube alert values from env', () => {
  const c = loadConfig({
    ...base,
    YOUTUBE_API_KEY: 'ykey',
    YOUTUBE_SEARCH_QUERY: '"Among Us"',
    YOUTUBE_MATCH_TERMS: 'Among Us, 어몽어스',
    YOUTUBE_CATEGORY_NAME: 'Among Us',
    YOUTUBE_POLL_INTERVAL_SEC: '1200',
    YOUTUBE_ALERT_MIN_VIEWERS: '3',
  });
  assert.equal(c.youtubeApiKey, 'ykey');
  assert.equal(c.youtubeSearchQuery, '"Among Us"');
  assert.deepEqual(c.youtubeMatchTerms, ['Among Us', '어몽어스'], 'trims whitespace around commas');
  assert.equal(c.youtubeCategoryName, 'Among Us');
  assert.equal(c.youtubePollIntervalSec, 1200);
  assert.equal(c.youtubeAlertMinViewers, 3);
});

test('loadConfig: an empty YOUTUBE_MATCH_TERMS disables the keyword filter', () => {
  const c = loadConfig({ ...base, YOUTUBE_MATCH_TERMS: '  ' });
  assert.deepEqual(c.youtubeMatchTerms, []);
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

test('loadConfig: 비리비리·니코니코 알림 기본값 (채널 없으면 꺼짐)', () => {
  const c = loadConfig(base);
  assert.equal(c.bilibiliAlertEnabled, true);
  assert.equal(c.bilibiliAlertChannelId, null, '채널이 없으면 켜지지 않는다');
  assert.equal(c.bilibiliAlertMinViewers, 1000, '비리비리 online 값은 크게 부풀려져 하한도 높다');
  assert.equal(c.bilibiliCategoryName, 'Deadly Trick');
  assert.equal(c.nicoAlertEnabled, true);
  assert.equal(c.nicoAlertMinViewers, 1000);
});

test('loadConfig: 같은 방송 재알림 금지 기간은 기본 6시간', () => {
  assert.equal(loadConfig(base).liveAlertCooldownSec, 21600);
  assert.equal(loadConfig({ ...base, LIVE_ALERT_COOLDOWN_SEC: '60' }).liveAlertCooldownSec, 60);
});

test('loadConfig: 두 플랫폼 알림 채널은 Steam 채널로 폴백한다 (다른 알림과 동일)', () => {
  const c = loadConfig({ ...base, STEAM_ALERT_CHANNEL_ID: '111' });
  assert.equal(c.bilibiliAlertChannelId, '111');
  assert.equal(c.nicoAlertChannelId, '111');

  const own = loadConfig({ ...base, STEAM_ALERT_CHANNEL_ID: '111', NICO_ALERT_CHANNEL_ID: '222' });
  assert.equal(own.nicoAlertChannelId, '222');
});

test('loadConfig: *_ALERT_ENABLED=0 이면 채널이 있어도 끈다', () => {
  const c = loadConfig({ ...base, STEAM_ALERT_CHANNEL_ID: '111', BILIBILI_ALERT_ENABLED: '0' });
  assert.equal(c.bilibiliAlertEnabled, false);
  assert.equal(c.nicoAlertEnabled, true, '한쪽만 끈다');
});

test('loadConfig: 공통 오탐 필터는 MATCH_TERMS → YOUTUBE_MATCH_TERMS → 기본값 순', () => {
  assert.deepEqual(loadConfig(base).matchTerms, ['Deadly Trick', '데들리 트릭', 'デッドリートリック']);
  assert.deepEqual(loadConfig({ ...base, YOUTUBE_MATCH_TERMS: 'A,B' }).matchTerms, ['A', 'B']);
  assert.deepEqual(loadConfig({ ...base, YOUTUBE_MATCH_TERMS: 'A', MATCH_TERMS: 'C' }).matchTerms, ['C']);
});

test('loadConfig: 기록기 기본값', () => {
  const c = loadConfig(base);
  assert.equal(c.recorderEnabled, true);
  assert.equal(c.streamLogPath, 'data/streams.json');
  assert.equal(c.recorderPollIntervalSec, 60);
  assert.equal(c.recorderRetentionDays, 14);
  assert.equal(c.recorderSessionGapSec, 1800);
  assert.equal(loadConfig({ ...base, RECORDER_ENABLED: '0' }).recorderEnabled, false);
});
