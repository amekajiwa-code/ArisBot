// 방송 목격 기록.
//
// 플랫폼 검색으로 과거를 되짚는 데는 구멍이 있다 — 트위치는 VOD를 안 남기면 끝난 방송의
// 흔적이 없고, 나머지 셋은 제목에 게임명을 안 쓰면 검색에 안 걸린다. 그래서 짧은 주기로
// 훑어서 "그때 켜져 있던 사람"을 우리가 직접 적어둔다. "지난 3일에 누가 방송했나"는
// 이 기록으로 답한다.
//
// 저장 단위는 목격 1건이 아니라 **방송 1회(session)** 다. 1분마다 적으면 5시간 방송이
// 300줄이 되므로, 같은 방송이면 lastSeenAt·peakViews만 갱신한다.
//
// 순수 병합 로직(mergeSightings/pruneSessions/sessionsToEntries)과 파일 입출력을 분리해
// 파일 없이도 그대로 테스트된다.

import { promises as nodeFs } from 'node:fs';
import { dirname } from 'node:path';

const MIN = 60_000;
export const DEFAULT_LIVE_WINDOW_MS = 5 * MIN;   // 마지막 목격이 이보다 오래되면 "방송중"이 아니다

const whoOf = (s) => String(s.streamerId || s.streamer || '').trim();

/**
 * 이 목격이 기존 방송의 연속인가.
 *  - 다시보기·투고 영상: URL이 고유 → URL로 매칭
 *  - 시작시각을 주는 플랫폼: 시작시각이 같으면 같은 방송
 *  - 시작시각을 안 주는 플랫폼: 같은 사람을 gapMs 안에 다시 봤으면 같은 방송으로 잇는다
 */
function isSameSession(session, entry, { platform, who, now, gapMs }) {
  if (session.platform !== platform || whoOf(session) !== who) return false;
  if (!entry.live && entry.url) return session.url === entry.url;
  if (entry.startedAt) return session.startedAt === entry.startedAt;
  return !session.startedAt && now - Date.parse(session.lastSeenAt) <= gapMs;
}

/** 목격 결과를 세션 목록에 합친다(원본 불변). */
export function mergeSightings(sessions, platform, entries, { now = Date.now(), gapMs = 30 * MIN } = {}) {
  const out = sessions.slice();
  const seenAt = new Date(now).toISOString();

  for (const entry of entries ?? []) {
    const who = whoOf(entry);
    if (!who) continue;                                    // 누군지 모르면 기록할 게 없다
    const found = out.find((s) => isSameSession(s, entry, { platform, who, now, gapMs }));
    if (!found) {
      out.push({
        platform,
        streamer: entry.streamer ?? who,
        streamerId: entry.streamerId ?? null,
        streamerUrl: entry.streamerUrl ?? null,
        title: entry.title ?? null,
        url: entry.url ?? null,
        startedAt: entry.startedAt ?? null,
        firstSeenAt: seenAt,
        lastSeenAt: seenAt,
        peakViews: Number(entry.views ?? 0),
        sightings: 1,
        live: Boolean(entry.live),
      });
      continue;
    }
    found.lastSeenAt = seenAt;
    found.sightings += 1;
    found.peakViews = Math.max(found.peakViews, Number(entry.views ?? 0));
    found.live = Boolean(entry.live);
    found.streamer = entry.streamer ?? found.streamer;     // 닉네임 변경 반영
    found.title = entry.title ?? found.title;
    found.url = entry.url ?? found.url;
    found.streamerUrl = found.streamerUrl ?? entry.streamerUrl ?? null;
  }
  return out;
}

/** 마지막 목격이 cutoff 이전인 세션을 버린다. */
export function pruneSessions(sessions, cutoffMs) {
  return sessions.filter((s) => {
    const t = Date.parse(s.lastSeenAt ?? '');
    return Number.isFinite(t) ? t >= cutoffMs : false;
  });
}

/**
 * 세션 → 수집기(find-streamers)가 쓰는 엔트리.
 * 기록 당시엔 켜져 있었어도 지금 켜져 있다는 뜻은 아니므로, 최근에 본 것만 live 로 표시한다.
 */
export function sessionsToEntries(sessions, { now = Date.now(), liveWindowMs = DEFAULT_LIVE_WINDOW_MS } = {}) {
  return sessions.map((s) => ({
    platform: s.platform,
    streamer: s.streamer,
    streamerId: s.streamerId,
    streamerUrl: s.streamerUrl,
    title: s.title,
    url: s.url,
    startedAt: s.startedAt ?? s.firstSeenAt,
    views: s.peakViews,
    live: Boolean(s.live) && now - Date.parse(s.lastSeenAt ?? '') <= liveWindowMs,
  }));
}

/**
 * 파일에 얹은 기록. 저장은 tmp 파일 → rename 이라 중간에 죽어도 반쪽 파일이 남지 않는다.
 * @param {object} opts
 * @param {string} opts.path              JSON 경로 (예: data/streams.json)
 * @param {number} opts.retentionDays     이보다 오래된 세션은 저장 시 버린다
 */
export function createStreamLog({
  path,
  retentionDays = 14,
  gapMs = 30 * MIN,
  now = () => Date.now(),
  fs = nodeFs,
  warn = console.warn,
} = {}) {
  let cache = null;

  async function load() {
    if (cache) return cache;
    try {
      const parsed = JSON.parse(await fs.readFile(path, 'utf8'));
      cache = Array.isArray(parsed?.sessions) ? parsed.sessions : [];
    } catch (e) {
      if (e?.code !== 'ENOENT') {
        // 깨진 파일 때문에 기록이 멈추면 안 된다 — 옆으로 치우고 새로 시작.
        const moved = `${path}.corrupt-${Date.now()}`;
        warn(`[record] ${path} 를 읽지 못했습니다(${e?.message ?? e}) → ${moved} 로 옮기고 새로 시작합니다.`);
        await fs.rename(path, moved).catch(() => {});
      }
      cache = [];
    }
    return cache;
  }

  async function save() {
    const body = JSON.stringify({ version: 1, updatedAt: new Date(now()).toISOString(), sessions: cache }, null, 0);
    await fs.mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    await fs.writeFile(tmp, body, 'utf8');
    await fs.rename(tmp, path);
  }

  return {
    path,
    /** 저장된 세션 전부(최근 것부터 정렬하지는 않는다). */
    async sessions() {
      return [...(await load())];
    },
    /** 한 플랫폼의 목격 결과를 합쳐 저장하고, 새로 생긴 방송 수를 돌려준다. */
    async record(platform, entries) {
      const before = (await load()).length;
      const at = now();
      cache = pruneSessions(mergeSightings(cache, platform, entries, { now: at, gapMs }), at - retentionDays * 24 * 60 * MIN);
      await save();
      return Math.max(0, cache.length - before);
    },
    /** 최근 N일 안에 방송한 기록을 수집기 엔트리로. */
    async entriesSince(sinceMs, { liveWindowMs } = {}) {
      const at = now();
      return sessionsToEntries(await load(), { now: at, liveWindowMs })
        .filter((e) => e.live || Date.parse(e.startedAt ?? '') >= sinceMs);
    },
  };
}
