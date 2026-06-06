// Builds start_bot.exe from scripts/launcher.cjs using Node's Single Executable App.
import { execSync } from 'node:child_process';
import { copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const exe = path.join(root, 'start_bot.exe');

console.log('1/3 SEA blob 생성...');
execSync('node --experimental-sea-config scripts/sea-config.json', { cwd: root, stdio: 'inherit' });

console.log('2/3 node 복사 → start_bot.exe ...');
copyFileSync(process.execPath, exe);

console.log('3/3 blob 주입 (postject)...');
execSync(
  `npx --yes postject "${exe}" NODE_SEA_BLOB scripts/sea-prep.blob ` +
    '--sentinel-fuse NODE_SEA_FUSE_fce680ab2cc2b0ff2b9b0b3f3c3f3a3e',
  { cwd: root, stdio: 'inherit' },
);

console.log('완료: start_bot.exe');
