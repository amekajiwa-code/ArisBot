// 니코니코동화/니코니코생방송 클라이언트.
//
//  - 영상(생방송 타임시프트·편집본 포함): 공개 "스냅샷 검색 API v2". 인증 없이 쓰지만
//    User-Agent 를 요구하고 초당 1요청 제한이 있다.
//  - 생방송: 공개 검색 API가 없어 live.nicovideo.jp/search 의 HTML에 박힌
//    <script id="embedded-data" data-props="..."> JSON을 파싱한다. 페이지 구조가 바뀔 수
//    있으므로 특정 경로를 찍지 않고 "lv####### id + title" 을 가진 객체를 훑어 모은다.
//  - 투고자 이름은 검색 응답에 없어 nvapi 로 한 번 더 조회한다(실패하면 id 그대로 표시).

const SNAPSHOT = 'https://snapshot.search.nicovideo.jp/api/v2/snapshot/video/contents/search';
const LIVE_SEARCH = 'https://live.nicovideo.jp/search';
const NVAPI_USER = 'https://nvapi.nicovideo.jp/v1/users';

const UA = 'ArisBot/2.0 (+https://github.com/amekajiwa-code/ArisBot)';

/** HTML 엔티티 최소 디코드 — data-props 속성을 JSON으로 되돌릴 때 쓴다. */
export function decodeHtml(s) {
  return String(s ?? '')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** <script id="embedded-data" data-props="{...}"> 에서 JSON 추출. 없으면 null. */
export function extractEmbeddedData(html) {
  const m = String(html ?? '').match(/id="embedded-data"[^>]*\sdata-props="([^"]*)"/);
  if (!m) return null;
  try {
    return JSON.parse(decodeHtml(m[1]));
  } catch {
    return null;
  }
}

/** 초/밀리초 epoch 또는 날짜 문자열 → ISO. 못 읽으면 null. */
export function toIso(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return new Date(v > 1e12 ? v : v * 1000).toISOString();
  const n = Number(v);
  if (Number.isFinite(n) && String(v).trim() !== '') return toIso(n);
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

const pick = (o, keys) => keys.map((k) => o?.[k]).find((v) => v != null && v !== '');

/**
 * 임의 깊이의 JSON에서 생방송 프로그램처럼 생긴 객체(id가 lv숫자 + title 보유)를 모은다.
 * 페이지 스키마가 흔들려도 살아남게 하려는 의도적 덕타이핑.
 */
export function collectPrograms(node, out = new Map(), depth = 0) {
  if (!node || typeof node !== 'object' || depth > 12) return out;
  if (Array.isArray(node)) {
    for (const v of node) collectPrograms(v, out, depth + 1);
    return out;
  }
  const id = node.id ?? node.nicoliveProgramId ?? node.programId;
  if (typeof id === 'string' && /^lv\d+$/.test(id) && typeof node.title === 'string' && !out.has(id)) {
    const provider = node.programProvider ?? node.provider ?? node.socialGroup ?? node.supplier ?? {};
    out.set(id, {
      id,
      streamer: pick(provider, ['name', 'nickname']) ?? pick(node, ['providerName', 'userName']) ?? null,
      streamerId: String(pick(provider, ['id', 'programProviderId']) ?? '') || null,
      title: node.title,
      url: `https://live.nicovideo.jp/watch/${id}`,
      startedAt: toIso(pick(node, ['beginAt', 'beginTime', 'openTime', 'onAirTime', 'startTime'])),
      views:
        Number(node.statistics?.viewers ?? node.viewers ?? node.viewCount ?? 0) || 0,
      live: (node.status ?? node.liveCycle ?? '').toString().toUpperCase() === 'ON_AIR',
    });
  }
  for (const v of Object.values(node)) collectPrograms(v, out, depth + 1);
  return out;
}

export function createNiconicoClient({ fetch = globalThis.fetch, userAgent = UA } = {}) {
  const headers = { 'User-Agent': userAgent };

  /** 투고자 닉네임 조회(베스트에포트). 실패하면 null. */
  async function resolveUserName(userId) {
    if (!userId) return null;
    try {
      const res = await fetch(`${NVAPI_USER}/${encodeURIComponent(userId)}`, {
        headers: { ...headers, 'X-Frontend-Id': '6', 'X-Frontend-Version': '0' },
      });
      if (!res.ok) return null;
      const body = await res.json();
      return body?.data?.user?.nickname ?? null;
    } catch {
      return null;
    }
  }

  return {
    resolveUserName,

    /**
     * 스냅샷 검색 API — 제목·설명·태그에 키워드가 있는 영상을 새 것부터.
     * @param {string} keyword
     * @param {{since?: number|string, limit?: number, maxNameLookups?: number}} opts since 이후 투고분만
     */
    async searchVideos(keyword, { since, limit = 100, maxNameLookups = 40 } = {}) {
      const qs = new URLSearchParams({
        q: keyword,
        targets: 'title,description,tags',
        fields: 'contentId,title,userId,channelId,startTime,viewCounter',
        _sort: '-startTime',
        _limit: String(limit),
        _context: 'ArisBot',
      });
      if (since != null) {
        // API는 오프셋 포함 ISO 8601만 받는다 ("...Z" 는 거절).
        qs.set('filters[startTime][gte]', new Date(since).toISOString().replace('Z', '+00:00'));
      }
      const res = await fetch(`${SNAPSHOT}?${qs}`, { headers });
      if (!res.ok) throw new Error(`niconico snapshot HTTP ${res.status}`);
      const body = await res.json();
      if (body?.meta?.status && body.meta.status !== 200) {
        throw new Error(`niconico snapshot status ${body.meta.status}: ${body?.meta?.errorMessage ?? ''}`);
      }
      const rows = body?.data ?? [];
      const names = new Map();
      for (const v of rows) {                       // 닉네임 조회는 1건당 1요청 → 상한을 둔다
        if (!v.userId || names.has(v.userId)) continue;
        names.set(v.userId, names.size < maxNameLookups ? await resolveUserName(v.userId) : null);
      }
      return rows.map((v) => ({
        id: v.contentId,
        streamer: names.get(v.userId) ?? (v.channelId ? `채널 ${v.channelId}` : `user/${v.userId ?? '?'}`),
        streamerId: String(v.userId ?? v.channelId ?? ''),
        streamerUrl: v.userId ? `https://www.nicovideo.jp/user/${v.userId}` : null,
        title: v.title,
        url: `https://www.nicovideo.jp/watch/${v.contentId}`,
        startedAt: toIso(v.startTime),
        views: Number(v.viewCounter ?? 0),
        live: false,
      }));
    },

    /**
     * 생방송 검색(HTML 파싱). status: 'onair'(방송중) | 'past'(최근 종료) | 'reserved'.
     */
    async searchLives(keyword, { status = 'onair' } = {}) {
      const qs = new URLSearchParams({ keyword, status, sortOrder: 'recentDesc' });
      const res = await fetch(`${LIVE_SEARCH}?${qs}`, { headers });
      if (!res.ok) throw new Error(`niconico live search HTTP ${res.status}`);
      const data = extractEmbeddedData(await res.text());
      if (!data) return [];
      return [...collectPrograms(data).values()].map((p) => ({
        ...p,
        live: status === 'onair' ? true : p.live,
        streamer: p.streamer ?? (p.streamerId ? `user/${p.streamerId}` : '(이름 미상)'),
        streamerUrl: p.streamerId ? `https://www.nicovideo.jp/user/${p.streamerId}` : null,
      }));
    },
  };
}
