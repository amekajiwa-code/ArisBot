// CHZZK (치지직) official Open API client.
// Auth is "Client 인증": Client-Id + Client-Secret headers (no token exchange).
// The Open API has no category filter, so fetchCategoryLives() pages through the
// top lives (viewer-count desc) and keeps those whose liveCategory matches —
// best-effort within `maxPages`. `fetch` is injectable for testing.

const OPENAPI = 'https://openapi.chzzk.naver.com';

/**
 * 스캔 깊이 진단 — "상위 N개만 훑는" 한계가 실제로 알림에 영향이 있는지 판단한다.
 *
 * 라이브 목록은 시청자수 내림차순이라, 스캔 끝자락의 시청자수가 이미 알림 하한보다
 * 낮으면 그 아래는 볼 필요가 없다(하한을 넘을 수 없으므로). 반대로 끝자락이 아직
 * 하한 위면 못 본 구간에 알림 대상이 남아 있을 수 있다.
 *
 * @param {Array<Array<{concurrentUserCount:number}>>} pages 페이지별 라이브 목록
 * @param {number} minViewers 알림 시청자 하한
 */
export function summarizeDepth(pages, minViewers) {
  const rows = [];
  let cumulative = 0;
  let crossedAt = null;                       // 하한 아래로 처음 내려간 페이지
  for (const [i, lives] of pages.entries()) {
    if (!lives.length) continue;
    cumulative += lives.length;
    const low = Math.min(...lives.map((l) => Number(l.concurrentUserCount ?? 0)));
    rows.push({ page: i + 1, cumulative, lowest: low });
    if (crossedAt == null && low < minViewers) crossedAt = i + 1;
  }
  const lowest = rows.length ? rows[rows.length - 1].lowest : null;
  return {
    minViewers,
    scanned: cumulative,
    rows,
    lowest,                                   // 스캔 끝(최하위)의 시청자수
    covered: lowest != null && lowest < minViewers,   // 하한이 이미 커버됐나
    pagesNeeded: crossedAt,                   // 하한을 만나는 데 필요한 페이지 수
  };
}

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
