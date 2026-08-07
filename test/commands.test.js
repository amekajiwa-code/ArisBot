import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMMANDS, planSay } from '../src/commands.js';
import { prepareSpeech } from '../src/speech-text.js';

// 두 백엔드의 텍스트 준비 방식. VOICEVOX는 가타카나로 음차하고, GPT-SoVITS는 한글 그대로.
const viaKana = (text, o) => prepareSpeech(text, { ...o, transliterate: true });
const viaHangul = (text, o) => prepareSpeech(text, { ...o, transliterate: false });

const base = {
  inGuild: true, inVoiceChannel: true, canConnect: true, canSpeak: true,
  text: '안녕하세요', maxLength: 200, prepare: viaKana,
};
const plan = (over) => planSay({ ...base, ...over });

test('COMMANDS: /say와 /leave를 디스코드 이름 규칙에 맞게 정의한다', () => {
  assert.deepEqual(COMMANDS.map((c) => c.name), ['say', 'leave']);
  for (const c of COMMANDS) {
    assert.match(c.name, /^[-_\p{L}\p{N}]{1,32}$/u);
    assert.ok(c.description.length > 0 && c.description.length <= 100);
    for (const o of c.options ?? []) assert.match(o.name, /^[-_\p{L}\p{N}]{1,32}$/u);
  }
});

test('COMMANDS: /say는 필수 문자열 옵션 하나를 받는다', () => {
  const [say] = COMMANDS;
  assert.equal(say.options.length, 1);
  assert.equal(say.options[0].required, true);
  assert.equal(say.options[0].type, 3); // ApplicationCommandOptionType.String
});

test('planSay: 정상 요청이면 보여 줄 내용과 엔진에 넘길 내용을 돌려준다', () => {
  assert.deepEqual(plan(), { ok: true, clean: '안녕하세요', spoken: 'アンニョンハセヨ', truncated: false });
});

test('planSay: 백엔드에 따라 넘길 내용이 갈린다', () => {
  // VOICEVOX(일본어 전용)는 음차하고, GPT-SoVITS(다국어)는 한글을 그대로 넘긴다.
  assert.equal(plan({ prepare: viaKana }).spoken, 'アンニョンハセヨ');
  assert.equal(plan({ prepare: viaHangul }).spoken, '안녕하세요');
  // 화면에 보여 줄 원문은 어느 쪽이든 같다.
  assert.equal(plan({ prepare: viaHangul }).clean, '안녕하세요');
});

test('planSay: 한글 그대로 넘길 때도 낱자 자모는 읽을 수 있게 편다', () => {
  assert.equal(plan({ text: 'ㅋㅋㅋ', prepare: viaHangul }).spoken, '크크크');
  assert.equal(plan({ text: 'ㅋㅋㅋ', prepare: viaKana }).spoken, 'ククク');
});

test('planSay: DM에서는 거절한다', () => {
  const r = plan({ inGuild: false });
  assert.equal(r.ok, false);
  assert.match(r.message, /서버 안에서만/);
});

test('planSay: 음성 채널에 없으면 안내한다', () => {
  const r = plan({ inVoiceChannel: false });
  assert.equal(r.ok, false);
  assert.match(r.message, /음성 채널에 들어가/);
});

test('planSay: 연결·말하기 권한이 없으면 거절한다', () => {
  assert.match(plan({ canConnect: false }).message, /권한이 없어요/);
  assert.match(plan({ canSpeak: false }).message, /권한이 없어요/);
});

test('planSay: 읽을 게 없으면 거절한다 (멘션·이모지만 있는 경우 포함)', () => {
  assert.match(plan({ text: '   ' }).message, /읽을 만한 내용이 없어요/);
  assert.match(plan({ text: '<@123> 🎮' }).message, /읽을 만한 내용이 없어요/);
});

test('planSay: 멘션·URL·마크다운을 걷어낸 내용으로 읽는다', () => {
  const r = plan({ text: '<@1> **대박** https://example.com' });
  assert.equal(r.ok, true);
  assert.equal(r.clean, '대박 링크');
  assert.equal(r.spoken, 'テバク リンク');
});

test('planSay: maxLength를 넘으면 잘라내고 그 사실을 알린다', () => {
  const r = plan({ text: '가나다라마', maxLength: 3 });
  assert.equal(r.ok, true);
  assert.equal(r.clean, '가나다');
  assert.equal(r.spoken, 'カナダ');
  assert.equal(r.truncated, true);
});
