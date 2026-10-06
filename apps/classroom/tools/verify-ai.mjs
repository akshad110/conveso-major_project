#!/usr/bin/env node
/**
 * Offline verifier for the local-AI teacher.
 *
 * Nothing in here needs Ollama, a browser or npm install — it imports the app's
 * *real* modules and puts them under pressure, the same way the courtroom
 * project's bridge verifier does. A clean run means: every language is wired up,
 * the prompt has no hardcoded Japanese left in it, a sloppy 8B model cannot crash
 * the board, the viseme timeline is sane for every script, and the Ollama client's
 * repair loop and error codes behave.
 *
 *   node tools/verify-ai.mjs            # offline checks only
 *   node tools/verify-ai.mjs --verbose
 *   node tools/verify-ai.mjs --health   # ask the real Ollama what it has
 *   node tools/verify-ai.mjs --live     # + one real translation per language
 */

import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  LANGUAGES,
  LANGUAGE_CODES,
  DEFAULT_LANGUAGE,
  getLanguage,
  getSpeechMode,
  isLanguage,
  speechModeIds,
} from "../src/lib/languages.mjs";
import {
  buildMessages,
  detectQuestion,
  joinWords,
  normalizeAnswer,
  speechPlan,
} from "../src/lib/answerSchema.mjs";
import { buildVisemeTimeline, visemesFromText, MAX_VISEME_ID } from "../src/lib/visemes.mjs";
import { lookupPhrase, phraseAliases, phraseCount, phraseKey, PHRASES } from "../src/lib/phrasebook.mjs";
import {
  chatJSON,
  clearModelCache,
  extractJSON,
  health,
  NUM_CTX,
  OllamaError,
  OLLAMA_URL,
  prefill,
  preload,
} from "../src/lib/ollama.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const VERBOSE = argv.includes("--verbose") || argv.includes("-v");
const LIVE = argv.includes("--live");
const HEALTH_ONLY = argv.includes("--health");
const ALL = argv.includes("--all");

let passed = 0;
const failures = [];
const notes = [];

function check(name, fn) {
  try {
    const detail = fn();
    passed++;
    console.log(`  ok   ${name}${VERBOSE && detail ? ` — ${detail}` : ""}`);
  } catch (error) {
    failures.push({ name, error });
    console.log(`  FAIL ${name}\n         ${error.message}`);
  }
}

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

/* ------------------------------------------------------- shape of an answer */

/** Exactly what MessagesList.jsx dereferences. Anything missing = a crash on the board. */
function assertRenderable(answer, label) {
  assert(answer && typeof answer === "object", `${label}: answer is not an object`);
  assert(typeof answer.english === "string", `${label}: english is not a string`);
  assert(Array.isArray(answer.translation) && answer.translation.length, `${label}: translation empty`);
  for (const word of answer.translation) {
    assert(word && typeof word.word === "string" && word.word.length, `${label}: word without text`);
    assert(word.reading === undefined || typeof word.reading === "string", `${label}: bad reading`);
  }
  assert(
    Array.isArray(answer.grammarBreakdown) && answer.grammarBreakdown.length,
    `${label}: grammarBreakdown empty`
  );
  for (const sentence of answer.grammarBreakdown) {
    assert(typeof sentence.english === "string", `${label}: sentence.english missing`);
    assert(Array.isArray(sentence.translation) && sentence.translation.length, `${label}: sentence.translation empty`);
    assert(Array.isArray(sentence.chunks) && sentence.chunks.length, `${label}: chunks empty`);
    for (const chunk of sentence.chunks) {
      assert(Array.isArray(chunk.translation) && chunk.translation.length, `${label}: chunk.translation empty`);
      assert(typeof chunk.meaning === "string", `${label}: chunk.meaning not a string`);
      assert(typeof chunk.grammar === "string", `${label}: chunk.grammar not a string`);
    }
  }
  assert(isLanguage(answer.language), `${label}: unknown language ${answer.language}`);
}

/* ------------------------------------------------------------- 1. registry */

console.log("\n1. language registry");

check("every language is fully described", () => {
  const fonts = new Set(["font-jp", "font-sans", "font-deva", "font-kr"]);
  for (const code of LANGUAGE_CODES) {
    const language = LANGUAGES[code];
    assert(language, `${code} is listed in LANGUAGE_CODES but missing from LANGUAGES`);
    assert(language.code === code, `${code}: code field mismatch`);
    for (const field of ["label", "native", "sample", "fontClass"]) {
      assert(typeof language[field] === "string" && language[field].length, `${code}: missing ${field}`);
    }
    assert(fonts.has(language.fontClass), `${code}: fontClass ${language.fontClass} is not in tailwind.config.js`);
    assert(/^[a-z]{2}-[A-Z]{2}$/.test(language.voice.locale), `${code}: voice.locale looks wrong`);
    assert(Array.isArray(language.voice.female) && language.voice.female.length, `${code}: no female voices listed`);
    assert(Array.isArray(language.voice.male) && language.voice.male.length, `${code}: no male voices listed`);
    assert(language.board?.title && language.board?.native, `${code}: board title/native missing`);
    assert(language.speechModes.length >= 1, `${code}: no speech modes`);
    const ids = language.speechModes.map((mode) => mode.id);
    assert(new Set(ids).size === ids.length, `${code}: duplicate speech mode ids`);
    for (const mode of language.speechModes) {
      assert(mode.label && mode.hint, `${code}/${mode.id}: label or hint missing`);
      assert(language.examples[mode.id], `${code}: no worked example for "${mode.id}"`);
    }
    assert(typeof language.reading?.enabled === "boolean", `${code}: reading.enabled missing`);
    if (language.reading.enabled) assert(language.reading.hint, `${code}: reading enabled but no hint for the model`);
  }
  return `${LANGUAGE_CODES.length} languages`;
});

check("Object.keys(LANGUAGES) and LANGUAGE_CODES agree", () => {
  const missing = Object.keys(LANGUAGES).filter((code) => !LANGUAGE_CODES.includes(code));
  assert(!missing.length, `not shown in the picker: ${missing.join(", ")}`);
  assert(isLanguage(DEFAULT_LANGUAGE), "DEFAULT_LANGUAGE is not a language");
});

check("every worked example survives the normalizer untouched", () => {
  for (const code of LANGUAGE_CODES) {
    for (const mode of LANGUAGES[code].speechModes) {
      const example = LANGUAGES[code].examples[mode.id];
      const result = normalizeAnswer(example, { languageCode: code, speechId: mode.id, question: example.english });
      assert(result.ok, `${code}/${mode.id}: example rejected — ${result.errors.join("; ")}`);
      assert(!result.errors.length, `${code}/${mode.id}: example produced warnings — ${result.errors.join("; ")}`);
      assertRenderable(result.value, `${code}/${mode.id} example`);
      assert(
        result.value.translation.length === example.translation.length,
        `${code}/${mode.id}: word count changed (${example.translation.length} → ${result.value.translation.length})`
      );
    }
  }
});

check("unknown language / speech mode fall back instead of throwing", () => {
  assert(getLanguage("xx").code === DEFAULT_LANGUAGE, "unknown language did not fall back");
  assert(getSpeechMode("ja", "shouting").id === speechModeIds("ja")[0], "unknown speech mode did not fall back");
  assert(!isLanguage("xx"), "isLanguage said yes to nonsense");
});

/* --------------------------------------------------------------- 2. prompt */

console.log("\n2. prompt construction");

check("prompt names the requested language and register", () => {
  for (const code of LANGUAGE_CODES) {
    for (const mode of LANGUAGES[code].speechModes) {
      const messages = buildMessages({ languageCode: code, speechId: mode.id, question: "Where is the station?" });
      assert(messages.length === 2, `${code}: expected one system message and one user message`);
      const system = messages[0].content;
      assert(system.includes(LANGUAGES[code].label), `${code}: prompt never says "${LANGUAGES[code].label}"`);
      assert(system.includes(LANGUAGES[code].native), `${code}: prompt never shows the native name`);
      assert(system.includes(mode.hint), `${code}/${mode.id}: register hint missing from prompt`);
      assert(system.includes('"grammarBreakdown"'), `${code}: schema missing from prompt`);
      assert(system.includes(LANGUAGES[code].script.name), `${code}: prompt never demands the right script`);
      assert(messages[1].content.includes("Where is the station?"), `${code}: question missing from prompt`);
    }
  }
});

check("the prompt stays inside its context budget", () => {
  // Ollama drops the *oldest* tokens when prompt + answer exceed num_ctx — which is
  // the system message holding the schema. A bloated prompt therefore doesn't get
  // truncated visibly, it just makes the model answer in the wrong shape.
  const budget = 2600;
  for (const code of LANGUAGE_CODES) {
    for (const mode of LANGUAGES[code].speechModes) {
      const size = buildMessages({ languageCode: code, speechId: mode.id, question: "Where is the station?" })
        .map((message) => message.content.length)
        .reduce((total, length) => total + length, 0);
      assert(size < budget, `${code}/${mode.id}: prompt is ${size} chars, over the ${budget} budget`);
    }
  }
  return `largest ${Math.max(
    ...LANGUAGE_CODES.flatMap((code) =>
      LANGUAGES[code].speechModes.map((mode) =>
        buildMessages({ languageCode: code, speechId: mode.id, question: "x" })
          .map((message) => message.content.length)
          .reduce((total, length) => total + length, 0)
      )
    )
  )} chars`;
});

check("the example in the prompt is itself an acceptable answer", () => {
  // If the worked example wouldn't survive validation, the model is being taught to
  // fail. This also pins the trimmed schema: drop a field the normalizer needs and
  // this check fails immediately.
  for (const code of LANGUAGE_CODES) {
    for (const mode of LANGUAGES[code].speechModes) {
      const system = buildMessages({ languageCode: code, speechId: mode.id, question: "x" })[0].content;
      const example = extractJSON(system.slice(system.indexOf("Example:")));
      assert(example, `${code}/${mode.id}: no JSON example found in the prompt`);
      const result = normalizeAnswer(example, { languageCode: code, speechId: mode.id, question: example.english });
      assert(result.ok, `${code}/${mode.id}: the prompt's own example is rejected`);
      assert(!result.errors.length, `${code}/${mode.id}: example only survives with repairs: ${result.errors.join("; ")}`);
      assertRenderable(result.value, `prompt example/${code}/${mode.id}`);
      assert(
        LANGUAGES[code].script.pattern.test(joinWords(result.value.translation, code)),
        `${code}/${mode.id}: the example is not written in ${LANGUAGES[code].script.name}`
      );
      // The example has to *demonstrate* the rules, not merely survive them: show
      // real chunking, and cover every word of the sentence exactly once, in order.
      assert(
        result.value.grammarBreakdown.some((sentence) => sentence.chunks.length >= 2),
        `${code}/${mode.id}: the example shows only one chunk, so it teaches no breakdown`
      );
      const chunked = result.value.grammarBreakdown
        .flatMap((sentence) => sentence.chunks)
        .flatMap((chunk) => chunk.translation.map((word) => word.word));
      const whole = result.value.translation.map((word) => word.word);
      assert(
        chunked.join(" ") === whole.join(" "),
        `${code}/${mode.id}: chunks do not cover the sentence — "${chunked.join(" ")}" vs "${whole.join(" ")}"`
      );
    }
  }
});

check("no other language leaks into a prompt (hardcoding guard)", () => {
  for (const code of LANGUAGE_CODES) {
    const prompt = buildMessages({ languageCode: code, speechId: speechModeIds(code)[0], question: "Good morning" })
      .map((message) => message.content)
      .join("\n");
    for (const other of LANGUAGE_CODES) {
      if (other === code) continue;
      const label = LANGUAGES[other].label;
      assert(!prompt.includes(label), `${code} prompt mentions ${label} — a hardcoded example slipped through`);
      assert(
        !prompt.includes(`"${LANGUAGES[other].label.toLowerCase()}"`),
        `${code} prompt uses the "${LANGUAGES[other].label.toLowerCase()}" JSON key`
      );
    }
  }
});

check("reading instruction matches the script", () => {
  for (const code of LANGUAGE_CODES) {
    const system = buildMessages({ languageCode: code, speechId: speechModeIds(code)[0], question: "Hello" })[0].content;
    if (LANGUAGES[code].reading.enabled) {
      assert(system.includes(`"reading": ${LANGUAGES[code].reading.hint}`), `${code}: should demand a reading`);
      assert(system.includes('"reading":""'), `${code}: the shape should show the reading field`);
    } else {
      assert(system.includes('No "reading" field'), `${code}: should forbid a reading`);
      assert(!system.includes('"reading":""'), `${code}: the shape still offers a reading field`);
    }
  }
});

check("empty question falls back to the language's sample", () => {
  const messages = buildMessages({ languageCode: "hi", speechId: "formal", question: "   " });
  assert(messages[1].content.includes(LANGUAGES.hi.sample), "sample question not used as fallback");
});

/* ----------------------------------------------------------- 3. normalizer */

console.log("\n3. normalizer under a sloppy local model");

const junk = [
  ["plain string body", "not json at all", false],
  ["JSON array", [1, 2, 3], false],
  ["null", null, false],
  ["empty object", {}, false],
  ["translation present but empty", { english: "hi", translation: [] }, false],
  ["words with no text", { english: "hi", translation: [{ reading: "aa" }, {}] }, false],
];

check("hopeless answers are rejected, not rendered", () => {
  for (const [label, input, expected] of junk) {
    const result = normalizeAnswer(input, { languageCode: "ja", speechId: "formal", question: "Hello" });
    assert(result.ok === expected, `${label}: expected ok=${expected}`);
    if (!expected) assert(result.errors.length, `${label}: rejected with no reason given`);
  }
});

check("model using the old `japanese` key still works", () => {
  const result = normalizeAnswer(
    { english: "Hello", japanese: [{ word: "こんにちは", reading: "こんにちは" }] },
    { languageCode: "ja", speechId: "formal", question: "Hello" }
  );
  assert(result.ok, "rejected a legacy-key answer");
  assertRenderable(result.value, "legacy key");
  assert(!result.value.translation[0].reading, "reading identical to the word should be dropped");
});

check("word objects keyed by script name are read, not dropped", () => {
  // The bug that burnt all three attempts in the real app: llama3.1:8b names the
  // field after the script instead of "word", every entry got dropped, and the
  // sentence came out empty — "no Japanese words found".
  const cases = [
    ["ja", { translation: [{ kanji: "日本", hiragana: "にほん" }, { kana: "です" }] }, "日本"],
    ["ko", { translation: [{ hangul: "한국", romanization: "hanguk" }] }, "한국"],
    ["hi", { translation: [{ devanagari: "भारत", transliteration: "bhaarat" }] }, "भारत"],
    ["de", { translation: [{ text: "Deutschland" }] }, "Deutschland"],
    ["ja", { translation: [{ surface: "犬", yomi: "いぬ" }] }, "犬"],
  ];
  for (const [code, body, expected] of cases) {
    const result = normalizeAnswer(
      { english: "test", ...body },
      { languageCode: code, speechId: speechModeIds(code)[0], question: "test" }
    );
    assert(result.ok, `${code}: rejected ${JSON.stringify(body)}`);
    assert(
      result.value.translation[0].word === expected,
      `${code}: expected first word ${expected}, got ${result.value.translation[0].word}`
    );
    assertRenderable(result.value, `alias/${code}`);
  }
  const withReading = normalizeAnswer(
    { english: "test", translation: [{ kanji: "日本", hiragana: "にほん" }] },
    { languageCode: "ja", speechId: "formal", question: "test" }
  );
  assert(withReading.value.translation[0].reading === "にほん", "the kana field should become the reading");
});

check("a translation buried in a container is still found", () => {
  const shapes = [
    { translation: { words: [{ word: "日本" }, { word: "語" }] } },
    { answer: { translation: [{ word: "日本" }] } },
    { translation: { 1: { word: "日本" }, 2: { word: "語" } } },
    { translation: { word: "日本", reading: "にほん" } },
    { tokens: [{ word: "日本" }] },
  ];
  for (const shape of shapes) {
    const result = normalizeAnswer(
      { english: "test", ...shape },
      { languageCode: "ja", speechId: "formal", question: "test" }
    );
    assert(result.ok, `not unwrapped: ${JSON.stringify(shape)}`);
    assert(result.value.translation[0].word === "日本", `wrong first word for ${JSON.stringify(shape)}`);
  }
});

check("an answer in the wrong script is rejected with an instruction", () => {
  const romaji = [
    ["ja", [{ word: "Nihon" }, { word: "ni" }, { word: "sundeimasu" }], "Japanese characters"],
    ["hi", [{ word: "aap" }, { word: "kahan" }, { word: "hain" }], "Devanagari"],
    ["ko", [{ word: "hanguk" }, { word: "eo" }], "Hangul"],
  ];
  for (const [code, translation, expectedHint] of romaji) {
    const result = normalizeAnswer(
      { english: "test", translation },
      { languageCode: code, speechId: speechModeIds(code)[0], question: "test" }
    );
    assert(!result.ok, `${code}: romaji was accepted onto the board`);
    const reason = result.errors.join(" ");
    assert(reason.includes(expectedHint), `${code}: the retry gives no script instruction — "${reason}"`);
  }
  // Punctuation and digits must not count against a genuinely correct sentence.
  const mixed = normalizeAnswer(
    { english: "It is 3 o'clock.", translation: [{ word: "3" }, { word: "時", reading: "じ" }, { word: "です" }, { word: "。" }] },
    { languageCode: "ja", speechId: "formal", question: "It is 3 o'clock." }
  );
  assert(mixed.ok, "digits and punctuation should not trip the script check");
});

check("translation as a bare string is tokenized per script", () => {
  const spanish = normalizeAnswer(
    { english: "Do you live in Spain?", translation: "¿Vives en España?" },
    { languageCode: "es", speechId: "casual", question: "Do you live in Spain?" }
  );
  assert(spanish.ok, "Spanish string rejected");
  const words = spanish.value.translation.map((word) => word.word);
  assert(words[0] === "¿", `leading ¿ not split out: ${words.join("|")}`);
  assert(words.includes("España"), `word lost: ${words.join("|")}`);
  assert(words[words.length - 1] === "?", `trailing ? not split out: ${words.join("|")}`);

  const japanese = normalizeAnswer(
    { english: "Hello", translation: "こんにちは、元気ですか?" },
    { languageCode: "ja", speechId: "formal", question: "Hello" }
  );
  assert(japanese.ok, "Japanese string rejected");
  assert(japanese.value.translation.length === 1, "unspaced Japanese must not be split on spaces");
});

check("missing grammarBreakdown is synthesised, with a warning", () => {
  const result = normalizeAnswer(
    { english: "Hello", translation: [{ word: "Hallo" }] },
    { languageCode: "de", speechId: "casual", question: "Hello" }
  );
  assert(result.ok, "rejected an answer that only lacked the breakdown");
  assertRenderable(result.value, "synthesised breakdown");
  assert(result.errors.some((error) => error.includes("grammarBreakdown")), "no warning about the missing breakdown");
});

check("breakdown entries missing chunks are repaired", () => {
  const result = normalizeAnswer(
    {
      english: "Hello",
      translation: [{ word: "Bonjour" }],
      grammarBreakdown: [{ english: "Hello", translation: [{ word: "Bonjour" }] }, null, "junk"],
    },
    { languageCode: "fr", speechId: "formal", question: "Hello" }
  );
  assert(result.ok, "rejected repairable breakdown");
  assertRenderable(result.value, "chunkless breakdown");
  assert(result.value.grammarBreakdown[0].chunks.length === 1, "expected one synthesised chunk");
});

check("readings are stripped for Latin-script languages", () => {
  const result = normalizeAnswer(
    {
      english: "Do you live in Germany?",
      translation: [{ word: "Wohnst", reading: "vohnst" }, { word: "du", reading: "doo" }],
      grammarBreakdown: [
        {
          english: "Do you live in Germany?",
          translation: [{ word: "Wohnst", reading: "vohnst" }],
          chunks: [{ translation: [{ word: "Wohnst", reading: "vohnst" }], meaning: "live", grammar: "Verb" }],
        },
      ],
    },
    { languageCode: "de", speechId: "casual", question: "Do you live in Germany?" }
  );
  assert(result.ok, "German answer rejected");
  const readings = [
    ...result.value.translation,
    ...result.value.grammarBreakdown[0].translation,
    ...result.value.grammarBreakdown[0].chunks[0].translation,
  ].filter((word) => word.reading);
  assert(!readings.length, "invented pronunciations should not reach a Latin-script board");
});

check("a missing reading on a furigana language is only a warning", () => {
  const result = normalizeAnswer(
    { english: "Hello", translation: [{ word: "日本" }] },
    { languageCode: "ja", speechId: "formal", question: "Hello" }
  );
  assert(result.ok, "should still render");
  assert(result.errors.some((error) => error.includes("reading")), "missing furigana should warn");
});

check("answers wrapped one level deep are unwrapped", () => {
  const result = normalizeAnswer(
    { answer: { english: "Hello", translation: [{ word: "안녕", reading: "annyeong" }] } },
    { languageCode: "ko", speechId: "casual", question: "Hello" }
  );
  assert(result.ok, "wrapped answer rejected");
  assert(result.value.translation[0].reading === "annyeong", "reading lost while unwrapping");
});

check("oversized answers are capped", () => {
  const many = Array.from({ length: 400 }, (_, i) => ({ word: `w${i}` }));
  const result = normalizeAnswer(
    { english: "x".repeat(5000), translation: many, grammarBreakdown: Array.from({ length: 40 }, () => ({ english: "s", translation: many, chunks: [] })) },
    { languageCode: "es", speechId: "formal", question: "long" }
  );
  assert(result.ok, "capped answer rejected");
  assert(result.value.translation.length <= 60, `translation not capped: ${result.value.translation.length}`);
  assert(result.value.grammarBreakdown.length <= 6, "breakdown not capped");
  assert(result.value.english.length <= 300, "english not truncated");
});

check("chunk meaning/grammar are coerced to strings", () => {
  // React throws "Objects are not valid as a React child", so a model that sends
  // an object or array here must never reach the board.
  const result = normalizeAnswer(
    {
      english: "Hello",
      translation: [{ word: "Hola" }],
      grammarBreakdown: [
        {
          english: { text: "Hello" },
          translation: [{ word: "Hola" }],
          chunks: [
            { translation: [{ word: "Hola" }], meaning: { es: "hello" }, grammar: ["Interjection"] },
            { translation: [{ word: "Hola" }] },
          ],
        },
      ],
    },
    { languageCode: "es", speechId: "casual", question: "Hello" }
  );
  assert(result.ok, "rejected instead of repaired");
  assertRenderable(result.value, "object-valued fields");
  for (const chunk of result.value.grammarBreakdown[0].chunks) {
    assert(typeof chunk.meaning === "string", "meaning is not a string");
    assert(typeof chunk.grammar === "string", "grammar is not a string");
  }
});

check("nothing throws on hostile input", () => {
  const hostile = [
    undefined,
    0,
    false,
    { translation: [{ word: { nested: true } }] },
    { translation: [[["deep"]]] },
    { translation: { word: "object-not-array" } },
    { english: 42, translation: [{ word: "ok" }], grammarBreakdown: "nope" },
    { translation: [{ word: "ok" }], grammarBreakdown: [{ chunks: [{ translation: null }] }] },
    {
      translation: [{ word: "ok", reading: { deep: 1 } }],
      grammarBreakdown: [
        {
          english: ["array"],
          translation: [{ word: "ok" }],
          chunks: [{ translation: [{ word: "ok" }], meaning: { a: 1 }, grammar: 7 }],
        },
      ],
    },
  ];
  for (const input of hostile) {
    for (const code of LANGUAGE_CODES) {
      const result = normalizeAnswer(input, { languageCode: code, speechId: "formal", question: "q" });
      if (result.ok) assertRenderable(result.value, `hostile/${code}`);
    }
  }
});

/* ------------------------------------------------------ 4. speech plan --- */

console.log("\n4. spoken text + word offsets");

check("charIndexes point at the words they claim", () => {
  for (const code of LANGUAGE_CODES) {
    const example = LANGUAGES[code].examples[speechModeIds(code)[0]];
    const { text, charIndexes } = speechPlan(example.translation, code);
    assert(charIndexes.length === example.translation.length, `${code}: one offset per word expected`);
    example.translation.forEach((word, index) => {
      assert(
        text.startsWith(word.word, charIndexes[index]),
        `${code}: offset ${charIndexes[index]} does not start "${word.word}" in "${text}"`
      );
    });
  }
});

check("Japanese is joined without spaces, Spanish punctuation hugs its word", () => {
  const ja = joinWords(LANGUAGES.ja.examples.formal.translation, "ja");
  assert(!ja.includes(" "), `Japanese should have no spaces: ${ja}`);
  assert(ja.endsWith("か?"), `unexpected Japanese sentence: ${ja}`);

  const es = joinWords(LANGUAGES.es.examples.formal.translation, "es");
  assert(es.startsWith("¿Vive usted"), `¿ should attach to the next word: ${es}`);
  assert(es.endsWith("España?"), `? should attach to the previous word: ${es}`);
  assert(!es.includes("  "), "double space in spoken text");
});

check("empty and malformed word lists produce empty text, not a crash", () => {
  assert(joinWords(null, "es") === "", "null words should give empty text");
  assert(joinWords([{}, { word: "" }], "es") === "", "empty words should give empty text");
});

/* ---------------------------------------------------------- 5. visemes --- */

console.log("\n5. viseme timeline");

check("ids in range, times non-decreasing, ends silent", () => {
  for (const code of LANGUAGE_CODES) {
    for (const mode of LANGUAGES[code].speechModes) {
      const words = LANGUAGES[code].examples[mode.id].translation;
      const { text, charIndexes } = speechPlan(words, code);
      const timeline = buildVisemeTimeline(words, text, charIndexes);
      assert(timeline.visemes.length > 4, `${code}/${mode.id}: timeline is too short to animate`);
      let previous = -1;
      for (const [time, id] of timeline.visemes) {
        assert(Number.isFinite(time) && time >= previous, `${code}: time went backwards (${previous} → ${time})`);
        assert(Number.isInteger(id) && id >= 0 && id <= MAX_VISEME_ID, `${code}: viseme id ${id} out of range`);
        previous = time;
      }
      assert(timeline.visemes[0][1] === 0, `${code}: should open on silence`);
      assert(timeline.visemes.at(-1)[1] === 0, `${code}: should close on silence`);
      assert(timeline.duration >= previous, `${code}: duration shorter than the last viseme`);
      for (const mark of timeline.marks) {
        assert(mark.charIndex >= 0 && mark.charIndex <= text.length, `${code}: mark outside the text`);
      }
    }
  }
});

check("kana, Devanagari and Hangul are decomposed, not skipped", () => {
  const cases = [
    ["ja", [{ word: "こんにちは" }], [20, 6]],
    ["ja", [{ word: "日本", reading: "にほん" }], [19, 12]],
    ["hi", [{ word: "नमस्ते" }], [19, 21, 15]],
    ["ko", [{ word: "한국" }], [20]],
    ["es", [{ word: "España" }], [15, 19]],
  ];
  for (const [code, words, expected] of cases) {
    const { text, charIndexes } = speechPlan(words, code);
    const ids = buildVisemeTimeline(words, text, charIndexes).visemes.map(([, id]) => id);
    for (const id of expected) {
      assert(ids.includes(id), `${code} "${words[0].word}": expected viseme ${id} in [${ids.join(",")}]`);
    }
    assert(ids.filter((id) => id !== 0).length >= 3, `${code}: barely any mouth movement`);
  }
});

check("script decomposition is exact, one word per script", () => {
  // Pinned sequences — these catch a dropped batchim, a dropped inherent vowel or
  // a dropped matra, which a "contains viseme X" check happily sleeps through.
  const expected = [
    ["ja", { word: "こんにちは" }, [20, 8, 19, 19, 6, 16, 6, 12, 2]], // ko-n-ni-chi-ha
    ["hi", { word: "नमस्ते" }, [19, 1, 21, 1, 15, 19, 4]], // na-ma-s-te
    ["ko", { word: "한국" }, [12, 2, 19, 20, 7, 20]], // h-a-n + g-u-k
  ];
  for (const [code, word, sequence] of expected) {
    const ids = buildVisemeTimeline([word], word.word, [0])
      .visemes.map(([, id]) => id)
      .filter((id) => id !== 0);
    assert(
      JSON.stringify(ids) === JSON.stringify(sequence),
      `${code} "${word.word}": expected [${sequence.join(",")}] got [${ids.join(",")}]`
    );
  }
});

check("a supplied reading drives the mouth instead of the kanji", () => {
  const withReading = buildVisemeTimeline([{ word: "日本", reading: "にほん" }], "日本", [0]).visemes;
  const withoutReading = buildVisemeTimeline([{ word: "日本" }], "日本", [0]).visemes;
  assert(
    JSON.stringify(withReading) !== JSON.stringify(withoutReading),
    "reading made no difference — the kanji fallback is being used even when a reading exists"
  );
  assert(withoutReading.length > 2, "kanji with no reading should still move the mouth");
});

check("punctuation becomes a pause, not a phoneme", () => {
  const { visemes } = buildVisemeTimeline([{ word: "Hola" }, { word: "." }], "Hola.", [0, 4]);
  const last = visemes.at(-2);
  assert(last[1] === 0, `sentence-final punctuation should be silence, got ${last[1]}`);
});

check("accented Latin never yields an undefined viseme", () => {
  const text = "¿Vive usted en España? Où habitez-vous? Grüßen Sie!";
  const { visemes } = visemesFromText(text, "fr");
  for (const [, id] of visemes) {
    assert(Number.isInteger(id) && id >= 0 && id <= MAX_VISEME_ID, `bad id ${id} from accented text`);
  }
  assert(visemes.length > 20, "accented sentence produced almost no visemes");
});

/* ---------------------------------------------------- 6. ollama client --- */

console.log("\n6. Ollama client");

check("extractJSON digs the object out of a messy reply", () => {
  const target = { english: "Hi", translation: [{ word: "Hola" }] };
  const wrapped = [
    JSON.stringify(target),
    "```json\n" + JSON.stringify(target) + "\n```",
    'Sure! Here is the JSON:\n' + JSON.stringify(target) + "\nHope that helps!",
    JSON.stringify({ ...target, note: 'a } brace inside a "string"' }),
  ];
  for (const reply of wrapped) {
    const parsed = extractJSON(reply);
    assert(parsed && parsed.english === "Hi", `failed to extract from: ${reply.slice(0, 40)}…`);
  }
  assert(extractJSON("no object here") === null, "should return null for prose");
  assert(extractJSON("{ broken: ") === null, "should return null for an unterminated object");
  assert(extractJSON(undefined) === null, "should return null for non-strings");
});

/** Stub Ollama with a scripted set of replies. */
function withFakeOllama(replies, fn) {
  const realFetch = globalThis.fetch;
  let index = 0;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    const path = String(url).replace(OLLAMA_URL, "");
    calls.push({ path, body: options?.body ? JSON.parse(options.body) : null });
    if (path === "/api/tags") {
      return new Response(JSON.stringify({ models: [{ name: "llama3.1:8b" }, { name: "qwen2.5:7b" }] }), { status: 200 });
    }
    const reply = replies[Math.min(index++, replies.length - 1)];
    if (typeof reply === "function") return reply();
    return new Response(JSON.stringify({ message: { content: reply } }), { status: 200 });
  };
  clearModelCache();
  return Promise.resolve(fn(calls)).finally(() => {
    globalThis.fetch = realFetch;
    clearModelCache();
  });
}

const goodJapanese = JSON.stringify(LANGUAGES.ja.examples.formal);

await (async () => {
  console.log("  (async client checks)");

  await withFakeOllama([goodJapanese], async (calls) => {
    const result = await chatJSON({
      messages: buildMessages({ languageCode: "ja", speechId: "formal", question: "Do you live in Japan?" }),
      validate: (parsed) => normalizeAnswer(parsed, { languageCode: "ja", speechId: "formal", question: "Do you live in Japan?" }),
    });
    check("happy path returns a normalized answer in one attempt", () => {
      assert(result.attempts === 1, `expected 1 attempt, got ${result.attempts}`);
      assert(result.model === "llama3.1:8b", `expected the preferred model, got ${result.model}`);
      assertRenderable(result.value, "live-ish answer");
      const chat = calls.find((call) => call.path === "/api/chat");
      assert(chat.body.format === "json", "JSON mode not requested");
      assert(chat.body.stream === false, "streaming should be off");
      // The speed settings. num_ctx is the one that actually broke answers when it
      // was left at Ollama's default; the others keep an answer down to seconds.
      assert(chat.body.options.num_ctx === NUM_CTX, `num_ctx not sent (got ${chat.body.options.num_ctx})`);
      assert(chat.body.options.num_predict <= 800, `num_predict too generous: ${chat.body.options.num_predict}`);
      assert(chat.body.options.temperature <= 0.3, `temperature too high for a schema task: ${chat.body.options.temperature}`);
      assert(/^\d+m$/.test(String(chat.body.keep_alive)), `keep_alive should hold the model resident, got ${chat.body.keep_alive}`);
      assert(Number(String(chat.body.keep_alive).replace("m", "")) >= 10, "keep_alive under 10m reloads the model constantly");
      assert(Array.isArray(result.timings) && result.timings.length === 1, "per-attempt timings not reported");
    });
  });

  await withFakeOllama(["I'd love to help!", JSON.stringify({ english: "x" }), goodJapanese], async (calls) => {
    const result = await chatJSON({
      messages: buildMessages({ languageCode: "ja", speechId: "formal", question: "Do you live in Japan?" }),
      validate: (parsed) => normalizeAnswer(parsed, { languageCode: "ja", speechId: "formal", question: "Do you live in Japan?" }),
    });
    check("repair loop recovers from prose, then from bad schema", () => {
      assert(result.attempts === 3, `expected 3 attempts, got ${result.attempts}`);
      assert(result.warnings.length >= 2, `expected the failures to be reported: ${result.warnings.join(" | ")}`);
      assertRenderable(result.value, "repaired answer");
      const chats = calls.filter((call) => call.path === "/api/chat");
      assert(chats.length === 3, `expected 3 chat calls, got ${chats.length}`);
      const feedback = chats[2].body.messages.map((message) => message.content).join("\n");
      assert(feedback.includes("rejected"), "the model was not told what was wrong");
      assert(chats[2].body.messages.length > chats[0].body.messages.length, "conversation did not grow");
    });
  });

  await withFakeOllama(["nope"], async (calls) => {
    const messages = buildMessages({
      languageCode: "hi",
      speechId: "formal",
      question: getLanguage("hi").sample,
    });
    const result = await prefill({ messages, model: "llama3.1:8b" });
    check("prefill pushes the real prompt through, so its KV prefix is cached", () => {
      assert(result.ok, `prefill failed: ${result.error}`);
      const chat = calls.find((call) => call.path === "/api/chat");
      assert(chat, "prefill did not call /api/chat");
      // Ollama only reuses the KV state of a prefix it has literally seen before, so
      // a "warm-up" that sends a different prompt buys the student nothing.
      assert(
        JSON.stringify(chat.body.messages) === JSON.stringify(messages),
        "prefill must send the exact prompt the next question will send"
      );
      assert(chat.body.options.num_predict === 1, `prefill should ask for 1 token, not ${chat.body.options.num_predict}`);
      assert(chat.body.options.num_ctx === NUM_CTX, "prefill must reserve the same context as the real call");
      assert(chat.body.keep_alive, "prefill without keep_alive throws the cached prefix away");
      assert(chat.body.stream === false, "prefill should not stream");
    });
  });

  await withFakeOllama(["nope"], async (calls) => {
    const result = await preload();
    check("preload asks Ollama to hold the weights in memory", () => {
      assert(result.ok, `preload failed: ${result.error}`);
      const generate = calls.find((call) => call.path === "/api/generate");
      assert(generate, "preload did not call /api/generate");
      assert(generate.body.prompt === "", "preload should send no prompt — it only loads weights");
      assert(generate.body.keep_alive, "preload without keep_alive is pointless");
      assert(generate.body.options.num_ctx === NUM_CTX, "preload must reserve the same context as the real call");
    });
  });

  await withFakeOllama(["nope"], async () => {
    let thrown = null;
    try {
      await chatJSON({ messages: [{ role: "user", content: "hi" }], validate: () => ({ ok: false, errors: ["no"] }), attempts: 2 });
    } catch (error) {
      thrown = error;
    }
    check("gives up with MODEL_OUTPUT_INVALID and advice", () => {
      assert(thrown instanceof OllamaError, "wrong error type");
      assert(thrown.code === "MODEL_OUTPUT_INVALID", `wrong code: ${thrown.code}`);
      assert(/ollama pull/.test(thrown.hint || ""), "no actionable hint");
    });
  });

  await withFakeOllama(
    [
      () => {
        throw Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:11434"), { code: "ECONNREFUSED" });
      },
    ],
    async () => {
      const realFetch = globalThis.fetch;
      globalThis.fetch = async () => {
        throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
      };
      let thrown = null;
      try {
        clearModelCache();
        await chatJSON({ messages: [{ role: "user", content: "hi" }] });
      } catch (error) {
        thrown = error;
      } finally {
        globalThis.fetch = realFetch;
      }
      check("a dead Ollama is reported as OLLAMA_UNREACHABLE", () => {
        assert(thrown instanceof OllamaError, `wrong error type: ${thrown}`);
        assert(thrown.code === "OLLAMA_UNREACHABLE", `wrong code: ${thrown.code}`);
        assert(/ollama serve/.test(thrown.hint || ""), "hint should mention `ollama serve`");
      });
    }
  );

  await (async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (String(url).endsWith("/api/tags")) return new Response(JSON.stringify({ models: [] }), { status: 200 });
      return new Response("{}", { status: 200 });
    };
    let thrown = null;
    try {
      clearModelCache();
      await chatJSON({ messages: [{ role: "user", content: "hi" }] });
    } catch (error) {
      thrown = error;
    } finally {
      globalThis.fetch = realFetch;
      clearModelCache();
    }
    check("an Ollama with no models says NO_MODELS", () => {
      assert(thrown?.code === "NO_MODELS", `wrong code: ${thrown?.code}`);
    });
  })();

  await (async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (String(url).endsWith("/api/tags")) return new Response(JSON.stringify({ models: [{ name: "gemma2:9b" }] }), { status: 200 });
      return new Response(JSON.stringify({ message: { content: goodJapanese } }), { status: 200 });
    };
    let used = null;
    try {
      clearModelCache();
      const result = await chatJSON({
        messages: buildMessages({ languageCode: "ja", speechId: "formal", question: "Hi" }),
        validate: (parsed) => normalizeAnswer(parsed, { languageCode: "ja", speechId: "formal", question: "Hi" }),
      });
      used = result.model;
    } finally {
      globalThis.fetch = realFetch;
      clearModelCache();
    }
    check("falls back to an installed model when the preferred one is absent", () => {
      assert(used === "gemma2:9b", `expected gemma2:9b, got ${used}`);
    });
  })();
})();

/* ---------------------------------------------------------- 7. phrasebook */

console.log("\n7. phrasebook");

/** The rule the prompt states, applied to hand-written answers too. */
function assertChunksCover(answer, label) {
  const chunked = answer.grammarBreakdown
    .flatMap((sentence) => sentence.chunks)
    .flatMap((chunk) => chunk.translation.map((word) => word.word));
  const whole = answer.translation.map((word) => word.word);
  assert(
    chunked.join(" ") === whole.join(" "),
    `${label}: chunks do not cover the sentence — "${chunked.join(" ")}" vs "${whole.join(" ")}"`
  );
}

check("every hand-written answer is accepted by the normalizer without repairs", () => {
  let answers = 0;
  for (const entry of PHRASES) {
    for (const code of Object.keys(entry.answers)) {
      assert(isLanguage(code), `${entry.id}: answer for unknown language "${code}"`);
      for (const speechId of speechModeIds(code)) {
        const label = `${entry.id}/${code}/${speechId}`;
        const canned = lookupPhrase({ languageCode: code, speechId, question: entry.aliases[0] });
        assert(canned, `${label}: no answer — the student gets the model instead`);
        const result = normalizeAnswer(canned, { languageCode: code, speechId, question: canned.english });
        assert(result.ok, `${label}: rejected — ${result.errors.join("; ")}`);
        assert(!result.errors.length, `${label}: only survives with repairs — ${result.errors.join("; ")}`);
        assertRenderable(result.value, label);
        assertChunksCover(result.value, label);
        answers++;
      }
    }
  }
  return `${phraseCount()} phrases, ${answers} answers`;
});

check("every phrase is written in the language's own script", () => {
  for (const entry of PHRASES) {
    for (const code of Object.keys(entry.answers)) {
      const language = LANGUAGES[code];
      for (const speechId of speechModeIds(code)) {
        const canned = lookupPhrase({ languageCode: code, speechId, question: entry.aliases[0] });
        const sentence = joinWords(canned.translation, code);
        assert(
          language.script.pattern.test(sentence),
          `${entry.id}/${code}/${speechId}: "${sentence}" is not ${language.script.name}`
        );
      }
    }
  }
});

check("every phrase carries the reading line its language shows", () => {
  for (const entry of PHRASES) {
    for (const code of Object.keys(entry.answers)) {
      const language = LANGUAGES[code];
      if (!language.reading.enabled) continue;
      for (const speechId of speechModeIds(code)) {
        const canned = lookupPhrase({ languageCode: code, speechId, question: entry.aliases[0] });
        // Punctuation is exempt: the danda । lives in the Devanagari block but has
        // nothing to pronounce.
        const missing = canned.translation.filter(
          (word) =>
            !/^[\p{P}\p{S}\p{N}\s]+$/u.test(word.word) &&
            language.reading.needs.test(word.word) &&
            !word.reading
        );
        assert(
          !missing.length,
          `${entry.id}/${code}/${speechId}: no ${language.reading.label} on ${missing.map((word) => word.word).join(", ")}`
        );
      }
    }
  }
});

check("the phrasebook answers every language in every register", () => {
  for (const entry of PHRASES) {
    const covered = Object.keys(entry.answers);
    for (const code of LANGUAGE_CODES) {
      assert(covered.includes(code), `${entry.id}: nothing for ${LANGUAGES[code].label}`);
      const answer = entry.answers[code];
      const both = Boolean(answer.both);
      for (const speechId of speechModeIds(code)) {
        assert(
          both || Array.isArray(answer[speechId]),
          `${entry.id}/${code}: missing the "${speechId}" register`
        );
      }
      // "both" is a claim that the sentence really is register-neutral, so it must
      // not sit next to a register-specific version of the same phrase.
      if (both) {
        for (const speechId of speechModeIds(code)) {
          assert(!answer[speechId], `${entry.id}/${code}: has both "both" and "${speechId}"`);
        }
      }
    }
  }
});

check("registers that differ in the language differ on the board", () => {
  // The whole reason "how are you" is hand-written: आप takes हैं, तुम takes हो. If
  // formal and casual come out identical, the register switch teaches nothing.
  let distinct = 0;
  for (const entry of PHRASES) {
    for (const code of Object.keys(entry.answers)) {
      const answer = entry.answers[code];
      const modes = speechModeIds(code);
      if (answer.both || modes.length < 2) continue;
      const rendered = modes.map((speechId) =>
        joinWords(lookupPhrase({ languageCode: code, speechId, question: entry.aliases[0] }).translation, code)
      );
      assert(
        new Set(rendered).size === rendered.length,
        `${entry.id}/${code}: registers are identical ("${rendered[0]}") — use "both" instead of copying`
      );
      distinct++;
    }
  }
  assert(distinct >= 10, `only ${distinct} register pairs actually differ — expected the phrasebook to teach more`);
  return `${distinct} register pairs`;
});

check("no alias claims two different phrases", () => {
  const claimed = new Map();
  for (const entry of PHRASES) {
    for (const alias of entry.aliases) {
      const key = phraseKey(alias);
      assert(key, `${entry.id}: alias "${alias}" folds away to nothing`);
      const owner = claimed.get(key);
      assert(!owner || owner === entry.id, `"${alias}" is claimed by both ${owner} and ${entry.id}`);
      claimed.set(key, entry.id);
    }
  }
  const { global: globalIndex, scoped } = phraseAliases();
  assert(globalIndex.size === claimed.size, `index has ${globalIndex.size} aliases, source has ${claimed.size}`);
  for (const [key, entry] of scoped) {
    const [, alias] = key.split("|");
    const owner = claimed.get(alias);
    assert(
      !owner || owner === entry.id,
      `scoped alias "${alias}" (${entry.id}) shadows the global alias of ${owner}`
    );
  }
  return `${globalIndex.size} global + ${scoped.size} scoped aliases`;
});

check("a phrase is matched by meaning, in any of the six languages", () => {
  for (const code of LANGUAGE_CODES) {
    for (const question of ["how are you", "How Are You?!", "  hows it going  ", "app kaise ho", "aap kaise ho", "genki desu ka"]) {
      assert(
        lookupPhrase({ languageCode: code, speechId: speechModeIds(code)[0], question }),
        `${code}: "${question}" missed the phrasebook`
      );
    }
  }
  // Same meaning, whatever the student typed it in.
  const viaEnglish = joinWords(lookupPhrase({ languageCode: "ja", speechId: "formal", question: "how are you" }).translation, "ja");
  const viaHinglish = joinWords(lookupPhrase({ languageCode: "ja", speechId: "formal", question: "app kaise ho" }).translation, "ja");
  assert(viaEnglish === viaHinglish, `"how are you" and "app kaise ho" gave different Japanese: ${viaEnglish} vs ${viaHinglish}`);
});

check("anything that is not exactly a phrase goes to the model", () => {
  const misses = [
    "how are you going to explain the tax form",
    "ask him how are you",
    "hello world in code",
    "thank you for the fish and also the chips",
    "",
    "   ",
    "howareyou",
  ];
  for (const question of misses) {
    assert(
      !lookupPhrase({ languageCode: "hi", speechId: "formal", question }),
      `"${question}" should not be answered from the phrasebook`
    );
  }
  assert(!lookupPhrase({ languageCode: "xx", speechId: "formal", question: "hello" }), "unknown language should miss");
  assert(!lookupPhrase({ languageCode: "hi", speechId: "shouting", question: "hello" }), "unknown register should miss");
});

check("a language-scoped alias never leaks into another language", () => {
  assert(
    lookupPhrase({ languageCode: "hi", speechId: "formal", question: "i am learning hindi" }),
    '"i am learning hindi" should be answered in Hindi'
  );
  for (const code of LANGUAGE_CODES.filter((entry) => entry !== "hi")) {
    assert(
      !lookupPhrase({ languageCode: code, speechId: speechModeIds(code)[0], question: "i am learning hindi" }),
      `"i am learning hindi" was answered in ${LANGUAGES[code].label}`
    );
  }
  assert(
    lookupPhrase({ languageCode: "ja", speechId: "formal", question: "i am learning japanese" }),
    '"i am learning japanese" should be answered in Japanese'
  );
});

check("folding a question never damages a non-Latin script", () => {
  // The bug this guards: stripping every combining mark turns कैसे into कस, so the
  // Devanagari alias stops matching and the Hindi student silently loses the phrase.
  assert(phraseKey("¿Cómo estás?") === "como estas", `Spanish accents not folded: ${phraseKey("¿Cómo estás?")}`);
  assert(phraseKey("Café ") === "cafe", `Latin accent not folded: ${phraseKey("Café ")}`);
  for (const [text, keep] of [
    ["आप कैसे हैं?", "कैसे"],
    ["お元気ですか？", "元気"],
    ["잘 지내?", "지내"],
    ["नमस्ते", "नमस्ते"],
  ]) {
    assert(phraseKey(text).includes(keep), `phraseKey("${text}") lost "${keep}" — got "${phraseKey(text)}"`);
  }
  assert(lookupPhrase({ languageCode: "hi", speechId: "formal", question: "आप कैसे हैं?" }), "Devanagari alias missed");
  assert(lookupPhrase({ languageCode: "ko", speechId: "formal", question: "잘 지내" }), "Hangul alias missed");
});

/* ------------------------------------------- 8. what the student typed in */

console.log("\n8. what the student typed in");

check("English questions are read as English", () => {
  const english = [
    "how are you",
    "Where is the station?",
    "how do i say app",          // "app" is आप, but the sentence around it is English
    "can you tell me what your name is",
    "i want to go home",
    "",
  ];
  for (const code of LANGUAGE_CODES) {
    for (const question of english) {
      assert(
        detectQuestion(question, LANGUAGES[code]) === "english",
        `${code}: "${question}" was not read as English`
      );
    }
  }
});

check("a question typed in the target script is read as native", () => {
  const native = { ja: "お元気ですか", hi: "आप कैसे हैं", ko: "잘 지내요" };
  for (const [code, question] of Object.entries(native)) {
    assert(detectQuestion(question, LANGUAGES[code]) === "native", `${code}: "${question}" not read as native`);
  }
  // Latin-script languages have no script test to fall back on — they must never
  // claim a plain English sentence just because it is written in Latin letters.
  for (const code of LANGUAGE_CODES.filter((entry) => LANGUAGES[entry].script.latin)) {
    assert(detectQuestion("Good morning", LANGUAGES[code]) !== "native", `${code}: claimed English as native script`);
  }
});

check("romanized questions are recognised in every language", () => {
  const roman = {
    hi: ["app kaise ho", "aap kaise hain", "kya haal hai", "mera naam kya hai"],
    ja: ["genki desu ka", "ogenki desu ka", "namae wa nani desu ka"],
    es: ["como estas", "¿Cómo estás?", "que tal"],
    fr: ["ca va", "comment allez vous"],
    de: ["wie gehts", "wie geht es dir"],
    ko: ["jal jinae", "annyeonghaseyo jal jinaeyo"],
  };
  for (const [code, questions] of Object.entries(roman)) {
    for (const question of questions) {
      assert(
        detectQuestion(question, LANGUAGES[code]) === "roman",
        `${code}: "${question}" was not recognised as romanized ${LANGUAGES[code].label}`
      );
    }
  }
});

check("the prompt asks for a correction, not a translation, when the student typed the language", () => {
  const ask = (question) =>
    buildMessages({ languageCode: "hi", speechId: "formal", question })
      .filter((message) => message.role === "user")
      .map((message) => message.content)
      .join("\n");

  const english = ask("How are you?");
  assert(english.includes('How do I say "How are you?"'), `English question phrased wrong: ${english}`);

  for (const typed of ["app kaise ho", "आप कैसे हैं"]) {
    const prompt = ask(typed);
    assert(prompt.includes(typed), `the student's own words are missing: ${prompt}`);
    assert(!prompt.includes("How do I say"), `still asking for a translation of ${typed}: ${prompt}`);
    assert(/correct, natural Hindi/.test(prompt), `not asking for the natural sentence: ${prompt}`);
    assert(/possibly with mistakes/.test(prompt), `not allowing for the student's spelling: ${prompt}`);
  }
  assert(ask("app kaise ho").includes("Latin letters"), "romanized input should be flagged as Latin letters");
  assert(!ask("आप कैसे हैं").includes("Latin letters"), "Devanagari input should not be called Latin letters");
});

check("a question typed in the target language never lands on the English line", () => {
  const hindi = {
    translation: [{ word: "आप", reading: "aap" }, { word: "कैसे", reading: "kaise" }, { word: "हैं", reading: "hain" }, { word: "?" }],
    grammarBreakdown: [
      {
        english: "How are you?",
        chunks: [
          { translation: [{ word: "आप", reading: "aap" }], meaning: "you", grammar: "Pronoun" },
          { translation: [{ word: "कैसे", reading: "kaise" }, { word: "हैं", reading: "hain" }], meaning: "are how", grammar: "Verb" },
          { translation: [{ word: "?" }], meaning: "question", grammar: "Punctuation" },
        ],
      },
    ],
  };

  // The model forgot "english". With an English question we can fall back to it…
  const fromEnglish = normalizeAnswer(hindi, { languageCode: "hi", speechId: "formal", question: "How are you?" });
  assert(fromEnglish.ok, `rejected: ${fromEnglish.errors.join("; ")}`);
  assert(fromEnglish.value.english === "How are you?", `lost the fallback: ${fromEnglish.value.english}`);

  // …but "app kaise ho" is not an English sentence, so it must be reported missing
  // rather than printed under "English".
  for (const question of ["app kaise ho", "आप कैसे हैं"]) {
    const result = normalizeAnswer(hindi, { languageCode: "hi", speechId: "formal", question });
    assert(result.errors.some((error) => /missing "english"/.test(error)), `${question}: no complaint — ${result.errors.join("; ")}`);
    assert(result.value?.english !== question, `${question}: the student's own Hindi was printed as the English meaning`);
  }
});

/* ------------------------------------------------------- 9. answer cache */

console.log("\n9. answer cache");

// Imported late and pointed at a scratch file: the module mirrors to disk, and a
// verifier run must not leave test answers in the cache a real student reads.
const CACHE_FILE = join(tmpdir(), `ai-teacher-verify-${process.pid}.json`);
process.env.AI_TEACHER_CACHE_FILE = CACHE_FILE;
const { cacheKey, clearCache, getCached, setCached, cacheSize, cacheFile } = await import(
  "../src/lib/answerCache.mjs"
);

check("the same question in the same register is a cache hit", () => {
  clearCache();
  const key = cacheKey({ languageCode: "ja", speechId: "formal", question: "Where is the station?" });
  setCached(key, { english: "Where is the station?" });
  const messy = cacheKey({ languageCode: "ja", speechId: "formal", question: "  where IS   the station? " });
  assert(messy === key, "case and spacing should not miss the cache");
  assert(getCached(messy), "cache miss on the same question");
});

check("language and register never share an entry", () => {
  clearCache();
  const question = "Where is the station?";
  setCached(cacheKey({ languageCode: "ja", speechId: "formal", question }), { tag: "ja-formal" });
  assert(!getCached(cacheKey({ languageCode: "ja", speechId: "casual", question })), "registers collided");
  assert(!getCached(cacheKey({ languageCode: "hi", speechId: "formal", question })), "languages collided");
  assert(getCached(cacheKey({ languageCode: "ja", speechId: "formal", question })).tag === "ja-formal", "lost its own entry");
});

check("the cache cannot grow without bound", () => {
  clearCache();
  for (let i = 0; i < 500; i++) {
    setCached(cacheKey({ languageCode: "ja", speechId: "formal", question: `question ${i}` }), { i });
  }
  assert(cacheSize() <= 80, `cache grew to ${cacheSize()} entries`);
  assert(getCached(cacheKey({ languageCode: "ja", speechId: "formal", question: "question 499" })), "newest entry evicted");
  assert(!getCached(cacheKey({ languageCode: "ja", speechId: "formal", question: "question 0" })), "oldest entry never evicted");
  clearCache();
});

await (async () => {
  assert(cacheFile() === CACHE_FILE, `cache file should follow AI_TEACHER_CACHE_FILE, got ${cacheFile()}`);
  clearCache();
  const key = cacheKey({ languageCode: "hi", speechId: "casual", question: "Where is the station?" });
  setCached(key, { english: "Where is the station?", translation: [{ word: "स्टेशन" }] });
  for (let i = 0; i < 200; i++) {
    setCached(cacheKey({ languageCode: "hi", speechId: "casual", question: `filler ${i}` }), { i });
  }
  // The write is debounced so a burst of answers costs one write, not two hundred.
  await new Promise((done) => setTimeout(done, 900));

  check("the cache survives a dev-server reload", () => {
    assert(existsSync(CACHE_FILE), `nothing written to ${CACHE_FILE}`);
    const onDisk = JSON.parse(readFileSync(CACHE_FILE, "utf8"));
    assert(Array.isArray(onDisk), "the mirror should be an array of [key, value] pairs");
    assert(onDisk.length <= 80, `the mirror grew to ${onDisk.length} entries`);
    assert(
      onDisk.some(([entry]) => entry === cacheKey({ languageCode: "hi", speechId: "casual", question: "filler 199" })),
      "the newest answer is missing from the mirror"
    );
  });

  // `next dev` throws module state away on every file change; a fresh instance of
  // the module has to find the answers again.
  const reloaded = await import(`../src/lib/answerCache.mjs?reload=${Date.now()}`);
  check("a fresh module instance reads the answers back", () => {
    const hit = reloaded.getCached(reloaded.cacheKey({ languageCode: "hi", speechId: "casual", question: "filler 199" }));
    assert(hit, "the reloaded cache is empty — every question would be asked again");
    assert(reloaded.cacheSize() <= 80, `reload loaded ${reloaded.cacheSize()} entries`);
  });

  process.env.AI_TEACHER_CACHE_FILE = "";
  const memoryOnly = await import(`../src/lib/answerCache.mjs?memory=${Date.now()}`);
  check('AI_TEACHER_CACHE_FILE="" keeps the cache in memory', () => {
    assert(memoryOnly.cacheFile() === null, `expected no cache file, got ${memoryOnly.cacheFile()}`);
    const key2 = memoryOnly.cacheKey({ languageCode: "ja", speechId: "formal", question: "no disk please" });
    memoryOnly.setCached(key2, { english: "no disk please" });
    assert(memoryOnly.getCached(key2), "the in-memory cache stopped working");
    assert(memoryOnly.cacheSize() === 1, "a cache with persistence off should not load the mirror");
  });

  const CORRUPT_FILE = join(tmpdir(), `ai-teacher-verify-corrupt-${process.pid}.json`);
  process.env.AI_TEACHER_CACHE_FILE = CORRUPT_FILE;
  writeFileSync(CORRUPT_FILE, "{not json at all");
  const broken = await import(`../src/lib/answerCache.mjs?corrupt=${Date.now()}`);
  check("a corrupt mirror is not fatal", () => {
    const key3 = broken.cacheKey({ languageCode: "ja", speechId: "formal", question: "still works" });
    broken.setCached(key3, { english: "still works" });
    assert(broken.getCached(key3), "a corrupt mirror took the cache down with it");
    assert(broken.cacheSize() === 1, "unreadable entries should not be half-loaded");
  });
  rmSync(CORRUPT_FILE, { force: true });

  try {
    rmSync(CACHE_FILE, { force: true });
  } catch {
    // The scratch file is in /tmp; leaving it behind is harmless.
  }
  delete process.env.AI_TEACHER_CACHE_FILE;
})();

/* -------------------------------------------------------- 10. source scan */

console.log("\n10. source scan");

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, files);
    else if (/\.(js|jsx|mjs)$/.test(entry)) files.push(full);
  }
  return files;
}

const sourceFiles = walk(join(ROOT, "src"));

check("no paid-API leftovers in the source", () => {
  const banned = [
    [/from\s+["']openai["']/, "openai import"],
    [/cognitiveservices-speech-sdk/, "Azure speech SDK import"],
    [/OPENAI_API_KEY/, "OpenAI key"],
    [/SPEECH_KEY|SPEECH_REGION/, "Azure key"],
  ];
  for (const file of sourceFiles) {
    const code = readFileSync(file, "utf8");
    for (const [pattern, label] of banned) {
      assert(!pattern.test(code), `${file.replace(ROOT, ".")} still references ${label}`);
    }
  }
  return `${sourceFiles.length} files clean`;
});

check("no half-finished rename (furigana state, answer.japanese, /api/tts fetches)", () => {
  for (const file of sourceFiles) {
    const relative = file.replace(ROOT, ".");
    const code = readFileSync(file, "utf8");
    assert(!/state\.furigana|setFurigana\b/.test(code), `${relative}: old furigana state`);
    assert(!/\.answer\.japanese|answer\?\.japanese/.test(code), `${relative}: reads answer.japanese`);
    if (!relative.includes("api/tts")) {
      assert(!/fetch\(\s*[`"']\/api\/tts/.test(code), `${relative}: still fetches /api/tts`);
    }
  }
});

check("every @/ import resolves to a real file", () => {
  const extensions = ["", ".mjs", ".js", ".jsx", "/index.js", "/index.jsx"];
  for (const file of sourceFiles) {
    const code = readFileSync(file, "utf8");
    for (const match of code.matchAll(/from\s+["']@\/([^"']+)["']/g)) {
      const target = join(ROOT, "src", match[1]);
      const found = extensions.some((extension) => {
        try {
          return statSync(target + extension).isFile();
        } catch {
          return false;
        }
      });
      assert(found, `${file.replace(ROOT, ".")} imports @/${match[1]} which does not exist`);
    }
  }
});

check("shared logic lives in .mjs and is imported with the extension", () => {
  for (const file of sourceFiles) {
    const code = readFileSync(file, "utf8");
    for (const name of ["languages", "answerSchema", "visemes", "ollama"]) {
      const bare = new RegExp(`from\\s+["']@/lib/${name}["']`);
      assert(!bare.test(code), `${file.replace(ROOT, ".")} imports @/lib/${name} without the .mjs extension`);
    }
  }
});

check("every source file parses, JSX included", () => {
  // `node --check` cannot read JSX, so borrow eslint's parser (already a devDependency).
  // This is the cheap half of `next build`: it catches a stray tag or brace in a
  // component without needing the network that next/font/google wants.
  let espree;
  try {
    espree = createRequire(join(ROOT, "package.json"))("espree");
  } catch {
    // Say so loudly: a silent skip here would let a broken component ship.
    notes.push("JSX parse check SKIPPED — espree not installed. Run `npm install`, then verify again.");
    return "skipped";
  }
  const files = sourceFiles.concat(walk(join(ROOT, "tools")));
  for (const file of files) {
    try {
      espree.parse(readFileSync(file, "utf8"), {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      });
    } catch (error) {
      throw new Error(`${file.replace(ROOT, ".")} line ${error.lineNumber ?? "?"}: ${error.message}`);
    }
  }
  return `${files.length} files`;
});

check("client hooks and components are marked \"use client\"", () => {
  for (const file of sourceFiles) {
    const relative = file.replace(ROOT, ".");
    if (!/\/(components|hooks)\//.test(relative) && !relative.endsWith("lib/speech.js")) continue;
    const code = readFileSync(file, "utf8");
    assert(/^\s*["']use client["']/.test(code), `${relative} touches browser APIs but has no "use client"`);
  }
});

/* ------------------------------------------------------------- live checks */

if (HEALTH_ONLY || LIVE) {
  console.log("\n9. live Ollama");
  const status = await health();
  console.log(`  url    ${status.url}`);
  console.log(`  models ${status.models.length ? status.models.join(", ") : "(none)"}`);
  console.log(`  using  ${status.model || "-"}`);
  if (!status.ok) {
    notes.push(`Ollama unreachable at ${status.url} — start it with \`ollama serve\`, then \`ollama pull llama3.1:8b\`.`);
  } else if (LIVE) {
    const codes = ALL ? LANGUAGE_CODES : ["ja", "hi"];
    for (const code of codes) {
      const question = "Where is the train station?";
      const startedAt = Date.now();
      try {
        const result = await chatJSON({
          messages: buildMessages({ languageCode: code, speechId: speechModeIds(code)[0], question }),
          validate: (parsed) => normalizeAnswer(parsed, { languageCode: code, speechId: speechModeIds(code)[0], question }),
        });
        check(`live ${code}: ${result.model} answered in ${Date.now() - startedAt}ms (${result.attempts} attempt(s))`, () => {
          assertRenderable(result.value, `live/${code}`);
          const sentence = joinWords(result.value.translation, code);
          assert(sentence.length > 1, "empty sentence");
          console.log(`         → ${sentence}`);
          if (result.warnings.length) console.log(`         ⚠ ${result.warnings.join(" | ")}`);
        });
      } catch (error) {
        check(`live ${code}`, () => {
          throw error;
        });
      }
    }
  }
}

/* ------------------------------------------------------------------ report */

console.log(`\n${failures.length ? "FAILED" : "PASSED"} — ${passed} checks passed, ${failures.length} failed`);
for (const note of notes) console.log(`note: ${note}`);
if (failures.length) {
  for (const failure of failures) console.log(`  ✗ ${failure.name}: ${failure.error.message}`);
  process.exit(1);
}
