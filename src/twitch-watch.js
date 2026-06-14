// Polls a Twitch category's live streams and alerts a Discord channel when a
// streamer appears who wasn't live in the previous tick. The first tick only
// seeds the baseline (so restarts don't re-announce everyone already live); a
// streamer who goes offline and returns later is announced again. Pure
// decision/format logic is split out for testing.

const ALERT_COLOR = 0x9146ff; // Twitch purple

/**
 * Streams that deserve a fresh announcement: live now and at/above `minViewers`,
 * but not in the `known` set. Returns [] until a baseline exists.
 * @param {Set<string>|null} known           user ids live as of the last successful tick
 * @param {Array<{userId,viewerCount}>} streams
 * @param {number} minViewers
 */
export function newStreamers(known, streams, minViewers = 0) {
  if (known == null) return [];
  return streams.filter((s) => s.viewerCount >= minViewers && !known.has(s.userId));
}

/**
 * Build the Discord alert payload — a "봇 메시지"(embed):
 *   title: "{platform}에서 {userName}님이 {categoryName} 방송중!"
 *   body : (방송 제목) + 마지막 줄에 방송 링크
 */
export function buildAlert(stream, categoryName, platform) {
  const url = `https://www.twitch.tv/${stream.login}`;
  const lines = [];
  if (stream.title) lines.push(stream.title);
  lines.push(url);
  return {
    embeds: [{
      title: `${platform}에서 ${stream.userName}님이 ${categoryName} 방송중!`,
      url,
      description: lines.join('\n'),
      color: ALERT_COLOR,
    }],
  };
}

/**
 * Stateful watcher. Each tick() fetches the current live list and announces any
 * streamer not seen in the previous (successful) tick; the first tick only seeds
 * the baseline. A failed fetch (null) is skipped without disturbing the baseline.
 *
 * @param {() => Promise<Array|null>} opts.fetchStreams
 * @param {(payload: object) => Promise<void>} opts.send
 */
export function createTwitchWatcher({ fetchStreams, send, categoryName, minViewers = 0, platform = 'Twitch' }) {
  let known = null; // Set<userId> eligible & live as of the last successful tick (null = unseeded)
  return {
    get known() { return known; },
    async tick() {
      const streams = await fetchStreams();
      if (streams == null) return;                                          // fetch failed → skip
      const ids = new Set(streams.filter((s) => s.viewerCount >= minViewers).map((s) => s.userId));
      if (known == null) { known = ids; return; }                           // seed baseline, no announce
      for (const s of newStreamers(known, streams, minViewers)) {
        await send(buildAlert(s, categoryName, platform));
      }
      known = ids;
    },
  };
}

/** Run a watcher immediately and then on an interval. Returns { stop() }. */
export function startTwitchWatch({ fetchStreams, send, categoryName, minViewers, platform, intervalMs }) {
  const watcher = createTwitchWatcher({ fetchStreams, send, categoryName, minViewers, platform });
  const run = () =>
    watcher.tick().catch((e) => console.error('[twitch] tick error:', e?.message ?? e));
  run();
  const handle = setInterval(run, intervalMs);
  return { stop() { clearInterval(handle); } };
}
