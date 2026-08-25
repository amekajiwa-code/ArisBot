#!/usr/bin/env node
// "최근 N일(기본 3일) 안에 이 게임을 방송한 사람 전부" 를 Twitch·YouTube·비리비리·니코니코에서
// 긁어 한 목록으로 출력하는 1회성 CLI. 알림 봇(src/index.js)과는 별개로 돌아간다.
//
//   node scripts/find-streamers.js                 # 최근 3일
//   node scripts/find-streamers.js --days 7 --json
//   npm run find-streamers -- --days 3
//
// 자격증명이 없는 플랫폼은 조용히 건너뛰고(맨 아래 ⏭ 로 표시), 한 곳이 실패해도 나머지는 나온다.
//   Twitch  : TWITCH_CLIENT_ID + TWITCH_CLIENT_SECRET (카테고리 기준 — 가장 정확)
//   YouTube : YOUTUBE_API_KEY (search.list 100회/일 한도 중 실행당 2회 사용)
//   비리비리 : 키 불필요(공개 웹 검색). 막히면 BILIBILI_COOKIE 에 브라우저 쿠키를 넣는다
//   니코니코 : 키 불필요(스냅샷 검색 API + 생방송 검색 페이지)

import { createTwitchClient } from '../src/twitch.js';
import { createYouTubeClient } from '../src/youtube.js';
import { createBilibiliClient } from '../src/bilibili.js';
import { createNiconicoClient } from '../src/niconico.js';
import { collect, formatReport, DEFAULT_MATCH_TERMS } from '../src/find-streamers.js';

const DAY_MS = 86_400_000;

function parseArgs(argv) {
  const args = { days: 3, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--days' || a === '-d') args.days = Number(argv[++i]);
    else if (a === '--json') args.json = true;
    else if (a === '--game' || a === '-g') args.game = argv[++i];
    else if (a === '--help' || a === '-h') args.help = true;
    else if (a.startsWith('--days=')) args.days = Number(a.slice(7));
  }
  return args;
}

const csv = (s, fallback) =>
  (s ?? fallback).split(',').map((x) => x.trim()).filter(Boolean);

/** 여러 키워드로 같은 조회를 돌리고 결과를 이어붙인다(플랫폼 검색은 OR 를 안 받는 곳이 있다). */
async function forEachKeyword(keywords, fn, gapMs = 0) {
  const out = [];
  for (const k of keywords) {
    out.push(...(await fn(k)));
    if (gapMs) await new Promise((r) => setTimeout(r, gapMs));
  }
  return out;
}

function buildSources(env, { days, since, gameName }) {
  const sources = [];

  // ── Twitch: 카테고리(game_id) 기준이라 제목에 게임명이 없어도 다 잡힌다.
  const twitchName = env.TWITCH_CATEGORY_NAME?.trim() || gameName;
  if (env.TWITCH_CLIENT_ID?.trim() && env.TWITCH_CLIENT_SECRET?.trim()) {
    const twitch = createTwitchClient({
      clientId: env.TWITCH_CLIENT_ID.trim(),
      clientSecret: env.TWITCH_CLIENT_SECRET.trim(),
    });
    sources.push({
      platform: 'Twitch',
      filterByTerms: false,
      async run() {
        const gameId = env.TWITCH_GAME_ID?.trim() || (await twitch.resolveGameId(twitchName));
        if (!gameId) throw new Error(`카테고리 "${twitchName}" 를 찾지 못했습니다`);
        const [lives, vods] = await Promise.all([
          twitch.fetchStreams(gameId, { maxPages: 5 }),
          twitch.fetchVideos(gameId, { period: days <= 7 ? 'week' : 'month', maxPages: 5 }),
        ]);
        return [
          ...lives.map((s) => ({
            streamer: s.userName, streamerId: s.userId,
            streamerUrl: `https://www.twitch.tv/${s.login}`,
            title: s.title, url: `https://www.twitch.tv/${s.login}`,
            startedAt: s.startedAt, views: s.viewerCount, live: true,
          })),
          ...vods.map((v) => ({
            streamer: v.userName, streamerId: v.userId,
            streamerUrl: `https://www.twitch.tv/${v.login}`,
            title: v.title, url: v.url,
            startedAt: v.publishedAt, views: v.viewCount, live: false,
          })),
        ];
      },
    });
  } else {
    sources.push({ platform: 'Twitch', skip: 'TWITCH_CLIENT_ID/SECRET 미설정 — 건너뜀' });
  }

  // ── YouTube: 게임 카테고리로 못 뒤져서 검색어에 의존한다(제목·설명·태그).
  if (env.YOUTUBE_API_KEY?.trim()) {
    const youtube = createYouTubeClient({ apiKey: env.YOUTUBE_API_KEY.trim() });
    const query = env.YOUTUBE_SEARCH_QUERY?.trim() || `"${gameName}"`;
    sources.push({
      platform: 'YouTube',
      async run() {
        const found = await youtube.fetchRecentStreams(query, {
          publishedAfter: new Date(since).toISOString(),
        });
        return found.map((v) => ({
          streamer: v.channelName, streamerId: v.channelId,
          streamerUrl: v.channelId ? `https://www.youtube.com/channel/${v.channelId}` : null,
          title: v.title, description: v.description,
          url: `https://youtu.be/${v.videoId}`,
          startedAt: v.startedAt,
          views: v.live ? v.liveViewers : v.viewCount,
          live: v.live,
        }));
      },
    });
  } else {
    sources.push({ platform: 'YouTube', skip: 'YOUTUBE_API_KEY 미설정 — 건너뜀' });
  }

  // ── 비리비리: 공개 검색(투고 영상 신규순 + 방송중인 라이브 방).
  const biliKeywords = csv(env.BILIBILI_SEARCH_KEYWORDS, gameName);
  const bilibili = createBilibiliClient({ cookie: env.BILIBILI_COOKIE?.trim() || null });
  sources.push({
    platform: '비리비리',
    async run() {
      const videos = await forEachKeyword(biliKeywords, (k) => bilibili.searchVideos(k), 300);
      const lives = await forEachKeyword(biliKeywords, (k) => bilibili.searchLiveRooms(k), 300);
      return [...lives, ...videos];
    },
  });

  // ── 니코니코: 스냅샷 검색(영상) + 생방송 검색 페이지(방송중·최근 종료).
  const nicoKeywords = csv(env.NICO_SEARCH_KEYWORDS, `${gameName},デッドリートリック`);
  const niconico = createNiconicoClient();
  sources.push({
    platform: '니코니코',
    async run() {
      const videos = await forEachKeyword(nicoKeywords, (k) => niconico.searchVideos(k, { since }), 1100);
      const onair = await forEachKeyword(nicoKeywords, (k) => niconico.searchLives(k, { status: 'onair' }), 300);
      const past = await forEachKeyword(nicoKeywords, (k) => niconico.searchLives(k, { status: 'past' }), 300);
      return [...onair, ...past, ...videos];
    },
  });

  return sources;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('사용법: node scripts/find-streamers.js [--days N] [--game "이름"] [--json]');
    return;
  }
  if (!Number.isFinite(args.days) || args.days <= 0) {
    console.error('--days 는 1 이상의 숫자여야 합니다.');
    process.exitCode = 1;
    return;
  }

  const env = process.env;
  const gameName = args.game ?? env.STEAM_GAME_NAME?.trim() ?? 'Deadly Trick';
  const now = Date.now();
  const since = now - args.days * DAY_MS;
  const matchTerms = env.YOUTUBE_MATCH_TERMS
    ? csv(env.YOUTUBE_MATCH_TERMS, '')
    : [...new Set([gameName, ...DEFAULT_MATCH_TERMS])];

  const result = await collect(buildSources(env, { days: args.days, since, gameName }), {
    days: args.days, now, matchTerms,
  });

  if (args.json) console.log(JSON.stringify(result, null, 2));
  else console.log(formatReport(result, { gameName }));

  // 모든 소스가 실패했으면(=목록이 통째로 비었으면) 실패로 끝낸다.
  if (!result.streamers.length && result.errors.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error('[find-streamers]', e?.stack ?? e);
  process.exitCode = 1;
});
