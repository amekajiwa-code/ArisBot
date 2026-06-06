// Discord ↔ local Claude bridge (v1: single-owner, single-channel).
//
// Access: only ALLOWED_USER_ID, only the channel bound via /start. Two commands:
//   /start  — bind this channel + install the notify hook into PROJECT_DIR
//   /talk   — send a message to the local Claude (plain text in the bound channel works too)

import { Client, GatewayIntentBits, Events, Partials, REST, Routes, MessageFlags } from 'discord.js';
import { getConfig } from './config.js';
import { askClaude } from './claude.js';
import { sendLong, withTyping, splitMessage } from './discord-utils.js';
import { startNotifyServer } from './notify-server.js';
import { installNotifyHook } from './install-hook.js';
import { binding } from './binding.js';
import { isAuthorized } from './gate.js';
import { commandDefs } from './commands.js';

const config = getConfig();

// Sessions the bot drives have their replies relayed directly, so the notify hook
// must skip them (notify.js checks this env var) to avoid double-notifying.
process.env.CLAUDE_BRIDGE_BOT = '1';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

const rest = new REST().setToken(config.discordToken);

async function registerToGuild(clientId, guildId) {
  try {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commandDefs });
    console.log(`[discord] registered ${commandDefs.length} commands to guild ${guildId}`);
  } catch (e) {
    console.error(`[discord] slash register failed for guild ${guildId}:`, e?.message ?? e);
  }
}

// Run one Claude turn and stream the reply to a text channel (message/plain-text path).
async function runClaudeTurn(channel, promptText) {
  const prompt = (promptText || '').slice(0, config.maxPrompt).trim();
  if (!prompt) { await channel.send('내용이 비어 있어요.'); return; }
  const stopTyping = withTyping(channel);
  try {
    const { text } = await askClaude(channel.id, prompt, config.projectDir, { model: config.model });
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
  console.log(`[bridge] PROJECT_DIR = ${config.projectDir}`);

  if (config.notifySecret) {
    startNotifyServer({
      port: config.notifyPort,
      secret: config.notifySecret,
      resolveChannel: async () => {
        const id = binding.get();
        if (!id) return null;
        try { return await c.channels.fetch(id); } catch { return null; }
      },
    });
  } else {
    console.log('[notify] disabled (set NOTIFY_SECRET to enable)');
  }

  for (const guildId of c.guilds.cache.keys()) await registerToGuild(c.user.id, guildId);
  console.log('[bridge] ready');
});

client.on(Events.GuildCreate, (guild) => registerToGuild(client.user.id, guild.id));

// ───────────────────────── Slash commands ─────────────────────────
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const eph = { flags: MessageFlags.Ephemeral };

  // Only the owner may use any command.
  if (interaction.user.id !== config.allowedUserId) {
    await interaction.reply({ content: '⛔ 이 봇의 주인만 사용할 수 있어요.', ...eph });
    return;
  }

  if (interaction.commandName === 'start') {
    binding.set(interaction.channelId);
    let hookLine;
    try {
      const r = installNotifyHook(config.projectDir);
      hookLine = r === 'installed' ? '알림 훅 설치됨' : '알림 훅 이미 설치됨';
    } catch (e) {
      hookLine = `알림 훅 설치 실패: ${e.message}`;
    }
    await interaction.reply({
      content:
        `✅ 이 채널을 연결했어요.\n` +
        `📁 프로젝트: \`${config.projectDir}\`\n` +
        `🔔 ${hookLine}\n\n` +
        `이제 \`/talk\` 또는 그냥 메시지로 대화하세요.`,
      ...eph,
    });
    return;
  }

  if (interaction.commandName === 'talk') {
    const boundChannelId = binding.get();
    const ok = isAuthorized({
      userId: interaction.user.id,
      channelId: interaction.channelId,
      allowedUserId: config.allowedUserId,
      boundChannelId,
    });
    if (!ok) {
      await interaction.reply({
        content: boundChannelId ? '⛔ 연결된 채널에서만 사용하세요.' : '먼저 `/start` 를 실행하세요.',
        ...eph,
      });
      return;
    }
    await interaction.deferReply();
    try {
      const msg = interaction.options.getString('message').slice(0, config.maxPrompt);
      const { text } = await askClaude(interaction.channelId, msg, config.projectDir, { model: config.model });
      const parts = splitMessage(text);
      await interaction.editReply({ content: parts[0] || '(빈 응답)' });
      for (let i = 1; i < parts.length; i++) await interaction.followUp({ content: parts[i] });
    } catch (err) {
      console.error('[claude] error:', err);
      await interaction.editReply({ content: `⚠️ 오류가 발생했어요: ${err?.message ?? err}` });
    }
    return;
  }
});

// ───────────────────────── Plain text in the bound channel ─────────────────────────
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  const content = message.content.trim();
  if (!content) return;

  const boundChannelId = binding.get();
  const ok = isAuthorized({
    userId: message.author.id,
    channelId: message.channelId,
    allowedUserId: config.allowedUserId,
    boundChannelId,
  });
  if (!ok) return; // silent: not the owner / not the bound channel

  await runClaudeTurn(message.channel, content);
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
