import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createYouTubeClient } from '../src/youtube.js';

// Raw search.list item — carries the video id but no viewer count.
const hit = (videoId) => ({ id: { kind: 'youtube#video', videoId }, snippet: { title: 'from search' } });

// Raw videos.list item — this is where concurrentViewers lives.
const detail = (id, channelName, opts = {}) => ({
  id,
  snippet: {
    title: opts.title ?? 't',
    description: opts.description ?? 'd',
    channelTitle: channelName,
    channelId: opts.channelId ?? 'c1',
  },
  liveStreamingDetails: {
    actualStartTime: '2026-08-06T10:00:00Z',
    ...(opts.viewers === undefined ? {} : { concurrentViewers: String(opts.viewers) }),
    ...(opts.endedAt ? { actualEndTime: opts.endedAt } : {}),
  },
});

// A fetch that answers /search and /videos from fixtures, recording every call.
function fakeApi({ search = [], videos = [] } = {}) {
  const calls = [];
  const fetch = async (url, opts) => {
    calls.push({ url, opts });
    const body = url.includes('/youtube/v3/search') ? { items: search } : { items: videos };
    return { ok: true, status: 200, json: async () => body };
  };
  return { fetch, calls };
}
const urlsOf = (calls) => calls.map((c) => c.url);

test('client: fetchLives searches for live videos with the query and api key', async () => {
  const { fetch, calls } = fakeApi();
  const client = createYouTubeClient({ apiKey: 'k', fetch });

  await client.fetchLives('"Deadly Trick"');

  const u = new URL(calls[0].url);
  assert.equal(u.origin + u.pathname, 'https://www.googleapis.com/youtube/v3/search');
  assert.equal(u.searchParams.get('eventType'), 'live');
  assert.equal(u.searchParams.get('type'), 'video');
  assert.equal(u.searchParams.get('part'), 'snippet');
  assert.equal(u.searchParams.get('order'), 'viewCount');
  assert.equal(u.searchParams.get('maxResults'), '50');
  assert.equal(u.searchParams.get('q'), '"Deadly Trick"');
  assert.equal(u.searchParams.get('key'), 'k');
});

test('client: fetchLives batches the found ids into one videos.list call', async () => {
  const { fetch, calls } = fakeApi({
    search: [hit('v1'), hit('v2'), hit('v3')],
    videos: [detail('v1', 'A'), detail('v2', 'B'), detail('v3', 'C')],
  });
  const client = createYouTubeClient({ apiKey: 'k', fetch });

  await client.fetchLives('q');

  assert.equal(calls.length, 2, 'one search + one videos call');
  const u = new URL(calls[1].url);
  assert.equal(u.origin + u.pathname, 'https://www.googleapis.com/youtube/v3/videos');
  assert.equal(u.searchParams.get('id'), 'v1,v2,v3');
  assert.equal(u.searchParams.get('part'), 'snippet,liveStreamingDetails');
});

test('client: fetchLives maps videos.list into compact live objects', async () => {
  const { fetch } = fakeApi({
    search: [hit('v1')],
    videos: [detail('v1', '아리스', { title: '데들리 트릭 8인', description: '합방', viewers: 1200 })],
  });
  const client = createYouTubeClient({ apiKey: 'k', fetch });

  const lives = await client.fetchLives('q');

  assert.deepEqual(lives, [{
    videoId: 'v1',
    channelId: 'c1',
    channelName: '아리스',
    title: '데들리 트릭 8인',
    description: '합방',
    startedAt: '2026-08-06T10:00:00Z',
    liveViewers: 1200,
  }]);
});

test('client: a missing concurrentViewers count maps to 0', async () => {
  const { fetch } = fakeApi({ search: [hit('v1')], videos: [detail('v1', 'A')] });
  const client = createYouTubeClient({ apiKey: 'k', fetch });

  const lives = await client.fetchLives('q');

  assert.equal(lives[0].liveViewers, 0);
});

test('client: a stream that already ended is dropped', async () => {
  const { fetch } = fakeApi({
    search: [hit('v1'), hit('v2')],
    videos: [
      detail('v1', 'A', { viewers: 100, endedAt: '2026-08-06T11:00:00Z' }),
      detail('v2', 'B', { viewers: 80 }),
    ],
  });
  const client = createYouTubeClient({ apiKey: 'k', fetch });

  const lives = await client.fetchLives('q');

  assert.deepEqual(lives.map((l) => l.videoId), ['v2']);
});

test('client: an empty search result skips the videos.list call entirely', async () => {
  const { fetch, calls } = fakeApi({ search: [] });
  const client = createYouTubeClient({ apiKey: 'k', fetch });

  const lives = await client.fetchLives('q');

  assert.deepEqual(lives, []);
  assert.equal(calls.length, 1, 'search only — no quota spent on videos.list');
  assert.ok(urlsOf(calls)[0].includes('/search'));
});

test('client: a non-200 search response throws', async () => {
  const fetch = async () => ({ ok: false, status: 403, json: async () => ({}) });
  const client = createYouTubeClient({ apiKey: 'k', fetch });

  await assert.rejects(() => client.fetchLives('q'), /youtube search HTTP 403/);
});

test('client: a non-200 videos response throws', async () => {
  const fetch = async (url) => (url.includes('/search')
    ? { ok: true, status: 200, json: async () => ({ items: [hit('v1')] }) }
    : { ok: false, status: 500, json: async () => ({}) });
  const client = createYouTubeClient({ apiKey: 'k', fetch });

  await assert.rejects(() => client.fetchLives('q'), /youtube videos HTTP 500/);
});

// ── fetchRecentStreams: 최근 N일 안에 실제로 시작한 라이브(진행중 + 종료분)
const streamDetail = (id, channelName, opts = {}) => ({
  id,
  snippet: { title: opts.title ?? 't', description: 'd', channelTitle: channelName, channelId: opts.channelId ?? 'c1' },
  liveStreamingDetails: {
    ...(opts.startedAt === null ? {} : { actualStartTime: opts.startedAt ?? '2026-08-24T10:00:00Z' }),
    ...(opts.scheduledAt ? { scheduledStartTime: opts.scheduledAt } : {}),
    ...(opts.endedAt ? { actualEndTime: opts.endedAt } : {}),
    ...(opts.viewers === undefined ? {} : { concurrentViewers: String(opts.viewers) }),
  },
  statistics: { viewCount: String(opts.viewCount ?? 0) },
});

test('client: fetchRecentStreams searches live + completed with publishedAfter', async () => {
  const { fetch, calls } = fakeApi();
  const client = createYouTubeClient({ apiKey: 'k', fetch });

  await client.fetchRecentStreams('"Deadly Trick"', { publishedAfter: '2026-08-22T12:00:00Z' });

  const types = urlsOf(calls).map((u) => new URL(u).searchParams.get('eventType'));
  assert.deepEqual(types, ['live', 'completed']);
  const u = new URL(calls[0].url);
  assert.equal(u.searchParams.get('order'), 'date');
  assert.equal(u.searchParams.get('publishedAfter'), '2026-08-22T12:00:00Z');
});

test('client: fetchRecentStreams marks ended streams and keeps their view count', async () => {
  const { fetch } = fakeApi({
    search: [hit('v1'), hit('v2')],
    videos: [
      streamDetail('v1', '켜짐', { viewers: 42 }),
      streamDetail('v2', '끝남', { endedAt: '2026-08-24T13:00:00Z', viewCount: 900 }),
    ],
  });
  const client = createYouTubeClient({ apiKey: 'k', fetch });

  const rows = await client.fetchRecentStreams('q');

  assert.deepEqual(rows.map((r) => [r.channelName, r.live, r.liveViewers, r.viewCount]), [
    ['켜짐', true, 42, 0],
    ['끝남', false, 0, 900],
  ]);
  assert.equal(rows[0].startedAt, '2026-08-24T10:00:00Z');
});

test('client: fetchRecentStreams drops plain videos and not-yet-started schedules', async () => {
  const { fetch } = fakeApi({
    search: [hit('v1'), hit('v2'), hit('v3')],
    videos: [
      streamDetail('v1', '방송함'),
      { id: 'v2', snippet: { channelTitle: '일반영상' } },                                    // liveStreamingDetails 없음
      streamDetail('v3', '예약만', { startedAt: null, scheduledAt: '2026-08-30T10:00:00Z' }), // 아직 안 켬
    ],
  });
  const client = createYouTubeClient({ apiKey: 'k', fetch });

  const rows = await client.fetchRecentStreams('q');

  assert.deepEqual(rows.map((r) => r.channelName), ['방송함']);
});

test('client: fetchRecentStreams dedupes ids across the two searches into one videos.list call', async () => {
  const { fetch, calls } = fakeApi({ search: [hit('v1'), hit('v1')], videos: [streamDetail('v1', 'A')] });
  const client = createYouTubeClient({ apiKey: 'k', fetch });

  await client.fetchRecentStreams('q');

  const videoCalls = urlsOf(calls).filter((u) => u.includes('/videos?'));
  assert.equal(videoCalls.length, 1);
  assert.equal(new URL(videoCalls[0]).searchParams.get('id'), 'v1');
});

test('client: fetchRecentStreams skips videos.list when nothing was found', async () => {
  const { fetch, calls } = fakeApi();
  const client = createYouTubeClient({ apiKey: 'k', fetch });

  assert.deepEqual(await client.fetchRecentStreams('q'), []);
  assert.equal(urlsOf(calls).filter((u) => u.includes('/videos?')).length, 0);
});
