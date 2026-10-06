/**
 * Every language the editor offers, in one table.
 *
 * Three identifiers are kept apart on purpose because they genuinely differ:
 *
 *   id      what this app calls the language, and what ends up in the URL and
 *           in component state. Ours to choose, so it is the readable one.
 *   monaco  the highlighter's name for it. Monaco does not ship a grammar for
 *           every language here; anything it does not know is set to
 *           "plaintext" rather than to something that looks close, because a
 *           wrong grammar is worse than none.
 *   piston  the runner's name for it, or null if the language is not something
 *           you execute. These are frequently not the obvious word — C++ is
 *           "c++", R is "rscript", Pascal is "freepascal" — and the run route
 *           resolves them against the runner's live alias list rather than
 *           against a version number pinned here, so nothing rots when the
 *           runner upgrades.
 */
export interface LanguageSpec {
  id: string;
  label: string;
  monaco: string;
  piston: string | null;
  ext: string;
  group: string;
  /** Short line under the name in the picker. Says what it is actually for. */
  note?: string;
  starter: string;
}

export const LANGUAGE_GROUPS = [
  "Popular",
  "Systems",
  "JVM & .NET",
  "Scripting",
  "Functional",
  "Data & markup",
  "Classic",
] as const;

export const LANGUAGES: LanguageSpec[] = [
  // --- Popular --------------------------------------------------------------
  {
    id: "python",
    label: "Python",
    monaco: "python",
    piston: "python",
    ext: "py",
    group: "Popular",
    note: "Default. Good for everything.",
    starter: 'def main():\n    print("Hello from Python")\n\n\nmain()\n',
  },
  {
    id: "c",
    label: "C",
    monaco: "c",
    piston: "c",
    ext: "c",
    group: "Popular",
    note: "Where the semester usually starts.",
    starter:
      '#include <stdio.h>\n\nint main(void) {\n    printf("Hello from C\\n");\n    return 0;\n}\n',
  },
  {
    id: "cpp",
    label: "C++",
    monaco: "cpp",
    piston: "c++",
    ext: "cpp",
    group: "Popular",
    note: "STL, templates, competitive programming.",
    starter:
      '#include <iostream>\n\nint main() {\n    std::cout << "Hello from C++" << std::endl;\n    return 0;\n}\n',
  },
  {
    id: "java",
    label: "Java",
    monaco: "java",
    piston: "java",
    ext: "java",
    group: "Popular",
    note: "Class name must be Main.",
    starter:
      'public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello from Java");\n    }\n}\n',
  },
  {
    id: "javascript",
    label: "JavaScript",
    monaco: "javascript",
    piston: "javascript",
    ext: "js",
    group: "Popular",
    note: "Runs on Node.",
    starter: 'console.log("Hello from JavaScript");\n',
  },
  {
    id: "typescript",
    label: "TypeScript",
    monaco: "typescript",
    piston: "typescript",
    ext: "ts",
    group: "Popular",
    note: "Compiled, then run.",
    starter:
      'const greet = (name: string): string => `Hello from ${name}`;\n\nconsole.log(greet("TypeScript"));\n',
  },

  // --- Systems --------------------------------------------------------------
  {
    id: "go",
    label: "Go",
    monaco: "go",
    piston: "go",
    ext: "go",
    group: "Systems",
    starter:
      'package main\n\nimport "fmt"\n\nfunc main() {\n    fmt.Println("Hello from Go")\n}\n',
  },
  {
    id: "rust",
    label: "Rust",
    monaco: "rust",
    piston: "rust",
    ext: "rs",
    group: "Systems",
    starter: 'fn main() {\n    println!("Hello from Rust");\n}\n',
  },
  {
    id: "zig",
    label: "Zig",
    monaco: "plaintext",
    piston: "zig",
    ext: "zig",
    group: "Systems",
    starter:
      'const std = @import("std");\n\npub fn main() !void {\n    std.debug.print("Hello from Zig\\n", .{});\n}\n',
  },
  {
    id: "nim",
    label: "Nim",
    monaco: "plaintext",
    piston: "nim",
    ext: "nim",
    group: "Systems",
    starter: 'echo "Hello from Nim"\n',
  },
  {
    id: "crystal",
    label: "Crystal",
    monaco: "plaintext",
    piston: "crystal",
    ext: "cr",
    group: "Systems",
    starter: 'puts "Hello from Crystal"\n',
  },
  {
    id: "d",
    label: "D",
    monaco: "plaintext",
    piston: "d",
    ext: "d",
    group: "Systems",
    starter:
      'import std.stdio;\n\nvoid main() {\n    writeln("Hello from D");\n}\n',
  },
  {
    id: "v",
    label: "V",
    monaco: "plaintext",
    piston: "vlang",
    ext: "v",
    group: "Systems",
    starter: 'fn main() {\n    println("Hello from V")\n}\n',
  },
  {
    id: "assembly",
    label: "Assembly (NASM)",
    monaco: "plaintext",
    piston: "nasm64",
    ext: "asm",
    group: "Systems",
    note: "x86-64, Linux syscalls.",
    starter:
      'section .data\n    msg db "Hello from NASM", 10\n    len equ $ - msg\n\nsection .text\n    global _start\n\n_start:\n    mov rax, 1\n    mov rdi, 1\n    mov rsi, msg\n    mov rdx, len\n    syscall\n\n    mov rax, 60\n    xor rdi, rdi\n    syscall\n',
  },

  // --- JVM & .NET -----------------------------------------------------------
  {
    id: "kotlin",
    label: "Kotlin",
    monaco: "kotlin",
    piston: "kotlin",
    ext: "kt",
    group: "JVM & .NET",
    starter: 'fun main() {\n    println("Hello from Kotlin")\n}\n',
  },
  {
    id: "scala",
    label: "Scala",
    monaco: "scala",
    piston: "scala",
    ext: "scala",
    group: "JVM & .NET",
    starter:
      'object Main extends App {\n  println("Hello from Scala")\n}\n',
  },
  {
    id: "groovy",
    label: "Groovy",
    monaco: "plaintext",
    piston: "groovy",
    ext: "groovy",
    group: "JVM & .NET",
    starter: 'println "Hello from Groovy"\n',
  },
  {
    id: "csharp",
    label: "C#",
    monaco: "csharp",
    piston: "csharp",
    ext: "cs",
    group: "JVM & .NET",
    starter:
      'using System;\n\nclass Program {\n    static void Main() {\n        Console.WriteLine("Hello from C#");\n    }\n}\n',
  },
  {
    id: "fsharp",
    label: "F#",
    monaco: "fsharp",
    piston: "fsharp",
    ext: "fs",
    group: "JVM & .NET",
    starter: 'printfn "Hello from F#"\n',
  },
  {
    id: "swift",
    label: "Swift",
    monaco: "swift",
    piston: "swift",
    ext: "swift",
    group: "JVM & .NET",
    starter: 'print("Hello from Swift")\n',
  },

  // --- Scripting ------------------------------------------------------------
  {
    id: "ruby",
    label: "Ruby",
    monaco: "ruby",
    piston: "ruby",
    ext: "rb",
    group: "Scripting",
    starter: 'puts "Hello from Ruby"\n',
  },
  {
    id: "php",
    label: "PHP",
    monaco: "php",
    piston: "php",
    ext: "php",
    group: "Scripting",
    starter: '<?php\n\necho "Hello from PHP\\n";\n',
  },
  {
    id: "perl",
    label: "Perl",
    monaco: "perl",
    piston: "perl",
    ext: "pl",
    group: "Scripting",
    starter: 'print "Hello from Perl\\n";\n',
  },
  {
    id: "lua",
    label: "Lua",
    monaco: "lua",
    piston: "lua",
    ext: "lua",
    group: "Scripting",
    starter: 'print("Hello from Lua")\n',
  },
  {
    id: "bash",
    label: "Bash",
    monaco: "shell",
    piston: "bash",
    ext: "sh",
    group: "Scripting",
    starter: 'echo "Hello from Bash"\n',
  },
  {
    id: "dart",
    label: "Dart",
    monaco: "dart",
    piston: "dart",
    ext: "dart",
    group: "Scripting",
    starter: "void main() {\n  print('Hello from Dart');\n}\n",
  },
  {
    id: "coffeescript",
    label: "CoffeeScript",
    monaco: "coffeescript",
    piston: "coffeescript",
    ext: "coffee",
    group: "Scripting",
    starter: 'console.log "Hello from CoffeeScript"\n',
  },
  {
    id: "python2",
    label: "Python 2",
    monaco: "python",
    piston: "python2",
    ext: "py",
    group: "Scripting",
    note: "For legacy coursework only.",
    starter: 'print "Hello from Python 2"\n',
  },

  // --- Functional -----------------------------------------------------------
  {
    id: "haskell",
    label: "Haskell",
    monaco: "plaintext",
    piston: "haskell",
    ext: "hs",
    group: "Functional",
    starter: 'main :: IO ()\nmain = putStrLn "Hello from Haskell"\n',
  },
  {
    id: "elixir",
    label: "Elixir",
    monaco: "plaintext",
    piston: "elixir",
    ext: "exs",
    group: "Functional",
    starter: 'IO.puts("Hello from Elixir")\n',
  },
  {
    id: "erlang",
    label: "Erlang",
    monaco: "plaintext",
    piston: "erlang",
    ext: "erl",
    group: "Functional",
    starter: 'main(_) ->\n    io:format("Hello from Erlang~n").\n',
  },
  {
    id: "clojure",
    label: "Clojure",
    monaco: "clojure",
    piston: "clojure",
    ext: "clj",
    group: "Functional",
    starter: '(println "Hello from Clojure")\n',
  },
  {
    id: "ocaml",
    label: "OCaml",
    monaco: "plaintext",
    piston: "ocaml",
    ext: "ml",
    group: "Functional",
    starter: 'let () = print_endline "Hello from OCaml"\n',
  },
  {
    id: "racket",
    label: "Racket",
    monaco: "scheme",
    piston: "racket",
    ext: "rkt",
    group: "Functional",
    starter: '#lang racket\n\n(displayln "Hello from Racket")\n',
  },
  {
    id: "julia",
    label: "Julia",
    monaco: "julia",
    piston: "julia",
    ext: "jl",
    group: "Functional",
    starter: 'println("Hello from Julia")\n',
  },

  // --- Data & markup --------------------------------------------------------
  {
    id: "sql",
    label: "SQL",
    monaco: "sql",
    piston: "sqlite3",
    ext: "sql",
    group: "Data & markup",
    note: "Runs against a scratch SQLite database.",
    starter:
      "CREATE TABLE student (name TEXT, marks INTEGER);\nINSERT INTO student VALUES ('Asha', 88), ('Ravi', 74);\n\nSELECT name, marks FROM student ORDER BY marks DESC;\n",
  },
  {
    id: "r",
    label: "R",
    monaco: "r",
    piston: "rscript",
    ext: "r",
    group: "Data & markup",
    starter: 'cat("Hello from R\\n")\n',
  },
  {
    id: "html",
    label: "HTML",
    monaco: "html",
    piston: null,
    ext: "html",
    group: "Data & markup",
    note: "Renders in a live preview instead of a console.",
    starter:
      '<!doctype html>\n<html>\n  <head>\n    <style>\n      body { font-family: system-ui; background: #0e0d13; color: #ece9f2; padding: 2rem; }\n      h1 { color: #ff5a33; }\n    </style>\n  </head>\n  <body>\n    <h1>Hello</h1>\n    <p>Edit this and hit Run to see it render.</p>\n  </body>\n</html>\n',
  },
  {
    id: "css",
    label: "CSS",
    monaco: "css",
    piston: null,
    ext: "css",
    group: "Data & markup",
    starter:
      ".card {\n  border-radius: 20px;\n  border: 1px solid #262331;\n  padding: 1.5rem;\n}\n",
  },
  {
    id: "json",
    label: "JSON",
    monaco: "json",
    piston: null,
    ext: "json",
    group: "Data & markup",
    starter: '{\n  "subject": "coding",\n  "topic": "arrays"\n}\n',
  },
  {
    id: "yaml",
    label: "YAML",
    monaco: "yaml",
    piston: null,
    ext: "yaml",
    group: "Data & markup",
    starter: "subject: coding\ntopic: arrays\n",
  },
  {
    id: "markdown",
    label: "Markdown",
    monaco: "markdown",
    piston: null,
    ext: "md",
    group: "Data & markup",
    starter: "# Session notes\n\n- \n",
  },
  {
    id: "xml",
    label: "XML",
    monaco: "xml",
    piston: null,
    ext: "xml",
    group: "Data & markup",
    starter: '<?xml version="1.0"?>\n<notes>\n  <note>Hello</note>\n</notes>\n',
  },

  // --- Classic --------------------------------------------------------------
  {
    id: "pascal",
    label: "Pascal",
    monaco: "pascal",
    piston: "freepascal",
    ext: "pas",
    group: "Classic",
    starter:
      "program Hello;\nbegin\n  writeln('Hello from Pascal');\nend.\n",
  },
  {
    id: "fortran",
    label: "Fortran",
    monaco: "plaintext",
    piston: "fortran",
    ext: "f90",
    group: "Classic",
    starter:
      'program hello\n    print *, "Hello from Fortran"\nend program hello\n',
  },
  {
    id: "cobol",
    label: "COBOL",
    monaco: "plaintext",
    piston: "cobol",
    ext: "cob",
    group: "Classic",
    starter:
      "IDENTIFICATION DIVISION.\nPROGRAM-ID. HELLO.\nPROCEDURE DIVISION.\n    DISPLAY 'Hello from COBOL'.\n    STOP RUN.\n",
  },
  {
    id: "prolog",
    label: "Prolog",
    monaco: "plaintext",
    piston: "prolog",
    ext: "pl",
    group: "Classic",
    starter: ":- initialization(main).\n\nmain :- write('Hello from Prolog'), nl.\n",
  },
  {
    id: "brainfuck",
    label: "Brainfuck",
    monaco: "plaintext",
    piston: "brainfuck",
    ext: "bf",
    group: "Classic",
    note: "Eight instructions. Nothing else.",
    starter:
      "++++++++[>++++[>++>+++>+++>+<<<<-]>+>+>->>+[<]<-]>>.>---.+++++++..+++.\n",
  },
];

export const DEFAULT_LANGUAGE = "python";

const BY_ID = new Map(LANGUAGES.map((l) => [l.id, l]));

export function getLanguage(id: string | undefined | null): LanguageSpec {
  return (id && BY_ID.get(id)) || BY_ID.get(DEFAULT_LANGUAGE)!;
}

/** Can the Run button actually do anything with this? */
export function isRunnable(id: string): boolean {
  const spec = BY_ID.get(id);
  return Boolean(spec && (spec.piston || spec.id === "html"));
}

/**
 * Map whatever a language model called the language onto a spec.
 *
 * Models label fences with whatever they feel like — "py", "c++", "sh",
 * "node", "golang" — so this accepts the common spellings rather than only the
 * canonical id. Returns null when it genuinely does not recognise the word, so
 * the caller can leave the editor on whatever the student had chosen instead of
 * guessing and silently switching it out from under them.
 */
const FENCE_ALIASES: Record<string, string> = {
  py: "python",
  py3: "python",
  python3: "python",
  "c++": "cpp",
  cc: "cpp",
  cxx: "cpp",
  "c#": "csharp",
  cs: "csharp",
  "f#": "fsharp",
  js: "javascript",
  node: "javascript",
  nodejs: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  golang: "go",
  rs: "rust",
  rb: "ruby",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  console: "bash",
  kt: "kotlin",
  yml: "yaml",
  md: "markdown",
  postgres: "sql",
  mysql: "sql",
  sqlite: "sql",
  plaintext: "",
  text: "",
};

export function languageFromFence(raw: string | undefined | null): LanguageSpec | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  if (!key) return null;
  const mapped = FENCE_ALIASES[key];
  if (mapped === "") return null;
  const id = mapped || key;
  return BY_ID.get(id) || null;
}
