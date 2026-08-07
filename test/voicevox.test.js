import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVoicevoxClient } from '../src/voicevox.js';
import { DISCORD_SAMPLE_RATE } from '../src/pcm.js';
import { makeWav, pcmOf } from './wav-fixture.js';

const PCM = pcmOf([1, 2, 3, 4]);
const asArrayBuffer = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);

/** audio_query → synthesis 두 호출을 흉내 내고, 오간 요청을 기록한다. */
function stubEngine({ query = { speedScale: 1, accent_phrases: [] }, wav = makeWav(PCM) } = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    if (url.includes('/audio_query')) return { ok: true, status: 200, json: async () => query };
    return { ok: true, status: 200, arrayBuffer: async () => asArrayBuffer(wav) };
  };
  return { fetch, calls };
}

test('synthesize: audio_query 다음 synthesis를 부르고 PCM을 돌려준다', async () => {
  const { fetch, calls } = stubEngine();
  const client = createVoicevoxClient({ baseUrl: 'http://engine:50021', speaker: 3, fetch });

  assert.deepEqual(await client.synthesize('コンニチワ'), PCM);
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /\/audio_query\?text=%E3%82%B3%E3%83%B3%E3%83%8B%E3%83%81%E3%83%AF&speaker=3$/);
  assert.equal(calls[0].init.method, 'POST');
  assert.match(calls[1].url, /\/synthesis\?speaker=3$/);
});

test('synthesize: 디스코드 포맷을 요구하도록 AudioQuery를 고쳐 보낸다', async () => {
  const { fetch, calls } = stubEngine();
  const client = createVoicevoxClient({
    baseUrl: 'http://engine:50021', speaker: 1, speedScale: 1.3, pitchScale: 0.05,
    intonationScale: 1.4, volumeScale: 0.8, fetch,
  });
  await client.synthesize('テスト');

  const body = JSON.parse(calls[1].init.body);
  assert.equal(body.outputSamplingRate, DISCORD_SAMPLE_RATE);
  assert.equal(body.outputStereo, true);
  assert.equal(body.speedScale, 1.3);
  assert.equal(body.pitchScale, 0.05);
  assert.equal(body.intonationScale, 1.4);
  assert.equal(body.volumeScale, 0.8);
  assert.deepEqual(body.accent_phrases, []); // 엔진이 준 나머지 필드는 그대로 넘긴다
});

test('synthesize: 엔진이 요청한 포맷을 무시해도 소리는 맞춰서 나온다', async () => {
  // 24kHz 모노로 돌려주는 엔진 — 그대로 재생하면 속도가 이상해진다.
  const { fetch } = stubEngine({ wav: makeWav(pcmOf(new Array(240).fill(0)), { sampleRate: 24000, channels: 1 }) });
  const pcm = await createVoicevoxClient({ baseUrl: 'http://e', speaker: 3, fetch }).synthesize('ア');
  assert.equal(pcm.length, 480 * 4); // 240프레임 24k → 480프레임 48k, 스테레오
});

test('synthesize: baseUrl 끝의 슬래시는 중복되지 않는다', async () => {
  const { fetch, calls } = stubEngine();
  await createVoicevoxClient({ baseUrl: 'http://engine:50021///', speaker: 3, fetch }).synthesize('ア');
  assert.match(calls[0].url, /^http:\/\/engine:50021\/audio_query/);
});

test('synthesize: 엔진이 에러를 내면 어느 단계인지 밝히며 실패한다', async () => {
  const failing = (path) => async (url) => (
    url.includes(path)
      ? { ok: false, status: 422 }
      : { ok: true, status: 200, json: async () => ({}), arrayBuffer: async () => asArrayBuffer(makeWav(PCM)) }
  );

  await assert.rejects(
    createVoicevoxClient({ baseUrl: 'http://e', speaker: 3, fetch: failing('/audio_query') }).synthesize('ア'),
    /audio_query 실패 \(HTTP 422\)/,
  );
  await assert.rejects(
    createVoicevoxClient({ baseUrl: 'http://e', speaker: 3, fetch: failing('/synthesis') }).synthesize('ア'),
    /synthesis 실패 \(HTTP 422\)/,
  );
});

test('version: 따옴표를 벗겨 돌려준다', async () => {
  const fetch = async () => ({ ok: true, status: 200, text: async () => '"0.24.1"\n' });
  const client = createVoicevoxClient({ baseUrl: 'http://e', speaker: 3, fetch });
  assert.equal(await client.version(), '0.24.1');
});
