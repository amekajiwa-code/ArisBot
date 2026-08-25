# 🤖 ArisBot (알림 전용)

> Steam 동접자 · Twitch · 치지직 · YouTube(VTuber) 카테고리 라이브를 감시해 Discord 채널로 알려주는 봇.
> 클라우드 VM(예: Google Cloud `e2-micro`, Ubuntu)에서 24시간 구동한다.

<p align="center">
  <img src="https://img.shields.io/badge/platform-Linux%20VM-FCC624?style=for-the-badge&logo=linux&logoColor=black" alt="Linux VM">
  <img src="https://img.shields.io/badge/node-%E2%89%A520.6-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Node 20.6+">
</p>

---

## 무슨 봇인가

디스코드에 로그인해 아래 넷을 주기적으로 폴링하고, 변동이 생기면 지정 채널로 임베드를 보낸다.

| 알림 | 조건 |
| --- | --- |
| **Steam 동접자** | 직전 알림값보다 `THRESHOLD` 이상 **증가**했고 현재 동접이 `MIN_COUNT` 이상일 때 SteamDB 링크 임베드 |
| **Twitch 라이브** | 지정 카테고리에 새 방송이 켜지면 "{채널}님이 {카테고리} 방송중!" 임베드 |
| **치지직 라이브** | 지정 카테고리에 새 방송이 켜지면 동일 형식 임베드 (공식 Open API 한계상 시청자 상위권만 훑음) |
| **YouTube 라이브** | 지정 검색어로 라이브를 훑어 동일 형식 임베드 (공식 API 쿼터 한도상 15분 주기) |

슬래시 명령·메시지 응답·원격제어 기능은 **없다**. 알림만 보낸다. 들어오는 이벤트가 없으니 디스코드 포털에서 **Message Content / Presence 등 privileged intent를 켤 필요가 없다.** 봇은 서버에 초대돼 **메시지 보내기** 권한만 있으면 된다.

각 알림 소스는 해당 자격증명/채널을 채웠을 때만 켜지고, 비워두면 조용히 꺼진다. 넷 다 안 채우면 경고만 찍고 아무 알림도 안 보낸다.

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

`.env.example`에 각 항목의 의미가 주석으로 달려 있다. 폴링 주기(`*_POLL_INTERVAL_SEC`, 기본 600초), 시청자 하한(`*_ALERT_MIN_VIEWERS`), 치지직 스캔 깊이(`CHZZK_MAX_PAGES`) 등을 조절할 수 있다.

> ⚠️ **치지직 공식 Open API에는 카테고리 필터가 없다.** 전체 라이브 중 시청자수 상위 `CHZZK_MAX_PAGES × 20`개만 훑어 카테고리가 일치하는 방송을 찾으므로, 시청자가 적은 소규모 카테고리는 상위권에 안 떠 놓칠 수 있다.
>
> ⚠️ **YouTube의 `search.list`는 하루 100회가 한도다.** (다른 엔드포인트의 10,000 unit 풀과 별개인 전용 버킷.) 그래서 `YOUTUBE_POLL_INTERVAL_SEC` 기본값이 900초(15분, 하루 96회)이고, 이보다 짧게 두면 기동 시 경고가 뜨고 그날 쿼터를 태워버린다. 시청자수는 검색 응답에 없어 `videos.list`로 한 번 더 조회해 채운다(1 unit).
>
> ⚠️ **YouTube엔 게임 카테고리로 라이브를 조회하는 API가 없다.** 제목·설명·태그를 훑는 검색어(`YOUTUBE_SEARCH_QUERY`)에 의존하므로, 게임명을 어디에도 안 적은 방송은 놓친다. 반대로 검색은 관련성 기반이라 엉뚱한 방송도 물어오는데, 이건 `YOUTUBE_MATCH_TERMS`로 한 번 더 거른다.

---

## 🔎 최근 N일 방송한 사람 찾기 (일회성 CLI)

알림은 "지금 켜진 방송"만 본다. **"지난 3일 안에 이 게임 방송한 사람 다 뽑아줘"** 는
별도 CLI로 한다. 봇을 안 띄우고도 돌아간다.

```bash
node scripts/find-streamers.js                 # 최근 3일 (기본)
node scripts/find-streamers.js --days 7        # 최근 7일
node scripts/find-streamers.js --json          # 기계용 출력
npm run find-streamers -- --days 3             # .env 를 읽어서 실행
```

```
# Deadly Trick — 최근 3일 방송자 (08. 22. 21:56 ~ 08. 25. 21:56, KST)
총 12명 / 방송·영상 19건

## Twitch — 5명
- 아무개 ×2 — 🔴 방송중 · 340
    오늘도 추리방송
    https://www.twitch.tv/nobody
...
⏭  YouTube: YOUTUBE_API_KEY 미설정 — 건너뜀
⚠️  비리비리 조회 실패: bilibili video code -412 (풍제어 — BILIBILI_COOKIE 에 …)
```

같은 사람이 여러 번 방송했으면 `×N` 으로 묶고 가장 최근 방송을 보여준다.
자격증명이 없는 플랫폼은 `⏭` 로 건너뛰고, 한 곳이 실패해도 나머지는 그대로 나온다.

| 플랫폼 | 필요한 것 | 어떻게 찾나 |
| --- | --- | --- |
| **Twitch** | `TWITCH_CLIENT_ID` + `TWITCH_CLIENT_SECRET` | 카테고리(game_id)로 현재 방송 + 지난 VOD. **가장 정확** |
| **YouTube** | `YOUTUBE_API_KEY` | 검색어로 진행중·종료된 라이브. 실행 1회당 `search.list` 2회 소모(하루 100회 한도) |
| **비리비리** | 없음 (막히면 `BILIBILI_COOKIE`) | 웹 검색 — 방송중인 방 + 최근 투고 영상 |
| **니코니코** | 없음 | 스냅샷 검색 API(영상) + 생방송 검색(방송중·최근 종료) |

> ⚠️ **"전부"의 한계.** 게임 카테고리로 정확히 뒤질 수 있는 건 Twitch뿐이고, 나머지 셋은
> 검색어 기반이라 **제목·설명·태그 어디에도 게임명을 안 쓴 방송은 원리상 못 찾는다.**
> 트위치도 VOD를 안 남기는 채널은 방송이 끝나면 공개된 흔적이 없다. 자세한 건
> `docs/superpowers/specs/2026-08-25-multi-platform-streamer-finder-design.md` 참고.

---

## 🛠 로컬 개발

```bash
npm ci            # 전체 의존성
npm test          # 테스트 (node --test)
npm run dev       # --watch 로 실행 (.env 필요)
```
