# AI Courtroom Simulator

React + Three.js renderer for the courtroom. It loads your existing `CourtRoom.glb`
and the character GLBs exactly as authored — no assets are generated, redesigned or
re-posed here, and the courtroom model is never modified.

```bash
npm install
npm run dev        # http://localhost:5173
node tools/validate_animations.mjs   # checks every action against the real GLBs
```

## What is wired up

| | |
|---|---|
| Courtroom | `CourtRoom.glb` loaded untouched |
| Characters | 9 merged GLBs, placed on named spawn points, facing correctly |
| Animations | real clip names read off each GLB, mapped to logical court actions with fallbacks |
| Keyboard debug | select a character with `1`–`7`, drive animations with letter keys |
| Controls panel | one button in the corner; opens a compact panel with a seating-plan picker, the live animation readout, actions for the selected character and camera |
| Court events | `applyCourtEvent()` handles ANIMATION / EVENT / DIALOGUE / STATE / CAMERA |
| Camera | 10 named presets with eased moves, plus free orbit for debugging |
| Evidence | wall monitor with exhibit rendering, driven by `SHOW_EVIDENCE` |
| AI engine | **connected** — `useCourtSocket` talks to `courtroom-simulation-engine` on `ws://127.0.0.1:4177` and renders `COURT_EVENT` / `STREAM_*` traffic |

## Assets

The Meshy exports ship one GLB per clip with UUID clip names, which is 314 MB of
duplicated skinned mesh. `tools/build_characters.py` merges each character into a
single GLB — mesh, skeleton, materials and animation curves copied byte-for-byte,
channels retargeted by bone name — giving 59.8 MB of runtime characters.

Clip identity was **not** guessed from filenames. `tools/analyze_clips.py` runs
forward kinematics over the actual curves and classifies each clip by hip height,
root travel, hand path length and peak height, head yaw/pitch swing and
zero-crossings. `tools/build_characters.py` records the justification per UUID, e.g.

```
'01a0624d-2e9a': ('OBJECTION',        'standing, RIGHT hand spikes to 1.6 (above head)')
'01a0624d-c6c4': ('PRESENT_EVIDENCE', 'right hand held 1.3 for ~4s, head turns 106deg')
'01a06263-43e3': ('NOD',              'pitch oscillates +1/-4.8/+4.4 with flat yaw')
'01a06263-e489': ('SHAKE_HEAD',       'yaw sweeps 0->+30->+9 with pitch -19')
```

To rebuild the runtime GLBs from the originals:

```bash
python3 tools/build_characters.py .. public/models /tmp/stage
```

## Placement and scale

Spawn points in `src/config/courtroomLayout.js` come from the courtroom's own
geometry — world-space AABBs of its nodes plus vertex Y-histograms to find surface
heights — not from eyeballing. The judge platform is at y=0.560 and the clerk
platform at y=0.245; everyone else stands on the floor.

Motion analysis showed character forward is **+Z**, so facing the bench (−X) is
`rotationY = −π/2`, and the judge facing back out is `+π/2`.

`CHARACTER_SCALE = 1.30`. The room is modelled for a ~2.2 m human (lawyer seat
cushion 0.61, judge desk 1.04 above its platform, box rails 1.38–1.40) while the
characters are 1.70 m. One uniform scale reconciles every seat, desk and railing at
once, which is why the people are scaled and the room is left alone.

## Animation fallbacks

`resolveAction(role, action, availableClips)` walks a candidate chain and never
returns nothing. The validator prints every resolution; `~` marks a fallback:

```
WITNESS    ~ SPEAK      -> NOD             (no speaking clip in the export)
CLERK      ~ SPEAK      -> IDLE_SITTING_LOOP
JUDGE      ~ GAVEL      -> SEATED_EMPHASIS (no gavel clip in the export)
POLICE     ~ ESCORT     -> WALK_FORWARD    (the clip with real root motion)
```

The clerk and the judge each shipped a single seated clip, so their seated idles
and gestures are derived as subclips of it (`DERIVED_CLIPS` in
`src/config/animationMap.js`).

Posture is tracked per character. Asking a seated lawyer to `SPEAK` inserts
`STAND_UP` first and, for one-shot gestures, sits them back down afterwards. A
monotonically increasing play token means a newer request always cancels whatever
the previous one queued, so two clips can never fight over the skeleton.

## The judge

The judge export ships only three clips — one 6.53 s clip plus an in-place walk
and run — with motion curves identical to the clerk's. Measured trajectory of
that one clip:

```
t=0.00  hips 0.81  head pitch   0    standing, head level
t=1.09  hips 0.76  head pitch -78    head drops to look down
t=2.72  hips 0.55  head pitch  +2    seated, head coming back up
t=3.27  hips 0.55  head pitch +15    seated, head lifted to address the room
t=6.53  hips 0.56  head pitch  +5    seated, settled
```

So there is no gavel, no speaking clip, no seated idle and no posture
transitions. Four subclips are derived from it in `DERIVED_CLIPS.judge`:
`SIT_DOWN` (0–42%, the genuine descent), `SIT_IDLE_LOOP` (75–100%, the settled
tail), `SEATED_ADDRESS` (52–100%, looping, the head lifting to address the
court) and `SEATED_EMPHASIS` (41–62%, one-shot, the emphasis beat that stands in
for `GAVEL`). All four are marked `~` fallbacks by the validator, so the gap is
visible rather than hidden.

Real clip names still lead every candidate chain, so a richer judge export drops
straight in: put the merged GLB at `public/models/judge.glb`, add its clip list
to `characterRegistry.js`, and `GAVEL` / `SPEAK` will prefer the authored clips
automatically.

## Court event contract

```json
{ "type": "ANIMATION", "event": "PROSECUTOR_OBJECTING", "agent": "prosecutor",
  "animation": "OBJECTION", "camera": "CAMERA_PROSECUTOR" }

{ "type": "EVENT", "event": "SHOW_EVIDENCE", "agent": "prosecutor",
  "evidence": "EXHIBIT_A", "camera": "CAMERA_EVIDENCE" }

{ "type": "DIALOGUE", "agent": "judge", "text": "Sustained." }
{ "type": "STATE",   "state": "CROSS_EXAMINATION" }
{ "type": "CAMERA",  "camera": "CAMERA_WIDE" }
```

Composite beats live in `src/state/courtEvents.js`. `EVENT: OBJECTION` runs the full
sequence: dialogue pauses, counsel rises, the objection gesture plays on camera, the
judge rules, counsel sits, camera returns wide, dialogue resumes.

The socket defaults to the engine's own address, so nothing needs configuring. Point
it elsewhere, or switch it off entirely, with `.env.local`:

```bash
echo 'VITE_COURT_WS_URL=ws://127.0.0.1:4177' > .env.local   # the default
echo 'VITE_COURT_WS_URL=off' > .env.local                   # no socket at all
```

With no engine running, press `M` for the mock feed, which emits the same JSON on a
timeline, or call `courtEvents.applyCourtEvent({...})` from the console.

**Two producers, one socket.** The mock feed and the keyboard send *coarse* event names
where one name stands for a whole passage, so `courtEvents.js` expands them locally. The
AI engine sends every beat itself, already validated. The first engine-only message type
to arrive flips an `engineDriven` flag, after which engine traffic is rendered literally
instead of being expanded a second time. `R` (reset) clears the flag.

Rulings are never invented here. If a producer sends an objection without a `ruling`, the
bench gavels and says nothing — deciding the outcome is the engine's job, not the
renderer's.

## Keyboard

```
1-7  Judge, Prosecutor, Defense, Witness, Defendant, Clerk, Police
I    Idle          S  Speak        L  Listen       O  Objection
E    Evidence      N  Nervous      T  Stand        C  Sit
G    Gavel         P  Point        W  Walk
K    camera to selection    0  wide    F  free orbit    V  evidence monitor
M    mock AI feed           R  reset   H  show/hide controls
```

## Controls panel

Closed by default — press `H` or click **Controls** in the bottom-right corner.
It opens a 336 px panel in that corner and never covers the room.

The picker is a top-down plan of the courtroom, with every seat placed from the
same `SPAWN_POINTS` coordinates the 3D scene uses, so it cannot drift out of
agreement with the room. Judge, Prosecutor and Defendant are drawn large; the
other four seats are quieter but still selectable. Exactly one character is under
manual control at a time — the panel header names them, and both the action
buttons and the letter keys apply to that character only.

Alongside the plan is the live readout: the real clip playing, the logical action
that was asked for, a `fallback` badge when the resolver had to substitute,
posture, and the last court event. The raw clip list read off the loaded GLB and
the full key map are behind disclosures, so they are available without being in
the way.

## Colour

The GLBs are rendered as authored — no material is ever touched. Matching how
they look in a glTF preview tool took three fixes, all in the pipeline rather
than the assets, and all in `src/three/RenderEnvironment.jsx`:

React Three Fiber applies ACES Filmic tone mapping by default. ACES is a film
look: it desaturates saturated colour and rolls highlights toward white, which
turned the rosewood muddy and the saffron peach. The renderer now uses Khronos
PBR Neutral (`THREE.NeutralToneMapping`), which exists so that rendered colour
tracks the material's base colour, with `NoToneMapping` as the fallback on
three builds older than r166.

There was no environment map, so PBR metals had nothing to reflect and resolved
to near black. One is now generated at runtime from three's `RoomEnvironment`
through `PMREMGenerator` — generated, not downloaded, because the app has to run
offline. If that module is unavailable the code falls back to a small inline
studio of grey panels rather than losing reflections entirely.

Every light is white or near-white. A tinted light is a hue shift applied to
every surface in the room, and the hemisphere light this replaced was mixing a
blue sky with a brown ground. Related: the courtroom receives shadows but does
not cast them. This is an interior — a ceiling that casts shadows occludes the
exterior key light before it reaches anything, leaving the room lit by ambient
alone. Characters still cast, so figures stay grounded.

## Layout

```
src/config/    courtroomLayout · characterRegistry · animationMap · cameraPresets · exhibits
src/three/     CourtroomScene · Courtroom · CharacterController · CameraRig · EvidenceMonitor · RenderEnvironment
src/state/     useCourtStore · animationManager · courtEvents · eventTypes · useCourtSocket · mockEventFeed
src/debug/     useDebugControls · ControlPanel
src/ui/        LoadingScreen · DialogueBar · SeatingPlan
tools/         GLB pipeline (pure Python, no deps) + validate_animations.mjs
```

`animationManager` keeps character handles in a module-level Map, outside React
state, so playing a clip never re-renders the scene. It is also on `window` as
`courtAnim` for poking at from the console.
