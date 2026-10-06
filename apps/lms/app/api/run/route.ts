import { NextResponse } from "next/server";
import { getLanguage } from "@/constants/languages";

/**
 * Runs the editor's code for real.
 *
 * Execution happens on Piston, a public sandboxed runner: each request gets a
 * throwaway container with no network and a hard CPU and memory ceiling, which
 * is the only reason it is safe to hand it whatever a student types. The
 * previous editors in this codebase ran JavaScript through eval() in the
 * browser — that could only ever run one language, and it ran it with the
 * user's own session sitting in the same scope.
 *
 * Two details are worth knowing before changing anything here:
 *
 * 1. Piston needs an exact version string, not "latest". Versions move when the
 *    upstream image is rebuilt, so nothing is pinned in this file. The runtime
 *    list is fetched once, cached for ten minutes, and searched by language
 *    name *and* by alias, which is how "cpp" finds the runtime that calls
 *    itself "c++" and "sql" finds "sqlite3".
 *
 * 2. A program that fails to compile is not a failed request. Piston answers
 *    200 with the compiler's complaint in `compile.stderr`, and that complaint
 *    is the single most useful thing a learner can be shown, so it is passed
 *    through as output rather than thrown away as an error.
 */

const PISTON = "https://emkc.org/api/v2/piston";
const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CODE_BYTES = 200_000;

interface Runtime {
  language: string;
  version: string;
  aliases?: string[];
}

let runtimeCache: { at: number; runtimes: Runtime[] } | null = null;

async function getRuntimes(): Promise<Runtime[]> {
  if (runtimeCache && Date.now() - runtimeCache.at < CACHE_TTL_MS) {
    return runtimeCache.runtimes;
  }
  const res = await fetch(`${PISTON}/runtimes`, { cache: "no-store" });
  if (!res.ok) throw new Error(`runtime list unavailable (${res.status})`);
  const runtimes = (await res.json()) as Runtime[];
  runtimeCache = { at: Date.now(), runtimes };
  return runtimes;
}

/**
 * Find the runtime that answers to `key`.
 *
 * Preference order matters: an exact language-name match beats an alias match,
 * because several runtimes list the same alias. "python" is the name of the
 * Python 3 runtime and also an alias on the Python 2 one, and picking the alias
 * would quietly run everybody's code on Python 2.
 */
function resolveRuntime(runtimes: Runtime[], key: string): Runtime | null {
  const want = key.toLowerCase();
  const exact = runtimes.find((r) => r.language.toLowerCase() === want);
  if (exact) return exact;
  return (
    runtimes.find((r) => r.aliases?.some((a) => a.toLowerCase() === want)) ?? null
  );
}

/** Java's compiler insists the public class and the file share a name. */
function fileNameFor(langId: string, ext: string) {
  if (langId === "java") return "Main.java";
  return `main.${ext}`;
}

export async function POST(req: Request) {
  let body: { language?: string; code?: string; stdin?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Malformed request body." }, { status: 400 });
  }

  const code = typeof body.code === "string" ? body.code : "";
  const stdin = typeof body.stdin === "string" ? body.stdin : "";

  if (!code.trim()) {
    return NextResponse.json({ error: "There is nothing in the editor to run." }, { status: 400 });
  }
  if (code.length > MAX_CODE_BYTES) {
    return NextResponse.json(
      { error: "That file is too large to run here. Keep it under 200 KB." },
      { status: 413 },
    );
  }

  const spec = getLanguage(body.language);

  if (!spec.piston) {
    return NextResponse.json(
      {
        error:
          spec.id === "html"
            ? "HTML renders in the preview pane — it does not go through the runner."
            : `${spec.label} is an editor-only language here. There is nothing to execute.`,
      },
      { status: 400 },
    );
  }

  const started = Date.now();

  try {
    const runtimes = await getRuntimes();

    // Try the mapped name first, then the app's own id, then the Monaco
    // grammar id. Piston occasionally renames a runtime between image builds,
    // and a language that still has a working runtime under a different name
    // should degrade to running rather than to a 502.
    let runtime: Runtime | null = null;
    for (const key of [spec.piston, spec.id, spec.monaco]) {
      if (!key) continue;
      runtime = resolveRuntime(runtimes, key);
      if (runtime) break;
    }

    if (!runtime) {
      return NextResponse.json(
        { error: `The runner has no ${spec.label} runtime available right now.` },
        { status: 502 },
      );
    }

    const execute = () =>
      fetch(`${PISTON}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          language: runtime.language,
          version: runtime.version,
          files: [{ name: fileNameFor(spec.id, spec.ext), content: code }],
          stdin,
          compile_timeout: 10_000,
          run_timeout: 8_000,
        }),
      });

    let res = await execute();

    // Piston allows about five calls a second across everyone using it, so a
    // classroom hitting Run together will occasionally collide. One patient
    // retry turns that into a slightly slow run instead of an error.
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 1200));
      res = await execute();
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return NextResponse.json(
        {
          error:
            res.status === 429
              ? "The shared runner is busy. Give it a few seconds and run again."
              : `The runner refused the job (${res.status}).`,
          detail: detail.slice(0, 500),
        },
        { status: 502 },
      );
    }

    const data = await res.json();
    const compile = data.compile ?? null;
    const run = data.run ?? {};

    // A compile error means the program never ran, so report the compiler's
    // words and its exit code rather than the run stage's empty success.
    const compileFailed = compile && typeof compile.code === "number" && compile.code !== 0;

    return NextResponse.json({
      ok: !compileFailed && run.code === 0,
      stage: compileFailed ? "compile" : "run",
      stdout: compileFailed ? "" : (run.stdout ?? ""),
      stderr: compileFailed ? (compile.stderr || compile.output || "") : (run.stderr ?? ""),
      exitCode: compileFailed ? compile.code : (run.code ?? null),
      signal: run.signal ?? null,
      language: spec.id,
      label: spec.label,
      version: runtime.version,
      ms: Date.now() - started,
    });
  } catch (err) {
    console.error("[run]", err);
    return NextResponse.json(
      {
        error:
          "Could not reach the code runner. Check the connection and try again.",
      },
      { status: 502 },
    );
  }
}

/** Lets the workspace show which languages are genuinely live before you hit Run. */
export async function GET() {
  try {
    const runtimes = await getRuntimes();
    return NextResponse.json({
      count: runtimes.length,
      runtimes: runtimes.map((r) => ({
        language: r.language,
        version: r.version,
        aliases: r.aliases ?? [],
      })),
    });
  } catch {
    return NextResponse.json({ error: "Runner unreachable." }, { status: 502 });
  }
}
