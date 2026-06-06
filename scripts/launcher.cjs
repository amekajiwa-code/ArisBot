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
