// CHZZK (치지직) official Open API client.
// Auth is "Client 인증": Client-Id + Client-Secret headers (no token exchange).
// The Open API has no category filter, so fetchCategoryLives() pages through the
// top lives (viewer-count desc) and keeps those whose liveCategory matches —
// best-effort within `maxPages`. `fetch` is injectable for testing.

const OPENAPI = 'https://openapi.chzzk.naver.com';

export function createChzzkClient({ clientId, clientSecret, fetch = globalThis.fetch }) {
  const headers = {
    'Client-Id': clientId,
    'Client-Secret': clientSecret,
    'Content-Type': 'application/json',
  };

  /** One page of currently-live channels (sorted by viewers desc), plus the next cursor. */
  async function fetchLivesPage({ size = 20, next } = {}) {
    const qs = new URLSearchParams({ size: String(size) });
    if (next) qs.set('next', next);
    const res = await fetch(`${OPENAPI}/open/v1/lives?${qs}`, { headers });
    if (!res.ok) throw new Error(`chzzk lives HTTP ${res.status}`);
    const body = await res.json();
    const data = body?.content?.data ?? [];
    return {
      lives: data.map((d) => ({
        channelId: d.channelId,
        channelName: d.channelName,
        liveTitle: d.liveTitle,
        concurrentUserCount: d.concurrentUserCount,
        liveCategory: d.liveCategory,
        liveCategoryValue: d.liveCategoryValue,
        categoryType: d.categoryType,
      })),
      next: body?.content?.page?.next ?? null,
    };
  }

  /**
   * Lives currently in `categoryId` (e.g. "Deadly_Trick"), found by scanning up to
   * `maxPages` of the top lives. Niche categories may sit below the scanned range.
   */
  async function fetchCategoryLives(categoryId, { maxPages = 10, size = 20 } = {}) {
    const found = [];
    let next;
    for (let i = 0; i < maxPages; i++) {
      const page = await fetchLivesPage({ size, next });
      for (const l of page.lives) {
        if (l.liveCategory === categoryId) found.push(l);
      }
      if (!page.next) break;
      next = page.next;
    }
    return found;
  }

  return { fetchLivesPage, fetchCategoryLives };
}
