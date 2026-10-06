"use client";

/**
 * The teacher's voice — 100% local.
 *
 * Azure Cognitive Services used to synthesise the audio and hand back viseme
 * timings. This replaces both with the browser's built-in SpeechSynthesis (free,
 * offline, no key) plus a derived viseme timeline from src/lib/visemes.mjs.
 *
 * SpeechSynthesis gives no timing information beyond word `onboundary` events, so
 * the player runs a *nominal* clock: the viseme timeline's own milliseconds,
 * rescaled whenever a boundary event tells us how fast the voice is actually
 * going. Teacher.jsx reads `player.currentTime` (seconds) exactly as it read the
 * old `Audio` element, so nothing downstream changed.
 */

import { speechPlan } from "@/lib/answerSchema.mjs";
import { getLanguage } from "@/lib/languages.mjs";
import { buildVisemeTimeline } from "@/lib/visemes.mjs";

export const speechSupported = () =>
  typeof window !== "undefined" && "speechSynthesis" in window;

/**
 * Voices load asynchronously in Chrome — the first call to getVoices() often
 * returns []. Wait for `voiceschanged`, but never longer than `timeoutMs`.
 */
export function loadVoices(timeoutMs = 1500) {
  if (!speechSupported()) return Promise.resolve([]);
  const synth = window.speechSynthesis;
  const existing = synth.getVoices();
  if (existing.length) return Promise.resolve(existing);

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      synth.removeEventListener?.("voiceschanged", finish);
      resolve(synth.getVoices());
    };
    synth.addEventListener?.("voiceschanged", finish);
    setTimeout(finish, timeoutMs);
  });
}

const normalize = (value) => (value || "").toLowerCase().replace(/[_\s]+/g, "-");

/**
 * Best available voice for a language, preferring the named voices in the
 * language registry and then anything that speaks the right locale.
 *
 * @returns {{ voice: SpeechSynthesisVoice|null, exact: boolean }}
 */
export function pickVoice(voices, languageCode, gender = "female") {
  const language = getLanguage(languageCode);
  const locale = normalize(language.voice.locale); // e.g. "ja-jp"
  const prefix = locale.split("-")[0]; // e.g. "ja"
  const list = voices || [];

  const inLanguage = list.filter((voice) => {
    const lang = normalize(voice.lang);
    return lang === locale || lang.split("-")[0] === prefix;
  });

  const wanted = [...(language.voice[gender] || []), ...(language.voice[gender === "female" ? "male" : "female"] || [])];
  for (const name of wanted) {
    const match = inLanguage.find((voice) => normalize(voice.name).includes(normalize(name)));
    if (match) return { voice: match, exact: true };
  }

  // Prefer a locally installed voice over a network one — it starts instantly.
  const local = inLanguage.find((voice) => voice.localService);
  if (local) return { voice: local, exact: true };
  if (inLanguage.length) return { voice: inLanguage[0], exact: true };

  return { voice: list.find((voice) => voice.default) || list[0] || null, exact: false };
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

class SpeechPlayer {
  constructor({ text, timeline, voice, lang, rate = 0.95, pitch = 1 }) {
    this.text = text;
    this.timeline = timeline;
    this.voice = voice;
    this.lang = lang;
    this.rate = rate;
    this.pitch = pitch;
    this.onended = null;

    this._startedAt = 0;
    this._offsetMs = 0; // nominal ms already played before the current start
    this._scale = 1; // real ms per nominal ms
    this._playing = false;
    this._utterance = null;
  }

  /** Nominal timeline position in seconds — what the viseme lookup expects. */
  get currentTime() {
    if (!this._playing) return this._offsetMs / 1000;
    const realElapsed = performance.now() - this._startedAt;
    return (this._offsetMs + realElapsed / this._scale) / 1000;
  }

  /** The hook does `player.currentTime = 0` to replay from the top. */
  set currentTime(seconds) {
    this._offsetMs = Math.max(0, (Number(seconds) || 0) * 1000);
  }

  get duration() {
    return this.timeline.duration / 1000;
  }

  get playing() {
    return this._playing;
  }

  play() {
    if (!speechSupported()) return;
    const synth = window.speechSynthesis;
    synth.cancel(); // one teacher, one voice at a time

    const utterance = new SpeechSynthesisUtterance(this.text);
    if (this.voice) utterance.voice = this.voice;
    utterance.lang = this.voice?.lang || this.lang;
    utterance.rate = this.rate;
    utterance.pitch = this.pitch;

    utterance.onstart = () => {
      this._startedAt = performance.now();
      this._scale = 1;
      this._playing = true;
    };

    utterance.onboundary = (event) => {
      // Real elapsed vs where the nominal timeline expected this word to be.
      if (typeof event.charIndex !== "number") return;
      const mark = this._markAt(event.charIndex);
      if (!mark || mark.time <= 0) return;
      const realElapsed = performance.now() - this._startedAt;
      const nominal = Math.max(1, mark.time - this._offsetMs);
      const observed = clamp(realElapsed / nominal, 0.4, 3);
      // Smooth it — a single early boundary shouldn't yank the mouth around.
      this._scale = this._scale * 0.6 + observed * 0.4;
    };

    const finish = () => {
      if (!this._playing && !this._utterance) return;
      this._playing = false;
      this._utterance = null;
      this._offsetMs = 0;
      this.onended?.();
    };
    utterance.onend = finish;
    utterance.onerror = finish;

    this._utterance = utterance;
    this._startedAt = performance.now();
    this._playing = true;

    // Chrome drops an utterance queued in the same tick as cancel().
    setTimeout(() => {
      if (this._utterance === utterance) synth.speak(utterance);
    }, 40);
  }

  pause() {
    this._playing = false;
    this._utterance = null;
    this._offsetMs = 0;
    if (speechSupported()) window.speechSynthesis.cancel();
  }

  _markAt(charIndex) {
    const marks = this.timeline.marks;
    let found = null;
    for (const mark of marks) {
      if (mark.charIndex <= charIndex) found = mark;
      else break;
    }
    return found;
  }
}

/**
 * Build a voice + viseme timeline for one answer.
 *
 * @returns {Promise<{ player: SpeechPlayer, visemes: Array<[number, number]>, voiceName: string|null, missingVoice: boolean }>}
 */
export async function createSpeechPlayer({ words, languageCode, gender = "female", rate }) {
  const language = getLanguage(languageCode);
  const { text, charIndexes } = speechPlan(words, languageCode);
  const timeline = buildVisemeTimeline(words, text, charIndexes);

  const voices = await loadVoices();
  const { voice, exact } = pickVoice(voices, languageCode, gender);

  const player = new SpeechPlayer({
    text,
    timeline,
    voice,
    lang: language.voice.locale,
    rate: rate ?? 0.95,
  });

  return {
    player,
    visemes: timeline.visemes,
    voiceName: voice?.name || null,
    missingVoice: !exact,
    text,
  };
}
