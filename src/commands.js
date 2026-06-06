// Slash-command definitions. Registered to each guild for instant availability so
// they appear in the bot profile and in the "/" autocomplete picker.
// Names are lowercase ASCII (typed as /login, /talk, ...); descriptions are Korean.

import { SlashCommandBuilder } from 'discord.js';

export const commandDefs = [
  new SlashCommandBuilder().setName('login').setDescription('이 채널을 내 전용으로 로그인 (자동 ID)'),
  new SlashCommandBuilder().setName('logout').setDescription('이 채널 사용 종료(소유 해제)'),
  new SlashCommandBuilder()
    .setName('link')
    .setDescription('프로젝트 폴더 연결 (프로젝트 터미널의 link.js 코드 필요)')
    .addStringOption((o) => o.setName('code').setDescription('link.js가 출력한 1회용 코드').setRequired(true)),
  new SlashCommandBuilder().setName('unlink').setDescription('프로젝트 폴더 연결만 해제 (로그인 유지)'),
  new SlashCommandBuilder()
    .setName('talk')
    .setDescription('로컬 Claude에게 메시지를 보냅니다')
    .addStringOption((o) => o.setName('message').setDescription('보낼 메시지').setRequired(true)),
  new SlashCommandBuilder()
    .setName('auto')
    .setDescription('이 채널에서 /talk 없이 바로 대화 토글')
    .addStringOption((o) =>
      o.setName('state').setDescription('on 또는 off').setRequired(true)
        .addChoices({ name: 'on', value: 'on' }, { name: 'off', value: 'off' }),
    ),
  new SlashCommandBuilder().setName('pwd').setDescription('현재 프로젝트/세션 상태'),
  new SlashCommandBuilder().setName('reset').setDescription('대화 세션 초기화'),
  new SlashCommandBuilder().setName('ping').setDescription('봇 동작 확인'),
  new SlashCommandBuilder().setName('help').setDescription('도움말'),
].map((c) => c.toJSON());
