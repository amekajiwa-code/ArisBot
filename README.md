# 🤖 ArisBot

> Discord에서 내 PC의 로컬 Claude(Claude Code)를 원격 제어하는 1인용 봇.
> 각자 자기 봇 토큰으로 자기 PC에서 구동한다.

<p align="center">
  <a href="https://github.com/amekajiwa-code/ArisBot/releases/latest/download/ArisBot.zip">
    <img src="https://img.shields.io/badge/⬇_ArisBot.zip-다운로드-2ea44f?style=for-the-badge&logo=windows" alt="Download ArisBot.zip">
  </a>
  <a href="https://github.com/amekajiwa-code/ArisBot/releases/latest">
    <img src="https://img.shields.io/github/v/release/amekajiwa-code/ArisBot?style=for-the-badge&label=latest&color=blue" alt="Latest release">
  </a>
  <img src="https://img.shields.io/badge/platform-Windows-0078D6?style=for-the-badge&logo=windows" alt="Windows">
</p>

---

## ⬇️ 다운로드

별도 빌드 없이 바로 쓰려면 zip 묶음을 받으면 된다. (`start_bot.exe` 단독으로는 실행되지 않고, 같이 들어있는 `src/`·`node_modules/`가 옆에 있어야 동작한다.)

### **[📦 ArisBot.zip 최신 버전 받기 →](https://github.com/amekajiwa-code/ArisBot/releases/latest/download/ArisBot.zip)**

> 위 버튼이 안 되면 [릴리즈 페이지](https://github.com/amekajiwa-code/ArisBot/releases/latest)에서 직접 내려받을 수 있다.

> [!IMPORTANT]
> **[Node.js](https://nodejs.org) (20.6 이상)가 설치돼 있어야 한다.** `start_bot.exe`는 봇을 띄워주는 런처라, 실제 구동은 PC에 설치된 `node`로 한다. (`npm install`은 zip에 `node_modules`가 들어있어 따로 안 해도 된다.)

---

## 🚀 셋업

1. **ArisBot.zip 다운로드** 후 원하는 폴더에 압축 풀기.
2. Discord Developer Portal에서 봇 생성 → 토큰 발급, **Message Content Intent** 켜기, 서버에 초대.
3. 압축 푼 폴더의 `.env.example` → `.env` 복사 후 채우기:
   | 키 | 설명 |
   | --- | --- |
   | `DISCORD_BOT_TOKEN` | 봇 토큰 |
   | `ALLOWED_USER_ID` | 내 디스코드 사용자 id (개발자 모드 → 사용자 우클릭 → ID 복사) |
   | `PROJECT_DIR` | Claude가 작업할 프로젝트 폴더 절대경로 |
   | `NOTIFY_SECRET` _(선택)_ | 작업 완료 알림을 쓰려면 임의의 긴 문자열 |
   | `STEAM_ALERT_CHANNEL_ID` _(선택)_ | Steam 동접자 알림을 보낼 채널 id (아래 참고) |
4. **`start_bot.exe` 더블클릭**으로 실행.
   - 콘솔 창은 뜨지 않고 트레이(숨겨진 아이콘)에 아리스 아이콘으로 동작한다. 로그는 `logs/bot.log` 에 쌓인다.
5. 디스코드에서 원하는 채널에 `/start` → 채널 바인딩 + 알림 훅 설치.
6. `/talk <메시지>` 또는 그 채널에 그냥 메시지 입력으로 대화.

---

## ⚙️ 자동 실행 & 트레이 (Windows)

`start_bot.exe` 를 실행하면 **콘솔 창 없이** 시스템 트레이(숨겨진 아이콘 영역)에 아리스 아이콘으로 떠서 백그라운드로 동작한다. 트레이 아이콘을 **우클릭**하면:

| 메뉴 | 동작 |
| --- | --- |
| 봇 재시작 | 봇 프로세스를 중지 후 다시 시작 |
| 로그 보기 | `logs/bot.log` 열기 |
| 자동시작 | 로그인 시 자동 시작 등록/해제 (체크 토글) |
| 종료 | 봇과 트레이 종료 |

명령줄로도 자동시작을 토글할 수 있다(결과는 팝업으로 표시):

| 작업 | 명령 |
| --- | --- |
| 로그인 시 자동 시작 등록 | `start_bot.exe --setup` |
| 자동 시작 해제 | `start_bot.exe --unsetup` |

---

## 💬 명령

| 명령 | 설명 |
| --- | --- |
| `/start` | 이 채널을 봇에 연결 + 알림 훅 설치 |
| `/talk <메시지>` | 로컬 Claude에게 전달 (바인딩 채널의 평문 메시지도 동일 처리) |

---

## 🎮 Steam 동접자 알림 (선택)

내 게임의 현재 동접자 수를 주기적으로 관찰해서, **직전 알림값보다 일정 폭 이상 늘어나면(돌파)** 지정 채널로 SteamDB 링크가 담긴 임베드(봇 메시지)를 보낸다. 데이터는 Steam 공식 API에서 가져오므로 API 키가 필요 없다.

`.env`에 `STEAM_ALERT_CHANNEL_ID`를 채우면 켜진다 (비워두면 꺼짐). `/start` 바인딩과 별개로 동작한다.

| 키 | 기본값 | 설명 |
| --- | --- | --- |
| `STEAM_ALERT_CHANNEL_ID` | _(없음)_ | 알림을 보낼 채널 id. 비우면 기능 꺼짐 |
| `STEAM_APP_ID` | `4398540` | 관찰할 Steam 앱 id |
| `STEAM_GAME_NAME` | `DEADLY TRICK DEMO` | 알림에 표시할 게임 이름 |
| `STEAM_POLL_INTERVAL_SEC` | `600` | 폴링 주기(초) |
| `STEAM_ALERT_THRESHOLD` | `5` | 직전 알림값보다 이만큼 **증가**하면 알림 |
| `STEAM_ALERT_MIN_COUNT` | `10` | 현재 동접이 이 값 이상일 때만 알림 |

알림 예시 (임베드):

> 🎮 **DEADLY TRICK DEMO**
> 동접자 17명 돌파(+5)
> https://steamdb.info/app/4398540/

> 봇 재시작 직후 첫 조회는 기준선만 잡고 알림을 보내지 않는다(스팸 방지). 이후 `현재값 − 직전알림값 ≥ THRESHOLD` 이고 `현재값 ≥ MIN_COUNT` 이면 알림 후 기준선을 올린다. **동접이 줄면 알림 없이 기준선만 조용히 내려가**, 폭락 후 다시 오를 때 또 "돌파" 알림이 울린다.

---

## 🛠 소스에서 빌드

직접 빌드하려면 (`node`가 PATH에 있어야 함):

```bash
npm install
npm run build:exe       # start_bot.exe 생성
npm run build:zip       # dist/ArisBot.zip 묶음 생성 (배포용)
npm run build:release   # 위 둘을 한 번에
```

소스에서 바로 돌리려면 빌드 없이 `npm start` 만으로도 실행된다.
