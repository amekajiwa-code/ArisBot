import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createNiconicoClient, extractEmbeddedData, collectPrograms, decodeHtml, toIso,
} from '../src/niconico.js';

const embedded = (obj) =>
  `<html><script id="embedded-data" data-props="${JSON.stringify(obj).replace(/"/g, '&quot;')}"></script></html>`;

function fakeApi({ snapshot = { meta: { status: 200 }, data: [] }, html = embedded({}), user = {} } = {}) {
  const calls = [];
  const fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    const u = String(url);
    if (u.includes('snapshot.search')) return { ok: true, status: 200, json: async () => snapshot };
    if (u.includes('nvapi')) return { ok: true, status: 200, json: async () => user };
    return { ok: true, status: 200, text: async () => html };
  };
  return { fetch, calls };
}

test('decodeHtml/toIso: 속성 디코드와 시각 정규화', () => {
  assert.equal(decodeHtml('&quot;a&quot; &amp; b'), '"a" & b');
  assert.equal(toIso(1_756_000_000), new Date(1_756_000_000_000).toISOString());
  assert.equal(toIso(1_756_000_000_000), new Date(1_756_000_000_000).toISOString());
  assert.equal(toIso('2026-08-25T12:00:00+09:00'), '2026-08-25T03:00:00.000Z');
  assert.equal(toIso(null), null);
  assert.equal(toIso('나중에'), null);
});

test('extractEmbeddedData: data-props JSON 을 뽑고, 없으면 null', () => {
  assert.deepEqual(extractEmbeddedData(embedded({ a: 1 })), { a: 1 });
  assert.equal(extractEmbeddedData('<html>no props</html>'), null);
});

test('collectPrograms: 깊이에 상관없이 lv 프로그램을 모은다', () => {
  const page = { view: { results: { items: [
    { id: 'lv123', title: '방송1', programProvider: { id: '55', name: '방송자' }, beginAt: 1_756_000_000, statistics: { viewers: 30 }, status: 'ON_AIR' },
    { id: 'sm999', title: '영상이라 제외' },
  ] } }, other: { deep: { nested: [{ id: 'lv456', title: '방송2' }] } } };

  const found = [...collectPrograms(page).values()];

  assert.deepEqual(found.map((p) => p.id), ['lv123', 'lv456']);
  assert.equal(found[0].streamer, '방송자');
  assert.equal(found[0].url, 'https://live.nicovideo.jp/watch/lv123');
  assert.equal(found[0].views, 30);
  assert.equal(found[0].live, true);
  assert.equal(found[1].live, false);
});

test('client: searchVideos 는 기간 필터를 오프셋 포함 ISO 로 보낸다', async () => {
  const { fetch, calls } = fakeApi();
  const since = Date.parse('2026-08-22T00:00:00Z');

  await createNiconicoClient({ fetch }).searchVideos('Deadly Trick', { since });

  const u = new URL(calls[0].url);
  assert.equal(u.searchParams.get('q'), 'Deadly Trick');
  assert.equal(u.searchParams.get('targets'), 'title,description,tags');
  assert.equal(u.searchParams.get('_sort'), '-startTime');
  assert.equal(u.searchParams.get('filters[startTime][gte]'), '2026-08-22T00:00:00.000+00:00');
  assert.match(calls[0].opts.headers['User-Agent'], /ArisBot/);
});

test('client: searchVideos 는 투고자 닉네임을 채워 매핑한다', async () => {
  const { fetch } = fakeApi({
    snapshot: { meta: { status: 200 }, data: [
      { contentId: 'sm1', title: 'Deadly Trick 実況', userId: 7, startTime: '2026-08-24T10:00:00+09:00', viewCounter: 900 },
    ] },
    user: { data: { user: { nickname: '실황자' } } },
  });

  const rows = await createNiconicoClient({ fetch }).searchVideos('Deadly Trick');

  assert.deepEqual(rows, [{
    id: 'sm1',
    streamer: '실황자',
    streamerId: '7',
    streamerUrl: 'https://www.nicovideo.jp/user/7',
    title: 'Deadly Trick 実況',
    url: 'https://www.nicovideo.jp/watch/sm1',
    startedAt: '2026-08-24T01:00:00.000Z',
    views: 900,
    live: false,
  }]);
});

test('client: 닉네임 조회가 실패해도 id 로 대체해 계속 간다', async () => {
  const calls = [];
  const fetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes('nvapi')) return { ok: false, status: 403, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ meta: { status: 200 }, data: [
      { contentId: 'sm1', title: 't', userId: 7, startTime: '2026-08-24T10:00:00+09:00', viewCounter: 1 },
    ] }) };
  };

  const rows = await createNiconicoClient({ fetch }).searchVideos('x');
  assert.equal(rows[0].streamer, 'user/7');
});

test('client: 스냅샷 API 가 200 이 아니면 던진다', async () => {
  const { fetch } = fakeApi({ snapshot: { meta: { status: 400, errorMessage: 'QUERY_PARSE_ERROR' } } });

  await assert.rejects(
    () => createNiconicoClient({ fetch }).searchVideos('x'),
    /niconico snapshot status 400/,
  );
});

test('client: searchLives(onair) 는 검색 페이지를 파싱해 방송중으로 표시한다', async () => {
  const { fetch, calls } = fakeApi({
    html: embedded({ programs: [{ id: 'lv1', title: '生放送', programProvider: { id: '3', name: '放送者' } }] }),
  });

  const rows = await createNiconicoClient({ fetch }).searchLives('Deadly Trick', { status: 'onair' });

  assert.equal(new URL(calls[0].url).searchParams.get('status'), 'onair');
  assert.equal(rows[0].live, true);
  assert.equal(rows[0].streamer, '放送者');
  assert.equal(rows[0].streamerUrl, 'https://www.nicovideo.jp/user/3');
});

test('client: 검색 페이지 구조가 낯설면 빈 배열(에러 아님)', async () => {
  const { fetch } = fakeApi({ html: '<html>redesigned</html>' });
  assert.deepEqual(await createNiconicoClient({ fetch }).searchLives('x'), []);
});
