"use client";

import { create } from "zustand";
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_CODES,
  getLanguage,
  speechModeIds,
} from "@/lib/languages.mjs";
import { createSpeechPlayer, speechSupported } from "@/lib/speech";

export const teachers = ["Nanami", "Naoki"];

/** Which voice to hunt for in the browser's voice list. */
export const teacherGender = { Nanami: "female", Naoki: "male" };

export const languages = LANGUAGE_CODES;

export const useAITeacher = create((set, get) => ({
  messages: [],
  currentMessage: null,

  teacher: teachers[0],
  setTeacher: (teacher) => {
    set(() => ({
      teacher,
      messages: get().messages.map((message) => {
        message.audioPlayer?.pause?.();
        message.audioPlayer = null; // New teacher, new voice
        return message;
      }),
      currentMessage: null,
    }));
  },

  /** Target language the teacher translates into. */
  language: DEFAULT_LANGUAGE,
  setLanguage: (language) => {
    const modes = speechModeIds(language);
    set(() => ({
      language,
      // Not every language offers the same registers — keep the mode valid.
      speech: modes.includes(get().speech) ? get().speech : modes[0],
      error: null,
    }));
    // Warm the model for the new language while the student reads the board.
    get().checkOllama();
  },

  classroom: "default",
  setClassroom: (classroom) => set(() => ({ classroom })),

  loading: false,
  error: null,
  clearError: () => set(() => ({ error: null })),

  /**
   * What the lesson is worth, counted as it happens.
   *
   * Two numbers, kept here rather than in the session layer because this store
   * is the only place that knows when a question was answered and when a phrase
   * was played again. A standalone classroom counts them too and nobody ever
   * reads them; a launched one reports them to Converso, which re-derives the
   * score from them and ignores any score a browser sends.
   *
   * `phrasesPractised` counts *replays only* — see playMessage. askAI already
   * speaks every answer the moment it lands, so counting each playback would
   * score the student twice for asking and not once for practising.
   */
  questionsAsked: 0,
  phrasesPractised: 0,

  /** How long the last answer took, where it came from, and whether it was cached. */
  lastMs: null,
  lastCached: false,
  lastSource: null,

  /** Furigana for Japanese, romanization for Hindi/Korean — same toggle. */
  showReading: true,
  setShowReading: (showReading) => set(() => ({ showReading })),

  english: true,
  setEnglish: (english) => set(() => ({ english })),

  speech: "formal",
  setSpeech: (speech) => set(() => ({ speech })),

  voiceWarning: null,

  /** Ollama status, so the board can say what's wrong before you ask anything. */
  ollama: { checked: false, ok: false, model: null, models: [], error: null, hint: null },
  checkOllama: async () => {
    try {
      const params = new URLSearchParams({ language: get().language, speech: get().speech });
      const res = await fetch(`/api/ollama?${params.toString()}`);
      const data = await res.json();
      set(() => ({
        ollama: {
          checked: true,
          ok: Boolean(data.ok),
          model: data.model || null,
          models: data.models || [],
          error: data.error || null,
          hint: data.ok ? null : `Run \`ollama serve\` and \`ollama pull ${data.preferredModel}\`.`,
        },
      }));
    } catch (error) {
      set(() => ({
        ollama: {
          checked: true,
          ok: false,
          model: null,
          models: [],
          error: error.message,
          hint: "Is the dev server running? /api/ollama did not respond.",
        },
      }));
    }
  },

  askAI: async (question) => {
    if (!question) return;

    const language = get().language;
    const speech = get().speech;
    const message = { question, id: get().messages.length, language, speech };

    set(() => ({ loading: true, error: null }));

    try {
      const params = new URLSearchParams({ question, language, speech });
      const res = await fetch(`/api/ai?${params.toString()}`);
      const data = await res.json();

      if (!res.ok) {
        // The model is local, so failures are almost always "Ollama isn't up".
        set(() => ({
          loading: false,
          error: { message: data.error || `Request failed (${res.status})`, hint: data.hint, code: data.code },
        }));
        get().checkOllama();
        return;
      }

      message.answer = data;
      message.speech = data.speech || speech;
      message.language = data.language || language;

      set((state) => ({
        currentMessage: message,
        messages: [...state.messages, message],
        loading: false,
        // Counted here rather than at the top of askAI: a question the teacher
        // never answered is a question the student did not get to ask.
        questionsAsked: state.questionsAsked + 1,
        lastMs: typeof data.ms === "number" ? data.ms : null,
        lastCached: Boolean(data.cached),
        lastSource: data.source || null,
        ollama: {
          ...state.ollama,
          checked: true,
          ok: true,
          // A phrasebook answer says nothing about which model is loaded.
          model: data.source === "phrasebook" ? state.ollama.model : data.model || state.ollama.model,
        },
      }));

      get().playMessage(message);
    } catch (error) {
      set(() => ({
        loading: false,
        error: { message: error.message, hint: "The dev server or /api/ai is unreachable." },
      }));
    }
  },

  playMessage: async (message) => {
    set(() => ({ currentMessage: message }));

    if (!speechSupported()) {
      set(() => ({ voiceWarning: "This browser has no speech synthesis — the teacher stays silent." }));
      return;
    }

    if (!message.audioPlayer) {
      set(() => ({ loading: true }));
      try {
        const { player, visemes, voiceName, missingVoice } = await createSpeechPlayer({
          words: message.answer.translation,
          languageCode: message.language || message.answer.language,
          gender: teacherGender[get().teacher] || "female",
        });

        message.visemes = visemes;
        message.audioPlayer = player;
        message.voiceName = voiceName;
        player.onended = () => set(() => ({ currentMessage: null }));

        const languageLabel = getLanguage(message.language).label;
        set(() => ({
          loading: false,
          voiceWarning: missingVoice
            ? `No ${languageLabel} voice installed — speaking with "${voiceName || "the default voice"}" instead.`
            : null,
          messages: get().messages.map((m) => (m.id === message.id ? message : m)),
        }));
      } catch (error) {
        set(() => ({ loading: false, voiceWarning: `Could not start the voice: ${error.message}` }));
        return;
      }
    }

    message.audioPlayer.currentTime = 0;
    message.audioPlayer.play();

    /*
     * Practice is a replay, not the first playback.
     *
     * askAI speaks every answer as soon as it arrives, so the first time this
     * runs for a message it is the teacher answering — which `questionsAsked`
     * has already counted. Every time after that is the student pressing play
     * on a phrase to hear it again, which is the thing worth counting. The flag
     * lives on the message rather than in state because it is per-message and
     * nothing renders from it.
     */
    if (message.played) {
      set((state) => ({ phrasesPractised: state.phrasesPractised + 1 }));
    } else {
      message.played = true;
    }
  },

  stopMessage: (message) => {
    message.audioPlayer?.pause?.();
    set(() => ({ currentMessage: null }));
  },
}));
