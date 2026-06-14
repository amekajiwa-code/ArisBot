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
     * Live streams in a category (up to 100), mapped to compact objects.
     * @returns {Promise<Array<{userId,userName,login,viewerCount,title}>>}
     */
    async fetchStreams(gameId) {
      const data = await helix(`/streams?game_id=${encodeURIComponent(gameId)}&first=100`);
      return (data?.data ?? []).map((s) => ({
        userId: s.user_id,
        userName: s.user_name,
        login: s.user_login,
        viewerCount: s.viewer_count,
        title: s.title,
      }));
    },
  };
}
