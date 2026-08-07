// PCM을 디스코드가 받아먹는 포맷(48kHz 스테레오 s16le)으로 맞춘다.
//
// 이 단계를 직접 하는 이유는 ffmpeg 의존성을 들이지 않기 위해서다. 여기서 포맷을
// 맞춰 두면 @discordjs/voice에 StreamType.Raw로 그대로 넘길 수 있다.
//
// VOICEVOX는 애초에 48kHz 스테레오로 구워 달라고 요청하므로 그대로 통과하고,
// GPT-SoVITS는 모델이 32kHz 모노로 고정이라 여기서 변환된다.

export const DISCORD_SAMPLE_RATE = 48000;
export const DISCORD_CHANNELS = 2;

/** 바이트열 → Int16Array. 홀수 byteOffset에서도 안전하도록 정렬된 버퍼로 복사한다. */
function toSamples(pcm) {
  const usable = pcm.length - (pcm.length % 2); // 잘린 반쪽 샘플은 버린다
  const ab = new ArrayBuffer(usable);
  Buffer.from(ab).set(pcm.subarray(0, usable));
  return new Int16Array(ab);
}

/**
 * 선형 보간 리샘플. 32kHz→48kHz(정확히 1.5배)처럼 완만한 업샘플에서는 이미징
 * 잡음이 가청 대역 위쪽에 몰려서 음성용으로는 충분하다. 제대로 된 저역통과
 * 필터를 쓰지 않는 대신 의존성이 없다.
 */
export function resampleLinear(samples, fromRate, toRate) {
  if (fromRate === toRate || samples.length === 0) return samples;

  const outLength = Math.max(1, Math.round((samples.length * toRate) / fromRate));
  const out = new Int16Array(outLength);
  const step = (samples.length - 1) / (outLength - 1 || 1);

  for (let i = 0; i < outLength; i += 1) {
    const pos = i * step;
    const left = Math.floor(pos);
    const right = Math.min(left + 1, samples.length - 1);
    const frac = pos - left;
    out[i] = samples[left] + (samples[right] - samples[left]) * frac;
  }
  return out;
}

/**
 * 어떤 표본율·채널의 s16le PCM이든 디스코드용 48kHz 스테레오로 바꾼다.
 * 이미 맞는 포맷이면 복사 없이 그대로 돌려준다.
 *
 * @param {{pcm: Buffer, sampleRate: number, channels: number}} audio
 * @returns {Buffer}
 */
export function toDiscordPcm({ pcm, sampleRate, channels }) {
  if (channels < 1) throw new Error(`채널 수가 이상합니다: ${channels}`);
  if (sampleRate === DISCORD_SAMPLE_RATE && channels === DISCORD_CHANNELS) return pcm;

  const interleaved = toSamples(pcm);
  const frames = Math.floor(interleaved.length / channels);

  // 채널을 나눠 각각 리샘플한다. 3채널 이상은 앞의 둘만 쓴다(실제로는 안 오는 경우).
  const used = Math.min(channels, DISCORD_CHANNELS);
  const resampled = [];
  for (let ch = 0; ch < used; ch += 1) {
    const mono = new Int16Array(frames);
    for (let f = 0; f < frames; f += 1) mono[f] = interleaved[f * channels + ch];
    resampled.push(resampleLinear(mono, sampleRate, DISCORD_SAMPLE_RATE));
  }
  // 모노는 양쪽 귀에 같은 소리를 넣는다.
  if (resampled.length === 1) resampled.push(resampled[0]);

  const outFrames = resampled[0].length;
  const out = Buffer.allocUnsafe(outFrames * DISCORD_CHANNELS * 2);
  for (let f = 0; f < outFrames; f += 1) {
    out.writeInt16LE(resampled[0][f], f * 4);
    out.writeInt16LE(resampled[1][f], f * 4 + 2);
  }
  return out;
}
