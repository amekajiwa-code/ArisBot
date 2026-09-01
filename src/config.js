// Centralized, validated configuration (notification-only cloud bot).
// loadConfig(env) is pure: returns a config object or throws ConfigError.
// getConfig() wraps it for the app entrypoint (prints help + exits on error).

export class ConfigError extends Error {}

// Game name as streamers actually type it — YouTube search phrases (| = OR) and the
// keyword list that re-checks each hit's title/description.
const YT_DEFAULT_QUERY =
  '"Deadly Trick"|"DeadlyTrick"|"데들리 트릭"|"데들리트릭"|"デッドリートリック"';
const YT_DEFAULT_TERMS = 'Deadly Trick,데들리 트릭,デッドリートリック';

/** "a, b , " → ["a", "b"] */
const csv = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);

// Parse an env var as a number, falling back to `fallback` when missing/NaN.
const num = (env, name, fallback) => {
  const v = env[name]?.trim();
  return v && Number.isFinite(Number(v)) ? Number(v) : fallback;
};

/**
 * 방송 기록기 + 방송자 수집 CLI 가 쓰는 설정. Discord 토큰이 필요 없어서
 * loadConfig() 와 따로 부를 수 있다(봇 없이 CLI만 돌릴 때).
 */
export function loadFinderConfig(env = process.env) {
  return {
    // 비리비리·니코니코는 키가 없는 대신 검색어가 곧 적중률이다.
    bilibiliSearchKeywords: csv(env.BILIBILI_SEARCH_KEYWORDS ?? 'Deadly Trick'),
    bilibiliCookie: env.BILIBILI_COOKIE?.trim() || null,
    nicoSearchKeywords: csv(env.NICO_SEARCH_KEYWORDS ?? 'Deadly Trick,デッドリートリック'),
    // 검색 기반 플랫폼(비리비리·니코니코) 공통 오탐 필터. 기본값은 YouTube 쪽과 같다.
    matchTerms: csv(env.MATCH_TERMS ?? env.YOUTUBE_MATCH_TERMS ?? YT_DEFAULT_TERMS),
    // 비리비리·니코니코 라이브 알림. 키가 필요 없는 플랫폼이라 알림 채널이 곧 스위치다.
    // (기록기가 훑는 결과를 얻어 쓰므로 알림을 켜도 요청은 안 늘어난다.)
    bilibiliAlertEnabled: (env.BILIBILI_ALERT_ENABLED?.trim() || '1') !== '0',
    bilibiliAlertChannelId:
      env.BILIBILI_ALERT_CHANNEL_ID?.trim() || env.STEAM_ALERT_CHANNEL_ID?.trim() || null,
    bilibiliCategoryName: env.BILIBILI_CATEGORY_NAME?.trim() || 'Deadly Trick',
    // 두 플랫폼이 주는 숫자는 동시 시청자가 아니라 **누적 방문자**다(비리비리 "看过", 니코니코 来場者).
    // 방송이 길어질수록 계속 불어나서, 동시 시청자의 5~10배쯤(3~4시간 방송 기준)이 된다.
    // 비리비리 라이브 151개를 표본으로 재보니 누적 1000명이 상위 41% — 동시로는 100~300명급이다.
    // 동시 1000명급만 알리려면 그 5~10배가 필요해서 10000 으로 잡았다.
    bilibiliAlertMinViewers: num(env, 'BILIBILI_ALERT_MIN_VIEWERS', 10000),
    nicoAlertEnabled: (env.NICO_ALERT_ENABLED?.trim() || '1') !== '0',
    nicoAlertChannelId:
      env.NICO_ALERT_CHANNEL_ID?.trim() || env.STEAM_ALERT_CHANNEL_ID?.trim() || null,
    nicoCategoryName: env.NICO_CATEGORY_NAME?.trim() || 'Deadly Trick',
    nicoAlertMinViewers: num(env, 'NICO_ALERT_MIN_VIEWERS', 1000),
    // 검색 결과가 깜빡여도(순위·시청자수 경계) 같은 방송을 이 시간 안에 다시 알리지 않는다.
    liveAlertCooldownSec: num(env, 'LIVE_ALERT_COOLDOWN_SEC', 21600),
    // 방송 목격 기록 — "지난 N일에 누가 방송했나"를 검색이 아니라 우리 기록으로 답하기 위한 것.
    recorderEnabled: (env.RECORDER_ENABLED?.trim() || '1') !== '0',
    streamLogPath: env.STREAM_LOG_PATH?.trim() || 'data/streams.json',
    recorderPollIntervalSec: num(env, 'RECORDER_POLL_INTERVAL_SEC', 60),
    recorderRetentionDays: num(env, 'RECORDER_RETENTION_DAYS', 14),
    // 시작시각을 안 주는 플랫폼에서 "같은 방송의 연속"으로 볼 최대 공백.
    recorderSessionGapSec: num(env, 'RECORDER_SESSION_GAP_SEC', 1800),
  };
}

export function loadConfig(env = process.env) {
  const required = (name, hint) => {
    const v = env[name]?.trim();
    if (!v) throw new ConfigError(`Missing required env var: ${name}${hint ? ` — ${hint}` : ''}`);
    return v;
  };

  const discordToken = required('DISCORD_BOT_TOKEN', 'Bot token from the Discord Developer Portal');

  return {
    discordToken,
    ...loadFinderConfig(env),
    // Steam player-count alert (disabled unless STEAM_ALERT_CHANNEL_ID is set).
    steamAlertChannelId: env.STEAM_ALERT_CHANNEL_ID?.trim() || null,
    steamAppId: env.STEAM_APP_ID?.trim() || '3088400',
    steamGameName: env.STEAM_GAME_NAME?.trim() || 'Deadly Trick',
    steamPollIntervalSec: num(env, 'STEAM_POLL_INTERVAL_SEC', 600),
    steamAlertThreshold: num(env, 'STEAM_ALERT_THRESHOLD', 25),
    steamAlertMinCount: num(env, 'STEAM_ALERT_MIN_COUNT', 10),
    // Twitch category live alert (disabled unless TWITCH_CLIENT_ID + TWITCH_CLIENT_SECRET are set).
    // Channel defaults to the Steam alert channel so both alerts can share one place.
    twitchClientId: env.TWITCH_CLIENT_ID?.trim() || null,
    twitchClientSecret: env.TWITCH_CLIENT_SECRET?.trim() || null,
    twitchAlertChannelId:
      env.TWITCH_ALERT_CHANNEL_ID?.trim() || env.STEAM_ALERT_CHANNEL_ID?.trim() || null,
    twitchCategoryName: env.TWITCH_CATEGORY_NAME?.trim() || 'Deadly Trick',
    twitchGameId: env.TWITCH_GAME_ID?.trim() || null,
    twitchPollIntervalSec: num(env, 'TWITCH_POLL_INTERVAL_SEC', 600),
    twitchAlertMinViewers: num(env, 'TWITCH_ALERT_MIN_VIEWERS', 50),
    // CHZZK(치지직) category live alert (disabled unless CHZZK_CLIENT_ID + CHZZK_CLIENT_SECRET are set).
    // Official Open API has no category filter, so it scans the top CHZZK_MAX_PAGES×20 lives.
    chzzkClientId: env.CHZZK_CLIENT_ID?.trim() || null,
    chzzkClientSecret: env.CHZZK_CLIENT_SECRET?.trim() || null,
    chzzkAlertChannelId:
      env.CHZZK_ALERT_CHANNEL_ID?.trim() || env.STEAM_ALERT_CHANNEL_ID?.trim() || null,
    chzzkCategoryId: env.CHZZK_CATEGORY_ID?.trim() || 'Deadly_Trick',
    chzzkCategoryName: env.CHZZK_CATEGORY_NAME?.trim() || 'Deadly Trick',
    chzzkPollIntervalSec: num(env, 'CHZZK_POLL_INTERVAL_SEC', 600),
    chzzkAlertMinViewers: num(env, 'CHZZK_ALERT_MIN_VIEWERS', 50),
    chzzkMaxPages: num(env, 'CHZZK_MAX_PAGES', 50),   // 50×20 = 상위 1000개
    // YouTube. 라이브 알림에서는 뺐다(쿼터 100회/일이라 15분 주기가 한계였고, 키도 안 쓴다).
    // 아래 값들은 방송자 수집 CLI(find-streamers)가 계속 쓰고, 알림을 되살릴 때 그대로 재사용한다.
    youtubeApiKey: env.YOUTUBE_API_KEY?.trim() || null,
    youtubeAlertChannelId:
      env.YOUTUBE_ALERT_CHANNEL_ID?.trim() || env.STEAM_ALERT_CHANNEL_ID?.trim() || null,
    youtubeSearchQuery: env.YOUTUBE_SEARCH_QUERY?.trim() || YT_DEFAULT_QUERY,
    // Set but blank ⇒ filter off, so an explicit "" must not fall back to the default.
    youtubeMatchTerms: csv(env.YOUTUBE_MATCH_TERMS ?? YT_DEFAULT_TERMS),
    youtubeCategoryName: env.YOUTUBE_CATEGORY_NAME?.trim() || 'Deadly Trick',
    // search.list 는 하루 100회뿐이다. 20분 주기 = 72회/일 로, 방송자 수집 CLI 몫을 남긴다.
    youtubePollIntervalSec: num(env, 'YOUTUBE_POLL_INTERVAL_SEC', 1200),
    // 대형 버튜버(홀로라이브·니지산지)만 걸리게 높게 잡는다. 20분 주기의 지연도 이 규모에선 무의미하다.
    youtubeAlertMinViewers: num(env, 'YOUTUBE_ALERT_MIN_VIEWERS', 100),
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
