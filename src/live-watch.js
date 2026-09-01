// 이미 받아온 라이브 목록으로 굴러가는 알림 워처 (비리비리 · 니코니코).
//
// 다른 워처들(twitch/chzzk/youtube)은 스스로 폴링하지만, 이 둘은 **기록기가 1분마다
// 훑는 결과를 그대로 받아쓴다** — 알림을 붙이면서 요청은 한 건도 안 늘어난다.
// 그래서 tick() 대신 push(목록)를 받는다. 판단 규칙은 다른 워처와 같다:
// 첫 push 는 기준선만 잡고(재시작해도 이미 켜진 방송을 다시 안 알림), 그 뒤로
// "직전에 없던 방송"만 한 번 알린다.

/** 플랫폼 브랜드색 — 임베드 왼쪽 띠. */
export const COLORS = { bilibili: 0xfb7299, niconico: 0x252525 };

/** 방송 1회를 가리키는 키. 비리비리는 방 id, 니코니코는 lv 번호가 들어온다. */
export function idOf(live) {
  return String(live?.id ?? live?.streamerId ?? live?.url ?? '');
}

/**
 * 이 방송이 정말 그 게임인가. 비리비리·니코니코 검색은 관련성 기반이라
 * 엉뚱한 방송도 물어온다 — YouTube 워처와 같은 2차 필터다.
 * terms 가 비면 필터를 끈다.
 */
export function matchesTerms(live, terms) {
  if (!terms?.length) return true;
  const haystack = `${live?.title ?? ''}\n${live?.description ?? ''}`.toLowerCase();
  return terms.some((t) => haystack.includes(String(t).toLowerCase()));
}

/** 새로 알릴 방송: 시청자 하한을 넘고, 직전 목록엔 없던 것. 기준선 전이면 []. */
export function newStreamers(known, lives, minViewers = 0) {
  if (known == null) return [];
  return lives.filter((l) => Number(l.views ?? 0) >= minViewers && !known.has(idOf(l)));
}

/**
 * 알림 임베드 — 다른 플랫폼과 같은 모양:
 *   제목: "{platform}에서 {이름}님이 {카테고리} 방송중!"
 *   본문: (방송 제목) + 마지막 줄에 방송 링크
 */
export function buildAlert(live, categoryName, platform, color) {
  const url = live.url ?? live.streamerUrl ?? null;
  const lines = [];
  if (live.title) lines.push(live.title);
  if (url) lines.push(url);
  return {
    embeds: [{
      title: `${platform}에서 ${live.streamer}님이 ${categoryName} 방송중!`,
      ...(url ? { url } : {}),
      description: lines.join('\n'),
      color,
    }],
  };
}

/** 재알림 억제 기본값 — 같은 방송을 이 시간 안에는 두 번 알리지 않는다. */
export const DEFAULT_COOLDOWN_MS = 6 * 60 * 60 * 1000;

/**
 * @param {object} opts
 * @param {(payload: object) => Promise<void>} opts.send
 * @param {string[]} opts.matchTerms   검색 오탐 필터 (비우면 끔)
 * @param {number} opts.cooldownMs     같은 방송 재알림 금지 기간
 * @param {() => number} opts.now      시계 (테스트용 주입)
 */
export function createLiveWatcher({
  send, categoryName, minViewers = 0, platform, color, matchTerms = [],
  cooldownMs = DEFAULT_COOLDOWN_MS, now = () => Date.now(),
}) {
  let known = null;              // 직전 push 에서 조건을 만족한 방송 키들 (null = 기준선 없음)
  const alertedAt = new Map();   // 방송 키 → 마지막으로 알린 시각
  return {
    get known() { return known; },
    async push(found) {
      if (found == null) return;                                        // 조회 실패 → 기준선 유지
      const t = now();
      const lives = found.filter((l) => l.live !== false && matchesTerms(l, matchTerms));
      const ids = new Set(lives.filter((l) => Number(l.views ?? 0) >= minViewers).map(idOf));
      if (known == null) { known = ids; return; }                       // 첫 push 는 기준선만
      for (const l of newStreamers(known, lives, minViewers)) {
        // 검색 결과는 순위·시청자수 경계에서 깜빡인다(방송이 목록에서 빠졌다 돌아옴).
        // 그걸 "껐다 다시 켰다"로 오해해 밤새 다시 울리지 않도록, 한 번 알린 방송은 쿨다운을 준다.
        const key = idOf(l);
        if (t - (alertedAt.get(key) ?? -Infinity) < cooldownMs) continue;
        alertedAt.set(key, t);
        await send(buildAlert(l, categoryName, platform, color));
      }
      for (const [k, at] of alertedAt) if (t - at >= cooldownMs) alertedAt.delete(k);
      known = ids;
    },
  };
}
