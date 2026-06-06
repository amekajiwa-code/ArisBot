# ArisBot v1 설계 — 분산형 1인 1봇 + 로컬 Claude 제어

- 작성일: 2026-06-06
- 상태: 설계(승인 대기)

## 1. 목적

이 프로젝트를 받은 사람마다 자기 디스코드 봇 토큰으로 **자기 PC에서 봇 1개를 구동**하고,
디스코드 채널을 통해 **자기 로컬 Claude(Claude Code)를 제어**한다.

- 클라우드/터널 없음. 봇은 디스코드로 **아웃바운드 연결만** 사용한다.
- 아무도 서로의 네트워크로 인바운드 접속하지 않는다(디스코드가 공용 허브).
- 최종 목표인 "각자의 Claude끼리 통신"은 **v1 범위 밖**(별도 단계).

## 2. 범위

### 포함 (v1)
- 1인 전용 봇: 하드코딩된 사용자 + 바인딩된 채널에서만 동작
- `/start`: 채널 바인딩 + 알림 훅 설치(원커맨드 셋업)
- `/talk`: 로컬 Claude에 메시지 전달 후 응답 회신
- 바인딩 채널에서 평문 메시지도 Claude로 전달(편의, 기본 ON)
- 작업 완료 알림(notify 훅 → 봇 → 채널)
- PC 부팅(로그인) 시 봇 자동 실행

### 제외 (다음 단계)
- Claude ↔ Claude 통신(다른 봇이 올린 메시지 라우팅)
- 원격 팀원/터널, 클라우드(GCP) 배포
- 동적 로그인/페어링/멀티 채널 매핑

## 3. 아키텍처

```
[내 PC] node src/index.js (PROJECT_DIR 에서 askClaude 실행)
   └──(아웃바운드)──> Discord <── 내가 #바인딩채널 에서 /talk · 평문

다른 사람도 동일하게 자기 토큰·자기 PC·자기 채널로 독립 구동.
```

- 봇 프로세스 1개 = 사용자 1명 = 채널 1개 = 프로젝트 폴더 1개.
- Claude 세션은 채널 id를 키로 멀티턴 유지(`src/claude.js` 기존 로직 그대로).

## 4. 설정 (`.env`)

| 키 | 필수 | 설명 |
|---|---|---|
| `DISCORD_BOT_TOKEN` | ✅ | 자기 봇 토큰(개발자 포털 1회 발급) |
| `ALLOWED_USER_ID` | ✅ | 이 봇이 따르는 유일한 디스코드 사용자 id(보안 앵커) |
| `PROJECT_DIR` | ✅ | Claude가 작업할 프로젝트 폴더 절대경로 |
| `CLAUDE_MODEL` | ⬜ | 비우면 Claude Code 기본 |
| `NOTIFY_SECRET` | ⬜ | 알림 훅과 공유하는 비밀키(알림 사용 시) |
| `NOTIFY_PORT` | ⬜ | 기본 8787(알림 사용 시) |

- **채널 id는 .env에 없음.** `/start`가 런타임에 현재 채널을 포착해 `binding.json`에 저장(재시작해도 유지).
- `config.js`가 필수값 누락 시 종료, `PROJECT_DIR` 존재/디렉터리 여부 검증.

## 5. 컴포넌트 (파일 단위)

| 파일 | v1 변화 |
|---|---|
| `src/index.js` | **대폭 축소** — 게이트 + `/start`·`/talk`·평문 처리만 |
| `src/claude.js` | **유지**(핵심) |
| `src/discord-utils.js` | **유지** |
| `src/config.js` | **수정** — 새 설정 검증(`ALLOWED_USER_ID`, `PROJECT_DIR`) |
| `src/commands.js` | **축소** — `/start`, `/talk` 정의만 |
| `src/binding.js` | **신규** — 바인딩 채널 id 저장/로드(`binding.json`) |
| `src/notify-server.js` | **유지·단순화** — 라우팅 제거, 바인딩 채널로 직송 |
| `src/install-hook.js` | **유지** — 호출 위치를 `/start`로 이동 |
| `src/access.js` | ❌ 삭제(하드코딩으로 대체) |
| `src/pairing.js` | ❌ 삭제 |
| `src/projects.js` | ❌ 삭제(`PROJECT_DIR` 하나로 축소) |
| `src/actions.js` | ❌ 삭제(login/link 등 소멸) |
| `bin/link.js` | ❌ 삭제 |

상태 파일: `binding.json`(채널 id) 1개만. (기존 `channel-owners.json`, `projects.json`, `pending-links.json` 폐기)

## 6. 명령 사양

### `/start`
- 권한: `interaction.user.id === ALLOWED_USER_ID` 만 허용(아니면 ephemeral 거부).
- 동작:
  1. 현재 채널 id를 바인딩으로 `binding.json`에 저장(이미 있으면 갱신).
  2. `PROJECT_DIR` 검증, `install-hook.js`로 `PROJECT_DIR/.claude/settings.json`에 notify 훅 주입.
  3. "준비 완료: 이제 `/talk` 또는 그냥 메시지로 대화하세요" + 인식된 폴더·채널 안내.

### `/talk <메시지>`
- 게이트: `user === ALLOWED_USER_ID && channelId === 바인딩채널`.
- 미바인딩 시: "`/start` 먼저 하세요".
- 동작: `askClaude(channelId, message, PROJECT_DIR, { model })` → `splitMessage`로 분할 회신.

### 평문 메시지 (명령 아님, 편의 기능)
- 바인딩 채널에서 주인이 보낸 평문(봇/명령 아님)은 `/talk`와 동일하게 Claude로 전달.
- 멘션도 동일 처리.

## 7. 데이터 흐름 (`/talk` 한 턴)

1. 주인이 `#바인딩채널`에서 `/talk 메시지`(또는 평문) 입력.
2. 봇 게이트 확인 → 실패 시 ephemeral 거부 + 로그.
3. `askClaude(channelId, msg, PROJECT_DIR, {model})` 실행(멀티턴 세션).
4. 결과를 `splitMessage`로 쪼개 채널에 순차 전송.

## 8. 에러 처리

- 게이트 실패: 조용히 ephemeral 거부, 서버 로그만 남김.
- 바인딩 없음 + `/talk`: 안내 메시지.
- Claude 오류: `claude.js`의 `result.subtype` 비-success 처리 유지 + 채널에 `⚠️` 안내.
- `PROJECT_DIR` 부적합: `/start` 및 부팅 시 검증·경고.
- notify 포트 충돌(EADDRINUSE): 기존 경고 로그 유지.

## 9. 알림 (notify)

- `notify-server.js`는 `127.0.0.1` 전용 유지(외부 노출 금지).
- 라우팅 로직 제거 → 수신 즉시 **바인딩 채널로 직송**.
- 훅 설치는 `/start`가 담당(`install-hook.js` 재사용).

## 10. 테스트

순수/단위 테스트 위주(디스코드·Claude는 모킹):
- `config.js`: 필수 누락 시 종료, `PROJECT_DIR` 검증.
- `binding.js`: 저장/로드/갱신 라운드트립.
- 게이트 로직: 사용자·채널 일치/불일치 매트릭스.
- `discord-utils.splitMessage`: 경계값(1900자, 단일 초과 라인).

## 11. 결정 기록 (해소된 항목)

- 연결: 디스코드 아웃바운드만(별도 WS/터널/클라우드 없음).
- 봇 모델: 1인 1봇(각자 자기 토큰).
- 접근제어: `.env` 하드코딩(`ALLOWED_USER_ID`) + `/start` 채널 바인딩.
- 프로젝트 폴더: `.env`의 `PROJECT_DIR`(수동 명시) — 봇 설치 위치와 분리.
- 명령: `/start`, `/talk` 둘만. 평문 전달 기본 ON.
- 실행 진입점: `start_bot.exe`. 자동 실행은 로그인 시(사용자 세션), SYSTEM 서비스 아님.

## 12. 자동 실행 (`start_bot.exe` + 로그인 시 자동 시작)

### 실행 진입점: `start_bot.exe`
- 봇을 시작하는 단일 실행파일. 더블클릭/자동실행 모두 이걸 가리킴.
- 생성 방법: Node SEA(Single Executable Application) 또는 `pkg`로 `src/index.js`를 번들해 `start_bot.exe` 산출.
  `.env`는 실행파일 옆에서 읽음. `claude` CLI는 PC에 별도 설치 전제(Agent SDK가 호출).
- (참고) 빌드 toolchain이 부담이면 `start_bot.cmd`(= `node --env-file=.env src/index.js`)로도 동일 동작 가능하나, 요청에 따라 명칭은 `start_bot.exe`로 통일.

### 자동 실행 = "로그인 시" (사용자 세션)
- **반드시 로그인한 사용자 세션에서 구동.** Claude Code가 사용자 PATH·로그인 자격증명·환경을 쓰기 때문에 SYSTEM 권한 백그라운드 서비스로는 인증이 안 잡힐 수 있음.
- 기본 방식: **시작프로그램 폴더**(`shell:startup`)에 `start_bot.exe` 바로가기 생성 — 관리자 권한 불필요, 가장 단순.
- 대안: **작업 스케줄러** "로그온 시" 트리거(실패 시 자동 재시작 옵션 가능).

### 등록/해제
- `start_bot.exe --setup` 1회 실행 → 자동 시작 항목 등록.
- `start_bot.exe --unsetup` → 자동 시작 해제.
- (또는 사용자가 시작프로그램 폴더에 바로가기 수동 배치)
