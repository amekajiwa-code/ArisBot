// 테스트용 RIFF/WAVE 생성기. 여러 테스트가 공유한다.

/** @returns {Buffer} 최소한의 RIFF/WAVE. extraChunk를 주면 fmt와 data 사이에 끼워 넣는다. */
export function makeWav(pcm, { sampleRate = 48000, channels = 2, bits = 16, extraChunk = null } = {}) {
  const fmt = Buffer.alloc(24);
  fmt.write('fmt ', 0, 'ascii');
  fmt.writeUInt32LE(16, 4);
  fmt.writeUInt16LE(1, 8); // PCM
  fmt.writeUInt16LE(channels, 10);
  fmt.writeUInt32LE(sampleRate, 12);
  fmt.writeUInt32LE(sampleRate * channels * (bits / 8), 16);
  fmt.writeUInt16LE(channels * (bits / 8), 20);
  fmt.writeUInt16LE(bits, 22);

  const dataHeader = Buffer.alloc(8);
  dataHeader.write('data', 0, 'ascii');
  dataHeader.writeUInt32LE(pcm.length, 4);

  const body = Buffer.concat([fmt, extraChunk ?? Buffer.alloc(0), dataHeader, pcm]);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(4 + body.length, 4);
  header.write('WAVE', 8, 'ascii');
  return Buffer.concat([header, body]);
}

/** Int16 샘플 배열 → s16le 바이트열. */
export function pcmOf(samples) {
  const buf = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => buf.writeInt16LE(s, i * 2));
  return buf;
}
