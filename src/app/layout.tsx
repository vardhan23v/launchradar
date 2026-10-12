import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import "./globals.css";

// Geist Mono is reserved for figures, ids and the step log.
const data = Geist_Mono({ variable: "--font-data", subsets: ["latin"] });

/** The public address, for absolute Open Graph URLs; override with NEXT_PUBLIC_SITE_URL on another host. */
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://launchradar-psi.vercel.app";
const DESCRIPTION = "LaunchRadar looks around the web for things people complain about and suggests product ideas nobody has built yet, with the web pages to prove it.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "LaunchRadar", template: "%s · LaunchRadar" },
  description: DESCRIPTION,
  applicationName: "LaunchRadar",
  openGraph: {
    type: "website",
    siteName: "LaunchRadar",
    title: "LaunchRadar",
    description: DESCRIPTION,
    url: "/",
  },
  twitter: {
    card: "summary",
    title: "LaunchRadar",
    description: DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${data.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">{children}</body>
    </html>
  );
}
