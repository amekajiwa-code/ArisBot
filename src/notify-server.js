// Localhost-only HTTP endpoint that Claude Code hooks POST to.
// It validates a shared secret, then forwards the text to the right Discord channel
// (routed by the originating cwd when possible).
// SECURITY: binds to 127.0.0.1 ONLY — never expose this to the network.

import http from 'node:http';
import crypto from 'node:crypto';

const HOST = '127.0.0.1';
const MAX_BODY = 8 * 1024;   // 8 KB request cap
const MAX_CONTENT = 1900;    // Discord-safe
const WINDOW_MS = 10_000;
const MAX_PER_WINDOW = 20;

export function startNotifyServer({ port, secret, resolveChannel }) {
  let windowStart = Date.now();
  let count = 0;

  const validSecret = (header) => {
    if (!header || !secret) return false;
    const a = Buffer.from(String(header));
    const b = Buffer.from(secret);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  };

  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/notify') { res.writeHead(404); return res.end(); }
    if (!validSecret(req.headers['x-notify-secret'])) { res.writeHead(401); return res.end('unauthorized'); }

    const now = Date.now();
    if (now - windowStart > WINDOW_MS) { windowStart = now; count = 0; }
    if (++count > MAX_PER_WINDOW) { res.writeHead(429); return res.end('rate limited'); }

    let body = '';
    let aborted = false;
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY) { aborted = true; res.writeHead(413); res.end('too large'); req.destroy(); }
    });
    req.on('end', async () => {
      if (aborted) return;
      let payload;
      try { payload = JSON.parse(body); } catch { res.writeHead(400); return res.end('bad json'); }

      const text = String(payload.summary || payload.content || payload.message || '').slice(0, MAX_CONTENT);
      if (!text) { res.writeHead(400); return res.end('empty content'); }

      try {
        const channel = await resolveChannel(payload);
        if (!channel) { res.writeHead(204); res.end(); return; } // nowhere to route → drop
        await channel.send(`🔔 ${text}`);
        res.writeHead(204); res.end();
      } catch (err) {
        console.error('[notify] failed to send to Discord:', err?.message ?? err);
        res.writeHead(502); res.end('discord send failed');
      }
    });
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[notify] port ${port} is already in use — is another bridge running?`);
    } else {
      console.error('[notify] server error:', err.message);
    }
  });

  server.listen(port, HOST, () => {
    console.log(`[notify] listening on http://${HOST}:${port}/notify`);
  });

  return server;
}
