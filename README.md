# 🤖 ArisBot

> Steam 동접자 · Twitch · 치지직 · YouTube(VTuber) 카테고리 라이브를 감시해 Discord 채널로 알려주는 봇.
> 덤으로 **즌다몬이 한국어로 말해 주는 TTS**(`/say`)가 붙어 있다.
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

각 알림 소스는 해당 자격증명/채널을 채웠을 때만 켜지고, 비워두면 조용히 꺼진다. 아무것도 안 채우면 경고만 찍고 가만히 있는다.

여기에 더해 `VOICEVOX_BASE_URL`을 채우면 **즌다몬 TTS**가 켜진다(아래 참고).

디스코드 포털에서 **privileged intent를 켤 필요가 없다.** 슬래시 명령어와 음성 접속은 특권 인텐트를 쓰지 않는다. (유일한 예외가 `TTS_MESSAGE_PREFIX`이고, 그래서 기본으로 꺼져 있다.)

---

## 🗣️ 즌다몬 TTS

`/say 안녕하세요` 를 치면 즌다몬이 **내가 들어가 있는 음성 채널로 따라 들어와** 그 말을 읽는다.

| 명령어 | 하는 일 |
| --- | --- |
| `/say <내용>` | 음성 채널에서 그 내용을 즌다몬 목소리로 읽는다 |
| `/leave` | 음성 채널에서 나간다 (`TTS_IDLE_TIMEOUT_SEC` 동안 조용하면 알아서도 나간다) |

### 엔진 두 가지 — 한국어를 대하는 방식이 다르다

| | **GPT-SoVITS** (권장) | **VOICEVOX** |
| --- | --- | --- |
| 한국어 | **진짜 한국어 발음** (다국어 모델) | 가타카나로 음차 → "일본인이 읽는 한국어" |
| 필요한 것 | **GPU** (CUDA), 수 GB 모델 | CPU만, 램 2GB |
| 합성 속도 | 문장당 수 초 | 빠름 |
| 설정 | `GPT_SOVITS_BASE_URL` | `VOICEVOX_BASE_URL` |

둘 다 채우면 GPT-SoVITS가 선택된다. GPU가 없으면 VOICEVOX 쪽이 유일한 선택지다.

#### GPT-SoVITS — 진짜 한국어

[zundamon-speech-webui](https://github.com/zunzun999/zundamon-speech-webui)가 GPT-SoVITS를 즌다몬 목소리로 파인튜닝해 놓은 걸 쓴다. GPT-SoVITS v2는 한국어(`all_ko`)를 지원하므로 **한글을 음차 없이 그대로 넘기면 제대로 된 한국어 발음이 나온다.**

먼저 위 저장소의 안내대로 모델을 내려받은 뒤, WebUI 대신 동봉된 **API 서버**를 띄운다.

```bash
# zundamon-speech-webui/GPT-SoVITS 에서
python api_v2.py -a 0.0.0.0 -p 9880
```

이 모델은 few-shot 음성 복제 방식이라 **참조 음성이 있어야 목소리가 정해진다.** 저장소의 `reference/reference.wav`와 그 안의 대사(`reference/ref_text.txt`)를 그대로 쓰면 된다. 경로는 **봇이 아니라 API 서버 쪽 파일 시스템 기준**이다.

```bash
GPT_SOVITS_BASE_URL=http://192.168.0.10:9880
GPT_SOVITS_REF_AUDIO_PATH=/path/to/zundamon-speech-webui/reference/reference.wav
GPT_SOVITS_PROMPT_TEXT=流し切りが完全に入ればデバフの効果が付与される
```

> ℹ️ 영어 낱말이 섞인 문장이 많으면 `GPT_SOVITS_TEXT_LANG=ko`(한영 혼용)로 두면 된다. 기본값은 `all_ko`.

#### VOICEVOX — GPU 없이

> ⚠️ **VOICEVOX는 일본어 전용 엔진이다.** 한글을 그대로 넘기면 한 글자도 못 읽는다.

그래서 봇이 한글을 **가타카나로 음차해서** 넘긴다. 일본어에 없는 대립(ㅓ/ㅗ, ㅡ/ㅜ, ㄴ받침/ㅇ받침)은 한쪽으로 뭉개지므로 발음이 어눌하다.

다만 철자를 그대로 읽으면 알아들을 수조차 없어서, 회화에서 늘 발동하는 음운 규칙 넷은 적용한다.

| 규칙 | 없으면 | 있으면 |
| --- | --- | --- |
| 연음 | 한국어 → `ハンククオ` | `ハングゴ` |
| 평음 유성음화 | 불고기 → `プルコキ` | `プルゴギ` |
| 비음화 | 감사합니다 → `カムサハプニタ` | `カムサハムニダ` |
| 유음화 | 연락 → `ヨンラク` | `ヨルラク` |

ㄹ비음화(종로 → 종노)와 구개음화(굳이 → 구지)는 구현 범위 밖이라 철자대로 읽힌다.

엔진은 별도 프로세스다. 도커가 제일 간단하다.

```bash
docker run -d --restart unless-stopped -p 127.0.0.1:50021:50021 \
  --name voicevox voicevox/voicevox_engine:cpu-latest
```

```bash
VOICEVOX_BASE_URL=http://127.0.0.1:50021
```

음차한 결과는 `/say` 응답 임베드 아래에 같이 뜨므로, 발음이 이상하면 왜 그런지 바로 보인다. (GPT-SoVITS는 원문 그대로 읽으니 뜨지 않는다.)

#### 어느 쪽이든

> ⚠️ **엔진은 `e2-micro`(1GB)에 안 올라간다.** VOICEVOX는 램 2GB 남짓, GPT-SoVITS는 GPU까지 필요하다. 알림 봇과 같은 VM에 두려면 인스턴스를 키우고, 그러기 싫으면 엔진만 다른 호스트(집 PC 등)에 두고 그 주소를 적으면 된다. 알림 기능만 쓸 거면 두 URL을 다 비워두면 그만이다.
>
> ℹ️ **봇 쪽에 ffmpeg은 필요 없다.** VOICEVOX에는 디스코드가 쓰는 48kHz 스테레오로 바로 구워 달라고 요청하고, GPT-SoVITS가 주는 32kHz 모노는 봇이 직접 리샘플한다. Opus 인코더도 순수 JS(`opusscript`)라 네이티브 빌드 단계가 없다.

### 봇 초대 권한

TTS를 쓰려면 봇을 **`applications.commands` 스코프로 다시 초대**해야 슬래시 명령어가 뜬다. 음성 채널에는 **연결**과 **말하기** 권한이 필요하다.

명령어는 기본적으로 전역 등록되는데 디스코드 반영까지 최대 1시간 걸린다. 바로 확인하고 싶으면 `.env`에 `TTS_COMMAND_GUILD_ID`로 서버 id를 적으면 그 서버에 즉시 등록된다.

### `say: 안녕` 처럼 메시지로 부르기

`TTS_MESSAGE_PREFIX=say:` 를 채우면 슬래시 명령어 대신 그냥 채팅으로도 부를 수 있다. 대신 **디스코드 포털에서 MESSAGE CONTENT INTENT를 켜야 한다** — 이 봇에서 특권 인텐트가 필요한 유일한 기능이라 기본은 꺼져 있다.

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
| `GPT_SOVITS_BASE_URL` _(선택)_ | 채우면 즌다몬 TTS(`/say`) 켜짐 — 진짜 한국어 발음, GPU 필요 |
| `VOICEVOX_BASE_URL` _(선택)_ | 채우면 즌다몬 TTS 켜짐 — GPU 없이 돌지만 가타카나 음차 발음 |

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

`.env.example`에 각 항목의 의미가 주석으로 달려 있다. 폴링 주기(`*_POLL_INTERVAL_SEC`, 기본 600초), 시청자 하한(`*_ALERT_MIN_VIEWERS`), 치지직 스캔 깊이(`CHZZK_MAX_PAGES`), 즌다몬의 화자·속도(`VOICEVOX_SPEAKER`, `VOICEVOX_SPEED_SCALE`) 등을 조절할 수 있다.

> ⚠️ **치지직 공식 Open API에는 카테고리 필터가 없다.** 전체 라이브 중 시청자수 상위 `CHZZK_MAX_PAGES × 20`개만 훑어 카테고리가 일치하는 방송을 찾으므로, 시청자가 적은 소규모 카테고리는 상위권에 안 떠 놓칠 수 있다.
>
> ⚠️ **YouTube의 `search.list`는 하루 100회가 한도다.** (다른 엔드포인트의 10,000 unit 풀과 별개인 전용 버킷.) 그래서 `YOUTUBE_POLL_INTERVAL_SEC` 기본값이 900초(15분, 하루 96회)이고, 이보다 짧게 두면 기동 시 경고가 뜨고 그날 쿼터를 태워버린다. 시청자수는 검색 응답에 없어 `videos.list`로 한 번 더 조회해 채운다(1 unit).
>
> ⚠️ **YouTube엔 게임 카테고리로 라이브를 조회하는 API가 없다.** 제목·설명·태그를 훑는 검색어(`YOUTUBE_SEARCH_QUERY`)에 의존하므로, 게임명을 어디에도 안 적은 방송은 놓친다. 반대로 검색은 관련성 기반이라 엉뚱한 방송도 물어오는데, 이건 `YOUTUBE_MATCH_TERMS`로 한 번 더 거른다.

---

## 🛠 로컬 개발

```bash
npm ci            # 전체 의존성
npm test          # 테스트 (node --test)
npm run dev       # --watch 로 실행 (.env 필요)
```
