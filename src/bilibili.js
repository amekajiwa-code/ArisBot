// Bilibili(비리비리) 공개 웹 검색 API 클라이언트 — 최근 영상 + 진행중 라이브를 키워드로 찾는다.
//
// 공식 개발자 API가 아니라 웹에서 쓰는 공개 엔드포인트라 두 가지 제약이 있다:
//   1. buvid3 쿠키가 없으면 -412(풍제어)로 막힌다 → 첫 요청 전에 홈페이지에서 쿠키를 받아둔다.
//   2. 검색 결과의 제목은 <em class="keyword">로 하이라이트된 HTML이다 → stripHighlight()로 벗긴다.
// 쿠키를 직접 넣고 싶으면 BILIBILI_COOKIE 로 주입한다. `fetch` 는 테스트용으로 주입 가능.

const HOME = 'https://www.bilibili.com/';
const SEARCH = 'https://api.bilibili.com/x/web-interface/search/type';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/124.0 Safari/537.36';

/** 검색 결과 제목의 하이라이트 태그·HTML 엔티티 제거. */
export function stripHighlight(s) {
  return String(s ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();
}

/** 검색 응답의 arcurl 은 //, http://, https:// 가 섞여 온다. */
export function normalizeUrl(u) {
  const s = String(u ?? '').trim();
  if (!s) return null;
  if (s.startsWith('//')) return `https:${s}`;
  return s.replace(/^http:\/\//, 'https://');
}

/** "2026-08-25 21:03:00" (라이브 시작시각) → ISO. 0/빈값이면 null. */
export function parseLiveTime(v) {
  if (!v || v === '0' || v === 0) return null;
  if (typeof v === 'number') return new Date(v * 1000).toISOString();
  const t = Date.parse(String(v).replace(' ', 'T') + '+08:00'); // 응답은 중국 표준시 기준
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

export function createBilibiliClient({ cookie = null, fetch = globalThis.fetch } = {}) {
  let jar = cookie?.trim() || null;

  /** buvid3 쿠키 확보 — 실패해도 임의값으로 진행한다(없는 것보단 통과율이 높다). */
  async function ensureCookie() {
    if (jar) return jar;
    try {
      const res = await fetch(HOME, { headers: { 'User-Agent': UA } });
      const raw = res.headers?.getSetCookie?.() ?? [res.headers?.get?.('set-cookie')].filter(Boolean);
      const pairs = raw
        .map((c) => String(c).split(';')[0])
        .filter((c) => /^(buvid3|b_nut|buvid4|SESSDATA)=/.test(c));
      if (pairs.length) jar = pairs.join('; ');
    } catch {
      /* 무시하고 아래 폴백 */
    }
    if (!jar) jar = `buvid3=${crypto.randomUUID().toUpperCase()}infoc`;
    return jar;
  }

  async function search(searchType, keyword, extra = {}) {
    const qs = new URLSearchParams({ search_type: searchType, keyword, page: '1', ...extra });
    const res = await fetch(`${SEARCH}?${qs}`, {
      headers: { 'User-Agent': UA, Referer: HOME, Cookie: await ensureCookie() },
    });
    if (!res.ok) throw new Error(`bilibili ${searchType} HTTP ${res.status}`);
    const body = await res.json();
    if (body?.code !== 0) {
      const hint = body?.code === -412 ? ' (풍제어 — BILIBILI_COOKIE 에 로그인 쿠키를 넣어보세요)' : '';
      throw new Error(`bilibili ${searchType} code ${body?.code}: ${body?.message ?? ''}${hint}`);
    }
    const result = body?.data?.result;
    if (Array.isArray(result)) return result;
    return result?.live_room ?? [];             // search_type=live 는 { live_room, live_user } 형태
  }

  return {
    /** 키워드로 올라온 최근 투고 영상(신규순). 라이브 다시보기·편집본이 여기 잡힌다. */
    async searchVideos(keyword, { page = 1 } = {}) {
      const rows = await search('video', keyword, { order: 'pubdate', page: String(page) });
      return rows.map((v) => ({
        id: v.bvid,
        streamer: stripHighlight(v.author),
        streamerId: String(v.mid ?? ''),
        streamerUrl: v.mid ? `https://space.bilibili.com/${v.mid}` : null,
        title: stripHighlight(v.title),
        url: v.bvid ? `https://www.bilibili.com/video/${v.bvid}` : normalizeUrl(v.arcurl),
        startedAt: v.pubdate ? new Date(v.pubdate * 1000).toISOString() : null,
        views: Number(v.play ?? 0),
        live: false,
      }));
    },

    /** 지금 방송중인 라이브 방. 켜져 있으면 "3일 내 방송"에 무조건 포함된다. */
    async searchLiveRooms(keyword) {
      const rows = await search('live_room', keyword, { order: 'online' });
      return rows.map((r) => ({
        id: String(r.roomid ?? ''),
        streamer: stripHighlight(r.uname),
        streamerId: String(r.uid ?? ''),
        streamerUrl: r.uid ? `https://space.bilibili.com/${r.uid}` : null,
        title: stripHighlight(r.title),
        url: `https://live.bilibili.com/${r.roomid}`,
        startedAt: parseLiveTime(r.live_time),
        views: Number(r.online ?? 0),
        live: true,
      }));
    },
  };
}
