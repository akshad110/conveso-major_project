import { getLanguage } from "@/lib/languages.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Speech used to be synthesised here through Azure Cognitive Services, which
 * needed a subscription key and an internet connection. The teacher now speaks
 * through the browser's own SpeechSynthesis voices (see src/lib/speech.js), so
 * there is nothing left to do on the server and the whole app runs offline.
 *
 * This endpoint stays as a discoverable answer to "where did TTS go?", and it
 * reports the voice locale the client should ask for.
 *
 * GET /api/tts?language=ko
 */
export async function GET(req) {
  const language = getLanguage(req.nextUrl.searchParams.get("language"));
  return Response.json(
    {
      mode: "browser",
      message:
        "Text-to-speech runs in the browser (window.speechSynthesis) — no key and no network needed.",
      voiceLocale: language.voice.locale,
      preferredVoices: language.voice,
    },
    { status: 410 }
  );
}
