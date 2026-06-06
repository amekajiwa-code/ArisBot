// Per-channel project mapping: each Discord channel can point at a different
// working directory. Persisted to projects.json (gitignored).

import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';

const FILE = new URL('../projects.json', import.meta.url);
const isWin = process.platform === 'win32';

const norm = (p) => {
  const r = path.resolve(p).replace(/[\\/]+$/, '');
  return isWin ? r.toLowerCase() : r;
};

function load() {
  try { return JSON.parse(readFileSync(FILE, 'utf8')); } catch { return {}; }
}
function persist(map) {
  try { writeFileSync(FILE, JSON.stringify(map, null, 2)); }
  catch (e) { console.error('[projects] save failed:', e.message); }
}

let map = load(); // channelId -> absolute working directory

/** Working directory for a channel, or the given fallback if unmapped. */
export function getProjectCwd(channelId, fallback) {
  return map[channelId] || fallback;
}

/** Whether a channel has an explicit project mapping. */
export function isMapped(channelId) {
  return Object.prototype.hasOwnProperty.call(map, channelId);
}

/** Map a channel to a directory (must exist). Returns the absolute path. */
export function setProjectCwd(channelId, dir) {
  const abs = path.resolve(dir);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) {
    throw new Error(`폴더가 존재하지 않아요: ${abs}`);
  }
  map[channelId] = abs;
  persist(map);
  return abs;
}

/** Reverse lookup: which channel is mapped to this cwd (for routing notifications). */
export function channelForCwd(cwd) {
  if (!cwd) return null;
  const target = norm(cwd);
  for (const [chan, dir] of Object.entries(map)) {
    if (norm(dir) === target) return chan;
  }
  return null;
}

/** Remove a channel's project mapping. Returns true if one existed. */
export function removeMapping(channelId) {
  if (!isMapped(channelId)) return false;
  delete map[channelId];
  persist(map);
  return true;
}
