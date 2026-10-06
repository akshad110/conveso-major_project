/**
 * Phrasebook — hand-written answers for the sentences students type first.
 *
 * Two problems this solves at once.
 *
 * Fluency: asked for "how are you", a local 8B will happily produce क्या आप कैसे
 * हैं? or आप कैसे हो? — grammatical-ish mush that no Indian actually says. These
 * sentences are too common to leave to a model that is guessing. The greetings,
 * the thank-yous and the self-introductions are written out here by hand, with the
 * register handled properly (आप takes हैं, तुम takes हो) and the grammar of every
 * word explained.
 *
 * Speed: a phrasebook hit costs no inference at all, so the answer is on the board
 * before the student's finger leaves Enter. The first thing anyone types is a
 * greeting, and that is exactly the moment a cold model feels slowest.
 *
 * Matching is by meaning, not by language: the student can type "how are you",
 * "aap kaise ho", "app kaise ho" or "आप कैसे हैं" and get the same lesson in
 * whichever language is selected. Only an exact match on the whole question counts
 * — anything longer goes to the model.
 *
 * Every entry's word list is *derived* from its chunks, so the rule the prompt
 * states ("every word appears in exactly one chunk, in order") cannot be broken
 * here by a typo.
 */

/** One word, with its reading where the language shows one. */
const w = (word, reading) => (reading ? { word, reading } : { word });

/** One chunk: the words, what they mean, and their grammatical role. */
const c = (words, meaning, grammar) => ({ translation: words, meaning, grammar });

/** One sentence of the breakdown. `english` is what this sentence means. */
const s = (english, chunks) => ({ english, chunks });

const wordsOf = (chunks) => chunks.flatMap((chunk) => chunk.translation);

/** Assemble the answer shape `normalizeAnswer` expects from a list of sentences. */
function build(sentences) {
  return {
    english: sentences.map((sentence) => sentence.english).join(" "),
    translation: sentences.flatMap((sentence) => wordsOf(sentence.chunks)),
    grammarBreakdown: sentences.map((sentence) => ({
      english: sentence.english,
      translation: wordsOf(sentence.chunks),
      chunks: sentence.chunks,
    })),
  };
}

/* ------------------------------------------------------------------ phrases */

export const PHRASES = [
  {
    id: "how-are-you",
    english: "How are you?",
    aliases: [
      "how are you", "how r u", "how are u", "how are you doing", "how do you do",
      "hows it going", "how is it going", "how are things", "whats up", "sup",
      // Hindi, as students actually type it
      "aap kaise ho", "app kaise ho", "aap kaise hain", "app kaise hain",
      "aap kaise hai", "aap kaisi ho", "kaise ho", "kaise hain", "kaisi ho",
      "kya haal hai", "kya hal hai", "आप कैसे हैं", "आप कैसे हो", "तुम कैसे हो",
      // the other five
      "ogenki desu ka", "genki desu ka", "genki", "お元気ですか", "元気",
      "como estas", "como esta usted", "que tal",
      "comment allez vous", "comment vas tu", "ca va", "comment ca va",
      "wie geht es dir", "wie geht es ihnen", "wie gehts", "wie geht es",
      "jal jinaeyo", "jal jinae", "잘 지내세요", "잘 지내",
    ],
    answers: {
      hi: {
        formal: [
          s("How are you?", [
            c([w("आप", "aap")], "you", "Pronoun, formal — used for elders, strangers and anyone senior"),
            c([w("कैसे", "kaise")], "how", "Question word, masculine plural to agree with आप"),
            c([w("हैं", "hain")], "are", "Verb होना, present — आप always takes हैं, never हो"),
            c([w("?")], "question", "Punctuation"),
          ]),
        ],
        casual: [
          s("How are you?", [
            c([w("तुम", "tum")], "you", "Pronoun, casual — friends, siblings, children"),
            c([w("कैसे", "kaise")], "how", "Question word, masculine — say कैसी to a woman"),
            c([w("हो", "ho")], "are", "Verb होना, present, तुम form"),
            c([w("?")], "question", "Punctuation"),
          ]),
        ],
      },
      ja: {
        formal: [
          s("How are you?", [
            c([w("お元気", "おげんき")], "well", "Noun-adjective 元気 with the polite お prefix"),
            c([w("です")], "are", "Polite copula"),
            c([w("か")], "question", "Particle — it does the work of a question mark"),
            c([w("?")], "question", "Punctuation"),
          ]),
        ],
        casual: [
          s("How are you?", [
            c([w("元気", "げんき")], "well", "Noun-adjective; casual speech drops です"),
            c([w("?")], "question", "Punctuation — a rising tone replaces か"),
          ]),
        ],
      },
      es: {
        formal: [
          s("How are you?", [
            c([w("¿")], "(question opens)", "Punctuation, Spanish opens a question with an inverted mark"),
            c([w("Cómo")], "how", "Question word, written with an accent in questions"),
            c([w("está")], "are", "Verb estar, present, 3rd person singular — the usted form"),
            c([w("usted")], "you", "Pronoun, formal; often dropped once it is clear"),
            c([w("?")], "(question closes)", "Punctuation"),
          ]),
        ],
        casual: [
          s("How are you?", [
            c([w("¿")], "(question opens)", "Punctuation"),
            c([w("Cómo")], "how", "Question word"),
            c([w("estás")], "are you", "Verb estar, present, 2nd person singular (tú)"),
            c([w("?")], "(question closes)", "Punctuation"),
          ]),
        ],
      },
      fr: {
        formal: [
          s("How are you?", [
            c([w("Comment")], "how", "Question word"),
            c([w("allez-vous")], "are you", "Verb aller, 2nd person plural, inverted with its subject"),
            c([w("?")], "question", "Punctuation — French puts a space before it"),
          ]),
        ],
        casual: [
          s("How are you?", [
            c([w("Comment")], "how", "Question word"),
            c([w("vas-tu")], "are you", "Verb aller, 2nd person singular, inverted with tu"),
            c([w("?")], "question", "Punctuation"),
          ]),
        ],
      },
      de: {
        formal: [
          s("How are you?", [
            c([w("Wie")], "how", "Question word"),
            c([w("geht")], "goes", "Verb gehen, 3rd person singular"),
            c([w("es")], "it", "Impersonal subject — German asks 'how goes it to you'"),
            c([w("Ihnen")], "to you", "Pronoun Sie in the dative, formal — always capitalised"),
            c([w("?")], "question", "Punctuation"),
          ]),
        ],
        casual: [
          s("How are you?", [
            c([w("Wie")], "how", "Question word"),
            c([w("geht")], "goes", "Verb gehen, 3rd person singular"),
            c([w("es")], "it", "Impersonal subject"),
            c([w("dir")], "to you", "Pronoun du in the dative"),
            c([w("?")], "question", "Punctuation"),
          ]),
        ],
      },
      ko: {
        formal: [
          s("How are you?", [
            c([w("잘", "jal")], "well", "Adverb"),
            c([w("지내세요", "jinaeseyo")], "are you getting on", "Verb 지내다 + honorific -시- + 해요 ending"),
            c([w("?")], "question", "Punctuation"),
          ]),
        ],
        casual: [
          s("How are you?", [
            c([w("잘", "jal")], "well", "Adverb"),
            c([w("지내", "jinae")], "are you getting on", "Verb 지내다, plain 반말 form"),
            c([w("?")], "question", "Punctuation"),
          ]),
        ],
      },
    },
  },

  {
    id: "hello",
    english: "Hello.",
    aliases: [
      "hello", "hi", "hey", "hello there", "hi there", "good day", "greetings",
      "namaste", "namaskar", "नमस्ते", "नमस्कार",
      "konnichiwa", "こんにちは",
      "hola", "buenos dias",
      "bonjour", "salut",
      "hallo", "guten tag",
      "annyeong", "annyeonghaseyo", "안녕하세요", "안녕",
    ],
    answers: {
      hi: {
        formal: [
          s("Greetings.", [
            c([w("नमस्कार", "namaskaar")], "greetings", "Set phrase, a shade more formal than नमस्ते"),
            c([w("।")], "full stop", "Punctuation — the Devanagari danda"),
          ]),
        ],
        casual: [
          s("Hello.", [
            c([w("नमस्ते", "namaste")], "hello", "Set phrase, any time of day, to anyone"),
            c([w("।")], "full stop", "Punctuation — the Devanagari danda"),
          ]),
        ],
      },
      ja: {
        both: [
          s("Hello.", [
            c([w("こんにちは")], "hello", "Set phrase used from late morning to evening — same in both registers"),
            c([w("。")], "full stop", "Punctuation"),
          ]),
        ],
      },
      es: {
        formal: [
          s("Good morning.", [
            c([w("Buenos")], "good", "Adjective, masculine plural, agreeing with días"),
            c([w("días")], "days", "Noun, masculine plural — the polite greeting until noon"),
            c([w(".")], "full stop", "Punctuation"),
          ]),
        ],
        casual: [
          s("Hello.", [
            c([w("¡")], "(exclamation opens)", "Punctuation, Spanish opens an exclamation with an inverted mark"),
            c([w("Hola")], "hello", "Greeting, any time of day"),
            c([w("!")], "(exclamation closes)", "Punctuation"),
          ]),
        ],
      },
      fr: {
        formal: [
          s("Hello.", [
            c([w("Bonjour")], "hello", "Literally 'good day' — safe with anyone"),
            c([w(".")], "full stop", "Punctuation"),
          ]),
        ],
        casual: [
          s("Hi.", [
            c([w("Salut")], "hi", "Greeting for friends only — never to a stranger or a superior"),
            c([w("!")], "exclamation", "Punctuation"),
          ]),
        ],
      },
      de: {
        formal: [
          s("Good day.", [
            c([w("Guten")], "good", "Adjective, masculine accusative — what is left of 'ich wünsche Ihnen einen guten Tag'"),
            c([w("Tag")], "day", "Noun, masculine — capitalised, as every German noun is"),
            c([w(".")], "full stop", "Punctuation"),
          ]),
        ],
        casual: [
          s("Hello.", [
            c([w("Hallo")], "hello", "Greeting for friends and colleagues"),
            c([w("!")], "exclamation", "Punctuation"),
          ]),
        ],
      },
      ko: {
        formal: [
          s("Hello.", [
            c([w("안녕하세요", "annyeonghaseyo")], "hello", "해요체 — the default polite greeting, any time of day"),
            c([w(".")], "full stop", "Punctuation"),
          ]),
        ],
        casual: [
          s("Hi.", [
            c([w("안녕", "annyeong")], "hi", "반말 — also serves as goodbye among friends"),
            c([w(".")], "full stop", "Punctuation"),
          ]),
        ],
      },
    },
  },

  {
    id: "thank-you",
    english: "Thank you.",
    aliases: [
      "thank you", "thanks", "thank you very much", "thanks a lot", "many thanks",
      "thankyou", "thx",
      "dhanyavad", "dhanyawad", "dhanyavaad", "shukriya", "धन्यवाद", "शुक्रिया",
      "arigato", "arigatou", "arigato gozaimasu", "arigatou gozaimasu", "ありがとう",
      "gracias", "muchas gracias",
      "merci", "merci beaucoup",
      "danke", "vielen dank", "danke schon", "danke schön",
      "gamsahamnida", "komawo", "gomawo", "감사합니다", "고마워",
    ],
    answers: {
      hi: {
        formal: [
          s("Thank you.", [
            c([w("धन्यवाद", "dhanyavaad")], "thank you", "Set phrase, Sanskrit-derived — the formal thanks"),
            c([w("।")], "full stop", "Punctuation"),
          ]),
        ],
        casual: [
          s("Thanks.", [
            c([w("शुक्रिया", "shukriya")], "thanks", "Set phrase, Urdu-derived — what people actually say in speech"),
            c([w("।")], "full stop", "Punctuation"),
          ]),
        ],
      },
      ja: {
        formal: [
          s("Thank you.", [
            c([w("ありがとう")], "thanks", "Set phrase, from the adjective ありがたい"),
            c([w("ございます")], "(polite)", "Polite auxiliary — this is what makes the phrase formal"),
            c([w("。")], "full stop", "Punctuation"),
          ]),
        ],
        casual: [
          s("Thanks.", [
            c([w("ありがとう")], "thanks", "Set phrase; drop ございます with friends"),
            c([w("。")], "full stop", "Punctuation"),
          ]),
        ],
      },
      es: {
        formal: [
          s("Thank you very much.", [
            c([w("Muchas")], "many", "Adjective, feminine plural, agreeing with gracias"),
            c([w("gracias")], "thanks", "Noun, feminine — always plural"),
            c([w(".")], "full stop", "Punctuation"),
          ]),
        ],
        casual: [
          s("Thanks.", [
            c([w("Gracias")], "thanks", "Noun, feminine plural"),
            c([w(".")], "full stop", "Punctuation"),
          ]),
        ],
      },
      fr: {
        formal: [
          s("Thank you very much.", [
            c([w("Merci")], "thank you", "Set phrase"),
            c([w("beaucoup")], "very much", "Adverb"),
            c([w(".")], "full stop", "Punctuation"),
          ]),
        ],
        casual: [
          s("Thanks.", [
            c([w("Merci")], "thanks", "Set phrase"),
            c([w(".")], "full stop", "Punctuation"),
          ]),
        ],
      },
      de: {
        formal: [
          s("Many thanks.", [
            c([w("Vielen")], "many", "Adjective, masculine accusative, agreeing with Dank"),
            c([w("Dank")], "thanks", "Noun, masculine"),
            c([w(".")], "full stop", "Punctuation"),
          ]),
        ],
        casual: [
          s("Thanks.", [
            c([w("Danke")], "thanks", "Verb danken, 1st person singular, used as a set phrase"),
            c([w(".")], "full stop", "Punctuation"),
          ]),
        ],
      },
      ko: {
        formal: [
          s("Thank you.", [
            c([w("감사합니다", "gamsahamnida")], "thank you", "감사 (gratitude) + 합니다 — the formal everyday thanks"),
            c([w(".")], "full stop", "Punctuation"),
          ]),
        ],
        casual: [
          s("Thanks.", [
            c([w("고마워", "gomawo")], "thanks", "Adjective 고맙다 in 반말 — friends only"),
            c([w(".")], "full stop", "Punctuation"),
          ]),
        ],
      },
    },
  },

  {
    id: "nice-to-meet-you",
    english: "Nice to meet you.",
    aliases: [
      "nice to meet you", "pleased to meet you", "good to meet you",
      "nice to meet u", "nice meeting you",
      "aapse milkar khushi hui", "apse milkar khushi hui", "tumse milkar khushi hui",
      "hajimemashite", "yoroshiku", "yoroshiku onegaishimasu", "はじめまして", "よろしく",
      "mucho gusto", "encantado", "encantada",
      "enchante", "enchanté", "enchantee",
      "freut mich", "sehr erfreut",
      "bangawoyo", "bangapseumnida", "반가워요", "반가워",
    ],
    answers: {
      hi: {
        formal: [
          s("It was a pleasure to meet you.", [
            c([w("आपसे", "aapse")], "with you", "Pronoun आप + postposition से, formal"),
            c([w("मिलकर", "milkar")], "having met", "Verb मिलना in the conjunctive participle (-कर)"),
            c([w("खुशी", "khushi")], "happiness", "Noun, feminine"),
            c([w("हुई", "hui")], "happened", "Verb होना, past — feminine, agreeing with खुशी"),
            c([w("।")], "full stop", "Punctuation"),
          ]),
        ],
        casual: [
          s("It was a pleasure to meet you.", [
            c([w("तुमसे", "tumse")], "with you", "Pronoun तुम + से, casual"),
            c([w("मिलकर", "milkar")], "having met", "Verb मिलना, conjunctive participle"),
            c([w("खुशी", "khushi")], "happiness", "Noun, feminine"),
            c([w("हुई", "hui")], "happened", "Verb होना, past, feminine agreement"),
            c([w("।")], "full stop", "Punctuation"),
          ]),
        ],
      },
      ja: {
        formal: [
          s("Nice to meet you.", [
            c([w("はじめまして")], "nice to meet you", "Set phrase, said only at a first meeting"),
            c([w("。")], "full stop", "Punctuation"),
          ]),
          s("Please treat me kindly.", [
            c([w("よろしく")], "favourably", "Adverb, from よろしい"),
            c([w("お願い", "おねがい"), w("します")], "I ask", "Noun 願い with the polite お prefix + します"),
            c([w("。")], "full stop", "Punctuation"),
          ]),
        ],
        casual: [
          s("Nice to meet you.", [
            c([w("よろしく")], "nice to meet you", "Set phrase — the casual half of よろしくお願いします"),
            c([w("。")], "full stop", "Punctuation"),
          ]),
        ],
      },
      es: {
        both: [
          s("Nice to meet you.", [
            c([w("Mucho")], "much", "Adjective, masculine singular"),
            c([w("gusto")], "pleasure", "Noun, masculine — the whole phrase works in either register"),
            c([w(".")], "full stop", "Punctuation"),
          ]),
        ],
      },
      fr: {
        both: [
          s("Delighted to meet you.", [
            c([w("Enchanté")], "delighted", "Past participle used as an adjective — write Enchantée if you are female"),
            c([w(".")], "full stop", "Punctuation"),
          ]),
        ],
      },
      de: {
        formal: [
          s("Pleased to meet you.", [
            c([w("Freut")], "pleases", "Verb freuen, 3rd person singular, impersonal"),
            c([w("mich")], "me", "Pronoun ich in the accusative"),
            c([w(",")], "comma", "Punctuation — German puts one before an infinitive clause"),
            c([w("Sie")], "you", "Pronoun, formal, accusative — capitalised"),
            c([w("kennenzulernen")], "to get to know", "Infinitive kennenlernen with zu inserted between its parts"),
            c([w(".")], "full stop", "Punctuation"),
          ]),
        ],
        casual: [
          s("Pleased to meet you.", [
            c([w("Freut")], "pleases", "Verb freuen, 3rd person singular, impersonal"),
            c([w("mich")], "me", "Pronoun ich in the accusative"),
            c([w("!")], "exclamation", "Punctuation"),
          ]),
        ],
      },
      ko: {
        formal: [
          s("Nice to meet you.", [
            c([w("반가워요", "bangawoyo")], "nice to meet you", "Adjective 반갑다 + 해요 ending"),
            c([w(".")], "full stop", "Punctuation"),
          ]),
        ],
        casual: [
          s("Nice to meet you.", [
            c([w("반가워", "bangawo")], "nice to meet you", "Adjective 반갑다 in 반말"),
            c([w(".")], "full stop", "Punctuation"),
          ]),
        ],
      },
    },
  },

  {
    id: "what-is-your-name",
    english: "What is your name?",
    aliases: [
      "what is your name", "whats your name", "what s your name", "what is ur name",
      "may i ask your name", "your name please", "tell me your name",
      "aapka naam kya hai", "apka naam kya hai", "tumhara naam kya hai",
      "naam kya hai", "tera naam kya hai", "आपका नाम क्या है", "तुम्हारा नाम क्या है",
      "onamae wa nan desu ka", "namae wa", "お名前は何ですか",
      "como te llamas", "como se llama usted", "como se llama",
      "comment vous appelez vous", "comment tu t appelles", "comment tu tappelles",
      "wie heisst du", "wie heißt du", "wie heissen sie", "wie heißen sie",
      "ireumi mwoyeyo", "이름이 뭐예요", "이름이 뭐야",
    ],
    answers: {
      hi: {
        formal: [
          s("What is your name?", [
            c([w("आपका", "aapka")], "your", "Pronoun आप + possessive का, masculine to agree with नाम"),
            c([w("नाम", "naam")], "name", "Noun, masculine"),
            c([w("क्या", "kya")], "what", "Question word"),
            c([w("है", "hai")], "is", "Verb होना, present, 3rd person singular"),
            c([w("?")], "question", "Punctuation"),
          ]),
        ],
        casual: [
          s("What is your name?", [
            c([w("तुम्हारा", "tumhaara")], "your", "Possessive of तुम, masculine to agree with नाम"),
            c([w("नाम", "naam")], "name", "Noun, masculine"),
            c([w("क्या", "kya")], "what", "Question word"),
            c([w("है", "hai")], "is", "Verb होना, present, 3rd person singular"),
            c([w("?")], "question", "Punctuation"),
          ]),
        ],
      },
      ja: {
        formal: [
          s("What is your name?", [
            c([w("お名前", "おなまえ")], "name", "Noun 名前 with the honorific お — for someone else's name, never your own"),
            c([w("は")], "as for", "Topic particle"),
            c([w("何", "なん")], "what", "Question word"),
            c([w("です")], "is", "Polite copula"),
            c([w("か")], "question", "Particle"),
            c([w("?")], "question", "Punctuation"),
          ]),
        ],
        casual: [
          s("What's your name?", [
            c([w("名前", "なまえ")], "name", "Noun, without the honorific お"),
            c([w("は")], "as for", "Topic particle"),
            c([w("?")], "question", "Punctuation — the rest of the sentence is left unsaid"),
          ]),
        ],
      },
      es: {
        formal: [
          s("What is your name?", [
            c([w("¿")], "(question opens)", "Punctuation"),
            c([w("Cómo")], "how", "Question word — Spanish asks 'how do you call yourself'"),
            c([w("se")], "yourself", "Reflexive pronoun, 3rd person — the usted form"),
            c([w("llama")], "call", "Verb llamar, present, 3rd person singular"),
            c([w("usted")], "you", "Pronoun, formal"),
            c([w("?")], "(question closes)", "Punctuation"),
          ]),
        ],
        casual: [
          s("What is your name?", [
            c([w("¿")], "(question opens)", "Punctuation"),
            c([w("Cómo")], "how", "Question word"),
            c([w("te")], "yourself", "Reflexive pronoun, 2nd person singular"),
            c([w("llamas")], "you call", "Verb llamar, present, tú form"),
            c([w("?")], "(question closes)", "Punctuation"),
          ]),
        ],
      },
      fr: {
        formal: [
          s("What is your name?", [
            c([w("Comment")], "how", "Question word — French asks 'how do you call yourself'"),
            c([w("vous")], "yourself", "Reflexive pronoun, 2nd person plural"),
            c([w("appelez-vous")], "do you call", "Verb appeler, 2nd person plural, inverted with its subject"),
            c([w("?")], "question", "Punctuation"),
          ]),
        ],
        casual: [
          s("What is your name?", [
            c([w("Comment")], "how", "Question word"),
            c([w("tu")], "you", "Pronoun, 2nd person singular"),
            c([w("t'appelles")], "call yourself", "Reflexive te + verb appeler, elided before a vowel"),
            c([w("?")], "question", "Punctuation"),
          ]),
        ],
      },
      de: {
        formal: [
          s("What is your name?", [
            c([w("Wie")], "how", "Question word — German asks 'how are you called'"),
            c([w("heißen")], "are called", "Verb heißen, plural form used with Sie"),
            c([w("Sie")], "you", "Pronoun, formal — capitalised"),
            c([w("?")], "question", "Punctuation"),
          ]),
        ],
        casual: [
          s("What is your name?", [
            c([w("Wie")], "how", "Question word"),
            c([w("heißt")], "are called", "Verb heißen, 2nd person singular"),
            c([w("du")], "you", "Pronoun, casual"),
            c([w("?")], "question", "Punctuation"),
          ]),
        ],
      },
      ko: {
        formal: [
          s("What is your name?", [
            c([w("이름이", "ireumi")], "name", "Noun 이름 + subject particle 이"),
            c([w("뭐예요", "mwoyeyo")], "what is it", "뭐 (what) + 예요, the 해요체 copula"),
            c([w("?")], "question", "Punctuation"),
          ]),
        ],
        casual: [
          s("What is your name?", [
            c([w("이름이", "ireumi")], "name", "Noun 이름 + subject particle 이"),
            c([w("뭐야", "mwoya")], "what is it", "뭐 + 야, the 반말 copula"),
            c([w("?")], "question", "Punctuation"),
          ]),
        ],
      },
    },
  },

  {
    id: "i-am-learning",
    english: "I am learning this language.",
    aliases: ["i am learning", "im learning", "i m learning", "i am studying", "im studying"],
    answers: {
      hi: {
        aliases: ["i am learning hindi", "im learning hindi", "main hindi seekh raha hun"],
        both: [
          s("I am learning Hindi.", [
            c([w("मैं", "main")], "I", "Pronoun, 1st person singular"),
            c([w("हिन्दी", "hindi")], "Hindi", "Proper noun, feminine"),
            c([w("सीख", "seekh")], "learn", "Verb सीखना, stem form"),
            c([w("रहा", "raha")], "-ing", "Progressive auxiliary, masculine — say रही if you are female"),
            c([w("हूँ", "hun")], "am", "Verb होना, present, 1st person singular"),
            c([w("।")], "full stop", "Punctuation"),
          ]),
        ],
      },
      ja: {
        aliases: ["i am learning japanese", "im learning japanese", "nihongo o benkyou shiteimasu"],
        formal: [
          s("I am studying Japanese.", [
            c([w("日本語", "にほんご")], "Japanese", "Noun — 日本 (Japan) + 語 (language)"),
            c([w("を")], "(object)", "Object particle"),
            c([w("勉強", "べんきょう")], "study", "Noun"),
            c([w("しています")], "am doing", "Verb する in the て form + います — the polite progressive"),
            c([w("。")], "full stop", "Punctuation"),
          ]),
        ],
        casual: [
          s("I am studying Japanese.", [
            c([w("日本語", "にほんご")], "Japanese", "Noun — 日本 (Japan) + 語 (language)"),
            c([w("を")], "(object)", "Object particle"),
            c([w("勉強", "べんきょう")], "study", "Noun"),
            c([w("してる")], "am doing", "して + いる with the い dropped, as in casual speech"),
            c([w("。")], "full stop", "Punctuation"),
          ]),
        ],
      },
      es: {
        aliases: ["i am learning spanish", "im learning spanish", "estoy aprendiendo espanol"],
        both: [
          s("I am learning Spanish.", [
            c([w("Estoy")], "I am", "Verb estar, present, 1st person singular"),
            c([w("aprendiendo")], "learning", "Gerund of aprender"),
            c([w("español")], "Spanish", "Noun, masculine — language names are not capitalised in Spanish"),
            c([w(".")], "full stop", "Punctuation"),
          ]),
        ],
      },
      fr: {
        aliases: ["i am learning french", "im learning french", "j apprends le francais"],
        both: [
          s("I am learning French.", [
            c([w("J'apprends")], "I am learning", "Je + apprendre, 1st person singular, elided — French has no separate progressive"),
            c([w("le")], "the", "Definite article, masculine — French needs it before a language name"),
            c([w("français")], "French", "Noun, masculine, not capitalised"),
            c([w(".")], "full stop", "Punctuation"),
          ]),
        ],
      },
      de: {
        aliases: ["i am learning german", "im learning german", "ich lerne deutsch"],
        both: [
          s("I am learning German.", [
            c([w("Ich")], "I", "Pronoun, 1st person singular"),
            c([w("lerne")], "am learning", "Verb lernen, 1st person singular — German has no separate progressive"),
            c([w("Deutsch")], "German", "Noun, capitalised"),
            c([w(".")], "full stop", "Punctuation"),
          ]),
        ],
      },
      ko: {
        aliases: ["i am learning korean", "im learning korean", "hangugeoreul baeugo isseoyo"],
        formal: [
          s("I am learning Korean.", [
            c([w("한국어를", "hangugeoreul")], "Korean", "Noun 한국어 + object particle 를"),
            c([w("배우고", "baeugo")], "learning", "Verb 배우다 in the -고 form"),
            c([w("있어요", "isseoyo")], "am", "Verb 있다, 해요체 — -고 있다 is the progressive"),
            c([w(".")], "full stop", "Punctuation"),
          ]),
        ],
        casual: [
          s("I am learning Korean.", [
            c([w("한국어를", "hangugeoreul")], "Korean", "Noun 한국어 + object particle 를"),
            c([w("배우고", "baeugo")], "learning", "Verb 배우다 in the -고 form"),
            c([w("있어", "isseo")], "am", "Verb 있다, 반말"),
            c([w(".")], "full stop", "Punctuation"),
          ]),
        ],
      },
    },
  },
];

/* ------------------------------------------------------------------- lookup */

/**
 * Fold a question down to something two spellings of the same sentence share:
 * lower case, Latin accents removed, punctuation gone. Devanagari matras, Hangul
 * jamo and Japanese marks are *not* touched — stripping combining marks wholesale
 * would turn कैसे into कस.
 */
export const phraseKey = (text) =>
  String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // café → cafe, cómo → como (Latin accents only)
    // Back to composed form: NFD leaves Hangul as loose jamo and Devanagari split
    // from its matras, which matches nothing a student's browser sends.
    .normalize("NFC")
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const globalIndex = new Map();
const scopedIndex = new Map();

for (const entry of PHRASES) {
  for (const alias of entry.aliases) globalIndex.set(phraseKey(alias), entry);
  for (const [code, answer] of Object.entries(entry.answers)) {
    for (const alias of answer.aliases || []) {
      scopedIndex.set(`${code}|${phraseKey(alias)}`, entry);
    }
  }
}

/** Every alias, for the verifier's collision check. */
export const phraseAliases = () => ({ global: globalIndex, scoped: scopedIndex });

/**
 * The hand-written answer for this question, or null to let the model handle it.
 * Matches the whole question only — "how are you" hits, "how are you going to
 * explain that" does not.
 *
 * @returns {{english: string, translation: object[], grammarBreakdown: object[]}|null}
 */
export function lookupPhrase({ languageCode, speechId, question }) {
  const key = phraseKey(question);
  if (!key) return null;

  const entry = scopedIndex.get(`${languageCode}|${key}`) || globalIndex.get(key);
  if (!entry) return null;

  const answer = entry.answers[languageCode];
  if (!answer) return null;

  const sentences = answer[speechId] || answer.both;
  if (!sentences) return null;

  return build(sentences);
}

export const phraseCount = () => PHRASES.length;
