import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeSightings, pruneSessions, sessionsToEntries, createStreamLog,
} from '../src/stream-log.js';

const T0 = Date.parse('2026-08-25T12:00:00Z');
const at = (min) => T0 + min * 60_000;
const iso = (min) => new Date(at(min)).toISOString();

const live = (over = {}) => ({
  streamer: '아리스', streamerId: '1', streamerUrl: 'https://twitch.tv/aris',
  title: '방송중', url: 'https://twitch.tv/aris', startedAt: '2026-08-25T11:00:00Z',
  views: 100, live: true, ...over,
});

// 파일 대신 메모리를 쓰는 fs — 저장 경로·원자적 rename 까지 그대로 검증한다.
function memFs(files = {}) {
  const calls = [];
  return {
    files, calls,
    async readFile(p) {
      calls.push(['readFile', p]);
      if (!(p in files)) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; }
      return files[p];
    },
    async writeFile(p, body) { calls.push(['writeFile', p]); files[p] = body; },
    async rename(a, b) { calls.push(['rename', a, b]); files[b] = files[a]; delete files[a]; },
    async mkdir(p) { calls.push(['mkdir', p]); },
  };
}

test('mergeSightings: 처음 본 방송은 세션으로 추가된다', () => {
  const s = mergeSightings([], 'Twitch', [live()], { now: at(0) });

  assert.equal(s.length, 1);
  assert.deepEqual(
    [s[0].streamer, s[0].sightings, s[0].peakViews, s[0].live, s[0].firstSeenAt, s[0].lastSeenAt],
    ['아리스', 1, 100, true, iso(0), iso(0)],
  );
});

test('mergeSightings: 같은 방송(같은 시작시각)은 줄이 늘지 않고 갱신만 된다', () => {
  let s = mergeSightings([], 'Twitch', [live()], { now: at(0) });
  s = mergeSightings(s, 'Twitch', [live({ views: 250, title: '제목 바뀜' })], { now: at(1) });

  assert.equal(s.length, 1, '1분마다 적어도 방송 1회는 1줄');
  assert.equal(s[0].sightings, 2);
  assert.equal(s[0].peakViews, 250);
  assert.equal(s[0].title, '제목 바뀜');
  assert.equal(s[0].lastSeenAt, iso(1));
  assert.equal(s[0].firstSeenAt, iso(0), '처음 본 시각은 그대로');
});

test('mergeSightings: 껐다 켜서 시작시각이 바뀌면 새 방송', () => {
  let s = mergeSightings([], 'Twitch', [live()], { now: at(0) });
  s = mergeSightings(s, 'Twitch', [live({ startedAt: '2026-08-25T13:00:00Z' })], { now: at(70) });

  assert.equal(s.length, 2);
});

test('mergeSightings: 시작시각을 안 주는 플랫폼은 공백으로 방송을 가른다', () => {
  const noStart = (over) => live({ startedAt: null, streamerId: '9', ...over });
  const opts = { gapMs: 30 * 60_000 };

  let s = mergeSightings([], '니코니코', [noStart()], { now: at(0), ...opts });
  s = mergeSightings(s, '니코니코', [noStart()], { now: at(10), ...opts });   // 10분 뒤 → 같은 방송
  assert.equal(s.length, 1);
  assert.equal(s[0].sightings, 2);

  s = mergeSightings(s, '니코니코', [noStart()], { now: at(100), ...opts });  // 90분 뒤 → 새 방송
  assert.equal(s.length, 2);
});

test('mergeSightings: 다시보기·투고 영상은 URL로 구분해 중복되지 않는다', () => {
  const vod = (url) => live({ live: false, startedAt: null, url, title: '다시보기' });
  let s = mergeSightings([], '비리비리', [vod('u1'), vod('u2')], { now: at(0) });
  s = mergeSightings(s, '비리비리', [vod('u1')], { now: at(60) });

  assert.equal(s.length, 2);
  assert.equal(s.find((x) => x.url === 'u1').sightings, 2);
});

test('mergeSightings: 누군지 못 알아본 항목은 버린다', () => {
  const s = mergeSightings([], 'Twitch', [live({ streamer: '', streamerId: '' })], { now: at(0) });
  assert.deepEqual(s, []);
});

test('mergeSightings: 다른 플랫폼의 동명이인은 따로 센다', () => {
  let s = mergeSightings([], 'Twitch', [live({ streamerId: 'x' })], { now: at(0) });
  s = mergeSightings(s, '비리비리', [live({ streamerId: 'x' })], { now: at(0) });
  assert.equal(s.length, 2);
});

test('pruneSessions: 마지막 목격이 기준보다 오래된 세션은 버린다', () => {
  const s = [
    { lastSeenAt: iso(0) },
    { lastSeenAt: new Date(at(0) - 20 * 86_400_000).toISOString() },
    { lastSeenAt: '망가진 값' },
  ];
  assert.deepEqual(pruneSessions(s, at(0) - 14 * 86_400_000).length, 1);
});

test('sessionsToEntries: 최근에 본 것만 "방송중"으로 넘긴다', () => {
  const sessions = mergeSightings([], 'Twitch', [live()], { now: at(0) });
  const fresh = sessionsToEntries(sessions, { now: at(1) })[0];
  const stale = sessionsToEntries(sessions, { now: at(120) })[0];

  assert.equal(fresh.live, true);
  assert.equal(stale.live, false, '2시간 전 목격은 지금 켜져 있다는 뜻이 아니다');
  assert.equal(stale.startedAt, '2026-08-25T11:00:00Z');
  assert.equal(stale.views, 100);
});

test('sessionsToEntries: 시작시각이 없으면 처음 본 시각을 쓴다', () => {
  const sessions = mergeSightings([], '니코니코', [live({ startedAt: null })], { now: at(0) });
  assert.equal(sessionsToEntries(sessions, { now: at(0) })[0].startedAt, iso(0));
});

test('log: record 는 tmp 에 쓰고 rename 으로 갈아끼운다', async () => {
  const fs = memFs();
  const log = createStreamLog({ path: 'data/streams.json', fs, now: () => at(0) });

  const added = await log.record('Twitch', [live()]);

  assert.equal(added, 1);
  assert.deepEqual(fs.calls.filter((c) => c[0] !== 'readFile'), [
    ['mkdir', 'data'],
    ['writeFile', 'data/streams.json.tmp'],
    ['rename', 'data/streams.json.tmp', 'data/streams.json'],
  ]);
  assert.equal(JSON.parse(fs.files['data/streams.json']).sessions.length, 1);
});

test('log: 저장된 기록을 다시 읽어 이어 붙인다', async () => {
  const fs = memFs();
  const first = createStreamLog({ path: 'p.json', fs, now: () => at(0) });
  await first.record('Twitch', [live()]);

  const second = createStreamLog({ path: 'p.json', fs, now: () => at(5) });
  await second.record('Twitch', [live({ views: 500 })]);

  const sessions = await second.sessions();
  assert.equal(sessions.length, 1, '재시작해도 같은 방송으로 이어진다');
  assert.equal(sessions[0].peakViews, 500);
});

test('log: 오래된 세션은 저장할 때 정리된다', async () => {
  const fs = memFs();
  const log = createStreamLog({ path: 'p.json', fs, retentionDays: 3, now: () => at(0) });
  await log.record('Twitch', [live()]);

  const later = createStreamLog({ path: 'p.json', fs, retentionDays: 3, now: () => at(10 * 24 * 60) });
  await later.record('Twitch', []);

  assert.deepEqual(await later.sessions(), []);
});

test('log: 파일이 없으면 빈 기록으로 시작한다', async () => {
  const log = createStreamLog({ path: 'nope.json', fs: memFs() });
  assert.deepEqual(await log.sessions(), []);
});

test('log: 깨진 파일은 옆으로 치우고 계속 기록한다', async () => {
  const fs = memFs({ 'p.json': '{절반만 쓰다 죽음' });
  const warnings = [];
  const log = createStreamLog({ path: 'p.json', fs, now: () => at(0), warn: (m) => warnings.push(m) });

  await log.record('Twitch', [live()]);

  assert.match(warnings[0], /새로 시작/);
  assert.ok(Object.keys(fs.files).some((f) => f.startsWith('p.json.corrupt-')));
  assert.equal(JSON.parse(fs.files['p.json']).sessions.length, 1);
});

test('log: entriesSince 는 기간 밖 기록을 빼고 준다', async () => {
  const fs = memFs();
  const log = createStreamLog({ path: 'p.json', fs, now: () => at(0) });
  await log.record('Twitch', [live({ startedAt: '2026-08-25T11:00:00Z' })]);
  await log.record('Twitch', [live({ streamerId: '2', startedAt: '2026-08-01T11:00:00Z', live: false })]);

  const recent = await log.entriesSince(at(0) - 3 * 86_400_000);
  assert.deepEqual(recent.map((e) => e.streamerId), ['1']);
});
