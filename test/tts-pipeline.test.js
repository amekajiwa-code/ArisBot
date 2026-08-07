// 한글 → 가나 → HTTP → WAV → PCM 전 구간을 실제 소켓 위에서 한 번 훑는다.
// fetch를 스텁으로 바꾸지 않으므로 URL 조립·헤더·본문·바이너리 응답 처리까지 함께 검증된다.
// (VOICEVOX ENGINE 자체는 무거워서 응답 모양만 흉내 낸 서버를 세운다)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createVoicevoxClient, DISCORD_SAMPLE_RATE } from '../src/voicevox.js';
import { createVoiceSessions } from '../src/voice.js';
import { toSpeechKana } from '../src/speech-text.js';

/** 48kHz 스테레오 s16le WAV. sampleCount 샘플만큼 무음을 담는다. */
function silentWav(sampleCount) {
  const pcm = Buffer.alloc(sampleCount * 2 * 2);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(DISCORD_SAMPLE_RATE, 24);
  header.writeUInt32LE(DISCORD_SAMPLE_RATE * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** VOICEVOX ENGINE의 /audio_query·/synthesis 모양만 흉내 내는 서버. */
async function startFakeEngine() {
  const seen = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      seen.push({
        path: url.pathname,
        text: url.searchParams.get('text'),
        speaker: url.searchParams.get('speaker'),
        body: chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null,
      });

      if (url.pathname === '/audio_query') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ accent_phrases: [{ moras: [] }], speedScale: 1.0, outputStereo: false }));
        return;
      }
      if (url.pathname === '/synthesis') {
        res.writeHead(200, { 'content-type': 'audio/wav' });
        res.end(silentWav(480)); // 10ms
        return;
      }
      res.writeHead(404).end();
    });
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { seen, baseUrl: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

test('전 구간: 한글 한 마디가 디스코드용 PCM으로 나온다', async (t) => {
  const engine = await startFakeEngine();
  t.after(engine.close);

  const client = createVoicevoxClient({ baseUrl: engine.baseUrl, speaker: 3, speedScale: 1.1 });
  const kana = toSpeechKana('안녕하세요 즌다몬입니다');
  const pcm = await client.synthesize(kana);

  // 48kHz 스테레오 16bit → 샘플당 4바이트. 10ms면 480샘플 = 1920바이트.
  assert.equal(pcm.length, 1920);
  assert.ok(Buffer.isBuffer(pcm));

  const [query, synth] = engine.seen;
  assert.equal(query.path, '/audio_query');
  assert.equal(query.speaker, '3');
  assert.equal(query.text, 'アンニョンハセヨ チュンダモニムニダ'); // 서버가 디코딩한 값
  assert.equal(synth.path, '/synthesis');
  assert.equal(synth.body.outputSamplingRate, DISCORD_SAMPLE_RATE);
  assert.equal(synth.body.outputStereo, true);
  assert.equal(synth.body.speedScale, 1.1);
  assert.deepEqual(synth.body.accent_phrases, [{ moras: [] }]); // 엔진 응답을 그대로 되돌려준다
});

test('전 구간: 세션이 합성 결과를 음성 채널로 흘려보낸다', async (t) => {
  const engine = await startFakeEngine();
  t.after(engine.close);

  const client = createVoicevoxClient({ baseUrl: engine.baseUrl, speaker: 3 });
  const played = [];
  const sessions = createVoiceSessions({
    synthesize: (kana) => client.synthesize(kana),
    connect: async () => ({ play: async (pcm) => { played.push(pcm.length); }, destroy: () => {} }),
    idleTimeoutMs: 0,
  });

  const channel = { id: 'c1', guild: { id: 'g1' } };
  await sessions.speak(channel, toSpeechKana('대박'));
  await sessions.speak(channel, toSpeechKana('ㅋㅋㅋ'));

  assert.deepEqual(played, [1920, 1920]);
  assert.equal(engine.seen.filter((r) => r.path === '/synthesis').length, 2);
  assert.deepEqual(
    engine.seen.filter((r) => r.path === '/audio_query').map((r) => r.text),
    ['テバク', 'ククク'],
  );
});

test('전 구간: 엔진이 죽어 있으면 speak가 이유를 안고 실패한다', async () => {
  // 아무도 듣지 않는 포트 — 접속 자체가 거부된다.
  const client = createVoicevoxClient({ baseUrl: 'http://127.0.0.1:1', speaker: 3, timeoutMs: 2000 });
  const sessions = createVoiceSessions({
    synthesize: (kana) => client.synthesize(kana),
    connect: async () => ({ play: async () => {}, destroy: () => {} }),
    idleTimeoutMs: 0,
  });

  await assert.rejects(sessions.speak({ id: 'c1', guild: { id: 'g1' } }, 'テスト'));
});
