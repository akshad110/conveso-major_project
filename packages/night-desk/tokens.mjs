/**
 * The same hex values, readable from JavaScript.
 *
 * CSS custom properties are invisible to a WebGL renderer: the courtroom's
 * clear colour, its fog, the emissive tint on a role marker and the colour of
 * a subtitle background are all set in JS, and if they are typed by hand they
 * drift from the stylesheet within a week. So the tokens live here as well,
 * and tools/verify-suite.mjs parses night-desk.css and fails if any value in
 * this file disagrees with the `:root` block.
 *
 * Only the values a program needs to *compute* with are here. Everything that
 * is merely styling stays in CSS where it belongs.
 */

export const surface = {
  ground: '#0b0a0f',
  groundDeep: '#070610',
  panel: '#131118',
  panelRaised: '#1a1822',
  panelSunk: '#0e0d13',
  edge: '#262331',
  edgeLit: '#3b3650',
  edgeHot: '#56506f',
}

export const ink = {
  base: '#ece9f2',
  dim: '#9d98ac',
  faint: '#6b667a',
}

export const flame = {
  base: '#ff5a33',
  soft: '#ff8a66',
  sunk: '#3a1a12',
}

export const state = {
  good: '#4fe0a5',
  warn: '#ffc53d',
  bad: '#ff5470',
}

/**
 * The seven accents, each a pastel tile and a luminous sibling.
 *
 * Reuse them by meaning, never by name — that instruction is the whole reason
 * three different applications read as one family. The LMS calls them school
 * subjects; the courtroom calls them seats; the classroom calls them
 * languages.
 */
export const accent = {
  maths: { tile: '#ffda6e', lit: '#ffc53d' },
  language: { tile: '#bde7ff', lit: '#56c9ff' },
  science: { tile: '#e5d0ff', lit: '#b18cff' },
  coding: { tile: '#ffc8e4', lit: '#ff6fb5' },
  history: { tile: '#ffecc8', lit: '#ffa05c' },
  economics: { tile: '#c8ffdf', lit: '#4fe0a5' },
  law: { tile: '#d4af37', lit: '#e9c85a' },
}

/**
 * Courtroom seats, named in the courtroom's own vocabulary.
 *
 * The bench is the law hue because that is what the LMS already calls law; the
 * defence borrows coding's rose and the prosecution language's blue, which is
 * the pairing DESIGN-SYSTEM.md specifies. The 3D scene and the DOM overlay
 * must not disagree about what colour the defence is, so both read this.
 */
export const seat = {
  judge: accent.law.lit,
  clerk: accent.history.lit,
  prosecutor: accent.language.lit,
  defense: accent.coding.lit,
  witness: accent.science.lit,
  defendant: accent.economics.lit,
  police: accent.maths.lit,
}

/** Classroom languages, so a language badge is the same colour in both apps. */
export const language = {
  ja: accent.coding.lit,
  hi: accent.history.lit,
  es: accent.maths.lit,
  fr: accent.language.lit,
  de: accent.science.lit,
  ko: accent.economics.lit,
}

export const radius = {
  card: 20,
  tool: 8,
  pill: 999,
}

export const motion = {
  quick: 140,
  calm: 300,
  ease: 'cubic-bezier(0.32, 0.72, 0, 1)',
}

/** #rrggbb -> 0xrrggbb, for anything that takes a numeric colour. */
export function hex(value) {
  return Number.parseInt(String(value).replace('#', ''), 16)
}

export default { surface, ink, flame, state, accent, seat, language, radius, motion, hex }
