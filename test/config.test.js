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
  assert.equal(c.chzzkMaxPages, 15);
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
  assert.equal(c.youtubeAlertMinViewers, 50);
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

test('loadConfig: TTS is off until VOICEVOX_BASE_URL is set', () => {
  const c = loadConfig(base);
  assert.equal(c.voicevoxBaseUrl, null);
  assert.equal(c.ttsMessagePrefix, null);
  assert.equal(c.ttsCommandGuildId, null);
});

test('loadConfig: TTS defaults (Zundamon normal, 200 chars, 5 min idle)', () => {
  const c = loadConfig({ ...base, VOICEVOX_BASE_URL: 'http://127.0.0.1:50021' });
  assert.equal(c.voicevoxBaseUrl, 'http://127.0.0.1:50021');
  assert.equal(c.voicevoxSpeaker, 3);
  assert.equal(c.voicevoxSpeedScale, 1.0);
  assert.equal(c.voicevoxPitchScale, 0.0);
  assert.equal(c.voicevoxIntonationScale, 1.0);
  assert.equal(c.voicevoxVolumeScale, 1.0);
  assert.equal(c.voicevoxTimeoutSec, 20);
  assert.equal(c.ttsMaxLength, 200);
  assert.equal(c.ttsIdleTimeoutSec, 300);
});

test('loadConfig: TTS values from env', () => {
  const c = loadConfig({
    ...base,
    VOICEVOX_BASE_URL: 'http://voicevox:50021/',
    VOICEVOX_SPEAKER: '1',
    VOICEVOX_SPEED_SCALE: '1.2',
    VOICEVOX_PITCH_SCALE: '0.03',
    VOICEVOX_INTONATION_SCALE: '1.5',
    VOICEVOX_VOLUME_SCALE: '0.9',
    VOICEVOX_TIMEOUT_SEC: '30',
    TTS_MAX_LENGTH: '120',
    TTS_IDLE_TIMEOUT_SEC: '60',
    TTS_COMMAND_GUILD_ID: '999',
    TTS_MESSAGE_PREFIX: 'say:',
  });
  assert.equal(c.voicevoxBaseUrl, 'http://voicevox:50021/');
  assert.equal(c.voicevoxSpeaker, 1);
  assert.equal(c.voicevoxSpeedScale, 1.2);
  assert.equal(c.voicevoxPitchScale, 0.03);
  assert.equal(c.voicevoxIntonationScale, 1.5);
  assert.equal(c.voicevoxVolumeScale, 0.9);
  assert.equal(c.voicevoxTimeoutSec, 30);
  assert.equal(c.ttsMaxLength, 120);
  assert.equal(c.ttsIdleTimeoutSec, 60);
  assert.equal(c.ttsCommandGuildId, '999');
  assert.equal(c.ttsMessagePrefix, 'say:');
});

test('loadConfig: GPT-SoVITS defaults (Korean text, Japanese reference)', () => {
  const c = loadConfig({
    ...base,
    GPT_SOVITS_BASE_URL: 'http://gpu-box:9880',
    GPT_SOVITS_REF_AUDIO_PATH: '/opt/zundamon/reference.wav',
  });
  assert.equal(c.gptSovitsBaseUrl, 'http://gpu-box:9880');
  assert.equal(c.gptSovitsRefAudioPath, '/opt/zundamon/reference.wav');
  assert.equal(c.gptSovitsTextLang, 'all_ko');
  assert.equal(c.gptSovitsPromptLang, 'all_ja');
  assert.equal(c.gptSovitsPromptText, '');
  assert.equal(c.gptSovitsSpeedFactor, 1.0);
  assert.equal(c.gptSovitsTimeoutSec, 60);
});

test('loadConfig: GPT-SoVITS values from env', () => {
  const c = loadConfig({
    ...base,
    GPT_SOVITS_BASE_URL: 'http://gpu-box:9880',
    GPT_SOVITS_REF_AUDIO_PATH: '/ref.wav',
    GPT_SOVITS_PROMPT_TEXT: '流し切りが完全に入れば',
    GPT_SOVITS_PROMPT_LANG: 'all_ja',
    GPT_SOVITS_TEXT_LANG: 'ko',
    GPT_SOVITS_SPEED_FACTOR: '1.15',
    GPT_SOVITS_TIMEOUT_SEC: '90',
  });
  assert.equal(c.gptSovitsPromptText, '流し切りが完全に入れば');
  assert.equal(c.gptSovitsTextLang, 'ko');
  assert.equal(c.gptSovitsSpeedFactor, 1.15);
  assert.equal(c.gptSovitsTimeoutSec, 90);
});

test('loadConfig: GPT-SoVITS without a reference audio is rejected up front', () => {
  // 참조 음성이 없으면 목소리가 정해지지 않아 첫 /say 에서야 터진다 — 기동 때 막는다.
  assert.throws(
    () => loadConfig({ ...base, GPT_SOVITS_BASE_URL: 'http://gpu-box:9880' }),
    ConfigError,
  );
  assert.throws(
    () => loadConfig({ ...base, GPT_SOVITS_BASE_URL: 'http://gpu-box:9880', GPT_SOVITS_REF_AUDIO_PATH: '  ' }),
    /GPT_SOVITS_REF_AUDIO_PATH/,
  );
});
