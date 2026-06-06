// Per-channel ownership via self-service login. A user "logs in" to claim a channel
// (their Discord id is captured automatically — no manual config). Once claimed, only
// that user may use the channel; it stays claimed across restarts until they log out.
// Persisted to channel-owners.json (gitignored).

import { readFileSync, writeFileSync } from 'node:fs';

const FILE = new URL('../channel-owners.json', import.meta.url);

function load() { try { return JSON.parse(readFileSync(FILE, 'utf8')); } catch { return {}; } }
function persist(m) {
  try { writeFileSync(FILE, JSON.stringify(m, null, 2)); }
  catch (e) { console.error('[access] save failed:', e.message); }
}

let owners = load(); // channelId -> userId

export function ownerOf(channelId) { return owners[channelId] || null; }
export function isOwned(channelId) { return Boolean(owners[channelId]); }
export function isOwner(channelId, userId) { return owners[channelId] === userId; }

/** Claim a channel for a user (login). */
export function setOwner(channelId, userId) {
  owners[channelId] = userId;
  persist(owners);
}

/** Release a channel (logout). Returns true if it was owned. */
export function releaseOwner(channelId) {
  if (!(channelId in owners)) return false;
  delete owners[channelId];
  persist(owners);
  return true;
}
