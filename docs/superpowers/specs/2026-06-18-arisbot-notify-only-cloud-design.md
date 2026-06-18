# ArisBot → 알림 전용 클라우드 봇 설계

- 날짜: 2026-06-18
- 상태: 승인됨 (사용자 승인 후 구현)
- 적용 방식: 현재 레포 `main`에 in-place 전환

## 배경 / 목적

기존 ArisBot은 Windows 트레이 앱(EXE 런처)으로 로컬 PC에서 구동되며 두 가지 일을 했다.

1. **Claude 원격제어** — 디스코드에서 `/start`·`/talk`·평문 메시지로 로컬 Claude(Claude Code)를 조종하고, Claude Code 훅이 작업 완료를 HTTP로 봇에 알리면(`notify-server`) 바인딩된 채널로 전달.
2. **알림** — Steam 동접자·Twitch·치지직 카테고리 라이브를 주기 폴링해 지정 채널로 임베드 전송.

이번 작업은 **①을 전부 제거하고 ②만 남겨, Google Cloud(Compute Engine `e2-micro`, Ubuntu, Always Free 티어)에서 24시간 구동하는 알림 전용 봇**으로 전환한다.

기존 v1 아키텍처 메모(분산형 1인 1봇, 클라우드/터널 없음, 원격제어 중심)는 이 전환으로 폐기된다 — v2는 클라우드 단일 인스턴스 알림봇이다.

## 아키텍처

디스코드에 로그인한 단일 Node 프로세스가 Steam·Twitch·치지직을 주기 폴링하고, 변동이 생기면 지정 채널로 임베드를 전송하는 것이 전부다.

- 슬래시 명령 / 메시지 수신 / HTTP notify 서버 / 채널 바인딩 / 접근 게이트 — 전부 제거.
- 들어오는 이벤트가 없으므로 **privileged intent 불필요**. 인텐트는 `Guilds` 하나만 사용 → 디스코드 포털에서 Message Content Intent를 켤 필요 없음.
- 봇은 채널 ID(`*_ALERT_CHANNEL_ID`)로 `channels.fetch(id).send(payload)` 만 한다. 채널 바인딩 개념 없음.
- 세 알림 소스는 각자 자격증명/채널이 채워졌을 때만 켜진다(기존 동작 유지).

## 파일 변경

### 삭제 (src)
`claude.js`, `discord-utils.js`, `install-hook.js`, `notify-server.js`, `binding.js`, `commands.js`, `gate.js`

### 유지 (src)
`steam.js`·`steam-watch.js`, `twitch.js`·`twitch-watch.js`, `chzzk.js`·`chzzk-watch.js`

### 수정 (src)
- `config.js` — Claude/notify/binding 관련 필드 제거(`allowedUserId`, `projectDir`, `model`, `notifySecret`, `notifyPort`, `maxPrompt`). `PROJECT_DIR` 존재 검사 제거. 남는 필수값은 `DISCORD_BOT_TOKEN` 뿐. Steam/Twitch/치지직 필드는 그대로.
- `index.js` — Claude/명령/메시지/notify/binding/gate import 및 핸들러 전부 제거. 인텐트 `Guilds` 하나로 축소. `ClientReady`에서 세 워처만 기동. 알림 채널이 하나도 설정되지 않았으면 경고 로그.

### 삭제 (test)
`assets.test.js`, `binding.test.js`, `commands.test.js`, `discord-utils.test.js`, `gate.test.js`, `pe-subsystem.test.js`

### 유지/수정 (test)
- 유지: `steam*`, `twitch*`, `chzzk*` 테스트.
- 수정: `config.test.js` — 제거된 필드(allowedUserId/projectDir/notify/maxPrompt) 검증 삭제, `base`에서 `ALLOWED_USER_ID`·`PROJECT_DIR` 제거하고 `DISCORD_BOT_TOKEN`만 필수로.

### 삭제 (기타)
- `scripts/`(build-exe·build-zip·launcher·pe-subsystem·sea-config·sea-prep.blob·tray.ps1)
- `start_bot.exe`, `start-bot.cmd`
- `dist/`
- `assets/aris.png`
- `binding.json`

### package.json
- 의존성 `@anthropic-ai/claude-agent-sdk` 제거 → 런타임 의존성은 `discord.js` 하나.
- 스크립트 `build:exe`·`build:zip`·`build:release` 제거. `start`·`dev`·`test`만 유지.
- `name`/`description`을 알림봇으로 갱신.

### .env / .env.example (트림)
- 제거: `ALLOWED_USER_ID`, `PROJECT_DIR`, `NOTIFY_SECRET`, `NOTIFY_PORT`, `CLAUDE_MODEL`, `ANTHROPIC_API_KEY`
- 유지: `DISCORD_BOT_TOKEN` + `STEAM_*` + `TWITCH_*` + `CHZZK_*`

### .gitignore
EXE/dist/binding 등 사라진 산출물 항목 정리(무해하나 정돈).

## 배포 산출물

- `deploy/arisbot.service` — systemd 유닛. `ExecStart=node --env-file=.env src/index.js`, `Restart=always`, `WorkingDirectory` 지정, 로그는 journald로.
- `README.md` 재작성 — Windows 트레이/EXE/`/start`·`/talk` 안내 제거. **Ubuntu VM 배포 가이드**로 교체: Node 20+ 설치 → clone → `npm ci --omit=dev` → `.env` 작성 → systemd 등록/기동/로그 확인.

Docker는 포함하지 않는다(e2-micro엔 systemd가 더 가벼움). 추후 필요 시 Dockerfile 추가는 간단.

## 검증

- `npm test` — 남긴 워처/config 테스트 통과.
- `node --check src/index.js`, `node --check src/config.js` 등 문법 확인.
- 실제 디스코드 토큰 구동은 사용자 클라우드 환경에서.

## 비목표 (YAGNI)

- Docker 이미지화, 멀티 인스턴스, 웹 대시보드, 추가 알림 소스, Claude 관련 기능 일체.
