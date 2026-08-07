import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGptSovitsClient, LANGUAGES } from '../src/gpt-sovits.js';
import { makeWav, pcmOf } from './wav-fixture.js';

const asArrayBuffer = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);

// 모델이 실제로 내주는 모양: 32kHz 모노.
const MODEL_WAV = makeWav(pcmOf(new Array(320).fill(0)), { sampleRate: 32000, channels: 1 });

const opts = (over = {}) => ({
  baseUrl: 'http://gpu-box:9880',
  refAudioPath: '/opt/zundamon/reference.wav',
  promptText: '流し切りが完全に入ればデバフの効果が付与される',
  ...over,
});

function stubServer({ wav = MODEL_WAV, status = 200, body = null } = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    if (status !== 200) return { ok: false, status, json: async () => body };
    return { ok: true, status: 200, arrayBuffer: async () => asArrayBuffer(wav) };
  };
  return { fetch, calls };
}

test('synthesize: /tts 에 POST하고 디스코드용 PCM을 돌려준다', async () => {
  const { fetch, calls } = stubServer();
  const pcm = await createGptSovitsClient(opts({ fetch })).synthesize('안녕하세요');

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://gpu-box:9880/tts');
  assert.equal(calls[0].init.method, 'POST');
  // 320프레임 32k 모노 → 480프레임 48k 스테레오
  assert.equal(pcm.length, 480 * 4);
});

test('synthesize: 한글을 음차하지 않고 그대로 넘긴다', async () => {
  const { fetch, calls } = stubServer();
  await createGptSovitsClient(opts({ fetch })).synthesize('데들리 트릭 재밌다');

  assert.equal(calls[0].body.text, '데들리 트릭 재밌다');
  assert.equal(calls[0].body.text_lang, LANGUAGES.korean); // all_ko
});

test('synthesize: 참조 음성과 그 문장을 함께 보낸다 (few-shot 복제라 없으면 목소리가 안 잡힌다)', async () => {
  const { fetch, calls } = stubServer();
  await createGptSovitsClient(opts({ fetch })).synthesize('안녕');

  const { body } = calls[0];
  assert.equal(body.ref_audio_path, '/opt/zundamon/reference.wav');
  assert.equal(body.prompt_text, '流し切りが完全に入ればデバフの効果が付与される');
  assert.equal(body.prompt_lang, LANGUAGES.japanese); // 참조본이 일본어라 기본값이 all_ja
});

test('synthesize: 표본율이 헤더에 실려 오도록 wav를 요청한다', async () => {
  const { fetch, calls } = stubServer();
  await createGptSovitsClient(opts({ fetch })).synthesize('안녕');
  assert.equal(calls[0].body.media_type, 'wav');
  assert.equal(calls[0].body.streaming_mode, false);
});

test('synthesize: 합성 파라미터를 넘긴다', async () => {
  const { fetch, calls } = stubServer();
  await createGptSovitsClient(opts({
    fetch, speedFactor: 1.2, topK: 10, topP: 0.9, temperature: 0.8, textLang: LANGUAGES.koreanEnglish,
  })).synthesize('안녕 Deadly Trick');

  const { body } = calls[0];
  assert.equal(body.speed_factor, 1.2);
  assert.equal(body.top_k, 10);
  assert.equal(body.top_p, 0.9);
  assert.equal(body.temperature, 0.8);
  assert.equal(body.text_lang, 'ko'); // 한영 혼용
});

test('synthesize: baseUrl 끝의 슬래시는 중복되지 않는다', async () => {
  const { fetch, calls } = stubServer();
  await createGptSovitsClient(opts({ baseUrl: 'http://gpu-box:9880//', fetch })).synthesize('안녕');
  assert.equal(calls[0].url, 'http://gpu-box:9880/tts');
});

test('synthesize: 서버가 사유를 주면 그대로 전달한다', async () => {
  const { fetch } = stubServer({ status: 400, body: { message: 'text_lang: all_ko is not supported in version v1' } });
  await assert.rejects(
    createGptSovitsClient(opts({ fetch })).synthesize('안녕'),
    /\(HTTP 400\): text_lang: all_ko is not supported/,
  );
});

test('synthesize: 사유가 없어도 상태 코드는 알려준다', async () => {
  const fetch = async () => ({ ok: false, status: 500, json: async () => { throw new Error('not json'); } });
  await assert.rejects(createGptSovitsClient(opts({ fetch })).synthesize('안녕'), /\/tts 실패 \(HTTP 500\)/);
});

test('synthesize: 타임아웃은 GPU가 느리다는 걸 알 수 있게 말한다', async () => {
  const fetch = async () => { throw Object.assign(new Error('timeout'), { name: 'TimeoutError' }); };
  await assert.rejects(
    createGptSovitsClient(opts({ fetch, timeoutMs: 60000 })).synthesize('안녕'),
    /60초를 넘었습니다.*GPU/,
  );
});

test('synthesize: 접속 실패는 주소를 밝히며 알린다', async () => {
  const fetch = async () => { throw new Error('ECONNREFUSED'); };
  await assert.rejects(
    createGptSovitsClient(opts({ fetch })).synthesize('안녕'),
    /http:\/\/gpu-box:9880.*ECONNREFUSED/,
  );
});
