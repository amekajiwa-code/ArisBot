# 최근 N일 방송자 수집기 (Twitch · YouTube · 비리비리 · 니코니코)

작성일: 2026-08-25

## 목적

"**최근 3일 안에 Deadly Trick을 방송한 사람 전부**"를 네 플랫폼에서 긁어 한 목록으로 뽑는다.

기존 워처(`*-watch.js`)는 **지금 켜져 있는 방송만** 보고 새로 켜진 것 하나를 Discord로 알리는
구조라, "지난 3일"처럼 **과거를 되돌아보는 질문에는 답할 수 없다**(상태를 메모리에만 두고 재시작하면
날아간다). 그래서 알림 경로를 건드리지 않고 **일회성 CLI**를 따로 둔다.

## 결정 사항 (확정)

| 항목 | 결정 |
|------|------|
| 실행 형태 | `node scripts/find-streamers.js [--days N] [--game "이름"] [--json]` (기본 3일). 봇 프로세스와 무관한 일회성 실행. |
| 출력 | 사람 단위로 병합한 한글 리포트(그대로 Discord에 붙여넣기 가능) 또는 `--json`. |
| 집계 단위 | **플랫폼 × 사람.** 같은 사람이 3일간 5번 방송했으면 한 줄에 `×5` + 가장 최근 방송. |
| 기간 판정 | 방송 시작시각 기준. **지금 방송중이면 시작시각을 몰라도 포함**(플랫폼이 값을 안 주는 경우가 있다). 예약분(미래)은 제외. |
| 실패 처리 | 플랫폼 하나가 죽어도 나머지는 그대로 출력하고 실패는 `⚠️` 로 보고. 자격증명이 없으면 `⏭` 로 건너뜀. |
| 자격증명 | Twitch/YouTube는 알림 봇이 이미 쓰는 `.env` 값을 재사용. 비리비리·니코니코는 키 불필요. |

## 플랫폼별 조회 방법과 한계

| 플랫폼 | 진행중 | 과거 3일 | 한계 |
|---|---|---|---|
| **Twitch** | Helix `GET /streams?game_id=` | Helix `GET /videos?game_id=&period=week&sort=time&type=archive` | **카테고리 기준이라 가장 정확**(제목에 게임명이 없어도 잡힘). 단 VOD를 안 남기는 채널은 방송이 끝나면 공개 흔적이 없다 — 트위치가 주는 유일한 공개 백로그가 VOD다. |
| **YouTube** | `search.list?eventType=live` | `search.list?eventType=completed&publishedAfter=` → `videos.list`로 `actualStartTime`·시청자수 보강 | 게임 카테고리로 라이브를 조회하는 API가 없어 **검색어 의존**. 제목·설명·태그에 게임명을 안 쓴 방송은 못 찾는다. `search.list`는 하루 100회 한도이고 실행 1회당 2회를 쓴다. |
| **비리비리** | 웹 검색 `search_type=live_room` | 웹 검색 `search_type=video&order=pubdate` (라이브 다시보기·편집본) | 공식 개발자 API가 아니라 **웹 공개 엔드포인트**다. `buvid3` 쿠키 없이 호출하면 `-412`(풍제어)로 막혀서, 첫 호출 전에 홈페이지에서 쿠키를 받아 붙인다. 그래도 막히면 `BILIBILI_COOKIE`로 브라우저 쿠키 주입. 라이브를 껐고 다시보기도 안 올렸으면 흔적이 없다. |
| **니코니코** | 생방송 검색 페이지(`status=onair`) | 스냅샷 검색 API v2(영상) + 생방송 검색(`status=past`) | 스냅샷 API는 무인증이지만 **초당 1요청** 제한이 있어 키워드 사이에 간격을 둔다. 생방송 쪽은 공개 검색 API가 없어 페이지에 박힌 `data-props` JSON을 파싱한다 — 스키마 변경에 대비해 경로를 찍지 않고 **`lv숫자` id + title을 가진 객체를 훑는 덕타이핑**으로 모으고, 못 읽으면 예외 대신 빈 배열을 준다. 투고자 닉네임은 응답에 없어 nvapi로 보강(실패 시 user id 표시, 최대 40건). |

> 네 플랫폼 어디에도 "이 게임을 방송한 사람 전부"를 주는 API는 없다. Twitch만 카테고리로
> 정확히 뒤질 수 있고 나머지 셋은 **검색어 기반**이라, 게임명을 어디에도 안 적은 방송은
> 원리상 놓친다. 이 CLI의 결과는 "공개적으로 검색 가능한 범위 전부"다.

## 구조

```
scripts/find-streamers.js   CLI — 인자·환경변수 → 소스 구성 → 출력
src/find-streamers.js       기간 필터 · 키워드 필터 · 사람 단위 병합 · 리포트 포맷 (순수 로직)
src/twitch.js               + fetchVideos(과거 방송) / fetchStreams 페이징
src/youtube.js              + fetchRecentStreams(진행중 + 종료 라이브)
src/bilibili.js             신규 — 웹 검색(영상 · 라이브 방)
src/niconico.js             신규 — 스냅샷 검색 + 생방송 검색 파싱
```

수집 함수는 `{ platform, run() }` 형태로 주입되므로, `src/find-streamers.js`는 네트워크 없이
그대로 테스트된다. 플랫폼 클라이언트도 기존 코드와 동일하게 `fetch`를 주입받는다.

`filterByTerms: false`인 소스(Twitch)는 카테고리로 이미 게임이 확정돼 제목 필터를 건너뛴다.

## 알림 봇에 준 영향

`fetchStreams`에 `startedAt` 필드와 옵션 페이징이 붙었을 뿐, 워처 동작은 그대로다.
CLI는 `src/index.js`를 import 하지 않으므로 Discord 토큰 없이도 돈다.
