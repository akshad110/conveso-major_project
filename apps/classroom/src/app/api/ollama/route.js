import { DEFAULT_LANGUAGE, getLanguage, isLanguage, speechModeIds } from "@/lib/languages.mjs";
import { buildMessages } from "@/lib/answerSchema.mjs";
import { health, preload, prefill, PREFERRED_MODEL } from "@/lib/ollama.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Warm each model + language + register once per server process, not on every poll. */
const warmed = new Set();

/**
 * Is the local model up? The board polls this on load so it can say
 * "start `ollama serve`" instead of failing on the first question.
 *
 * It also warms the model for the language being studied, in two steps: load the
 * weights (~10-20s for an 8B, once), then push the real system prompt through it
 * for a single token so Ollama caches that prefix. Both used to be charged to the
 * student's first question; now they happen while the classroom is fading in.
 * Fire-and-forget — the response never waits for them.
 *
 * GET /api/ollama[?language=hi&speech=formal]
 */
export async function GET(req) {
  const params = req.nextUrl.searchParams;
  const requested = params.get("language") || DEFAULT_LANGUAGE;
  const languageCode = isLanguage(requested) ? requested : DEFAULT_LANGUAGE;
  const modes = speechModeIds(languageCode);
  const requestedSpeech = params.get("speech") || modes[0];
  const speechId = modes.includes(requestedSpeech) ? requestedSpeech : modes[0];

  const status = await health();
  const key = `${status.model}|${languageCode}|${speechId}`;

  if (status.ok && !warmed.has(key)) {
    warmed.add(key);
    const first = warmed.size === 1;
    (async () => {
      if (first) {
        const loaded = await preload(status.model);
        console.log(`[ollama] preload ${status.model}: ${loaded.ok ? "resident" : loaded.error}`);
        if (!loaded.ok) {
          warmed.delete(key);
          return;
        }
      }
      const messages = buildMessages({
        languageCode,
        speechId,
        question: getLanguage(languageCode).sample,
      });
      const result = await prefill({ messages, model: status.model });
      if (!result.ok) warmed.delete(key);
      console.log(`[ollama] prefill ${languageCode}/${speechId}: ${result.ok ? "cached" : result.error}`);
    })();
  }

  return Response.json(
    { ...status, preferredModel: PREFERRED_MODEL, warming: warmed.has(key) },
    { status: status.ok ? 200 : 503 }
  );
}
