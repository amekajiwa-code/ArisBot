# 🤖 ArisBot (알림 전용)

> Steam 동접자 · Twitch · 치지직 카테고리 라이브를 감시해 Discord 채널로 알려주는 봇.
> 클라우드 VM(예: Google Cloud `e2-micro`, Ubuntu)에서 24시간 구동한다.

<p align="center">
  <img src="https://img.shields.io/badge/platform-Linux%20VM-FCC624?style=for-the-badge&logo=linux&logoColor=black" alt="Linux VM">
  <img src="https://img.shields.io/badge/node-%E2%89%A520.6-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Node 20.6+">
</p>

---

## 무슨 봇인가

디스코드에 로그인해 아래 셋을 주기적으로 폴링하고, 변동이 생기면 지정 채널로 임베드를 보낸다.

| 알림 | 조건 |
| --- | --- |
| **Steam 동접자** | 직전 알림값보다 `THRESHOLD` 이상 **증가**했고 현재 동접이 `MIN_COUNT` 이상일 때 SteamDB 링크 임베드 |
| **Twitch 라이브** | 지정 카테고리에 새 방송이 켜지면 "{채널}님이 {카테고리} 방송중!" 임베드 |
| **치지직 라이브** | 지정 카테고리에 새 방송이 켜지면 동일 형식 임베드 (공식 Open API 한계상 시청자 상위권만 훑음) |

슬래시 명령·메시지 응답·원격제어 기능은 **없다**. 알림만 보낸다. 들어오는 이벤트가 없으니 디스코드 포털에서 **Message Content / Presence 등 privileged intent를 켤 필요가 없다.** 봇은 서버에 초대돼 **메시지 보내기** 권한만 있으면 된다.

각 알림 소스는 해당 자격증명/채널을 채웠을 때만 켜지고, 비워두면 조용히 꺼진다. 셋 다 안 채우면 경고만 찍고 아무 알림도 안 보낸다.

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

> 채널 id는 디스코드에서 **사용자 설정 → 고급 → 개발자 모드**를 켠 뒤 채널 우클릭 → **채널 ID 복사**.
> Twitch·치지직 알림 채널을 따로 안 정하면 `STEAM_ALERT_CHANNEL_ID`와 같은 채널을 쓴다.

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

---

## 🛠 로컬 개발

```bash
npm ci            # 전체 의존성
npm test          # 테스트 (node --test)
npm run dev       # --watch 로 실행 (.env 필요)
```
