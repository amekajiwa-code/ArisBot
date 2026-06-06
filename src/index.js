// Discord <-> local Claude bridge.
//
// Two ways to drive it, sharing all logic in src/actions.js:
//   • Slash commands "/" — registered per-guild so they show in the bot profile and
//     the "/" autocomplete picker; access errors are true-ephemeral (only the user).
//   • "!" prefix + @mention — fallback. (Discord has NO native picker for "!".)
//
// The bot stays SILENT in normal conversation: it only acts on known commands,
// /talk or !talk, or an @mention (and the owner's plain text in an `auto on` channel).
//
// Access: a user claims a channel with /login (id captured automatically); only that
// user may use it until /logout. Folder binding (/link) needs a one-time code made
// from that folder's own terminal (bin/link.js).

import { Client, GatewayIntentBits, Events, Partials, REST, Routes, MessageFlags } from 'discord.js';
import { config } from './config.js';
import { askClaude, resetSession } from './claude.js';
import { sendLong, withTyping, splitMessage } from './discord-utils.js';
import { startNotifyServer } from './notify-server.js';
import { getProjectCwd, isMapped, channelForCwd } from './projects.js';
import { ownerOf, setOwner } from './access.js';
import { commandDefs } from './commands.js';
import * as actions from './actions.js';

process.env.CLAUDE_BRIDGE_BOT = '1';

const KNOWN = new Set(['login', 'logout', 'link', 'unlink', 'pwd', 'reset', 'new', 'talk', 'auto', 'ping', 'help']);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

const rest = new REST().setToken(config.discordToken);

async function registerToGuild(clientId, guildId) {
  try {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commandDefs });
    console.log(`[discord] registered ${commandDefs.length} slash commands to guild ${guildId}`);
  } catch (e) {
    console.error(`[discord] slash register failed for guild ${guildId}:`, e?.message ?? e);
  }
}

const mentionPrompt = (message) =>
  message.content.replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '').trim();

// Error visible only to the offending user (message path): DM + best-effort delete.
async function denyPrivately(message, reason) {
  let dmed = false;
  try { await message.author.send(`⛔ ${reason}`); dmed = true; } catch { /* DMs closed */ }
  if (message.guild) {
    message.delete().catch(() => {});
    if (!dmed) {
      try {
        const r = await message.channel.send(`<@${message.author.id}> ⛔ ${reason}`);
        setTimeout(() => r.delete().catch(() => {}), 8000);
      } catch { /* ignore */ }
    }
  }
}

// Run a Claude turn and stream the reply to a text channel (message / mention path).
async function runPromptToChannel(channel, channelId, promptText) {
  if (!isMapped(channelId)) { await channel.send(`아직 프로젝트가 연결되지 않았어요.\n\n${actions.LINK_HELP}`); return; }
  const prompt = (promptText || '').slice(0, config.maxPrompt).trim();
  if (!prompt) { await channel.send('내용이 비어 있어요. 예: `/talk 지금 폴더에 뭐가 있어?`'); return; }
  const stopTyping = withTyping(channel);
  try {
    const { text } = await askClaude(channelId, prompt, getProjectCwd(channelId), { model: config.model });
    stopTyping();
    await sendLong(channel, text);
  } catch (err) {
    stopTyping();
    console.error('[claude] error:', err);
    await channel.send(`⚠️ 오류가 발생했어요: ${err?.message ?? err}`);
  }
}

client.once(Events.ClientReady, async (c) => {
  console.log(`[discord] logged in as ${c.user.tag}`);
  console.log(`[bridge] notify fallback channel = ${config.homeChannelId ?? '(none)'}`);
  startNotifyServer({
    port: config.notifyPort,
    secret: config.notifySecret,
    resolveChannel: async (payload) => {
      const id = channelForCwd(payload?.cwd) || config.homeChannelId;
      if (!id) return null;
      try { return await client.channels.fetch(id); } catch { return null; }
    },
  });
  for (const guildId of c.guilds.cache.keys()) await registerToGuild(c.user.id, guildId);
  console.log('[bridge] ready');
});

client.on(Events.GuildCreate, (guild) => registerToGuild(client.user.id, guild.id));

// ───────────────────────── Slash commands ─────────────────────────
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const name = interaction.commandName;
  const channelId = interaction.channelId;
  const me = interaction.user.id;
  const eph = { flags: MessageFlags.Ephemeral };

  if (!interaction.guildId) { await interaction.reply({ content: '⛔ DM에서는 작동하지 않아요.', ...eph }); return; }

  if (name === 'help') { await interaction.reply({ content: actions.HELP, ...eph }); return; }

  const owner = ownerOf(channelId);

  if (name === 'login') {
    if (owner === me) { await interaction.reply({ content: '이미 이 채널에 로그인돼 있어요.', ...eph }); return; }
    if (owner) { await interaction.reply({ content: '⛔ 이 채널은 다른 사용자가 사용 중이에요.', ...eph }); return; }
    await interaction.reply({ content: actions.login(channelId, me) });
    return;
  }

  // Every other command requires being this channel's owner.
  if (owner !== me) {
    const reason = owner ? '이 채널은 다른 사용자가 사용 중이에요.' : '이 채널은 비어 있어요. `/login` 으로 시작하세요.';
    await interaction.reply({ content: `⛔ ${reason}`, ...eph });
    return;
  }

  switch (name) {
    case 'logout': await interaction.reply({ content: actions.logout(channelId) }); return;
    case 'unlink': await interaction.reply({ content: actions.unlink(channelId) }); return;
    case 'link': {
      const r = actions.link(channelId, interaction.options.getString('code'));
      await interaction.reply({ content: r.text, ...(r.ok ? {} : eph) });
      return;
    }
    case 'auto': await interaction.reply({ content: actions.auto(channelId, interaction.options.getString('state')), ...eph }); return;
    case 'pwd': await interaction.reply({ content: actions.pwd(channelId, me), ...eph }); return;
    case 'reset': await interaction.reply({ content: actions.reset(channelId), ...eph }); return;
    case 'ping': await interaction.reply({ content: '🏓 pong', ...eph }); return;
    case 'talk': {
      const msg = interaction.options.getString('message');
      if (!isMapped(channelId)) { await interaction.reply({ content: `아직 프로젝트가 연결되지 않았어요.\n\n${actions.LINK_HELP}`, ...eph }); return; }
      await interaction.deferReply(); // public; opens a 15-min window
      try {
        const { text } = await askClaude(channelId, msg.slice(0, config.maxPrompt), getProjectCwd(channelId), { model: config.model });
        const parts = splitMessage(text);
        await interaction.editReply({ content: parts[0] || '(빈 응답)' });
        for (let i = 1; i < parts.length; i++) await interaction.followUp({ content: parts[i] });
      } catch (err) {
        console.error('[claude] error:', err);
        await interaction.editReply({ content: `⚠️ 오류가 발생했어요: ${err?.message ?? err}` });
      }
      return;
    }
  }
});

// ───────────────────────── "!" prefix + @mention ─────────────────────────
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  const content = message.content.trim();
  if (!content) return;

  const me = message.author.id;
  const channelId = message.channelId;

  if (!message.guild) { await denyPrivately(message, 'DM에서는 작동하지 않아요. 로그인한 채널에서 사용하세요.'); return; }

  const isCmd = content.startsWith('!');
  let cmd = '', arg = '';
  if (isCmd) {
    const sp = content.indexOf(' ');
    cmd = (sp === -1 ? content.slice(1) : content.slice(1, sp)).toLowerCase();
    arg = sp === -1 ? '' : content.slice(sp + 1).trim();
    if (!KNOWN.has(cmd)) return; // not our command (e.g. other bots') → silent
  }

  const mentioned = message.mentions?.users?.has(client.user.id) ?? false;
  const explicit = isCmd || mentioned;
  if (!explicit && !actions.autoChannels.has(channelId)) return; // normal chat → silent

  const owner = ownerOf(channelId);

  if (owner && owner !== me) {
    if (explicit) await denyPrivately(message, '이 채널은 다른 사용자가 사용 중이에요.');
    return;
  }

  if (!owner) {
    if (isCmd && cmd === 'login') { await message.reply(actions.login(channelId, me)); return; }
    if (isCmd && cmd === 'help') { await message.reply(actions.HELP); return; }
    if (explicit) await message.reply('이 채널은 비어 있어요. `!login`(또는 `/login`) 으로 시작하세요.');
    return;
  }

  // owner === me
  if (isCmd) {
    switch (cmd) {
      case 'login': await message.reply('이미 이 채널에 로그인돼 있어요.'); return;
      case 'logout': await message.reply(actions.logout(channelId)); return;
      case 'unlink': await message.reply(actions.unlink(channelId)); return;
      case 'link': await message.reply(actions.link(channelId, arg).text); return;
      case 'auto': await message.reply(actions.auto(channelId, arg)); return;
      case 'pwd': await message.reply(actions.pwd(channelId, me)); return;
      case 'reset':
      case 'new': await message.reply(actions.reset(channelId)); return;
      case 'ping': await message.reply('🏓 pong'); return;
      case 'help': await message.reply(actions.HELP); return;
      case 'talk': await runPromptToChannel(message.channel, channelId, arg); return;
    }
  }

  // mention or auto-mode plain text by the owner → prompt
  await runPromptToChannel(message.channel, channelId, mentioned ? mentionPrompt(message) : content);
});

client.on(Events.Error, (err) => console.error('[discord] client error:', err));

client.login(config.discordToken).catch((err) => {
  console.error('\n[discord] login failed:', err?.message ?? err);
  if (String(err?.message).includes('disallowed intents')) {
    console.error('→ Developer Portal에서 "Message Content Intent"를 켰는지 확인하세요.');
  } else {
    console.error('→ DISCORD_BOT_TOKEN 값이 올바른지 확인하세요.');
  }
  process.exit(1);
});
