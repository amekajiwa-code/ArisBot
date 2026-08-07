// Centralized, validated configuration (notification-only cloud bot).
// loadConfig(env) is pure: returns a config object or throws ConfigError.
// getConfig() wraps it for the app entrypoint (prints help + exits on error).

export class ConfigError extends Error {}

// Game name as streamers actually type it — YouTube search phrases (| = OR) and the
// keyword list that re-checks each hit's title/description.
const YT_DEFAULT_QUERY = '"Deadly Trick"|"데들리 트릭"|"デッドリートリック"';
const YT_DEFAULT_TERMS = 'Deadly Trick,데들리 트릭,デッドリートリック';

/** "a, b , " → ["a", "b"] */
const csv = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);

export function loadConfig(env = process.env) {
  const required = (name, hint) => {
    const v = env[name]?.trim();
    if (!v) throw new ConfigError(`Missing required env var: ${name}${hint ? ` — ${hint}` : ''}`);
    return v;
  };

  const discordToken = required('DISCORD_BOT_TOKEN', 'Bot token from the Discord Developer Portal');

  // Parse an env var as a number, falling back to `fallback` when missing/NaN.
  const num = (name, fallback) => {
    const v = env[name]?.trim();
    return v && Number.isFinite(Number(v)) ? Number(v) : fallback;
  };

  // GPT-SoVITS는 few-shot 음성 복제라 참조 음성이 없으면 목소리가 정해지지 않는다.
  // 기동은 되고 첫 /say에서야 500이 떨어지므로 여기서 미리 막는다.
  const gptSovitsBaseUrl = env.GPT_SOVITS_BASE_URL?.trim() || null;
  if (gptSovitsBaseUrl && !env.GPT_SOVITS_REF_AUDIO_PATH?.trim()) {
    throw new ConfigError(
      'GPT_SOVITS_BASE_URL 을 쓰려면 GPT_SOVITS_REF_AUDIO_PATH 도 채워야 합니다 '
      + '— 즌다몬 참조 음성의 경로(봇이 아니라 API 서버 기준)',
    );
  }

  return {
    discordToken,
    // Steam player-count alert (disabled unless STEAM_ALERT_CHANNEL_ID is set).
    steamAlertChannelId: env.STEAM_ALERT_CHANNEL_ID?.trim() || null,
    steamAppId: env.STEAM_APP_ID?.trim() || '3088400',
    steamGameName: env.STEAM_GAME_NAME?.trim() || 'Deadly Trick',
    steamPollIntervalSec: num('STEAM_POLL_INTERVAL_SEC', 600),
    steamAlertThreshold: num('STEAM_ALERT_THRESHOLD', 25),
    steamAlertMinCount: num('STEAM_ALERT_MIN_COUNT', 10),
    // Twitch category live alert (disabled unless TWITCH_CLIENT_ID + TWITCH_CLIENT_SECRET are set).
    // Channel defaults to the Steam alert channel so both alerts can share one place.
    twitchClientId: env.TWITCH_CLIENT_ID?.trim() || null,
    twitchClientSecret: env.TWITCH_CLIENT_SECRET?.trim() || null,
    twitchAlertChannelId:
      env.TWITCH_ALERT_CHANNEL_ID?.trim() || env.STEAM_ALERT_CHANNEL_ID?.trim() || null,
    twitchCategoryName: env.TWITCH_CATEGORY_NAME?.trim() || 'Deadly Trick',
    twitchGameId: env.TWITCH_GAME_ID?.trim() || null,
    twitchPollIntervalSec: num('TWITCH_POLL_INTERVAL_SEC', 600),
    twitchAlertMinViewers: num('TWITCH_ALERT_MIN_VIEWERS', 50),
    // CHZZK(치지직) category live alert (disabled unless CHZZK_CLIENT_ID + CHZZK_CLIENT_SECRET are set).
    // Official Open API has no category filter, so it scans the top CHZZK_MAX_PAGES×20 lives.
    chzzkClientId: env.CHZZK_CLIENT_ID?.trim() || null,
    chzzkClientSecret: env.CHZZK_CLIENT_SECRET?.trim() || null,
    chzzkAlertChannelId:
      env.CHZZK_ALERT_CHANNEL_ID?.trim() || env.STEAM_ALERT_CHANNEL_ID?.trim() || null,
    chzzkCategoryId: env.CHZZK_CATEGORY_ID?.trim() || 'Deadly_Trick',
    chzzkCategoryName: env.CHZZK_CATEGORY_NAME?.trim() || 'Deadly Trick',
    chzzkPollIntervalSec: num('CHZZK_POLL_INTERVAL_SEC', 600),
    chzzkAlertMinViewers: num('CHZZK_ALERT_MIN_VIEWERS', 50),
    chzzkMaxPages: num('CHZZK_MAX_PAGES', 15),
    // YouTube live alert (disabled unless YOUTUBE_API_KEY is set).
    // search.list is capped at 100 calls/day, hence the 900s default interval.
    youtubeApiKey: env.YOUTUBE_API_KEY?.trim() || null,
    youtubeAlertChannelId:
      env.YOUTUBE_ALERT_CHANNEL_ID?.trim() || env.STEAM_ALERT_CHANNEL_ID?.trim() || null,
    youtubeSearchQuery: env.YOUTUBE_SEARCH_QUERY?.trim() || YT_DEFAULT_QUERY,
    // Set but blank ⇒ filter off, so an explicit "" must not fall back to the default.
    youtubeMatchTerms: csv(env.YOUTUBE_MATCH_TERMS ?? YT_DEFAULT_TERMS),
    youtubeCategoryName: env.YOUTUBE_CATEGORY_NAME?.trim() || 'Deadly Trick',
    youtubePollIntervalSec: num('YOUTUBE_POLL_INTERVAL_SEC', 900),
    youtubeAlertMinViewers: num('YOUTUBE_ALERT_MIN_VIEWERS', 50),
    // 즌다몬 TTS — 엔진 URL 중 하나를 채우면 켜진다. 둘 다 채우면 GPT-SoVITS가 이긴다.
    //
    // GPT-SoVITS(api_v2.py): 한국어를 아는 다국어 모델이라 한글을 그대로 읽는다. GPU 필요.
    // VOICEVOX: 일본어 전용이라 한글을 가타카나로 음차해 넘긴다. CPU만으로 돈다.
    gptSovitsBaseUrl,
    // 참조 음성 경로는 봇이 아니라 API 서버 쪽 파일 시스템 기준이다.
    gptSovitsRefAudioPath: env.GPT_SOVITS_REF_AUDIO_PATH?.trim() || null,
    // 참조 음성이 실제로 읽고 있는 문장. 즌다몬 참조본은 일본어라 promptLang 기본이 all_ja다.
    gptSovitsPromptText: env.GPT_SOVITS_PROMPT_TEXT?.trim() || '',
    gptSovitsPromptLang: env.GPT_SOVITS_PROMPT_LANG?.trim() || 'all_ja',
    gptSovitsTextLang: env.GPT_SOVITS_TEXT_LANG?.trim() || 'all_ko',
    gptSovitsSpeedFactor: num('GPT_SOVITS_SPEED_FACTOR', 1.0),
    // GPU 추론이라 VOICEVOX보다 훨씬 느리다.
    gptSovitsTimeoutSec: num('GPT_SOVITS_TIMEOUT_SEC', 60),
    voicevoxBaseUrl: env.VOICEVOX_BASE_URL?.trim() || null,
    voicevoxSpeaker: num('VOICEVOX_SPEAKER', 3), // 3 = ずんだもん(ノーマル)
    voicevoxSpeedScale: num('VOICEVOX_SPEED_SCALE', 1.0),
    voicevoxPitchScale: num('VOICEVOX_PITCH_SCALE', 0.0),
    voicevoxIntonationScale: num('VOICEVOX_INTONATION_SCALE', 1.0),
    voicevoxVolumeScale: num('VOICEVOX_VOLUME_SCALE', 1.0),
    voicevoxTimeoutSec: num('VOICEVOX_TIMEOUT_SEC', 20),
    ttsMaxLength: num('TTS_MAX_LENGTH', 200),
    ttsIdleTimeoutSec: num('TTS_IDLE_TIMEOUT_SEC', 300),
    // Slash commands register globally (up to ~1h to appear). Set this to a guild id
    // to register there instead — shows up instantly, handy while testing.
    ttsCommandGuildId: env.TTS_COMMAND_GUILD_ID?.trim() || null,
    // "say: 안녕" 처럼 메시지로 부르는 모드. Message Content 특권 인텐트가 필요해
    // 기본은 꺼짐 — 슬래시 명령어만 쓰면 인텐트를 켤 필요가 없다.
    ttsMessagePrefix: env.TTS_MESSAGE_PREFIX?.trim() || null,
  };
}

export function getConfig() {
  try {
    return loadConfig();
  } catch (e) {
    if (!(e instanceof ConfigError)) throw e;
    console.error(`\n[config] ${e.message}`);
    console.error('         Copy .env.example to .env and fill it in (see README.md).\n');
    process.exit(1);
  }
}
