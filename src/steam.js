// Reads the current concurrent player count from Steam's public Web API.
// No API key required. `fetch` is injectable for testing.

const ENDPOINT = 'https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/';

/**
 * @param {number|string} appId
 * @returns {Promise<number|null>} player count, or null on any failure / no data.
 */
export async function fetchPlayerCount(appId, { fetch = globalThis.fetch } = {}) {
  try {
    const res = await fetch(`${ENDPOINT}?appid=${appId}`);
    if (!res.ok) return null;
    const data = await res.json();
    const r = data?.response;
    if (!r || r.result !== 1 || typeof r.player_count !== 'number') return null;
    return r.player_count;
  } catch {
    return null;
  }
}
