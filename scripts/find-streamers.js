#!/usr/bin/env node
// "최근 N일(기본 3일) 안에 이 게임을 방송한 사람 전부" 를 뽑는 일회성 CLI.
//
//   node scripts/find-streamers.js                 # 기록 + 플랫폼 검색 (기본)
//   node scripts/find-streamers.js --days 7 --json
//   node scripts/find-streamers.js --source log    # 봇이 적어둔 기록만 (요청 0회, 즉시)
//   node scripts/find-streamers.js --source api    # 지금 플랫폼에서 검색만
//
// 출처가 둘이다:
//   1) 기록 — 봇이 1분마다 훑어 적어둔 것(data/streams.json). 방송이 끝나고 흔적을 안 남겨도
//      우리가 본 이상 남는다. 봇이 돌기 시작한 뒤부터만 있다.
//   2) 플랫폼 검색 — 지금 시점에 API/검색으로 되짚을 수 있는 것(트위치 VOD, 유튜브 종료 방송,
//      비리비리 투고, 니코니코 영상). 봇이 없던 기간도 커버하지만 구멍이 있다.
// 둘을 합쳐 사람 단위로 병합한다.

import { existsSync } from 'node:fs';

import { loadFinderConfig, loadConfig, ConfigError } from '../src/config.js';
import { createSources } from '../src/sources.js';
import { createStreamLog } from '../src/stream-log.js';
import { collect, formatReport, DEFAULT_MATCH_TERMS } from '../src/find-streamers.js';

const DAY_MS = 86_400_000;
const USAGE = `사용법: node scripts/find-streamers.js [옵션]
  --days N          최근 N일 (기본 3)
  --game "이름"      게임 이름 (기본: STEAM_GAME_NAME 또는 Deadly Trick)
  --source both|log|api   both=기록+검색(기본), log=기록만, api=검색만
  --json            JSON 출력`;

function parseArgs(argv) {
  const args = { days: 3, json: false, source: 'both' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--days' || a === '-d') args.days = Number(argv[++i]);
    else if (a.startsWith('--days=')) args.days = Number(a.slice(7));
    else if (a === '--game' || a === '-g') args.game = argv[++i];
    else if (a === '--source') args.source = argv[++i];
    else if (a.startsWith('--source=')) args.source = a.slice(9);
    else if (a === '--json') args.json = true;
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

/** 봇이 적어둔 기록을 소스 하나로. 파일이 없으면(=봇을 아직 안 돌렸으면) 건너뛴다. */
function logSource(cfg, { since }) {
  if (!existsSync(cfg.streamLogPath)) {
    return { platform: '기록', skip: `${cfg.streamLogPath} 없음 — 봇을 띄워두면 1분마다 쌓입니다` };
  }
  const log = createStreamLog({ path: cfg.streamLogPath, retentionDays: cfg.recorderRetentionDays });
  return {
    platform: '기록',
    filterByTerms: false,            // 적을 때 이미 걸렀다
    run: () => log.entriesSince(since),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return console.log(USAGE);
  if (!Number.isFinite(args.days) || args.days <= 0) {
    console.error('--days 는 1 이상의 숫자여야 합니다.');
    process.exitCode = 1;
    return;
  }
  if (!['both', 'log', 'api'].includes(args.source)) {
    console.error(`--source 는 both|log|api 중 하나입니다. (받은 값: ${args.source})`);
    process.exitCode = 1;
    return;
  }

  // Discord 토큰 없이도 돌아야 하므로, 토큰이 없으면 finder 설정만 읽는다.
  let cfg;
  try {
    cfg = loadConfig(process.env);
  } catch (e) {
    if (!(e instanceof ConfigError)) throw e;
    cfg = loadFinderConfig(process.env);
  }

  const gameName = args.game ?? process.env.STEAM_GAME_NAME?.trim() ?? 'Deadly Trick';
  const now = Date.now();
  const since = now - args.days * DAY_MS;
  const matchTerms = cfg.youtubeMatchTerms ?? [...new Set([gameName, ...DEFAULT_MATCH_TERMS])];

  const sources = [
    ...(args.source === 'api' ? [] : [logSource(cfg, { since })]),
    ...(args.source === 'log' ? [] : createSources(cfg, { gameName, since, days: args.days, backlog: true })),
  ];

  const result = await collect(sources, { days: args.days, now, matchTerms });

  if (args.json) console.log(JSON.stringify(result, null, 2));
  else console.log(formatReport(result, { gameName }));

  // 아무것도 못 찾았고 전부 실패했으면 실패로 끝낸다.
  if (!result.streamers.length && result.errors.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error('[find-streamers]', e?.stack ?? e);
  process.exitCode = 1;
});
