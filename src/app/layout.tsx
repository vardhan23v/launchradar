import type { Metadata } from "next";
import { Geist_Mono, Instrument_Sans, Newsreader } from "next/font/google";
import "./globals.css";

// Newsreader sets findings and prose like a printed report; Instrument Sans is the
// interface voice; mono is reserved for figures, ids and the research log.
const text = Newsreader({ variable: "--font-text", subsets: ["latin"], style: ["normal", "italic"] });
const ui = Instrument_Sans({ variable: "--font-ui", subsets: ["latin"] });
const data = Geist_Mono({ variable: "--font-data", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "LaunchRadar",
  description: "Market research where every claim links to the search result it came from.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${text.variable} ${ui.variable} ${data.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">{children}</body>
    </html>
  );
}
