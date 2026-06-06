'use strict';
// Embedded into start_bot.exe via Node SEA.
// No args  → launch the bot (node src/index.js with the local .env).
// --setup  → register autostart (Startup-folder shortcut, runs at logon).
// --unsetup→ remove the autostart shortcut.

const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

// start_bot.exe lives at the repo root, next to src/ and .env.
const baseDir = path.dirname(process.execPath);
const indexPath = path.join(baseDir, 'src', 'index.js');
const envPath = path.join(baseDir, '.env');

function shortcutPath() {
  return path.join(
    process.env.APPDATA,
    'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'ArisBot.lnk',
  );
}

function setup() {
  const lnk = shortcutPath();
  const psq = (s) => String(s).replace(/'/g, "''"); // escape ' for PowerShell single-quoted strings
  const ps =
    `$s=(New-Object -ComObject WScript.Shell).CreateShortcut('${psq(lnk)}');` +
    `$s.TargetPath='${psq(process.execPath)}';` +
    `$s.WorkingDirectory='${psq(baseDir)}';` +
    `$s.Save()`;
  const r = spawnSync('powershell', ['-NoProfile', '-Command', ps], { stdio: 'inherit' });
  console.log(r.status === 0 ? `autostart 등록됨: ${lnk}` : 'autostart 등록 실패');
}

function unsetup() {
  try {
    fs.unlinkSync(shortcutPath());
    console.log('autostart 해제됨');
  } catch {
    console.log('autostart 항목이 없어요');
  }
}

function pauseOnError() {
  // Keep the console open so the error above is readable when launched by double-click.
  // No-op when there is no interactive stdin (readSync throws → caught).
  try {
    process.stdout.write('\n[start_bot] 봇이 오류로 종료되었습니다. 위 메시지를 확인하세요.\n계속하려면 Enter 키를 누르세요...');
    fs.readSync(0, Buffer.alloc(1), 0, 1, null);
  } catch {
    /* no interactive console — skip */
  }
}

// SEA exe: process.argv[1] is the first user arg (no script path), so match by
// presence rather than a fixed index — works for both `node launcher.cjs --setup`
// and `start_bot.exe --setup`.
if (process.argv.includes('--setup')) {
  setup();
} else if (process.argv.includes('--unsetup')) {
  unsetup();
} else {
  const child = spawn('node', [`--env-file=${envPath}`, indexPath], { cwd: baseDir, stdio: 'inherit' });
  child.on('error', (e) => {
    console.error('봇 실행 실패 (node가 PATH에 있어야 합니다):', e.message);
    pauseOnError();
    process.exit(1);
  });
  child.on('exit', (code) => {
    if (code && code !== 0) pauseOnError();
    process.exit(code == null ? 0 : code);
  });
}
