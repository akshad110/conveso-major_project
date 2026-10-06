import { languageFromFence, type LanguageSpec } from "@/constants/languages";

export interface ExtractedCode {
  code: string;
  /** The language the fence declared, if it declared one we recognise. */
  spec: LanguageSpec | null;
  /** Everything outside the fences — what the tutor said *about* the code. */
  prose: string;
}

const FENCE = /```([\w+#.-]*)[ \t]*\r?\n([\s\S]*?)```/g;

/**
 * Pull code out of something a language model wrote.
 *
 * This exists because the tutor talks and writes at the same time. Vapi streams
 * back the assistant's turn as plain text, and any code in it arrives as a
 * markdown fence in the middle of a sentence. The transcript should show the
 * sentence; the editor should receive the code. Splitting them is this
 * function's whole job.
 *
 * When several fences appear in one answer they are joined with a blank line
 * rather than only the first being taken — an answer that shows a struct and
 * then the function that uses it is one program, and dropping half of it would
 * leave the student with something that does not compile.
 *
 * Returns null when there is no fenced code, which is the common case: most of
 * what a tutor says is just talking, and the editor must not be disturbed by it.
 */
export function extractCode(text: string): ExtractedCode | null {
  if (!text || !text.includes("```")) return null;

  const blocks: { lang: string; body: string }[] = [];
  let prose = "";
  let cursor = 0;

  FENCE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FENCE.exec(text)) !== null) {
    prose += text.slice(cursor, match.index);
    cursor = match.index + match[0].length;
    const body = match[2].replace(/\s+$/, "");
    if (body.trim()) blocks.push({ lang: match[1] ?? "", body });
  }
  prose += text.slice(cursor);

  if (!blocks.length) return null;

  // The declared language comes from the first fence that names one. A trailing
  // ```bash block showing how to compile the thing should not retitle the tab.
  const named = blocks.find((b) => languageFromFence(b.lang));

  return {
    code: blocks.map((b) => b.body).join("\n\n"),
    spec: named ? languageFromFence(named.lang) : null,
    prose: prose.replace(/\n{3,}/g, "\n\n").trim(),
  };
}

/**
 * Strip fences out of a line before it is shown in the transcript.
 *
 * The transcript is a record of a conversation, and forty lines of C in a chat
 * bubble is not conversation — it is the editor's content pasted where nobody
 * will read it. The code has already been moved across by the time this runs,
 * so what is left behind is a short note saying where it went.
 */
export function speechOnly(text: string): string {
  const found = extractCode(text);
  if (!found) return text;
  const lines = found.code.split("\n").length;
  const note = `[wrote ${lines} line${lines === 1 ? "" : "s"} into the editor]`;
  return found.prose ? `${found.prose}\n\n${note}` : note;
}
