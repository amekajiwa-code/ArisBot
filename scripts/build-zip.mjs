// Bundles ArisBot.zip — the release artifact users download.
// The exe is only a launcher (spawns `node src/index.js`), so it is NOT standalone:
// the zip ships src/ + node_modules/ alongside it so users can unzip → fill .env → run.
import { execSync } from 'node:child_process';
import { existsSync, rmSync, mkdirSync, cpSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const exe = path.join(root, 'start_bot.exe');
const dist = path.join(root, 'dist');
const stage = path.join(dist, 'ArisBot');
const zip = path.join(dist, 'ArisBot.zip');

if (!existsSync(exe)) {
  console.error('start_bot.exe 가 없습니다. 먼저 `npm run build:exe` 를 실행하세요.');
  process.exit(1);
}

// Files needed at runtime. The launcher only runs `node src/index.js` with .env,
// so scripts/, binding.json (runtime state) and CLAUDE.md (dev-only) are excluded.
const include = [
  'start_bot.exe',
  'src',
  'node_modules',
  'package.json',
  'package-lock.json',
  '.env.example',
  'README.md',
  'assets',                          // 트레이 아이콘
  path.join('scripts', 'tray.ps1'),  // 트레이 스크립트(빌드용 scripts/ 나머지는 제외)
];

console.log('1/2 스테이징 구성...');
rmSync(dist, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
for (const name of include) {
  const from = path.join(root, name);
  if (!existsSync(from)) {
    console.warn(`  건너뜀(없음): ${name}`);
    continue;
  }
  const to = path.join(stage, name);
  mkdirSync(path.dirname(to), { recursive: true }); // 중첩 경로(scripts/tray.ps1) 상위 폴더 보장
  cpSync(from, to, { recursive: true });
}

console.log('2/2 zip 생성... (node_modules 때문에 시간이 좀 걸립니다)');
// Compressing the ArisBot/ folder keeps a single clean top-level folder inside the zip.
execSync(
  `powershell -NoProfile -Command "Compress-Archive -Path '${stage}' -DestinationPath '${zip}' -Force"`,
  { stdio: 'inherit' },
);

console.log(`완료: ${zip}`);
