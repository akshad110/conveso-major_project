# Converso — redesign notes

Everything below is what changed in this pass, why, and the few things you
need to do before it runs.

## Run it

```bash
npm install
npm run dev
```

No new packages were added. The editor uses `@monaco-editor/react`, which was
already in `package.json` and unused.

### Environment

The redesign does not introduce any required key. These are the ones the app
already expected:

```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_VAPI_WEB_TOKEN=
GEMINI_API_KEY=
```

Two new optional ones, both for the 3D slots that are not wired yet:

```
NEXT_PUBLIC_LANGUAGE_SCENE_URL=    # language companion's 3D scene
NEXT_PUBLIC_COURTROOM_URL=         # your courtroom build
```

Leave them unset and those companions show an honest empty stage with the
variable name printed on it, rather than a broken frame. Set either to a URL
(your courtroom dev server, for instance) and it mounts in the panel beside the
transcript.

Code execution needs no key. It goes to Piston's public runner.

## The editor

Coding companions now open with Monaco on the left and the conversation on the
right.

Ask the tutor something and the answer splits in two: the sentences are spoken
and land in the transcript, the code lands in the editor. The transcript shows
`[wrote 14 lines into the editor]` where the code would have been, so you are
never reading and hearing the same thing at once. You can type in the editor
yourself at any time — nothing is read-only.

**48 languages.** Popular, systems, JVM and .NET, scripting, functional, data
and markup, classic. Pick one from the toolbar or press through the picker with
the arrow keys. 42 of them execute; the six markup ones (HTML, CSS, JSON, YAML,
Markdown, XML) are editor-only, and HTML gets a live preview pane instead of a
console.

Cmd/Ctrl+Enter runs. Output, stdin and the exit code sit in the drawer below.
Drafts are kept in localStorage per companion and per language, so switching
from Python to Rust and back does not lose what you wrote.

**Why your editor was empty before.** `app/api/generate-code/route.ts` had this
line:

```ts
code.replace(/```[\s\S]*?```/g, "")
```

That strips fenced code blocks — which is to say, it deleted the model's entire
answer and returned the leftover prose. The route is rewritten: it now asks for
a fenced block explicitly, reads the fence's language tag, and falls through a
list of Gemini models until one responds.

## The other companions

Maths, science, history and economics get a notes board. Anything the tutor
says can be pinned; pinned points rise to a kept section, and the whole board
exports as markdown. Your own notes are saved alongside.

Language and law get a 3D stage — the mount slot described under Environment
above, ready for you to connect.

## Design

See `design/DESIGN-SYSTEM.md`. `design/night-desk.css` is the same system as
plain, framework-free CSS so the classroom app, the courtroom and the résumé
analyser can match without depending on Tailwind.

The short version: matte panels lit by a single hairline on the top edge;
machine facts in mono and uppercase, human facts in sans; 20px corners for
things you read and 8px for things you work in; one hot colour; one animated
element.

## Bugs fixed along the way

`components/NavItems.tsx` linked to `my-journey` without a leading slash, so the
link 404'd from anywhere below the root.

`components/SearchInput.tsx` never cleared its debounce timer, so typing
"algebra" fired seven navigations.

`components/SubjectFilter.tsx` pushed a URL on mount, rewriting the address to
`?subject=` before anyone touched it.

`components/CompanionComponent.tsx` leaked its `speech-start` and `speech-end`
listeners, had no `error` handler — a blocked microphone left the UI on
"connecting" forever — and never called `vapi.stop()` on unmount, so the call
stayed open after you navigated away.

`lib/utils.ts` told every companion it had a code editor, which is why a
history tutor would sometimes answer in Python. Only the coding companion is
told that now.
