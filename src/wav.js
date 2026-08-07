// RIFF/WAVE 읽기. 엔진마다 표본율·채널이 달라서(VOICEVOX는 요청대로, GPT-SoVITS는
// 모델 고정 32kHz 모노) 헤더를 믿고 읽은 뒤 pcm.js에서 디스코드 포맷으로 맞춘다.

/**
 * @param {Buffer} buf
 * @returns {{pcm: Buffer, sampleRate: number, channels: number, bitsPerSample: number}}
 */
export function parseWav(buf) {
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('WAV 형식이 아닙니다');
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
      if (!format) throw new Error('WAV에 fmt 청크가 없습니다');
      if (format.bitsPerSample !== 16) {
        throw new Error(`16bit PCM만 다룹니다 (받은 값: ${format.bitsPerSample}bit)`);
      }
      // 선언된 크기가 실제 버퍼를 넘어가면 있는 데까지만 쓴다.
      return { ...format, pcm: buf.subarray(body, Math.min(body + size, buf.length)) };
    }

    // data 청크의 위치가 고정이라고 가정하지 않는다 — LIST 같은 부가 청크가 끼면
    // 오프셋 44 가정이 깨진다. 청크는 짝수 바이트로 정렬된다.
    offset = body + size + (size % 2);
  }
  throw new Error('WAV에 data 청크가 없습니다');
}
