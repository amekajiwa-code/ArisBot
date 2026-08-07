// ArisBot — Discord 알림 봇 + 즌다몬 TTS (cloud edition).
//
// Logs into Discord and polls Steam / Twitch / CHZZK / YouTube on a timer,
// pushing an embed to the configured channel when something changes.
//
// VOICEVOX_BASE_URL을 채우면 /say 슬래시 명령어가 붙어 즌다몬 목소리로 한국어를
// 읽어 준다. 슬래시 명령어와 음성 접속은 특권 인텐트를 요구하지 않으므로,
// 포털에서 아무것도 켜지 않아도 되는 성질은 그대로다 (예외: TTS_MESSAGE_PREFIX).

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
import { createTtsBackend } from './tts-backend.js';
import { createVoiceSessions } from './voice.js';
import { connectToChannel } from './discord-voice.js';
import { COMMANDS, createInteractionHandler, createMessageHandler } from './commands.js';

const config = getConfig();

const ttsBackend = createTtsBackend(config);
const ttsEnabled = Boolean(ttsBackend);
// GuildVoiceStates는 특권 인텐트가 아니다 — 누가 어느 음성 채널에 있는지 알려면 필요하다.
// 반면 MessageContent는 특권 인텐트라, 접두사 모드를 켠 사람만 부담을 진다.
const intents = [GatewayIntentBits.Guilds];
if (ttsEnabled) intents.push(GatewayIntentBits.GuildVoiceStates);
if (ttsEnabled && config.ttsMessagePrefix) {
  intents.push(GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent);
}

const client = new Client({ intents });

// ClientReady에서 채워지고, 종료 시 정리하려고 모듈 스코프에 둔다.
let ttsSessions = null;

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

  if (ttsEnabled) {
    ttsSessions = createVoiceSessions({
      synthesize: (spoken) => ttsBackend.synthesize(spoken),
      connect: (channel) => connectToChannel(channel),
      idleTimeoutMs: config.ttsIdleTimeoutSec * 1000,
      onError: (e) => console.error('[tts] session error:', e?.message ?? e),
    });

    client.on(Events.InteractionCreate, createInteractionHandler({
      sessions: ttsSessions,
      backend: ttsBackend,
      maxLength: config.ttsMaxLength,
    }));

    if (config.ttsMessagePrefix) {
      client.on(Events.MessageCreate, createMessageHandler({
        sessions: ttsSessions,
        backend: ttsBackend,
        maxLength: config.ttsMaxLength,
        prefix: config.ttsMessagePrefix,
      }));
      console.log(`[tts] message prefix "${config.ttsMessagePrefix}" enabled (needs Message Content intent)`);
    }

    // 길드 지정 등록은 즉시 반영되고, 전역 등록은 최대 1시간쯤 걸린다.
    try {
      const scope = config.ttsCommandGuildId
        ? await c.guilds.fetch(config.ttsCommandGuildId).then((g) => g.commands)
        : c.application.commands;
      await scope.set(COMMANDS);
      console.log(
        `[tts] /say · /leave registered ${config.ttsCommandGuildId ? `to guild ${config.ttsCommandGuildId}` : 'globally (전역 반영까지 최대 1시간)'}`,
      );
    } catch (e) {
      console.error('[tts] ⚠️ slash command registration failed:', e?.message ?? e);
      console.error('→ 봇을 applications.commands 스코프로 다시 초대했는지 확인하세요.');
    }

    console.log(
      `[tts] backend ${ttsBackend.name} (최대 ${config.ttsMaxLength}자, `
      + `${config.ttsIdleTimeoutSec}s 유휴 시 퇴장)`,
    );
    // 엔진이 안 떠 있으면 첫 /say에서야 알게 되므로 기동할 때 미리 확인해 둔다.
    ttsBackend.describe()
      .then((info) => console.log(`[tts] ${info}`))
      .catch((e) => console.error(`[tts] ⚠️ ${ttsBackend.name} 엔진에 닿지 못했습니다: ${e?.message ?? e}`));
  } else {
    console.log('[tts] disabled (set GPT_SOVITS_BASE_URL or VOICEVOX_BASE_URL to enable)');
  }

  if (!anyEnabled && !ttsEnabled) {
    console.warn('[bridge] ⚠️ nothing enabled — set at least one of STEAM/TWITCH/CHZZK/YOUTUBE/VOICEVOX in .env');
  }
  console.log('[bridge] ready');
});

client.on(Events.Error, (err) => console.error('[discord] client error:', err));

// 종료 신호를 받으면 음성 채널에서 먼저 빠져나온다 — 안 그러면 재시작 후에도
// 유령처럼 채널에 남아 있는다.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`[bridge] ${signal} — shutting down`);
    ttsSessions?.destroyAll();
    client.destroy().finally(() => process.exit(0));
  });
}

client.login(config.discordToken).catch((err) => {
  console.error('\n[discord] login failed:', err?.message ?? err);
  console.error('→ DISCORD_BOT_TOKEN 값이 올바른지 확인하세요.');
  process.exit(1);
});
