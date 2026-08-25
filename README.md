# 🤖 ArisBot (알림 전용)

> Steam 동접자 · Twitch · 치지직 · YouTube · 비리비리 · 니코니코 라이브를 감시해 Discord 채널로 알려주고,
> "지난 N일에 누가 방송했나"를 기록해 두는 봇.
> 클라우드 VM(예: Google Cloud `e2-micro`, Ubuntu)에서 24시간 구동한다.

<p align="center">
  <img src="https://img.shields.io/badge/platform-Linux%20VM-FCC624?style=for-the-badge&logo=linux&logoColor=black" alt="Linux VM">
  <img src="https://img.shields.io/badge/node-%E2%89%A520.6-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Node 20.6+">
</p>

---

## 무슨 봇인가

디스코드에 로그인해 아래를 주기적으로 폴링하고, 변동이 생기면 지정 채널로 임베드를 보낸다.

| 알림 | 조건 |
| --- | --- |
| **Steam 동접자** | 직전 알림값보다 `THRESHOLD` 이상 **증가**했고 현재 동접이 `MIN_COUNT` 이상일 때 SteamDB 링크 임베드 |
| **Twitch 라이브** | 지정 카테고리에 새 방송이 켜지면 "{채널}님이 {카테고리} 방송중!" 임베드 |
| **치지직 라이브** | 지정 카테고리에 새 방송이 켜지면 동일 형식 임베드 (공식 Open API 한계상 시청자 상위권만 훑음) |
| **YouTube 라이브** | 지정 검색어로 라이브를 훑어 동일 형식 임베드 (공식 API 쿼터 한도상 15분 주기) |
| **비리비리 라이브** | 지정 검색어로 방송중인 방을 훑어 동일 형식 임베드 (기록기 주기 = 60초) |
| **니코니코 라이브** | 지정 검색어로 방송중인 생방송을 훑어 동일 형식 임베드 (기록기 주기 = 60초) |

여기에 더해 **방송 기록기**가 1분마다 훑어 "누가 언제 방송했나"를 파일에 남긴다(알림은 안 보낸다).
나중에 `npm run find-streamers` 로 **"지난 3일 안에 방송한 사람 전부"** 를 뽑을 때 이 기록을 읽는다.

슬래시 명령·메시지 응답·원격제어 기능은 **없다**. 알림만 보낸다. 들어오는 이벤트가 없으니 디스코드 포털에서 **Message Content / Presence 등 privileged intent를 켤 필요가 없다.** 봇은 서버에 초대돼 **메시지 보내기** 권한만 있으면 된다.

각 알림 소스는 해당 자격증명/채널을 채웠을 때만 켜지고, 비워두면 조용히 꺼진다. 하나도 안 채우면 경고만 찍고 아무 알림도 안 보낸다.
비리비리·니코니코는 키가 없는 플랫폼이라 **알림 채널이 곧 스위치**이고, 기록기가 훑는 결과를 받아써서 **알림을 켜도 외부 요청이 안 늘어난다.**

---

## 🚀 클라우드 배포 (Ubuntu VM 기준)

Google Cloud Compute Engine `e2-micro`(Always Free 티어)에 Ubuntu 22.04/24.04를 띄운 경우를 기준으로 한다. 다른 VPS(Oracle Cloud Free, AWS Lightsail 등)도 동일하다.

### 1. Node.js 20+ 설치

```bash
# NodeSource로 Node 20 LTS 설치
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git
node -v   # v20.x 이상 확인
```

### 2. 코드 배치 & 의존성 설치

```bash
sudo mkdir -p /opt/arisbot
sudo chown "$USER" /opt/arisbot
git clone https://github.com/amekajiwa-code/ArisBot.git /opt/arisbot
cd /opt/arisbot
npm ci --omit=dev          # 런타임 의존성(discord.js)만 설치
```

### 3. `.env` 작성

```bash
cp .env.example .env
nano .env                  # 아래 표를 보고 채우기
```

| 키 | 설명 |
| --- | --- |
| `DISCORD_BOT_TOKEN` | 봇 토큰 (Developer Portal → Bot → Reset/Copy Token) |
| `STEAM_ALERT_CHANNEL_ID` _(선택)_ | Steam 동접 알림 채널 id — 채우면 Steam 알림 켜짐 |
| `STEAM_APP_ID` / `STEAM_GAME_NAME` | 감시할 게임 (기본값은 예시 게임) |
| `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` _(선택)_ | 둘 다 채우면 Twitch 알림 켜짐 ([dev.twitch.tv/console/apps](https://dev.twitch.tv/console/apps), Confidential 앱) |
| `CHZZK_CLIENT_ID` / `CHZZK_CLIENT_SECRET` _(선택)_ | 둘 다 채우면 치지직 알림 켜짐 ([developers.chzzk.naver.com](https://developers.chzzk.naver.com)) |
| `YOUTUBE_API_KEY` _(선택)_ | 채우면 YouTube 알림 켜짐 (Google Cloud Console → YouTube Data API v3 사용 설정 → API 키) |
| `BILIBILI_ALERT_CHANNEL_ID` / `NICO_ALERT_CHANNEL_ID` _(선택)_ | 비리비리·니코니코 알림 채널. 안 정하면 `STEAM_ALERT_CHANNEL_ID` 를 쓰고, 그것도 없으면 꺼짐. 끄려면 `BILIBILI_ALERT_ENABLED=0` / `NICO_ALERT_ENABLED=0` |

> 채널 id는 디스코드에서 **사용자 설정 → 고급 → 개발자 모드**를 켠 뒤 채널 우클릭 → **채널 ID 복사**.
> Twitch·치지직·YouTube 알림 채널을 따로 안 정하면 `STEAM_ALERT_CHANNEL_ID`와 같은 채널을 쓴다.

먼저 한 번 직접 띄워 로그인·알림이 되는지 확인:

```bash
npm start
# [discord] logged in as ... / [steam] watching ... 가 뜨면 정상. Ctrl+C 로 중지.
```

### 4. systemd 서비스로 등록 (자동 시작 + 크래시 자동 재시작)

봇 전용 시스템 유저를 만들고 서비스 파일을 설치한다.

```bash
# 전용 유저 생성 + 디렉터리 소유권
sudo useradd --system --no-create-home --shell /usr/sbin/nologin arisbot
sudo chown -R arisbot:arisbot /opt/arisbot

# 동봉된 유닛 파일 설치
sudo cp /opt/arisbot/deploy/arisbot.service /etc/systemd/system/arisbot.service
```

`/etc/systemd/system/arisbot.service`에서 `WorkingDirectory`(`/opt/arisbot`)와 `ExecStart`의 node 경로(`which node` 결과)가 맞는지 확인 후:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now arisbot      # 부팅 시 자동 시작 + 지금 바로 시작
sudo systemctl status arisbot            # active (running) 확인
journalctl -u arisbot -f                 # 실시간 로그
```

### 5. 업데이트 (코드 변경 후)

```bash
cd /opt/arisbot
git pull
npm ci --omit=dev
sudo systemctl restart arisbot
```

---

## ⚙️ 설정 항목 전체

`.env.example`에 각 항목의 의미가 주석으로 달려 있다. 폴링 주기(`*_POLL_INTERVAL_SEC`, 기본 600초), 시청자 하한(`*_ALERT_MIN_VIEWERS`, 기본 30명), 치지직 스캔 깊이(`CHZZK_MAX_PAGES`, 기본 50 = 상위 1000개) 등을 조절할 수 있다.

> ⚠️ **치지직 공식 Open API에는 카테고리 필터가 없다.** 전체 라이브 중 시청자수 상위 `CHZZK_MAX_PAGES × 20`개만 훑어 카테고리가 일치하는 방송을 찾으므로, 시청자가 적은 소규모 카테고리는 상위권에 안 떠 놓칠 수 있다.
>
> 깊이가 충분한지는 `npm run chzzk-depth` 로 지금 시점의 실제 값을 잴 수 있다. 목록이 시청자수
> 내림차순이라, **스캔 끝자락이 이미 알림 하한(50명) 아래면 더 깊이 봐도 알림은 안 바뀐다**
> — 그 아래는 하한을 넘을 수 없기 때문이다. 시간대에 따라 달라지니 피크(저녁)에 재보는 게 의미 있다.
> 단 **기록기는 시청자 하한이 없어** 못 본 구간의 소규모 방송은 기록에서 빠진다(명단이 성겨짐).
>
> ⚠️ **YouTube의 `search.list`는 하루 100회가 한도다.** (다른 엔드포인트의 10,000 unit 풀과 별개인 전용 버킷.) 그래서 `YOUTUBE_POLL_INTERVAL_SEC` 기본값이 900초(15분, 하루 96회)이고, 이보다 짧게 두면 기동 시 경고가 뜨고 그날 쿼터를 태워버린다. 시청자수는 검색 응답에 없어 `videos.list`로 한 번 더 조회해 채운다(1 unit).
>
> ⚠️ **YouTube엔 게임 카테고리로 라이브를 조회하는 API가 없다.** 제목·설명·태그를 훑는 검색어(`YOUTUBE_SEARCH_QUERY`)에 의존하므로, 게임명을 어디에도 안 적은 방송은 놓친다. 반대로 검색은 관련성 기반이라 엉뚱한 방송도 물어오는데, 이건 `YOUTUBE_MATCH_TERMS`로 한 번 더 거른다.

---

## 🔎 최근 N일 방송한 사람 찾기

### 왜 기록부터 하나

플랫폼 검색으로 과거를 되짚는 데는 구멍이 있다. **트위치는 VOD를 안 남기면 방송이 끝나는 순간
공개된 흔적이 없고**, 나머지 셋은 제목·태그에 게임명을 안 쓰면 애초에 검색에 안 걸린다.
그래서 봇이 **1분마다 훑어서 그때 켜져 있던 사람을 직접 적어둔다**(`data/streams.json`).
방송이 끝나 플랫폼에서 사라져도 우리 기록엔 남는다.

기록 단위는 목격 1건이 아니라 **방송 1회**다 — 5시간 방송을 1분마다 봐도 한 줄이고,
`lastSeenAt`·최고 시청자수만 갱신된다. 기본 14일 보관.

| 플랫폼 | 훑는 주기 | 왜 |
| --- | --- | --- |
| Twitch | **60초** | Helix 카테고리 조회. 요청 1회/분이라 rate limit(800/분) 대비 여유 |
| 비리비리 | **60초** | 공개 웹 검색 — **라이브 알림도 이 폴링을 같이 쓴다** |
| 니코니코 | **60초** | 생방송 검색 — **라이브 알림도 이 폴링을 같이 쓴다** |
| YouTube | **15분** | `search.list` 가 **하루 100회** 한도라 1분 폴링이 물리적으로 불가능하다. 알림 폴링(15분) 결과를 그대로 얻어 적으므로 **추가 요청 0회** |

### 뽑기

```bash
npm run find-streamers                            # 최근 3일 (기록 + 플랫폼 검색)
node scripts/find-streamers.js --days 7
node scripts/find-streamers.js --source log       # 우리 기록만 — 외부 요청 0회, 즉시
node scripts/find-streamers.js --source api       # 지금 플랫폼에서 검색만
node scripts/find-streamers.js --json
```

```
# Deadly Trick — 최근 3일 방송자 (08. 22. 22:08 ~ 08. 25. 22:08, KST)
총 2명 / 방송·영상 2건

## 니코니코 — 1명
- 放送者 — 🔴 방송중 · 120
    デッドリートリック 実況
    https://live.nicovideo.jp/watch/lv1

## Twitch — 1명
- 아무개 — 08. 24. 19:08 · 340
    데들리 트릭 8인 합방
    https://twitch.tv/nobody
```

기본값(`--source both`)은 **우리 기록 + 지금 플랫폼에서 되짚을 수 있는 것**(트위치 VOD,
유튜브 종료 방송, 비리비리 투고, 니코니코 영상)을 합쳐 사람 단위로 병합한다 — 봇을 띄우기
전 기간도 검색으로는 어느 정도 메워진다. 같은 방송이 양쪽에서 들어오면 한 번만 센다.
플랫폼 하나가 실패해도 나머지는 그대로 나오고(`⚠️`), 자격증명이 없으면 건너뛴다(`⏭`).

| 플랫폼 | 필요한 것 | 검색으로 되짚는 범위 |
| --- | --- | --- |
| **Twitch** | `TWITCH_CLIENT_ID` + `TWITCH_CLIENT_SECRET` | 카테고리 기준 현재 방송 + 지난 VOD. **가장 정확** |
| **YouTube** | `YOUTUBE_API_KEY` | 검색어로 진행중·종료된 라이브. 실행 1회당 `search.list` 2회 소모 |
| **비리비리** | 없음 (막히면 `BILIBILI_COOKIE`) | 방송중인 방 + 최근 투고 영상 |
| **니코니코** | 없음 | 방송중·최근 종료 + 스냅샷 검색(영상) |

> ⚠️ **기록기를 켜두기 전 기간**은 여전히 검색의 한계를 그대로 받는다(게임명을 안 쓴 방송,
> VOD 없는 트위치 방송은 못 찾는다). 그 구멍을 메우는 게 기록기이므로, 봇을 계속 띄워두는
> 게 정확한 명단을 얻는 유일한 방법이다. 설계는
> `docs/superpowers/specs/2026-08-25-multi-platform-streamer-finder-design.md` 참고.

---

## 🛠 로컬 개발

```bash
npm ci            # 전체 의존성
npm test          # 테스트 (node --test)
npm run dev       # --watch 로 실행 (.env 필요)
```
