// Installs the Discord-notify hook into a project's own .claude/settings.json,
// so that project's Claude Code sessions report Notification/Stop events to the
// bridge. Called from bin/link.js when you authorize a project from its terminal,
// so notifications are only ever wired into folders you approved at the terminal.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const NODE = process.execPath; // absolute path to the node running this
const HOOK_PATH = fileURLToPath(new URL('../.claude/hooks/notify.js', import.meta.url));
const COMMAND = `"${NODE}" "${HOOK_PATH}"`;

function hasOurHook(arr) {
  return Array.isArray(arr)
    && arr.some((e) => (e?.hooks || []).some((h) => typeof h?.command === 'string' && h.command.includes('notify.js')));
}
const newEntry = () => ({ hooks: [{ type: 'command', command: COMMAND, async: true }] });

/**
 * Ensure projectDir/.claude/settings.json notifies Discord on Notification + Stop.
 * Merges into any existing settings (never clobbers other hooks/keys).
 * @returns {'installed'|'already'}
 */
export function installNotifyHook(projectDir) {
  const claudeDir = path.join(projectDir, '.claude');
  const file = path.join(claudeDir, 'settings.json');

  let obj = {};
  try { obj = JSON.parse(readFileSync(file, 'utf8')); } catch { obj = {}; }
  obj.hooks ??= {};
  obj.hooks.Notification ??= [];
  obj.hooks.Stop ??= [];

  if (hasOurHook(obj.hooks.Notification) && hasOurHook(obj.hooks.Stop)) return 'already';

  if (!hasOurHook(obj.hooks.Notification)) obj.hooks.Notification.push(newEntry());
  if (!hasOurHook(obj.hooks.Stop)) obj.hooks.Stop.push(newEntry());

  mkdirSync(claudeDir, { recursive: true });
  writeFileSync(file, JSON.stringify(obj, null, 2));
  return 'installed';
}
