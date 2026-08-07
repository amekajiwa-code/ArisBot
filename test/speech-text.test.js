import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeForSpeech, toSpeechKana, prepareSpeech } from '../src/speech-text.js';

test('sanitizeForSpeech: 멘션·채널·타임스탬프를 걷어낸다', () => {
  assert.equal(sanitizeForSpeech('<@123> 안녕'), '안녕');
  assert.equal(sanitizeForSpeech('<@!123> 안녕'), '안녕');
  assert.equal(sanitizeForSpeech('<@&456> 안녕'), '안녕');
  assert.equal(sanitizeForSpeech('<#789> 봐'), '봐');
  assert.equal(sanitizeForSpeech('<t:1700000000:R> 시작'), '시작');
  assert.equal(sanitizeForSpeech('@everyone 모여'), '모여');
});

test('sanitizeForSpeech: 커스텀 이모지와 유니코드 이모지를 걷어낸다', () => {
  assert.equal(sanitizeForSpeech('<:zunda:123> 안녕'), '안녕');
  assert.equal(sanitizeForSpeech('<a:dance:123> 안녕'), '안녕');
  assert.equal(sanitizeForSpeech('안녕 🎮🔥'), '안녕');
});

test('sanitizeForSpeech: URL은 "링크" 한 마디로 줄인다', () => {
  assert.equal(sanitizeForSpeech('이거 봐 https://store.steampowered.com/app/3088400 대박'), '이거 봐 링크 대박');
});

test('sanitizeForSpeech: 코드블록은 통째로, 인라인 코드는 내용만 남긴다', () => {
  assert.equal(sanitizeForSpeech('앞 ```js\nconst a = 1;\n``` 뒤'), '앞 뒤');
  assert.equal(sanitizeForSpeech('`안녕` 하세요'), '안녕 하세요');
});

test('sanitizeForSpeech: 마크다운 장식을 벗긴다', () => {
  assert.equal(sanitizeForSpeech('**굵게** _기울임_ ~~취소~~ ||스포||'), '굵게 기울임 취소 스포');
  assert.equal(sanitizeForSpeech('> 인용문'), '인용문');
});

test('sanitizeForSpeech: 공백을 정리한다', () => {
  assert.equal(sanitizeForSpeech('  안녕   \n\n  하세요  '), '안녕 하세요');
  assert.equal(sanitizeForSpeech('   '), '');
  assert.equal(sanitizeForSpeech(''), '');
  assert.equal(sanitizeForSpeech(null), '');
});

test('toSpeechKana: 한글을 가타카나로 음차한다', () => {
  assert.equal(toSpeechKana('안녕하세요'), 'アンニョンハセヨ');
  assert.equal(toSpeechKana('한국어'), 'ハングゴ');
});

test('toSpeechKana: 낱자 자모도 읽을 수 있게 바꾼다', () => {
  assert.equal(toSpeechKana('ㅋㅋㅋ'), 'ククク');
  assert.equal(toSpeechKana('ㅠㅠ'), 'ユユ');
  assert.equal(toSpeechKana('ㄱㅅ'), 'クス');
  assert.equal(toSpeechKana('대박 ㅋㅋ'), 'テバク クク');
});

test('toSpeechKana: 정리와 음차를 이어서 한다', () => {
  assert.equal(toSpeechKana('<@1> **안녕** https://x.com 🎮'), 'アンニョン リンク');
});

test('toSpeechKana: maxLength를 넘으면 잘라낸다', () => {
  assert.equal(toSpeechKana('가나다라마바사', { maxLength: 3 }), 'カナダ');
  assert.equal(toSpeechKana('가나다', { maxLength: 100 }), 'カナダ');
});

test('toSpeechKana: 읽을 게 없으면 빈 문자열', () => {
  assert.equal(toSpeechKana('<@123> 🎮'), '');
  assert.equal(toSpeechKana(''), '');
  assert.equal(toSpeechKana('```\ncode\n```'), '');
});

test('toSpeechKana: 일본어는 손대지 않고 통과시킨다', () => {
  assert.equal(toSpeechKana('ずんだもんなのだ'), 'ずんだもんなのだ');
});

test('prepareSpeech: 다국어 엔진용으로는 한글을 그대로 넘긴다', () => {
  const r = prepareSpeech('안녕하세요', { transliterate: false });
  assert.equal(r.clean, '안녕하세요');
  assert.equal(r.spoken, '안녕하세요');
  assert.equal(r.truncated, false);
});

test('prepareSpeech: 한글 그대로 넘길 때도 낱자 자모는 읽을 수 있게 편다', () => {
  const spoken = (t) => prepareSpeech(t, { transliterate: false }).spoken;
  assert.equal(spoken('ㅋㅋㅋ'), '크크크');
  assert.equal(spoken('ㅠㅠ'), '유유');
  assert.equal(spoken('ㄱㅅ'), '그스');
  assert.equal(spoken('대박 ㅋㅋ'), '대박 크크');
});

test('prepareSpeech: 정리는 두 엔진 모두 똑같이 한다', () => {
  const raw = '<@1> **대박** https://example.com 🎮';
  assert.equal(prepareSpeech(raw, { transliterate: false }).spoken, '대박 링크');
  assert.equal(prepareSpeech(raw, { transliterate: true }).spoken, 'テバク リンク');
});

test('prepareSpeech: 잘라내기는 음차 여부와 무관하게 원문 기준이다', () => {
  const r = prepareSpeech('가나다라마', { maxLength: 3, transliterate: false });
  assert.equal(r.clean, '가나다');
  assert.equal(r.spoken, '가나다');
  assert.equal(r.truncated, true);
});

test('prepareSpeech: 읽을 게 없으면 spoken이 빈 문자열', () => {
  assert.equal(prepareSpeech('<@123> 🎮', { transliterate: false }).spoken, '');
  assert.equal(prepareSpeech('', { transliterate: true }).spoken, '');
});
