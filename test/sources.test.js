import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSources, buildTwitchSource, buildNiconicoSource, youtubeLiveSighting, PLATFORMS,
} from '../src/sources.js';

const cfg = {
  twitchClientId: 'c', twitchClientSecret: 's', twitchCategoryName: 'Deadly Trick', twitchGameId: null,
  youtubeApiKey: null,
  bilibiliSearchKeywords: ['Deadly Trick'], bilibiliCookie: null,
  nicoSearchKeywords: ['Deadly Trick', 'デッドリートリック'],
};

const twitchStub = {
  resolveGameId: async () => '777',
  fetchStreams: async () => [{ userId: '1', userName: 'A', login: 'a', title: 't', viewerCount: 9, startedAt: 'S' }],
  fetchVideos: async () => [{ id: 'v', userId: '2', userName: 'B', login: 'b', title: 'v', url: 'U', publishedAt: 'P', viewCount: 5 }],
};

test('twitch 소스: 카테고리 조회라 제목 키워드 필터를 끈다', () => {
  assert.equal(buildTwitchSource(cfg, { clients: { twitch: twitchStub } }).filterByTerms, false);
});

test('twitch 소스: backlog=false 면 지금 켜진 것만 (VOD 조회 안 함)', async () => {
  let vodCalls = 0;
  const twitch = { ...twitchStub, fetchVideos: async () => { vodCalls++; return []; } };
  const source = buildTwitchSource(cfg, { backlog: false, clients: { twitch } });

  const rows = await source.run();

  assert.equal(vodCalls, 0);
  assert.deepEqual(rows.map((r) => [r.streamer, r.live, r.startedAt]), [['A', true, 'S']]);
});

test('twitch 소스: backlog=true 면 지난 VOD까지 붙인다', async () => {
  const rows = await buildTwitchSource(cfg, { clients: { twitch: twitchStub } }).run();

  assert.deepEqual(rows.map((r) => [r.streamer, r.live]), [['A', true], ['B', false]]);
  assert.equal(rows[1].url, 'U', 'VOD는 방송 링크가 아니라 영상 링크');
});

test('twitch 소스: game id 는 한 번만 조회하고 재사용한다', async () => {
  let lookups = 0;
  const twitch = { ...twitchStub, resolveGameId: async () => { lookups++; return '777'; } };
  const source = buildTwitchSource(cfg, { backlog: false, clients: { twitch } });

  await source.run();
  await source.run();

  assert.equal(lookups, 1, '1분마다 도는 기록기가 매번 조회하면 낭비다');
});

test('twitch 소스: 자격증명이 없으면 skip 이유를 단다', () => {
  const s = buildTwitchSource({ ...cfg, twitchClientId: null }, {});
  assert.equal(s.run, undefined);
  assert.match(s.skip, /TWITCH_CLIENT_ID/);
});

test('niconico 소스: backlog=false 면 방송중만 (스냅샷·과거 조회 안 함)', async () => {
  const called = [];
  const niconico = {
    searchLives: async (k, { status }) => { called.push(status); return [{ id: 'lv1' }]; },
    searchVideos: async () => { called.push('videos'); return []; },
  };

  const rows = await buildNiconicoSource(cfg, { backlog: false, clients: { niconico } }).run();

  assert.deepEqual(called, ['onair', 'onair'], '키워드 2개 × 방송중 조회');
  assert.equal(rows.length, 2);
});

test('youtubeLiveSighting: 채널 단위로 묶이도록 채널 id 를 쓴다', () => {
  const e = youtubeLiveSighting({ videoId: 'v1', channelId: 'UC1', channelName: '아리스', title: 't', liveViewers: 12, startedAt: 'S' });

  assert.deepEqual(e, {
    streamer: '아리스',
    streamerId: 'UC1',
    streamerUrl: 'https://www.youtube.com/channel/UC1',
    title: 't',
    url: 'https://youtu.be/v1',
    startedAt: 'S',
    views: 12,
    live: true,
  });
});

test('createSources: only 로 일부만 만든다', () => {
  const names = createSources(cfg, { only: ['twitch', 'bilibili'], clients: { twitch: twitchStub } })
    .map((s) => s.platform);
  assert.deepEqual(names, [PLATFORMS.twitch, PLATFORMS.bilibili]);
});
