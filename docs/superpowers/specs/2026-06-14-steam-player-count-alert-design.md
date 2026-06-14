# Steam 동접자 변동 알림 (Steam Player-Count Alert)

작성일: 2026-06-14

## 목적

내 게임(Steam app `4398540`)의 현재 동접자(concurrent players) 수를 주기적으로
관찰해서, **직전 알림값 기준으로 일정 폭(기본 ±5) 이상 변동**할 때마다 지정한
Discord 채널로 알림을 보낸다.

## 결정 사항 (확정)

| 항목 | 결정 |
|------|------|
| 데이터 출처 | **Steam 공식 API** `ISteamUserStats/GetNumberOfCurrentPlayers` (무료·무키). SteamDB 스크래핑은 차단·ToS 위반이라 사용 안 함. |
| 알림 조건 | **직전 알림값 기준 `|현재값 − 직전알림값| ≥ threshold`** 일 때. 기본 threshold = 5. |
| 알림 채널 | `.env`의 `STEAM_ALERT_CHANNEL_ID`로 **고정**. `/start` 바인딩과 독립. |
| 폴링 주기 | 기본 600초(10분). `.env`로 조정. |
| 상태 영속화 | 안 함(메모리). 재시작 시 기준선 재설정. |

API 동작 확인됨(2026-06-14): `GET .../GetNumberOfCurrentPlayers/v1/?appid=4398540`
→ `{"response":{"player_count":12,"result":1}}` (`result:1`=성공).

## 동작 개요

1. 봇 기동 시 `STEAM_ALERT_CHANNEL_ID`가 설정돼 있을 때만 워처 시작
   (기존 `NOTIFY_SECRET` 없으면 notify 비활성화하는 패턴과 동일).
2. `STEAM_POLL_INTERVAL_SEC`마다 Steam API 폴링 → 현재 동접 수 획득.
3. **첫 성공 조회는 기준선(`lastNotified`)만 잡고 알림은 보내지 않는다**
   (재시작 직후 스팸 방지).
4. 이후 매 폴링마다 `|현재값 − lastNotified| ≥ threshold`이면:
   - 지정 채널로 알림 전송
   - `lastNotified ← 현재값` 으로 갱신
5. 조회 실패(네트워크/`result≠1`/비200) 시 그 사이클은 건너뜀
   (기준선 유지, 크래시·오알림 없음). 폴링은 계속.

### 예시 (threshold=5)

```
12(기준선, 무알림) → 16 (+4, 조용) → 17 (+5, 알림! 기준선 17)
 → 13 (-4, 조용) → 12 (-5, 알림! 기준선 12)
 → 30 (+18 점프, 알림 1건! 기준선 30)
```

## 구성 요소

작고 독립적인 단위로 분리한다. 핵심 판단 로직은 순수 함수로 빼서 단위 테스트한다.

### `src/steam.js` — 데이터 조회
```
fetchPlayerCount(appId, { fetch = globalThis.fetch } = {}) -> Promise<number|null>
```
- Steam API 호출·파싱.
- 성공(`result === 1`): `player_count`(정수) 반환.
- 실패(비200 / JSON 파싱 실패 / `result !== 1` / 네트워크 예외): `null` 반환.
- `fetch` 주입으로 테스트 가능.

### `src/steam-watch.js` — 판단 + 루프
```
shouldNotify(lastNotified, current, threshold) -> boolean   // 순수 함수
```
- `lastNotified == null` → `false` (첫 기준선).
- `Math.abs(current - lastNotified) >= threshold` → `true`.

```
startSteamWatch({ fetchCount, threshold, intervalMs, resolveChannel, formatMessage })
  -> { stop() }
```
- 즉시 1회 실행 후 `setInterval(intervalMs)` 루프.
- 내부 `lastNotified` 상태 보관.
- 매 틱: `fetchCount()` → `null`이면 skip → `shouldNotify`면 채널 전송 + 기준선 갱신.
- `resolveChannel()`로 채널을 얻고(없으면 drop), `formatMessage(current, last, delta)`로 본문 생성.

### `src/config.js` — 설정 추가
| env | 기본값 | 설명 |
|-----|--------|------|
| `STEAM_ALERT_CHANNEL_ID` | (없음) | 없으면 기능 비활성화 |
| `STEAM_APP_ID` | `4398540` | 관찰할 앱 |
| `STEAM_POLL_INTERVAL_SEC` | `600` | 폴링 주기(초) |
| `STEAM_ALERT_THRESHOLD` | `5` | 변동 임계값 |

config 객체에 `steamAlertChannelId`, `steamAppId`, `steamPollIntervalSec`,
`steamAlertThreshold` 추가.

### `src/index.js` — 배선
`ClientReady`에서 `startNotifyServer` 옆에:
```
if (config.steamAlertChannelId) {
  startSteamWatch({
    fetchCount: () => fetchPlayerCount(config.steamAppId),
    threshold: config.steamAlertThreshold,
    intervalMs: config.steamPollIntervalSec * 1000,
    resolveChannel: () => c.channels.fetch(config.steamAlertChannelId).catch(() => null),
    formatMessage,
  });
}
```

## 알림 메시지 (예시)

```
🎮 동접자 17명 (직전 알림 12명, +5)
https://steamdb.info/app/4398540/
```
- 현재값 / 직전 알림값 / 부호 있는 delta 포함. SteamDB 링크는 참고용.

## 에러 처리

- 조회 실패: `console.error` 로그 + 사이클 skip. 기준선·루프 유지.
- 채널 해석 실패(삭제/권한 없음): drop, 로그.
- 전송 실패: 로그만, 다음 주기 계속.

## 테스트 (`node --test`)

- `shouldNotify`: 경계값(threshold-1 / threshold / threshold+1), 음수 방향, `lastNotified=null`.
- `fetchPlayerCount`: 주입 fetch로 성공(`result:1`), `result:0`, 비200, JSON 깨짐, 네트워크 예외 → 기대 반환값.
- (선택) `startSteamWatch`: 가짜 fetch 시퀀스로 "첫 조회 무알림 → 임계 도달 시 1건 → 기준선 갱신" 시나리오.

## 비범위 (Out of scope, v1)

- 상태 파일 영속화(`steam-watch.json`).
- 다중 앱 동시 관찰.
- 슬래시 커맨드로 임계값/주기 런타임 변경.
- 게임 이름 자동 조회(메시지에 app id 링크만).
