"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import Editor, { type Monaco, type OnMount } from "@monaco-editor/react";
import {
  ChevronDown,
  Copy,
  CornerDownLeft,
  Download,
  Eraser,
  Play,
  Square,
  Terminal,
} from "lucide-react";
import LanguagePicker from "./LanguagePicker";
import {
  DEFAULT_LANGUAGE,
  getLanguage,
  type LanguageSpec,
} from "@/constants/languages";

/**
 * The code half of a coding session.
 *
 * Two things write into this editor: the student, and the companion. That is
 * the whole design constraint. When the companion answers a question with code
 * it lands here as a real document — selectable, editable, runnable — instead
 * of as text in a chat bubble the student has to retype. And when the student
 * edits what arrived, their version is what runs.
 *
 * Running is real. The code goes to a sandboxed container that compiles and
 * executes it and sends back stdout, stderr and an exit code. Nothing is
 * simulated and nothing is eval'd in the page.
 */

export interface CodeWorkspaceHandle {
  /** Put code in the editor. Called when the companion answers with a program. */
  applyCode: (code: string, languageId?: string | null) => void;
  getCode: () => string;
  getLanguageId: () => string;
}

interface Props {
  companionId: string;
  /** Shown in the tab, so the file is named after what is being learned. */
  topic?: string;
  onLanguageChange?: (spec: LanguageSpec) => void;
}

interface RunResult {
  ok: boolean;
  stage: "compile" | "run";
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  label: string;
  version: string;
  ms: number;
}

const THEME = "night-desk";

function defineTheme(monaco: Monaco) {
  monaco.editor.defineTheme(THEME, {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "", foreground: "ece9f2" },
      { token: "comment", foreground: "6b667a", fontStyle: "italic" },
      { token: "keyword", foreground: "ff8a66" },
      { token: "keyword.control", foreground: "ff8a66" },
      { token: "string", foreground: "4fe0a5" },
      { token: "string.escape", foreground: "ffc53d" },
      { token: "number", foreground: "ffc53d" },
      { token: "constant", foreground: "ffc53d" },
      { token: "regexp", foreground: "4fe0a5" },
      { token: "type", foreground: "56c9ff" },
      { token: "type.identifier", foreground: "56c9ff" },
      { token: "namespace", foreground: "56c9ff" },
      { token: "function", foreground: "b18cff" },
      { token: "identifier", foreground: "ece9f2" },
      { token: "operator", foreground: "9d98ac" },
      { token: "delimiter", foreground: "9d98ac" },
      { token: "tag", foreground: "ff6fb5" },
      { token: "attribute.name", foreground: "ffc53d" },
      { token: "attribute.value", foreground: "4fe0a5" },
      { token: "metatag", foreground: "6b667a" },
      { token: "annotation", foreground: "b18cff" },
      { token: "predefined", foreground: "56c9ff" },
      { token: "invalid", foreground: "ff5470" },
    ],
    colors: {
      "editor.background": "#0E0D13",
      "editor.foreground": "#ECE9F2",
      "editorLineNumber.foreground": "#433E52",
      "editorLineNumber.activeForeground": "#9D98AC",
      "editorCursor.foreground": "#FF5A33",
      "editor.selectionBackground": "#2C2740",
      "editor.inactiveSelectionBackground": "#1E1B28",
      "editor.lineHighlightBackground": "#141220",
      "editor.lineHighlightBorder": "#00000000",
      "editorGutter.background": "#0E0D13",
      "editorIndentGuide.background": "#1C1926",
      "editorIndentGuide.activeBackground": "#332E45",
      "editorWhitespace.foreground": "#241F30",
      "editorBracketMatch.background": "#2C2740",
      "editorBracketMatch.border": "#56506F",
      "editorWidget.background": "#131118",
      "editorWidget.border": "#262331",
      "editorSuggestWidget.background": "#131118",
      "editorSuggestWidget.border": "#262331",
      "editorSuggestWidget.selectedBackground": "#1F1C2A",
      "editorHoverWidget.background": "#131118",
      "editorHoverWidget.border": "#262331",
      "editorError.foreground": "#FF5470",
      "editorWarning.foreground": "#FFC53D",
      "scrollbarSlider.background": "#26233188",
      "scrollbarSlider.hoverBackground": "#3B3650AA",
      "scrollbarSlider.activeBackground": "#56506FAA",
      "minimap.background": "#0E0D13",
    },
  });
}

const draftKey = (companionId: string, langId: string) =>
  `converso:draft:${companionId}:${langId}`;

const CodeWorkspace = forwardRef<CodeWorkspaceHandle, Props>(function CodeWorkspace(
  { companionId, topic, onLanguageChange },
  ref,
) {
  const [lang, setLang] = useState<LanguageSpec>(getLanguage(DEFAULT_LANGUAGE));
  const [code, setCode] = useState<string>(getLanguage(DEFAULT_LANGUAGE).starter);
  const [stdin, setStdin] = useState("");
  const [picking, setPicking] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<"output" | "input">("output");
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  const [justReceived, setJustReceived] = useState(false);

  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Refs shadow the state so the Cmd-Enter command, which Monaco binds exactly
  // once on mount, always reads the current code rather than the code that
  // happened to exist at mount.
  const codeRef = useRef(code);
  const langRef = useRef(lang);
  const stdinRef = useRef(stdin);
  codeRef.current = code;
  langRef.current = lang;
  stdinRef.current = stdin;

  // -- restore the draft -----------------------------------------------------
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(draftKey(companionId, lang.id));
      if (saved) setCode(saved);
    } catch {
      /* private browsing, or storage full — the starter snippet is fine */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companionId, lang.id]);

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        window.localStorage.setItem(draftKey(companionId, lang.id), code);
      } catch {
        /* ignore */
      }
    }, 600);
    return () => clearTimeout(t);
  }, [code, companionId, lang.id]);

  // -- running ---------------------------------------------------------------
  const run = useCallback(async () => {
    const spec = langRef.current;
    const source = codeRef.current;

    setRunError(null);

    if (spec.id === "html") {
      setPreview(source);
      setDrawerOpen(true);
      return;
    }
    if (!spec.piston) {
      setRunError(`${spec.label} is an editor-only language here.`);
      setDrawer("output");
      setDrawerOpen(true);
      return;
    }
    if (!source.trim()) {
      setRunError("There is nothing in the editor to run.");
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setRunning(true);
    setResult(null);
    setDrawer("output");
    setDrawerOpen(true);

    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          language: spec.id,
          code: source,
          stdin: stdinRef.current,
        }),
        signal: controller.signal,
      });
      const data = await res.json();
      if (!res.ok) setRunError(data.error ?? "The run failed.");
      else setResult(data as RunResult);
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setRunError("Could not reach the runner.");
      }
    } finally {
      setRunning(false);
    }
  }, []);

  const stop = () => {
    abortRef.current?.abort();
    setRunning(false);
  };

  // -- the companion writing in ----------------------------------------------
  useImperativeHandle(ref, () => ({
    applyCode(incoming: string, languageId?: string | null) {
      if (!incoming?.trim()) return;

      if (languageId && languageId !== langRef.current.id) {
        const next = getLanguage(languageId);
        setLang(next);
        langRef.current = next;
        onLanguageChange?.(next);
      }

      setCode(incoming);
      setResult(null);
      setRunError(null);

      // Land the cursor at the top of what just arrived and flash the frame, so
      // a student who was looking at the transcript can see that the document
      // beside it changed underneath them.
      requestAnimationFrame(() => {
        editorRef.current?.setPosition({ lineNumber: 1, column: 1 });
        editorRef.current?.revealLine(1);
      });
      setJustReceived(true);
      setTimeout(() => setJustReceived(false), 1400);
    },
    getCode: () => codeRef.current,
    getLanguageId: () => langRef.current.id,
  }));

  const chooseLanguage = (spec: LanguageSpec) => {
    setPicking(false);
    if (spec.id === lang.id) return;
    setLang(spec);
    langRef.current = spec;
    setResult(null);
    setRunError(null);
    setPreview(null);
    onLanguageChange?.(spec);

    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(draftKey(companionId, spec.id));
    } catch {
      /* ignore */
    }
    setCode(saved ?? spec.starter);
  };

  const onMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      void run();
    });
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked; the download button still works */
    }
  };

  const download = () => {
    const blob = new Blob([code], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(topic || "session").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "main"}.${lang.ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const fileName = `main.${lang.ext}`;

  return (
    <div
      className="panel flex h-full min-h-0 flex-col overflow-hidden p-0 transition-shadow duration-500"
      style={justReceived ? { boxShadow: "0 0 0 1px var(--flame), 0 0 40px -12px var(--flame)" } : undefined}
    >
      {/* toolbar */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--edge)] px-3 py-2.5">
        <span className="chip">{fileName}</span>

        <button
          onClick={() => setPicking(true)}
          className="tool flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-[var(--ink)]"
        >
          {lang.label}
          <ChevronDown size={13} className="text-[var(--ink-faint)]" />
        </button>

        <div className="ml-auto flex items-center gap-1.5">
          <button onClick={copy} className="btn-icon" title="Copy" aria-label="Copy code">
            <Copy size={14} />
          </button>
          <button onClick={download} className="btn-icon" title="Download" aria-label="Download file">
            <Download size={14} />
          </button>
          <button
            onClick={() => {
              setCode(lang.starter);
              setResult(null);
              setRunError(null);
              setPreview(null);
            }}
            className="btn-icon"
            title="Reset to starter"
            aria-label="Reset to starter"
          >
            <Eraser size={14} />
          </button>

          {running ? (
            <button onClick={stop} className="btn btn-sm btn-ghost">
              <Square size={12} /> Stop
            </button>
          ) : (
            <button onClick={run} className="btn btn-sm btn-flame">
              <Play size={12} />
              {lang.id === "html" ? "Preview" : "Run"}
            </button>
          )}
        </div>
      </div>

      {copied && (
        <p className="meta shrink-0 border-b border-[var(--edge)] px-3 py-1.5 text-[var(--good)]">
          copied
        </p>
      )}

      {/* editor */}
      <div className="relative min-h-0 flex-1">
        <Editor
          height="100%"
          theme={THEME}
          language={lang.monaco}
          value={code}
          onChange={(v) => setCode(v ?? "")}
          beforeMount={defineTheme}
          onMount={onMount}
          loading={
            <span className="meta text-[var(--ink-faint)]">loading editor…</span>
          }
          options={{
            fontSize: 13.5,
            fontFamily:
              "var(--font-jetbrains), ui-monospace, SFMono-Regular, Menlo, monospace",
            fontLigatures: true,
            lineHeight: 1.7,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            smoothScrolling: true,
            cursorBlinking: "smooth",
            cursorSmoothCaretAnimation: "on",
            renderLineHighlight: "line",
            padding: { top: 16, bottom: 16 },
            automaticLayout: true,
            tabSize: 4,
            wordWrap: "on",
            bracketPairColorization: { enabled: false },
            scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
            overviewRulerBorder: false,
            hideCursorInOverviewRuler: true,
            guides: { indentation: true },
            suggestFontSize: 12,
          }}
        />
      </div>

      {/* drawer */}
      <div className="shrink-0 border-t border-[var(--edge)] bg-[var(--panel-sunk)]">
        <div className="flex items-center gap-1 px-2 py-1.5">
          <button
            onClick={() => {
              setDrawer("output");
              setDrawerOpen(true);
            }}
            className={`tool px-2.5 py-1 text-xs ${
              drawer === "output" && drawerOpen
                ? "text-[var(--ink)]"
                : "border-transparent bg-transparent text-[var(--ink-faint)]"
            }`}
          >
            <Terminal size={12} className="mr-1.5 inline" />
            {lang.id === "html" ? "Preview" : "Output"}
          </button>

          {lang.id !== "html" && (
            <button
              onClick={() => {
                setDrawer("input");
                setDrawerOpen(true);
              }}
              className={`tool px-2.5 py-1 text-xs ${
                drawer === "input" && drawerOpen
                  ? "text-[var(--ink)]"
                  : "border-transparent bg-transparent text-[var(--ink-faint)]"
              }`}
            >
              <CornerDownLeft size={12} className="mr-1.5 inline" />
              Input
              {stdin.trim() && <span className="ml-1.5 text-[var(--flame)]">•</span>}
            </button>
          )}

          <div className="ml-auto flex items-center gap-3 pr-1">
            {result && (
              <span className="meta">
                <span
                  className={
                    result.ok ? "text-[var(--good)]" : "text-[var(--bad)]"
                  }
                >
                  exit {result.exitCode ?? "—"}
                </span>
                <span className="mx-2 text-[var(--edge-hot)]">/</span>
                {result.label} {result.version}
                <span className="mx-2 text-[var(--edge-hot)]">/</span>
                {result.ms} ms
              </span>
            )}
            <button
              onClick={() => setDrawerOpen((o) => !o)}
              className="btn-icon"
              aria-label={drawerOpen ? "Collapse panel" : "Expand panel"}
            >
              <ChevronDown
                size={14}
                className={`transition-transform ${drawerOpen ? "" : "rotate-180"}`}
              />
            </button>
          </div>
        </div>

        {drawerOpen && (
          <div className="h-[clamp(7rem,22vh,14rem)] overflow-auto border-t border-[var(--edge)]">
            {drawer === "input" ? (
              <textarea
                value={stdin}
                onChange={(e) => setStdin(e.target.value)}
                placeholder="Anything the program reads from standard input. One value per line."
                spellCheck={false}
                className="h-full w-full resize-none bg-transparent p-3 font-mono text-xs leading-relaxed text-[var(--ink)] outline-none placeholder:text-[var(--ink-faint)]"
              />
            ) : lang.id === "html" ? (
              preview ? (
                <iframe
                  title="Preview"
                  srcDoc={preview}
                  sandbox="allow-scripts allow-modals"
                  className="h-full w-full bg-white"
                />
              ) : (
                <p className="p-3 text-xs text-[var(--ink-faint)]">
                  Press Preview to render the page.
                </p>
              )
            ) : (
              <pre className="whitespace-pre-wrap p-3 font-mono text-xs leading-relaxed">
                {runError && <span className="text-[var(--bad)]">{runError}</span>}
                {running && !runError && (
                  <span className="text-[var(--ink-dim)]">running…</span>
                )}
                {!running && !runError && !result && (
                  <span className="text-[var(--ink-faint)]">
                    Press Run, or {navigatorHint()}, to execute this file.
                  </span>
                )}
                {result && (
                  <>
                    {result.stage === "compile" && (
                      <span className="text-[var(--warn)]">
                        {result.label} did not compile.{"\n\n"}
                      </span>
                    )}
                    {result.stdout && (
                      <span className="text-[var(--ink)]">{result.stdout}</span>
                    )}
                    {result.stderr && (
                      <span className="text-[var(--bad)]">{result.stderr}</span>
                    )}
                    {!result.stdout && !result.stderr && (
                      <span className="text-[var(--ink-faint)]">
                        Ran clean, printed nothing.
                      </span>
                    )}
                    {result.signal && (
                      <span className="text-[var(--warn)]">
                        {"\n"}killed by {result.signal}
                        {result.signal === "SIGKILL"
                          ? " — it ran past the time limit, so check for a loop that never ends."
                          : ""}
                      </span>
                    )}
                  </>
                )}
              </pre>
            )}
          </div>
        )}
      </div>

      {picking && (
        <LanguagePicker
          value={lang.id}
          onSelect={chooseLanguage}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
});

/** Shows the shortcut in the modifier the reader's own keyboard actually has. */
function navigatorHint() {
  if (typeof navigator === "undefined") return "Ctrl+Enter";
  return /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘↵" : "Ctrl+Enter";
}

export default CodeWorkspace;
