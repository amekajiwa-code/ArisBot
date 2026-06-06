// Small Discord helpers: safe message splitting and a self-renewing typing indicator.

const LIMIT = 1900; // stay comfortably under Discord's hard 2000-char cap

/**
 * Split text into <=LIMIT chunks, preferring newline boundaries and
 * hard-splitting any single oversized line.
 */
export function splitMessage(text, limit = LIMIT) {
  const chunks = [];
  let current = '';

  for (const line of String(text).split('\n')) {
    if (line.length > limit) {
      if (current) { chunks.push(current); current = ''; }
      for (let i = 0; i < line.length; i += limit) chunks.push(line.slice(i, i + limit));
      continue;
    }
    if (current.length + line.length + 1 > limit) {
      chunks.push(current);
      current = line;
    } else {
      current = current ? `${current}\n${line}` : line;
    }
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : [''];
}

/** Send a (possibly long) message to a channel as ordered chunks. */
export async function sendLong(channel, text) {
  for (const chunk of splitMessage(text)) {
    if (chunk.trim() === '') continue;
    await channel.send(chunk);
  }
}

/**
 * Show a typing indicator and keep it alive (Discord's lasts ~10s).
 * Returns a stop() function — call it in a finally block.
 */
export function withTyping(channel) {
  const ping = () => channel.sendTyping().catch(() => {});
  ping();
  const interval = setInterval(ping, 8000);
  return () => clearInterval(interval);
}
