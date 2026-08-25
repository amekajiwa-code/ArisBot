// Twitch Helix API client using an app access token (client-credentials flow).
// No user OAuth / redirect is involved. `fetch` and `now` are injectable for testing.

const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const HELIX = 'https://api.twitch.tv/helix';

/**
 * @param {object} opts
 * @param {string} opts.clientId      Twitch app Client ID
 * @param {string} opts.clientSecret  Twitch app Client Secret
 */
export function createTwitchClient({ clientId, clientSecret, fetch = globalThis.fetch, now = () => Date.now() }) {
  let token = null;
  let expiresAt = 0;

  async function getToken() {
    if (token && now() < expiresAt) return token;
    const url =
      `${TOKEN_URL}?client_id=${encodeURIComponent(clientId)}` +
      `&client_secret=${encodeURIComponent(clientSecret)}&grant_type=client_credentials`;
    const res = await fetch(url, { method: 'POST' });
    if (!res.ok) throw new Error(`twitch token HTTP ${res.status}`);
    const data = await res.json();
    token = data.access_token;
    expiresAt = now() + Math.max(0, (data.expires_in ?? 3600) - 60) * 1000; // refresh a minute early
    return token;
  }

  const authHeaders = (t) => ({ 'Client-Id': clientId, Authorization: `Bearer ${t}` });

  async function helix(path) {
    let res = await fetch(`${HELIX}${path}`, { headers: authHeaders(await getToken()) });
    if (res.status === 401) {                       // token rejected → force one refresh + retry
      token = null;
      res = await fetch(`${HELIX}${path}`, { headers: authHeaders(await getToken()) });
    }
    if (!res.ok) throw new Error(`twitch ${path} HTTP ${res.status}`);
    return res.json();
  }

  return {
    /** Resolve a category/game name to its Twitch game_id, or null if not found. */
    async resolveGameId(name) {
      const data = await helix(`/games?name=${encodeURIComponent(name)}`);
      return data?.data?.[0]?.id ?? null;
    },

    /**
     * Live streams in a category (100 per page), mapped to compact objects.
     * Pages only when `maxPages` > 1 — the alert path stays a single call.
     * @returns {Promise<Array<{userId,userName,login,viewerCount,title,startedAt}>>}
     */
    async fetchStreams(gameId, { maxPages = 1 } = {}) {
      const out = [];
      let after;
      for (let page = 0; page < maxPages; page++) {
        const qs = new URLSearchParams({ game_id: gameId, first: '100' });
        if (after) qs.set('after', after);
        const data = await helix(`/streams?${qs}`);
        for (const s of data?.data ?? []) {
          out.push({
            userId: s.user_id,
            userName: s.user_name,
            login: s.user_login,
            viewerCount: s.viewer_count,
            title: s.title,
            startedAt: s.started_at ?? null,
          });
        }
        after = data?.pagination?.cursor;
        if (!after || !(data?.data ?? []).length) break;
      }
      return out;
    },

    /**
     * Past broadcasts (VODs) in a category, newest first — this is how a finished
     * stream is found after the fact. `period` is Helix's own bucket
     * ("day" | "week" | "month" | "all"); callers still filter by exact timestamp.
     * Only channels that keep VODs show up here (Twitch's only public backlog).
     * @returns {Promise<Array<{id,userId,userName,login,title,url,publishedAt,viewCount,duration}>>}
     */
    async fetchVideos(gameId, { period = 'week', maxPages = 3, type = 'archive' } = {}) {
      const out = [];
      let after;
      for (let page = 0; page < maxPages; page++) {
        const qs = new URLSearchParams({ game_id: gameId, period, sort: 'time', type, first: '100' });
        if (after) qs.set('after', after);
        const data = await helix(`/videos?${qs}`);
        for (const v of data?.data ?? []) {
          out.push({
            id: v.id,
            userId: v.user_id,
            userName: v.user_name,
            login: v.user_login,
            title: v.title,
            url: v.url,
            publishedAt: v.published_at ?? v.created_at ?? null,
            viewCount: Number(v.view_count ?? 0),
            duration: v.duration ?? null,
          });
        }
        after = data?.pagination?.cursor;
        if (!after || !(data?.data ?? []).length) break;
      }
      return out;
    },
  };
}
