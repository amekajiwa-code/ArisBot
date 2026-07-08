// Centralized, validated configuration (notification-only cloud bot).
// loadConfig(env) is pure: returns a config object or throws ConfigError.
// getConfig() wraps it for the app entrypoint (prints help + exits on error).

export class ConfigError extends Error {}

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

  return {
    discordToken,
    // Steam player-count alert (disabled unless STEAM_ALERT_CHANNEL_ID is set).
    steamAlertChannelId: env.STEAM_ALERT_CHANNEL_ID?.trim() || null,
    steamAppId: env.STEAM_APP_ID?.trim() || '3088400',
    steamGameName: env.STEAM_GAME_NAME?.trim() || 'Deadly Trick',
    steamPollIntervalSec: num('STEAM_POLL_INTERVAL_SEC', 600),
    steamAlertThreshold: num('STEAM_ALERT_THRESHOLD', 5),
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
    twitchAlertMinViewers: num('TWITCH_ALERT_MIN_VIEWERS', 100),
    // CHZZK(치지직) category live alert (disabled unless CHZZK_CLIENT_ID + CHZZK_CLIENT_SECRET are set).
    // Official Open API has no category filter, so it scans the top CHZZK_MAX_PAGES×20 lives.
    chzzkClientId: env.CHZZK_CLIENT_ID?.trim() || null,
    chzzkClientSecret: env.CHZZK_CLIENT_SECRET?.trim() || null,
    chzzkAlertChannelId:
      env.CHZZK_ALERT_CHANNEL_ID?.trim() || env.STEAM_ALERT_CHANNEL_ID?.trim() || null,
    chzzkCategoryId: env.CHZZK_CATEGORY_ID?.trim() || 'Deadly_Trick',
    chzzkCategoryName: env.CHZZK_CATEGORY_NAME?.trim() || 'Deadly Trick',
    chzzkPollIntervalSec: num('CHZZK_POLL_INTERVAL_SEC', 600),
    chzzkAlertMinViewers: num('CHZZK_ALERT_MIN_VIEWERS', 100),
    chzzkMaxPages: num('CHZZK_MAX_PAGES', 15),
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
