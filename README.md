# 

<h1>Converso suite</h1>

One product, four runtimes. Converso is the LMS — it owns identity, the
catalogue and the record. The courtroom and the classroom are heavy 3D
experiences it launches, plays, and takes a result back from. The engine is the
AI that runs the hearing.

If you want to know *why* any of it is shaped this way, read
[`ARCHITECTURE.md`](ARCHITECTURE.md). This file gets you from a clone to a
running trial.

```
apps/lms               Converso   ·  Next 15 · React 19 · Clerk · Supabase · Vapi · Gemini
apps/classroom         Language   ·  Next 14 · React 18 · R3F 8.15 · local Ollama
apps/courtroom         Hearing    ·  Vite 5  · React 18 · R3F 8.17 · three 0.169
apps/courtroom-engine  The trial  ·  Node 18+, zero dependencies, ws on :4177
packages/contracts     shared shapes, limits and scoring
packages/launch-token  sign · verify · peek
packages/night-desk    the one design system
db/migrations          Supabase SQL
tools/                 the verifiers and the asset optimiser
```

## What you need first

Node 18.17 or newer, an npm that understands workspaces, a Supabase project, and
Clerk and Vapi keys — the same ones Converso already ran on. Nothing about that
wiring changed. For the classroom you also need [Ollama](https://ollama.com)
running locally; without it the language room still loads and says so.

## Getting it up

```bash
npm install                      # once, at the root — it installs all four apps
cp .env.example apps/lms/.env.local
cp .env.example apps/courtroom/.env.local
cp apps/classroom/.env.example apps/classroom/.env.local
```

Then fill them in. `.env.example` is annotated line by line and worth reading
rather than skimming, because two of the values are security boundaries and not
configuration. The short version: everything under `CONVERSO` goes to the LMS
and nowhere else, `LAUNCH_TOKEN_SECRET` wants `openssl rand -base64 32`, and
anything with a `NEXT_PUBLIC_` or `VITE_` prefix is in the browser by
definition — which is why the Supabase service-role key has neither.

Apply the migrations in `db/migrations` in order, through the Supabase SQL
editor or the CLI. There are two: the four new tables, then the catalogue seed.
`db/README.md` covers what each one does and how to roll it back.

```bash
./start.sh                       # all four, in dependency order, dying together
./start.sh lms                   # or just the one you're working on
./start.sh engine courtroom
```

Open <http://localhost:3000>. Ctrl-C stops the whole group — that matters,
because a stray engine holding port 4177 after a half-killed run is the most
common way to lose an afternoon here.

| | port | what it is |
|---|---|---|
| engine | 4177 | the WebSocket the courtroom talks to |
| courtroom | 5173 | Vite, the 3D hearing |
| classroom | 3001 | Next, the language room |
| lms | 3000 | Converso itself — the one you open |

## The one thing that will surprise you

**The engine serves one case per process.** It reads `COURT_CASE` when it
starts and there is no command to change it afterwards, so a lesson pointing at
a different hearing gets whatever the engine happens to be running. Rather than
grade the wrong trial as the right one, the courtroom compares the two and warns
in the console, naming the variable to restart with:

```bash
COURT_CASE=state-v-malhotra npm start --workspace apps/courtroom-engine
```

The seeded cases are `state-v-rane` and `state-v-malhotra`; their files live in
`apps/courtroom-engine/cases`.

## Checking it still works

Six verifiers, all offline, none needing a browser or a built bundle. They exist
because the failures that matter in a monorepo like this are not syntax errors —
they are two places that have to agree quietly drifting apart.

```bash
npm run verify:all
```

| command | checks | what it holds |
|---|---|---|
| `npm run verify` | 92 | the whole seam — schema, secrets, routes, integrity, progress, boundaries, both launch paths, the shared look |
| `npm run verify:outcome` | 18 | the result normalizers against hostile input |
| `npm run verify:registry` | 15 | every seeded character is a real registry role |
| `npm run verify:token` | 1 | the launch token: wrong secret, edited payload, expired claim, weak secret |
| `npm run verify:engine` | 7 | the engine's own behaviour |
| `npm run verify:classroom` | 70 | the classroom, including its session wiring |

203 in total. Before `npm install` you will see 202 and one skip: one engine test
needs `apps/courtroom/node_modules` to read the frontend it checks against, and
skips itself by name rather than passing quietly when it is missing.

Add `--verbose` to any of the `.mjs` ones to see each check name and what it
found rather than just the count.

## The assets

Ten GLB files, 214 MB, and they have not been compressed yet. The inventory
needs nothing installed and runs today:

```bash
npm run assets
```

It reads the GLB container directly and prints where the bytes are, which is the
point: **78% of the payload is texture**, `CourtRoom.glb` is 100.6 MB of which
99.8 MB is images and 0.8 MB is geometry, and one 4096² normal map stored as PNG
is 51.8 MB on its own. That measurement is why the optimiser uses WebP and
Meshopt rather than the Draco everyone reaches for first — Draco compresses
geometry there is barely any of, and drei's loader would fetch its decoder from
`gstatic.com`, which an LMS iframe that otherwise touches the network zero times
at paint should not start doing.

The real run needs five packages and has to happen on your machine:

```bash
npm i -D @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions \
         meshoptimizer sharp
npm run assets:optimise          # 213.6 MB → ~31.5 MB projected
```

It writes beside the originals and **rejects its own output** if a clip name,
joint name, mesh name, node name, scene-root transform or triangle count moved —
because `courtroomLayout.js` holds coordinates measured from these exact files
and `animationMap.js` matches clip names read off them at runtime. A blurry
texture is visible immediately; a renamed joint is invisible until a character
folds in half three turns into a hearing.

## Working on one app

Each app keeps its own README with the detail — `apps/courtroom/README.md` is
the fullest, since the 3D work has the most conventions worth knowing.

The courtroom runs standalone with no Converso at all: with no `?session=&token=`
in the URL it shows its own seat picker and debug panel exactly as it did before
the integration, which is how the 3D work gets done without a trial in progress.
Set `VITE_COURT_WS_URL=off` to run the room with no engine either.

Two things this sandbox cannot do and you can: `next build`, `vite build` and
`tsc` have never been run against this tree. Run them before you trust a deploy.

`DEPLOY.md` covers putting it on the internet: which host each of the four
processes belongs on and why, the `deploy/` Dockerfile and Fly config for the
engine, the full environment table per surface, and the six mistakes that are
easy to make once and hard to diagnose. Start with its Step 0 — shrinking the
models changes which hosts are even possible, because `CourtRoom.glb` at 105 MB
is over most per-file limits.

## Ground rules

Three of them, and they are not style preferences.

**There is one login and one database.** Clerk and Supabase are wired exactly as
Converso already had them. Nothing in the two scene apps holds a Supabase URL, a
service-role key, a Clerk secret or a model key, and `npm run verify` fails if
any of those strings appear in either app's source.

**The browser's score is thrown away.** Every count that comes back from a scene
is clamped to what the engine could physically have produced, and the score is
recomputed server-side from the clamped counts. Sending `score: 100` from the
console stores 0, and there is a check that proves it.

**No 3D asset gets regenerated, re-posed or redesigned**, and `CourtRoom.glb` is
never modified. Characters are fitted to the room, not the reverse.
