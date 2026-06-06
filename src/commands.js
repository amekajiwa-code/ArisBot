// Slash-command definitions. Registered per-guild so they appear in the "/" picker.

import { SlashCommandBuilder } from 'discord.js';

export const commandDefs = [
  new SlashCommandBuilder()
    .setName('start')
    .setDescription('이 채널을 봇에 연결하고 알림 훅을 설치합니다'),
  new SlashCommandBuilder()
    .setName('talk')
    .setDescription('로컬 Claude에게 메시지를 보냅니다')
    .addStringOption((o) => o.setName('message').setDescription('보낼 메시지').setRequired(true)),
].map((c) => c.toJSON());
