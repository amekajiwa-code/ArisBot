#!/usr/bin/env node
// 치지직 스캔 깊이 진단.
//
// 치지직 공식 Open API에는 카테고리 필터가 없어서 전체 라이브를 시청자수 내림차순으로
// 상위 CHZZK_MAX_PAGES×20개만 훑는다. 그 깊이가 충분한지는 "몇 위쯤에서 알림 하한
// (기본 50명) 아래로 떨어지느냐"에 달려 있고, 그건 시간대마다 다르다.
// 이 스크립트가 지금 시점의 실제 값을 재준다. 피크 시간대(저녁)에 돌려보는 게 의미 있다.
//
//   node scripts/chzzk-depth.js              # .env 의 CHZZK_MAX_PAGES 만큼
//   node scripts/chzzk-depth.js --pages 40   # 더 깊이 재보기
//   node scripts/chzzk-depth.js --json

import { createChzzkClient, summarizeDepth } from '../src/chzzk.js';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--pages' || a === '-p') args.pages = Number(argv[++i]);
    else if (a.startsWith('--pages=')) args.pages = Number(a.slice(8));
    else if (a === '--min' || a === '-m') args.min = Number(argv[++i]);
    else if (a === '--json') args.json = true;
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

const n = (v) => Number(v).toLocaleString('ko-KR');

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('사용법: node scripts/chzzk-depth.js [--pages N] [--min 시청자하한] [--json]');
    return;
  }

  const env = process.env;
  const clientId = env.CHZZK_CLIENT_ID?.trim();
  const clientSecret = env.CHZZK_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    console.error('CHZZK_CLIENT_ID / CHZZK_CLIENT_SECRET 이 필요합니다 (.env).');
    process.exitCode = 1;
    return;
  }

  const maxPages = args.pages ?? Number(env.CHZZK_MAX_PAGES ?? 15);
  const minViewers = args.min ?? Number(env.CHZZK_ALERT_MIN_VIEWERS ?? 50);
  const categoryId = env.CHZZK_CATEGORY_ID?.trim() || 'Deadly_Trick';

  const chzzk = createChzzkClient({ clientId, clientSecret });
  const pages = [];
  const matches = [];
  let next;
  for (let i = 0; i < maxPages; i++) {
    const page = await chzzk.fetchLivesPage({ size: 20, next });
    pages.push(page.lives);
    for (const l of page.lives) if (l.liveCategory === categoryId) matches.push(l);
    if (!page.next || !page.lives.length) break;      // 전체 라이브를 다 훑음
    next = page.next;
  }

  const summary = summarizeDepth(pages, minViewers);
  if (args.json) {
    console.log(JSON.stringify({ ...summary, categoryId, matches }, null, 2));
    return;
  }

  const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false });
  console.log(`치지직 라이브 스캔 — ${now} KST\n`);
  console.log('  페이지   누적순위   이 페이지 최저 시청자');
  for (const r of summary.rows) {
    const mark = r.lowest < minViewers ? '  ← 하한 아래' : '';
    console.log(`  ${String(r.page).padStart(5)}   ${String(r.cumulative).padStart(7)}   ${n(r.lowest).padStart(12)}${mark}`);
  }

  console.log(`\n${n(summary.scanned)}위 시청자 = ${n(summary.lowest ?? 0)}명`);
  if (summary.covered) {
    console.log(
      `→ 알림 하한(${minViewers}명)은 이미 커버됩니다. 더 깊이 훑어도 알림은 안 바뀝니다.\n` +
      `   하한을 만나는 지점: ${summary.pagesNeeded}페이지(누적 ${n(summary.pagesNeeded * 20)}위) 부근\n` +
      `   → CHZZK_MAX_PAGES 는 ${summary.pagesNeeded + 2} 정도면 충분합니다 (지금 ${maxPages}).`,
    );
  } else {
    console.log(
      `→ ⚠️ 스캔 끝자락이 아직 하한(${minViewers}명) 위입니다. 못 본 구간에 알림 대상이 남아 있을 수 있습니다.\n` +
      `   --pages 를 늘려 다시 재보세요 (지금 ${maxPages}페이지 = 상위 ${n(summary.scanned)}개).`,
    );
  }
  console.log(
    `\n⚠️ 기록기는 시청자 하한이 없어, 여기서 못 본 구간의 소규모 방송은 기록에도 안 남습니다\n` +
    `   (find-streamers 명단에서 빠짐). 명단을 촘촘히 하려면 깊이가 여전히 의미 있습니다.`,
  );
  console.log(`\n카테고리 "${categoryId}" 일치: ${matches.length}건`);
  for (const m of matches) {
    console.log(`  - ${m.channelName} (${n(m.concurrentUserCount)}명) ${m.liveTitle ?? ''}`);
  }
}

main().catch((e) => {
  console.error('[chzzk-depth]', e?.message ?? e);
  process.exitCode = 1;
});
