// ArisBot — Discord notification-only bot (cloud edition).
//
// Logs into Discord and polls Steam / Twitch / CHZZK / 비리비리 / 니코니코 on a timer,
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
import { createStreamLog } from './stream-log.js';
import { createRecorder, startRecorder } from './recorder.js';
import { createSources, PLATFORMS } from './sources.js';
import { createLiveWatcher, COLORS } from './live-watch.js';

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

  // ── 비리비리 · 니코니코 라이브 알림 ────────────────────────────────────────
  // 이 둘은 자체 폴링을 두지 않는다. 아래 기록기가 1분마다 훑는 결과를 워처가 받아쓰므로
  // 알림을 켜도 외부 요청은 한 건도 안 늘어난다. 키가 없는 플랫폼이라 알림 채널이 스위치다.
  const sightingHooks = {};
  for (const p of [
    {
      tag: 'bilibili', platform: PLATFORMS.bilibili, color: COLORS.bilibili,
      enabled: config.bilibiliAlertEnabled, channelId: config.bilibiliAlertChannelId,
      categoryName: config.bilibiliCategoryName, minViewers: config.bilibiliAlertMinViewers,
      enabledKey: 'BILIBILI_ALERT_ENABLED', channelKey: 'BILIBILI_ALERT_CHANNEL_ID',
    },
    {
      tag: 'niconico', platform: PLATFORMS.niconico, color: COLORS.niconico,
      enabled: config.nicoAlertEnabled, channelId: config.nicoAlertChannelId,
      categoryName: config.nicoCategoryName, minViewers: config.nicoAlertMinViewers,
      enabledKey: 'NICO_ALERT_ENABLED', channelKey: 'NICO_ALERT_CHANNEL_ID',
    },
  ]) {
    if (!p.enabled) { console.log(`[${p.tag}] disabled (${p.enabledKey}=0)`); continue; }
    if (!p.channelId) { console.log(`[${p.tag}] disabled (set ${p.channelKey} to enable)`); continue; }
    anyEnabled = true;
    const watcher = createLiveWatcher({
      send: makeSender(c, p.channelId, p.tag),
      categoryName: p.categoryName,
      minViewers: p.minViewers,
      platform: p.platform,
      color: p.color,
      matchTerms: config.matchTerms,        // 검색 기반이라 오탐을 한 번 더 거른다
      cooldownMs: config.liveAlertCooldownSec * 1000,   // 검색 깜빡임에 같은 방송이 여러 번 울리지 않게
    });
    sightingHooks[p.platform] = (found) => watcher.push(found);
    console.log(
      `[${p.tag}] watching "${p.categoryName}" → channel ${p.channelId} ` +
      `(every ${config.recorderPollIntervalSec}s, min ${p.minViewers} viewers, ` +
      `재알림 ${Math.round(config.liveAlertCooldownSec / 3600)}h 뒤)`,
    );
  }

  // ── 방송 기록기 ────────────────────────────────────────────────────────────
  // 알림과 별개로, 짧은 주기로 훑어 "누가 언제 방송했나"를 디스크에 남긴다. 방송이
  // 끝나고 VOD도 안 남기면 나중엔 어디서도 못 찾으므로, 그 순간 본 것을 적어두는 게
  // 유일한 방법이다. 나중에 `npm run find-streamers` 가 이 기록을 읽는다.
  let recorder = null;
  if (config.recorderEnabled || Object.keys(sightingHooks).length) {
    // 기록을 껐어도 위 알림을 켰으면 폴링은 돌아야 한다 — 그때는 훑기만 하고 안 적는다.
    const log = config.recorderEnabled
      ? createStreamLog({
        path: config.streamLogPath,
        retentionDays: config.recorderRetentionDays,
        gapMs: config.recorderSessionGapSec * 1000,
      })
      : { record: async () => 0 };
    recorder = createRecorder({ log, onSightings: sightingHooks });
    const sources = createSources(config, {
      gameName: config.steamGameName,
      backlog: false,                       // 지금 켜진 것만 — 가볍게 자주
      only: ['twitch', 'bilibili', 'niconico'],
    });
    startRecorder({ sources, log, recorder, intervalMs: config.recorderPollIntervalSec * 1000 });
    const names = sources.filter((s) => s.run).map((s) => s.platform);
    console.log(
      `[record] ${names.join(', ') || '(폴링 소스 없음)'} → ` +
      `${config.recorderEnabled ? config.streamLogPath : '기록 끔(알림만)'} ` +
      `(every ${config.recorderPollIntervalSec}s, ${config.recorderRetentionDays}일 보관)`,
    );
  } else {
    console.log('[record] disabled (RECORDER_ENABLED=0)');
  }

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

  // YouTube 라이브 알림은 뺐다 — search.list 쿼터가 하루 100회뿐이라 15분 주기가 한계였고,
  // 키를 안 채워 계속 꺼져 있었다. 코드(youtube.js / youtube-watch.js)는 그대로 두었으니
  // 되살리려면 YOUTUBE_API_KEY 를 채우고 이 자리에 startYouTubeWatch 블록을 다시 넣으면 된다.
  // 방송자 수집 CLI(`npm run find-streamers`)는 지금도 YouTube 를 검색한다.

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
