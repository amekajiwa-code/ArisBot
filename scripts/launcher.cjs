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
  const ps =
    `$s=(New-Object -ComObject WScript.Shell).CreateShortcut('${lnk}');` +
    `$s.TargetPath='${process.execPath}';` +
    `$s.WorkingDirectory='${baseDir}';` +
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
    process.exit(1);
  });
  child.on('exit', (code) => process.exit(code == null ? 0 : code));
}
