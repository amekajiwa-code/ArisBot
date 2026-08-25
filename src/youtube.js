// YouTube Data API v3 client — finds live streams by search phrase.
//
// Two calls per poll, because search.list doesn't return viewer counts:
//   1. search.list  → live video ids       (own quota bucket: 100 calls/DAY)
//   2. videos.list  → concurrentViewers    (1 unit from the 10k pool, 50 ids per call)
// The 100/day cap on step 1 is what pins the poll interval at 15 minutes.
// An API key is enough (public read-only data, no OAuth). `fetch` is injectable for testing.

const API = 'https://www.googleapis.com/youtube/v3';

export function createYouTubeClient({ apiKey, fetch = globalThis.fetch }) {
  async function getJson(path, params, tag) {
    const qs = new URLSearchParams({ ...params, key: apiKey });
    const res = await fetch(`${API}/${path}?${qs}`);
    if (!res.ok) throw new Error(`youtube ${tag} HTTP ${res.status}`);
    return res.json();
  }

  /**
   * Streams currently live for `query`. The query is passed to YouTube's `q`, which
   * matches title/description/tags — relevance-based, so callers should still filter
   * the result (see matchesTerms in youtube-watch.js).
   */
  async function fetchLives(query) {
    const found = await getJson('search', {
      part: 'snippet',
      eventType: 'live',
      type: 'video',
      order: 'viewCount',
      maxResults: '50',
      q: query,
    }, 'search');

    const ids = (found?.items ?? []).map((i) => i?.id?.videoId).filter(Boolean);
    if (!ids.length) return [];                       // nothing live → don't spend a second call

    const detailed = await getJson('videos', {
      part: 'snippet,liveStreamingDetails',
      id: ids.join(','),
    }, 'videos');

    return (detailed?.items ?? [])
      .filter((v) => !v?.liveStreamingDetails?.actualEndTime)   // already over
      .map((v) => ({
        videoId: v.id,
        channelName: v.snippet?.channelTitle,
        title: v.snippet?.title,
        description: v.snippet?.description,
        liveViewers: Number(v.liveStreamingDetails?.concurrentViewers ?? 0),
      }));
  }

  /**
   * 최근 N일 안에 "실제로 시작한" 라이브(진행중 + 종료분). search.list 는 eventType 별로
   * 한 번씩 필요하고(각 100 unit) videos.list 로 시작/종료 시각과 시청자수를 채운다.
   * 예약만 걸린 방송(actualStartTime 없음)은 방송한 적이 없으므로 버린다.
   *
   * @param {string} query
   * @param {{publishedAfter?: string, eventTypes?: string[], maxResults?: number}} opts
   *        publishedAfter 는 RFC3339 (예: 2026-08-22T00:00:00Z)
   */
  async function fetchRecentStreams(query, { publishedAfter, eventTypes = ['live', 'completed'], maxResults = 50 } = {}) {
    const ids = new Set();
    for (const eventType of eventTypes) {
      const found = await getJson('search', {
        part: 'snippet',
        type: 'video',
        eventType,
        order: 'date',
        maxResults: String(maxResults),
        q: query,
        ...(publishedAfter ? { publishedAfter } : {}),
      }, 'search');
      for (const i of found?.items ?? []) if (i?.id?.videoId) ids.add(i.id.videoId);
    }
    if (!ids.size) return [];

    const all = [...ids];
    const out = [];
    for (let i = 0; i < all.length; i += 50) {                 // videos.list 는 한 번에 50개
      const detailed = await getJson('videos', {
        part: 'snippet,liveStreamingDetails,statistics',
        id: all.slice(i, i + 50).join(','),
      }, 'videos');
      for (const v of detailed?.items ?? []) {
        const d = v?.liveStreamingDetails;
        if (!d?.actualStartTime) continue;                     // 일반 영상 · 예약만 된 방송
        out.push({
          videoId: v.id,
          channelId: v.snippet?.channelId,
          channelName: v.snippet?.channelTitle,
          title: v.snippet?.title,
          description: v.snippet?.description,
          startedAt: d.actualStartTime,
          endedAt: d.actualEndTime ?? null,
          live: !d.actualEndTime,
          liveViewers: Number(d.concurrentViewers ?? 0),
          viewCount: Number(v.statistics?.viewCount ?? 0),
        });
      }
    }
    return out;
  }

  return { fetchLives, fetchRecentStreams };
}
