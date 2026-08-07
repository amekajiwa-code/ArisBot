// VOICEVOX ENGINE(즌다몬 목소리를 내는 로컬 HTTP 엔진) 클라이언트.
//
// 합성은 두 번의 호출로 나뉜다.
//   1. POST /audio_query  — 텍스트를 억양·음소 길이가 담긴 AudioQuery로 바꾼다
//   2. POST /synthesis    — 그 AudioQuery를 실제 WAV로 굽는다
// 1번 결과를 중간에 손볼 수 있어서 속도·음높이를 여기서 끼워 넣는다.
//
// AudioQuery의 outputSamplingRate/outputStereo를 디스코드가 쓰는 48kHz 스테레오로
// 지정하면 엔진이 곧바로 그 포맷으로 구워 준다. 덕분에 WAV 헤더만 벗기면 되고
// ffmpeg으로 재인코딩할 필요가 없다 — e2-micro 같은 작은 VM에서 특히 이득이다.

/** 디스코드 음성이 요구하는 PCM 포맷. */
export const DISCORD_SAMPLE_RATE = 48000;
export const DISCORD_CHANNELS = 2;

/**
 * RIFF/WAVE 버퍼에서 PCM 본문만 떼어낸다.
 * data 청크의 위치가 고정이라고 가정하지 않고 청크를 훑는다 — 엔진이 LIST 같은
 * 부가 청크를 끼워 넣으면 오프셋 44 가정이 깨지기 때문이다.
 * @param {Buffer} buf
 * @returns {Buffer} s16le PCM
 */
export function extractPcm(buf) {
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('VOICEVOX 응답이 WAV가 아닙니다');
  }

  let format = null;
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;

    if (id === 'fmt ' && size >= 16) {
      format = {
        channels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        bitsPerSample: buf.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      // 엔진이 outputSamplingRate/outputStereo를 무시했다면 여기서 잡아야 한다.
      // 안 그러면 재생 속도만 이상해져서 원인을 찾기 어렵다.
      if (format && (format.sampleRate !== DISCORD_SAMPLE_RATE
        || format.channels !== DISCORD_CHANNELS
        || format.bitsPerSample !== 16)) {
        throw new Error(
          `VOICEVOX가 예상과 다른 포맷을 돌려줬습니다 `
          + `(${format.sampleRate}Hz ${format.channels}ch ${format.bitsPerSample}bit — `
          + `${DISCORD_SAMPLE_RATE}Hz ${DISCORD_CHANNELS}ch 16bit이어야 함)`,
        );
      }
      return buf.subarray(body, Math.min(body + size, buf.length));
    }

    offset = body + size + (size % 2); // 청크는 짝수 바이트로 정렬된다
  }
  throw new Error('WAV에 data 청크가 없습니다');
}

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

      return extractPcm(Buffer.from(await audioRes.arrayBuffer()));
    },
  };
}
