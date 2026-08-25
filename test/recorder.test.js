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

// ── 알림 훅: 기록기가 훑은 결과를 그대로 워처에 넘긴다(추가 요청 없이 알림)
test('recorder: onSightings 로 폴링 결과를 해당 플랫폼 워처에 넘긴다', async () => {
  const pushed = [];
  const recorder = createRecorder({
    log: fakeLog(),
    onSightings: { 비리비리: async (found) => pushed.push(found) },
  });

  await recorder.tick({ platform: '비리비리', run: async () => [{ streamer: 'A' }] });
  await recorder.tick({ platform: '니코니코', run: async () => [{ streamer: 'B' }] });  // 훅 없음 → 무시

  assert.deepEqual(pushed, [[{ streamer: 'A' }]]);
});

test('recorder: 기록이 실패해도 알림은 나간다', async () => {
  const pushed = [];
  const errors = [];
  const recorder = createRecorder({
    log: fakeLog({ failOn: '비리비리' }),
    onError: (m) => errors.push(m),
    onSightings: { 비리비리: async (found) => pushed.push(found) },
  });

  const ok = await recorder.tick({ platform: '비리비리', run: async () => [{ streamer: 'A' }] });

  assert.equal(ok, false);
  assert.equal(pushed.length, 1, '디스크가 차도 알림은 가야 한다');
  assert.match(errors[0], /disk full/);
});

test('recorder: 알림이 실패해도 기록은 남고 다음 주기를 막지 않는다', async () => {
  const log = fakeLog();
  const errors = [];
  const recorder = createRecorder({
    log,
    onError: (m) => errors.push(m),
    onSightings: { 비리비리: async () => { throw new Error('discord 500'); } },
  });

  const ok = await recorder.tick({ platform: '비리비리', run: async () => [{ streamer: 'A' }] });

  assert.equal(ok, false);
  assert.equal(log.written.length, 1);
  assert.match(errors[0], /\[alert:비리비리\] discord 500/);
});

test('recorder: 조회가 실패하면 기록도 알림도 없다', async () => {
  const log = fakeLog();
  const pushed = [];
  const recorder = createRecorder({
    log,
    onError: () => {},
    onSightings: { 비리비리: async (f) => pushed.push(f) },
  });

  await recorder.tick({ platform: '비리비리', run: async () => { throw new Error('HTTP 403'); } });

  assert.deepEqual(log.written, []);
  assert.deepEqual(pushed, []);
});

// ── 통합: 폴링 한 바퀴 → 알림
test('통합: 기록기 폴링만으로 새 방송 알림이 나간다 (자체 폴링 없음)', async () => {
  const { createLiveWatcher } = await import('../src/live-watch.js');
  const sent = [];
  const watcher = createLiveWatcher({
    send: async (p) => sent.push(p),
    categoryName: 'Deadly Trick',
    minViewers: 50,
    platform: '니코니코',
    matchTerms: [],
  });

  let lives = [{ id: 'lv1', streamer: '放送者', title: 't', url: 'u', views: 100, live: true }];
  const recorder = createRecorder({
    log: fakeLog(),
    onSightings: { 니코니코: (found) => watcher.push(found) },
  });
  const source = { platform: '니코니코', run: async () => lives };

  await recorder.tick(source);                       // 기준선
  assert.deepEqual(sent, []);

  lives = [...lives, { id: 'lv2', streamer: '新人', title: 't2', url: 'u2', views: 80, live: true }];
  await recorder.tick(source);                       // 새 방송 등장

  assert.deepEqual(sent.map((p) => p.embeds[0].title), ['니코니코에서 新人님이 Deadly Trick 방송중!']);
});
