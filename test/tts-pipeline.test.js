// 텍스트 → 엔진 HTTP 호출 → WAV → 디스코드용 PCM 전 구간을 실제 소켓 위에서 훑는다.
// fetch를 스텁으로 바꾸지 않으므로 URL 조립·헤더·본문·바이너리 응답 처리까지 함께 검증된다.
// (엔진 자체는 GPU·수 GB 모델이 필요해서 응답 모양만 흉내 낸 서버를 세운다)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createVoicevoxClient } from '../src/voicevox.js';
import { createGptSovitsClient } from '../src/gpt-sovits.js';
import { DISCORD_SAMPLE_RATE } from '../src/pcm.js';
import { createVoiceSessions } from '../src/voice.js';
import { prepareSpeech } from '../src/speech-text.js';
import { makeWav, pcmOf } from './wav-fixture.js';

const toKana = (t) => prepareSpeech(t, { transliterate: true }).spoken;
const toHangul = (t) => prepareSpeech(t, { transliterate: false }).spoken;

/** 10ms 분량의 무음. */
const silentWav = (rate, channels) => makeWav(
  pcmOf(new Array((rate / 100) * channels).fill(0)),
  { sampleRate: rate, channels },
);

/**
 * 주어진 라우트 표만큼만 응답하는 서버를 띄운다.
 * @param {Record<string, (url: URL, body: object|null) => {json?: object, wav?: Buffer}>} routes
 */
async function startFakeEngine(routes) {
  const seen = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString();
      const body = raw ? JSON.parse(raw) : null;
      seen.push({ path: url.pathname, query: url.searchParams, body });

      const handler = routes[url.pathname];
      if (!handler) { res.writeHead(404).end(); return; }

      const out = handler(url, body);
      if (out.json) {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out.json));
      } else {
        res.writeHead(200, { 'content-type': 'audio/wav' }).end(out.wav);
      }
    });
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { seen, baseUrl: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

const voicevoxRoutes = {
  '/audio_query': () => ({ json: { accent_phrases: [{ moras: [] }], speedScale: 1.0, outputStereo: false } }),
  // 요청받은 대로 48kHz 스테레오로 구워 준다.
  '/synthesis': () => ({ wav: silentWav(DISCORD_SAMPLE_RATE, 2) }),
};

// GPT-SoVITS 모델은 32kHz 모노 고정이다.
const gptSovitsRoutes = { '/tts': () => ({ wav: silentWav(32000, 1) }) };

test('VOICEVOX 전 구간: 한글이 가나로 음차돼 디스코드용 PCM으로 나온다', async (t) => {
  const engine = await startFakeEngine(voicevoxRoutes);
  t.after(engine.close);

  const client = createVoicevoxClient({ baseUrl: engine.baseUrl, speaker: 3, speedScale: 1.1 });
  const pcm = await client.synthesize(toKana('안녕하세요 즌다몬입니다'));

  // 48kHz 스테레오 16bit → 프레임당 4바이트. 10ms면 480프레임 = 1920바이트.
  assert.equal(pcm.length, 1920);

  const [query, synth] = engine.seen;
  assert.equal(query.path, '/audio_query');
  assert.equal(query.query.get('speaker'), '3');
  assert.equal(query.query.get('text'), 'アンニョンハセヨ チュンダモニムニダ');
  assert.equal(synth.path, '/synthesis');
  assert.equal(synth.body.outputSamplingRate, DISCORD_SAMPLE_RATE);
  assert.equal(synth.body.outputStereo, true);
  assert.equal(synth.body.speedScale, 1.1);
  assert.deepEqual(synth.body.accent_phrases, [{ moras: [] }]); // 엔진 응답을 그대로 되돌려준다
});

test('GPT-SoVITS 전 구간: 한글이 음차 없이 넘어가고 32k 모노가 48k 스테레오로 변환된다', async (t) => {
  const engine = await startFakeEngine(gptSovitsRoutes);
  t.after(engine.close);

  const client = createGptSovitsClient({
    baseUrl: engine.baseUrl,
    refAudioPath: '/opt/zundamon/reference.wav',
    promptText: '流し切りが完全に入ればデバフの効果が付与される',
  });
  const pcm = await client.synthesize(toHangul('안녕하세요 즌다몬입니다'));

  // 320프레임 32k 모노 → 480프레임 48k 스테레오 = 1920바이트
  assert.equal(pcm.length, 1920);

  const [tts] = engine.seen;
  assert.equal(tts.path, '/tts');
  assert.equal(tts.body.text, '안녕하세요 즌다몬입니다'); // 한글 그대로
  assert.equal(tts.body.text_lang, 'all_ko');
  assert.equal(tts.body.ref_audio_path, '/opt/zundamon/reference.wav');
});

test('전 구간: 세션이 합성 결과를 음성 채널로 흘려보낸다', async (t) => {
  const engine = await startFakeEngine(voicevoxRoutes);
  t.after(engine.close);

  const client = createVoicevoxClient({ baseUrl: engine.baseUrl, speaker: 3 });
  const played = [];
  const sessions = createVoiceSessions({
    synthesize: (spoken) => client.synthesize(spoken),
    connect: async () => ({ play: async (pcm) => { played.push(pcm.length); }, destroy: () => {} }),
    idleTimeoutMs: 0,
  });

  const channel = { id: 'c1', guild: { id: 'g1' } };
  await sessions.speak(channel, toKana('대박'));
  await sessions.speak(channel, toKana('ㅋㅋㅋ'));

  assert.deepEqual(played, [1920, 1920]);
  assert.deepEqual(
    engine.seen.filter((r) => r.path === '/audio_query').map((r) => r.query.get('text')),
    ['テバク', 'ククク'],
  );
});

test('전 구간: 엔진이 죽어 있으면 speak가 이유를 안고 실패한다', async () => {
  // 아무도 듣지 않는 포트 — 접속 자체가 거부된다.
  const client = createVoicevoxClient({ baseUrl: 'http://127.0.0.1:1', speaker: 3, timeoutMs: 2000 });
  const sessions = createVoiceSessions({
    synthesize: (spoken) => client.synthesize(spoken),
    connect: async () => ({ play: async () => {}, destroy: () => {} }),
    idleTimeoutMs: 0,
  });

  await assert.rejects(sessions.speak({ id: 'c1', guild: { id: 'g1' } }, 'テスト'));
});
