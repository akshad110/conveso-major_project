/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      backgroundImage: {
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
        "gradient-conic":
          "conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))",
      },
    },
    // The suite's three faces, under the names @converso/night-desk expects.
    fontFamily: {
      sans: ["var(--font-instrument)", "ui-sans-serif", "system-ui", "sans-serif"],
      display: ["var(--font-bricolage)", "ui-sans-serif", "sans-serif"],
      mono: ["var(--font-jetbrains)", "ui-monospace", "monospace"],
      jp: ["var(--font-noto-sans-jp)"],
      // System stacks on purpose: no build-time font download, so the app still
      // builds and runs with no internet (same constraint as running Ollama locally).
      deva: [
        '"Noto Sans Devanagari"',
        '"Kohinoor Devanagari"',
        '"Nirmala UI"',
        '"Mangal"',
        "var(--font-instrument)",
        "sans-serif",
      ],
      kr: [
        '"Noto Sans KR"',
        '"Apple SD Gothic Neo"',
        '"Malgun Gothic"',
        '"Nanum Gothic"',
        "var(--font-noto-sans-jp)",
        "sans-serif",
      ],
    },
  },
  plugins: [],
};
