// 어떤 TTS 엔진을 쓸지 고르고, 공통 모양으로 감싼다.
//
// 두 엔진은 한국어를 대하는 방식이 근본적으로 다르다.
//
//   GPT-SoVITS  한국어를 아는 다국어 모델. 한글을 그대로 넘기면 제대로 된 한국어
//               발음이 나온다. 대신 GPU가 필요하다.
//   VOICEVOX    일본어 전용. 한글을 가타카나로 음차해 넘기므로 "일본인이 읽는
//               한국어"가 된다. 대신 CPU만으로 돌고 가볍다.
//
// 텍스트를 어떻게 다듬을지가 엔진마다 다르므로(음차하느냐 마느냐) 백엔드가 합성뿐
// 아니라 텍스트 준비까지 함께 책임진다. 덕분에 명령어 쪽은 어느 엔진인지 몰라도 된다.

import { prepareSpeech } from './speech-text.js';
import { createVoicevoxClient } from './voicevox.js';
import { createGptSovitsClient, LANGUAGES } from './gpt-sovits.js';

/**
 * @typedef {object} TtsBackend
 * @property {string} name
 * @property {(text: string, opts: {maxLength: number}) => {clean: string, spoken: string, truncated: boolean}} prepare
 * @property {(spoken: string) => Promise<Buffer>} synthesize  48kHz 스테레오 PCM
 * @property {() => Promise<string>} describe                  기동 로그용 한 줄
 */

/**
 * config를 보고 백엔드를 고른다. 둘 다 설정돼 있으면 한국어를 제대로 읽는
 * GPT-SoVITS를 쓴다. 아무것도 설정 안 됐으면 null (= TTS 기능 꺼짐).
 *
 * @returns {TtsBackend|null}
 */
export function createTtsBackend(config) {
  if (config.gptSovitsBaseUrl) {
    const client = createGptSovitsClient({
      baseUrl: config.gptSovitsBaseUrl,
      refAudioPath: config.gptSovitsRefAudioPath,
      promptText: config.gptSovitsPromptText,
      promptLang: config.gptSovitsPromptLang,
      textLang: config.gptSovitsTextLang,
      speedFactor: config.gptSovitsSpeedFactor,
      timeoutMs: config.gptSovitsTimeoutSec * 1000,
    });
    return {
      name: 'GPT-SoVITS',
      // 한글을 그대로 넘긴다 — 음차하면 오히려 발음이 망가진다.
      prepare: (text, { maxLength }) => prepareSpeech(text, { maxLength, transliterate: false }),
      synthesize: (spoken) => client.synthesize(spoken),
      describe: () => client.describe(),
    };
  }

  if (config.voicevoxBaseUrl) {
    const client = createVoicevoxClient({
      baseUrl: config.voicevoxBaseUrl,
      speaker: config.voicevoxSpeaker,
      speedScale: config.voicevoxSpeedScale,
      pitchScale: config.voicevoxPitchScale,
      intonationScale: config.voicevoxIntonationScale,
      volumeScale: config.voicevoxVolumeScale,
      timeoutMs: config.voicevoxTimeoutSec * 1000,
    });
    return {
      name: 'VOICEVOX',
      prepare: (text, { maxLength }) => prepareSpeech(text, { maxLength, transliterate: true }),
      synthesize: (spoken) => client.synthesize(spoken),
      async describe() {
        return `VOICEVOX ${await client.version()} at ${config.voicevoxBaseUrl} (speaker ${config.voicevoxSpeaker})`;
      },
    };
  }

  return null;
}

export { LANGUAGES };
