// 디스코드에서 받은 날것의 텍스트를 VOICEVOX에 넘길 가나로 다듬는다.
//
// 멘션·URL·마크다운을 그대로 읽으면 "꺾쇠 골뱅이 일이삼사..." 같은 소리가 나오므로
// 먼저 걷어낸 뒤 한글을 가타카나로 음차한다.

import { hangulToKatakana } from './hangul-kana.js';

// 낱자로 쓰인 자모(ㅋㅋㅋ, ㅠㅠ, ㄱㅅ)는 음절이 아니라 어느 엔진도 읽지 못한다.
// 그대로 두면 무음이 되므로 읽을 수 있는 글자로 미리 풀어 준다.
//
// 한글을 그대로 읽는 엔진(GPT-SoVITS)용 — 낱자의 한국어 이름값에 가깝게 편다.
const JAMO_HANGUL = {
  ㄱ: '그', ㄲ: '끄', ㄴ: '느', ㄷ: '드', ㄸ: '뜨', ㄹ: '르', ㅁ: '므',
  ㅂ: '브', ㅃ: '쁘', ㅅ: '스', ㅆ: '쓰', ㅇ: '응', ㅈ: '즈', ㅉ: '쯔',
  ㅊ: '츠', ㅋ: '크', ㅌ: '트', ㅍ: '프', ㅎ: '흐',
  ㅏ: '아', ㅐ: '애', ㅑ: '야', ㅒ: '얘', ㅓ: '어', ㅔ: '에', ㅕ: '여', ㅖ: '예',
  ㅗ: '오', ㅘ: '와', ㅙ: '왜', ㅚ: '외', ㅛ: '요', ㅜ: '우', ㅝ: '워',
  ㅞ: '웨', ㅟ: '위', ㅠ: '유', ㅡ: '으', ㅢ: '의', ㅣ: '이',
};

// 일본어 엔진(VOICEVOX)용 — 어차피 뒤에서 가나로 음차되므로 바로 가나로 적는다.
const JAMO_KANA = {
  ㄱ: 'ク', ㄲ: 'ク', ㄴ: 'ヌ', ㄷ: 'トゥ', ㄸ: 'トゥ', ㄹ: 'ル', ㅁ: 'ム',
  ㅂ: 'プ', ㅃ: 'プ', ㅅ: 'ス', ㅆ: 'ス', ㅇ: 'ウン', ㅈ: 'チュ', ㅉ: 'チュ',
  ㅊ: 'チュ', ㅋ: 'ク', ㅌ: 'トゥ', ㅍ: 'プ', ㅎ: 'フ',
  ㅏ: 'ア', ㅐ: 'エ', ㅑ: 'ヤ', ㅒ: 'イェ', ㅓ: 'オ', ㅔ: 'エ', ㅕ: 'ヨ', ㅖ: 'イェ',
  ㅗ: 'オ', ㅘ: 'ワ', ㅙ: 'ウェ', ㅚ: 'ウェ', ㅛ: 'ヨ', ㅜ: 'ウ', ㅝ: 'ウォ',
  ㅞ: 'ウェ', ㅟ: 'ウィ', ㅠ: 'ユ', ㅡ: 'ウ', ㅢ: 'イ', ㅣ: 'イ',
};

/**
 * 읽히면 곤란한 것들을 걷어낸다. 순서가 중요하다 — 코드블록을 먼저 지워야
 * 그 안의 마크다운·URL을 두 번 손대지 않는다.
 */
export function sanitizeForSpeech(text) {
  if (!text) return '';
  return text
    .replace(/```[\s\S]*?```/g, ' ')                 // 코드블록 통째로
    .replace(/`([^`]*)`/g, '$1')                     // 인라인 코드는 내용만 남김
    .replace(/<a?:(\w+):\d+>/g, ' ')                 // 커스텀 이모지
    .replace(/<@[!&]?\d+>|<#\d+>|<t:\d+(?::\w)?>/g, ' ') // 멘션·채널·타임스탬프
    .replace(/@(everyone|here)/g, ' ')
    .replace(/https?:\/\/\S+/g, ' 링크 ')            // URL은 통째로 "링크"라고만 읽는다
    .replace(/\p{Extended_Pictographic}\uFE0F?/gu, ' ') // 유니코드 이모지
    .replace(/[*_~|#>\\]/g, '')                      // 마크다운 장식
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 디스코드 텍스트 → 화면에 보여 줄 내용(clean)과 엔진에 넘길 내용(spoken).
 *
 * 잘라낸 뒤의 둘을 함께 돌려주는 건, 명령어가 "이렇게 읽었어요"라고 보여 줄 때
 * 화면의 글과 실제 발음이 어긋나지 않게 하기 위해서다.
 *
 * @param {string} text
 * @param {object} [opts]
 * @param {number} [opts.maxLength]      넘으면 잘라낸다(합성 시간 폭주 방지)
 * @param {boolean} [opts.transliterate] true면 가타카나로 음차한다(일본어 전용 엔진용).
 *                                       false면 한글 그대로 넘긴다(다국어 엔진용).
 * @returns {{clean: string, spoken: string, truncated: boolean}}
 */
export function prepareSpeech(text, { maxLength = 200, transliterate = true } = {}) {
  const full = sanitizeForSpeech(text);
  const truncated = full.length > maxLength;
  const clean = truncated ? full.slice(0, maxLength) : full;
  if (!clean) return { clean, spoken: '', truncated };

  const jamo = transliterate ? JAMO_KANA : JAMO_HANGUL;
  const expanded = [...clean].map((ch) => jamo[ch] ?? ch).join('');
  return {
    clean,
    spoken: (transliterate ? hangulToKatakana(expanded) : expanded).trim(),
    truncated,
  };
}

/**
 * VOICEVOX에 넘길 가나만. 읽을 게 없으면 빈 문자열.
 * @param {string} text
 * @param {{maxLength?: number}} [opts]
 * @returns {string}
 */
export function toSpeechKana(text, opts) {
  return prepareSpeech(text, opts).spoken;
}
