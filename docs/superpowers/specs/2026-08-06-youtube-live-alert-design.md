# YouTube 라이브 알림 (YouTube Data API v3)

작성일: 2026-08-06

## 목적

누군가 **YouTube에서 Deadly Trick을 생중계 중이고 동시 시청자가 50명 이상**이면 지정 Discord
채널로 임베드 알림을 보낸다. Twitch·치지직 워처와 동일한 "폴링 → 필터 → 신규 방송만 1회 알림"
패턴의 4번째 소스다.

`2026-07-09-holodex-vtuber-live-alert-design.md`(Holodex 경유 VTuber 전용)를 **대체**한다.
Holodex는 VTuber 채널만 집계해 일반 유튜버를 놓치므로, 공식 API 검색으로 전환한다.
Holodex 판단·표현 로직(`holodex-watch.js`)은 YouTube 공통이라 `youtube-watch.js`로 이어받고,
데이터 조회부(`holodex.js`)만 폐기한다.

## 결정 사항 (확정)

| 항목 | 결정 |
|------|------|
| 데이터 출처 | **YouTube Data API v3** 공식. `search.list` + `videos.list` 2단계. |
| 게임 매칭 | **제목/설명/태그 구문 검색**(`q`). YouTube엔 게임 카테고리 라이브 조회가 없다. 검색 결과는 관련성 기반이라 로컬 키워드 필터로 오탐을 한 번 더 거른다. |
| 시청자 하한 | **`concurrentViewers >= 50`** (`.env`로 조정). |
| 폴링 주기 | **900초(15분) 고정.** `search.list`가 하루 100회 한도라 이보다 짧게 잡을 수 없다. |
| 알림 형식 | Discord **임베드**. 제목=`YouTube에서 {채널명}님이 {카테고리명} 방송중!`, 본문=방송제목 + YouTube 링크. |
| 중복제거 | 방송 영상 `id` 기준. 방송 중엔 재알림 없음, 껐다 켜면(새 영상 id) 재알림. |
| 알림 채널 | `YOUTUBE_ALERT_CHANNEL_ID`, 없으면 `STEAM_ALERT_CHANNEL_ID`로 폴백. |
| 활성화 조건 | `YOUTUBE_API_KEY` + 알림 채널이 모두 있을 때만. |
| 상태 영속화 | 안 함(메모리). 재시작 시 baseline 재설정. |

### 확인된 API 사실 (2026-08-06)

- **쿼터**: "Projects that enable the YouTube Data API have a default quota allocation of
  100 `search.list` calls, 100 `videos.insert` calls, and 10,000 units per day combined for
  all other endpoints." → `search.list`는 10,000 풀과 **별개인 전용 버킷의 하루 100회**.
  15분 주기면 96회/일로 한도 안에 들어간다.
- **`search.list` 응답에는 시청자수가 없다.** `order=viewCount`가 라이브를 동시 시청자순으로
  정렬해 주지만 숫자 자체는 노출하지 않는다. → `videos.list?part=liveStreamingDetails`의
  `concurrentViewers`(문자열)로 보강해야 한다. `videos.list`는 1 unit, id를 최대 50개까지 배치.
- 검색 엔드포인트: `GET https://www.googleapis.com/youtube/v3/search`
  파라미터 `part=snippet&eventType=live&type=video&order=viewCount&maxResults=50&q=<query>&key=<apiKey>`
- 상세 엔드포인트: `GET https://www.googleapis.com/youtube/v3/videos`
  파라미터 `part=snippet,liveStreamingDetails&id=<쉼표구분 id들>&key=<apiKey>`
- 인증은 **API 키 하나**로 충분하다(공개 데이터 읽기 전용, OAuth 불필요).

### 조사로 확인한 제목 표기 (검색어 설계 근거)

YouTube 자동 생성 주제 채널 `UC_f4Z92iVQLsEapGZNYrVbQ`("Deadly Trick - Topic")에 모인 실제
영상 제목:

```
[Deadly Trick]ノエル最高の瞬間
[Deadly Trick]黒幕を知ってると悟られてはいけない
Deadly Trick アップデートトレーラー
I Died and Nobody Saw It | Deadly Trick
```

일본어 방송도 제목에 **영문 "Deadly Trick"을 그대로 표기**한다. 따라서 영문 구문 검색만으로도
상당수가 잡히지만, 순수 현지어 제목을 놓치지 않도록 한국어·일본어 표기를 `|`(OR)로 함께 넣는다.
OR를 묶어도 **호출 1회**라 쿼터 비용은 같다.

### 이 주제 채널을 데이터 소스로 쓰지 않는 이유

- `/streams` 탭에 라이브 배지가 없고 노출 숫자는 누적 조회수(`"조회수 1,294회"`)뿐 —
  **동시 시청자수가 없어 50명 컷을 걸 수 없다.**
- RSS(`feeds/videos.xml?channel_id=…`)는 이 채널의 경우 항목이 0개다.
- 공식 API 경로가 없어 HTML 스크래핑에 의존해야 한다(치지직 때의 공식 API 원칙과 어긋남).

## 동작 개요

1. 봇 기동 시 `YOUTUBE_API_KEY`와 알림 채널이 모두 설정돼 있을 때만 워처 시작.
2. `YOUTUBE_POLL_INTERVAL_SEC`마다:
   1. `search.list`로 라이브 후보 최대 50개의 videoId 수집. 0건이면 2단계는 호출하지 않는다.
   2. `videos.list`로 그 id들의 `concurrentViewers`·제목·채널명·설명을 한 번에 조회.
   3. 이미 끝난 방송(`liveStreamingDetails.actualEndTime` 존재)은 제외.
   4. `YOUTUBE_MATCH_TERMS` 중 하나라도 제목·설명에 없으면 제외(오탐 필터).
3. **첫 성공 조회는 baseline(현재 라이브 영상 id 집합)만 잡고 알림은 보내지 않는다.**
4. 이후 매 폴링마다: `concurrentViewers >= minViewers` 이면서 직전 틱 baseline에 없던 영상 id →
   **알림 전송**. 그 후 baseline을 현재(자격 충족·라이브) 영상 id 집합으로 갱신.
5. 조회 실패(네트워크/비200/예외) 시 그 사이클은 건너뜀(baseline 유지). 폴링은 계속.

## 구성 요소

### `src/youtube.js` — 데이터 조회 (신규)
```
createYouTubeClient({ apiKey, fetch = globalThis.fetch }) -> { fetchLives }
fetchLives(query) -> Promise<Array<{ videoId, channelName, title, description, liveViewers }>>
```
- 1단계 `search.list` → `items[].id.videoId` 수집. 빈 배열이면 즉시 `[]` 반환(2단계 생략).
- 2단계 `videos.list`(id 배치) → compact 매핑:
  `id→videoId`, `snippet.channelTitle→channelName`, `snippet.title→title`,
  `snippet.description→description`, `liveStreamingDetails.concurrentViewers→liveViewers`(누락 시 0, 문자열→숫자).
- `liveStreamingDetails.actualEndTime`이 있으면 제외(종료된 방송).
- 비200이면 `throw new Error("youtube <search|videos> HTTP <status>")`. `fetch` 주입으로 테스트 가능.

메타데이터를 search 응답이 아니라 `videos.list` 응답에서 가져오는 이유: 같은 호출에서 시청자수와
함께 오므로 시점이 일치하고, 필드가 한 곳에 모여 매핑이 단순해진다.

### `src/youtube-watch.js` — 판단 + 표현 + 루프 (`holodex-watch.js`에서 이어받음)
```
matchesTerms(live, terms) -> boolean                              // 신규, 순수
newStreamers(known, lives, minViewers = 0) -> Array               // 그대로
buildAlert(live, categoryName, platform) -> { embeds: [embed] }   // 그대로
createYouTubeWatcher({ fetchLives, send, categoryName, minViewers = 0, platform = "YouTube" })
startYouTubeWatch({ ...같은 deps, intervalMs }) -> { stop() }
```
- `matchesTerms`: `terms`가 비면 `true`(필터 없음). 아니면 제목 또는 설명에 term 하나라도
  대소문자 무시로 포함되면 `true`. 오탐 필터는 클라이언트가 아닌 워처 쪽 순수 함수로 둔다
  (검색어와 매칭어를 따로 조정할 수 있게).
- 나머지 로직·임베드 형식은 Holodex 워처와 동일(`https://youtu.be/<videoId>`, YouTube 레드).

### `src/config.js` — 설정 추가
| env | 기본값 | 설명 |
|-----|--------|------|
| `YOUTUBE_API_KEY` | (없음) | 없으면 기능 비활성화 |
| `YOUTUBE_ALERT_CHANNEL_ID` | `STEAM_ALERT_CHANNEL_ID`로 폴백 | 알림 채널 |
| `YOUTUBE_SEARCH_QUERY` | `"Deadly Trick"\|"데들리 트릭"\|"デッドリートリック"` | 구문 검색, `\|`로 OR |
| `YOUTUBE_MATCH_TERMS` | `Deadly Trick,데들리 트릭,デッドリートリック` | 오탐 필터 키워드(쉼표 구분) |
| `YOUTUBE_CATEGORY_NAME` | `Deadly Trick` | 알림에 표시할 이름 |
| `YOUTUBE_POLL_INTERVAL_SEC` | `900` | 하루 100회 한도 → 15분 미만 금지 |
| `YOUTUBE_ALERT_MIN_VIEWERS` | `50` | 이 시청자수 이상만 알림 |

`YOUTUBE_MATCH_TERMS`는 쉼표로 잘라 공백을 다듬은 배열로 파싱한다. 빈 문자열이면 빈 배열(필터 없음).

### `src/index.js` — 배선
치지직 블록 대칭. `if (config.youtubeApiKey && config.youtubeAlertChannelId)`일 때
`createYouTubeClient` 생성 → `startYouTubeWatch` 기동(platform `"YouTube"`) → 시작 로그 출력.
`send`는 `makeSender(c, config.youtubeAlertChannelId, "youtube")`.
**폴링 주기가 900초 미만이면 기동 시 쿼터 초과 경고를 찍는다**(동작은 막지 않음).

### 문서 — `.env` / `.env.example` / `README.md`
위 7개 env 항목 + 의미 주석. README 설정 표의 Holodex 행을 YouTube 행으로 교체하고,
쿼터 제약(하루 100회 검색 → 15분 주기)을 주의 문단에 적는다.

### 폐기
- `src/holodex.js`, `test/holodex.test.js` 삭제.
- `src/holodex-watch.js` → `src/youtube-watch.js`, `test/holodex-watch.test.js` → `test/youtube-watch.test.js` 이름 변경.
- `config.js`의 `holodex*` 7개 항목과 `index.js`의 Holodex 블록 제거.

## 알림 메시지 (임베드)

```
YouTube에서 {채널명}님이 Deadly Trick 방송중!   ← 제목 (YouTube 링크)
{방송 제목}
https://youtu.be/{videoId}                      ← 본문
```

## 에러 처리

- 조회 실패(네트워크/비200/예외): `index.js`에서 catch → `console.error` + null 반환 →
  워처는 그 사이클 skip(baseline 유지).
- **쿼터 소진(403 `quotaExceeded`)도 같은 경로**로 처리된다 — 그날 남은 폴링은 계속 실패하고,
  자정(태평양시) 리셋 후 자동 복구된다.
- 채널 해석/전송 실패: `makeSender`가 로그만 남기고 삼킴, 다음 주기 계속.

## 테스트 (`node --test`)

- `fetchLives`: search 파라미터(`eventType=live`, `type=video`, `q`, `key`) 확인 /
  videos.list에 수집한 id가 쉼표로 배치되는지 / 필드 매핑 / `concurrentViewers` 문자열→숫자 /
  누락 시 0 / `actualEndTime` 있으면 제외 / 검색 0건이면 videos.list 미호출 / 비200→throw.
- `matchesTerms`: 제목 매치, 설명 매치, 대소문자 무시, 미포함 시 false, terms 비면 true.
- `newStreamers`·`buildAlert`·워처 동작: 기존 Holodex 테스트를 그대로 이어받음.

## 비범위 (Out of scope, v1)

- 쿼터 확장 신청(Google 심사) — 기본 100회로 운영.
- 검색 페이징(`pageToken`) — 1페이지 50건이면 충분하고, 페이징은 호출 1회를 더 먹는다.
- 채널 화이트리스트/블랙리스트.
- 상태 파일 영속화.
