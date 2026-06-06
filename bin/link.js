#!/usr/bin/env node
// Run this FROM the terminal of the project you want to control via Discord:
//
//     node C:\ClaudeNoritur\bin\link.js          (or, if on PATH:  link )
//     node C:\ClaudeNoritur\bin\link.js --no-hook  (pair only, skip notify hook)
//
// It (1) prints a one-time pairing code and (2) installs the Discord notification
// hook into THIS folder's .claude/settings.json. Then enter `!link <code>` in the
// Discord channel you want for this project. Connecting a folder therefore always
// requires terminal access to that folder.

import { createPendingLink } from '../src/pairing.js';
import { installNotifyHook } from '../src/install-hook.js';

const cwd = process.cwd();
const noHook = process.argv.includes('--no-hook');

const { code, ttlMin } = createPendingLink(cwd);

let hookLine = '  알림 훅: 건너뜀(--no-hook)';
if (!noHook) {
  try {
    const r = installNotifyHook(cwd);
    hookLine = r === 'installed'
      ? '  알림 훅: 설치됨 → 이 프로젝트의 Claude가 작업 완료 시 Discord로 알림'
      : '  알림 훅: 이미 설치돼 있음';
  } catch (e) {
    hookLine = `  알림 훅: 설치 실패(${e.message}) — 수동 설정 필요`;
  }
}

console.log('');
console.log('  이 폴더를 Discord 브리지에 연결합니다:');
console.log(`    ${cwd}`);
console.log('');
console.log('  ┌──────────────────────────────┐');
console.log(`     페어링 코드:  ${code}`);
console.log(`     (유효 ${ttlMin}분 · 1회용)`);
console.log('  └──────────────────────────────┘');
console.log('');
console.log('  Discord에서 이 프로젝트로 쓸 채널에 입력하세요:');
console.log(`    /link  code:${code}      (또는  !link ${code})`);
console.log('');
console.log(hookLine);
console.log('  (훅 변경은 claude 재시작 후 적용됩니다.)');
console.log('');
