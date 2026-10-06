# AI Language Teacher — local, on Ollama

A 3D classroom where you type a sentence in English and the teacher writes it on the
board in the language you picked, reads it out loud, and breaks the grammar down
word by word.

Everything runs on this machine. The brain is [Ollama](https://ollama.com) on
`127.0.0.1:11434`, the voice is the browser's own speech synthesis. No OpenAI key,
no Azure subscription, no network calls at runtime.

## Languages

Japanese (日本語), Hindi (हिन्दी), Spanish (Español), French (Français),
German (Deutsch) and Korean (한국어) — switch on the row of buttons above the
blackboard. Each language has a formal and a casual register (です・ます vs plain,
आप vs तुम, usted vs tú, vous vs tu, Sie vs du, 해요체 vs 반말), and Japanese,
Hindi and Korean also show a reading line above each word: furigana for Japanese,
romanization for Hindi and Korean.

## Running it

```bash
ollama serve                 # or just open the Ollama app
ollama pull llama3.1:8b      # ~4.7 GB, one time
npm install
npm run dev                  # http://localhost:3000
```

The box in the bottom-left corner tells you which model answered. If Ollama isn't
up it says so, with the command to fix it, instead of failing on your first
question.

Optional environment variables (put them in `.env.local`):

```
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_MODEL=llama3.1:8b
OLLAMA_TIMEOUT_MS=120000
OLLAMA_NUM_CTX=4096
OLLAMA_KEEP_ALIVE=30m
```

If `OLLAMA_MODEL` isn't installed the app falls back to whatever you do have,
preferring the llama / qwen / mistral / gemma families in that order. For sharper
Japanese, Hindi and Korean output than llama3.1 gives, try
`ollama pull qwen2.5:7b` and set `OLLAMA_MODEL=qwen2.5:7b`.

## Speed

A local 8B is slower than a hosted model, so the app spends its effort on not
wasting time:

The sentences students actually type first — greetings, thank-yous, "how are
you", "what is your name" — never reach the model at all. They are written out by
hand in `src/lib/phrasebook.mjs`, so they appear the instant you press Enter.
Opening the page (and switching language) fires a two-stage warm-up: load the
weights into memory, then push that language's real system prompt through the
model for a single token, so Ollama has the prefix cached and the first real
question skips the prefill. `OLLAMA_KEEP_ALIVE=30m` keeps both alive, so you pay
the ~10-20s model load once per session instead of on your first question.
`OLLAMA_NUM_CTX=4096` matters more than it looks — Ollama's default window is
small, and when prompt plus answer overflow it llama.cpp silently drops the
*oldest* tokens, which is the system message holding the schema; the model then
answers in a shape validation rejects and all three attempts burn. The prompt is
one system message rather than two, and the schema no longer asks the model to
retype the whole sentence inside every grammar entry, which cut roughly a third
of the output tokens. Temperature sits at 0.2 so the first attempt is usually the
only attempt. Asking the same question twice in the same language and register is
served from a cache that is mirrored to `.cache/ai-teacher-answers.json` — the
mirror is what makes it survive `next dev` discarding module state every time you
save a file. `/api/ai?fresh=1` skips the cache; `AI_TEACHER_CACHE_FILE=""` keeps
it in memory only.

The typing box shows a running timer while the model thinks, and afterwards how
long the answer took, that it came from cache, or that it came from the
phrasebook — so a slow local answer reads as slow rather than broken.

## Saying it the way people say it

Two things make the difference between a translation and a lesson.

The phrasebook handles register properly, which is where a small model reliably
slips: आप takes हैं and तुम takes हो, so "how are you" is आप कैसे हैं? in formal
and तुम कैसे हो? in casual — never the आप कैसे हो? mixture an 8B tends to produce.
Japanese gets です・ます against plain form, Korean 해요체 against 반말. Each entry
covers all six languages in both registers, and every word list is *derived* from
the chunk list, so the rule the prompt states — every word appears in exactly one
chunk, in order — cannot be broken by a typo in a hand-written entry.

You can also type in the language you are learning. "app kaise ho", "genki desu
ka", "wie gehts" and आप कैसे हैं are all recognised as the target language rather
than English (each language carries a list of its own function words in Latin
letters; any English function word overrides them, so "how do i say app" stays
English). When that happens the prompt changes from *translate this* to *here is
what the student wrote, possibly with mistakes — give the correct, natural
sentence* — and the student's own words are kept off the English line instead of
being printed as their own meaning.

## How it fits together

`src/lib/languages.mjs` is the single source of truth: the label, the native name,
the register names, the voice locale, the font class, and one worked example per
register that gets embedded in the prompt. Adding a seventh language means adding
one entry there and nothing else.

`src/lib/ollama.mjs` is the model client — zero dependencies, `fetch` only, JSON
mode, and a repair loop, because an 8B model will occasionally answer with prose or
with the right JSON in the wrong shape. When that happens the client hands the
model its own broken output plus the list of complaints and asks again, up to three
times. Failures come back as typed errors (`OLLAMA_UNREACHABLE`, `NO_MODELS`,
`MODEL_MISSING`, `MODEL_OUTPUT_INVALID`) which the UI turns into advice.

`src/lib/phrasebook.mjs` is the hand-written layer in front of the model: about
150 spellings of six common sentences ("how are you", "aap kaise ho", "que tal",
"잘 지내") mapped to one answer per language and register. `/api/ai` checks it
before it checks Ollama, so a hit costs no inference. Adding a phrase means
adding one entry with its aliases and its per-language answers; the verifier then
holds it to the same standard as a model answer.

`src/lib/answerSchema.mjs` builds the prompt and validates the answer. Nothing the
model says reaches the board unchecked: word lists get rebuilt whatever the model
decided to call the fields (`kanji`, `hangul`, `devanagari`, `surface` and a dozen
more all read as the word), a bare string gets tokenized (per script — Japanese is
never split on spaces), containers get unwrapped, invented pronunciations get
stripped from Latin-script languages, a missing grammar breakdown gets synthesised,
and objects where strings were expected get flattened so React can't throw. An
answer written in romaji instead of the language's own script is sent back with an
instruction to rewrite it, rather than put on the board. It also decides whether
the student typed English, romanized target language or the target script, which
is what switches the prompt from translating to correcting.

`src/lib/visemes.mjs` + `src/lib/speech.js` are the voice. Azure used to return
viseme timings for the lip-sync; the browser gives no such thing, so the timeline
is derived from the writing system itself — kana is mapped through a gojūon table,
Devanagari through its consonant/matra/virama rules, Hangul by decomposing each
syllable block into initial, medial and final jamo, and Latin text through digraph
rules. Where a word carries a reading, the reading drives the mouth, because it
spells the sounds out. The timeline runs on nominal milliseconds and is rescaled
live from `onboundary` events, so the mouth keeps up with whatever rate the
installed voice actually speaks at.

If a language has no installed voice the teacher still speaks, with a note saying
which voice it borrowed. macOS: System Settings → Accessibility → Spoken Content →
System Voice → Manage Voices. Windows: Settings → Time & Language → Speech.

## Verifying

```bash
npm run verify        # 70 offline checks, no Ollama needed
npm run verify:live   # + one real translation per language through Ollama
npm run ollama:check  # what Ollama has installed right now
```

The verifier imports the app's real modules and pushes malformed model output
through them, checks that no language's prompt mentions any other language (the
hardcoding guard — this codebase started out Japanese-only), asserts that the worked
example in each prompt would itself pass validation (right script, chunks covering
the sentence in order), holds every hand-written phrasebook answer to that same
standard and proves no alias means two different things, pins the viseme
decomposition of one word per script, checks that the answer cache survives a
reload and cannot grow without bound, and exercises the Ollama client's repair
loop, options, warm-up calls and error codes against a stubbed server. Each guard
has been checked by deliberately breaking the thing it watches — that is how the
Spanish example's inverted-question-mark ordering was found, and how two later
bugs surfaced: accented input ("¿cómo estás?") never matching a romanized hint
list, and the Devanagari danda counting as a word that owes a pronunciation.

## Credit

Built on [Wawa Sensei](https://wawasensei.dev)'s R3F AI language teacher (Next.js +
React Three Fiber + drei + zustand). The classroom, the teacher models and their
animations are from that project; the AI, the voice and the multi-language layer
here are local replacements for its OpenAI and Azure services.
