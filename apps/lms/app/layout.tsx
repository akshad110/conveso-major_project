import type { Metadata } from "next";
import { Bricolage_Grotesque, Instrument_Sans, JetBrains_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";
import Navbar from "@/components/Navbar";

/**
 * Three faces, three jobs, and nothing overlaps.
 *
 *   display     Bricolage Grotesque — kept from the original build. It is the
 *               product's face and the one thing that survives the redesign
 *               unchanged, so the app still looks like itself.
 *   sans        Instrument Sans — everything a person wrote or said.
 *   mono        JetBrains Mono — everything the machine knows: durations,
 *               subjects, statuses, languages, exit codes.
 *
 * All three are variable fonts, so no weight list is declared; the CSS asks for
 * whatever weight it needs and the browser interpolates it.
 */
const display = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
  display: "swap",
});

const sans = Instrument_Sans({
  variable: "--font-instrument",
  subsets: ["latin"],
  display: "swap",
});

const mono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Converso — learn out loud",
  description:
    "Voice sessions with an AI tutor that writes the work down beside the conversation: runnable code, notes you keep.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${display.variable} ${sans.variable} ${mono.variable} antialiased`}>
        <ClerkProvider
          appearance={{
            variables: {
              colorPrimary: "#FF5A33",
              colorBackground: "#131118",
              colorText: "#ECE9F2",
              colorTextSecondary: "#9D98AC",
              colorInputBackground: "#0E0D13",
              colorInputText: "#ECE9F2",
              colorNeutral: "#ECE9F2",
              colorDanger: "#FF5470",
              colorSuccess: "#4FE0A5",
              colorWarning: "#FFC53D",
              borderRadius: "10px",
            },
            elements: {
              card: "shadow-none",
              headerTitle: "font-display",
              formButtonPrimary: "text-[#180C08] font-semibold",
            },
          }}
        >
          <Navbar />
          {children}
        </ClerkProvider>
      </body>
    </html>
  );
}
