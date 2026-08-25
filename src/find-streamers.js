// 여러 플랫폼에서 "최근 N일 안에 이 게임을 방송한 사람"을 모아 한 목록으로 합친다.
//
// 소스(플랫폼)별 수집 함수는 밖에서 주입한다 — 이 모듈은 순수하게
// 기간 필터 → 키워드 필터 → 사람 단위 병합 → 출력 포맷만 담당하므로 그대로 테스트된다.
//
// 소스가 넘겨야 하는 엔트리 형태:
//   { streamer, streamerId?, streamerUrl?, title, url, startedAt(ISO|null), views, live }

export const DEFAULT_MATCH_TERMS = ['Deadly Trick', '데들리 트릭', 'デッドリートリック'];

const DAY_MS = 86_400_000;

/** terms 중 하나라도 포함하면 true. terms 가 비면 필터를 끄고 전부 통과. */
export function matchesText(text, terms) {
  if (!terms?.length) return true;
  const haystack = String(text ?? '').toLowerCase();
  return terms.some((t) => haystack.includes(String(t).toLowerCase()));
}

/**
 * 기간 안에 방송했나. 지금 켜져 있는 방송은 시작시각을 몰라도(플랫폼이 안 주는 경우가 있다)
 * "지금 방송중"이므로 무조건 포함한다.
 */
export function withinWindow(entry, sinceMs, nowMs = Date.now()) {
  if (entry?.live) return true;
  const t = Date.parse(entry?.startedAt ?? '');
  if (!Number.isFinite(t)) return false;              // 시각을 모르는 과거 기록은 판단 불가 → 제외
  return t >= sinceMs && t <= nowMs + DAY_MS;         // 예약분이 섞여 들어오는 것 방지
}

/**
 * 같은 방송이 두 경로로 들어온 것(우리 기록 + 플랫폼 검색)을 하나로 친다.
 * 시작시각을 주는 플랫폼은 정확히 겹치고, 안 주는 플랫폼은 URL로 친다.
 */
export function dedupeEntries(entries) {
  const seen = new Set();
  const out = [];
  for (const e of entries) {
    const who = e.streamerId || e.streamer;
    const key = `${e.platform}|${who}|${e.startedAt ?? ''}|${e.startedAt ? '' : e.url ?? e.title ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

/** 같은 사람이 같은 플랫폼에서 여러 번 방송했으면 한 줄로 합친다. */
export function groupByStreamer(entries) {
  const byKey = new Map();
  for (const e of entries) {
    const key = `${e.platform}|${e.streamerId || e.streamer}`;
    const cur = byKey.get(key);
    const at = Date.parse(e.startedAt ?? '');
    if (!cur) {
      byKey.set(key, {
        platform: e.platform,
        streamer: e.streamer,
        streamerUrl: e.streamerUrl ?? null,
        streams: 1,
        live: Boolean(e.live),
        latestAt: e.startedAt ?? null,
        latestTitle: e.title ?? null,
        latestUrl: e.url ?? null,
        peakViews: Number(e.views ?? 0),
      });
      continue;
    }
    cur.streams += 1;
    cur.live = cur.live || Boolean(e.live);
    cur.peakViews = Math.max(cur.peakViews, Number(e.views ?? 0));
    const curAt = Date.parse(cur.latestAt ?? '');
    if (Number.isFinite(at) && (!Number.isFinite(curAt) || at > curAt)) {
      cur.latestAt = e.startedAt;
      cur.latestTitle = e.title ?? cur.latestTitle;
      cur.latestUrl = e.url ?? cur.latestUrl;
    }
    cur.streamerUrl = cur.streamerUrl ?? e.streamerUrl ?? null;
  }
  // 방송중이 위로, 그다음 최신순, 그다음 이름순
  return [...byKey.values()].sort((a, b) => {
    if (a.live !== b.live) return a.live ? -1 : 1;
    const d = (Date.parse(b.latestAt ?? '') || 0) - (Date.parse(a.latestAt ?? '') || 0);
    return d || String(a.streamer).localeCompare(String(b.streamer));
  });
}

/**
 * 소스들을 동시에 돌려 기간·키워드로 거른 엔트리를 모은다.
 * 한 플랫폼이 죽어도(키 없음·차단·스키마 변경) 나머지는 그대로 나오고, 실패는 errors 로 보고된다.
 *
 * @param {Array<{platform:string, run:() => Promise<Array>, filterByTerms?: boolean}>} sources
 */
export async function collect(sources, { days = 3, now = Date.now(), matchTerms = DEFAULT_MATCH_TERMS } = {}) {
  const since = now - days * DAY_MS;
  const entries = [];
  const errors = [];
  const skipped = [];

  await Promise.all(sources.map(async (source) => {
    if (source.skip) { skipped.push({ platform: source.platform, reason: source.skip }); return; }
    try {
      for (const e of (await source.run()) ?? []) {
        // 기록 소스는 엔트리마다 플랫폼이 다르므로 엔트리 값이 우선이다.
        const entry = { ...e, platform: e.platform ?? source.platform };
        if (!withinWindow(entry, since, now)) continue;
        // 카테고리로 조회한 소스(Twitch)는 이미 게임이 확정이라 제목 필터를 걸지 않는다.
        if (source.filterByTerms !== false && !matchesText(`${entry.title ?? ''}\n${entry.description ?? ''}`, matchTerms)) continue;
        entries.push(entry);
      }
    } catch (err) {
      errors.push({ platform: source.platform, message: err?.message ?? String(err) });
    }
  }));

  const unique = dedupeEntries(entries);
  return { since, now, days, entries: unique, errors, skipped, streamers: groupByStreamer(unique) };
}

const KST = 'Asia/Seoul';
const fmtTime = (iso) => {
  const t = Date.parse(iso ?? '');
  if (!Number.isFinite(t)) return '시각 미상';
  return new Date(t).toLocaleString('ko-KR', {
    timeZone: KST, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  });
};

/** 사람이 읽는 리포트(콘솔/디스코드 붙여넣기용). */
export function formatReport(result, { gameName = 'Deadly Trick' } = {}) {
  const lines = [];
  const from = fmtTime(new Date(result.since).toISOString());
  const to = fmtTime(new Date(result.now).toISOString());
  lines.push(`# ${gameName} — 최근 ${result.days}일 방송자 (${from} ~ ${to}, KST)`);
  lines.push(`총 ${result.streamers.length}명 / 방송·영상 ${result.entries.length}건`);

  const platforms = [...new Set(result.streamers.map((s) => s.platform))];
  for (const platform of platforms) {
    const rows = result.streamers.filter((s) => s.platform === platform);
    lines.push('', `## ${platform} — ${rows.length}명`);
    for (const s of rows) {
      const badge = s.live ? '🔴 방송중' : fmtTime(s.latestAt);
      const times = s.streams > 1 ? ` ×${s.streams}` : '';
      const views = s.peakViews ? ` · ${s.peakViews.toLocaleString('ko-KR')}` : '';
      lines.push(`- ${s.streamer}${times} — ${badge}${views}`);
      if (s.latestTitle) lines.push(`    ${s.latestTitle}`);
      lines.push(`    ${s.latestUrl ?? s.streamerUrl ?? ''}`.trimEnd());
    }
  }

  for (const s of result.skipped) lines.push('', `⏭  ${s.platform}: ${s.reason}`);
  for (const e of result.errors) lines.push('', `⚠️  ${e.platform} 조회 실패: ${e.message}`);
  if (!result.streamers.length && !result.errors.length) {
    lines.push('', '해당 기간에 잡힌 방송이 없습니다.');
  }
  return lines.join('\n');
}
