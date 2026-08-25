import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  collect, formatReport, groupByStreamer, matchesText, withinWindow, DEFAULT_MATCH_TERMS,
} from '../src/find-streamers.js';

const NOW = Date.parse('2026-08-25T12:00:00Z');
const ago = (hours) => new Date(NOW - hours * 3_600_000).toISOString();

const entry = (over = {}) => ({
  streamer: 'A', title: 'Deadly Trick 방송', url: 'u', startedAt: ago(1), views: 10, live: false, ...over,
});

test('matchesText: 대소문자 무시, 빈 목록이면 필터 없음', () => {
  assert.equal(matchesText('오늘 DEADLY trick 함', ['Deadly Trick']), true);
  assert.equal(matchesText('다른 게임', ['Deadly Trick']), false);
  assert.equal(matchesText('아무거나', []), true);
});

test('withinWindow: 기간 안이면 통과, 밖이면 탈락', () => {
  const since = NOW - 3 * 86_400_000;
  assert.equal(withinWindow(entry({ startedAt: ago(70) }), since, NOW), true);
  assert.equal(withinWindow(entry({ startedAt: ago(80) }), since, NOW), false);
});

test('withinWindow: 방송중이면 시작시각을 몰라도 포함', () => {
  const since = NOW - 3 * 86_400_000;
  assert.equal(withinWindow(entry({ startedAt: null, live: true }), since, NOW), true);
  assert.equal(withinWindow(entry({ startedAt: null }), since, NOW), false);
});

test('withinWindow: 미래(예약분)는 제외', () => {
  const since = NOW - 3 * 86_400_000;
  assert.equal(withinWindow(entry({ startedAt: ago(-48) }), since, NOW), false);
});

test('groupByStreamer: 같은 사람의 여러 방송을 한 줄로 합친다', () => {
  const rows = groupByStreamer([
    { platform: 'Twitch', streamer: 'A', streamerId: '1', title: '옛날', url: 'old', startedAt: ago(40), views: 5 },
    { platform: 'Twitch', streamer: 'A', streamerId: '1', title: '최근', url: 'new', startedAt: ago(2), views: 80 },
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].streams, 2);
  assert.equal(rows[0].latestTitle, '최근');
  assert.equal(rows[0].latestUrl, 'new');
  assert.equal(rows[0].peakViews, 80);
});

test('groupByStreamer: 플랫폼이 다르면 같은 이름이라도 따로 센다', () => {
  const rows = groupByStreamer([
    { platform: 'Twitch', streamer: 'A', startedAt: ago(1) },
    { platform: 'YouTube', streamer: 'A', startedAt: ago(1) },
  ]);
  assert.equal(rows.length, 2);
});

test('groupByStreamer: 방송중이 먼저, 그다음 최신순', () => {
  const rows = groupByStreamer([
    { platform: 'P', streamer: '오래전', startedAt: ago(50) },
    { platform: 'P', streamer: '방금', startedAt: ago(1) },
    { platform: 'P', streamer: '켜짐', startedAt: ago(60), live: true },
  ]);
  assert.deepEqual(rows.map((r) => r.streamer), ['켜짐', '방금', '오래전']);
});

test('collect: 기간 밖 · 키워드 불일치 엔트리를 걸러낸다', async () => {
  const result = await collect([{
    platform: 'YouTube',
    run: async () => [
      entry({ streamer: '통과' }),
      entry({ streamer: '기간밖', startedAt: ago(100) }),
      entry({ streamer: '다른게임', title: '마인크래프트' }),
    ],
  }], { days: 3, now: NOW, matchTerms: DEFAULT_MATCH_TERMS });

  assert.deepEqual(result.entries.map((e) => e.streamer), ['통과']);
  assert.equal(result.streamers[0].platform, 'YouTube');
});

test('collect: filterByTerms:false 소스는 제목 필터를 건너뛴다 (카테고리 조회)', async () => {
  const result = await collect([{
    platform: 'Twitch',
    filterByTerms: false,
    run: async () => [entry({ streamer: '카테고리', title: '오늘도 추리방송' })],
  }], { days: 3, now: NOW });

  assert.equal(result.entries.length, 1);
});

test('collect: 한 플랫폼이 터져도 나머지는 살아남고 에러로 보고된다', async () => {
  const result = await collect([
    { platform: '비리비리', run: async () => { throw new Error('code -412'); } },
    { platform: '니코니코', run: async () => [entry({ streamer: 'N' })] },
    { platform: 'Twitch', skip: '키 없음' },
  ], { days: 3, now: NOW });

  assert.deepEqual(result.errors, [{ platform: '비리비리', message: 'code -412' }]);
  assert.deepEqual(result.skipped, [{ platform: 'Twitch', reason: '키 없음' }]);
  assert.deepEqual(result.streamers.map((s) => s.streamer), ['N']);
});

test('formatReport: 사람 수 · 방송중 표시 · 건너뜀/실패를 모두 담는다', async () => {
  const result = await collect([
    { platform: 'Twitch', filterByTerms: false, run: async () => [entry({ streamer: '아리스', live: true, views: 120 })] },
    { platform: '비리비리', run: async () => { throw new Error('code -412'); } },
    { platform: 'YouTube', skip: 'YOUTUBE_API_KEY 미설정' },
  ], { days: 3, now: NOW });

  const text = formatReport(result, { gameName: 'Deadly Trick' });

  assert.match(text, /최근 3일 방송자/);
  assert.match(text, /총 1명/);
  assert.match(text, /## Twitch — 1명/);
  assert.match(text, /아리스 — 🔴 방송중 · 120/);
  assert.match(text, /⏭  YouTube: YOUTUBE_API_KEY 미설정/);
  assert.match(text, /⚠️  비리비리 조회 실패: code -412/);
});

test('formatReport: 아무것도 없으면 그렇게 말한다', async () => {
  const result = await collect([{ platform: 'Twitch', run: async () => [] }], { days: 3, now: NOW });
  assert.match(formatReport(result), /해당 기간에 잡힌 방송이 없습니다/);
});
