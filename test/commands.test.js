import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMMANDS, planSay } from '../src/commands.js';

const base = {
  inGuild: true, inVoiceChannel: true, canConnect: true, canSpeak: true,
  text: '안녕하세요', maxLength: 200,
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

test('planSay: 정상 요청이면 읽을 내용과 가나를 돌려준다', () => {
  assert.deepEqual(plan(), { ok: true, clean: '안녕하세요', kana: 'アンニョンハセヨ', truncated: false });
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
  assert.equal(r.kana, 'テバク リンク');
});

test('planSay: maxLength를 넘으면 잘라내고 그 사실을 알린다', () => {
  const r = plan({ text: '가나다라마', maxLength: 3 });
  assert.equal(r.ok, true);
  assert.equal(r.clean, '가나다');
  assert.equal(r.kana, 'カナダ');
  assert.equal(r.truncated, true);
});
