import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTtsBackend } from '../src/tts-backend.js';
import { loadConfig } from '../src/config.js';

const cfg = (env) => loadConfig({ DISCORD_BOT_TOKEN: 'tok', ...env });

const GPT = {
  GPT_SOVITS_BASE_URL: 'http://gpu-box:9880',
  GPT_SOVITS_REF_AUDIO_PATH: '/opt/zundamon/reference.wav',
};
const VOICEVOX = { VOICEVOX_BASE_URL: 'http://127.0.0.1:50021' };

test('엔진 URL이 하나도 없으면 TTS는 꺼진다', () => {
  assert.equal(createTtsBackend(cfg({})), null);
});

test('VOICEVOX만 설정하면 VOICEVOX를 쓰고 한글을 음차한다', () => {
  const backend = createTtsBackend(cfg(VOICEVOX));
  assert.equal(backend.name, 'VOICEVOX');
  assert.equal(backend.prepare('안녕하세요', { maxLength: 200 }).spoken, 'アンニョンハセヨ');
});

test('GPT-SoVITS만 설정하면 GPT-SoVITS를 쓰고 한글을 그대로 넘긴다', () => {
  const backend = createTtsBackend(cfg(GPT));
  assert.equal(backend.name, 'GPT-SoVITS');
  assert.equal(backend.prepare('안녕하세요', { maxLength: 200 }).spoken, '안녕하세요');
});

test('둘 다 설정하면 한국어를 제대로 읽는 GPT-SoVITS가 이긴다', () => {
  assert.equal(createTtsBackend(cfg({ ...GPT, ...VOICEVOX })).name, 'GPT-SoVITS');
});

test('어느 백엔드든 같은 모양을 갖춘다', () => {
  for (const env of [GPT, VOICEVOX]) {
    const backend = createTtsBackend(cfg(env));
    assert.equal(typeof backend.prepare, 'function');
    assert.equal(typeof backend.synthesize, 'function');
    assert.equal(typeof backend.describe, 'function');

    // prepare는 어느 쪽이든 같은 세 필드를 돌려준다.
    const r = backend.prepare('<@1> **대박**', { maxLength: 200 });
    assert.deepEqual(Object.keys(r).sort(), ['clean', 'spoken', 'truncated']);
    assert.equal(r.clean, '대박');
  }
});
