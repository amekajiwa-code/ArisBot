// /say · /leave 슬래시 명령어와 (선택적인) "say:" 접두사 모드.
//
// 슬래시 명령어는 privileged intent 없이 동작한다 — 이 봇이 원래 갖고 있던
// "포털에서 특권 인텐트를 켤 필요가 없다"는 성질을 그대로 지킨다.
// 접두사 모드만 예외로 Message Content 인텐트를 요구하므로 기본으로 꺼져 있다.

import { ApplicationCommandOptionType, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { prepareSpeech } from './speech-text.js';

const ZUNDA_COLOR = 0x5fbf7f; // 즌다몬의 풋콩 초록

export const COMMANDS = [
  {
    name: 'say',
    description: '즌다몬이 음성 채널에서 한국어로 말합니다',
    description_localizations: { ko: '즌다몬이 음성 채널에서 한국어로 말합니다' },
    options: [{
      name: 'text',
      name_localizations: { ko: '내용' },
      description: '말할 내용',
      description_localizations: { ko: '말할 내용' },
      type: ApplicationCommandOptionType.String,
      required: true,
      max_length: 500,
    }],
  },
  {
    name: 'leave',
    description: '즌다몬이 음성 채널에서 나갑니다',
    description_localizations: { ko: '즌다몬이 음성 채널에서 나갑니다' },
  },
];

/**
 * 말할 수 있는 상황인지 따지고, 말할 내용을 확정한다. 디스코드 객체를 받지 않는
 * 순수 함수 — 실패 사유가 곧 사용자에게 보여 줄 문구다.
 *
 * @returns {{ok: false, message: string} | {ok: true, clean: string, kana: string, truncated: boolean}}
 */
export function planSay({ inGuild, inVoiceChannel, canConnect, canSpeak, text, maxLength }) {
  if (!inGuild) return { ok: false, message: '서버 안에서만 쓸 수 있어요.' };
  if (!inVoiceChannel) return { ok: false, message: '먼저 음성 채널에 들어가 주세요. 즌다몬이 따라 들어갑니다.' };
  if (!canConnect || !canSpeak) {
    return { ok: false, message: '그 음성 채널에 들어가거나 말할 권한이 없어요. (연결 · 말하기 권한 필요)' };
  }

  const speech = prepareSpeech(text, { maxLength });
  if (!speech.kana) return { ok: false, message: '읽을 만한 내용이 없어요.' };
  return { ok: true, ...speech };
}

/** 무엇을 어떻게 읽었는지 보여 주는 임베드. 가나를 같이 띄우면 발음이 왜 그런지 바로 보인다. */
function sayEmbed({ clean, kana, truncated }, speakerName) {
  return {
    color: ZUNDA_COLOR,
    author: { name: `🗣️ ${speakerName}` },
    description: clean,
    footer: { text: truncated ? `${kana} (길어서 잘랐어요)` : kana },
  };
}

const ephemeral = (content) => ({ content, flags: MessageFlags.Ephemeral });

/** 봇이 이 음성 채널에 들어가 말할 수 있는지. */
function voicePermissions(channel, botUser) {
  const perms = channel?.permissionsFor(botUser);
  return {
    canConnect: Boolean(perms?.has(PermissionFlagsBits.Connect)),
    canSpeak: Boolean(perms?.has(PermissionFlagsBits.Speak)),
  };
}

/**
 * InteractionCreate 핸들러.
 * @param {object} opts
 * @param {{speak: Function, leave: Function}} opts.sessions
 * @param {number} opts.maxLength
 */
export function createInteractionHandler({ sessions, maxLength }) {
  return async function handleInteraction(interaction) {
    if (!interaction.isChatInputCommand()) return;

    try {
      if (interaction.commandName === 'leave') {
        const left = interaction.inGuild() && sessions.leave(interaction.guildId);
        await interaction.reply(ephemeral(left ? '👋 나갔어요.' : '음성 채널에 들어가 있지 않아요.'));
        return;
      }

      if (interaction.commandName !== 'say') return;

      const channel = interaction.member?.voice?.channel ?? null;
      const plan = planSay({
        inGuild: interaction.inGuild(),
        inVoiceChannel: Boolean(channel),
        ...voicePermissions(channel, interaction.client.user),
        text: interaction.options.getString('text'),
        maxLength,
      });
      if (!plan.ok) {
        await interaction.reply(ephemeral(plan.message));
        return;
      }

      // 합성·재생을 기다리지 않고 먼저 답한다. 인터랙션은 3초 안에 답해야 하는데
      // 합성은 그보다 오래 걸릴 수 있다.
      await interaction.reply({ embeds: [sayEmbed(plan, interaction.member.displayName)] });

      try {
        await sessions.speak(channel, plan.kana);
      } catch (e) {
        console.error('[tts] speak failed:', e?.message ?? e);
        await interaction.followUp(ephemeral(`❌ 말하지 못했어요: ${e?.message ?? e}`)).catch(() => {});
      }
    } catch (e) {
      console.error('[tts] interaction error:', e?.message ?? e);
    }
  };
}

/**
 * "say: 안녕" 형태의 메시지 접두사 핸들러.
 * Message Content 인텐트가 필요하므로 config에서 명시적으로 켰을 때만 등록한다.
 */
export function createMessageHandler({ sessions, maxLength, prefix }) {
  const lower = prefix.toLowerCase();

  return async function handleMessage(message) {
    if (message.author.bot || !message.content.toLowerCase().startsWith(lower)) return;

    try {
      const channel = message.member?.voice?.channel ?? null;
      const plan = planSay({
        inGuild: Boolean(message.guildId),
        inVoiceChannel: Boolean(channel),
        ...voicePermissions(channel, message.client.user),
        text: message.content.slice(prefix.length),
        maxLength,
      });
      if (!plan.ok) {
        await message.reply(plan.message).catch(() => {});
        return;
      }

      // 접두사 모드는 채널을 덜 어지럽히도록 임베드 대신 반응만 남긴다.
      await message.react('🗣️').catch(() => {});
      await sessions.speak(channel, plan.kana);
    } catch (e) {
      console.error('[tts] message error:', e?.message ?? e);
      await message.reply(`❌ 말하지 못했어요: ${e?.message ?? e}`).catch(() => {});
    }
  };
}
