// GPT-SoVITS(api_v2.py) 클라이언트 — 즌다몬 목소리로 진짜 한국어를 합성한다.
//
// VOICEVOX와 달리 이쪽은 다국어 모델이라 한글을 음차하지 않고 그대로 넘긴다.
// text_lang=all_ko 로 주면 한국어 음소로 발음하므로 "일본인이 읽는 한국어"가 아니라
// 제대로 된 한국어가 나온다. 대신 GPU가 필요하다.
//
// 이 모델은 few-shot 음성 복제 방식이라 참조 음성이 있어야 목소리가 정해진다.
// ref_audio_path는 봇이 아니라 **API 서버 쪽 파일 경로**이고, prompt_text는 그
// 참조 음성이 실제로 읽고 있는 문장이어야 한다(즌다몬 참조본은 일본어라 all_ja).
//
// 참조: https://github.com/zunzun999/zundamon-speech-webui

import { parseWav } from './wav.js';
import { toDiscordPcm } from './pcm.js';

/** api_v2.py의 dict_language_v2 중 실제로 쓸 만한 것들. */
export const LANGUAGES = {
  korean: 'all_ko',
  japanese: 'all_ja',
  english: 'en',
  chinese: 'all_zh',
  koreanEnglish: 'ko', // 한영 혼용 — 영어 낱말이 섞인 문장에 쓴다
};

/**
 * @param {object} opts
 * @param {string} opts.baseUrl        api_v2.py 주소 (기본 포트 9880)
 * @param {string} opts.refAudioPath   API 서버에서 보이는 참조 음성 경로
 * @param {string} opts.promptText     참조 음성이 읽고 있는 문장
 * @param {string} [opts.promptLang]   참조 음성의 언어 (기본 all_ja)
 * @param {string} [opts.textLang]     합성할 텍스트의 언어 (기본 all_ko)
 * @param {number} [opts.speedFactor]  말하기 속도 (1.0 = 기본)
 */
export function createGptSovitsClient({
  baseUrl,
  refAudioPath,
  promptText,
  promptLang = LANGUAGES.japanese,
  textLang = LANGUAGES.korean,
  speedFactor = 1.0,
  topK = 5,
  topP = 1,
  temperature = 1,
  textSplitMethod = 'cut5',
  timeoutMs = 60000,
  fetch = globalThis.fetch,
}) {
  const root = baseUrl.replace(/\/+$/, '');

  return {
    /** 서버가 살아 있는지. api_v2.py에는 헬스 엔드포인트가 없어 짧은 합성으로 대신한다. */
    async describe() {
      await this.synthesize('테스트');
      return `GPT-SoVITS at ${root} (${textLang}, ref: ${refAudioPath})`;
    },

    /**
     * 한국어 문장을 즌다몬 목소리 PCM으로 굽는다.
     * @param {string} text  음차하지 않은 원문 그대로
     * @returns {Promise<Buffer>} 48kHz 스테레오 s16le PCM
     */
    async synthesize(text) {
      let res;
      try {
        res = await fetch(`${root}/tts`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            text,
            text_lang: textLang,
            ref_audio_path: refAudioPath,
            prompt_text: promptText,
            prompt_lang: promptLang,
            speed_factor: speedFactor,
            top_k: topK,
            top_p: topP,
            temperature,
            text_split_method: textSplitMethod,
            media_type: 'wav',    // 헤더에 표본율이 붙어 와 모델이 바뀌어도 안전하다
            streaming_mode: false, // 조각을 모아 한 번에 받는다 — 재생 큐가 어차피 통짜로 다룬다
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (e) {
        // GPU 추론은 느려서 타임아웃이 흔하다. 그냥 "실패"라고만 하면 원인을 못 찾는다.
        if (e?.name === 'TimeoutError') {
          throw new Error(`GPT-SoVITS 응답이 ${Math.round(timeoutMs / 1000)}초를 넘었습니다 (문장이 길거나 GPU가 느립니다)`);
        }
        throw new Error(`GPT-SoVITS(${root})에 닿지 못했습니다: ${e?.message ?? e}`);
      }

      if (!res.ok) {
        // 실패 응답은 {"message": "..."} 형태라 사유를 그대로 전달한다.
        const detail = await res.json().then((d) => d?.message).catch(() => null);
        throw new Error(`GPT-SoVITS /tts 실패 (HTTP ${res.status})${detail ? `: ${detail}` : ''}`);
      }

      // 모델은 32kHz 모노로 뱉는다 — 디스코드용 48kHz 스테레오로 여기서 맞춘다.
      return toDiscordPcm(parseWav(Buffer.from(await res.arrayBuffer())));
    },
  };
}
