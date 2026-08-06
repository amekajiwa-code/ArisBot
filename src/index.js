// ArisBot — Discord notification-only bot (cloud edition).
//
// Logs into Discord and polls Steam / Twitch / CHZZK / YouTube on a timer,
// pushing an embed to the configured channel when something changes. No slash
// commands, no message handling, no HTTP server — so no privileged intents are
// needed.

import { Client, GatewayIntentBits, Events } from 'discord.js';
import { getConfig } from './config.js';
import { startSteamWatch } from './steam-watch.js';
import { fetchPlayerCount } from './steam.js';
import { startTwitchWatch } from './twitch-watch.js';
import { createTwitchClient } from './twitch.js';
import { startChzzkWatch } from './chzzk-watch.js';
import { createChzzkClient } from './chzzk.js';
import { startYouTubeWatch } from './youtube-watch.js';
import { createYouTubeClient } from './youtube.js';

const config = getConfig();

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// Resolve a channel by id and send a payload, logging (not throwing) on failure.
function makeSender(c, channelId, tag) {
  return async (payload) => {
    try {
      const ch = await c.channels.fetch(channelId);
      if (ch) await ch.send(payload);
    } catch (e) {
      console.error(`[${tag}] send failed:`, e?.message ?? e);
    }
  };
}

client.once(Events.ClientReady, async (c) => {
  console.log(`[discord] logged in as ${c.user.tag}`);

  let anyEnabled = false;

  if (config.steamAlertChannelId) {
    anyEnabled = true;
    startSteamWatch({
      fetchCount: () => fetchPlayerCount(config.steamAppId),
      send: makeSender(c, config.steamAlertChannelId, 'steam'),
      threshold: config.steamAlertThreshold,
      minCount: config.steamAlertMinCount,
      gameName: config.steamGameName,
      appId: config.steamAppId,
      intervalMs: config.steamPollIntervalSec * 1000,
    });
    console.log(
      `[steam] watching app ${config.steamAppId} → channel ${config.steamAlertChannelId} ` +
      `(every ${config.steamPollIntervalSec}s, ±${config.steamAlertThreshold}, min ${config.steamAlertMinCount})`,
    );
  } else {
    console.log('[steam] disabled (set STEAM_ALERT_CHANNEL_ID to enable)');
  }

  if (config.twitchClientId && config.twitchClientSecret && config.twitchAlertChannelId) {
    anyEnabled = true;
    const twitch = createTwitchClient({
      clientId: config.twitchClientId,
      clientSecret: config.twitchClientSecret,
    });
    let gameId = config.twitchGameId;
    if (!gameId) {
      try {
        gameId = await twitch.resolveGameId(config.twitchCategoryName);
      } catch (e) {
        console.error('[twitch] game id lookup failed:', e?.message ?? e);
      }
    }
    if (gameId) {
      startTwitchWatch({
        fetchStreams: async () => {
          try {
            return await twitch.fetchStreams(gameId);
          } catch (e) {
            console.error('[twitch] fetch failed:', e?.message ?? e);
            return null;
          }
        },
        send: makeSender(c, config.twitchAlertChannelId, 'twitch'),
        categoryName: config.twitchCategoryName,
        minViewers: config.twitchAlertMinViewers,
        platform: 'Twitch',
        intervalMs: config.twitchPollIntervalSec * 1000,
      });
      console.log(
        `[twitch] watching "${config.twitchCategoryName}" (game ${gameId}) → channel ${config.twitchAlertChannelId} ` +
        `(every ${config.twitchPollIntervalSec}s, min ${config.twitchAlertMinViewers} viewers)`,
      );
    } else {
      console.error(`[twitch] could not resolve game id for "${config.twitchCategoryName}" — alert disabled`);
    }
  } else {
    console.log('[twitch] disabled (set TWITCH_CLIENT_ID + TWITCH_CLIENT_SECRET to enable)');
  }

  if (config.chzzkClientId && config.chzzkClientSecret && config.chzzkAlertChannelId) {
    anyEnabled = true;
    const chzzk = createChzzkClient({
      clientId: config.chzzkClientId,
      clientSecret: config.chzzkClientSecret,
    });
    startChzzkWatch({
      fetchLives: async () => {
        try {
          return await chzzk.fetchCategoryLives(config.chzzkCategoryId, { maxPages: config.chzzkMaxPages });
        } catch (e) {
          console.error('[chzzk] fetch failed:', e?.message ?? e);
          return null;
        }
      },
      send: makeSender(c, config.chzzkAlertChannelId, 'chzzk'),
      categoryName: config.chzzkCategoryName,
      minViewers: config.chzzkAlertMinViewers,
      platform: '치지직',
      intervalMs: config.chzzkPollIntervalSec * 1000,
    });
    console.log(
      `[chzzk] watching "${config.chzzkCategoryName}" (${config.chzzkCategoryId}) → channel ${config.chzzkAlertChannelId} ` +
      `(every ${config.chzzkPollIntervalSec}s, scanning top ${config.chzzkMaxPages * 20} lives, min ${config.chzzkAlertMinViewers} viewers)`,
    );
  } else {
    console.log('[chzzk] disabled (set CHZZK_CLIENT_ID + CHZZK_CLIENT_SECRET to enable)');
  }

  if (config.youtubeApiKey && config.youtubeAlertChannelId) {
    anyEnabled = true;
    const youtube = createYouTubeClient({ apiKey: config.youtubeApiKey });
    startYouTubeWatch({
      fetchLives: async () => {
        try {
          return await youtube.fetchLives(config.youtubeSearchQuery);
        } catch (e) {
          console.error('[youtube] fetch failed:', e?.message ?? e);   // 403 quotaExceeded lands here too
          return null;
        }
      },
      send: makeSender(c, config.youtubeAlertChannelId, 'youtube'),
      categoryName: config.youtubeCategoryName,
      minViewers: config.youtubeAlertMinViewers,
      matchTerms: config.youtubeMatchTerms,
      platform: 'YouTube',
      intervalMs: config.youtubePollIntervalSec * 1000,
    });
    console.log(
      `[youtube] watching ${config.youtubeSearchQuery} → channel ${config.youtubeAlertChannelId} ` +
      `(every ${config.youtubePollIntervalSec}s, min ${config.youtubeAlertMinViewers} viewers)`,
    );
    // search.list allows 100 calls/day; anything under 900s burns the quota before midnight (PT).
    if (config.youtubePollIntervalSec < 900) {
      console.warn(
        `[youtube] ⚠️ ${config.youtubePollIntervalSec}s 주기는 하루 ${Math.ceil(86400 / config.youtubePollIntervalSec)}회 ` +
        '검색 → search.list 한도(100회/일) 초과. YOUTUBE_POLL_INTERVAL_SEC 를 900 이상으로 두세요.',
      );
    }
  } else {
    console.log('[youtube] disabled (set YOUTUBE_API_KEY to enable)');
  }

  if (!anyEnabled) {
    console.warn('[bridge] ⚠️ no alert sources enabled — set at least one of STEAM/TWITCH/CHZZK/YOUTUBE in .env');
  }
  console.log('[bridge] ready');
});

client.on(Events.Error, (err) => console.error('[discord] client error:', err));

client.login(config.discordToken).catch((err) => {
  console.error('\n[discord] login failed:', err?.message ?? err);
  console.error('→ DISCORD_BOT_TOKEN 값이 올바른지 확인하세요.');
  process.exit(1);
});
