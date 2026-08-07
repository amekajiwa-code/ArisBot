// VOICEVOX ENGINE(즌다몬 목소리를 내는 로컬 HTTP 엔진) 클라이언트.
//
// 합성은 두 번의 호출로 나뉜다.
//   1. POST /audio_query  — 텍스트를 억양·음소 길이가 담긴 AudioQuery로 바꾼다
//   2. POST /synthesis    — 그 AudioQuery를 실제 WAV로 굽는다
// 1번 결과를 중간에 손볼 수 있어서 속도·음높이를 여기서 끼워 넣는다.
//
// AudioQuery의 outputSamplingRate/outputStereo를 디스코드가 쓰는 48kHz 스테레오로
// 지정하면 엔진이 곧바로 그 포맷으로 구워 준다. 덕분에 리샘플링도 ffmpeg 재인코딩도
// 필요 없다 — e2-micro 같은 작은 VM에서 특히 이득이다.
//
// 한글은 이 엔진이 못 읽으므로 hangul-kana.js가 가타카나로 음차한 뒤에 넘어온다.

import { parseWav } from './wav.js';
import { toDiscordPcm, DISCORD_SAMPLE_RATE } from './pcm.js';

/**
 * @param {object} opts
 * @param {string} opts.baseUrl          VOICEVOX ENGINE 주소 (예: http://127.0.0.1:50021)
 * @param {number} opts.speaker          화자 id (즌다몬 노멀 = 3)
 * @param {number} [opts.speedScale]     말하기 속도 (1.0 = 기본)
 * @param {number} [opts.pitchScale]     음높이 (0 = 기본)
 * @param {number} [opts.intonationScale] 억양 세기 (1.0 = 기본)
 * @param {number} [opts.volumeScale]    음량 (1.0 = 기본)
 */
export function createVoicevoxClient({
  baseUrl,
  speaker,
  speedScale = 1.0,
  pitchScale = 0.0,
  intonationScale = 1.0,
  volumeScale = 1.0,
  timeoutMs = 20000,
  fetch = globalThis.fetch,
}) {
  const root = baseUrl.replace(/\/+$/, '');

  const call = async (path, init) => {
    const res = await fetch(`${root}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`VOICEVOX ${path.split('?')[0]} 실패 (HTTP ${res.status})`);
    return res;
  };

  return {
    /** 엔진이 살아 있는지. 기동 로그에서 한 번 확인하는 용도. */
    async version() {
      const res = await call('/version', { method: 'GET' });
      return (await res.text()).replaceAll('"', '').trim();
    },

    /**
     * 가나 텍스트를 즌다몬 목소리 PCM으로 굽는다.
     * @param {string} kana  일본어 엔진이 읽을 수 있는 문자열 (한글은 미리 음차해 둘 것)
     * @returns {Promise<Buffer>} 48kHz 스테레오 s16le PCM
     */
    async synthesize(kana) {
      const queryRes = await call(
        `/audio_query?text=${encodeURIComponent(kana)}&speaker=${speaker}`,
        { method: 'POST' },
      );
      const query = await queryRes.json();

      const audioRes = await call(`/synthesis?speaker=${speaker}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...query,
          speedScale,
          pitchScale,
          intonationScale,
          volumeScale,
          outputSamplingRate: DISCORD_SAMPLE_RATE,
          outputStereo: true,
        }),
      });

      // 요청대로 48kHz 스테레오가 오면 toDiscordPcm은 그대로 통과시킨다.
      // 엔진이 무시하더라도 소리가 이상해지는 대신 여기서 맞춰진다.
      return toDiscordPcm(parseWav(Buffer.from(await audioRes.arrayBuffer())));
    },
  };
}
