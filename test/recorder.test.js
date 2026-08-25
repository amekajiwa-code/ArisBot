import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRecorder, startRecorder } from '../src/recorder.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// record() 호출을 받아적는 가짜 기록 저장소.
function fakeLog({ failOn = null } = {}) {
  const written = [];
  return {
    written,
    async record(platform, entries) {
      if (platform === failOn) throw new Error('disk full');
      written.push([platform, entries]);
      return entries.length;
    },
  };
}

test('recorder: 소스가 준 목록을 그대로 기록한다', async () => {
  const log = fakeLog();
  const recorder = createRecorder({ log });

  const ok = await recorder.tick({ platform: 'Twitch', run: async () => [{ streamer: 'A' }] });

  assert.equal(ok, true);
  assert.deepEqual(log.written, [['Twitch', [{ streamer: 'A' }]]]);
});

test('recorder: 소스가 실패해도 죽지 않고 실패를 알린다', async () => {
  const errors = [];
  const recorder = createRecorder({ log: fakeLog(), onError: (m) => errors.push(m) });

  const ok = await recorder.tick({ platform: '비리비리', run: async () => { throw new Error('code -412'); } });

  assert.equal(ok, false);
  assert.match(errors[0], /\[record:비리비리\] code -412/);
});

test('recorder: 저장이 실패해도 다음 주기를 막지 않는다', async () => {
  const errors = [];
  const recorder = createRecorder({ log: fakeLog({ failOn: 'Twitch' }), onError: (m) => errors.push(m) });

  assert.equal(await recorder.tick({ platform: 'Twitch', run: async () => [] }), false);
  assert.match(errors[0], /disk full/);
});

test('recorder: hook 은 워처가 이미 받아온 목록을 변환해 기록한다 (추가 요청 없음)', async () => {
  const log = fakeLog();
  const recorder = createRecorder({ log });

  const hook = recorder.hook('YouTube', (l) => ({ streamer: l.channelName, live: true }));
  await hook([{ channelName: '아리스' }]);
  await hook(null);                                   // 조회 실패(null)는 조용히 무시

  assert.deepEqual(log.written, [['YouTube', [{ streamer: '아리스', live: true }]]]);
});

test('startRecorder: 즉시 한 번 돌고 주기마다 반복한다', async () => {
  const log = fakeLog();
  let runs = 0;
  const { stop } = startRecorder({
    sources: [{ platform: 'Twitch', run: async () => { runs++; return []; } }],
    log,
    intervalMs: 20,
  });

  assert.equal(runs, 1, '기동 즉시 1회');
  await sleep(70);
  stop();
  assert.ok(runs >= 3, `주기마다 반복 (runs=${runs})`);

  const after = runs;
  await sleep(50);
  assert.equal(runs, after, 'stop 이후엔 안 돈다');
});

test('startRecorder: 한 주기가 밀리면 같은 소스를 겹쳐 돌리지 않는다', async () => {
  let started = 0;
  const { stop } = startRecorder({
    sources: [{ platform: '느림', run: () => { started++; return new Promise(() => {}); } }],  // 영원히 안 끝남
    log: fakeLog(),
    intervalMs: 10,
  });

  await sleep(60);
  stop();
  assert.equal(started, 1, '앞 요청이 안 끝났으면 다음 주기는 건너뛴다');
});

test('startRecorder: 자격증명이 없어 건너뛴 소스는 폴링하지 않는다', async () => {
  const log = fakeLog();
  const { stop } = startRecorder({
    sources: [{ platform: 'Twitch', skip: '키 없음' }],
    log,
    intervalMs: 10,
  });
  await sleep(30);
  stop();
  assert.deepEqual(log.written, []);
});
