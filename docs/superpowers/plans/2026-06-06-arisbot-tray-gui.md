# ArisBot 트레이 GUI 전환 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `start_bot.exe`를 콘솔 창 없는 GUI 프로그램으로 바꾸고, 시스템 트레이의 아리스 아이콘 + 우클릭 메뉴로 봇을 제어한다(수동/자동실행 동일).

**Architecture:** `start_bot.exe`(Node SEA)의 PE 서브시스템을 GUI(2)로 패치해 콘솔을 없앤다. `launcher.cjs`는 컨트롤러가 되어 봇(`node src/index.js`, 로그→파일)과 트레이(PowerShell `NotifyIcon`)를 숨김 실행한다. 트레이→컨트롤러는 stdout 라인, 컨트롤러→트레이는 감시 파일로 통신한다.

**Tech Stack:** Node.js(SEA, CommonJS 런처 + ESM 빌드/봇), Windows PowerShell 5.1(System.Windows.Forms/Drawing), node:test.

설계 스펙: `docs/superpowers/specs/2026-06-06-arisbot-tray-gui-design.md`

---

## 파일 구조

- Create: `assets/aris.png` — 트레이 아이콘(루트 `아리스.png` 복사본, ASCII 경로)
- Create: `scripts/pe-subsystem.mjs` — PE 서브시스템 바이트 패치 순수 함수(ESM, 빌드/테스트 공용)
- Create: `scripts/tray.ps1` — PowerShell NotifyIcon 트레이 UI
- Create: `test/pe-subsystem.test.js` — 패치 함수 단위 테스트
- Create: `test/assets.test.js` — aris.png 유효성 테스트
- Modify: `scripts/build-exe.mjs` — postject 뒤 서브시스템 패치 단계 추가
- Modify: `scripts/launcher.cjs` — 컨트롤러로 전면 재작성
- Modify: `scripts/build-zip.mjs` — `scripts/tray.ps1`·`assets` 포함
- Modify: `.gitignore` — `logs/`, 루트 `아리스.*` 무시
- Modify: `README.md` — 트레이 메뉴 중심으로 갱신

---

### Task 1: 트레이 아이콘 자산 배치

**Files:**
- Create: `assets/aris.png`
- Test: `test/assets.test.js`

- [ ] **Step 1: 실패하는 테스트 작성**

`test/assets.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

test('assets/aris.png 는 유효한 PNG', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const png = readFileSync(path.join(root, 'assets', 'aris.png'));
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.ok(png.subarray(0, 8).equals(sig), 'PNG 시그니처 불일치');
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `node --test test/assets.test.js`
Expected: FAIL (ENOENT: assets/aris.png 없음)

- [ ] **Step 3: 자산 복사**

PowerShell:
```powershell
New-Item -ItemType Directory -Force assets | Out-Null
Copy-Item -LiteralPath '아리스.png' -Destination 'assets/aris.png' -Force
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test test/assets.test.js`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add assets/aris.png test/assets.test.js
git commit -m "feat(tray): 트레이 아이콘 자산 assets/aris.png 추가"
```

---

### Task 2: PE 서브시스템 패치 함수 (TDD)

**Files:**
- Create: `scripts/pe-subsystem.mjs`
- Test: `test/pe-subsystem.test.js`

- [ ] **Step 1: 실패하는 테스트 작성**

`test/pe-subsystem.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { patchSubsystemToGui } from '../scripts/pe-subsystem.mjs';

// 최소 가짜 PE: e_lfanew(0x3C) → "PE\0\0" → optional header(+24) → Subsystem(+68)
function fakePe(subsystem) {
  const buf = Buffer.alloc(512);
  const peOff = 128;
  buf.writeUInt32LE(peOff, 0x3c);
  buf.write('PE\0\0', peOff, 'latin1');
  const subOff = peOff + 24 + 68;
  buf.writeUInt16LE(subsystem, subOff);
  buf.writeUInt16LE(0xabcd, subOff - 2); // 이웃 바이트 sentinel
  buf.writeUInt16LE(0x1234, subOff + 2);
  return { buf, subOff };
}

test('CUI(3) → GUI(2) 로 패치하고 이웃 바이트는 보존', () => {
  const { buf, subOff } = fakePe(3);
  const r = patchSubsystemToGui(buf);
  assert.equal(buf.readUInt16LE(subOff), 2);
  assert.equal(r.previous, 3);
  assert.equal(r.offset, subOff);
  assert.equal(buf.readUInt16LE(subOff - 2), 0xabcd);
  assert.equal(buf.readUInt16LE(subOff + 2), 0x1234);
});

test('PE 시그니처가 없으면 throw', () => {
  const buf = Buffer.alloc(256);
  buf.writeUInt32LE(64, 0x3c); // 0으로 채워진 곳을 가리킴
  assert.throws(() => patchSubsystemToGui(buf), /PE 시그니처/);
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `node --test test/pe-subsystem.test.js`
Expected: FAIL ("Cannot find module ...pe-subsystem.mjs")

- [ ] **Step 3: 최소 구현 작성**

`scripts/pe-subsystem.mjs`:

```js
// start_bot.exe(PE) 의 Optional Header Subsystem 필드를 GUI(2)로 바꿔 콘솔 창을 없앤다.
// CUI(3) → GUI(2). PE32/PE32+ 모두 Subsystem 은 Optional Header 시작 +68 오프셋.
export function patchSubsystemToGui(buf) {
  const peOff = buf.readUInt32LE(0x3c); // DOS 헤더 e_lfanew
  if (buf.toString('latin1', peOff, peOff + 4) !== 'PE\0\0') {
    throw new Error('PE 시그니처를 찾지 못했습니다');
  }
  const optOff = peOff + 24;     // COFF file header(20) + "PE\0\0"(4)
  const subOff = optOff + 68;    // IMAGE_OPTIONAL_HEADER.Subsystem
  const previous = buf.readUInt16LE(subOff);
  buf.writeUInt16LE(2, subOff);  // IMAGE_SUBSYSTEM_WINDOWS_GUI
  return { previous, offset: subOff };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test test/pe-subsystem.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: 커밋**

```bash
git add scripts/pe-subsystem.mjs test/pe-subsystem.test.js
git commit -m "feat(build): PE 서브시스템 GUI 패치 함수 추가"
```

---

### Task 3: 빌드에 서브시스템 패치 연결

**Files:**
- Modify: `scripts/build-exe.mjs`

- [ ] **Step 1: 임포트와 패치 단계 추가**

`scripts/build-exe.mjs` 상단 임포트를 다음으로 교체:

```js
// Builds start_bot.exe from scripts/launcher.cjs using Node's Single Executable App.
import { execSync } from 'node:child_process';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { patchSubsystemToGui } from './pe-subsystem.mjs';
```

파일 끝의 `console.log('완료: start_bot.exe');` 바로 앞에 다음을 삽입:

```js
console.log('4/4 GUI 서브시스템 패치 (콘솔 창 제거)...');
const buf = readFileSync(exe);
const { previous, offset } = patchSubsystemToGui(buf);
writeFileSync(exe, buf);
console.log(`서브시스템 ${previous} → 2 (GUI) @ 0x${offset.toString(16)}`);
```

그리고 기존 단계 로그 번호를 `1/3·2/3·3/3` → `1/4·2/4·3/4` 로 갱신.

- [ ] **Step 2: 빌드 실행**

Run: `npm run build:exe`
Expected: 4/4 단계까지 출력, `서브시스템 3 → 2 (GUI)` 표시, `완료: start_bot.exe`

- [ ] **Step 3: 서브시스템 바이트 검증**

Run:
```bash
node -e "import('./scripts/pe-subsystem.mjs').then(m=>{const fs=require('fs');const b=fs.readFileSync('start_bot.exe');const p=b.readUInt32LE(0x3c);console.log('subsystem=',b.readUInt16LE(p+24+68))})"
```
Expected: `subsystem= 2`

- [ ] **Step 4: 커밋**

```bash
git add scripts/build-exe.mjs
git commit -m "feat(build): 빌드 마지막에 GUI 서브시스템 패치 적용"
```

---

### Task 4: 트레이 UI (tray.ps1)

**Files:**
- Create: `scripts/tray.ps1`

- [ ] **Step 1: tray.ps1 작성**

`scripts/tray.ps1`:

```powershell
param(
  [string]$IconPath,
  [string]$LogPath,
  [string]$MsgPath,
  [string]$Autostart = 'off',
  [int]$ParentPid = 0
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# PNG → 32x32 아이콘(트레이 렌더링 선명도 위해 리사이즈). 실패 시 기본 아이콘.
function New-TrayIcon([string]$path) {
  try {
    $src = [System.Drawing.Bitmap]::FromFile($path)
    $bmp = New-Object System.Drawing.Bitmap 32, 32
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.DrawImage($src, 0, 0, 32, 32)
    $g.Dispose(); $src.Dispose()
    return [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
  } catch {
    return [System.Drawing.SystemIcons]::Application
  }
}

function Send-Cmd([string]$c) { [Console]::Out.WriteLine($c); [Console]::Out.Flush() }

$script:notify = New-Object System.Windows.Forms.NotifyIcon
$script:notify.Icon = New-TrayIcon $IconPath
$script:notify.Text = 'ArisBot'
$script:notify.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip

$miRestart = $menu.Items.Add('봇 재시작')
$miRestart.add_Click({ Send-Cmd 'restart' })

$miLog = $menu.Items.Add('로그 보기')
$miLog.add_Click({ try { Start-Process -FilePath $LogPath } catch {} })

$script:miAuto = New-Object System.Windows.Forms.ToolStripMenuItem
$script:miAuto.Text = '자동시작'
$script:miAuto.CheckOnClick = $true
$script:miAuto.Checked = ($Autostart -eq 'on')
$script:miAuto.add_Click({
  if ($script:miAuto.Checked) { Send-Cmd 'autostart-on' } else { Send-Cmd 'autostart-off' }
})
[void]$menu.Items.Add($script:miAuto)

[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))

$miQuit = $menu.Items.Add('종료')
$miQuit.add_Click({
  Send-Cmd 'quit'
  $script:notify.Visible = $false
  [System.Windows.Forms.Application]::Exit()
})

$script:notify.ContextMenuStrip = $menu

# 타이머: 부모 생존 확인 + 컨트롤러→트레이 메시지(풍선) 폴링
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 700
$timer.add_Tick({
  if ($ParentPid -gt 0 -and -not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) {
    $script:notify.Visible = $false
    [System.Windows.Forms.Application]::Exit()
    return
  }
  if (Test-Path -LiteralPath $MsgPath) {
    try {
      $lines = Get-Content -LiteralPath $MsgPath -ErrorAction Stop
      Remove-Item -LiteralPath $MsgPath -Force -ErrorAction SilentlyContinue
      foreach ($ln in $lines) {
        if ($ln -like 'balloon:*') {
          $script:notify.BalloonTipTitle = 'ArisBot'
          $script:notify.BalloonTipText = $ln.Substring(8)
          $script:notify.ShowBalloonTip(5000)
        }
      }
    } catch {}
  }
})
$timer.Start()

[System.Windows.Forms.Application]::Run()

$script:notify.Visible = $false
$script:notify.Dispose()
```

- [ ] **Step 2: 트레이 단독 동작 확인 (수동)**

Run (별도 PowerShell 창에서):
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/tray.ps1 -IconPath assets/aris.png -LogPath logs/bot.log -MsgPath logs/.tray-msg -Autostart off -ParentPid 0
```
Expected: 트레이(숨겨진 아이콘 영역)에 아리스 아이콘 표시. 우클릭 → 봇 재시작/로그 보기/자동시작/종료 메뉴. "종료" 클릭 시 아이콘 사라지고 프로세스 종료. (ParentPid 0 이면 부모 체크 생략 → 수동 테스트 가능.)
중지하려면 트레이 "종료" 클릭.

- [ ] **Step 3: 커밋**

```bash
git add scripts/tray.ps1
git commit -m "feat(tray): PowerShell NotifyIcon 트레이 UI 추가"
```

---

### Task 5: 런처를 컨트롤러로 재작성

**Files:**
- Modify: `scripts/launcher.cjs` (전체 교체)

- [ ] **Step 1: launcher.cjs 전체 교체**

`scripts/launcher.cjs`:

```js
'use strict';
// start_bot.exe (GUI 서브시스템)의 진입점 — 콘솔 없음.
// 무인자 → 컨트롤러: 봇(node)과 트레이(powershell)를 숨김 실행하고 수명주기 관리.
// --setup / --unsetup → 자동시작 단축아이콘 등록/해제(결과는 MessageBox).

const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const baseDir = path.dirname(process.execPath); // exe 위치(= src/, .env, scripts/, assets/ 옆)
const indexPath = path.join(baseDir, 'src', 'index.js');
const envPath = path.join(baseDir, '.env');
const trayPs1 = path.join(baseDir, 'scripts', 'tray.ps1');
const iconPath = path.join(baseDir, 'assets', 'aris.png');
const logDir = path.join(baseDir, 'logs');
const botLog = path.join(logDir, 'bot.log');
const launcherLog = path.join(logDir, 'launcher.log');
const msgPath = path.join(logDir, '.tray-msg');

function ensureLogDir() { try { fs.mkdirSync(logDir, { recursive: true }); } catch {} }
function log(msg) {
  ensureLogDir();
  try { fs.appendFileSync(launcherLog, `[${new Date().toISOString()}] ${msg}\n`); } catch {}
}

const psq = (s) => String(s).replace(/'/g, "''"); // PowerShell single-quote escape

function shortcutPath() {
  return path.join(
    process.env.APPDATA,
    'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'ArisBot.lnk',
  );
}
function isAutostart() { return fs.existsSync(shortcutPath()); }

function setup() {
  const lnk = shortcutPath();
  const ps =
    `$s=(New-Object -ComObject WScript.Shell).CreateShortcut('${psq(lnk)}');` +
    `$s.TargetPath='${psq(process.execPath)}';` +
    `$s.WorkingDirectory='${psq(baseDir)}';` +
    `$s.Save()`;
  return spawnSync('powershell', ['-NoProfile', '-Command', ps], { windowsHide: true }).status === 0;
}
function unsetup() {
  try { fs.unlinkSync(shortcutPath()); return true; } catch { return false; }
}
function msgBox(text) {
  const ps = `Add-Type -AssemblyName System.Windows.Forms;` +
    `[void][System.Windows.Forms.MessageBox]::Show('${psq(text)}','ArisBot')`;
  spawnSync('powershell', ['-NoProfile', '-Command', ps], { windowsHide: true });
}

// ───────── 인자 분기 ─────────
if (process.argv.includes('--setup')) {
  msgBox(setup() ? `자동시작 등록됨:\n${shortcutPath()}` : '자동시작 등록 실패');
  process.exit(0);
}
if (process.argv.includes('--unsetup')) {
  msgBox(unsetup() ? '자동시작 해제됨' : '자동시작 항목이 없어요');
  process.exit(0);
}

// ───────── 컨트롤러 모드 ─────────
ensureLogDir();
try { fs.unlinkSync(msgPath); } catch {} // 묵은 메시지 제거

let bot = null;
let tray = null;
let quitting = false;

function notifyTray(line) {
  try { fs.writeFileSync(msgPath, line + '\n'); } catch (e) { log(`notifyTray 실패: ${e.message}`); }
}

function startBot() {
  const fd = fs.openSync(botLog, 'a');
  bot = spawn('node', [`--env-file=${envPath}`, indexPath], {
    cwd: baseDir, windowsHide: true, stdio: ['ignore', fd, fd],
  });
  log(`봇 시작 pid=${bot.pid}`);
  bot.on('error', (e) => {
    log(`봇 spawn 오류: ${e.message}`);
    notifyTray('balloon:봇 실행 실패 — node가 설치되어 PATH에 있는지 확인하세요');
  });
  bot.on('exit', (code) => {
    log(`봇 종료 code=${code}`);
    bot = null;
    if (!quitting && code !== 0) {
      notifyTray(`balloon:봇이 종료되었습니다 (code ${code}). 트레이 메뉴 → 봇 재시작`);
    }
  });
}
function stopBot() {
  if (bot) { try { bot.kill(); } catch {} bot = null; }
}

function startTray() {
  tray = spawn('powershell', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
    '-File', trayPs1,
    '-IconPath', iconPath,
    '-LogPath', botLog,
    '-MsgPath', msgPath,
    '-Autostart', isAutostart() ? 'on' : 'off',
    '-ParentPid', String(process.pid),
  ], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  log(`트레이 시작 pid=${tray.pid}`);

  let buf = '';
  tray.stdout.on('data', (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const cmd = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (cmd) handleTrayCommand(cmd);
    }
  });
  tray.on('error', (e) => log(`트레이 spawn 오류: ${e.message}`));
  tray.on('exit', (code) => {
    log(`트레이 종료 code=${code}`);
    tray = null;
    if (!quitting) quitAll(0); // 트레이(UI)가 사라지면 컨트롤러도 정리
  });
}

function handleTrayCommand(cmd) {
  log(`트레이 명령: ${cmd}`);
  if (cmd === 'restart') { stopBot(); startBot(); }
  else if (cmd === 'autostart-on') { setup(); }
  else if (cmd === 'autostart-off') { unsetup(); }
  else if (cmd === 'quit') { quitAll(0); } // 트레이는 자체적으로 아이콘 숨기고 종료
}

function quitAll(code) {
  if (quitting) return;
  quitting = true;
  stopBot();
  process.exit(code);
}

startBot();
startTray();
```

- [ ] **Step 2: 커밋**

```bash
git add scripts/launcher.cjs
git commit -m "feat(launcher): 콘솔 런처를 트레이 컨트롤러로 재작성"
```

---

### Task 6: 배포 zip에 트레이·아이콘 포함

**Files:**
- Modify: `scripts/build-zip.mjs`

- [ ] **Step 1: include 목록과 복사 로직 수정**

`scripts/build-zip.mjs`의 `include` 배열을 다음으로 교체:

```js
const include = [
  'start_bot.exe',
  'src',
  'node_modules',
  'package.json',
  'package-lock.json',
  '.env.example',
  'README.md',
  'assets',                       // 트레이 아이콘
  path.join('scripts', 'tray.ps1'), // 트레이 스크립트(빌드용 scripts/ 나머지는 제외)
];
```

그리고 복사 루프에서 중첩 경로(`scripts/tray.ps1`)의 상위 폴더를 보장하도록 `cpSync` 직전에 한 줄 추가:

```js
for (const name of include) {
  const from = path.join(root, name);
  if (!existsSync(from)) {
    console.warn(`  건너뜀(없음): ${name}`);
    continue;
  }
  const to = path.join(stage, name);
  mkdirSync(path.dirname(to), { recursive: true }); // 중첩 경로 상위 폴더 보장
  cpSync(from, to, { recursive: true });
}
```

- [ ] **Step 2: zip 빌드 후 내용 확인**

Run:
```bash
npm run build:zip
```
Then:
```powershell
$tmp = Join-Path $env:TEMP 'arisbot-zipcheck'; Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
Expand-Archive -Path dist/ArisBot.zip -DestinationPath $tmp -Force
Test-Path "$tmp/ArisBot/scripts/tray.ps1"; Test-Path "$tmp/ArisBot/assets/aris.png"
```
Expected: 두 줄 모두 `True`

- [ ] **Step 3: 커밋**

```bash
git add scripts/build-zip.mjs
git commit -m "feat(build): 배포 zip에 tray.ps1·assets 포함"
```

---

### Task 7: .gitignore 및 README 갱신

**Files:**
- Modify: `.gitignore`
- Modify: `README.md`

- [ ] **Step 1: .gitignore 갱신**

`.gitignore`에 다음 줄 추가(기존 내용 유지):

```
logs/
아리스.png
아리스.webp
```

- [ ] **Step 2: README 자동실행/명령 섹션 갱신**

`README.md`에서 "## ⚙️ 자동 실행 (Windows)" 표를 다음으로 교체:

```markdown
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
```

또한 "## 🚀 셋업" 4번 항목 `**`start_bot.exe` 더블클릭**으로 실행.` 뒤에 다음 문장 추가:

```markdown
   - 콘솔 창은 뜨지 않고 트레이(숨겨진 아이콘)에 아리스 아이콘으로 동작한다. 로그는 `logs/bot.log` 에 쌓인다.
```

- [ ] **Step 3: 커밋**

```bash
git add .gitignore README.md
git commit -m "docs: 트레이 동작 반영 + logs/ 무시"
```

---

### Task 8: 통합 빌드 & 수동 검증

**Files:** (없음 — 검증 단계)

- [ ] **Step 1: 전체 테스트**

Run: `npm test`
Expected: 모든 테스트 PASS (assets, pe-subsystem 포함)

- [ ] **Step 2: 릴리즈 빌드**

Run: `npm run build:release`
Expected: `start_bot.exe` 재생성(서브시스템 2) + `dist/ArisBot.zip` 생성

- [ ] **Step 3: 콘솔 없음 + 트레이 확인 (수동)**

1. 탐색기에서 `start_bot.exe` 더블클릭.
2. 확인: **검은 콘솔 창이 뜨지 않는다.**
3. 확인: 트레이(숨겨진 아이콘 표시 ⌃ 안)에 아리스 아이콘이 보인다.
4. 우클릭 메뉴 항목 점검:
   - 로그 보기 → `logs/bot.log` 가 열린다.
   - 자동시작 체크 → 시작프로그램 폴더에 `ArisBot.lnk` 생성됨
     (`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup` 확인). 체크 해제 → 삭제됨.
   - 봇 재시작 → `logs/launcher.log` 에 "봇 시작" 라인이 새로 찍힘.
5. node 미설치 상황 모의(선택): PATH에서 node를 임시로 가린 뒤 재시작 → "봇 실행 실패" 풍선.
6. "종료" → 트레이 아이콘 사라지고, 작업 관리자에서 node/powershell/start_bot 프로세스가 정리됨.

- [ ] **Step 4: 자동실행 검증 (수동)**

1. 트레이 자동시작 체크(또는 `start_bot.exe --setup`).
2. 로그아웃 후 재로그인(또는 `ArisBot.lnk` 더블클릭으로 대체 검증).
3. 확인: 콘솔 없이 트레이 아이콘으로 조용히 뜬다.

- [ ] **Step 5: 검증 결과 기록 & 최종 커밋(필요 시)**

검증 중 수정이 있었다면 해당 파일 커밋. 없으면 생략.

---

## Self-Review 결과

- **스펙 커버리지:** 콘솔 제거(T2·T3), 트레이+메뉴(T4), 컨트롤러/IPC/로깅/풍선(T5), 아이콘 자산(T1), 배포 포함(T6), --setup MessageBox(T5), 문서(T7), 검증(T8) — 스펙 전 항목 매핑됨.
- **플레이스홀더:** 없음(모든 코드 전체 기재).
- **타입/이름 일관성:** `patchSubsystemToGui`(T2→T3), IPC 토큰 `restart/autostart-on/autostart-off/quit`·`balloon:`(T4 tray ↔ T5 launcher) 일치, 경로 변수(`msgPath`/`MsgPath`, `botLog`/`LogPath`, `iconPath`/`IconPath`) 송수신 일치.
- **WIC 변환:** 사용자가 PNG를 직접 제공해 변환 단계 불필요 → T1은 복사만.
