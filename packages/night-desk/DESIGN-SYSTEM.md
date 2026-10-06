# Night Desk

The look Converso wears, written down so the classroom app, the courtroom
simulator and the résumé analyser can wear the same one. Copy
`night-desk.css` into each project and read this once.

## The idea

You are at a desk, at night, and something is talking to you while the work
appears beside the conversation. That sentence decides everything else. It is
why the ground is dark but not black, why panels look like matte card lit from
above rather than glass, and why every screen in the family is split the same
way: the conversation on one side, the artefact it produces on the other.

The three rules below are the whole system. If a new screen follows them it
will match without copying any markup.

## 1. Material

Panels are matte. Each one is lit from above by a single brighter hairline on
its top edge — that is the `--edge-lit` gradient in `.nd-panel::before`, and it
is the most load-bearing detail in the design. Light comes from one direction
and only one.

What this rules out, on purpose: no `backdrop-filter`, no frosted glass, no
glow or coloured halo behind a card, no drop shadows larger than the element
casting them. A surface is distinguished from the surface behind it by its
fill and its top edge, never by a blur.

There are five surfaces and they are not interchangeable. `--ground` is the
page. `--panel` sits on the page. `--panel-raised` is a control sitting on a
panel. `--panel-sunk` is a well you put something *into* — a code editor, a
console, a video frame, a 3D viewport. `--ground-deep` is for full-bleed
immersive screens where the chrome should disappear, which is what the
courtroom uses.

## 2. Voice

Machine facts are set in mono and uppercase: duration, status, language, exit
code, line number, case number, file size, score. Human facts are set in sans:
names, topics, arguments, what somebody actually said.

This is not decoration, it is the fastest legend in the interface. A reader can
tell which is which before reading either, which means a dense panel of mixed
information stays scannable without boxes, dividers or colour.

Three faces, three jobs. **Bricolage Grotesque** at 600 for display, used with
restraint — headings only, never a paragraph. **Instrument Sans** for body.
**JetBrains Mono** for machine facts and any code.

## 3. Shape

Soft for reading, sharp for working. Content cards take `--radius-card` (20px).
Tools — editors, consoles, toolbars, timelines, buttons, inputs — take
`--radius-tool` (8px). The corner tells you whether you are browsing or
building, so keep the two straight: a 20px button looks wrong here, and so does
an 8px content card.

## Colour

`--flame` (#ff5a33) is the only hot colour on a screen. One primary action, one
live state, one cursor. If two things are orange then neither is important.

The seven accents come in pairs. The pastel (`--a-coding`) is only ever a solid
tile behind a dark glyph — it exists because the icon set is drawn in black and
would vanish on a dark ground. The luminous sibling (`--a-coding-lit`) is for
everything else: hairlines, labels, dots, thin bars. Never fill a large area
with a `-lit` value.

Reuse the accents by *meaning*, not by name. The LMS reads them as school
subjects; the courtroom should read `--a-law-lit` as the bench,
`--a-coding-lit` as the defence, `--a-language-lit` as the prosecution; the
résumé analyser should read them as score bands. Same seven hues, different
vocabulary — which is what makes three different apps feel like one family
rather than one app with three names.

## The signature

The waveform is the one memorable element, and it earns that by being the only
animated thing in the system. Four states — `idle`, `connecting`, `listening`,
`speaking` — set through `data-state` on `.nd-wave`. Use it wherever a voice is
live in the room and nowhere else. A waveform on a static page is a logo, which
defeats it.

Everything around the signature stays quiet. No staggered fade-ins on page
load, no scroll-triggered reveals, no gradient text, no `01 / 02 / 03` eyebrow
numbering unless the content genuinely is a sequence. Motion is reserved for
things the user caused (`--t-quick`, 140ms) and the one ambient thing
(`--t-calm`, 300ms).

## Writing

Sentence case everywhere, including buttons. Name the action by what happens:
"Start session", not "Submit"; and the toast that follows says "Session
started", not "Success". Empty states say what to do next rather than
apologising for being empty. Errors say what went wrong and what fixes it, in
the interface's voice — they do not say sorry and they are never vague.

Machine facts get no adjectives. `3.2s`, `exit 0`, `python 3.10.0`, `15m` — the
mono treatment already tells the reader these are measurements.

## Porting it

For a plain HTML/CSS or Vite app, link `night-desk.css` and use the `.nd-*`
classes directly.

For the R3F courtroom, link the file for the DOM overlay and pull the same hex
values into the scene: `--ground-deep` as the clear colour, the `-lit` accents
as emissive values on role markers. The 3D and the DOM should not disagree
about what colour the defence is.

For a Tailwind v4 project, paste the `:root` block into the app's `globals.css`
and expose the tokens through `@theme inline` — that is exactly what Converso
does, which is why its classes are named `.panel` and `.btn` rather than
`.nd-panel` and `.nd-btn`. The `nd-` prefix exists only so the portable file
cannot collide with an existing stylesheet.

Fonts come from Google Fonts:

```
https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600&family=Instrument+Sans:wght@400;500&family=JetBrains+Mono:wght@400;500&display=swap
```

## Floor

Responsive to 360px. Visible keyboard focus on every interactive element — the
`:focus-visible` rule in the file handles this, so do not remove outlines.
`prefers-reduced-motion` is respected, including by the waveform, which holds a
static bar field instead of animating. Body text never goes below 13px, and
`--ink-faint` is for labels only, never for a paragraph someone has to read.
