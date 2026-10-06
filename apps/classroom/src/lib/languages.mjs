/**
 * Language registry.
 *
 * Everything language-specific lives here — the API route, the prompt, the board
 * and the voice all read from this file. Adding a language means adding one entry
 * below and nothing else.
 *
 * `.mjs` on purpose: this is pure data with no browser or Next.js dependency, so
 * plain Node (tools/verify-ai.mjs) can import it directly. Import it with the
 * explicit extension: `import { LANGUAGES } from "@/lib/languages.mjs"`.
 */

/** Shape every example (and every model answer) must follow. */
const SCHEMA_HINT = `{
  "english": "",
  "translation": [{ "word": "", "reading": "" }],
  "grammarBreakdown": [{
    "english": "",
    "translation": [{ "word": "", "reading": "" }],
    "chunks": [{
      "translation": [{ "word": "", "reading": "" }],
      "meaning": "",
      "grammar": ""
    }]
  }]
}`;

export const ANSWER_SCHEMA_HINT = SCHEMA_HINT;

export const LANGUAGES = {
  ja: {
    code: "ja",
    label: "Japanese",
    native: "日本語",
    // What a real answer must be written in. A small model happily replies in
    // romaji; that is rejected and retried instead of being put on the board.
    script: {
      pattern: /[\u3040-\u309f\u30a0-\u30ff\u3400-\u9fff\uf900-\ufaff]/,
      latin: false,
      name: "Japanese characters (kanji, hiragana or katakana)",
      instead: "romaji or Latin letters",
    },
    // Words that mean the student typed the target language itself rather than
    // English — "app kaise ho" is a Hindi question, not an English one.
    hints: ["desu", "masu", "watashi", "anata", "nihongo", "kudasai", "arigato", "arigatou",
      "gozaimasu", "genki", "konnichiwa", "sumimasen", "onegai", "shiteimasu", "benkyou",
      "namae", "suki", "chotto", "ikimasu", "tabemasu", "nani", "doko",
      "ka", "ogenki", "ohayou", "konbanwa", "sayonara", "gomen", "nihon", "eigo", "tomodachi",
    ],
    teacherTitle: "Sensei",
    fontClass: "font-jp",
    reading: {
      enabled: true,
      label: "Furigana",
      hint: "the hiragana reading of every word that contains kanji (leave `reading` out for kana-only or punctuation words)",
      // Only kanji needs furigana — こんにちは is already its own reading.
      needs: /[\u3400-\u9fff\uf900-\ufaff]/,
    },
    speechModes: [
      {
        id: "formal",
        label: "Formal",
        note: "です・ます",
        hint: "polite です／ます form, as used with strangers, teachers and colleagues",
      },
      {
        id: "casual",
        label: "Casual",
        note: "だ・plain",
        hint: "plain/dictionary form with casual sentence-final particles, as used with close friends",
      },
    ],
    voice: {
      locale: "ja-JP",
      female: ["Kyoko", "O-Ren", "Google 日本語", "Nanami", "Ayumi"],
      male: ["Otoya", "Hattori", "Keita", "Naoki"],
    },
    sample: "Have you ever been to Japan?",
    board: { title: "Japanese Language School", native: "日本語学校" },
    examples: {
      formal: {
        english: "Do you live in Japan?",
        translation: [
          { word: "日本", reading: "にほん" },
          { word: "に" },
          { word: "住んで", reading: "すんで" },
          { word: "います" },
          { word: "か" },
          { word: "?" },
        ],
        grammarBreakdown: [
          {
            english: "Do you live in Japan?",
            translation: [
              { word: "日本", reading: "にほん" },
              { word: "に" },
              { word: "住んで", reading: "すんで" },
              { word: "います" },
              { word: "か" },
              { word: "?" },
            ],
            chunks: [
              {
                translation: [{ word: "日本", reading: "にほん" }],
                meaning: "Japan",
                grammar: "Noun",
              },
              { translation: [{ word: "に" }], meaning: "in", grammar: "Particle" },
              {
                translation: [
                  { word: "住んで", reading: "すんで" },
                  { word: "います" },
                ],
                meaning: "live",
                grammar: "Verb + て form + います",
              },
              { translation: [{ word: "か" }], meaning: "question", grammar: "Particle" },
              { translation: [{ word: "?" }], meaning: "question", grammar: "Punctuation" },
            ],
          },
        ],
      },
      casual: {
        english: "Do you live in Japan?",
        translation: [
          { word: "日本", reading: "にほん" },
          { word: "に" },
          { word: "住んで", reading: "すんで" },
          { word: "いる" },
          { word: "の" },
          { word: "?" },
        ],
        grammarBreakdown: [
          {
            english: "Do you live in Japan?",
            translation: [
              { word: "日本", reading: "にほん" },
              { word: "に" },
              { word: "住んで", reading: "すんで" },
              { word: "いる" },
              { word: "の" },
              { word: "?" },
            ],
            chunks: [
              {
                translation: [{ word: "日本", reading: "にほん" }],
                meaning: "Japan",
                grammar: "Noun",
              },
              { translation: [{ word: "に" }], meaning: "in", grammar: "Particle" },
              {
                translation: [
                  { word: "住んで", reading: "すんで" },
                  { word: "いる" },
                ],
                meaning: "live",
                grammar: "Verb + て form + いる",
              },
              { translation: [{ word: "の" }], meaning: "question", grammar: "Particle" },
              { translation: [{ word: "?" }], meaning: "question", grammar: "Punctuation" },
            ],
          },
        ],
      },
    },
  },

  hi: {
    code: "hi",
    label: "Hindi",
    native: "हिन्दी",
    script: {
      pattern: /[\u0900-\u097f]/,
      latin: false,
      name: "Devanagari script",
      instead: "Latin transliteration",
    },
    hints: ["aap", "app", "tum", "mera", "meri", "mujhe", "tumhe", "tumhara", "aapka", "apka",
      "kaise", "kaisi", "kya", "hai", "hain", "ho", "hoon", "hun", "naam", "nahi", "nahin",
      "acha", "accha", "theek", "thik", "kahan", "kab", "kyun", "kyu", "chahiye", "chahta",
      "karo", "karna", "bahut", "haal", "shukriya", "dhanyavad", "namaste", "kaun", "kitna",
      "paani", "khana", "ghar", "dost", "yaar", "seekh", "raha",
      "sikh", "rahi", "rahe", "hu", "milkar", "khushi", "bhai", "didi",
    ],
    teacherTitle: "Guru ji",
    fontClass: "font-deva",
    reading: {
      enabled: true,
      label: "Romanization",
      hint: "the Latin romanization of every word (e.g. `रहते` → `rahte`)",
      needs: /[\u0900-\u097f]/,
    },
    speechModes: [
      {
        id: "formal",
        label: "Formal",
        note: "आप",
        hint: "आप forms with plural verb agreement (रहते हैं), as used with elders and strangers",
      },
      {
        id: "casual",
        label: "Casual",
        note: "तुम",
        hint: "तुम forms (रहते हो), as used with friends and younger people — never तू",
      },
    ],
    voice: {
      locale: "hi-IN",
      female: ["Lekha", "Google हिन्दी", "Swara", "Kalpana"],
      male: ["Hemant", "Madhur", "Neel"],
    },
    sample: "Have you ever been to India?",
    board: { title: "Hindi Language School", native: "हिन्दी भाषा विद्यालय" },
    examples: {
      formal: {
        english: "Do you live in India?",
        translation: [
          { word: "क्या", reading: "kya" },
          { word: "आप", reading: "aap" },
          { word: "भारत", reading: "bhaarat" },
          { word: "में", reading: "mein" },
          { word: "रहते", reading: "rahte" },
          { word: "हैं", reading: "hain" },
          { word: "?" },
        ],
        grammarBreakdown: [
          {
            english: "Do you live in India?",
            translation: [
              { word: "क्या", reading: "kya" },
              { word: "आप", reading: "aap" },
              { word: "भारत", reading: "bhaarat" },
              { word: "में", reading: "mein" },
              { word: "रहते", reading: "rahte" },
              { word: "हैं", reading: "hain" },
              { word: "?" },
            ],
            chunks: [
              {
                translation: [{ word: "क्या", reading: "kya" }],
                meaning: "(marks a yes/no question)",
                grammar: "Question particle",
              },
              {
                translation: [{ word: "आप", reading: "aap" }],
                meaning: "you",
                grammar: "Pronoun, formal",
              },
              {
                translation: [
                  { word: "भारत", reading: "bhaarat" },
                  { word: "में", reading: "mein" },
                ],
                meaning: "in India",
                grammar: "Noun + postposition",
              },
              {
                translation: [
                  { word: "रहते", reading: "rahte" },
                  { word: "हैं", reading: "hain" },
                ],
                meaning: "live",
                grammar: "Habitual present, masculine plural agreement",
              },
              { translation: [{ word: "?" }], meaning: "question", grammar: "Punctuation" },
            ],
          },
        ],
      },
      casual: {
        english: "Do you live in India?",
        translation: [
          { word: "क्या", reading: "kya" },
          { word: "तुम", reading: "tum" },
          { word: "भारत", reading: "bhaarat" },
          { word: "में", reading: "mein" },
          { word: "रहते", reading: "rahte" },
          { word: "हो", reading: "ho" },
          { word: "?" },
        ],
        grammarBreakdown: [
          {
            english: "Do you live in India?",
            translation: [
              { word: "क्या", reading: "kya" },
              { word: "तुम", reading: "tum" },
              { word: "भारत", reading: "bhaarat" },
              { word: "में", reading: "mein" },
              { word: "रहते", reading: "rahte" },
              { word: "हो", reading: "ho" },
              { word: "?" },
            ],
            chunks: [
              {
                translation: [{ word: "क्या", reading: "kya" }],
                meaning: "(marks a yes/no question)",
                grammar: "Question particle",
              },
              {
                translation: [{ word: "तुम", reading: "tum" }],
                meaning: "you",
                grammar: "Pronoun, casual",
              },
              {
                translation: [
                  { word: "भारत", reading: "bhaarat" },
                  { word: "में", reading: "mein" },
                ],
                meaning: "in India",
                grammar: "Noun + postposition",
              },
              {
                translation: [
                  { word: "रहते", reading: "rahte" },
                  { word: "हो", reading: "ho" },
                ],
                meaning: "live",
                grammar: "Habitual present, तुम agreement",
              },
              { translation: [{ word: "?" }], meaning: "question", grammar: "Punctuation" },
            ],
          },
        ],
      },
    },
  },

  es: {
    code: "es",
    label: "Spanish",
    native: "Español",
    script: {
      pattern: /[A-Za-zÀ-ÖØ-öø-ÿ]/,
      latin: true,
      name: "the Latin alphabet",
      instead: "another script",
    },
    hints: ["como", "estas", "esta", "usted", "gracias", "hola", "donde", "quiero", "tienes",
      "tiene", "favor", "buenos", "dias", "noches", "hablo", "espanol", "español", "bien",
      "llamas", "llama", "soy", "eres", "quisiera", "tengo", "nada", "mucho",
      "que", "tal", "estoy", "llamo", "aprendiendo", "hablas", "encantado", "adios",
    ],
    teacherTitle: "Profesor",
    fontClass: "font-sans",
    reading: { enabled: false, label: "Reading", hint: "", needs: null },
    speechModes: [
      {
        id: "formal",
        label: "Formal",
        note: "usted",
        hint: "usted with third-person verb forms, as used with strangers and in business",
      },
      {
        id: "casual",
        label: "Casual",
        note: "tú",
        hint: "tú with second-person verb forms, as used with friends and family",
      },
    ],
    voice: {
      locale: "es-ES",
      female: ["Mónica", "Monica", "Google español", "Paulina", "Elvira"],
      male: ["Jorge", "Diego", "Juan", "Álvaro"],
    },
    sample: "Have you ever been to Spain?",
    board: { title: "Spanish Language School", native: "Escuela de Español" },
    examples: {
      formal: {
        english: "Do you live in Spain?",
        translation: [
          { word: "¿" },
          { word: "Vive" },
          { word: "usted" },
          { word: "en" },
          { word: "España" },
          { word: "?" },
        ],
        grammarBreakdown: [
          {
            english: "Do you live in Spain?",
            translation: [
              { word: "¿" },
              { word: "Vive" },
              { word: "usted" },
              { word: "en" },
              { word: "España" },
              { word: "?" },
            ],
            chunks: [
              {
                translation: [{ word: "¿" }],
                meaning: "(question opens)",
                grammar: "Punctuation, Spanish opens a question with an inverted mark",
              },
              {
                translation: [{ word: "Vive" }],
                meaning: "live",
                grammar: "Verb vivir, present, 3rd person singular (usted)",
              },
              {
                translation: [{ word: "usted" }],
                meaning: "you",
                grammar: "Pronoun, formal",
              },
              { translation: [{ word: "en" }], meaning: "in", grammar: "Preposition" },
              { translation: [{ word: "España" }], meaning: "Spain", grammar: "Proper noun" },
              {
                translation: [{ word: "?" }],
                meaning: "(question closes)",
                grammar: "Punctuation",
              },
            ],
          },
        ],
      },
      casual: {
        english: "Do you live in Spain?",
        translation: [
          { word: "¿" },
          { word: "Vives" },
          { word: "en" },
          { word: "España" },
          { word: "?" },
        ],
        grammarBreakdown: [
          {
            english: "Do you live in Spain?",
            translation: [
              { word: "¿" },
              { word: "Vives" },
              { word: "en" },
              { word: "España" },
              { word: "?" },
            ],
            chunks: [
              {
                translation: [{ word: "¿" }],
                meaning: "(question opens)",
                grammar: "Punctuation, Spanish opens a question with an inverted mark",
              },
              {
                translation: [{ word: "Vives" }],
                meaning: "you live",
                grammar: "Verb vivir, present, 2nd person singular (tú)",
              },
              { translation: [{ word: "en" }], meaning: "in", grammar: "Preposition" },
              { translation: [{ word: "España" }], meaning: "Spain", grammar: "Proper noun" },
              {
                translation: [{ word: "?" }],
                meaning: "(question closes)",
                grammar: "Punctuation",
              },
            ],
          },
        ],
      },
    },
  },

  fr: {
    code: "fr",
    label: "French",
    native: "Français",
    script: {
      pattern: /[A-Za-zÀ-ÖØ-öø-ÿ]/,
      latin: true,
      name: "the Latin alphabet",
      instead: "another script",
    },
    hints: ["comment", "allez", "bonjour", "merci", "salut", "suis", "appelle", "appelles",
      "parle", "francais", "français", "tres", "voudrais", "plait", "oui", "non", "beaucoup",
      "madame", "monsieur", "excusez",
      "ca", "va", "je", "tu", "vous", "nous", "appelez", "enchante", "revoir", "apprends",
    ],
    teacherTitle: "Professeur",
    fontClass: "font-sans",
    reading: { enabled: false, label: "Reading", hint: "", needs: null },
    speechModes: [
      {
        id: "formal",
        label: "Formal",
        note: "vous",
        hint: "vous with inversion for questions, as used with strangers and at work",
      },
      {
        id: "casual",
        label: "Casual",
        note: "tu",
        hint: "tu with intonation questions (no inversion), as used with friends",
      },
    ],
    voice: {
      locale: "fr-FR",
      female: ["Amélie", "Amelie", "Audrey", "Google français", "Marie"],
      male: ["Thomas", "Nicolas", "Daniel"],
    },
    sample: "Have you ever been to France?",
    board: { title: "French Language School", native: "École de Français" },
    examples: {
      formal: {
        english: "Do you live in France?",
        translation: [
          { word: "Habitez" },
          { word: "-vous" },
          { word: "en" },
          { word: "France" },
          { word: "?" },
        ],
        grammarBreakdown: [
          {
            english: "Do you live in France?",
            translation: [
              { word: "Habitez" },
              { word: "-vous" },
              { word: "en" },
              { word: "France" },
              { word: "?" },
            ],
            chunks: [
              {
                translation: [{ word: "Habitez" }, { word: "-vous" }],
                meaning: "do you live",
                grammar: "Verb habiter + subject inversion (formal question)",
              },
              { translation: [{ word: "en" }], meaning: "in", grammar: "Preposition" },
              { translation: [{ word: "France" }], meaning: "France", grammar: "Proper noun" },
              { translation: [{ word: "?" }], meaning: "question", grammar: "Punctuation" },
            ],
          },
        ],
      },
      casual: {
        english: "Do you live in France?",
        translation: [
          { word: "Tu" },
          { word: "habites" },
          { word: "en" },
          { word: "France" },
          { word: "?" },
        ],
        grammarBreakdown: [
          {
            english: "Do you live in France?",
            translation: [
              { word: "Tu" },
              { word: "habites" },
              { word: "en" },
              { word: "France" },
              { word: "?" },
            ],
            chunks: [
              { translation: [{ word: "Tu" }], meaning: "you", grammar: "Pronoun, casual" },
              {
                translation: [{ word: "habites" }],
                meaning: "live",
                grammar: "Verb habiter, present, 2nd person singular",
              },
              { translation: [{ word: "en" }], meaning: "in", grammar: "Preposition" },
              { translation: [{ word: "France" }], meaning: "France", grammar: "Proper noun" },
              {
                translation: [{ word: "?" }],
                meaning: "question",
                grammar: "Punctuation, question by intonation only",
              },
            ],
          },
        ],
      },
    },
  },

  de: {
    code: "de",
    label: "German",
    native: "Deutsch",
    script: {
      pattern: /[A-Za-zÀ-ÖØ-öø-ÿ]/,
      latin: true,
      name: "the Latin alphabet",
      instead: "another script",
    },
    hints: ["wie", "geht", "ich", "bin", "danke", "hallo", "bitte", "heisse", "heissen",
      "heisst", "heiße", "heißen", "heißt", "sehr", "nicht", "deutsch", "spreche", "sprechen",
      "guten", "morgen", "entschuldigung", "gern",
      "gehts", "dir", "ihnen", "du", "wir", "freut", "mich", "tschuss", "lerne", "wiedersehen",
    ],
    teacherTitle: "Lehrer",
    fontClass: "font-sans",
    reading: { enabled: false, label: "Reading", hint: "", needs: null },
    speechModes: [
      {
        id: "formal",
        label: "Formal",
        note: "Sie",
        hint: "Sie with the capital S and plural verb form, as used with strangers and at work",
      },
      {
        id: "casual",
        label: "Casual",
        note: "du",
        hint: "du with 2nd person singular verb forms, as used with friends and family",
      },
    ],
    voice: {
      locale: "de-DE",
      female: ["Anna", "Google Deutsch", "Katja", "Petra"],
      male: ["Markus", "Yannick", "Conrad", "Stefan"],
    },
    sample: "Have you ever been to Germany?",
    board: { title: "German Language School", native: "Deutsche Sprachschule" },
    examples: {
      formal: {
        english: "Do you live in Germany?",
        translation: [
          { word: "Wohnen" },
          { word: "Sie" },
          { word: "in" },
          { word: "Deutschland" },
          { word: "?" },
        ],
        grammarBreakdown: [
          {
            english: "Do you live in Germany?",
            translation: [
              { word: "Wohnen" },
              { word: "Sie" },
              { word: "in" },
              { word: "Deutschland" },
              { word: "?" },
            ],
            chunks: [
              {
                translation: [{ word: "Wohnen" }],
                meaning: "live",
                grammar: "Verb wohnen, first position (yes/no question)",
              },
              {
                translation: [{ word: "Sie" }],
                meaning: "you",
                grammar: "Pronoun, formal — always capitalised",
              },
              {
                translation: [{ word: "in" }],
                meaning: "in",
                grammar: "Preposition + dative",
              },
              {
                translation: [{ word: "Deutschland" }],
                meaning: "Germany",
                grammar: "Proper noun",
              },
              { translation: [{ word: "?" }], meaning: "question", grammar: "Punctuation" },
            ],
          },
        ],
      },
      casual: {
        english: "Do you live in Germany?",
        translation: [
          { word: "Wohnst" },
          { word: "du" },
          { word: "in" },
          { word: "Deutschland" },
          { word: "?" },
        ],
        grammarBreakdown: [
          {
            english: "Do you live in Germany?",
            translation: [
              { word: "Wohnst" },
              { word: "du" },
              { word: "in" },
              { word: "Deutschland" },
              { word: "?" },
            ],
            chunks: [
              {
                translation: [{ word: "Wohnst" }],
                meaning: "live",
                grammar: "Verb wohnen, 2nd person singular",
              },
              { translation: [{ word: "du" }], meaning: "you", grammar: "Pronoun, casual" },
              {
                translation: [{ word: "in" }],
                meaning: "in",
                grammar: "Preposition + dative",
              },
              {
                translation: [{ word: "Deutschland" }],
                meaning: "Germany",
                grammar: "Proper noun",
              },
              { translation: [{ word: "?" }], meaning: "question", grammar: "Punctuation" },
            ],
          },
        ],
      },
    },
  },

  ko: {
    code: "ko",
    label: "Korean",
    native: "한국어",
    script: {
      pattern: /[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/,
      latin: false,
      name: "Hangul",
      instead: "Latin transliteration",
    },
    hints: ["annyeong", "annyeonghaseyo", "hangugeo", "juseyo", "gamsahamnida", "mwoyeyo",
      "isseoyo", "jinae", "jinaeyo", "ireum", "bangawoyo", "joayo", "eottae", "eodi", "jal",
      "saranghae", "hamnida",
      "haseyo", "annyeonghi", "mannaseo", "baeugo", "hanguk", "gwaenchanha", "jusillaeyo",
    ],
    teacherTitle: "Seonsaengnim",
    fontClass: "font-kr",
    reading: {
      enabled: true,
      label: "Romanization",
      hint: "the Revised Romanization of every word (e.g. `살아요` → `sarayo`)",
      needs: /[\uac00-\ud7af]/,
    },
    speechModes: [
      {
        id: "formal",
        label: "Formal",
        note: "해요체",
        hint: "polite 해요 endings (or 합니다 where it is more natural), as used with strangers and elders",
      },
      {
        id: "casual",
        label: "Casual",
        note: "반말",
        hint: "반말 plain endings, as used with close friends of the same age",
      },
    ],
    voice: {
      locale: "ko-KR",
      female: ["Yuna", "Google 한국의", "Sora", "Sun-Hi"],
      male: ["InJoon", "Minsu"],
    },
    sample: "Have you ever been to Korea?",
    board: { title: "Korean Language School", native: "한국어 학당" },
    examples: {
      formal: {
        english: "Do you live in Korea?",
        translation: [
          { word: "한국", reading: "hanguk" },
          { word: "에", reading: "e" },
          { word: "살아요", reading: "sarayo" },
          { word: "?" },
        ],
        grammarBreakdown: [
          {
            english: "Do you live in Korea?",
            translation: [
              { word: "한국", reading: "hanguk" },
              { word: "에", reading: "e" },
              { word: "살아요", reading: "sarayo" },
              { word: "?" },
            ],
            chunks: [
              {
                translation: [{ word: "한국", reading: "hanguk" }],
                meaning: "Korea",
                grammar: "Noun",
              },
              {
                translation: [{ word: "에", reading: "e" }],
                meaning: "in",
                grammar: "Location particle",
              },
              {
                translation: [{ word: "살아요", reading: "sarayo" }],
                meaning: "live",
                grammar: "Verb 살다 + 아요 polite ending",
              },
              { translation: [{ word: "?" }], meaning: "question", grammar: "Punctuation" },
            ],
          },
        ],
      },
      casual: {
        english: "Do you live in Korea?",
        translation: [
          { word: "한국", reading: "hanguk" },
          { word: "에", reading: "e" },
          { word: "살아", reading: "sara" },
          { word: "?" },
        ],
        grammarBreakdown: [
          {
            english: "Do you live in Korea?",
            translation: [
              { word: "한국", reading: "hanguk" },
              { word: "에", reading: "e" },
              { word: "살아", reading: "sara" },
              { word: "?" },
            ],
            chunks: [
              {
                translation: [{ word: "한국", reading: "hanguk" }],
                meaning: "Korea",
                grammar: "Noun",
              },
              {
                translation: [{ word: "에", reading: "e" }],
                meaning: "in",
                grammar: "Location particle",
              },
              {
                translation: [{ word: "살아", reading: "sara" }],
                meaning: "live",
                grammar: "Verb 살다 + 아 plain ending (반말)",
              },
              { translation: [{ word: "?" }], meaning: "question", grammar: "Punctuation" },
            ],
          },
        ],
      },
    },
  },
};

/** Board order — Japanese first because the classroom art and teachers are Japanese. */
export const LANGUAGE_CODES = ["ja", "hi", "es", "fr", "de", "ko"];

export const DEFAULT_LANGUAGE = "ja";

export function getLanguage(code) {
  return LANGUAGES[code] || LANGUAGES[DEFAULT_LANGUAGE];
}

export function isLanguage(code) {
  return Object.prototype.hasOwnProperty.call(LANGUAGES, code);
}

/** Speech mode ids a language actually offers, e.g. ["formal", "casual"]. */
export function speechModeIds(code) {
  return getLanguage(code).speechModes.map((mode) => mode.id);
}

export function getSpeechMode(code, speechId) {
  const language = getLanguage(code);
  return (
    language.speechModes.find((mode) => mode.id === speechId) ||
    language.speechModes[0]
  );
}
