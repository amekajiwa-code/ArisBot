// Polls a CHZZK category's live channels and alerts a Discord channel when a
// channel appears that wasn't live in the previous tick. The first tick only
// seeds the baseline (so restarts don't re-announce everyone already live); a
// channel that goes offline and returns later is announced again. Pure
// decision/format logic is split out for testing.

const ALERT_COLOR = 0x00ffa3; // CHZZK green

/**
 * Lives that deserve a fresh announcement: live now and at/above `minViewers`,
 * but not in the `known` set. Returns [] until a baseline exists.
 * @param {Set<string>|null} known           channel ids live as of the last successful tick
 * @param {Array<{channelId,concurrentUserCount}>} lives
 * @param {number} minViewers
 */
export function newStreamers(known, lives, minViewers = 0) {
  if (known == null) return [];
  return lives.filter((l) => l.concurrentUserCount >= minViewers && !known.has(l.channelId));
}

/**
 * Build the Discord alert payload — a "봇 메시지"(embed):
 *   title: "{platform}에서 {channelName}님이 {categoryName} 방송중!"
 *   body : (방송 제목) + 마지막 줄에 방송 링크
 */
export function buildAlert(live, categoryName, platform) {
  const url = `https://chzzk.naver.com/live/${live.channelId}`;
  const lines = [];
  if (live.liveTitle) lines.push(live.liveTitle);
  lines.push(url);
  return {
    embeds: [{
      title: `${platform}에서 ${live.channelName}님이 ${categoryName} 방송중!`,
      url,
      description: lines.join('\n'),
      color: ALERT_COLOR,
    }],
  };
}

/**
 * Stateful watcher. Each tick() fetches the category's live list and announces any
 * channel not seen in the previous (successful) tick; the first tick only seeds the
 * baseline. A failed fetch (null) is skipped without disturbing the baseline.
 *
 * @param {() => Promise<Array|null>} opts.fetchLives
 * @param {(payload: object) => Promise<void>} opts.send
 */
export function createChzzkWatcher({ fetchLives, send, categoryName, minViewers = 0, platform = '치지직' }) {
  let known = null; // Set<channelId> eligible & live as of the last successful tick (null = unseeded)
  return {
    get known() { return known; },
    async tick() {
      const lives = await fetchLives();
      if (lives == null) return;                                            // fetch failed → skip
      const ids = new Set(lives.filter((l) => l.concurrentUserCount >= minViewers).map((l) => l.channelId));
      if (known == null) { known = ids; return; }                           // seed baseline, no announce
      for (const l of newStreamers(known, lives, minViewers)) {
        await send(buildAlert(l, categoryName, platform));
      }
      known = ids;
    },
  };
}

/** Run a watcher immediately and then on an interval. Returns { stop() }. */
export function startChzzkWatch({ fetchLives, send, categoryName, minViewers, platform, intervalMs }) {
  const watcher = createChzzkWatcher({ fetchLives, send, categoryName, minViewers, platform });
  const run = () =>
    watcher.tick().catch((e) => console.error('[chzzk] tick error:', e?.message ?? e));
  run();
  const handle = setInterval(run, intervalMs);
  return { stop() { clearInterval(handle); } };
}
