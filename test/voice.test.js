import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSpeechQueue, createVoiceSessions } from '../src/voice.js';

const tick = () => new Promise((r) => setImmediate(r));
const deferred = () => {
  let resolve; let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

test('큐: 합성한 결과를 재생한다', async () => {
  const played = [];
  const q = createSpeechQueue({
    synthesize: async (t) => `pcm:${t}`,
    play: async (pcm) => { played.push(pcm); },
  });
  await q.push('안녕');
  assert.deepEqual(played, ['pcm:안녕']);
});

test('큐: 여러 요청을 순서대로 하나씩 처리한다', async () => {
  const order = [];
  const gate = deferred();
  const q = createSpeechQueue({
    synthesize: async (t) => t,
    play: async (t) => { order.push(`start:${t}`); if (t === 'A') await gate.promise; order.push(`end:${t}`); },
  });

  const a = q.push('A');
  const b = q.push('B');
  await tick();
  // A가 아직 재생 중이므로 B는 시작조차 하지 않았다.
  assert.deepEqual(order, ['start:A']);
  assert.equal(q.size, 1);

  gate.resolve();
  await Promise.all([a, b]);
  assert.deepEqual(order, ['start:A', 'end:A', 'start:B', 'end:B']);
});

test('큐: 한 건이 실패해도 그 요청자만 알고 뒤는 계속 처리된다', async () => {
  const played = [];
  const q = createSpeechQueue({
    synthesize: async (t) => { if (t === '터짐') throw new Error('합성 실패'); return t; },
    play: async (t) => { played.push(t); },
  });

  const failing = q.push('터짐');
  const ok = q.push('멀쩡');
  await assert.rejects(failing, /합성 실패/);
  await ok;
  assert.deepEqual(played, ['멀쩡']);
});

test('큐: 재생 실패도 요청자에게 전달된다', async () => {
  const q = createSpeechQueue({
    synthesize: async (t) => t,
    play: async () => { throw new Error('연결 끊김'); },
  });
  await assert.rejects(q.push('안녕'), /연결 끊김/);
});

test('큐: 비는 순간 onDrain이 한 번 불린다', async () => {
  let drains = 0;
  const q = createSpeechQueue({
    synthesize: async (t) => t,
    play: async () => {},
    onDrain: () => { drains += 1; },
  });
  await Promise.all([q.push('A'), q.push('B'), q.push('C')]);
  assert.equal(drains, 1); // 세 건을 한 번의 drain으로 처리했다
});

test('큐: clear는 대기 중인 요청만 취소한다', async () => {
  const gate = deferred();
  const q = createSpeechQueue({
    synthesize: async (t) => t,
    play: async (t) => { if (t === 'A') await gate.promise; },
  });

  const a = q.push('A');
  const b = q.push('B');
  await tick();
  q.clear('나감');

  await assert.rejects(b, /나감/);
  gate.resolve();
  await a; // 이미 재생 중이던 건은 끝까지 간다
});

// ---- 세션 ----

/** 가짜 음성 채널. guild.id로 세션이 갈린다. */
const channel = (guildId, channelId) => ({ id: channelId, guild: { id: guildId } });

/** connect() 스텁. 접속·재생·파괴 이력을 남긴다. */
function stubBackend() {
  const log = [];
  const connect = async (ch) => {
    log.push(`connect:${ch.guild.id}/${ch.id}`);
    return {
      play: async (pcm) => { log.push(`play:${ch.id}:${pcm}`); },
      destroy: () => { log.push(`destroy:${ch.id}`); },
    };
  };
  return { connect, log };
}

const sessionsWith = (backend, extra = {}) => createVoiceSessions({
  synthesize: async (t) => t,
  connect: backend.connect,
  idleTimeoutMs: 0,
  ...extra,
});

test('세션: 처음 말할 때 접속하고, 두 번째부터는 재접속하지 않는다', async () => {
  const backend = stubBackend();
  const sessions = sessionsWith(backend);

  await sessions.speak(channel('g1', 'c1'), '안녕');
  await sessions.speak(channel('g1', 'c1'), '또 안녕');

  assert.deepEqual(backend.log, ['connect:g1/c1', 'play:c1:안녕', 'play:c1:또 안녕']);
});

test('세션: 접속 중에 들어온 요청이 접속을 두 번 만들지 않는다', async () => {
  const backend = stubBackend();
  const sessions = sessionsWith(backend);

  await Promise.all([
    sessions.speak(channel('g1', 'c1'), 'A'),
    sessions.speak(channel('g1', 'c1'), 'B'),
  ]);

  assert.equal(backend.log.filter((l) => l.startsWith('connect')).length, 1);
});

test('세션: 길드마다 따로 접속한다', async () => {
  const backend = stubBackend();
  const sessions = sessionsWith(backend);

  await sessions.speak(channel('g1', 'c1'), 'A');
  await sessions.speak(channel('g2', 'c2'), 'B');

  assert.equal(sessions.channelOf('g1'), 'c1');
  assert.equal(sessions.channelOf('g2'), 'c2');
  assert.equal(backend.log.filter((l) => l.startsWith('connect')).length, 2);
});

test('세션: 같은 길드의 다른 채널에서 부르면 옮겨 간다', async () => {
  const backend = stubBackend();
  const sessions = sessionsWith(backend);

  await sessions.speak(channel('g1', 'c1'), 'A');
  await sessions.speak(channel('g1', 'c2'), 'B');

  assert.deepEqual(backend.log, [
    'connect:g1/c1', 'play:c1:A', 'destroy:c1', 'connect:g1/c2', 'play:c2:B',
  ]);
  assert.equal(sessions.channelOf('g1'), 'c2');
});

test('세션: leave는 접속을 끊고, 들어가 있었는지를 알려준다', async () => {
  const backend = stubBackend();
  const sessions = sessionsWith(backend);

  assert.equal(sessions.leave('g1'), false);
  await sessions.speak(channel('g1', 'c1'), 'A');
  assert.equal(sessions.leave('g1'), true);
  assert.equal(sessions.channelOf('g1'), null);
  assert.ok(backend.log.includes('destroy:c1'));
});

test('세션: 접속에 실패하면 speak가 실패하고 세션이 남지 않는다', async () => {
  const sessions = createVoiceSessions({
    synthesize: async (t) => t,
    connect: async () => { throw new Error('접속 거부'); },
    idleTimeoutMs: 0,
  });

  await assert.rejects(sessions.speak(channel('g1', 'c1'), 'A'), /접속 거부/);
  assert.equal(sessions.channelOf('g1'), null);
  // 실패가 눌어붙지 않고 다음 시도가 가능해야 한다.
  await assert.rejects(sessions.speak(channel('g1', 'c1'), 'B'), /접속 거부/);
});

test('세션: 조용해지면 유휴 시간 뒤에 스스로 나간다', async () => {
  const backend = stubBackend();
  let fire = null;
  const sessions = sessionsWith(backend, {
    idleTimeoutMs: 1000,
    timers: { setTimeout: (fn) => { fire = fn; return 1; }, clearTimeout: () => {} },
  });

  await sessions.speak(channel('g1', 'c1'), 'A');
  assert.equal(sessions.channelOf('g1'), 'c1');

  fire();
  assert.equal(sessions.channelOf('g1'), null);
  assert.ok(backend.log.includes('destroy:c1'));
});

test('세션: destroyAll은 모든 길드에서 나간다', async () => {
  const backend = stubBackend();
  const sessions = sessionsWith(backend);

  await sessions.speak(channel('g1', 'c1'), 'A');
  await sessions.speak(channel('g2', 'c2'), 'B');
  sessions.destroyAll();

  assert.equal(sessions.channelOf('g1'), null);
  assert.equal(sessions.channelOf('g2'), null);
  assert.ok(backend.log.includes('destroy:c1'));
  assert.ok(backend.log.includes('destroy:c2'));
});
