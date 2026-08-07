import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVoicevoxClient, extractPcm, DISCORD_SAMPLE_RATE } from '../src/voicevox.js';

/** 최소한의 RIFF/WAVE를 만든다. extraChunk를 주면 fmt와 data 사이에 끼워 넣는다. */
function makeWav(pcm, { sampleRate = DISCORD_SAMPLE_RATE, channels = 2, bits = 16, extraChunk = null } = {}) {
  const fmt = Buffer.alloc(24);
  fmt.write('fmt ', 0, 'ascii');
  fmt.writeUInt32LE(16, 4);
  fmt.writeUInt16LE(1, 8);             // PCM
  fmt.writeUInt16LE(channels, 10);
  fmt.writeUInt32LE(sampleRate, 12);
  fmt.writeUInt32LE(sampleRate * channels * (bits / 8), 16);
  fmt.writeUInt16LE(channels * (bits / 8), 20);
  fmt.writeUInt16LE(bits, 22);

  const dataHeader = Buffer.alloc(8);
  dataHeader.write('data', 0, 'ascii');
  dataHeader.writeUInt32LE(pcm.length, 4);

  const body = Buffer.concat([fmt, extraChunk ?? Buffer.alloc(0), dataHeader, pcm]);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(4 + body.length, 4);
  header.write('WAVE', 8, 'ascii');
  return Buffer.concat([header, body]);
}

const PCM = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);

test('extractPcm: data 청크 본문을 돌려준다', () => {
  assert.deepEqual(extractPcm(makeWav(PCM)), PCM);
});

test('extractPcm: fmt와 data 사이에 다른 청크가 끼어도 찾아낸다', () => {
  const list = Buffer.alloc(8 + 10);
  list.write('LIST', 0, 'ascii');
  list.writeUInt32LE(10, 4);
  assert.deepEqual(extractPcm(makeWav(PCM, { extraChunk: list })), PCM);
});

test('extractPcm: 홀수 크기 청크의 패딩 바이트를 건너뛴다', () => {
  const odd = Buffer.alloc(8 + 3 + 1);
  odd.write('junk', 0, 'ascii');
  odd.writeUInt32LE(3, 4);
  assert.deepEqual(extractPcm(makeWav(PCM, { extraChunk: odd })), PCM);
});

test('extractPcm: 선언된 크기가 버퍼를 넘어가면 있는 데까지만 돌려준다', () => {
  const wav = makeWav(PCM);
  wav.writeUInt32LE(9999, wav.length - PCM.length - 4); // data 청크 크기를 부풀린다
  assert.deepEqual(extractPcm(wav), PCM);
});

test('extractPcm: 디스코드가 못 쓰는 포맷이면 이유를 밝히며 실패한다', () => {
  assert.throws(() => extractPcm(makeWav(PCM, { sampleRate: 24000 })), /24000Hz/);
  assert.throws(() => extractPcm(makeWav(PCM, { channels: 1 })), /1ch/);
});

test('extractPcm: WAV가 아니거나 data 청크가 없으면 실패한다', () => {
  assert.throws(() => extractPcm(Buffer.from('not a wav at all')), /WAV가 아닙니다/);
  assert.throws(() => extractPcm(Buffer.alloc(4)), /WAV가 아닙니다/);

  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'ascii');
  header.write('WAVE', 8, 'ascii');
  assert.throws(() => extractPcm(header), /data 청크가 없습니다/);
});

/** audio_query → synthesis 두 호출을 흉내 내고, 오간 요청을 기록한다. */
function stubEngine({ query = { speedScale: 1, accent_phrases: [] }, wav = makeWav(PCM) } = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    if (url.includes('/audio_query')) {
      return { ok: true, status: 200, json: async () => query };
    }
    return { ok: true, status: 200, arrayBuffer: async () => wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.length) };
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

test('synthesize: baseUrl 끝의 슬래시는 중복되지 않는다', async () => {
  const { fetch, calls } = stubEngine();
  await createVoicevoxClient({ baseUrl: 'http://engine:50021///', speaker: 3, fetch }).synthesize('ア');
  assert.match(calls[0].url, /^http:\/\/engine:50021\/audio_query/);
});

test('synthesize: 엔진이 에러를 내면 어느 단계인지 밝히며 실패한다', async () => {
  const failing = (path) => async (url) => (
    url.includes(path)
      ? { ok: false, status: 422 }
      : { ok: true, status: 200, json: async () => ({}), arrayBuffer: async () => makeWav(PCM).buffer }
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
