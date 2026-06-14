// Polls Steam's current player count and alerts a Discord channel when it moves
// by at least `threshold` from the last-notified value, but only while the count
// is at or above `minCount`. Pure decision logic is split out for testing.

/**
 * Decide whether to send an alert.
 * @param {number|null} lastNotified  last value we alerted on (null = no baseline yet)
 * @param {number} current            current player count
 * @param {number} threshold          minimum absolute change to alert on
 * @param {number} minCount           only alert when current >= this
 */
export function shouldNotify(lastNotified, current, threshold, minCount) {
  if (lastNotified == null) return false;
  if (current < minCount) return false;
  return Math.abs(current - lastNotified) >= threshold;
}

/** Build the Discord alert text. */
export function formatMessage({ current, last, appId }) {
  const delta = current - last;
  const sign = delta >= 0 ? '+' : '';
  return (
    `🎮 동접자 ${current}명 (직전 알림 ${last}명, ${sign}${delta})\n` +
    `https://steamdb.info/app/${appId}/`
  );
}

/**
 * Stateful watcher. Each tick() fetches the current count and, comparing against
 * the last-notified baseline, sends an alert when shouldNotify() says so.
 * The first successful fetch only seeds the baseline (no alert).
 *
 * @param {() => Promise<number|null>} opts.fetchCount
 * @param {(text: string) => Promise<void>} opts.send
 */
export function createSteamWatcher({ fetchCount, send, threshold, minCount, appId }) {
  let lastNotified = null;
  return {
    get lastNotified() { return lastNotified; },
    async tick() {
      const current = await fetchCount();
      if (current == null) return;            // fetch failed → skip cycle
      if (lastNotified == null) { lastNotified = current; return; } // seed baseline
      if (shouldNotify(lastNotified, current, threshold, minCount)) {
        await send(formatMessage({ current, last: lastNotified, appId }));
        lastNotified = current;
      }
    },
  };
}

/** Run a watcher immediately and then on an interval. Returns { stop() }. */
export function startSteamWatch({ fetchCount, send, threshold, minCount, appId, intervalMs }) {
  const watcher = createSteamWatcher({ fetchCount, send, threshold, minCount, appId });
  const run = () =>
    watcher.tick().catch((e) => console.error('[steam] tick error:', e?.message ?? e));
  run();
  const handle = setInterval(run, intervalMs);
  return { stop() { clearInterval(handle); } };
}
