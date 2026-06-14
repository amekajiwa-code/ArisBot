# Steam 동접자 변동 알림 (Steam Player-Count Alert)

작성일: 2026-06-14

## 목적

내 게임(Steam app `4398540`)의 현재 동접자(concurrent players) 수를 주기적으로
관찰해서, **직전 알림값보다 일정 폭 이상 "증가(돌파)"할 때** 지정한 Discord 채널로
SteamDB 링크가 담긴 임베드(봇 메시지) 알림을 보낸다.

## 결정 사항 (확정)

| 항목 | 결정 |
|------|------|
| 데이터 출처 | **Steam 공식 API** `ISteamUserStats/GetNumberOfCurrentPlayers` (무료·무키). SteamDB 스크래핑은 차단·ToS 위반이라 사용 안 함. |
| 알림 조건 | **증가만 알림**: `현재값 − 직전알림값 ≥ threshold` 이고 `현재값 ≥ minCount`. 감소는 무알림(기준선만 하향). |
| 알림 형식 | Discord **임베드**(`{ embeds: [...] }`). 제목=게임 이름, 본문=`동접자 N명 돌파(+Δ)`, 제목 링크=SteamDB. |
| 알림 채널 | `.env`의 `STEAM_ALERT_CHANNEL_ID`로 **고정**. `/start` 바인딩과 독립. |
| 폴링 주기 | 기본 600초(10분). `.env`로 조정. |
| 상태 영속화 | 안 함(메모리). 재시작 시 기준선 재설정. |

API 동작 확인됨(2026-06-14): `GET .../GetNumberOfCurrentPlayers/v1/?appid=4398540`
→ `{"response":{"player_count":12,"result":1}}` (`result:1`=성공).

## 동작 개요

1. 봇 기동 시 `STEAM_ALERT_CHANNEL_ID`가 설정돼 있을 때만 워처 시작
   (기존 `NOTIFY_SECRET` 없으면 notify 비활성화하는 패턴과 동일).
2. `STEAM_POLL_INTERVAL_SEC`마다 Steam API 폴링 → 현재 동접 수 획득.
3. **첫 성공 조회는 기준선(`lastNotified`)만 잡고 알림은 보내지 않는다**.
4. 이후 매 폴링마다:
   - `현재값 − lastNotified ≥ threshold` 이고 `현재값 ≥ minCount` → **알림 전송 + `lastNotified ← 현재값`**.
   - `현재값 < lastNotified`(감소) → **알림 없이 `lastNotified ← 현재값`** (조용히 기준선 하향).
   - 그 외(임계 미만 증가) → 그대로 두어 다음 증가가 누적되게 함.
5. 조회 실패(네트워크/`result≠1`/비200) 시 그 사이클은 건너뜀(기준선 유지). 폴링은 계속.

### 예시 (threshold=5, minCount=10)

```
12(기준선, 무알림) → 16 (+4, 조용) → 17 (+5, 알림! "17명 돌파(+5)", 기준선 17)
 → 12 (감소, 조용히 기준선 12로 하향) → 17 (+5 again, 알림! "17명 돌파(+5)", 기준선 17)
 → 9 (감소, 그러나 minCount 미만이어도 알림은 어차피 감소라 없음, 기준선 9)
```

## 구성 요소

작고 독립적인 단위로 분리한다. 핵심 판단·표현 로직은 순수 함수로 빼서 단위 테스트한다.

### `src/steam.js` — 데이터 조회
```
fetchPlayerCount(appId, { fetch = globalThis.fetch } = {}) -> Promise<number|null>
```
- 성공(`result === 1`): `player_count`(정수) 반환.
- 실패(비200 / JSON 파싱 실패 / `result !== 1` / 네트워크 예외): `null` 반환.
- `fetch` 주입으로 테스트 가능.

### `src/steam-watch.js` — 판단 + 표현 + 루프
```
shouldNotify(lastNotified, current, threshold, minCount) -> boolean   // 순수, 증가 전용
```
- `lastNotified == null` → false. `current < minCount` → false.
- `current - lastNotified >= threshold` → true (증가만).

```
buildAlert({ current, last, gameName, appId }) -> { embeds: [embed] }   // 순수
```
- `{ title: "🎮 <gameName>", url: "https://steamdb.info/app/<appId>/",
    description: "동접자 <current>명 돌파(+<delta>)", color }`.

```
createSteamWatcher({ fetchCount, send, threshold, minCount, gameName, appId }) -> { tick, lastNotified }
startSteamWatch({ ...같은 deps, intervalMs }) -> { stop() }
```
- `tick()`: fetch → null이면 skip → 첫 조회면 기준선만 → `shouldNotify`면 `send(buildAlert(...))` + 기준선 상향 → 감소면 기준선만 하향.
- `send`는 채널에 보낼 payload(임베드)를 받는다. discord 의존성은 워처 밖(`index.js`)에 둔다.

### `src/config.js` — 설정 추가
| env | 기본값 | 설명 |
|-----|--------|------|
| `STEAM_ALERT_CHANNEL_ID` | (없음) | 없으면 기능 비활성화 |
| `STEAM_APP_ID` | `4398540` | 관찰할 앱 |
| `STEAM_GAME_NAME` | `DEADLY TRICK DEMO` | 알림에 표시할 이름 |
| `STEAM_POLL_INTERVAL_SEC` | `600` | 폴링 주기(초) |
| `STEAM_ALERT_THRESHOLD` | `5` | 증가 임계값 |
| `STEAM_ALERT_MIN_COUNT` | `10` | 이 값 이상일 때만 알림 |

### `src/index.js` — 배선
`ClientReady`에서 `startNotifyServer` 옆에 `startSteamWatch` 기동.
`send`는 `STEAM_ALERT_CHANNEL_ID` 채널을 `fetch`해서 `channel.send(payload)`로 임베드 전송.

## 알림 메시지 (임베드)

```
🎮 DEADLY TRICK DEMO        ← 제목 (SteamDB 링크)
동접자 17명 돌파(+5)         ← 본문
```

## 에러 처리

- 조회 실패: `console.error` 로그 + 사이클 skip. 기준선·루프 유지.
- 채널 해석/전송 실패: 로그만, 다음 주기 계속.

## 테스트 (`node --test`)

- `shouldNotify`: 증가 경계(threshold-1/threshold/+), 감소(전부 false), `minCount` 미만, `lastNotified=null`.
- `buildAlert`: 임베드 제목/url/description/color.
- `fetchPlayerCount`: 성공(`result:1`), `result:0`, 비200, JSON 깨짐, 네트워크 예외.
- `createSteamWatcher`: 첫 조회 무알림 → 증가 시 1건+기준선 상향 → 감소 시 무알림+기준선 하향 → 하향 후 재상승 시 재알림 → minCount 미만 무알림 → null skip.

## 비범위 (Out of scope, v1)

- 상태 파일 영속화(`steam-watch.json`).
- 다중 앱 동시 관찰.
- 슬래시 커맨드로 임계값/주기 런타임 변경.
- 게임 이름 자동 조회(현재는 `STEAM_GAME_NAME` 수동 설정).
