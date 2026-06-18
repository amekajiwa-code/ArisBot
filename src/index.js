// ArisBot — Discord notification-only bot (cloud edition).
//
// Logs into Discord and polls Steam / Twitch / CHZZK on a timer, pushing an
// embed to the configured channel when something changes. No slash commands,
// no message handling, no HTTP server — so no privileged intents are needed.

import { Client, GatewayIntentBits, Events } from 'discord.js';
import { getConfig } from './config.js';
import { startSteamWatch } from './steam-watch.js';
import { fetchPlayerCount } from './steam.js';
import { startTwitchWatch } from './twitch-watch.js';
import { createTwitchClient } from './twitch.js';
import { startChzzkWatch } from './chzzk-watch.js';
import { createChzzkClient } from './chzzk.js';

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

  if (!anyEnabled) {
    console.warn('[bridge] ⚠️ no alert sources enabled — set at least one of STEAM/TWITCH/CHZZK in .env');
  }
  console.log('[bridge] ready');
});

client.on(Events.Error, (err) => console.error('[discord] client error:', err));

client.login(config.discordToken).catch((err) => {
  console.error('\n[discord] login failed:', err?.message ?? err);
  console.error('→ DISCORD_BOT_TOKEN 값이 올바른지 확인하세요.');
  process.exit(1);
});
