export const subjects = [
  "maths",
  "language",
  "science",
  "history",
  "coding",
  "economics",
  "law",
];

/**
 * The tile colour. These are the pastels the product has always used, and they
 * are kept exactly because the icon set in /public/icons draws its glyphs in
 * solid black — a pastel tile is what keeps those glyphs readable now that the
 * page behind them is dark.
 */
export const subjectsColors = {
  science: "#E5D0FF",
  maths: "#FFDA6E",
  language: "#BDE7FF",
  coding: "#FFC8E4",
  history: "#FFECC8",
  economics: "#C8FFDF",
  law: "#D4AF37",
};

/**
 * The same seven hues turned up until they read as light rather than as paint.
 * Used only for hairlines and labels — the thin bright line along the top of a
 * companion card, the subject word under a session title. Never as a fill on
 * anything larger than a few pixels, which is what stops the interface turning
 * into a bag of sweets.
 */
export const subjectGlow = {
  science: "#B18CFF",
  maths: "#FFC53D",
  language: "#56C9FF",
  coding: "#FF6FB5",
  history: "#FFA05C",
  economics: "#4FE0A5",
  law: "#E9C85A",
};

/** What each companion actually does with the workspace beside the transcript. */
export const subjectBlurb: Record<string, string> = {
  coding: "Writes runnable code into your editor as you talk.",
  maths: "Works the steps out on the board as you talk.",
  science: "Builds up notes and diagrams as you talk.",
  history: "Lays the timeline out as you talk.",
  economics: "Draws the model out as you talk.",
  language: "Speaks with you and marks what to practise.",
  law: "Puts you in the courtroom and runs the hearing.",
};

export const voices = {
  male: { casual: "2BJW5coyhAzSr8STdHbE", formal: "c6SfcYrb2t09NHXiT80T" },
  female: { casual: "ZIlrSGI4jZqobxRKprJz", formal: "sarah" },
};

export const recentSessions = [
  {
    id: "1",
    subject: "science",
    name: "Neura the Brainy Explorer",
    topic: "Neural Network of the Brain",
    duration: 45,
    color: "#E5D0FF",
  },
  {
    id: "2",
    subject: "maths",
    name: "Countsy the Number Wizard",
    topic: "Derivatives & Integrals",
    duration: 30,
    color: "#FFDA6E",
  },
  {
    id: "3",
    subject: "language",
    name: "Verba the Vocabulary Builder",
    topic: "English Literature",
    duration: 30,
    color: "#BDE7FF",
  },
  {
    id: "4",
    subject: "coding",
    name: "Codey the Logic Hacker",
    topic: "Intro to If-Else Statements",
    duration: 45,
    color: "#FFC8E4",
  },
  {
    id: "5",
    subject: "history",
    name: "Memo, the Memory Keeper",
    topic: "World Wars: Causes & Consequences",
    duration: 15,
    color: "#FFECC8",
  },
  {
    id: "6",
    subject: "economics",
    name: "The Market Maestro",
    topic: "The Basics of Supply & Demand",
    duration: 10,
    color: "#C8FFDF",
  },
];
