# Holodex VTuber 라이브 알림 (Holodex YouTube Live Alert)

작성일: 2026-07-09

## 목적

홀로라이브·니지산지 등 VTuber는 대부분 **YouTube**에서 방송하지만, YouTube Data API는
게임별 라이브 검색이 사실상 불가능하고 쿼터도 가혹하다. 대신 VTuber 라이브를 게임 태그와
함께 집계해 주는 서드파티 **Holodex API**를 사용해, 누군가 **Deadly Trick을 생중계 중이고
시청자수가 100명 이상**이면 지정 Discord 채널로 임베드 알림을 보낸다.

Twitch·치지직 워처와 동일한 "폴링 → 카테고리 필터 → 신규 방송만 1회 알림" 패턴의 4번째
소스로 추가한다.

## 결정 사항 (확정)

| 항목 | 결정 |
|------|------|
| 데이터 출처 | **Holodex API v2** (서드파티). YouTube 공식 API는 게임 카테고리 라이브 검색 불가 + `search.list` 100유닛/호출·10k/일 쿼터로 부적합. |
| 게임 매칭 | **Holodex `topic` 서버필터만.** 제목 키워드 매칭은 안 함(오탐·복잡도). 태그 누락 방송은 놓침 — 치지직 소규모 카테고리 한계와 동일하게 감수. |
| 시청자 하한 | **`live_viewers >= 100`** (기본값, `.env`로 조정). |
| 알림 형식 | Discord **임베드**. 제목=`YouTube에서 {채널명}님이 {카테고리명} 방송중!`, 본문=방송제목 + YouTube 링크. |
| 중복제거 | 방송 영상 `id` 기준. 방송 중엔 재알림 없음, 껐다 켜면(새 영상 id) 재알림. |
| 알림 채널 | `HOLODEX_ALERT_CHANNEL_ID`, 없으면 `STEAM_ALERT_CHANNEL_ID`로 폴백(Twitch·치지직과 동일). |
| 활성화 조건 | `HOLODEX_API_KEY` + 알림 채널이 모두 있을 때만. |
| 폴링 주기 | 기본 600초(10분). `.env`로 조정. |
| 상태 영속화 | 안 함(메모리). 재시작 시 baseline 재설정. |

### 확인된 API 사실 (2026-07-09)

- 엔드포인트: `GET https://holodex.net/api/v2/live?status=live&type=stream&topic=<topicId>`
- 인증: `X-APIKEY` 헤더 (holodex.net 무료 계정에서 발급).
- 응답 영상 객체 필드: `id`(영상), `title`, `topic_id`(게임), `channel.name`(채널명), `live_viewers`(현재 시청자수).
- 서버측 `topic` 필터 제공 → 치지직처럼 여러 페이지를 훑을 필요 없음(폴링당 요청 1회).

### 미확정 실무 항목

- **`HOLODEX_TOPIC_ID`의 실제 값**: Deadly Trick의 Holodex topic id는 무료 API 키 발급 후
  실제 조회로 확정해야 한다. 스펙 기본값 `deadly_trick`은 추정치이며, 키 확보 후 맞춘다.

## 동작 개요

1. 봇 기동 시 `HOLODEX_API_KEY`와 알림 채널이 모두 설정돼 있을 때만 워처 시작
   (Twitch·치지직 활성화 패턴과 동일).
2. `HOLODEX_POLL_INTERVAL_SEC`마다 Holodex `/live`를 `topic` 필터로 폴링 → 현재 라이브 목록 획득.
3. **첫 성공 조회는 baseline(현재 라이브 영상 id 집합)만 잡고 알림은 보내지 않는다**
   (재시작 시 이미 켜져 있던 방송을 재알림하지 않기 위함).
4. 이후 매 폴링마다: `live_viewers >= minViewers` 이면서 직전 틱 baseline에 없던 영상 id →
   **알림 전송**. 그 후 baseline을 현재(자격 충족·라이브) 영상 id 집합으로 갱신.
5. 조회 실패(네트워크/비200/예외) 시 그 사이클은 건너뜀(baseline 유지). 폴링은 계속.

## 구성 요소

기존 `chzzk.js` / `chzzk-watch.js`를 대칭 미러링한다. 판단·표현 로직은 순수 함수로 분리해
단위 테스트한다.

### `src/holodex.js` — 데이터 조회
```
createHolodexClient({ apiKey, fetch = globalThis.fetch }) -> { fetchCategoryLives }
fetchCategoryLives(topicId) -> Promise<Array<{ videoId, channelName, title, liveViewers, topicId }>>
```
- `GET https://holodex.net/api/v2/live?status=live&type=stream&topic=<topicId>`,
  헤더 `X-APIKEY: <apiKey>`.
- 응답 배열을 compact 객체로 매핑: `id→videoId`, `channel.name→channelName`, `title`,
  `live_viewers→liveViewers`(누락 시 0), `topic_id→topicId`.
- 비200이면 `throw new Error("holodex live HTTP <status>")`. `fetch` 주입으로 테스트 가능.

### `src/holodex-watch.js` — 판단 + 표현 + 루프
```
newStreamers(known, lives, minViewers = 0) -> Array   // 순수
```
- `known == null` → `[]` (baseline 미시딩). 아니면 `liveViewers >= minViewers && !known.has(videoId)` 필터.

```
buildAlert(live, categoryName, platform) -> { embeds: [embed] }   // 순수
```
- `url = https://youtu.be/<videoId>`.
- `{ title: "<platform>에서 <channelName>님이 <categoryName> 방송중!", url,
    description: [live.title?, url].filter(Boolean).join("\n"), color: 0xFF0000 }` (YouTube 레드).

```
createHolodexWatcher({ fetchLives, send, categoryName, minViewers = 0, platform = "YouTube" }) -> { tick, known }
startHolodexWatch({ ...같은 deps, intervalMs }) -> { stop() }
```
- `tick()`: `fetchLives()` → null이면 skip → 첫 조회면 baseline만(자격 충족 영상 id 집합) →
  아니면 `newStreamers(...)` 각각 `send(buildAlert(...))` → baseline 갱신.
- discord 의존성은 워처 밖(`index.js`)에 둔다. `fetchLives`는 `index.js`에서 try/catch로 감싸 실패 시 null 반환.

### `src/config.js` — 설정 추가
| env | 기본값 | 설명 |
|-----|--------|------|
| `HOLODEX_API_KEY` | (없음) | 없으면 기능 비활성화 |
| `HOLODEX_ALERT_CHANNEL_ID` | `STEAM_ALERT_CHANNEL_ID`로 폴백 | 알림 채널 |
| `HOLODEX_TOPIC_ID` | `deadly_trick` | Holodex 게임 태그 id (키 발급 후 실제값 확인) |
| `HOLODEX_CATEGORY_NAME` | `Deadly Trick` | 알림에 표시할 이름 |
| `HOLODEX_POLL_INTERVAL_SEC` | `600` | 폴링 주기(초) |
| `HOLODEX_ALERT_MIN_VIEWERS` | `100` | 이 시청자수 이상만 알림 |

### `src/index.js` — 배선
치지직 블록 대칭. `if (config.holodexApiKey && config.holodexAlertChannelId)`일 때:
`createHolodexClient` 생성 → `startHolodexWatch` 기동(platform `"YouTube"`) → 시작 로그 출력.
`send`는 `makeSender(c, config.holodexAlertChannelId, "holodex")`.

### 문서 — `.env` / `.env.example` / `README.md`
위 6개 env 항목 + 의미 주석 추가. README 설정 표에 Holodex 행 추가.

## 알림 메시지 (임베드)

```
YouTube에서 {채널명}님이 Deadly Trick 방송중!   ← 제목 (YouTube 링크)
{방송 제목}
https://youtu.be/{videoId}                      ← 본문
```

## 에러 처리

- 조회 실패(네트워크/비200/예외): `index.js`에서 catch → `console.error` + null 반환 → 워처는 그 사이클 skip(baseline 유지).
- 채널 해석/전송 실패: `makeSender`가 로그만 남기고 삼킴, 다음 주기 계속.

## 테스트 (`node --test`)

- `newStreamers`: baseline 미시딩(`known=null`)→[], `minViewers` 미만 제외, 이미 아는 영상 제외, 신규만 반환.
- `buildAlert`: 임베드 제목 문구/url/description(제목 있음·없음)/color.
- `fetchCategoryLives`: 올바른 URL·헤더·쿼리(`topic`,`status=live`,`type=stream`), 필드 매핑, `live_viewers` 누락→0, 비200→throw.
- `createHolodexWatcher`: 첫 틱 baseline만(무알림) → 신규 방송 1회 알림 → 지속 라이브 재알림 안 함 →
  껐다 켜짐(새 영상 id) 재알림 → `minViewers` 미만 무시 → null skip(baseline 유지).

## 비범위 (Out of scope, v1)

- 제목 키워드 매칭 보강(EN/JP) — topic 필터만 사용.
- org(홀로라이브/니지산지)별 구분 필터 — 게임 기준으로만 잡음.
- 상태 파일 영속화.
- Holodex 라이트리밋 백오프(폴링 600초에선 불필요).
