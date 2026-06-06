#!/usr/bin/env node
// Claude Code hook: forwards Notification / Stop events to the bridge's local /notify endpoint.
// ESM (project package.json has "type":"module"). Uses global fetch (Node 18+).
//
// Secret/port are read from the bridge's .env automatically (no extra config needed),
// with CC_NOTIFY_* / NOTIFY_* env vars taking precedence if set.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Sessions the bot itself drives already have their replies relayed — don't double-notify.
if (process.env.CLAUDE_BRIDGE_BOT) process.exit(0);

const BRIDGE_DIR = fileURLToPath(new URL('../../', import.meta.url)); // C:\ClaudeNoritur
const norm = (p) => (p ? path.resolve(p).replace(/[\\/]+$/, '').toLowerCase() : '');

function fromDotenv(key) {
  try {
    const text = readFileSync(new URL('../../.env', import.meta.url), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && m[1] === key) return m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* no .env — fall through */ }
  return undefined;
}

const SECRET = process.env.CC_NOTIFY_SECRET || process.env.NOTIFY_SECRET || fromDotenv('NOTIFY_SECRET') || '';
const PORT = process.env.NOTIFY_PORT || fromDotenv('NOTIFY_PORT') || '8787';
const ENDPOINT = process.env.CC_NOTIFY_URL || `http://127.0.0.1:${PORT}/notify`;

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
    if (process.stdin.isTTY) resolve('');
  });
}

(async () => {
  try {
    let raw = await readStdin();
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1); // strip optional BOM
    const evt = raw ? JSON.parse(raw) : {};

    // The bridge's own dev session shouldn't spam Discord with its notifications.
    if (evt.cwd && norm(evt.cwd) === norm(BRIDGE_DIR)) process.exit(0);

    const event = evt.hook_event_name || 'Unknown';
    const detail = evt.message || (event === 'Stop' ? 'Claude finished responding (turn complete)' : '');
    const summary = detail ? `${event}: ${detail}` : event;

    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 5000); // never block Claude Code

    await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Notify-Secret': SECRET },
      body: JSON.stringify({
        summary,
        event,
        message: evt.message ?? null,
        session_id: evt.session_id ?? null,
        cwd: evt.cwd ?? null,
        transcript_path: evt.transcript_path ?? null,
        stop_hook_active: evt.stop_hook_active ?? null,
      }),
      signal: ac.signal,
    }).catch(() => {});

    clearTimeout(t);
  } catch (err) {
    process.stderr.write(`[notify.js] ${err && err.message}\n`);
  }
  process.exit(0); // always succeed; hook is non-blocking
})();
