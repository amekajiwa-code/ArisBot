// Polls Steam's current player count and alerts a Discord channel when the count
// rises by at least `threshold` above the last-notified value, while at or above
// `minCount`. Decreases never alert; they silently lower the baseline so a later
// rise can "돌파" again. Pure decision/format logic is split out for testing.

const ALERT_COLOR = 0x57f287; // green — "돌파"

/**
 * Decide whether to send an alert. Upward movement only.
 * @param {number|null} lastNotified  last value we alerted on (null = no baseline yet)
 * @param {number} current            current player count
 * @param {number} threshold          minimum increase to alert on
 * @param {number} minCount           only alert when current >= this
 */
export function shouldNotify(lastNotified, current, threshold, minCount) {
  if (lastNotified == null) return false;
  if (current < minCount) return false;
  return current - lastNotified >= threshold;
}

/**
 * Build the Discord message payload — an embed ("봇 메시지") including the SteamDB link.
 * Only called for increases, so delta is positive.
 */
export function buildAlert({ current, last, gameName, appId }) {
  const delta = current - last;
  const sign = delta >= 0 ? '+' : '';
  return {
    embeds: [{
      title: `🎮 ${gameName}`,
      url: `https://steamdb.info/app/${appId}/`,
      description: `동접자 ${current}명 돌파(${sign}${delta})`,
      color: ALERT_COLOR,
    }],
  };
}

/**
 * Stateful watcher. Each tick() fetches the current count and compares it to the
 * baseline (last-notified value): a qualifying rise sends an alert and rebaselines
 * up; any drop silently rebaselines down; the first fetch only seeds the baseline.
 *
 * @param {() => Promise<number|null>} opts.fetchCount
 * @param {(payload: object) => Promise<void>} opts.send
 */
export function createSteamWatcher({ fetchCount, send, threshold, minCount, gameName, appId }) {
  let lastNotified = null;
  return {
    get lastNotified() { return lastNotified; },
    async tick() {
      const current = await fetchCount();
      if (current == null) return;                                  // fetch failed → skip
      if (lastNotified == null) { lastNotified = current; return; } // seed baseline
      if (shouldNotify(lastNotified, current, threshold, minCount)) {
        await send(buildAlert({ current, last: lastNotified, gameName, appId }));
        lastNotified = current;
      } else if (current < lastNotified) {
        lastNotified = current;                                     // silent rebaseline on drop
      }
    },
  };
}

/** Run a watcher immediately and then on an interval. Returns { stop() }. */
export function startSteamWatch({ fetchCount, send, threshold, minCount, gameName, appId, intervalMs }) {
  const watcher = createSteamWatcher({ fetchCount, send, threshold, minCount, gameName, appId });
  const run = () =>
    watcher.tick().catch((e) => console.error('[steam] tick error:', e?.message ?? e));
  run();
  const handle = setInterval(run, intervalMs);
  return { stop() { clearInterval(handle); } };
}
