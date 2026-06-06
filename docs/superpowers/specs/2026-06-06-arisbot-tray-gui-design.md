# ArisBot 트레이 GUI 전환 설계

날짜: 2026-06-06
상태: 설계 확정 대기

## 목적

`start_bot.exe`를 콘솔 앱에서 **콘솔 창 없는 GUI 프로그램**으로 바꾼다. 실행하면
시스템 트레이(알림 영역)에 아리스 아이콘이 뜨고, 우클릭 메뉴로 봇을 제어한다.
수동 더블클릭과 로그인 자동실행 **모두 동일하게** 콘솔 없이 조용히 트레이로 들어간다.

핵심 목적([[arisbot-purpose]])은 그대로다 — Discord로 로컬 Claude를 원격 제어.
이 작업은 런처의 표면(콘솔 → 트레이 GUI)만 바꾸고 봇 로직(`src/`)은 건드리지 않는다.

## 현재 상태

- `start_bot.exe` = Node SEA로 빌드된 **콘솔 서브시스템** 앱. 진입점 `scripts/launcher.cjs`.
- 더블클릭/자동실행 시 **검은 콘솔 창**이 뜨고 `node --env-file=.env src/index.js`를 stdio 상속으로 실행.
- `--setup`/`--unsetup` = 시작프로그램 폴더 `ArisBot.lnk` 등록/해제(콘솔에 결과 출력).
- 빌드: `scripts/build-exe.mjs`(node 복사 → SEA blob → postject 주입), `scripts/build-zip.mjs`(배포 zip).

## 결정 사항 (확정)

- 형태: **트레이 아이콘 + 우클릭 메뉴**.
- 수동/자동 **동일** 동작 (항상 콘솔 없이 트레이로).
- 숨김 처리: **Windows 11 기본 동작에 맡김** (새 트레이 아이콘은 기본적으로 오버플로/숨김 영역에 들어감). 레지스트리 강제 안 함.
- 아이콘: `아리스.webp`(252x204, 알파) → 한 번 PNG로 변환해 `assets/aris.png`로 커밋. 트레이가 이 PNG 사용.
- exe 파일 아이콘(탐색기 표시): **이번 범위 제외**(SEA 리소스 충돌 위험). 추후 옵션.
- 구현 접근: **GUI 서브시스템 SEA 런처 + PowerShell NotifyIcon 트레이** (새 npm/런타임 의존성 없음).

## 아키텍처

```
start_bot.exe  (Node SEA, GUI 서브시스템 — 콘솔 없음)
  │  launcher.cjs = 컨트롤러
  ├─ spawn: node --env-file=.env src/index.js   (windowsHide, stdio → logs/bot.log)
  └─ spawn: powershell -File scripts/tray.ps1   (windowsHide, stdout 파이프)
        NotifyIcon(assets/aris.png) + 우클릭 메뉴
          • 봇 재시작
          • 로그 보기   (logs/bot.log 열기 — PS가 직접)
          • 자동시작 (체크표시 토글)
          • ─────────
          • 종료
```

3개 프로세스: `start_bot.exe`(컨트롤러), `node`(봇), `powershell`(트레이).
컨트롤러가 수명주기를 관리한다.

### 프로세스 간 통신(IPC)

- **트레이 → 컨트롤러**: 트레이의 stdout 라인 토큰.
  - `restart` / `autostart-on` / `autostart-off` / `quit`
  - 컨트롤러가 `child.stdout`를 라인 단위로 읽어 처리.
- **컨트롤러 → 트레이**: 감시 파일 1개(`logs/.tray-msg`)를 트레이의 WinForms 타이머가 폴링.
  - 용도: 봇 비정상 종료 시 **풍선 알림**(`balloon:<텍스트>`). (드물고 단방향이라 stdin 스레딩보다 단순/견고.)
- **고아 방지**: 트레이는 `-ParentPid`로 받은 컨트롤러 PID를 타이머로 확인, 부모가 죽으면 트레이도 종료.

## 컴포넌트

### 1. `scripts/launcher.cjs` (컨트롤러로 재작성)

- 인자 분기:
  - `--setup` / `--unsetup`: 기존 단축아이콘 생성/삭제 로직 유지. 단, GUI 서브시스템이라 콘솔 출력이 안 보이므로 **결과를 MessageBox로** 표시(PowerShell `[System.Windows.Forms.MessageBox]`).
  - 무인자(기본): 컨트롤러 모드.
- 컨트롤러 모드:
  - `baseDir`/`indexPath`/`envPath`/`logDir` 계산, `logs/` 생성.
  - 봇 spawn: `spawn('node', ['--env-file='+envPath, indexPath], { cwd: baseDir, windowsHide: true, stdio: ['ignore', logFd, logFd] })`.
  - 트레이 spawn: `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File scripts/tray.ps1 -IconPath ... -LogPath ... -MsgPath ... -Autostart on|off -ParentPid <pid>` (windowsHide, stdout 파이프).
  - 트레이 stdout 라인 처리:
    - `restart` → 봇 kill 후 재spawn.
    - `autostart-on`/`autostart-off` → 기존 setup()/unsetup() 호출(단축아이콘은 한 곳=런처에서만 관리).
    - `quit` → 봇 kill → 트레이 종료 → `process.exit(0)`.
  - 봇 exit 핸들러: 코드 ≠ 0이면 `logs/.tray-msg`에 `balloon:봇이 오류로 종료되었습니다` 기록(트레이가 풍선 표시). 컨트롤러는 계속 살아 있어 사용자가 재시작/종료 가능.
  - 봇 spawn `error`(node 미설치 등) → 풍선 + 로그.
- **콘솔 출력 금지**: 모든 `console.*` 제거/치환 → `logs/launcher.log` 파일 append 헬퍼로. (GUI 서브시스템엔 콘솔이 없어 stdout 쓰기가 무효/예외가 될 수 있음.)
- 기존 `pauseOnError`(stdin readSync) 제거 — 콘솔이 없으므로 풍선 알림으로 대체.

### 2. `scripts/tray.ps1` (신규)

- 파라미터: `-IconPath -LogPath -MsgPath -Autostart -ParentPid`.
- `System.Windows.Forms` + `System.Drawing` 로드.
- 아이콘: `$bmp=[System.Drawing.Bitmap]::FromFile($IconPath); $ico=[System.Drawing.Icon]::FromHandle($bmp.GetHicon())`.
- `NotifyIcon`: Text="ArisBot", Visible=$true, ContextMenuStrip 구성:
  - 봇 재시작 → `[Console]::Out.WriteLine('restart')`
  - 로그 보기 → `Start-Process $LogPath` (PS가 직접 처리)
  - 자동시작 → 체크 토글 + `WriteLine('autostart-on'|'autostart-off')` (자기 체크는 낙관적 즉시 갱신)
  - 종료 → `WriteLine('quit')` 후 `Visible=$false` → `Application::Exit()`
- WinForms `Timer`(500ms): `$MsgPath` 읽어 `balloon:` 메시지 있으면 `ShowBalloonTip` 후 파일 비우기; `Get-Process -Id $ParentPid` 없으면 종료.
- `[System.Windows.Forms.Application]::Run()`로 메시지 루프.

### 3. `assets/aris.png` (신규, 커밋)

- `아리스.webp` → PNG 변환을 **빌드 PC에서 1회** 수행(Windows WIC: `System.Windows.Media.Imaging.BitmapDecoder` → `PngBitmapEncoder`). 검증 완료(WIC 디코드 OK).
- 결과 PNG를 리포에 커밋해 엔드유저 PC에 webp 코덱이 없어도 동작.
- 원본 `아리스.webp`는 유지(소스 자산).

### 4. `scripts/build-exe.mjs` (수정)

- 기존 단계(node 복사 → SEA blob → postject) 후, **마지막에 PE 서브시스템 바이트를 GUI(2)로 패치**.
  - PE 오프셋: DOS `e_lfanew`(0x3C) → PE 시그니처 → Optional Header 시작(peOff+24) → Subsystem(optOff+68). 값 3(CUI)→2(GUI). PE32/PE32+ 동일 오프셋.
  - 리소스 섹션을 건드리지 않는 2바이트 쓰기라 postject가 주입한 SEA blob과 무관 → postject 뒤에 수행해도 안전(빌드 후 실행 테스트로 검증).
- 서브시스템 패치는 순수 함수(`Buffer` 입력→출력)로 분리해 단위 테스트 대상으로 삼음.

### 5. `scripts/build-zip.mjs` (수정)

- `include` 목록에 추가: `scripts/tray.ps1`, `assets`(=aris.png). (현재 `scripts/` 전체는 제외 중이므로 트레이 스크립트는 개별 포함.)
- `cpSync`가 중첩 경로(`scripts/tray.ps1`)를 만들도록 디렉터리 보장.

### 6. `.gitignore` / 기타

- `logs/`는 `*.log`로 이미 무시됨. `logs/.tray-msg`는 별도 무시 추가(`logs/`).
- `README.md`: 자동실행/제어를 **트레이 메뉴 중심**으로 갱신. CLI `--setup`/`--unsetup`은 결과를 MessageBox로 보여줌을 명시.

## 데이터 흐름

1. 로그인 → 시작프로그램 `ArisBot.lnk` → `start_bot.exe`(GUI) 실행 → 컨트롤러가 봇+트레이 spawn → 트레이에 아리스 아이콘(숨김 영역).
2. 우클릭 메뉴 클릭 → stdout 토큰 → 컨트롤러 동작.
3. 봇 크래시 → 컨트롤러가 `logs/.tray-msg`에 기록 → 트레이 풍선 알림.

## 에러 처리

- `node` PATH 없음: 봇 spawn `error` → 풍선("node를 찾을 수 없습니다") + `logs/launcher.log`.
- 봇 비정상 종료: 풍선 + 로그. 컨트롤러 유지(재시작 가능).
- 트레이 spawn 실패: 로그만, 봇은 계속 구동(트레이 없는 축소 동작).
- 컨트롤러 종료: 트레이가 ParentPid 감지로 자동 종료(고아 방지).

## 테스트

- **단위(node --test)**: PE 서브시스템 패치 순수 함수 — 가짜/실제 PE 헤더 버퍼에 적용 후 Subsystem 바이트 == 2 확인, 다른 바이트 불변 확인.
- **자산 변환 검증**: 생성된 `assets/aris.png`가 유효한 PNG 시그니처를 갖는지 확인.
- **수동(빌드 후)**: 더블클릭 → 콘솔 미표시 + 트레이 아이콘 표시 / 메뉴 각 항목(재시작·로그 보기·자동시작 토글로 lnk 생성·삭제·종료 시 node+트레이 종료) / 봇 크래시 풍선 / 자동실행 동일 동작.

## 범위 외 (YAGNI)

- exe 파일 아이콘(탐색기) 임베드 — 추후 옵션(`rcedit`).
- 봇 크래시 자동 재시작 — 메뉴 수동 재시작만.
- macOS/Linux — Windows 전용 프로젝트.

## 관련

- 아키텍처: [[arisbot-architecture-v1]] / 목적: [[arisbot-purpose]]
- 기존 설계: `docs/superpowers/specs/2026-06-06-arisbot-v1-design.md`
