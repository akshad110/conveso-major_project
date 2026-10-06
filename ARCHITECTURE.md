# Converso — integration report

Phase 1's deliverable: what these four applications are, how they were joined,
and every place the build deviates from the integration plan. Written after the
audit and kept current as phases land. Status is at the bottom.

## What was merged, and what deliberately was not

Four applications existed before this work. Converso, the LMS: Next 15.3.2 on
React 19, Clerk for identity, Supabase for data, Vapi for voice, Gemini for
generation, Monaco for the coding companion, Sentry for errors. The classroom:
Next 14.1.0 on React 18 with React Three Fiber 8.15 and three 0.161, talking to
a local Ollama and the browser's own speech synthesis. The courtroom: Vite 5.4
on React 18.3 with R3F 8.17, drei 9.114 and three 0.169. And the engine: a
zero-dependency ESM Node package with a hand-rolled WebSocket server on
127.0.0.1:4177, whose whole test suite is `node --test`.

They are now one npm workspaces monorepo and still four runtimes. That is not a
compromise, it is the only arrangement available: the LMS is on React 19 and both
3D apps are on React 18, and R3F 8 does not run on React 19. Forcing one runtime
would mean upgrading R3F and three across two working scenes, re-testing every
GLB and every animation clip, to gain nothing a student can see. The plan asked
for separate applications and this is the strongest reason to keep them separate.

```
converso-suite/
  apps/lms                Next 15 · React 19 · Clerk · Supabase · Vapi · Gemini
  apps/classroom          Next 14 · React 18 · R3F 8.15 · three 0.161 · Ollama
  apps/courtroom          Vite 5  · React 18 · R3F 8.17 · three 0.169
  apps/courtroom-engine   Node 18+ · zero dependencies · ws on :4177
  packages/contracts      shared shapes, limits, scoring
  packages/launch-token   sign / verify / peek
  packages/night-desk     the one design system
  db/migrations           Supabase SQL
  tools/verify-integration.mjs
```

## The seam

One sentence: the LMS mints a signed, two-minute token, the heavy app exchanges
it once for the session, plays, reports counts back, and the LMS recomputes the
score itself.

Longer. A student on a lesson page presses Start. `POST /api/simulations/start`
is the only endpoint in the flow that trusts a Clerk cookie, because it is the
only one called from a Converso page. It creates a `simulation_sessions` row and
mints a launch token, and returns a URL with the token in the query string. That
URL goes into an iframe `src` and is never read by our own client code.

The scene app reads `?session=&token=` and exchanges the token for the session
at `GET /api/simulations/:sessionId`. From that moment the token is the only
credential it holds — it has no Supabase URL, no service-role key, no Clerk
secret and no model key, and `npm run verify` fails if any of those appear in
either scene's source. The token is then removed from the address bar, because a
credential in a visible URL ends up in screenshots and shared links.

During the hearing the app posts a bookmark to `/progress`. At the end it posts
counts to `/complete`. On unload it beacons `/abandon`. Every one of those four
routes compares `claims.sessionId` with the path parameter, so a token for one
session cannot touch another, exports an `OPTIONS` handler, and sends CORS
headers that echo a known origin and never `*`.

### Why the token is not a JWT

`v1.<base64url payload>.<base64url HMAC-SHA256>`. There is no `alg` field,
because a field naming the algorithm is a field an attacker can set to `none`,
and this is a 120-second credential that did not need a library to carry it.
`sign()` refuses a secret shorter than 16 characters rather than pretend.

### Why the courtroom does not read its callback origin from the URL

`VITE_CONVERSO_URL` is baked in at build time. The obvious alternative — take the
origin from the launch URL or the referrer — means a page that frames the
courtroom can name its own server and be handed the student's launch token. The
referrer is consulted only when the variable is absent, and only its origin.

### Why the browser's score is thrown away

`normalizeCourtroomResult` clamps every count to what the engine could physically
have produced, clamps `correctObjections` to `objectionsRaised`, clamps the three
performance axes to 0–100, truncates the transcript at 200 000 characters,
discards the submitted `score` entirely and recomputes it from the clamped
counts. A student with the console open can send `score: 100`; the integrity
checks in the verifier assert that it stores as 0. The courtroom's own
`session/outcome.js` therefore sends no score at all — there is nothing there to
tamper with, and nothing gained by inflating the counts either.

## Deviations from the plan

**Prisma → Supabase.** The plan says Prisma three times. Converso does not use
Prisma; it uses `@supabase/supabase-js` directly, and the tables it already owns
(users, companions, session history) live in Postgres behind Supabase with
row-level security. Introducing Prisma would have meant a second data access
path over the same database, a migration history that disagrees with the one
Supabase already tracks, and a second place for connection strings to leak. The
four new tables are therefore plain SQL migrations in `db/migrations`, RLS
enabled, and — because Clerk ids are not UUIDs — `user_id` is `text` everywhere
it appears. The catalogue table `simulations` has no `user_id` at all: it is the
same list of hearings for everybody.

**No LiveKit.** The plan puts LiveKit in the classroom. This classroom has no
video and no second participant — it is a local Ollama model and the browser's
own `SpeechSynthesis`, in six languages. Adding LiveKit would add a paid realtime
service and a server-side token endpoint to an app that currently needs neither.
If group classes are wanted later, the session seam is already the right shape
for it.

**Launch by query string, not `/courtroom/session/:sessionId`.** The plan's URL
implies the courtroom serves a route per session. It is a Vite single-page app on
its own origin, so a path segment would need a dev-server rewrite and a
production rewrite to mean anything, and the session id would still have to be
parsed out of `location`. `?session=&token=` needs neither and puts the
credential where a beacon can also carry it.

**Contracts are `.mjs` with hand-written `.d.ts`, not TypeScript source.** The
plan asks for shared TypeScript packages. The engine is dependency-free by
design and the courtroom is plain JavaScript; a TypeScript package would have
forced a build step into both. The `.d.ts` gives the LMS full type checking
across the seam, which was the actual goal.

**`courseId` / `lessonId` → `subject` / slug.** The plan's `Simulation` model
names `courseId` and `lessonId`. Converso has no courses table — it has
companions with a `subject`. The catalogue keys off what exists.

**Classroom tone mapping.** The classroom is on three 0.161, which predates the
`AgXToneMapping` the courtroom uses on 0.169, so it falls back to ACES Filmic.
The two scenes are therefore not pixel-identical in tone. Noted rather than
fixed, because fixing it means upgrading three under a working scene.

**One engine process serves one case.** The engine fixes its case from
`COURT_CASE` when the process starts, and there is no command to change it
afterwards. A lesson that points at a different case therefore gets the hearing
the engine happens to be running. Rather than let that pass, the courtroom
compares the session's `case_id` against the `caseId` the engine announces and
warns in the console, naming the variable to restart with
(`apps/courtroom/src/session/useLaunchedSession.js`). Scoring the wrong hearing
as the requested one is the failure that check exists to prevent. The real fix
is either a `SET_CASE` command or one engine process per hearing, and both are
larger than this integration; the seam is already shaped for the second.

**Not Draco, and not KTX2 yet.** The plan names Draco and KTX2 for the 214 MB
of models. Measuring first changed the answer. `CourtRoom.glb` is 100.6 MB, of
which **99.8 MB is 22 images and 0.8 MB is geometry** — the room is 15,657
triangles, and one 4096² normal map stored as PNG is 51.8 MB on its own. Draco
compresses geometry there is none of. Worse, drei's `useGLTF` enables a
`DRACOLoader` whose decoder path defaults to `https://www.gstatic.com/draco/…`;
nothing is fetched today because no file contains a Draco primitive, but
compressing with Draco would make every character load reach a third-party
origin from inside an LMS iframe — a CSP entry and an offline failure, in an app
that otherwise fetches nothing at paint time.

So `tools/optimise-assets.mjs` uses what the runtime already decodes for free:
`EXT_texture_webp`, which three's `GLTFLoader` reads natively with no
transcoder, and `EXT_meshopt_compression`, whose decoder drei already installs
from `three-stdlib` and Vite therefore bundles. **Neither needs a single
application change.** Textures are downscaled by the *slot* they are bound into
rather than by filename — base colour and normal keep 2048, metallic-roughness
and occlusion drop to 1024, which is where the two 4096² ORM maps on the judge
and the officer go from 6.5 MB each to about 0.1 MB. Meshopt is applied only
above 20k triangles, so the four heavy characters get it and the room does not.

KTX2 is still worth having later, because it is the only option here that
shrinks *GPU memory* rather than download size. It is behind `--ktx2` because
drei's `useGLTF` never calls `setKTX2Loader`, so a KTX2 texture inside a GLB
does not load at all until `Courtroom.jsx` and `CharacterController.jsx` pass an
`extendLoader`; the script prints that wiring and copies the transcoder into
`public/basis/`, same origin.

`npm run assets` prints the inventory and needs nothing installed — it reads the
GLB container directly, because the argument for all of the above rests on a
measurement and a measurement you must install five packages to reproduce is one
people take on trust. Projected across all ten models: **213.6 MB → ~31.5 MB.**
That figure is arithmetic on pixel counts; `npm run assets:optimise` reports what
the encoder actually produced.

The script refuses `join`, `flatten`, `instance` and `simplify`, and runs `prune`
with `keepLeaves`. Not out of caution — because `courtroomLayout.js` holds world
coordinates measured from the original file, `animationMap.js` matches clip names
read off the loaded GLB, and `poseFix` was derived by forward kinematics on named
joints. Each of those is a name or a number living in two places. So the last
thing the script does is fingerprint clip names and durations, joint names, node
names, mesh names, scene-root transforms and the triangle count before and after,
and **reject the output if any of them moved**, leaving the original untouched. A
blurry texture is visible; a joint renamed from `mixamorig:Spine` to `Spine_0`
is invisible until a character folds in half three turns into a hearing.

**The courtroom renders the shared look in fallback faces.** Every colour,
face and corner in `apps/courtroom/src/styles.css` now comes from
`@converso/night-desk`, but the pack *names* three webfonts — Bricolage
Grotesque, Instrument Sans, JetBrains Mono — and declares no `@font-face` for
them. The LMS loads them through `next/font`. The courtroom is a separate
origin in an iframe, so it inherits none of that, and it deliberately fetches
nothing at paint time, so it renders those three stacks in their system
fallbacks. The result is that the two halves agree on every shape, weight and
colour and disagree on letterforms. Dropping the font files into
`apps/courtroom/public/fonts` with an `@font-face` block closes it; that would
also be the moment to relax the verifier check that currently forbids
`@font-face` in that file.

**Progress is `session_history`, because that is the only progress Converso
has.** The plan asks for lesson and course progress to advance when a simulation
finishes. There is no lessons table and no courses table — there are companions,
and `session_history` is the append-only log the dashboard's recent sessions and
the profile's journey are both read from. So a finished hearing earns exactly
what a finished voice session earns: one row, the same two columns, the same
table. `recordCompanionProgress` runs after the result and the status change are
both committed, takes the user id from the verified token claim rather than
`auth()` (there is no Clerk cookie on that request), swallows its own failure so
a dashboard write cannot cost a student their mark, and writes nothing at all
for a simulation that belongs to no companion. Six verifier checks hold that
ordering, that column list, and the compare-and-set that stops a double-posted
result appending two rows to one student's history.

## What stops the seam rotting

Six verifiers, all offline, none needing `node_modules`. They exist because the
bugs that matter here are not syntax errors; they are two places that have to
agree drifting apart.

| Verifier | Checks | What it holds |
|---|---|---|
| `npm run verify` | 92 | The whole seam — schema, secrets, routes, integrity, progress, boundaries, both apps' launch paths, and the shared look. |
| `npm run verify:outcome` | 18 | The result normalizers against hostile input. |
| `npm run verify:registry` | 15 | Every seeded character is a real registry role. |
| `npm run verify:token` | 1 suite | The launch token round-trip: wrong secret, edited payload, expired claim, weak secret. |
| `npm run verify:engine` | 7 (1 skipped until install) | The engine's own behaviour. |
| `npm run verify:classroom` | 70 | The classroom, including its session wiring. |

`npm run verify:all` runs the lot. The integration verifier compares every SQL
check constraint against the contracts list it mirrors, asserts RLS is on and no
policy grants direct browser access, checks every seeded case id has a case file,
proves `LAUNCH_TOKEN_SECRET` is read in exactly one file and never from a client
component, proves all four cross-origin routes carry the session comparison and
the CORS allow-list, and — since the reskin — proves the courtroom keeps no
palette of its own, reads no token the pack does not define, uses no glass and no
glow, spends `--flame` on exactly four things, and stamps `data-seat` from the
registry at every place that names a speaker.

There is no `tsc` in this environment and no installed `node_modules` for the
suite, so type checking is not available here; `@babel/parser`, borrowed from a
sibling checkout, is used to prove every new TS/TSX/MJS file at least parses.

Full sweep, all green: integration 92, outcome 18, registry 15, launch-token 1,
engine 7 (one of them skipped until `apps/courtroom/node_modules` exists),
classroom 70. **203 checks.**

One of those 92 is worth naming because it was wrong until the audit caught it.
`README.md` promises that a Supabase URL, a service-role key, a Clerk secret or a
model key appearing in either scene app's source fails the build. The check
behind that sentence tested only the first three words of it — no Clerk secret
scan outside four named classroom files, and no model-key scan anywhere. It now
walks both apps' `src` plus their build configs (`next.config.mjs`,
`vite.config.js`, which are the files that can inline an environment variable
into a bundle) against all five categories, reads through `codeOnly` so a comment
explaining an absence cannot fail the check, and reports the file count so it
cannot pass by scanning nothing. It was verified by planting
`process.env.GEMINI_API_KEY` in `session/outcome.js` and watching it fail.

## Phase status

| Phase | Status | Notes |
|---|---|---|
| 1 Audit | done | This document, plus `README.md` for getting it running. |
| 2 Database | done | 4 tables, RLS on, no assets, Supabase not Prisma. |
| 3 API + session | done | start · :sessionId · complete · progress · abandon · classroom/session. |
| 4 Courtroom launch | done and verified | `useLaunchedSession` owns the handshake; `App.jsx` gates the scene on it, hides `RoleSelect` and the debug panel when launched, and shows `LaunchGate` until the session lands. |
| 5 Lazy loading | done | The LMS has no three/R3F/drei dependency at all, so the cost is zero by construction. The session names the cast, and the Canvas does not mount until it has — a hearing downloads the characters its case needs and no others. `LoadingScreen` stages it. |
| 6 Asset optimisation | scripted and measured, encoder not run | `npm run assets` gives the inventory with no dependencies: 214 MB of models, 78% of it texture, `CourtRoom.glb` 99% texture at 15,657 triangles. `tools/optimise-assets.mjs` does WebP-by-slot plus Meshopt, projected 213.6 MB → ~31.5 MB, and rejects its own output if a clip or joint name moves. npm is unreachable in this sandbox, so the encoder has to be run on the developer's machine. |
| 7 Animations | partial | `animationMap.js` degrades missing clips honestly. Clips cannot be loaded selectively while they are merged into each character GLB. |
| 8 Engine separation | done and verified | Engine has zero dependencies; the courtroom imports nothing from it. |
| 9 WebSocket | done | Backoff `[1,2,4,8,15]s`, a `HOLD` on every connect, and the hearing pauses while the socket is down — `ConnectionNotice` says so over the room rather than instead of it. |
| 10 Result return | done | Route, normalizers and scoring verified. `outcome.js` derives the report, `/complete` receives it, and finishing now appends to `session_history` — see the deviation above for why that is what lesson progress means here. |
| 11 Classroom | done and verified | Same session pattern as the courtroom: launch, gate, bookmark, result, `pagehide` beacon. Reporters are gated so a standalone classroom reports nothing. |
| 12 Shared contracts | done | `packages/contracts`, `packages/launch-token`, `packages/night-desk`. |
| 13 Cleanup / memory | done | Iframe unmount, `pagehide` beacon, and `three/dispose.js` freeing geometry, material, texture and mixer above the Canvas so React has not yet detached the scene. |
| 14 Error handling | done | No route leaks an internal error. `LaunchGate` prints the refusal it was given, invents none, and offers Retry only where retrying can help. |
| 15 Testing | automated green, builds unrun | 203 checks pass. `next build` and `vite build` cannot run in this sandbox; they must be run on the developer's machine. |
| 16 Performance target | met by construction, unmeasured | Zero courtroom cost on LMS pages follows from the dependency graph, but no production build has confirmed it. |
| 17 Shared look | done | One design pack, `@converso/night-desk`, across the LMS, the classroom and the courtroom. Held by 9 verifier checks. Faces differ — see the deviation above. |

### The Git checkpoint, and the 105 MB problem

Done — `converso-suite` is now a repository. One decision was forced while
making it: `CourtRoom.glb` is 105 MB, which is over GitHub's hard 100 MB
per-file limit, and there is no git-lfs on this machine to route it through. A
repository containing that file cannot be pushed, and a binary that size
committed once stays in the history for every future clone. Since this was the
first commit, the cheap moment to decide was then rather than after a
`filter-repo`.

So the models are excluded and travel as they already did, by zip.
`apps/courtroom/public/models/MANIFEST.md` and its classroom counterpart list
every file with size and SHA-256, so an incomplete copy is provable rather than
mysterious. This is worth revisiting after `npm run assets:optimise`: the same
ten files come out around 31 MB with nothing near the limit, which is small
enough to commit outright — one more reason to run it.

### Untouched on purpose

Clerk, Supabase and Vapi wiring is exactly as it was. No login was added, no
second database, no change to `middleware.ts`, and
`components/LawCompanionComponent.tsx` and the Courtroom\* components in the LMS
are left alone. Nothing in `CourtRoom.glb` or any character GLB has been
modified, re-posed or regenerated.
