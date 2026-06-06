// Command business logic shared by BOTH the `!`-prefix message handler and the
// `/` slash-command (interaction) handler. Each function performs the side effects
// and returns a user-facing string; the caller decides how to deliver it.

import { resetSession, hasSession } from './claude.js';
import { getProjectCwd, isMapped, setProjectCwd, removeMapping } from './projects.js';
import { redeemLink } from './pairing.js';
import { setOwner, releaseOwner } from './access.js';

// Channels where the owner's plain text is sent to Claude without /talk (in-memory).
export const autoChannels = new Set();

export const LINK_HELP = [
  '프로젝트 폴더 연결:',
  '1) 그 폴더의 터미널에서:  `node C:\\ClaudeNoritur\\bin\\link.js`',
  '2) 출력된 코드로:  `/link code:<코드>` (또는 `!link <코드>`)',
].join('\n');

export const HELP = [
  '**Aris — Discord ↔ 로컬 Claude 브리지**',
  '슬래시 명령 `/` 을 입력하면 명령 목록이 떠요. (기존 `!` 명령도 사용 가능)',
  '',
  '`/login` — 이 채널을 내 전용으로(자동 ID)',
  '`/logout` — 사용 종료(소유 해제)',
  '`/link` — 프로젝트 폴더 연결(코드는 프로젝트 터미널 `link.js`)',
  '`/unlink` — 폴더 연결만 해제',
  '`/talk <메시지>` — 로컬 Claude에게 질문 (또는 @멘션)',
  '`/auto on|off` — 이 채널에서 `/talk` 없이 바로 대화(기본 off)',
  '`/pwd` `/reset` `/ping` `/help`',
].join('\n');

export function login(channelId, userId) {
  setOwner(channelId, userId);
  resetSession(channelId);
  return `✅ <@${userId}> 님이 이 채널에 로그인했어요. 이제 이 채널은 당신 전용이에요.\n\n${LINK_HELP}`;
}

export function logout(channelId) {
  removeMapping(channelId);
  resetSession(channelId);
  autoChannels.delete(channelId);
  releaseOwner(channelId);
  return '👋 로그아웃했어요. 이 채널은 이제 비어 있어요. (다른 사용자가 로그인 가능)';
}

export function link(channelId, code) {
  if (!code) return { ok: false, text: `사용법: \`/link code:<코드>\`\n\n${LINK_HELP}` };
  const cwd = redeemLink(code);
  if (!cwd) return { ok: false, text: '⚠️ 유효하지 않거나 만료된 코드예요. 프로젝트 터미널에서 다시 생성하세요.' };
  try {
    const abs = setProjectCwd(channelId, cwd);
    resetSession(channelId);
    return { ok: true, text: `🔗 이 채널을 \`${abs}\` 에 연결했어요. 이제 \`/talk\` 또는 멘션으로 대화하세요. (\`/auto on\` 으로 바로 대화)` };
  } catch (e) {
    return { ok: false, text: `⚠️ ${e.message}` };
  }
}

export function unlink(channelId) {
  const had = removeMapping(channelId);
  resetSession(channelId);
  return had ? '🔓 프로젝트 연결을 해제했어요. (로그인 유지)' : '연결된 프로젝트가 없어요.';
}

export function auto(channelId, state) {
  const v = (state || '').toLowerCase();
  if (v === 'on') { autoChannels.add(channelId); return '🟢 auto on — 이 채널에선 일반 메시지도 Claude로 전달돼요. (끄기: `/auto off`)'; }
  if (v === 'off') { autoChannels.delete(channelId); return '⚪ auto off — 이제 `/talk` 또는 멘션으로만 대화해요.'; }
  return `현재 auto: ${autoChannels.has(channelId) ? 'on' : 'off'} — on/off 로 설정하세요.`;
}

export function pwd(channelId, userId) {
  return [
    isMapped(channelId) ? `📁 프로젝트: \`${getProjectCwd(channelId)}\`` : '📁 프로젝트: 연결 안 됨',
    `👤 소유자: <@${userId}>`,
    `🗣️ auto: ${autoChannels.has(channelId) ? 'on' : 'off'}`,
    hasSession(channelId) ? '세션: 진행 중' : '세션: 없음',
  ].join('\n');
}

export function reset(channelId) {
  return resetSession(channelId) ? '🧹 세션 초기화 완료.' : '이미 새 세션이에요.';
}
