// 방송 기록기 — 짧은 주기로 플랫폼을 훑어 "그때 켜져 있던 사람"을 stream-log 에 적는다.
//
// 알림 워처와 목적이 다르다. 워처는 "새로 켜진 방송 하나를 알린다"(상태는 메모리, 재시작하면
// 날아감). 기록기는 "누가 언제 방송했나"를 디스크에 남겨서 나중에 되짚을 수 있게 한다.
// 그래서 폴링 주기도 따로 둔다(기본 60초).
//
// 플랫폼 하나가 실패해도 나머지 기록은 계속되고, 실패는 로그로만 남긴다.

/**
 * @param {object} opts
 * @param {{record: (platform: string, entries: Array) => Promise<number>}} opts.log
 */
/**
 * @param {object} opts
 * @param {Record<string, (found: Array) => Promise<void>>} [opts.onSightings]
 *        플랫폼별 후처리 훅. 비리비리·니코니코 알림 워처가 여기 붙어, 기록기가 훑은
 *        결과를 그대로 받아쓴다(알림을 켜도 요청이 안 늘어나는 이유).
 */
export function createRecorder({ log, onError = (m) => console.error(m), onSightings = {} }) {
  /** 소스 한 번 훑어 기록 + 알림. 실패는 삼키고 false 를 준다(다음 주기에 다시 시도). */
  async function tick(source) {
    if (!source?.run) return false;
    let found;
    try {
      found = (await source.run()) ?? [];
    } catch (e) {
      onError(`[record:${source.platform}] ${e?.message ?? e}`);
      return false;
    }
    let ok = true;
    try {
      await log.record(source.platform, found);
    } catch (e) {
      onError(`[record:${source.platform}] ${e?.message ?? e}`);
      ok = false;                                   // 기록 실패가 알림까지 막지는 않는다
    }
    try {
      await onSightings[source.platform]?.(found);
    } catch (e) {
      onError(`[alert:${source.platform}] ${e?.message ?? e}`);
      ok = false;
    }
    return ok;
  }

  return {
    tick,
    /**
     * 워처가 이미 받아온 목록을 그대로 기록에 얹는 훅.
     * YouTube 처럼 쿼터가 빠듯해 따로 폴링할 수 없는 플랫폼에 쓴다(추가 요청 0회).
     */
    hook(platform, map = (x) => x) {
      return async (found) => {
        if (!found) return;
        try {
          await log.record(platform, found.map(map));
        } catch (e) {
          onError(`[record:${platform}] ${e?.message ?? e}`);
        }
      };
    },
  };
}

/**
 * 소스들을 즉시 한 번, 이후 intervalMs 마다 훑어 기록한다.
 * @returns {{stop: () => void, recorder: object}}
 */
export function startRecorder({ sources, log, intervalMs, onError, recorder = createRecorder({ log, onError }) }) {
  const live = (sources ?? []).filter((s) => s?.run);
  const busy = new Set();                       // 한 주기가 밀려도 같은 소스를 겹쳐 돌리지 않는다
  const run = () => {
    for (const s of live) {
      if (busy.has(s.platform)) continue;
      busy.add(s.platform);
      recorder.tick(s).finally(() => busy.delete(s.platform));
    }
  };
  run();
  const handle = setInterval(run, intervalMs);
  return { recorder, stop() { clearInterval(handle); } };
}
