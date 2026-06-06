// One-time pairing codes that authorize connecting a project FOLDER to a Discord
// channel. A code can only be created from that folder's own terminal (bin/link.js),
// so binding a project always requires physical/terminal access to it — not just
// control of the Discord account.

import { readFileSync, writeFileSync } from 'node:fs';
import crypto from 'node:crypto';

const FILE = new URL('../pending-links.json', import.meta.url);
const TTL_MS = 10 * 60 * 1000; // codes expire after 10 minutes

function load() {
  try { return JSON.parse(readFileSync(FILE, 'utf8')); } catch { return {}; }
}
function persist(obj) {
  try { writeFileSync(FILE, JSON.stringify(obj, null, 2)); }
  catch (e) { console.error('[pairing] save failed:', e.message); }
}
function prune(obj) {
  const now = Date.now();
  let changed = false;
  for (const [code, e] of Object.entries(obj)) {
    if (!e || now - e.createdAt > TTL_MS) { delete obj[code]; changed = true; }
  }
  return changed;
}

/** Called from a project's terminal. Records a one-time code for cwd. */
export function createPendingLink(cwd) {
  const obj = load();
  prune(obj);
  const code = crypto.randomBytes(4).toString('hex').toUpperCase(); // 8 hex chars
  obj[code] = { cwd, createdAt: Date.now() };
  persist(obj);
  return { code, ttlMin: TTL_MS / 60000 };
}

/** Called by the bot on `!link <code>`. Returns the cwd and consumes the code. */
export function redeemLink(code) {
  const obj = load();
  const pruned = prune(obj);
  const key = String(code).trim().toUpperCase();
  const entry = obj[key];
  if (!entry) { if (pruned) persist(obj); return null; }
  delete obj[key];
  persist(obj);
  return entry.cwd;
}
