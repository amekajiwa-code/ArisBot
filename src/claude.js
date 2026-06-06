// Thin wrapper around the Claude Agent SDK that runs a real local Claude Code
// session per conversation and keeps it going across turns (multi-turn memory).

import { query } from '@anthropic-ai/claude-agent-sdk';

// conversation key (e.g. Discord channel id) -> Claude session id
const sessions = new Map();

/**
 * Send one user turn to the local Claude and return its final answer.
 * The session is resumed automatically on the next call with the same key.
 *
 * @param {string} key   conversation key (channel id)
 * @param {string} prompt user text
 * @param {string} cwd   working directory Claude operates in
 * @param {object} [opts] { model }
 * @returns {Promise<{text: string, sessionId: string|null, error: string|null, usedTools: boolean}>}
 */
export async function askClaude(key, prompt, cwd, opts = {}) {
  const resume = sessions.get(key);

  const options = {
    cwd,
    permissionMode: 'bypassPermissions', // full tool access, no interactive prompts
    ...(opts.model ? { model: opts.model } : {}),
    ...(resume ? { resume } : {}),
  };

  let assistantText = '';
  let result = null;
  let sessionId = resume || null;
  let usedTools = false;

  for await (const message of query({ prompt, options })) {
    if (message.session_id) sessionId = message.session_id;

    if (message.type === 'assistant') {
      for (const block of message.message.content ?? []) {
        if (block.type === 'text') assistantText += block.text;
        else if (block.type === 'tool_use') usedTools = true;
      }
    } else if (message.type === 'result') {
      result = message;
    }
  }

  if (sessionId) sessions.set(key, sessionId);

  // On error subtypes, surface what we have plus the failure reason.
  if (result && result.subtype !== 'success') {
    const text = assistantText.trim() || `⚠️ Claude ended without a final answer (${result.subtype}).`;
    return { text, sessionId, error: result.subtype, usedTools };
  }

  // Prefer the authoritative final result string; fall back to streamed text.
  const finalText =
    (result && typeof result.result === 'string' && result.result.trim()) ||
    assistantText.trim() ||
    '(Claude returned no text.)';

  return { text: finalText, sessionId, error: null, usedTools };
}

/** Forget the session for a conversation so the next message starts fresh. */
export function resetSession(key) {
  return sessions.delete(key);
}

/** Whether a conversation already has a live session. */
export function hasSession(key) {
  return sessions.has(key);
}
