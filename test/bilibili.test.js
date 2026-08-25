import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBilibiliClient, stripHighlight, parseLiveTime, normalizeUrl } from '../src/bilibili.js';

// set-cookie 를 주는 홈페이지 + 검색 API 를 흉내내는 fetch.
function fakeApi(payloads = {}, { setCookie = ['buvid3=ABC123infoc; Path=/', 'other=1'] } = {}) {
  const calls = [];
  const fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    if (String(url).startsWith('https://www.bilibili.com/')) {
      return { ok: true, status: 200, headers: { getSetCookie: () => setCookie }, json: async () => ({}) };
    }
    const type = new URL(url).searchParams.get('search_type');
    return { ok: true, status: 200, json: async () => payloads[type] ?? { code: 0, data: { result: [] } } };
  };
  return { fetch, calls };
}

test('stripHighlight: 검색 하이라이트 태그와 엔티티를 벗긴다', () => {
  assert.equal(stripHighlight('<em class="keyword">Deadly</em> Trick &amp; friends'), 'Deadly Trick & friends');
});

test('parseLiveTime: 중국 표준시 문자열을 ISO 로, 0 은 null 로', () => {
  assert.equal(parseLiveTime('2026-08-25 21:00:00'), '2026-08-25T13:00:00.000Z');
  assert.equal(parseLiveTime('0'), null);
  assert.equal(parseLiveTime(0), null);
});

test('client: 첫 요청 전에 홈페이지에서 buvid3 쿠키를 받아 붙인다', async () => {
  const { fetch, calls } = fakeApi();
  await createBilibiliClient({ fetch }).searchVideos('Deadly Trick');

  assert.equal(calls[0].url, 'https://www.bilibili.com/');
  assert.equal(calls[1].opts.headers.Cookie, 'buvid3=ABC123infoc');
});

test('client: 쿠키를 주입하면 홈페이지를 건드리지 않는다', async () => {
  const { fetch, calls } = fakeApi();
  await createBilibiliClient({ fetch, cookie: 'SESSDATA=x' }).searchVideos('Deadly Trick');

  assert.equal(calls.length, 1);
  assert.equal(calls[0].opts.headers.Cookie, 'SESSDATA=x');
});

test('client: searchVideos 는 신규순으로 조회해 엔트리로 매핑한다', async () => {
  const { fetch, calls } = fakeApi({
    video: { code: 0, data: { result: [
      { bvid: 'BV1', mid: 42, author: 'UP주', title: '<em>Deadly Trick</em> 실황', pubdate: 1_756_000_000, play: 1234 },
    ] } },
  });

  const rows = await createBilibiliClient({ fetch }).searchVideos('Deadly Trick');

  const u = new URL(calls[1].url);
  assert.equal(u.searchParams.get('search_type'), 'video');
  assert.equal(u.searchParams.get('order'), 'pubdate');
  assert.deepEqual(rows, [{
    id: 'BV1',
    streamer: 'UP주',
    streamerId: '42',
    streamerUrl: 'https://space.bilibili.com/42',
    title: 'Deadly Trick 실황',
    url: 'https://www.bilibili.com/video/BV1',
    startedAt: new Date(1_756_000_000_000).toISOString(),
    views: 1234,
    live: false,
  }]);
});

test('client: searchLiveRooms 는 방송중 방을 live 엔트리로 준다', async () => {
  const { fetch } = fakeApi({
    live_room: { code: 0, data: { result: [
      { roomid: 777, uid: 9, uname: '主播', title: '<em>Deadly Trick</em>', online: 512, live_time: '2026-08-25 20:00:00' },
    ] } },
  });

  const rows = await createBilibiliClient({ fetch }).searchLiveRooms('Deadly Trick');

  assert.equal(rows[0].url, 'https://live.bilibili.com/777');
  assert.equal(rows[0].live, true);
  assert.equal(rows[0].views, 512);
  assert.equal(rows[0].startedAt, '2026-08-25T12:00:00.000Z');
});

test('client: search_type=live 형태의 { live_room: [] } 응답도 읽는다', async () => {
  const { fetch } = fakeApi({
    live_room: { code: 0, data: { result: { live_room: [{ roomid: 1, uname: 'a', title: 't' }] } } },
  });

  const rows = await createBilibiliClient({ fetch }).searchLiveRooms('x');
  assert.equal(rows.length, 1);
});

test('client: code!=0 이면 코드와 메시지를 담아 던진다 (-412 는 힌트 포함)', async () => {
  const { fetch } = fakeApi({ video: { code: -412, message: '请求被拦截' } });

  await assert.rejects(
    () => createBilibiliClient({ fetch }).searchVideos('x'),
    (e) => e.message.includes('-412') && e.message.includes('BILIBILI_COOKIE'),
  );
});

test('normalizeUrl: 프로토콜 없는 arcurl 도 링크로 만든다', () => {
  assert.equal(normalizeUrl('//www.bilibili.com/video/BV1'), 'https://www.bilibili.com/video/BV1');
  assert.equal(normalizeUrl('http://www.bilibili.com/video/BV1'), 'https://www.bilibili.com/video/BV1');
  assert.equal(normalizeUrl(''), null);
});
