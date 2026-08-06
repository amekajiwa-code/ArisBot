// Polls a YouTube live search and alerts a Discord channel when a stream appears
// that wasn't live in the previous tick. The first tick only seeds the baseline
// (so restarts don't re-announce everyone already live); a stream that ends and
// returns gets a new video id, so it's announced again. Pure decision/format
// logic is split out for testing.

const ALERT_COLOR = 0xff0000; // YouTube red

/**
 * Does this live actually mention the game? YouTube's `q` search is relevance-based,
 * so it returns videos that carry none of the words — this is the second pass.
 * An empty `terms` list disables the filter.
 * @param {{title?: string, description?: string}} live
 * @param {string[]} terms
 */
export function matchesTerms(live, terms) {
  if (!terms?.length) return true;
  const haystack = `${live.title ?? ''}\n${live.description ?? ''}`.toLowerCase();
  return terms.some((t) => haystack.includes(t.toLowerCase()));
}

/**
 * Lives that deserve a fresh announcement: live now and at/above `minViewers`,
 * but not in the `known` set. Returns [] until a baseline exists.
 * @param {Set<string>|null} known           video ids live as of the last successful tick
 * @param {Array<{videoId,liveViewers}>} lives
 * @param {number} minViewers
 */
export function newStreamers(known, lives, minViewers = 0) {
  if (known == null) return [];
  return lives.filter((l) => l.liveViewers >= minViewers && !known.has(l.videoId));
}

/**
 * Build the Discord alert payload — a "봇 메시지"(embed):
 *   title: "{platform}에서 {channelName}님이 {categoryName} 방송중!"
 *   body : (방송 제목) + 마지막 줄에 방송 링크
 */
export function buildAlert(live, categoryName, platform) {
  const url = `https://youtu.be/${live.videoId}`;
  const lines = [];
  if (live.title) lines.push(live.title);
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
 * Stateful watcher. Each tick() fetches the topic's live list and announces any
 * video not seen in the previous (successful) tick; the first tick only seeds the
 * baseline. A failed fetch (null) is skipped without disturbing the baseline.
 *
 * @param {() => Promise<Array|null>} opts.fetchLives
 * @param {(payload: object) => Promise<void>} opts.send
 */
export function createYouTubeWatcher({ fetchLives, send, categoryName, minViewers = 0, matchTerms = [], platform = 'YouTube' }) {
  let known = null; // Set<videoId> eligible & live as of the last successful tick (null = unseeded)
  return {
    get known() { return known; },
    async tick() {
      const found = await fetchLives();
      if (found == null) return;                                       // fetch failed → skip
      const lives = found.filter((l) => matchesTerms(l, matchTerms));  // drop search noise
      const ids = new Set(lives.filter((l) => l.liveViewers >= minViewers).map((l) => l.videoId));
      if (known == null) { known = ids; return; }                      // seed baseline, no announce
      for (const l of newStreamers(known, lives, minViewers)) {
        await send(buildAlert(l, categoryName, platform));
      }
      known = ids;
    },
  };
}

/** Run a watcher immediately and then on an interval. Returns { stop() }. */
export function startYouTubeWatch({ fetchLives, send, categoryName, minViewers, matchTerms, platform, intervalMs }) {
  const watcher = createYouTubeWatcher({ fetchLives, send, categoryName, minViewers, matchTerms, platform });
  const run = () =>
    watcher.tick().catch((e) => console.error('[youtube] tick error:', e?.message ?? e));
  run();
  const handle = setInterval(run, intervalMs);
  return { stop() { clearInterval(handle); } };
}
