import {
  DEFAULT_LANGUAGE,
  getLanguage,
  isLanguage,
  speechModeIds,
} from "@/lib/languages.mjs";
import { buildMessages, normalizeAnswer } from "@/lib/answerSchema.mjs";
import { cacheKey, getCached, setCached } from "@/lib/answerCache.mjs";
import { lookupPhrase } from "@/lib/phrasebook.mjs";
import { chatJSON, OLLAMA_URL, OllamaError, PREFERRED_MODEL } from "@/lib/ollama.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The teacher's brain. Runs entirely on the machine: Ollama on 127.0.0.1, no API
 * key, no network. Ask it anything in English and it comes back translated into
 * the chosen language with a grammar breakdown.
 *
 * GET /api/ai?question=...&language=hi&speech=casual[&model=qwen2.5:7b][&fresh=1]
 */
export async function GET(req) {
  const params = req.nextUrl.searchParams;

  const requestedLanguage = params.get("language") || DEFAULT_LANGUAGE;
  const languageCode = isLanguage(requestedLanguage) ? requestedLanguage : DEFAULT_LANGUAGE;
  const language = getLanguage(languageCode);

  const modes = speechModeIds(languageCode);
  const requestedSpeech = params.get("speech") || modes[0];
  const speechId = modes.includes(requestedSpeech) ? requestedSpeech : modes[0];

  const question = (params.get("question") || language.sample).slice(0, 500);
  const model = params.get("model") || undefined;

  const startedAt = Date.now();
  const key = cacheKey({ languageCode, speechId, question });

  if (!params.get("fresh")) {
    const hit = getCached(key);
    if (hit) return Response.json({ ...hit, cached: true, ms: Date.now() - startedAt });
  }

  // Greetings, thank-yous and introductions are written out by hand: no inference,
  // no wait, and no chance of the model inventing आप कैसे हो.
  const canned = lookupPhrase({ languageCode, speechId, question });
  if (canned) {
    const result = normalizeAnswer(canned, { languageCode, speechId, question: canned.english });
    if (result.ok) {
      console.log(`[ai] ${languageCode}/${speechId} "${question}" → phrasebook in ${Date.now() - startedAt}ms`);
      return Response.json({
        ...result.value,
        question,
        model: "phrasebook",
        source: "phrasebook",
        attempts: 0,
        warnings: result.errors,
        cached: false,
        ms: Date.now() - startedAt,
      });
    }
    console.warn(`[ai] phrasebook entry for "${question}" failed validation:`, result.errors.join("; "));
  }

  try {
    const result = await chatJSON({
      model,
      messages: buildMessages({ languageCode, speechId, question }),
      validate: (parsed) => normalizeAnswer(parsed, { languageCode, speechId, question }),
    });

    if (result.warnings.length) {
      console.warn(`[ai] ${languageCode}/${speechId} warnings:`, result.warnings.join(" | "));
    }
    console.log(
      `[ai] ${languageCode}/${speechId} "${question}" → ${result.model} in ${Date.now() - startedAt}ms (${result.attempts} attempt(s): ${result.timings.join("ms, ")}ms)`
    );

    const payload = {
      ...result.value,
      question,
      model: result.model,
      source: "ollama",
      attempts: result.attempts,
      warnings: result.warnings,
    };
    setCached(key, payload);

    return Response.json({ ...payload, cached: false, ms: Date.now() - startedAt });
  } catch (error) {
    const isOllama = error instanceof OllamaError;
    const code = isOllama ? error.code : "UNKNOWN";
    const status = code === "OLLAMA_UNREACHABLE" || code === "NO_MODELS" || code === "MODEL_MISSING" ? 503 : 500;

    console.error(`[ai] ${code}: ${error.message}`);

    return Response.json(
      {
        error: error.message,
        code,
        hint: isOllama ? error.hint : undefined,
        ollamaUrl: OLLAMA_URL,
        expectedModel: model || PREFERRED_MODEL,
      },
      { status }
    );
  }
}
