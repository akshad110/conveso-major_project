/**
 * Prompt construction + answer validation for the teacher.
 *
 * The whole point of this file: a small local model (llama3.1:8b) is much sloppier
 * than GPT-4, so nothing it returns is trusted. Everything the UI renders passes
 * through `normalizeAnswer` first, which repairs what it can and reports what it
 * can't so the route can retry.
 *
 * Pure ESM, no Next.js / browser imports — tools/verify-ai.mjs imports it directly.
 */

import { getLanguage, getSpeechMode } from "./languages.mjs";

/** Keys a model might use instead of `translation`, checked in this order. */
const TRANSLATION_KEYS = [
  "translation",
  "target",
  "translated",
  "sentence",
  "words",
  "tokens",
  "native",
  "japanese",
  "hindi",
  "spanish",
  "french",
  "german",
  "korean",
];

/**
 * Keys a model might use for the written word inside one word object. llama3.1:8b
 * reaches for "kanji"/"hangul"/"devanagari" at least as often as "word", and a word
 * object it doesn't recognise used to be dropped — which emptied the sentence and
 * burnt all three attempts on "no Japanese words found".
 */
const WORD_KEYS = [
  "word", "text", "token", "value", "surface", "spelling", "characters", "chars",
  "japanese", "kanji", "hindi", "devanagari", "korean", "hangul",
  "spanish", "french", "german", "native", "target", "form", "original",
];

/** Keys a model might use for the pronunciation line. */
const READING_KEYS = [
  "reading", "furigana", "romaji", "romanization", "romanisation", "romanized",
  "romanised", "transliteration", "pronunciation", "phonetic", "kana",
  "hiragana", "yomi", "latin",
];

/** Never mistake an explanation for the word itself. */
const META_KEYS = new Set([
  "meaning", "grammar", "grammarnote", "english", "translationenglish", "role",
  "partofspeech", "pos", "note", "notes", "explanation", "gloss", "type", "index",
]);

const MAX_WORDS = 60;
const MAX_SENTENCES = 6;
const MAX_CHUNKS = 20;
const MAX_STRING = 300;

/** Languages written without spaces — a bare string must not be split on them. */
const UNSPACED_SCRIPTS = new Set(["ja", "zh"]);

const PUNCTUATION = new Set([
  ".", ",", "!", "?", ";", ":", "¿", "¡", "…", "—", "-",
  "。", "、", "！", "？", "「", "」", "・",
  "।", "॥",
]);

const clean = (value) =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, MAX_STRING) : "";

/** Punctuation, digits and symbols carry no script, so the script check skips them. */
const isPunctuation = (word) =>
  typeof word === "string" && (PUNCTUATION.has(word) || /^[\p{P}\p{S}\p{N}\s]+$/u.test(word));

/**
 * English function words. Their presence is the giveaway that a question is
 * English, whatever else is in it — "how do i say app" is English even though
 * "app" is also how half of India spells आप.
 */
const ENGLISH_WORDS = new Set([
  "i", "you", "he", "she", "it", "we", "they", "me", "him", "her", "us", "them",
  "the", "a", "an", "is", "are", "am", "was", "were", "be", "been", "do", "does",
  "did", "have", "has", "had", "how", "what", "where", "when", "why", "who",
  "which", "can", "could", "would", "should", "will", "shall", "may", "might",
  "must", "to", "of", "in", "on", "at", "for", "with", "from", "by", "about",
  "my", "your", "his", "its", "our", "their", "this", "that", "these", "those",
  "and", "or", "but", "not", "no", "yes", "please", "thank", "thanks", "say",
  "said", "tell", "want", "like", "go", "going", "get", "got", "let", "there",
  "here", "very", "much", "many", "some", "any", "all", "if", "because", "so",
  "than", "then", "just", "now", "today", "tomorrow", "yesterday", "again",
]);

/**
 * Strip Latin accents so "cómo estás" is recognised from a hint list written
 * "como estas". Only U+0300–U+036F is removed: dropping combining marks wholesale
 * would turn कैसे into कस and 잘 into ㅈㅏㄹ.
 */
const fold = (text) =>
  text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").normalize("NFC").toLowerCase();

/**
 * Did the student type English, or the language they are learning?
 *
 * Students type "app kaise ho" as often as "how are you". Translating that as if
 * it were English produces nonsense, so the prompt has to change: correct their
 * sentence instead of translating it.
 *
 * Conservative on purpose — a false "native" reading is worse than a missed one,
 * so any English function word settles it, and Latin-script languages are judged
 * only on their own function words.
 *
 * @returns {"english"|"native"|"roman"}
 */
export function detectQuestion(question, language) {
  const text = clean(question);
  if (!text) return "english";

  if (!language.script.latin && language.script.pattern.test(text)) return "native";

  const tokens = fold(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (!tokens.length || tokens.length > 12) return "english";
  if (tokens.some((token) => ENGLISH_WORDS.has(token))) return "english";

  const hints = new Set((language.hints || []).map(fold));
  const hit = tokens.filter((token) => hints.has(token)).length;
  if (hit >= 2 || (tokens.length === 1 && hit === 1)) return "roman";
  return "english";
}

/* ------------------------------------------------------------------ prompt */

/**
 * The schema the model is shown. Deliberately one line and free of the
 * `grammarBreakdown[].translation` field the old version asked for: that field
 * duplicated the whole sentence in every entry, so the model spent about a third of
 * its output tokens retyping it. `normalizeBreakdown` fills it in locally instead.
 */
function schemaHint(readingEnabled) {
  const word = readingEnabled ? `{"word":"","reading":""}` : `{"word":""}`;
  return `{"english":"","translation":[${word}],"grammarBreakdown":[{"english":"","chunks":[{"translation":[${word}],"meaning":"","grammar":""}]}]}`;
}

/** The registry example, minus the fields the schema no longer asks for. */
function compactExample(example, readingEnabled) {
  const words = (list) =>
    (list || []).map((entry) => {
      const item = { word: entry.word };
      if (readingEnabled && entry.reading) item.reading = entry.reading;
      return item;
    });
  return {
    english: example.english,
    translation: words(example.translation),
    grammarBreakdown: (example.grammarBreakdown || []).map((sentence) => ({
      english: sentence.english,
      chunks: (sentence.chunks || []).map((chunk) => ({
        translation: words(chunk.translation),
        meaning: chunk.meaning,
        grammar: chunk.grammar,
      })),
    })),
  };
}

export function buildMessages({ languageCode, speechId, question }) {
  const language = getLanguage(languageCode);
  const mode = getSpeechMode(languageCode, speechId);
  const example = language.examples[mode.id] || Object.values(language.examples)[0];
  const readingEnabled = language.reading.enabled;

  const readingRule = readingEnabled
    ? `"reading": ${language.reading.hint}.`
    : `No "reading" field — ${language.label} uses the Latin alphabet.`;

  // One system message, not two: every extra line is prompt tokens the model has to
  // read before it can start answering, on every attempt.
  const system = `You are a ${language.label} teacher. Translate the student's English sentence into ${language.label} (${language.native}) in ${mode.label.toLowerCase()} speech (${mode.hint}), then explain how it is built.

Rules:
- Write the ${language.label} in ${language.script.name} — never ${language.script.instead}.
- Say it the way a native speaker says it, not word-for-word from the English.
- One sentence only, unless the student clearly asked for more.
- "translation": the sentence split into words in order; punctuation is its own word.
- ${readingRule}
- "grammarBreakdown": one entry per sentence. "chunks" splits that sentence into groups of one or more words with "meaning" in English and the "grammar" role (part of speech, particle, tense, agreement).
- Every word appears in exactly one chunk, in order.
- Reply with the JSON object only — no markdown, no code fence, no commentary.

Shape:
${schemaHint(readingEnabled)}

Example:
${JSON.stringify(compactExample(example, readingEnabled))}`;

  const asked = clean(question) || language.sample;
  const typedIn = detectQuestion(asked, language);

  // A student who types "app kaise ho" wants that sentence fixed, not translated
  // as though it were English.
  const user =
    typedIn === "english"
      ? `How do I say "${asked}" in ${language.label}?`
      : `The student wrote this in ${language.label}${typedIn === "roman" ? ", in Latin letters" : ""}, possibly with mistakes: "${asked}". Give the correct, natural ${language.label} sentence for it, and put its English meaning in "english".`;

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/* --------------------------------------------------------------- normalize */

function tokenize(text, languageCode) {
  const value = clean(text);
  if (!value) return [];
  if (UNSPACED_SCRIPTS.has(languageCode) && !value.includes(" ")) {
    return [{ word: value }];
  }
  const words = [];
  for (const raw of value.split(" ")) {
    let token = raw;
    // Pull leading punctuation (¿ ¡) out into its own word.
    while (token.length > 1 && PUNCTUATION.has(token[0])) {
      words.push({ word: token[0] });
      token = token.slice(1);
    }
    const trailing = [];
    while (token.length > 1 && PUNCTUATION.has(token[token.length - 1])) {
      trailing.unshift(token[token.length - 1]);
      token = token.slice(0, -1);
    }
    if (token) words.push({ word: token });
    for (const mark of trailing) words.push({ word: mark });
  }
  return words;
}

function pickTranslation(source) {
  if (!source || typeof source !== "object") return undefined;
  for (const key of TRANSLATION_KEYS) {
    if (source[key] !== undefined && source[key] !== null) return source[key];
  }
  return undefined;
}

const firstKey = (source, keys) => {
  for (const key of keys) {
    const value = clean(source[key]);
    if (value) return value;
  }
  return "";
};

/**
 * Pull one word out of one object, whatever the model decided to call the field.
 * Last resort: the first plain string that isn't an explanation — better a word on
 * the board than an empty sentence and three wasted attempts.
 */
function readWordEntry(entry, readingEnabled) {
  let word = firstKey(entry, WORD_KEYS);
  let reading = firstKey(entry, READING_KEYS);
  if (!word && reading) {
    word = reading;
    reading = "";
  }
  if (!word) {
    for (const [key, value] of Object.entries(entry)) {
      if (META_KEYS.has(key.toLowerCase())) continue;
      const candidate = clean(value);
      if (candidate) {
        word = candidate;
        break;
      }
    }
  }
  if (!word) return null;
  const item = { word };
  if (readingEnabled && reading && reading !== word) item.reading = reading;
  return item;
}

/** Does this object describe a single word, rather than hold a list of them? */
const looksLikeWord = (value) =>
  WORD_KEYS.some((key) => typeof value[key] === "string") ||
  READING_KEYS.some((key) => typeof value[key] === "string");

function normalizeWords(raw, languageCode, readingEnabled) {
  if (raw === undefined || raw === null) return [];
  if (typeof raw === "string") return tokenize(raw, languageCode);
  if (!Array.isArray(raw)) {
    if (typeof raw !== "object") return [];
    // A single word object, e.g. translation: { word: "日本", reading: "にほん" }.
    if (looksLikeWord(raw)) {
      const item = readWordEntry(raw, readingEnabled);
      return item ? [item] : [];
    }
    const inner = pickTranslation(raw);
    if (inner !== undefined) return normalizeWords(inner, languageCode, readingEnabled);
    // A container keyed by index, e.g. { "1": {...}, "2": {...} }.
    const values = Object.values(raw);
    if (values.length && values.every((value) => value && typeof value === "object")) {
      return normalizeWords(values, languageCode, readingEnabled);
    }
    return [];
  }

  const words = [];
  for (const entry of raw) {
    if (entry === undefined || entry === null) continue;
    if (typeof entry === "string") {
      words.push(...tokenize(entry, languageCode));
      continue;
    }
    if (typeof entry !== "object") continue;
    if (Array.isArray(entry)) {
      words.push(...normalizeWords(entry, languageCode, readingEnabled));
      continue;
    }

    const item = readWordEntry(entry, readingEnabled);
    if (item) words.push(item);
    if (words.length >= MAX_WORDS) break;
  }
  return words.slice(0, MAX_WORDS);
}

function normalizeChunks(raw, languageCode, readingEnabled) {
  if (!Array.isArray(raw)) return [];
  const chunks = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const words = normalizeWords(pickTranslation(entry) ?? entry.words, languageCode, readingEnabled);
    if (!words.length) continue;
    chunks.push({
      translation: words,
      meaning: clean(entry.meaning ?? entry.english ?? entry.translationEnglish),
      grammar: clean(entry.grammar ?? entry.grammarNote ?? entry.role ?? entry.partOfSpeech),
    });
    if (chunks.length >= MAX_CHUNKS) break;
  }
  return chunks;
}

function normalizeBreakdown(raw, languageCode, readingEnabled, fallback) {
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const sentences = [];

  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const words = normalizeWords(pickTranslation(entry), languageCode, readingEnabled);
    let chunks = normalizeChunks(entry.chunks ?? entry.parts ?? entry.breakdown, languageCode, readingEnabled);
    const english = clean(entry.english ?? entry.meaning ?? entry.translationEnglish);

    if (!chunks.length) {
      // A model that skipped chunks still gets rendered — as one chunk for the
      // whole sentence — rather than crashing the board.
      const chunkWords = words.length ? words : fallback.translation;
      if (!chunkWords.length) continue;
      chunks = [{ translation: chunkWords, meaning: english || fallback.english, grammar: "Sentence" }];
    }

    sentences.push({
      english: english || fallback.english,
      translation: words.length ? words : fallback.translation,
      chunks,
    });
    if (sentences.length >= MAX_SENTENCES) break;
  }

  if (!sentences.length) {
    sentences.push({
      english: fallback.english,
      translation: fallback.translation,
      chunks: [
        {
          translation: fallback.translation,
          meaning: fallback.english,
          grammar: "Sentence",
        },
      ],
    });
  }
  return sentences;
}

/**
 * @returns {{ ok: boolean, value: object|null, errors: string[] }}
 * `ok: false` means there was nothing usable — the caller should retry the model.
 */
export function normalizeAnswer(raw, { languageCode, speechId, question } = {}) {
  const language = getLanguage(languageCode);
  const mode = getSpeechMode(languageCode, speechId);
  const readingEnabled = language.reading.enabled;
  const errors = [];

  let source = raw;
  if (typeof source === "string") {
    try {
      source = JSON.parse(source);
    } catch {
      return { ok: false, value: null, errors: ["answer was a string, not JSON"] };
    }
  }
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return { ok: false, value: null, errors: ["answer was not a JSON object"] };
  }
  // Some models wrap everything one level deep.
  if (!pickTranslation(source) && source.answer && typeof source.answer === "object") {
    source = source.answer;
  }

  const translation = normalizeWords(pickTranslation(source), language.code, readingEnabled);
  if (!translation.length) {
    return {
      ok: false,
      value: null,
      errors: [`no ${language.label} words found — expected a "translation" array of word objects`],
    };
  }

  // A local model will cheerfully answer in romaji. That is not a lesson, so send it
  // back with a pointed instruction rather than putting it on the board.
  const spoken = translation.filter((entry) => !isPunctuation(entry.word));
  const inScript = spoken.filter((entry) => language.script.pattern.test(entry.word));
  if (spoken.length && inScript.length * 2 < spoken.length) {
    return {
      ok: false,
      value: null,
      errors: [
        `the sentence is not written in ${language.script.name} — got "${joinWords(translation, language.code)}". Rewrite it in ${language.script.name}, not ${language.script.instead}`,
      ],
    };
  }

  // If the student typed the target language, their own text is not the English
  // meaning — leaving it in "english" would print Hindi on the English line.
  const typedInTarget = detectQuestion(question, language) !== "english";
  const english =
    clean(source.english ?? source.englishSentence) || (typedInTarget ? "" : clean(question));
  if (!english) errors.push('missing "english"');

  if (readingEnabled) {
    // Only words that need a reading count: こんにちは is already its own reading,
    // so a kana-only answer must not be reported as missing furigana.
    const needsReading = translation.filter(
      (word) => !isPunctuation(word.word) && language.reading.needs.test(word.word)
    );
    const missing = needsReading.filter((word) => !word.reading);
    if (needsReading.length && missing.length === needsReading.length) {
      errors.push(`no "reading" on any word that needs one (${language.reading.label} will be empty)`);
    }
  }

  const breakdown = normalizeBreakdown(
    source.grammarBreakdown ?? source.grammar ?? source.breakdown,
    language.code,
    readingEnabled,
    { english, translation }
  );
  if (!Array.isArray(source.grammarBreakdown) || !source.grammarBreakdown.length) {
    errors.push('missing "grammarBreakdown" — synthesised one from the sentence');
  }

  return {
    ok: true,
    errors,
    value: {
      english,
      translation,
      grammarBreakdown: breakdown,
      language: language.code,
      languageLabel: language.label,
      speech: mode.id,
    },
  };
}

/* ------------------------------------------------------------------ speech */

/**
 * Join word objects back into a sentence a speech synthesiser can read, and
 * record where each word starts in that string — the viseme timeline needs those
 * offsets to resync against SpeechSynthesis `onboundary` events.
 *
 * @returns {{ text: string, charIndexes: number[] }}
 */
export function speechPlan(words, languageCode) {
  const charIndexes = [];
  if (!Array.isArray(words)) return { text: "", charIndexes };

  const unspaced = UNSPACED_SCRIPTS.has(languageCode);
  let text = "";
  for (const entry of words) {
    const word = entry?.word;
    if (!word) {
      charIndexes.push(text.length);
      continue;
    }
    const noSpaceBefore =
      unspaced || word.length === 1 && PUNCTUATION.has(word) && word !== "¿" && word !== "¡";
    const opensQuestion = text.endsWith("¿") || text.endsWith("¡");
    if (text && !noSpaceBefore && !opensQuestion) text += " ";
    charIndexes.push(text.length);
    text += word;
  }
  return { text, charIndexes };
}

/** Join word objects back into a sentence a speech synthesiser can read. */
export const joinWords = (words, languageCode) => speechPlan(words, languageCode).text;

export const answerToSpeechText = (answer) =>
  joinWords(answer?.translation, answer?.language);
