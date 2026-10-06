# Deploying Converso

Four processes, three different hosting problems, and one of them is not like
the others. This is the shortest path to a working production deploy, the
reasoning behind each host, and the six things that will bite you if you skip
the reasoning.

`README.md` gets it running on your machine. This document gets it running on
the internet. Read the first section before you touch a host — the single
highest-impact step happens before any deployment at all.

## The shape of the thing

| Process | What it is | Where it goes | Why there |
|---|---|---|---|
| `apps/lms` | Next 15, server actions, Clerk, Supabase | **Vercel** | It is a Next app with server actions and API routes. Vercel is its native runtime; anything else means recreating the adapter by hand. |
| `apps/courtroom` | Vite SPA, a `dist/` of static files | **Vercel / Cloudflare Pages** | A static bundle plus ~31 MB of models. This is a CDN's entire job. No server needed. |
| `apps/courtroom-engine` | Long-lived WebSocket, in-memory trial state | **Fly.io** (or Railway/Render) | Cannot be serverless. A WebSocket that holds a hearing in memory needs a process that stays up between messages, which is exactly what Vercel functions are not. |
| `apps/classroom` | Next 14 + a server-side call to Ollama | **not in phase one** | Its AI is a local model. See "The language room" below — deploying it is a cost and privacy decision, not a configuration one. |

```
                    app.converso.example        (Vercel — LMS)
                            │
              mints a 2-minute launch token
                            │
                            ▼
                 court.converso.example          (CDN — static courtroom)
                            │
                     wss://  │  persistent socket
                            ▼
                engine.converso.example          (Fly.io — one machine, one case)
```

Three hostnames, one Supabase project, one Clerk instance. The classroom is a
fourth hostname whenever you decide to add it.

## Step 0 — shrink the models first

Do this before you choose a host, because it changes which hosts are even
possible.

```bash
npm i -D @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions meshoptimizer sharp
npm run assets:optimise
```

`CourtRoom.glb` is **105 MB**, and 99% of that is texture — one 4096² normal map
stored as PNG is 51.8 MB on its own. Most static hosts reject individual files
around the 100 MB mark (Vercel's ceiling is 100 MB at the time of writing, so
this one file fails by 5 MB), and even where a host accepts it, a 105 MB first
paint is not a product. The optimiser takes the ten models from **213.6 MB to
about 31.5 MB** using `EXT_texture_webp` and `EXT_meshopt_compression` — both of
which three.js and drei already decode, so **no application code changes.**

It also fingerprints clip names, joint names, node names and triangle counts
before and after, and refuses its own output if any of them moved. That matters
because `courtroomLayout.js` holds coordinates measured from the original file
and `animationMap.js` matches clip names read at runtime. A blurry texture is
visible immediately; a joint renamed from `mixamorig:Spine` to `Spine_0` is
invisible until a character folds in half three turns into a hearing.

If you deploy without running this, put the models in object storage instead
(Cloudflare R2 has no egress fees, which for 214 MB of GLB per cold visitor is
the difference that matters). That needs a one-line change in two files, because
model paths are currently same-origin absolute: `characterRegistry.js:21` builds
`` `/models/${file}` `` and `courtroomLayout.js:157` names
`'/models/CourtRoom.glb'`. Prefix both with a `VITE_ASSET_BASE` and set it to the
bucket's public URL, with CORS on the bucket allowing the courtroom origin.
Running the optimiser is less work.

## Step 1 — Supabase

Nothing about your existing project changes. Apply the two migrations in order
through the SQL editor:

```
db/migrations/0001_simulations.sql     four tables, triggers, the expiry sweep
db/migrations/0002_seed_simulations.sql  two courtroom cases and the language room
```

Both are idempotent — `0001` is `create table if not exists` throughout and
`0002` upserts on `slug`, so re-running either after an edit is safe.
`db/README.md` covers what each does and how to roll it back.

RLS is enabled on all four tables with **no policies attached**, which reads like
a mistake and is not: identity comes from Clerk, so there is no Supabase JWT for
a policy to judge. The half that works is the half you want — the anon key that
ships to every browser can read and write nothing in these tables, and the
service-role key bypasses RLS on the server. Authorisation happens one layer up,
in the server actions, where every query is filtered by the Clerk user id.

Take one minute to confirm the seed landed, because a missing catalogue row is a
confusing failure later:

```sql
select slug, kind, case_id from public.simulations order by slug;
-- expect: language-room | state-v-malhotra | state-v-rane
```

## Step 2 — Clerk

Create a **production instance** and use its keys. Development keys work on
`localhost` and will not work on your domain, and the failure looks like a
redirect loop rather than an error about keys.

Add your LMS domain, set the paths to match `NEXT_PUBLIC_CLERK_SIGN_IN_URL`, and
stop there. Neither scene app uses Clerk at all — the courtroom's only credential
is the launch token — so there are no satellite domains to configure and no
cross-origin cookie problems to solve. That is a deliberate property of the seam,
not luck.

## Step 3 — the engine, on Fly.io

Two files are provided under `deploy/`. The engine has **zero dependencies** and
no `@converso/*` imports, so the image is a Node base plus two directories.
Run all three commands from the repository root — the Dockerfile copies from
`apps/courtroom-engine/`, so the build context has to be the root:

```bash
fly launch --no-deploy --copy-config --config deploy/fly.toml
fly secrets set ANTHROPIC_API_KEY=sk-ant-...
fly deploy --config deploy/fly.toml
```

Three settings in that config are load-bearing, and all three are places where
the platform default is wrong for this process.

**`HOST=0.0.0.0`.** The engine defaults to `127.0.0.1`, which is correct on a
laptop and means "refuse every connection" inside a container. It already reads
`HOST` and `PORT` from the environment, so this is configuration rather than a
patch.

**`auto_stop_machines = false`, `min_machines_running = 1`.** Fly scales to zero
by default. This process holds the entire trial — turn order, witness memory,
objection state — in memory, so a machine that stops mid-hearing does not resume
it, it forgets it. For the same reason a deploy during a live hearing drops that
hearing.

**One machine, not two.** The state is per-process and a reconnecting socket has
to come back to the same process, so horizontal scaling silently breaks the
reconnect path: the courtroom retries on a `[1,2,4,8,15]s` backoff and would
cheerfully reattach to a machine that has never heard of this trial. If you
outgrow one machine, the fix is a room-per-hearing router, not more replicas.

The health check points at `/api/state`, which returns the engine's own snapshot
as JSON — a real readiness signal rather than a static 200. The engine also
serves its standalone demo frontend from `apps/courtroom-engine/public` on the
same port; that directory has a path-traversal guard, but it is public, so do not
put anything in it you would not publish.

Pick the model provider with `COURT_LLM_PROVIDER`:

| Value | Needs | Notes |
|---|---|---|
| `anthropic` | `ANTHROPIC_API_KEY` | Recommended for production. |
| `openai` | `OPENAI_API_KEY` | |
| `ollama` | a reachable `baseUrl` | Defaults to `http://127.0.0.1:11434`, i.e. nothing, inside a container. |
| `offline` | nothing | Deterministic heuristics. A hearing that continues when the model is unreachable, marked as such — useful for smoke tests and for demos with no key. |

A provider selected without its key falls back to `offline` and says so in the
startup log rather than failing at the first turn.

## Step 4 — the courtroom, as static files

The two variables it needs are **baked in at build time**, because Vite inlines
`import.meta.env` into the bundle. There is no runtime configuration to change
afterwards; a new value means a new build. Set them in the host's build
environment, with the project root pointed at `apps/courtroom`:

```
VITE_CONVERSO_URL=https://app.converso.example
VITE_COURT_WS_URL=wss://engine.converso.example
```

Build command `npm run build`, output directory `dist`.

**`wss://`, never `ws://`.** The default is `ws://127.0.0.1:4177`, and a browser
on an HTTPS page blocks an insecure WebSocket as mixed content. The symptom is a
courtroom that loads, renders the room, and never starts — with one console line
about mixed content that is easy to miss under the model-loading noise. Fly
terminates TLS for you, so the app keeps speaking plain `ws` internally while the
browser connects over `wss`.

`VITE_CONVERSO_URL` is deliberately build-time for a security reason worth
knowing before you try to make it dynamic: the obvious alternative is to read the
callback origin from the launch URL or the referrer, which would let any page
that frames the courtroom name its own server and be handed the student's launch
token. The referrer is consulted only when the variable is absent, and only its
origin.

`apps/courtroom/vercel.json` sets the two header rules that matter. Models get
`Cache-Control: public, max-age=31536000, immutable`, because a 31 MB download
should happen once per visitor rather than once per hearing, and the filenames
are stable — `characterRegistry.js` names them as string literals, which is
exactly why the optimiser does not hash them. And `frame-ancestors` is pinned to
the LMS origin, so the courtroom can be framed by Converso and by nothing else.
Change that value when your domain changes, or the iframe goes blank.

## Step 5 — the LMS, on Vercel

Import the repository with the root directory set to `apps/lms`. Vercel detects
Next and the monorepo correctly; the workspace packages resolve because they are
`file:` links inside the same repo.

```bash
openssl rand -base64 32     # LAUNCH_TOKEN_SECRET
```

| Variable | Scope | Notes |
|---|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | browser | Production instance. |
| `CLERK_SECRET_KEY` | server | |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | browser | Must match the Clerk path. |
| `NEXT_PUBLIC_SUPABASE_URL` | browser | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser | Safe: RLS denies it these tables. |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only** | Never a `NEXT_PUBLIC_` or `VITE_` name. |
| `NEXT_PUBLIC_VAPI_WEB_TOKEN` | browser | Web token, not the private key. |
| `GEMINI_API_KEY` | server | |
| `LAUNCH_TOKEN_SECRET` | **server only** | ≥16 chars or `sign()` refuses. Read in exactly one file, `lib/launch.ts`, and a verifier check proves it. |
| `NEXT_PUBLIC_COURTROOM_URL` | browser | `https://court.converso.example` |
| `NEXT_PUBLIC_LANGUAGE_SCENE_URL` | browser | Leave unset until the classroom is deployed. |

The last two do double duty and this is the part people miss: **CORS is derived
from them.** `allowedOrigins()` in `lib/launch.ts` parses the origin out of each
scene URL, and the four cross-origin routes echo back only an origin on that
list — never `*`, because these endpoints answer with a student's session. So
there is no separate allow-list to maintain, and equally, a typo in
`NEXT_PUBLIC_COURTROOM_URL` presents as CORS failures rather than as a bad link.
One place to change when a hostname moves.

`LAUNCH_TOKEN_SECRET` lives only here. The scene apps never verify a token
themselves — they exchange it at `GET /api/simulations/:sessionId` — which is why
the secret never has to be shared across hosts.

Two things about this build, both pre-existing and neither worth changing now.
`next.config.ts` sets `typescript.ignoreBuildErrors` and
`eslint.ignoreDuringBuilds`, so **a successful deploy is not evidence of a
type-clean tree** — run `npx tsc --noEmit` yourself before you trust one. And
`withSentryConfig` is applied three times over, which is harmless but makes the
build slower and noisier than it needs to be; set `SENTRY_AUTH_TOKEN` if you want
source maps uploaded, or ignore the warnings if you do not.

## Step 6 — prove it works

The offline sweep runs anywhere, including in CI, and needs no services:

```bash
npm run verify:all     # 203 checks
```

Worth wiring into CI as a required check. It is not a linter — it holds the
things that break silently when two files drift apart: that every SQL check
constraint matches the contracts list it mirrors, that all four cross-origin
routes carry the session comparison and the allow-list, that neither scene app
holds a Supabase URL, a service-role key, a Clerk secret or a model key, and that
a submitted `score` of 100 stores as 0.

Then the real thing, in this order, because each step fails distinctly:

```bash
curl https://engine.converso.example/api/state          # engine is up and has a case loaded
curl -I https://court.converso.example/                 # courtroom serves
curl -I https://court.converso.example/models/judge.glb # and its models, with immutable caching
```

Now sign in to the LMS, start a hearing, and check four things in the browser.
The token disappears from the iframe URL after the exchange — it is stripped
deliberately, because a credential in a visible URL ends up in screenshots. The
network tab shows models served from the CDN with `cache-control: immutable`. The
socket to `engine.converso.example` is `wss` and open. And when the hearing
finishes, a row appears in `simulation_results`, plus one in `session_history`,
which is what makes it show up on the dashboard's recent sessions.

If the hearing scores but the dashboard stays empty, the result wrote and the
progress row did not: `recordCompanionProgress` swallows its own failure by
design, so a dashboard write can never cost a student their mark. Check the
function logs for `[simulations] could not record progress`.

## One engine process serves one case

The engine fixes its case from `COURT_CASE` when the process starts and there is
no command to change it afterwards. Combined with `VITE_COURT_WS_URL` being
baked into the courtroom bundle, that means **one courtroom deployment can reach
one case.** Two cases are seeded, so this is a real limit and not a hypothetical.

The courtroom already refuses to paper over it: it compares the session's
`case_id` against the `caseId` the engine announces on connect and warns in the
console naming the variable to restart with. Scoring the wrong hearing as the
requested one is the failure that check exists to prevent.

Deploy `state-v-rane` first and leave it there. When you want both, the clean fix
is small and the LMS already holds the information: add a `wsUrl` to the session
payload that `GET /api/simulations/:sessionId` returns — derived from the row's
`case_id` — and let `VITE_COURT_WS_URL` become the fallback rather than the only
source. Then one courtroom build serves every case and each case gets its own
engine machine. `useCourtSocket` already takes a `url` argument, so the change is
mostly plumbing. Two courtroom builds on two hostnames also works and is worse
to maintain.

## The language room

It is deliberately not in phase one. Its AI is a **server-side** call to Ollama
(`src/lib/ollama.mjs`, one module, `OLLAMA_URL` and `OLLAMA_MODEL`), so unlike
the courtroom's provider layer it has no hosted option built in. That leaves
three honest paths.

Leave it local, which is what shipping without it means. The room already runs
standalone — its reporters are gated, so a classroom with no session reports
nothing — and the catalogue row stays harmlessly in place because the LMS only
links it when `NEXT_PUBLIC_LANGUAGE_SCENE_URL` is set. Free, and the privacy
promise in its own catalogue copy stays literally true: *the model runs on this
machine; nothing you type leaves it.*

Or point `OLLAMA_URL` at a GPU host running Ollama. Zero code change, because
the module already reads it. But it is the expensive line item by a wide margin —
a GPU instance is roughly $0.20–1.00/hour, which dwarfs everything else here —
and that sentence in the catalogue becomes false and needs rewriting. Put it on a
private network or in front of auth; an open Ollama endpoint is someone else's
free inference.

Or extend `ollama.mjs` to speak a hosted API as well, mirroring what the engine's
`provider.js` already does with its four providers. Cheapest to run, no GPU, and
the only one of the three that is real code plus tests rather than configuration.
If the language room matters to the product, this is the right investment, and
`provider.js` is the pattern to copy.

## Costs, roughly

The web tier is nearly free: Vercel's hobby tier covers the LMS and the static
courtroom, Supabase and Clerk both have usable free tiers, and Cloudflare R2
charges no egress if you put models there. The engine on Fly is a few dollars a
month for a single always-on shared-CPU machine. Model tokens are the variable
cost and scale with hearings, not with students. Adding a GPU for the language
room changes the shape of the bill entirely, which is the main argument for the
adapter over the GPU.

## The six that will bite you

`ws://` instead of `wss://` — blocked as mixed content, and the courtroom looks
like it is merely slow.

A `VITE_` value changed without a rebuild — it is inlined in the bundle, so
nothing happens until you rebuild.

`CourtRoom.glb` at 105 MB — over most hosts' per-file limit, and a bad first
paint even where it is allowed. Step 0 exists for this.

Fly's scale-to-zero — forgets the hearing it was holding. `min_machines_running = 1`.

Clerk development keys on a real domain — a redirect loop rather than a clear
error.

`NEXT_PUBLIC_COURTROOM_URL` with a typo or a trailing slash — CORS failures on
the session routes, because the allow-list is derived from it. The origin must
match exactly.

## Ground rules that survive deployment

One login and one database. Clerk and Supabase stay wired exactly as Converso
already had them; nothing here adds a second of either.

The browser's score is thrown away. Every count is clamped to what the engine
could physically have produced and the score is recomputed server-side. Deploying
does not change this and nothing in a host's configuration can weaken it.

No 3D asset gets regenerated. The optimiser in Step 0 re-encodes textures and
compresses meshes, and verifies that no clip, joint, node or transform moved —
that is the one transformation the assets are allowed.
