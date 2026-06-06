// Centralized, validated configuration.
// loadConfig(env) is pure: returns a config object or throws ConfigError.
// getConfig() wraps it for the app entrypoint (prints help + exits on error).

import { existsSync, statSync } from 'node:fs';

export class ConfigError extends Error {}

export function loadConfig(env = process.env) {
  const required = (name, hint) => {
    const v = env[name]?.trim();
    if (!v) throw new ConfigError(`Missing required env var: ${name}${hint ? ` — ${hint}` : ''}`);
    return v;
  };

  const discordToken = required('DISCORD_BOT_TOKEN', 'Bot token from the Discord Developer Portal');
  const allowedUserId = required('ALLOWED_USER_ID', 'your Discord user id — the only user this bot obeys');
  const projectDir = required('PROJECT_DIR', 'absolute path to the project folder Claude operates in');

  if (!existsSync(projectDir) || !statSync(projectDir).isDirectory()) {
    throw new ConfigError(`PROJECT_DIR is not an existing directory: ${projectDir}`);
  }

  return {
    discordToken,
    allowedUserId,
    projectDir,
    model: env.CLAUDE_MODEL?.trim() || undefined,
    notifySecret: env.NOTIFY_SECRET?.trim() || null,
    notifyPort: Number.isFinite(Number(env.NOTIFY_PORT?.trim())) ? Number(env.NOTIFY_PORT.trim()) : 8787,
    maxPrompt: 4000,
  };
}

export function getConfig() {
  try {
    return loadConfig();
  } catch (e) {
    if (!(e instanceof ConfigError)) throw e;
    console.error(`\n[config] ${e.message}`);
    console.error('         Copy .env.example to .env and fill it in (see README.md).\n');
    process.exit(1);
  }
}
