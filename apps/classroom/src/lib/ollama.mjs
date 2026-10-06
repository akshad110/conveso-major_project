/**
 * Ollama chat client — the same approach as the courtroom simulation engine:
 * zero dependencies, global `fetch` only, JSON mode, and a repair loop because a
 * local 8B model will occasionally hand back malformed JSON or prose.
 *
 * Nothing here knows about teachers or languages. It takes messages, returns a
 * validated JSON object, and throws typed errors the route can turn into advice.
 *
 * Env:
 *   OLLAMA_URL        default http://127.0.0.1:11434
 *   OLLAMA_MODEL      default llama3.1:8b   (falls back to whatever is installed)
 *   OLLAMA_TIMEOUT_MS default 120000        (cold model loads are slow)
 *   OLLAMA_NUM_CTX    default 4096          (must fit prompt + answer, see below)
 */

export const OLLAMA_URL = (process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/+$/, "");
export const PREFERRED_MODEL = process.env.OLLAMA_MODEL || "llama3.1:8b";
const TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS || 120000);

/**
 * Context window. This matters more than it looks: Ollama's default is small, and
 * when prompt + answer overflow it, llama.cpp silently drops the *oldest* tokens —
 * i.e. the system message holding the schema. The model then answers in whatever
 * shape it likes, validation rejects it, and all three attempts burn. 4096 leaves
 * room for the prompt (~1k) and the answer (~500) with margin.
 */
export const NUM_CTX = Number(process.env.OLLAMA_NUM_CTX || 4096);

/** Keep the weights resident between questions — reloading an 8B costs ~10-20s. */
const KEEP_ALIVE = process.env.OLLAMA_KEEP_ALIVE || "30m";

/** If the preferred model isn't installed, take the best of these that is. */
const FALLBACK_ORDER = [
  "llama3.1",
  "llama3.2",
  "llama3",
  "qwen2.5",
  "qwen2",
  "mistral",
  "gemma2",
  "gemma",
  "phi3",
];

export class OllamaError extends Error {
  constructor(code, message, { cause, hint } = {}) {
    super(message);
    this.name = "OllamaError";
    this.code = code;
    this.hint = hint;
    if (cause) this.cause = cause;
  }
}

async function request(path, { method = "GET", body, timeoutMs = TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`${OLLAMA_URL}${path}`, {
      method,
      signal: controller.signal,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new OllamaError(
        "OLLAMA_TIMEOUT",
        `Ollama did not answer within ${Math.round(timeoutMs / 1000)}s.`,
        { cause: error, hint: "A first request loads the model into memory — try again, or use a smaller model." }
      );
    }
    throw new OllamaError("OLLAMA_UNREACHABLE", `Cannot reach Ollama at ${OLLAMA_URL}.`, {
      cause: error,
      hint: "Start it with `ollama serve` (or open the Ollama app), then retry.",
    });
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  if (!res.ok) {
    const missingModel = res.status === 404 || /model .*not found|try pulling/i.test(text);
    throw new OllamaError(
      missingModel ? "MODEL_MISSING" : "OLLAMA_HTTP_ERROR",
      `Ollama responded ${res.status}: ${text.slice(0, 300)}`,
      { hint: missingModel ? `Run \`ollama pull ${PREFERRED_MODEL}\`.` : undefined }
    );
  }

  try {
    return text ? JSON.parse(text) : {};
  } catch (error) {
    throw new OllamaError("OLLAMA_BAD_RESPONSE", "Ollama returned a body that was not JSON.", {
      cause: error,
    });
  }
}

/* ------------------------------------------------------------------ models */

export async function listModels() {
  const data = await request("/api/tags", { timeoutMs: 5000 });
  return (data.models || []).map((model) => model.name).filter(Boolean);
}

let modelCache = { name: null, at: 0 };
const MODEL_CACHE_MS = 30000;

/** Resolve the model to use, preferring OLLAMA_MODEL, falling back to what's installed. */
export async function resolveModel(preferred = PREFERRED_MODEL) {
  const now = Date.now();
  if (modelCache.name && now - modelCache.at < MODEL_CACHE_MS) return modelCache.name;

  const installed = await listModels();
  if (!installed.length) {
    throw new OllamaError("NO_MODELS", "Ollama is running but has no models installed.", {
      hint: `Run \`ollama pull ${preferred}\`.`,
    });
  }

  const base = (name) => name.split(":")[0];
  let chosen =
    installed.find((name) => name === preferred) ||
    installed.find((name) => base(name) === base(preferred));

  if (!chosen) {
    for (const family of FALLBACK_ORDER) {
      chosen = installed.find((name) => base(name) === family || name.startsWith(`${family}:`));
      if (chosen) break;
    }
  }
  chosen = chosen || installed[0];

  modelCache = { name: chosen, at: now };
  return chosen;
}

export function clearModelCache() {
  modelCache = { name: null, at: 0 };
}

export async function health() {
  try {
    const models = await listModels();
    const model = models.length ? await resolveModel() : null;
    return { ok: models.length > 0, url: OLLAMA_URL, models, model };
  } catch (error) {
    return { ok: false, url: OLLAMA_URL, models: [], model: null, error: error.message, code: error.code };
  }
}

/**
 * Load the weights into memory without asking anything. Called when the page opens,
 * so the ~10-20s first-load cost is paid while the student is still typing instead
 * of being added to their first answer. Fire-and-forget: failure changes nothing.
 */
export async function preload(model) {
  try {
    const modelName = model || (await resolveModel());
    await request("/api/generate", {
      method: "POST",
      timeoutMs: Math.min(TIMEOUT_MS, 60000),
      body: { model: modelName, prompt: "", keep_alive: KEEP_ALIVE, options: { num_ctx: NUM_CTX } },
    });
    return { ok: true, model: modelName };
  } catch (error) {
    return { ok: false, error: error.message, code: error.code };
  }
}

/**
 * Run the real prompt through the model once, asking for a single token.
 *
 * Loading the weights is only half the cold cost; the other half is reading the
 * ~1k-token system prompt before the first word of the answer can appear. Ollama
 * caches the KV state of a shared prefix, so paying for that prefix once at page
 * open makes every later question with the same system message start sooner.
 *
 * Fire-and-forget, like `preload` — a failure here only costs the speed-up.
 */
export async function prefill({ messages, model }) {
  try {
    const modelName = model || (await resolveModel());
    await request("/api/chat", {
      method: "POST",
      timeoutMs: Math.min(TIMEOUT_MS, 60000),
      body: {
        model: modelName,
        messages,
        stream: false,
        keep_alive: KEEP_ALIVE,
        options: { num_predict: 1, num_ctx: NUM_CTX, temperature: 0 },
      },
    });
    return { ok: true, model: modelName };
  } catch (error) {
    return { ok: false, error: error.message, code: error.code };
  }
}

/* -------------------------------------------------------------- JSON rescue */

/** Pull the first balanced JSON object out of a model reply. */
export function extractJSON(text) {
  if (typeof text !== "string") return null;
  const withoutFence = text.replace(/```(?:json)?/gi, "");
  const start = withoutFence.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < withoutFence.length; i++) {
    const char = withoutFence[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth++;
    else if (char === "}") {
      depth--;
      if (depth === 0) {
        const slice = withoutFence.slice(start, i + 1);
        try {
          return JSON.parse(slice);
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/* -------------------------------------------------------------------- chat */

/**
 * Ask the model for JSON and keep asking until `validate` is happy.
 *
 * @param {object}   opts
 * @param {Array}    opts.messages   chat messages
 * @param {Function} opts.validate   (parsed) => { ok, value, errors }
 * @param {number}   opts.attempts   default 3
 * @returns {Promise<{ value: any, model: string, attempts: number, warnings: string[] }>}
 */
export async function chatJSON({
  messages,
  model,
  validate,
  attempts = 3,
  temperature = 0.2,
  maxTokens = 700,
  timeoutMs = TIMEOUT_MS,
} = {}) {
  const modelName = model || (await resolveModel());
  const conversation = [...messages];
  const problems = [];
  const timings = [];

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const startedAt = Date.now();
    const data = await request("/api/chat", {
      method: "POST",
      timeoutMs,
      body: {
        model: modelName,
        messages: conversation,
        stream: false,
        format: "json",
        keep_alive: KEEP_ALIVE,
        options: {
          temperature: attempt === 1 ? temperature : Math.min(0.8, temperature + 0.2 * attempt),
          num_predict: maxTokens,
          num_ctx: NUM_CTX,
          top_p: 0.9,
        },
      },
    });
    timings.push(Date.now() - startedAt);

    const content = data?.message?.content ?? "";
    const parsed = extractJSON(content);

    if (parsed === null) {
      problems.push(`attempt ${attempt}: reply was not JSON`);
      conversation.push(
        { role: "assistant", content: String(content).slice(0, 2000) },
        {
          role: "user",
          content:
            "That was not valid JSON. Reply again with the JSON object only — no prose, no markdown fence.",
        }
      );
      continue;
    }

    const result = validate ? validate(parsed) : { ok: true, value: parsed, errors: [] };
    if (result.ok) {
      return {
        value: result.value ?? parsed,
        model: modelName,
        attempts: attempt,
        timings,
        warnings: [...problems, ...(result.errors || [])],
      };
    }

    problems.push(`attempt ${attempt}: ${(result.errors || ["invalid"]).join("; ")}`);
    conversation.push(
      { role: "assistant", content: JSON.stringify(parsed).slice(0, 2000) },
      {
        role: "user",
        content: `That JSON was rejected: ${(result.errors || []).join("; ")}. Fix exactly those problems and reply with the corrected JSON object only.`,
      }
    );
  }

  throw new OllamaError(
    "MODEL_OUTPUT_INVALID",
    `${modelName} could not produce a usable answer in ${attempts} attempts. ${problems.join(" | ")}`,
    { hint: "Try a stronger model, e.g. `ollama pull qwen2.5:7b` then set OLLAMA_MODEL=qwen2.5:7b." }
  );
}
