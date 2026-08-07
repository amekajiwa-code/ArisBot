// 한글을 가타카나로 음차한다.
//
// VOICEVOX(즌다몬 목소리를 내는 엔진)는 일본어 전용이라 한글을 그대로 넘기면 읽지
// 못한다. 그래서 한글 음절을 초성·중성·종성으로 쪼개 일본어 가나로 근사한 뒤 넘긴다.
// 일본어에 없는 대립(ㅓ/ㅗ, ㅡ/ㅜ, ㄴ받침/ㅇ받침)은 한쪽으로 뭉개지므로 발음은 어차피
// 어눌하다 — 그게 이 기능의 취지다.
//
// 다만 일상 회화에서 늘 발동하는 음운 규칙 넷은 넣었다 — 연음, 평음 유성음화, 비음화,
// 유음화. 이게 없으면 "한국어"가 ハンククオ, "감사합니다"가 カムサハプニタ가 되어 알아듣기
// 힘들다. 넣으면 각각 ハングゴ, カムサハムニダ로 일본어권의 관용 표기와 일치한다.
//
// 반대로 드물게 쓰이는 규칙은 일부러 뺐다. ㄹ비음화(종로 → 종노)와 구개음화(굳이 → 구지)는
// 적용되지 않으니 그런 낱말은 철자대로 읽힌다.
//
// 한글이 아닌 문자는 그대로 통과시킨다(일본어를 섞어 쓸 수 있게).

const S_BASE = 0xac00;
const V_COUNT = 21;
const T_COUNT = 28;
const S_COUNT = 19 * V_COUNT * T_COUNT;

// 중성 21개 → 조합 키. ㅓ와 ㅗ, ㅡ와 ㅜ, ㅐ와 ㅔ는 일본어에서 구분이 안 돼 하나로 합친다.
const MEDIAL_KEYS = [
  'a', 'e', 'ya', 'ye', 'o', 'e', 'yo', 'ye', 'o', 'wa', 'we',
  'we', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'u', 'i', 'i',
];

const PLAIN_INDEX = { a: 0, i: 1, u: 2, e: 3, o: 4 };
const Y_INDEX = { ya: 0, yu: 1, yo: 2, ye: 3 };
const W_INDEX = { wa: 0, wi: 1, we: 2, wo: 3 };

// 합요음(クァ 등)이 없는 초성은 u단 가나 + 통상 크기 모음으로 근사한다.
// 작은 모음(ゥァ 같은 비표준 조합)은 OpenJTalk가 흘려버릴 수 있어 쓰지 않는다.
const W_FALLBACK_TAIL = ['ワ', 'イ', 'エ', 'オ'];

//   row = [a, i, u, e, o] / y = [ya, yu, yo, ye] / w = [wa, wi, we, wo]
const K = { row: ['カ', 'キ', 'ク', 'ケ', 'コ'], y: ['キャ', 'キュ', 'キョ', 'キェ'], w: ['クァ', 'クィ', 'クェ', 'クォ'] };
const G = { row: ['ガ', 'ギ', 'グ', 'ゲ', 'ゴ'], y: ['ギャ', 'ギュ', 'ギョ', 'ギェ'], w: ['グァ', 'グィ', 'グェ', 'グォ'] };
const T = { row: ['タ', 'ティ', 'トゥ', 'テ', 'ト'], y: ['テャ', 'テュ', 'テョ', 'テェ'] };
const D = { row: ['ダ', 'ディ', 'ドゥ', 'デ', 'ド'], y: ['デャ', 'デュ', 'デョ', 'デェ'] };
const P = { row: ['パ', 'ピ', 'プ', 'ペ', 'ポ'], y: ['ピャ', 'ピュ', 'ピョ', 'ピェ'] };
const B = { row: ['バ', 'ビ', 'ブ', 'ベ', 'ボ'], y: ['ビャ', 'ビュ', 'ビョ', 'ビェ'] };
const CH = { row: ['チャ', 'チ', 'チュ', 'チェ', 'チョ'], y: ['チャ', 'チュ', 'チョ', 'チェ'] };
const J = { row: ['ジャ', 'ジ', 'ジュ', 'ジェ', 'ジョ'], y: ['ジャ', 'ジュ', 'ジョ', 'ジェ'] };

// 초성 19개: ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ
//   voiced = 모음·유성 받침 뒤에서 쓰는 유성 변이형. 평음(ㄱㄷㅂㅈ)에만 있다.
//            된소리·거센소리는 한국어에서 유성음화하지 않으므로 일부러 비워 뒀다.
//   tense  = 된소리 → 앞에 촉음(ッ)을 붙여 긴장을 흉내낸다
const INITIALS = [
  { ...K, voiced: G },                                                        // ㄱ
  { ...K, tense: true },                                                      // ㄲ
  { row: ['ナ', 'ニ', 'ヌ', 'ネ', 'ノ'], y: ['ニャ', 'ニュ', 'ニョ', 'ニェ'] },      // ㄴ
  { ...T, voiced: D },                                                        // ㄷ
  { ...T, tense: true },                                                      // ㄸ
  { row: ['ラ', 'リ', 'ル', 'レ', 'ロ'], y: ['リャ', 'リュ', 'リョ', 'リェ'] },      // ㄹ
  { row: ['マ', 'ミ', 'ム', 'メ', 'モ'], y: ['ミャ', 'ミュ', 'ミョ', 'ミェ'] },      // ㅁ
  { ...P, voiced: B },                                                        // ㅂ
  { ...P, tense: true },                                                      // ㅃ
  { row: ['サ', 'シ', 'ス', 'セ', 'ソ'], y: ['シャ', 'シュ', 'ショ', 'シェ'] },      // ㅅ
  { row: ['サ', 'シ', 'ス', 'セ', 'ソ'], y: ['シャ', 'シュ', 'ショ', 'シェ'], tense: true }, // ㅆ
  {                                                                           // ㅇ (무음)
    row: ['ア', 'イ', 'ウ', 'エ', 'オ'],
    y: ['ヤ', 'ユ', 'ヨ', 'イェ'],
    w: ['ワ', 'ウィ', 'ウェ', 'ウォ'],
  },
  { ...CH, voiced: J },                                                       // ㅈ
  { ...CH, tense: true },                                                     // ㅉ
  CH,                                                                         // ㅊ
  K,                                                                          // ㅋ
  T,                                                                          // ㅌ
  P,                                                                          // ㅍ
  {                                                                           // ㅎ
    row: ['ハ', 'ヒ', 'フ', 'ヘ', 'ホ'],
    y: ['ヒャ', 'ヒュ', 'ヒョ', 'ヒェ'],
    w: ['ファ', 'フィ', 'フェ', 'フォ'],
  },
];

// 종성 28개 → 가나. 표준 발음의 7종성(ㄱㄴㄷㄹㅁㅂㅇ)으로 먼저 중화한 결과다.
// ㄴ과 ㅇ이 똑같이 ン이 되는 건 일본어에 둘을 가르는 표기가 없어서다.
const FINALS = [
  '', 'ク', 'ク', 'ク', 'ン', 'ン', 'ン', 'ッ', 'ル', 'ク', 'ム', 'ル', 'ル', 'ル',
  'プ', 'ル', 'ム', 'プ', 'プ', 'ッ', 'ッ', 'ン', 'ッ', 'ッ', 'ク', 'ッ', 'プ', 'ッ',
];

// 뒤따르는 평음을 유성음으로 만드는 종성 — 받침이 없거나(모음으로 끝남) 유성 자음일 때.
const VOICING_FINALS = new Set(['', 'ン', 'ル', 'ム']);

// 연음(連音) 규칙: 받침 뒤에 초성 ㅇ이 오면 받침이 다음 음절의 초성으로 넘어간다.
// (한국어 → 한구거, 있어요 → 이써요)
//   종성 인덱스 → [남는 종성 인덱스, 넘어가는 초성 인덱스] (-1 = ㅎ 탈락)
// 없는 항목(0 = 받침 없음, 21 = ㅇ)은 연음이 일어나지 않는다.
const LIAISON = {
  1: [0, 0],    // ㄱ
  2: [0, 1],    // ㄲ
  3: [1, 10],   // ㄳ → 넋이[넉씨]
  4: [0, 2],    // ㄴ
  5: [4, 12],   // ㄵ → 앉아[안자]
  6: [0, 2],    // ㄶ → 많아[마나] (ㅎ 탈락, ㄴ이 넘어감)
  7: [0, 3],    // ㄷ
  8: [0, 5],    // ㄹ
  9: [8, 0],    // ㄺ → 읽어[일거]
  10: [8, 6],   // ㄻ → 젊어[절머]
  11: [8, 7],   // ㄼ → 밟아[발바]
  12: [8, 10],  // ㄽ
  13: [8, 16],  // ㄾ
  14: [8, 17],  // ㄿ
  15: [0, 5],   // ㅀ → 싫어[시러] (ㅎ 탈락, ㄹ이 넘어감)
  16: [0, 6],   // ㅁ
  17: [0, 7],   // ㅂ
  18: [17, 10], // ㅄ → 값이[갑씨]
  19: [0, 9],   // ㅅ → 옷이[오시]
  20: [0, 10],  // ㅆ → 있어[이써]
  22: [0, 12],  // ㅈ
  23: [0, 14],  // ㅊ
  24: [0, 15],  // ㅋ
  25: [0, 16],  // ㅌ
  26: [0, 17],  // ㅍ
  27: [0, -1],  // ㅎ → 좋아[조아]
};

const NO_INITIAL = 11; // 초성 ㅇ
const INITIAL_N = 2;   // 초성 ㄴ
const INITIAL_R = 5;   // 초성 ㄹ
const INITIAL_M = 6;   // 초성 ㅁ

// 비음화: 파열 받침 뒤에 ㄴ·ㅁ이 오면 받침이 같은 자리의 비음으로 바뀐다.
// (입니다 → 임니다, 한국말 → 한궁말) 한국어 존댓말이 죄다 "-습니다/-ㅂ니다"로 끝나므로
// 이게 빠지면 대부분의 문장이 어색해진다.
const NASALIZED = { ク: 'ン', ッ: 'ン', プ: 'ム' };

// 유음화: ㄴ과 ㄹ이 만나면 양쪽 다 ㄹ이 된다. (신라 → 실라, 연락 → 열락, 설날 → 설랄)
const FINAL_N = new Set([4, 5, 6]);          // ㄴ ㄵ ㄶ — ㅇ(21)은 유음화하지 않는다(종로 → 종노)
const FINAL_R = new Set([8, 11, 12, 13, 15]); // ㄹ ㄼ ㄽ ㄾ ㅀ
const FINAL_R_INDEX = 8;

/**
 * 한 음절의 초성+중성을 가나로.
 * @param {number} initialIdx  -1이면 연음으로 ㅎ이 탈락한 자리 → 무음 초성으로 읽는다
 * @param {string|null} prevFinal  앞 음절의 종성 가나. '' = 앞 음절이 모음으로 끝남,
 *                                null = 앞이 한글 음절이 아님(어두). 둘을 갈라야 어두의
 *                                평음이 유성음화하거나 촉음으로 시작하는 걸 막을 수 있다.
 */
function renderOnset(initialIdx, medialIdx, prevFinal) {
  const base = INITIALS[initialIdx < 0 ? NO_INITIAL : initialIdx];
  const kana = base.voiced && VOICING_FINALS.has(prevFinal) ? base.voiced : base;
  const key = MEDIAL_KEYS[medialIdx];
  // 된소리의 촉음은 앞이 받침 없이 끝날 때만 넣는다. 이미 받침이 있으면(넋이 → ノクシ)
  // ッ를 또 붙여봐야 겹쳐 읽힐 뿐이다.
  const lead = base.tense && prevFinal === '' ? 'ッ' : '';

  if (key in PLAIN_INDEX) return lead + kana.row[PLAIN_INDEX[key]];
  if (key in Y_INDEX) return lead + kana.y[Y_INDEX[key]];

  const w = W_INDEX[key];
  if (kana.w) return lead + kana.w[w];
  return lead + kana.row[PLAIN_INDEX.u] + W_FALLBACK_TAIL[w];
}

/** 한글 음절이면 [초성, 중성, 종성] 인덱스, 아니면 null. */
function decompose(ch) {
  const code = ch.codePointAt(0) - S_BASE;
  if (code < 0 || code >= S_COUNT) return null;
  return [
    Math.floor(code / (V_COUNT * T_COUNT)),
    Math.floor(code / T_COUNT) % V_COUNT,
    code % T_COUNT,
  ];
}

/**
 * 한글을 가타카나로 음차한다. 한글이 아닌 문자는 그대로 남는다.
 * @param {string} text
 * @returns {string}
 */
export function hangulToKatakana(text) {
  if (!text) return '';

  // 1단계: 음절은 [초성, 중성, 종성]으로, 나머지는 원문 문자 그대로 늘어놓는다.
  const items = [...text].map((ch) => decompose(ch) ?? ch);

  // 2단계: 연음. 받침이 있고 바로 다음이 초성 ㅇ인 음절이면 받침을 넘긴다.
  // 공백이나 문장부호가 끼면 인접하지 않으므로 자연히 적용되지 않는다.
  for (let i = 0; i < items.length - 1; i += 1) {
    const cur = items[i];
    const next = items[i + 1];
    if (typeof cur === 'string' || typeof next === 'string') continue;
    if (next[0] !== NO_INITIAL) continue;
    const rule = LIAISON[cur[2]];
    if (!rule) continue;
    [cur[2], next[0]] = rule;
  }

  // 3단계: 유음화. 초성을 바꾸는 쪽이 있어 종성을 확정하기 전에 처리해야 한다.
  for (let i = 0; i < items.length - 1; i += 1) {
    const cur = items[i];
    const next = items[i + 1];
    if (typeof cur === 'string' || typeof next === 'string') continue;
    if (FINAL_N.has(cur[2]) && next[0] === INITIAL_R) cur[2] = FINAL_R_INDEX;      // 신라 → 실라
    else if (FINAL_R.has(cur[2]) && next[0] === INITIAL_N) next[0] = INITIAL_R;    // 설날 → 설랄
  }

  // 4단계: 종성 확정. 비음화는 뒤 음절의 초성을 봐야 정해지므로 먼저 한 줄로 뽑아 둔다.
  const finals = items.map((item, i) => {
    if (typeof item === 'string') return null;
    const kana = FINALS[item[2]];
    const next = items[i + 1];
    const nasalizes = Array.isArray(next) && (next[0] === INITIAL_N || next[0] === INITIAL_M);
    return nasalizes ? NASALIZED[kana] ?? kana : kana;
  });

  // 5단계: 초성+중성을 붙여 찍어낸다. 유성음화·촉음 여부는 (비음화까지 끝난) 앞 음절
  // 받침으로 판단한다. 앞이 한글이 아니면(공백·문장부호·문자열 시작) 어두이므로 null.
  return items
    .map((item, i) => {
      if (typeof item === 'string') return item;
      const prevFinal = Array.isArray(items[i - 1]) ? finals[i - 1] : null;
      return renderOnset(item[0], item[1], prevFinal) + finals[i];
    })
    .join('');
}
