// Centralized, validated configuration loaded from environment variables.
// (npm scripts pass `--env-file=.env`, so process.env is already populated.)
//
// No user ids are configured anywhere: channel ownership is captured automatically
// at runtime when a user types `!login` (see src/access.js).

function required(name, hint) {
  const v = process.env[name]?.trim();
  if (!v) {
    console.error(`\n[config] Missing required env var: ${name}`);
    if (hint) console.error(`         ${hint}`);
    console.error(`         Copy .env.example to .env and fill it in (see README.md).\n`);
    process.exit(1);
  }
  return v;
}

export const config = {
  discordToken: required('DISCORD_BOT_TOKEN', 'Bot token from the Discord Developer Portal → Bot tab.'),

  // Optional fallback channel for notifications whose originating folder isn't
  // mapped to a channel. If unset, such notifications are simply dropped.
  homeChannelId: process.env.DISCORD_CHANNEL_ID?.trim() || null,

  notifySecret: required('NOTIFY_SECRET', 'Any long random string; must match the hook.'),
  notifyPort: Number(process.env.NOTIFY_PORT?.trim() || 8787),

  model: process.env.CLAUDE_MODEL?.trim() || undefined, // undefined → Claude Code default
  maxPrompt: 4000,
};
