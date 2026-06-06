# ArisBot

Discord에서 내 PC의 로컬 Claude(Claude Code)를 제어하는 1인용 봇. 각자 자기 봇 토큰으로 자기 PC에서 구동한다.

## 셋업

1. `npm install`
2. Discord Developer Portal에서 봇 생성 → 토큰 발급, **Message Content Intent** 켜기, 서버에 초대.
3. `.env.example` → `.env` 복사 후 채우기:
   - `DISCORD_BOT_TOKEN` — 봇 토큰
   - `ALLOWED_USER_ID` — 내 디스코드 사용자 id (개발자 모드 → 사용자 우클릭 → ID 복사)
   - `PROJECT_DIR` — Claude가 작업할 프로젝트 폴더 절대경로
   - (선택) `NOTIFY_SECRET` — 작업 완료 알림을 쓰려면 임의의 긴 문자열
4. 실행: `npm start` (또는 `start_bot.exe` — 아래 빌드 참고)
5. 디스코드에서 원하는 채널에 `/start` → 채널 바인딩 + 알림 훅 설치
6. `/talk <메시지>` 또는 그 채널에 그냥 메시지 입력으로 대화

## 자동 실행 (Windows)

- 빌드: `npm run build:exe` → `start_bot.exe` 생성 (`node`가 PATH에 있어야 함)
- 자동 시작 등록: `start_bot.exe --setup` (로그인 시 자동 실행)
- 해제: `start_bot.exe --unsetup`

## 명령

- `/start` — 이 채널을 봇에 연결 + 알림 훅 설치
- `/talk <메시지>` — 로컬 Claude에게 전달 (바인딩 채널의 평문 메시지도 동일 처리)
