// Builds start_bot.exe from scripts/launcher.cjs using Node's Single Executable App.
import { execSync } from 'node:child_process';
import { copyFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const exe = path.join(root, 'start_bot.exe');

// The SEA sentinel fuse value varies by Node build, so read it from this node binary
// instead of hardcoding (a hardcoded value breaks across Node versions).
const nodeBin = readFileSync(process.execPath, 'latin1');
const m = nodeBin.match(/NODE_SEA_FUSE_[0-9a-f]{32}/);
if (!m) {
  console.error('이 node 바이너리에서 SEA fuse를 찾지 못했습니다. Node가 SEA를 지원하는지 확인하세요.');
  process.exit(1);
}
const fuse = m[0];
console.log(`사용할 fuse: ${fuse}`);

console.log('1/3 SEA blob 생성...');
execSync('node --experimental-sea-config scripts/sea-config.json', { cwd: root, stdio: 'inherit' });

console.log('2/3 node 복사 → start_bot.exe ...');
copyFileSync(process.execPath, exe);

console.log('3/3 blob 주입 (postject)...');
execSync(
  `npx --yes postject "${exe}" NODE_SEA_BLOB scripts/sea-prep.blob --sentinel-fuse ${fuse}`,
  { cwd: root, stdio: 'inherit' },
);

console.log('완료: start_bot.exe');
