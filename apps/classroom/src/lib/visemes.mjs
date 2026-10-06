/**
 * Text → viseme timeline.
 *
 * Azure's speech SDK used to hand us `[offsetMs, visemeId]` pairs and Teacher.jsx
 * drives the model's morph targets straight off those ids (0–21). The browser's
 * SpeechSynthesis gives no such thing, so we derive the timeline from the letters
 * themselves: map graphemes to Azure's viseme classes, give each one a nominal
 * duration, and let the player stretch that timeline to real speech using
 * `onboundary` events.
 *
 * Approximate by design — it is lip-sync, not phonology. But it is *language
 * aware*: kana, Devanagari and Hangul are decomposed properly instead of being
 * treated as silence, and where the answer carries a reading/romanization we use
 * that, because it spells the sounds out.
 *
 * Azure viseme ids used here:
 *   0 silence · 1 ə/ʌ · 2 ɑ · 3 ɔ · 4 ɛ/ʊ · 5 ɝ · 6 i/j · 7 u/w · 8 o · 9 aʊ
 *   10 ɔɪ · 11 aɪ · 12 h · 13 r · 14 l · 15 s/z · 16 ʃ/tʃ/dʒ · 17 ð/θ · 18 f/v
 *   19 t/d/n · 20 k/g/ŋ · 21 p/b/m
 */

export const MAX_VISEME_ID = 21;

const SIL = 0;
const V = { a: 2, e: 4, i: 6, o: 8, u: 7, schwa: 1, aw: 3, er: 5, ai: 11, au: 9, oi: 10 };

const DUR = {
  vowel: 100,
  consonant: 60,
  long: 60, // added to a lengthened vowel
  gemination: 40, // added to a doubled consonant
  wordGap: 70,
  comma: 200,
  sentence: 320,
  lead: 80,
};

const isVowelViseme = (id) => id >= 1 && id <= 11;

/* --------------------------------------------------------------- Latin ---- */

const DEACCENT = {
  á: "a", à: "a", â: "a", ä: "e", ã: "a", å: "a", ā: "a",
  é: "e", è: "e", ê: "e", ë: "e", ē: "e",
  í: "i", ì: "i", î: "i", ï: "i", ī: "i",
  ó: "o", ò: "o", ô: "o", ö: "o", õ: "o", ō: "o",
  ú: "u", ù: "u", û: "u", ü: "u", ū: "u",
  ñ: "ny", ç: "s", ß: "ss", œ: "e", æ: "e", ø: "o", ý: "i", ÿ: "i",
};

const LATIN_DIGRAPHS = {
  sh: [16], ch: [16], th: [17], ph: [18], wh: [7], gh: [20], ck: [20], kh: [20],
  ng: [20], nk: [20, 20], qu: [20, V.u], ll: [14], rr: [13], ss: [15], tt: [19],
  pp: [21], mm: [21], nn: [19], ff: [18], dd: [19], gg: [20], cc: [20], zz: [15],
  ee: [V.i, -1], oo: [V.u, -1], ea: [V.i], ie: [V.i], ei: [V.ai], ai: [V.ai],
  ay: [V.ai], ey: [V.i], oy: [V.oi], oi: [V.oi], au: [V.au], aw: [V.aw],
  ou: [V.au], ow: [V.au], eu: [V.oi], äu: [V.oi], ue: [V.u], ui: [V.u, V.i],
  ar: [V.a, 13], er: [V.er], ir: [V.er], or: [V.aw, 13], ur: [V.er],
};

const LATIN_SINGLES = {
  a: V.a, e: V.e, i: V.i, o: V.o, u: V.u, y: V.i,
  b: 21, c: 20, d: 19, f: 18, g: 20, h: 12, j: 16, k: 20, l: 14, m: 21,
  n: 19, p: 21, q: 20, r: 13, s: 15, t: 19, v: 18, w: 7, x: 20, z: 15,
};

function latinPhones(word) {
  const text = word
    .toLowerCase()
    .split("")
    .map((char) => DEACCENT[char] ?? char)
    .join("");

  const phones = [];
  let i = 0;
  while (i < text.length) {
    const pair = text.slice(i, i + 2);
    const digraph = LATIN_DIGRAPHS[pair];
    if (digraph) {
      for (const id of digraph) {
        if (id === -1) phones.push({ lengthen: true });
        else phones.push({ id });
      }
      i += 2;
      continue;
    }
    const single = LATIN_SINGLES[text[i]];
    if (single !== undefined) phones.push({ id: single });
    else if (/[0-9]/.test(text[i])) phones.push({ id: V.a });
    i += 1;
  }
  return phones;
}

/* ---------------------------------------------------------------- Kana ---- */

// Hiragana only — katakana is shifted onto it first.
const KANA = {
  あ: [V.a], い: [V.i], う: [V.u], え: [V.e], お: [V.o],
  か: [20, V.a], き: [20, V.i], く: [20, V.u], け: [20, V.e], こ: [20, V.o],
  が: [20, V.a], ぎ: [20, V.i], ぐ: [20, V.u], げ: [20, V.e], ご: [20, V.o],
  さ: [15, V.a], し: [16, V.i], す: [15, V.u], せ: [15, V.e], そ: [15, V.o],
  ざ: [15, V.a], じ: [16, V.i], ず: [15, V.u], ぜ: [15, V.e], ぞ: [15, V.o],
  た: [19, V.a], ち: [16, V.i], つ: [15, V.u], て: [19, V.e], と: [19, V.o],
  だ: [19, V.a], ぢ: [16, V.i], づ: [15, V.u], で: [19, V.e], ど: [19, V.o],
  な: [19, V.a], に: [19, V.i], ぬ: [19, V.u], ね: [19, V.e], の: [19, V.o],
  は: [12, V.a], ひ: [12, V.i], ふ: [18, V.u], へ: [12, V.e], ほ: [12, V.o],
  ば: [21, V.a], び: [21, V.i], ぶ: [21, V.u], べ: [21, V.e], ぼ: [21, V.o],
  ぱ: [21, V.a], ぴ: [21, V.i], ぷ: [21, V.u], ぺ: [21, V.e], ぽ: [21, V.o],
  ま: [21, V.a], み: [21, V.i], む: [21, V.u], め: [21, V.e], も: [21, V.o],
  や: [6, V.a], ゆ: [6, V.u], よ: [6, V.o],
  ら: [14, V.a], り: [14, V.i], る: [14, V.u], れ: [14, V.e], ろ: [14, V.o],
  わ: [7, V.a], ゐ: [7, V.i], ゑ: [7, V.e], を: [V.o], ん: [19],
  ゃ: [V.a], ゅ: [V.u], ょ: [V.o], ぁ: [V.a], ぃ: [V.i], ぅ: [V.u], ぇ: [V.e], ぉ: [V.o],
  ゔ: [18, V.u],
};

const toHiragana = (char) => {
  const code = char.codePointAt(0);
  // Katakana block → hiragana.
  if (code >= 0x30a1 && code <= 0x30f6) return String.fromCodePoint(code - 0x60);
  return char;
};

function kanaPhones(word) {
  const phones = [];
  let geminate = false;
  for (const rawChar of word) {
    const char = toHiragana(rawChar);
    if (char === "っ") {
      geminate = true;
      continue;
    }
    if (char === "ー" || char === "〜") {
      phones.push({ lengthen: true });
      continue;
    }
    const kana = KANA[char];
    if (kana) {
      kana.forEach((id, index) => {
        const phone = { id };
        if (geminate && index === 0 && !isVowelViseme(id)) phone.geminate = true;
        phones.push(phone);
      });
      geminate = false;
      continue;
    }
    // Kanji or anything else with no reading supplied: keep the mouth moving
    // rather than freezing it, one open syllable per character.
    if (/[一-鿿々〇]/.test(char)) {
      phones.push({ id: 20 }, { id: V.a });
    }
  }
  return phones;
}

/* ---------------------------------------------------------- Devanagari ---- */

const DEVA_CONSONANTS = {
  क: 20, ख: 20, ग: 20, घ: 20, ङ: 20,
  च: 16, छ: 16, ज: 16, झ: 16, ञ: 19,
  ट: 19, ठ: 19, ड: 19, ढ: 19, ण: 19,
  त: 19, थ: 19, द: 19, ध: 19, न: 19,
  प: 21, फ: 18, ब: 21, भ: 21, म: 21,
  य: 6, र: 13, ल: 14, व: 18, ळ: 14,
  श: 16, ष: 16, स: 15, ह: 12,
  क़: 20, ख़: 20, ग़: 20, ज़: 15, ड़: 19, ढ़: 19, फ़: 18,
};

const DEVA_INDEPENDENT = {
  अ: V.a, आ: V.a, इ: V.i, ई: V.i, उ: V.u, ऊ: V.u,
  ऋ: 13, ए: V.e, ऐ: V.ai, ओ: V.o, औ: V.au, ऑ: V.aw, ॐ: V.o,
};

const DEVA_MATRA = {
  "ा": V.a, "ि": V.i, "ी": V.i, "ु": V.u, "ू": V.u, "ृ": 13,
  "े": V.e, "ै": V.ai, "ो": V.o, "ौ": V.au, "ॉ": V.aw, "ॅ": V.schwa,
};

const DEVA_LONG = new Set(["ा", "ी", "ू", "े", "ो"]);

function devanagariPhones(word) {
  const phones = [];
  const chars = [...word];
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    if (char === "़") continue; // nukta, already folded into the tables above
    if (char === "ं" || char === "ँ") {
      phones.push({ id: 19 });
      continue;
    }
    if (char === "ः") {
      phones.push({ id: 12 });
      continue;
    }
    if (char === "्") continue; // virama — handled by the lookahead below

    const consonant = DEVA_CONSONANTS[char];
    if (consonant !== undefined) {
      phones.push({ id: consonant });
      const next = chars[i + 1];
      if (next === "्") continue; // consonant cluster, no vowel
      const matra = DEVA_MATRA[next];
      if (matra !== undefined) {
        phones.push({ id: matra });
        if (DEVA_LONG.has(next)) phones.push({ lengthen: true });
        i += 1;
        continue;
      }
      phones.push({ id: V.schwa }); // inherent 'a'
      continue;
    }

    const independent = DEVA_INDEPENDENT[char];
    if (independent !== undefined) {
      phones.push({ id: independent });
      if (char === "आ" || char === "ई" || char === "ऊ" || char === "ए" || char === "ओ") {
        phones.push({ lengthen: true });
      }
      continue;
    }
    const matra = DEVA_MATRA[char];
    if (matra !== undefined) phones.push({ id: matra });
  }
  return phones;
}

/* -------------------------------------------------------------- Hangul ---- */

const JAMO_INITIAL = [20, 20, 19, 19, 19, 14, 21, 21, 21, 15, 15, null, 16, 16, 16, 20, 19, 21, 12];
const JAMO_MEDIAL = [
  [V.a], [V.e], [6, V.a], [6, V.e], [V.aw], [V.e], [6, V.aw], [6, V.e],
  [V.o], [7, V.a], [7, V.e], [7, V.e], [6, V.o], [V.u], [7, V.aw], [7, V.e],
  [7, V.i], [6, V.u], [V.schwa], [V.schwa, V.i], [V.i],
];
const JAMO_FINAL = [
  null, 20, 20, 20, 19, 19, 19, 19, 14, 14, 21, 14, 14, 14, 21, 14,
  21, 21, 21, 19, 19, 20, 19, 19, 20, 19, 21, 12,
];

function hangulPhones(word) {
  const phones = [];
  for (const char of word) {
    const code = char.codePointAt(0) - 0xac00;
    if (code < 0 || code > 11171) {
      if (/[a-z]/i.test(char)) phones.push(...latinPhones(char));
      continue;
    }
    const initial = JAMO_INITIAL[Math.floor(code / 588)];
    const medial = JAMO_MEDIAL[Math.floor((code % 588) / 28)];
    const final = JAMO_FINAL[code % 28];
    if (initial !== null && initial !== undefined) phones.push({ id: initial });
    for (const id of medial || []) phones.push({ id });
    if (final !== null && final !== undefined) phones.push({ id: final });
  }
  return phones;
}

/* ------------------------------------------------------------ dispatcher -- */

const SCRIPT_TESTS = [
  { test: /[぀-ヿ一-鿿]/, phones: kanaPhones },
  { test: /[ऀ-ॿ]/, phones: devanagariPhones },
  { test: /[가-힯]/, phones: hangulPhones },
];

/** Phones for one word, choosing the mapper by the script it is written in. */
export function wordPhones(word) {
  if (typeof word !== "string" || !word) return [];
  for (const script of SCRIPT_TESTS) {
    if (script.test.test(word)) return script.phones(word);
  }
  return latinPhones(word);
}

/* --------------------------------------------------------------- timeline - */

const PAUSE_HEAVY = new Set([".", "!", "?", "。", "！", "？", "।", "॥", ";", ":"]);
const PAUSE_LIGHT = new Set([",", "、", "…", "—"]);
const MAX_VISEMES = 2000;

/**
 * @param {Array<{word: string, reading?: string}>} words
 * @param {string} spokenText  the exact string handed to the synthesiser
 * @param {Array<number>} charIndexes  start offset of each word inside spokenText
 * @returns {{ visemes: Array<[number, number]>, marks: Array<{charIndex: number, time: number}>, duration: number }}
 */
export function buildVisemeTimeline(words, spokenText = "", charIndexes = []) {
  const visemes = [[0, SIL]];
  const marks = [];
  let time = DUR.lead;

  words.forEach((entry, index) => {
    const word = entry?.word || "";
    if (!word) return;
    const charIndex = charIndexes[index] ?? 0;
    marks.push({ charIndex, time });

    const isPause = [...word].every((char) => PAUSE_HEAVY.has(char) || PAUSE_LIGHT.has(char));
    if (isPause) {
      visemes.push([time, SIL]);
      time += [...word].some((char) => PAUSE_HEAVY.has(char)) ? DUR.sentence : DUR.comma;
      return;
    }

    // A supplied reading spells the sounds out — prefer it over kanji/script.
    const source = entry.reading && entry.reading.trim() ? entry.reading : word;
    const phones = wordPhones(source);

    for (const phone of phones) {
      if (visemes.length >= MAX_VISEMES) break;
      if (phone.lengthen) {
        time += DUR.long;
        continue;
      }
      visemes.push([Math.round(time), phone.id]);
      time += isVowelViseme(phone.id) ? DUR.vowel : DUR.consonant;
      if (phone.geminate) time += DUR.gemination;
    }
    time += DUR.wordGap;
  });

  visemes.push([Math.round(time), SIL]);
  return { visemes, marks, duration: Math.round(time + DUR.lead) };
}

/** Convenience wrapper for a plain string (no word objects, no readings). */
export function visemesFromText(text, languageCode) {
  const unspaced = languageCode === "ja" || languageCode === "zh";
  const words = unspaced ? [...String(text)].map((char) => ({ word: char })) : String(text).split(/\s+/).map((word) => ({ word }));
  const charIndexes = [];
  let cursor = 0;
  for (const entry of words) {
    charIndexes.push(cursor);
    cursor += entry.word.length + (unspaced ? 0 : 1);
  }
  return buildVisemeTimeline(words, String(text), charIndexes);
}
