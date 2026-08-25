// 플랫폼별 "이 게임 방송" 조회를 한 가지 모양으로 감싼다.
//   { platform, run() -> 엔트리[], filterByTerms?, skip? }
// 기록기(1분마다 도는 감시)와 수집 CLI가 같은 소스를 쓴다. 차이는 backlog 하나:
//   backlog=false → 지금 켜진 것만(가볍다, 자주 돌린다)
//   backlog=true  → 지난 기록까지(VOD·투고 영상·종료된 방송)
//
// 엔트리 공통 형태: { streamer, streamerId, streamerUrl, title, url, startedAt, views, live }

import { createTwitchClient } from './twitch.js';
import { createYouTubeClient } from './youtube.js';
import { createBilibiliClient } from './bilibili.js';
import { createNiconicoClient } from './niconico.js';

export const PLATFORMS = { twitch: 'Twitch', youtube: 'YouTube', bilibili: '비리비리', niconico: '니코니코' };

/** 키워드마다 같은 조회를 돌려 이어붙인다(플랫폼 검색은 OR 를 안 받는 곳이 있다). */
export async function forEachKeyword(keywords, fn, gapMs = 0) {
  const out = [];
  for (const k of keywords) {
    out.push(...(await fn(k)));
    if (gapMs) await new Promise((r) => setTimeout(r, gapMs));
  }
  return out;
}

const twitchEntry = (s, { live }) => ({
  streamer: s.userName,
  streamerId: s.userId,
  streamerUrl: `https://www.twitch.tv/${s.login}`,
  title: s.title,
  url: live ? `https://www.twitch.tv/${s.login}` : s.url,
  startedAt: live ? s.startedAt : s.publishedAt,
  views: live ? s.viewerCount : s.viewCount,
  live,
});

export function buildTwitchSource(cfg, { gameName, days = 3, backlog = true, clients = {} } = {}) {
  const name = cfg.twitchCategoryName || gameName;
  if (!cfg.twitchClientId || !cfg.twitchClientSecret) {
    return { platform: PLATFORMS.twitch, skip: 'TWITCH_CLIENT_ID/SECRET 미설정 — 건너뜀' };
  }
  const twitch = clients.twitch ?? createTwitchClient({
    clientId: cfg.twitchClientId,
    clientSecret: cfg.twitchClientSecret,
  });
  let cachedGameId = cfg.twitchGameId || null;

  return {
    platform: PLATFORMS.twitch,
    filterByTerms: false,          // 카테고리로 조회하니 제목에 게임명이 없어도 확실하다
    async run() {
      cachedGameId ??= await twitch.resolveGameId(name);
      if (!cachedGameId) throw new Error(`카테고리 "${name}" 를 찾지 못했습니다`);
      const lives = await twitch.fetchStreams(cachedGameId, { maxPages: 5 });
      const entries = lives.map((s) => twitchEntry(s, { live: true }));
      if (!backlog) return entries;
      const vods = await twitch.fetchVideos(cachedGameId, {
        period: days <= 7 ? 'week' : 'month',
        maxPages: 5,
      });
      return [...entries, ...vods.map((v) => twitchEntry(v, { live: false }))];
    },
  };
}

export function buildYouTubeSource(cfg, { gameName, since, backlog = true, clients = {} } = {}) {
  if (!cfg.youtubeApiKey) {
    return { platform: PLATFORMS.youtube, skip: 'YOUTUBE_API_KEY 미설정 — 건너뜀' };
  }
  const youtube = clients.youtube ?? createYouTubeClient({ apiKey: cfg.youtubeApiKey });
  const query = cfg.youtubeSearchQuery || `"${gameName}"`;

  return {
    platform: PLATFORMS.youtube,
    async run() {
      const found = await youtube.fetchRecentStreams(query, {
        publishedAfter: since ? new Date(since).toISOString() : undefined,
        eventTypes: backlog ? ['live', 'completed'] : ['live'],   // 검색 1회당 search.list 1회(하루 100회)
      });
      return found.map((v) => ({
        streamer: v.channelName,
        streamerId: v.channelId,
        streamerUrl: v.channelId ? `https://www.youtube.com/channel/${v.channelId}` : null,
        title: v.title,
        description: v.description,
        url: `https://youtu.be/${v.videoId}`,
        startedAt: v.startedAt,
        views: v.live ? v.liveViewers : v.viewCount,
        live: v.live,
      }));
    },
  };
}

export function buildBilibiliSource(cfg, { backlog = true, clients = {} } = {}) {
  const bilibili = clients.bilibili ?? createBilibiliClient({ cookie: cfg.bilibiliCookie });
  const keywords = cfg.bilibiliSearchKeywords;
  return {
    platform: PLATFORMS.bilibili,
    async run() {
      const lives = await forEachKeyword(keywords, (k) => bilibili.searchLiveRooms(k), 300);
      if (!backlog) return lives;
      const videos = await forEachKeyword(keywords, (k) => bilibili.searchVideos(k), 300);
      return [...lives, ...videos];
    },
  };
}

export function buildNiconicoSource(cfg, { since, backlog = true, clients = {} } = {}) {
  const niconico = clients.niconico ?? createNiconicoClient();
  const keywords = cfg.nicoSearchKeywords;
  return {
    platform: PLATFORMS.niconico,
    async run() {
      const onair = await forEachKeyword(keywords, (k) => niconico.searchLives(k, { status: 'onair' }), 300);
      if (!backlog) return onair;
      const past = await forEachKeyword(keywords, (k) => niconico.searchLives(k, { status: 'past' }), 300);
      // 스냅샷 API는 초당 1요청 제한이 있어 키워드 사이를 넉넉히 띄운다.
      const videos = await forEachKeyword(keywords, (k) => niconico.searchVideos(k, { since }), 1100);
      return [...onair, ...past, ...videos];
    },
  };
}

/**
 * YouTube 워처가 이미 받아온 라이브 목록을 기록 엔트리로 바꾼다.
 * (쿼터 때문에 기록기가 YouTube를 따로 폴링하지 않고 워처 결과를 얻어 쓴다.)
 */
export function youtubeLiveSighting(l) {
  return {
    streamer: l.channelName,
    streamerId: l.channelId ?? l.videoId,
    streamerUrl: l.channelId ? `https://www.youtube.com/channel/${l.channelId}` : null,
    title: l.title,
    url: `https://youtu.be/${l.videoId}`,
    startedAt: l.startedAt ?? null,
    views: l.liveViewers,
    live: true,
  };
}

/** 네 플랫폼 소스를 한 번에. `only` 로 일부만 고를 수 있다. */
export function createSources(cfg, { gameName, since, days, backlog = true, only, clients } = {}) {
  const build = {
    twitch: () => buildTwitchSource(cfg, { gameName, days, backlog, clients }),
    youtube: () => buildYouTubeSource(cfg, { gameName, since, backlog, clients }),
    bilibili: () => buildBilibiliSource(cfg, { backlog, clients }),
    niconico: () => buildNiconicoSource(cfg, { since, backlog, clients }),
  };
  const keys = only ?? Object.keys(build);
  return keys.map((k) => build[k]());
}
