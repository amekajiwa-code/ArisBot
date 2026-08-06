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

  return { fetchLives };
}
