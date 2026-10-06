import { Bricolage_Grotesque, Instrument_Sans, JetBrains_Mono, Noto_Sans_JP } from "next/font/google";
// The suite's shared look first, this app's own rules second.
import "@converso/night-desk/night-desk.css";
import "./globals.css";

/**
 * The same three faces Converso uses, under the same variable names, so a
 * heading here has the weight and the width of a heading there. The Japanese
 * face stays: Instrument Sans has no kana, and the board renders kana.
 */
const display = Bricolage_Grotesque({
  subsets: ["latin"],
  display: "swap",
  weight: ["600"],
  variable: "--font-bricolage",
});

const body = Instrument_Sans({
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500"],
  variable: "--font-instrument",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500"],
  variable: "--font-jetbrains",
});

export const notoSansJP = Noto_Sans_JP({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-noto-sans-jp",
});

export const metadata = {
  title: "Converso — Language Room",
  description:
    "Practise Japanese, Hindi, Spanish, French, German or Korean with a 3D teacher running locally on Ollama",
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${body.variable} ${mono.variable} ${notoSansJP.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
