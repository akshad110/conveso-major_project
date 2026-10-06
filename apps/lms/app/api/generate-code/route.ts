import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getLanguage, languageFromFence } from "@/constants/languages";
import { extractCode } from "@/lib/codeFromText";

/**
 * Turns a question into code in the editor.
 *
 * This route replaces one that asked the model for "raw code, no markdown" and
 * then ran `.replace(/```[\s\S]*?```/g, "")` over the answer. Models fence code
 * whatever you tell them, so that line deleted the entire response and returned
 * an empty string — which is why the old editor so often came back blank. The
 * fix is to stop fighting the fence: ask for it explicitly, then read it.
 *
 * Asking for the fence buys something else too. The label on it says which
 * language the model actually wrote, so when a student asks a Python question
 * while the editor sits on C, the tab can follow the answer instead of
 * mislabelling it.
 */

/**
 * Tried in order, first one that answers wins.
 *
 * Google retires model ids on its own schedule and a hard-coded name is a
 * time bomb: this app was pinned to gemini-1.5-flash. Walking a list means an
 * id going away costs a few hundred milliseconds rather than the feature.
 */
const MODELS = [
  "gemini-2.0-flash",
  "gemini-1.5-flash",
  "gemini-1.5-flash-latest",
  "gemini-1.5-pro",
];

export async function POST(req: NextRequest) {
  let body: { prompt?: string; language?: string; topic?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Malformed request body." }, { status: 400 });
  }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    return NextResponse.json({ error: "Ask the companion something first." }, { status: 400 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Code generation is not configured: GEMINI_API_KEY is missing." },
      { status: 500 },
    );
  }

  const current = getLanguage(body.language);

  const instruction = `You are the code half of a voice tutor. A student is mid-session and just asked you this:

"${prompt}"
${body.topic ? `\nThe session topic is: ${body.topic}` : ""}

Their editor is currently set to ${current.label}. Answer in ${current.label} unless the question names a different language, in which case use the one they named.

Reply in exactly this shape and nothing else:

One or two sentences of plain explanation, written to be read aloud.

\`\`\`<language>
the complete program
\`\`\`

Rules for the code:
- It must compile and run as given. No "..." and no omitted sections.
- Write it as a whole file, including whatever entry point the language needs.
- Comment only where the reasoning is not obvious from the code.
- Prefer the clearest correct version over the cleverest one — this is being read by someone learning it.
- If the question is about a bug, give the corrected program in full, and say what was wrong in the sentences above it.`;

  const genAI = new GoogleGenerativeAI(apiKey);
  let lastError: unknown = null;

  for (const modelName of MODELS) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(instruction);
      const text = (await result.response).text().trim();
      if (!text) {
        lastError = new Error("empty response");
        continue;
      }

      const found = extractCode(text);

      // No fence came back. Rather than return nothing — the old failure mode —
      // treat the whole reply as the program, which is what the model was
      // probably trying to give us, and keep the student's current language.
      if (!found) {
        return NextResponse.json({
          code: text,
          language: current.id,
          explanation: "",
          model: modelName,
        });
      }

      const spec = found.spec ?? languageFromFence(current.id) ?? current;

      return NextResponse.json({
        code: found.code,
        language: spec.id,
        explanation: found.prose,
        model: modelName,
      });
    } catch (err) {
      lastError = err;
      // A 404 or 400 here means this id is gone or not enabled on the key, so
      // move down the list. Anything else is worth failing on, but the list is
      // short enough that trying the rest costs little either way.
    }
  }

  console.error("[generate-code] all models failed:", lastError);
  return NextResponse.json(
    { error: "The code assistant did not respond. Try asking again." },
    { status: 502 },
  );
}
